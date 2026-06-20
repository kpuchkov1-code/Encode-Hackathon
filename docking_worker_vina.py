"""Lightweight AutoDock Vina worker -- a fast stand-in for the full gnina engine while
that image (heavier: CUDA-compat libs, GPU support) gets built and tested separately.
Vina has no CNN scoring and no GPU/CUDA dependency at all, so this image is much
smaller and faster to build. Used to validate the per-job Docker orchestration
architecture quickly; gnina remains the real target engine (see Dockerfile, gnina-bin/).

Reuses docking_worker's engine-agnostic receptor/ligand prep (RDKit-based, identical
for any docking engine) -- only the actual docking call differs.
"""
import os

from rdkit import Chem
from vina import Vina

import docking_worker  # reuse prepare_receptor, split_ligands


def _bounding_box(sdf_path: str) -> tuple[list[float], list[float]]:
    """Vina's Python bindings have no --autobox_ligand equivalent, so derive a search
    box from the reference ligand's own bounding coordinates plus a margin."""
    mol = next(iter(Chem.SDMolSupplier(sdf_path, removeHs=False)))
    conf = mol.GetConformer()
    xs, ys, zs = zip(*(conf.GetAtomPosition(i) for i in range(mol.GetNumAtoms())))
    margin = 10.0
    center = [(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2]
    size = [max(xs) - min(xs) + margin, max(ys) - min(ys) + margin, max(zs) - min(zs) + margin]
    return center, size


def run_vina(receptor_pdbqt: str, ligand_pdbqt: str, box_spec: dict, params: dict, output_path: str) -> float:
    if box_spec.get("autobox_ligand"):
        ref_path = output_path + ".autobox_ref.sdf"
        with open(ref_path, "w") as f:
            f.write(box_spec["autobox_ligand"])
        center, size = _bounding_box(ref_path)
    else:
        center, size = box_spec["center"], box_spec["size"]

    v = Vina(sf_name="vina", seed=params["seed"])
    v.set_receptor(receptor_pdbqt)
    v.set_ligand_from_file(ligand_pdbqt)
    v.compute_vina_maps(center=center, box_size=size)
    v.dock(exhaustiveness=params["exhaustiveness"], n_poses=params["num_modes"])
    v.write_poses(output_path, n_poses=1, overwrite=True)
    return float(v.energies(n_poses=1)[0][0])  # kcal/mol, more negative = better


def _prep_pdbqt(input_path: str, output_path: str, is_receptor: bool) -> None:
    import subprocess

    if is_receptor:
        cmd = ["mk_prepare_receptor.py", "--read_pdb", input_path, "-o", output_path.removesuffix(".pdbqt"), "-p"]
    else:
        cmd = ["mk_prepare_ligand.py", "-i", input_path, "-o", output_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(f"{cmd[0]} failed: {result.stderr.strip()}")


def dock_job(job_spec: dict, work_dir: str) -> list[dict]:
    """Same shape/contract as docking_worker.dock_job, so the orchestrator and
    engine_entrypoint.py don't need to know which engine produced the result."""
    os.makedirs(work_dir, exist_ok=True)
    receptor_pdb = docking_worker.prepare_receptor(job_spec["receptor"], work_dir)
    receptor_pdbqt = os.path.join(work_dir, "receptor.pdbqt")
    _prep_pdbqt(receptor_pdb, receptor_pdbqt, is_receptor=True)

    prepped = docking_worker.split_ligands(job_spec["ligands_sdf"], work_dir)
    results = []
    for entry in prepped:
        ligand_id = entry["ligand_id"]
        if "error" in entry:
            results.append({"ligand_id": ligand_id, "error": entry["error"]})
            continue
        try:
            ligand_pdbqt = os.path.join(work_dir, f"{ligand_id}.pdbqt")
            _prep_pdbqt(entry["sdf_path"], ligand_pdbqt, is_receptor=False)
            output_path = os.path.join(work_dir, f"{ligand_id}_out.pdbqt")
            affinity = run_vina(receptor_pdbqt, ligand_pdbqt, job_spec["box"], job_spec["params"], output_path)
            results.append({"ligand_id": ligand_id, "vina_affinity": affinity, "pose_path": output_path})
        except Exception as exc:  # noqa: BLE001 -- one ligand's failure must not abort the job
            results.append({"ligand_id": ligand_id, "error": str(exc)})

    ok = [r for r in results if "error" not in r]
    failed = [r for r in results if "error" in r]
    ok.sort(key=lambda r: r["vina_affinity"])  # more negative kcal/mol = better
    return ok + failed
