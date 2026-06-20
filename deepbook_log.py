"""DeepBook settlement log for the docking marketplace.

When a job settles (provider paid out of escrow), we record the marketplace transaction on
DeepBook -- Sui's on-chain order book -- by placing a tiny marker order on an existing
zero-fee pool. That order is a permanent, publicly auditable on-chain event: a DeepBook-native
ledger of marketplace activity, on top of the escrow lock/release txs.

DeepBook is used ONLY as a log here -- not to price jobs (that's a fixed platform rate) and
not to match them (the pull queue + escrow do that). It deliberately avoids creating our own
pool (which costs a fixed 500-DEEP fee); logging onto the existing DEEP/SUI pool needs only a
sliver of SUI and gas. The marker carries only an opaque compute-unit COUNT -- nothing
job-, protein-, or ligand-identifying ever touches the public book (same rule as Walrus).

Best-effort by design, exactly like walrus.py: the write goes through the isolated Node
DeepBook bridge (DEEPBOOK_BRIDGE_CMD), which needs @mysten/sui v2 and a balance manager that
only exist in local/dedicated environments. Where the bridge isn't configured (e.g. Vercel),
every call is a no-op returning None, so settlement never depends on it. Disable explicitly
with DEEPBOOK_LOG_ENABLED=0.
"""
import json
import os
import shlex
import subprocess

DEEPBOOK_LOG_ENABLED = os.environ.get("DEEPBOOK_LOG_ENABLED", "1") != "0"
# e.g. "node /home/ali/Projects/encode_hackathon/deepbook-bridge/deepbook.mjs"
DEEPBOOK_BRIDGE_CMD = os.environ.get("DEEPBOOK_BRIDGE_CMD")
# A balance manager must exist for marker orders to lock against (created once via the bridge
# `create-manager` op). Without it, logging is simply off.
DEEPBOOK_BALANCE_MANAGER_ID = os.environ.get("DEEPBOOK_BALANCE_MANAGER_ID")


def _enabled() -> bool:
    return bool(DEEPBOOK_LOG_ENABLED and DEEPBOOK_BRIDGE_CMD and DEEPBOOK_BALANCE_MANAGER_ID)


def log_settlement(compute_units: int) -> dict | None:
    """Record a settled job on DeepBook. Returns {digest, pool, pool_id, compute_units,
    suiscan_url} on success, or None on any failure / when logging is disabled.

    compute_units is the job's ligand count -- an opaque magnitude, never anything that
    identifies the molecules or the job."""
    if not _enabled():
        return None
    try:
        cmd = shlex.split(DEEPBOOK_BRIDGE_CMD) + ["log", str(int(compute_units))]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if not proc.stdout.strip():
            return None
        data = json.loads(proc.stdout.strip().splitlines()[-1])
        if not data.get("ok") or not data.get("digest"):
            return None
        return {
            "digest": data["digest"],
            "pool": data.get("pool"),
            "pool_id": data.get("poolId"),
            "compute_units": data.get("computeUnits"),
            "suiscan_url": f"https://suiscan.xyz/testnet/tx/{data['digest']}",
        }
    except (subprocess.SubprocessError, ValueError, OSError):
        return None
