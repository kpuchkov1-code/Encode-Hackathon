"""Receptor/ligand prep and gnina invocation for the docking marketplace backend.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md). Ligand prep uses RDKit only,
never OpenBabel. The real product input is one multi-molecule SDF file (a screening
library), not a list of individually-specified ligands.
"""
import os
import subprocess

from rdkit import Chem
from rdkit.Chem import AllChem

import worker_setup

RCSB_PDB_URL = "https://files.rcsb.org/download/{pdb_id}.pdb"


def prepare_receptor(receptor_spec: dict, work_dir: str) -> str:
    """:ReceptorPrep: -- fetch-by-id or use inline content, then strip to ATOM records.

    `requests` is imported lazily here, not at module level, because the common case
    in this marketplace is the client/researcher provides the PDB file directly
    (per the product design -- see SESSION_HANDOFF.md), so engines that never use the
    pdb_id-fetch path (e.g. the lightweight Vina test image) don't need this dependency
    installed at all.
    """
    if receptor_spec.get("pdb_id"):
        import requests

        resp = requests.get(RCSB_PDB_URL.format(pdb_id=receptor_spec["pdb_id"]), timeout=30)
        resp.raise_for_status()
        pdb_text = resp.text
    else:
        pdb_text = receptor_spec["file"]

    clean_path = os.path.join(work_dir, "receptor.pdb")
    with open(clean_path, "w") as f:
        for line in pdb_text.splitlines(keepends=True):
            if line.startswith("ATOM"):
                f.write(line)
    return clean_path


def split_ligands(ligands_sdf: str, work_dir: str) -> list[dict]:
    """Splits one multi-molecule SDF into individual ligand prep results using RDKit.

    Returns a list of dicts, each either {"ligand_id", "sdf_path"} for a molecule
    RDKit parsed successfully, or {"ligand_id", "error"} for one it could not.
    """
    raw_path = os.path.join(work_dir, "ligands_raw.sdf")
    with open(raw_path, "w") as f:
        f.write(ligands_sdf)

    results = []
    supplier = Chem.SDMolSupplier(raw_path, removeHs=False)
    for index, mol in enumerate(supplier):
        ligand_id = None
        if mol is not None and mol.HasProp("_Name") and mol.GetProp("_Name").strip():
            ligand_id = mol.GetProp("_Name").strip()
        if ligand_id is None:
            ligand_id = f"ligand_{index}"

        if mol is None:
            results.append({"ligand_id": ligand_id, "error": "RDKit could not parse this molecule block"})
            continue

        try:
            if mol.GetNumConformers() == 0:
                mol = Chem.AddHs(mol)
                if AllChem.EmbedMolecule(mol, AllChem.ETKDG()) == -1:
                    raise ValueError("RDKit could not embed a 3D conformer")
                AllChem.MMFFOptimizeMolecule(mol)
            sdf_path = os.path.join(work_dir, f"{ligand_id}.sdf")
            writer = Chem.SDWriter(sdf_path)
            writer.write(mol)
            writer.close()
            results.append({"ligand_id": ligand_id, "sdf_path": sdf_path})
        except Exception as exc:  # noqa: BLE001 -- per-ligand isolation is the point
            results.append({"ligand_id": ligand_id, "error": str(exc)})

    return results


def run_gnina(receptor_path: str, ligand_path: str, box_spec: dict, params: dict, output_path: str) -> None:
    """:GninaCommand: -- invoke the gnina binary worker_setup resolved, with the dynamic-
    library environment it computed (never a relative path or a PATH-resolved wrapper
    script, since that broke once before under a different caller cwd)."""
    cmd = [worker_setup.GNINA_PATH, "-r", receptor_path, "-l", ligand_path, "-o", output_path]

    if box_spec.get("autobox_ligand"):
        ref_path = output_path + ".autobox_ref.sdf"
        with open(ref_path, "w") as f:
            f.write(box_spec["autobox_ligand"])
        cmd += ["--autobox_ligand", ref_path]
    else:
        c, s = box_spec["center"], box_spec["size"]
        cmd += [
            "--center_x", str(c[0]), "--center_y", str(c[1]), "--center_z", str(c[2]),
            "--size_x", str(s[0]), "--size_y", str(s[1]), "--size_z", str(s[2]),
        ]

    cmd += [
        "--seed", str(params["seed"]),
        "--num_modes", str(params["num_modes"]),
        "--exhaustiveness", str(params["exhaustiveness"]),
    ]
    if not worker_setup.has_gpu():
        cmd.append("--no_gpu")

    result = subprocess.run(cmd, capture_output=True, text=True, env=worker_setup.get_gnina_env())
    if result.returncode != 0:
        raise RuntimeError(f"gnina failed: {result.stderr.strip()}")


def parse_best_pose(output_sdf_path: str) -> dict:
    """Parses the best (first) pose's CNNscore/CNNaffinity/minimizedAffinity."""
    supplier = Chem.SDMolSupplier(output_sdf_path, removeHs=False)
    if len(supplier) == 0 or supplier[0] is None:
        raise RuntimeError(f"no parsable pose in gnina output {output_sdf_path}")
    mol = supplier[0]
    return {
        "cnn_score": float(mol.GetProp("CNNscore")),
        "cnn_affinity": float(mol.GetProp("CNNaffinity")),
        "vina_affinity": float(mol.GetProp("minimizedAffinity")),
        "pose_path": output_sdf_path,
    }


def dock_job(job_spec: dict, work_dir: str) -> list[dict]:
    """Runs the full worker: receptor prep, ligand split, dock each, rank by cnn_affinity."""
    os.makedirs(work_dir, exist_ok=True)
    receptor_path = prepare_receptor(job_spec["receptor"], work_dir)

    prepped = split_ligands(job_spec["ligands_sdf"], work_dir)
    results = []
    for entry in prepped:
        ligand_id = entry["ligand_id"]
        if "error" in entry:
            results.append({"ligand_id": ligand_id, "error": entry["error"]})
            continue
        try:
            output_path = os.path.join(work_dir, f"{ligand_id}_out.sdf")
            run_gnina(receptor_path, entry["sdf_path"], job_spec["box"], job_spec["params"], output_path)
            pose = parse_best_pose(output_path)
            results.append({"ligand_id": ligand_id, **pose})
        except Exception as exc:  # noqa: BLE001 -- one ligand's failure must not abort the job
            results.append({"ligand_id": ligand_id, "error": str(exc)})

    ok = [r for r in results if "error" not in r]
    failed = [r for r in results if "error" in r]
    ok.sort(key=lambda r: r["cnn_affinity"], reverse=True)
    return ok + failed
