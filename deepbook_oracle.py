"""DeepBook price oracle for the docking marketplace.

Providers post generic compute-unit ask orders on a DeepBook COMPUTE/SUI pool; this module
reads the live best-ask and turns it into the per-ligand rate the control plane charges. So
the price a researcher pays is set by a real on-chain order book, not a hard-coded constant.

DeepBook is used ONLY for price discovery here -- not to match or settle jobs (the pull
queue + Sui escrow do that). The orders it reads carry only an opaque compute-unit quantity
and price; nothing identifying about a job, protein, or ligand ever touches the book (same
public-data rule as Walrus -- see the architecture plan).

Best-effort by design, exactly like walrus.py: the read goes through the isolated Node
DeepBook bridge (DEEPBOOK_BRIDGE_CMD) which needs @mysten/sui v2 + a node_modules that only
exists in local/dedicated environments. On Vercel -- where that bridge isn't deployed -- the
env var is simply unset and every call falls back to the static baseline rate, so pricing
never breaks. Disable explicitly with DEEPBOOK_ENABLED=0.
"""
import json
import os
import shlex
import subprocess
import time

DEEPBOOK_ENABLED = os.environ.get("DEEPBOOK_ENABLED", "1") != "0"
# e.g. "node /home/ali/Projects/encode_hackathon/deepbook-bridge/deepbook.mjs"
DEEPBOOK_BRIDGE_CMD = os.environ.get("DEEPBOOK_BRIDGE_CMD")

# The compute-unit rate (in SUI) that maps to the baseline per-ligand price. The live market
# rate is expressed relative to this anchor, so the price a researcher pays tracks real
# DeepBook movement while staying anchored at the familiar baseline. Defaults to the current
# live reading of the reference pool used as a stand-in until our own COMPUTE pool is funded;
# set it to the seed-ask price of the real COMPUTE/SUI pool once that exists.
DEEPBOOK_RATE_ANCHOR_SUI = float(os.environ.get("DEEPBOOK_RATE_ANCHOR_SUI", "0.02353"))

# The oracle reading is cached so we don't shell out to Node on every price estimate (the
# book moves on the order of seconds, and a stale-by-a-minute compute rate is completely fine).
_CACHE_TTL_SECONDS = float(os.environ.get("DEEPBOOK_CACHE_TTL_SECONDS", "60"))
_cache: dict = {"at": 0.0, "value": None}


def _read_bridge() -> dict | None:
    """Run the DeepBook bridge `price` op and return its parsed JSON, or None on any failure."""
    if not (DEEPBOOK_ENABLED and DEEPBOOK_BRIDGE_CMD):
        return None
    try:
        cmd = shlex.split(DEEPBOOK_BRIDGE_CMD) + ["price"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if not proc.stdout.strip():
            return None
        data = json.loads(proc.stdout.strip().splitlines()[-1])
        if not data.get("ok") or data.get("suiPerComputeUnit") in (None, 0):
            return None
        return data
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


def live_market(baseline_rate: float) -> dict | None:
    """Return the live market pricing context, or None if the oracle is unavailable.

    Shape: {price_per_ligand, sui_per_compute_unit, multiplier, source, pool_id, pool_key,
    note}. `price_per_ligand` is the baseline rate scaled by how the live compute rate
    compares to the anchor, so callers can charge it directly and also show provenance."""
    now = time.monotonic()
    if _cache["value"] is not None and (now - _cache["at"]) < _CACHE_TTL_SECONDS:
        data = _cache["value"]
    else:
        data = _read_bridge()
        _cache["at"] = now
        _cache["value"] = data
    if not data:
        return None

    sui_rate = float(data["suiPerComputeUnit"])
    multiplier = sui_rate / DEEPBOOK_RATE_ANCHOR_SUI if DEEPBOOK_RATE_ANCHOR_SUI else 1.0
    return {
        "price_per_ligand": round(baseline_rate * multiplier, 4),
        "sui_per_compute_unit": sui_rate,
        "multiplier": round(multiplier, 4),
        "source": data.get("source"),
        "pool_id": data.get("poolId"),
        "pool_key": data.get("poolKey"),
        "best_ask": data.get("bestAsk"),
        "best_bid": data.get("bestBid"),
        "note": data.get("note"),
    }
