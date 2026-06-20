#!/usr/bin/env bash
# Local dev server WITH the trustless on-chain escrow bridge enabled.
# Loads control-plane KV creds (.env.local) + the Sui bridge key/package
# (sui-bridge/.env.local), and points the control plane at the bridge CLI as a
# subprocess so the /jobs/{id}/pay wallet flow goes fully on-chain on testnet.
set -euo pipefail
cd "$(dirname "$0")"

set -a
[ -f .env.local ] && . ./.env.local
[ -f sui-bridge/.env.local ] && . ./sui-bridge/.env.local
set +a

export SUI_BRIDGE_CMD="node $(pwd)/sui-bridge/cli.mjs"
export SUI_NETWORK="${SUI_NETWORK:-testnet}"

echo "on-chain bridge: $SUI_BRIDGE_CMD"
exec .venv/bin/uvicorn api.index:app --host 127.0.0.1 --port 8000 "$@"
