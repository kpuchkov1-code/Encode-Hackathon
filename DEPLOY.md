# Deploying the control plane

The control plane is the FastAPI app in [`api/index.py`](api/index.py). It runs as a single
Python serverless function on **Vercel** (zero-config — no `vercel.json`; Vercel detects the
`app` ASGI object). Everything else in this repo is worker-side or dev tooling and is excluded
by [`.vercelignore`](.vercelignore).

- **Live URL:** https://encodehackathon-dusky.vercel.app
- **Vercel project:** `encode_hackathon` (team `m3GczUYQN2PGdWlfxiTeY2By`)
- **Production branch:** `backend/handwritten-vercel-worker-split` (NOT `main` — `main` is the
  old Flask/Codeplain line and is a different codebase).
- **What actually ships:** `api/index.py`, `models.py`, `walrus.py`, `requirements.txt`, and
  `public/worker-package.zip`. Confirm with `npx vercel build` locally if unsure.

## Required environment variables (set on Vercel, per environment)

| Var | Purpose | Required |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (job/worker/escrow state) | **yes** |
| `ADMIN_PASSWORD` | gate for `/admin/dashboard` | yes (or dashboard is unreachable) |
| `SUI_BRIDGE_URL`, `SUI_BRIDGE_SECRET` | real on-chain Sui escrow (see below) | no — unset = KV-mock |
| `WALRUS_ENABLED` | set `0` to disable Walrus anchoring | no (defaults on) |
| `VERIFY_SAMPLE_FRACTION` | fraction of ligands re-checked (default `0.1`) | no |
| `VERIFY_TOLERANCE_KCAL` | affinity tolerance for a "pass" (default `1.0`) | no |

Never commit `KV_*`, `ADMIN_PASSWORD`, `SUI_BRIDGE_SECRET`, or the Sui platform key. They live
only in Vercel's env store (and `.env.local`, which is gitignored).

## Option A — Git auto-deploy (the proper path)

A push to the production branch deploys automatically. One-time setup, mostly in the browser:

1. **Connect a GitHub login to your Vercel account** (required once):
   https://vercel.com/account/login-connections → add GitHub.
2. **Give Vercel access to the repo.** Since `kpuchkov1-code/Encode-Hackathon` is the teammate's
   repo, the Vercel GitHub App must be installed on it (you must be a collaborator; the repo owner
   may need to approve the app's access).
3. **Connect the repo to the project:** Vercel → project `encode_hackathon` → Settings → Git →
   Connect Git Repository → pick `kpuchkov1-code/Encode-Hackathon`.
4. **Set the production branch:** Settings → Git → Production Branch →
   `backend/handwritten-vercel-worker-split` → Save.

After that: `git push origin backend/handwritten-vercel-worker-split` → Vercel builds and promotes
to the live URL automatically. Every other branch push gets its own throwaway preview URL.

## Option B — CLI deploy (fallback, works today)

From a checkout of the production branch, authenticated as the Vercel account owner:

```bash
npx vercel@latest --prod --yes      # builds + promotes to the live URL
```

Rollback is instant in the Vercel dashboard (Deployments → pick a prior one → Promote), or:

```bash
npx vercel@latest rollback <previous-deployment-url>
```

## Post-deploy smoke test

```bash
U=https://encodehackathon-dusky.vercel.app
curl -s $U/health                                   # {"status":"ok"}
curl -s $U/providers/signup | grep -o sui_address   # confirms current code is live
curl -s -o /dev/null -w "%{http_code}\n" $U/admin/dashboard   # 401 = gated, expected
```

For a full marketplace loop test (signup → submit → real docking → verify → settle), run a worker
daemon against the live URL from a machine with Docker + the `docking-engine-vina:latest` image:

```bash
CONTROL_PLANE_URL=$U WORKER_ID=<id> WORKER_TOKEN=<token> python worker_daemon.py
```

## Turning on real on-chain Sui escrow (later)

Production runs **KV-mock escrow** by default (state is recorded, but no real Sui transaction).
To make escrow real (lock/release/refund as actual testnet transactions):

1. **Host the bridge.** Deploy [`sui-bridge/server.mjs`](sui-bridge/README.md) as its own small
   always-on service (Railway / Render / Fly — *not* on this Vercel project; Vercel functions
   can't safely hold the signing key). Set on the bridge host: `SUI_PLATFORM_KEY`,
   `ESCROW_PACKAGE_ID`, `SUI_BRIDGE_SECRET`.
2. **Point the control plane at it.** On Vercel, set `SUI_BRIDGE_URL=https://<bridge-host>` and the
   same `SUI_BRIDGE_SECRET`. Redeploy.

With those set, `models.escrow_*` become real Sui transactions; the job page shows live Suiscan
links. Unset them and it reverts to the mock — no code change. See
[`sui-bridge/README.md`](sui-bridge/README.md) for the Move package id and platform address.
