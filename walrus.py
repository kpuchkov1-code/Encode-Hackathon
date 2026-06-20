"""Walrus tamper-evidence anchor for docking jobs.

Every completed job commits a tiny **hashes-only** manifest to Walrus (Sui's
decentralized blob store). Walrus blobs are public and content-addressed, so the
returned blob id is itself a tamper-evident commitment: the result bytes existed at that
time and can't be altered without changing the id. The manifest carries ONLY opaque
data -- the random job id, the seed, a per-result SHA-256, and an overall bundle hash.
It deliberately contains no ligand names, SMILES, sequences, affinities, or pose bytes,
because Walrus is publicly readable and the project's rule is that nothing identifying
about the actual molecules ever lands in public storage (see the architecture plan).

Best-effort by design: a Walrus hiccup must never fail an otherwise-good docking job, so
publish_manifest swallows errors and returns None. Disable entirely with WALRUS_ENABLED=0.
"""
import hashlib
import json
import math  # noqa: F401  (kept for callers importing sampling helpers from here historically)
import os

import requests

WALRUS_ENABLED = os.environ.get("WALRUS_ENABLED", "1") != "0"
WALRUS_PUBLISHER_URL = os.environ.get(
    "WALRUS_PUBLISHER_URL", "https://publisher.walrus-testnet.walrus.space"
)
WALRUS_AGGREGATOR_URL = os.environ.get(
    "WALRUS_AGGREGATOR_URL", "https://aggregator.walrus-testnet.walrus.space"
)
WALRUS_EPOCHS = int(os.environ.get("WALRUS_EPOCHS", "5"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_manifest(job_id: str, seed: int, engine: str, result: list[dict]) -> dict:
    """Hashes-only manifest. Per-result entries are positional (`i`), never keyed by
    ligand name, so nothing identifying about the screened molecules is exposed. Each
    `result_sha256` covers that result's affinity + docked pose; `bundle_sha256` covers
    the whole ordered result list -- the single hash that anchors the entire output."""
    ligands = []
    canonical_all = []
    for i, r in enumerate(result):
        # Canonical per-result bytes: affinity + pose (or the error), order-stable.
        canonical = json.dumps(
            {
                "affinity": r.get("vina_affinity"),
                "pose": r.get("pose_pdbqt"),
                "error": r.get("error"),
            },
            sort_keys=True,
        )
        canonical_all.append(canonical)
        ligands.append({"i": i, "result_sha256": _sha256(canonical)})
    bundle_sha256 = _sha256("\n".join(canonical_all))
    return {
        "job_id": job_id,
        "seed": seed,
        "engine": engine,
        "ligand_count": len(result),
        "ligands": ligands,
        "bundle_sha256": bundle_sha256,
    }


def publish_manifest(manifest: dict) -> dict | None:
    """PUT the manifest to Walrus. Returns {blob_id, bundle_sha256, aggregator_url} on
    success, or None on any failure (best-effort -- never raises into the job flow)."""
    if not WALRUS_ENABLED:
        return None
    try:
        body = json.dumps(manifest, sort_keys=True).encode("utf-8")
        resp = requests.put(
            f"{WALRUS_PUBLISHER_URL.rstrip('/')}/v1/blobs?epochs={WALRUS_EPOCHS}",
            data=body,
            timeout=45,
        )
        resp.raise_for_status()
        data = resp.json()
        created = data.get("newlyCreated", {}).get("blobObject", {})
        blob_id = created.get("blobId") or data.get("alreadyCertified", {}).get("blobId")
        if not blob_id:
            return None
        return {
            "blob_id": blob_id,
            "bundle_sha256": manifest["bundle_sha256"],
            "aggregator_url": f"{WALRUS_AGGREGATOR_URL.rstrip('/')}/v1/blobs/{blob_id}",
        }
    except (requests.RequestException, ValueError, KeyError):
        return None
