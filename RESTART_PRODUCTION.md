# Restart / redeploy production (on-chain escrow)

Production's wallet/pay flow only works while the **Sui bridge** (holds the platform
signing key) is reachable from Vercel over HTTPS. We expose the local bridge with a free
`localhost.run` SSH tunnel. **The tunnel URL changes every restart**, so each time the
laptop reboots or the tunnel drops you must: restart the bridge → reopen the tunnel →
point Vercel at the new URL → redeploy.

The shared secret (`SUI_BRIDGE_SECRET`) is fixed — stored in `sui-bridge/.env.local`
(gitignored) and already set on Vercel. You only touch the **URL** on a restart.

---

## A. Start the bridge + tunnel (run on this laptop)

```bash
cd ~/Projects/encode_hackathon

# 1. Start the Sui bridge as an HTTP service on :8787 (loads key + secret from .env.local)
set -a; . ./sui-bridge/.env.local; set +a
PORT=8787 nohup node sui-bridge/server.mjs > /tmp/bridge_http.log 2>&1 & disown

# 2. Open the public tunnel — LEAVE THIS TERMINAL OPEN.
#    It prints a line like:  https://abc123.lhr.life tunneled with tls termination
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8787 nokey@localhost.run
```

Copy the `https://....lhr.life` URL it prints.

## B. Point Vercel at the new URL + redeploy (new terminal)

```bash
cd ~/Projects/encode_hackathon
URL="https://PASTE-THE-lhr.life-URL-HERE"

# 3. Replace the old SUI_BRIDGE_URL with the new tunnel URL
npx --yes vercel@latest env rm SUI_BRIDGE_URL production --yes
printf '%s' "$URL" | npx --yes vercel@latest env add SUI_BRIDGE_URL production

# 4. Redeploy production
npx --yes vercel@latest deploy --prod --yes
```

## C. Verify it worked

```bash
cd ~/Projects/encode_hackathon
URL="https://PASTE-THE-lhr.life-URL-HERE"
SECRET="$(grep '^SUI_BRIDGE_SECRET=' sui-bridge/.env.local | cut -d= -f2-)"

# tunnel reaches the bridge (returns packageId/arbiter JSON)
curl -s -X POST "$URL/info" -H "x-bridge-secret: $SECRET"; echo

# production is in on-chain mode (this line only appears when SUI_BRIDGE_URL is set)
curl -s https://encodehackathon-dusky.vercel.app/researchers/signup | grep -i "your own Sui wallet"
```

If both print output, the live researcher pay page will show the connect-wallet + sign-escrow step.

---

## One-time only (already done — here for reference)

The secret is already on Vercel. Only re-run this if it's ever lost/rotated:

```bash
cd ~/Projects/encode_hackathon
printf '%s' "$(grep '^SUI_BRIDGE_SECRET=' sui-bridge/.env.local | cut -d= -f2-)" \
  | npx --yes vercel@latest env add SUI_BRIDGE_SECRET production
```

## Stop / turn production back to mock

Close the tunnel terminal (Ctrl+C) and the bridge stops being reachable. To make
production cleanly show mock mode again instead of erroring:

```bash
npx --yes vercel@latest env rm SUI_BRIDGE_URL production --yes
npx --yes vercel@latest env rm SUI_BRIDGE_SECRET production --yes
npx --yes vercel@latest deploy --prod --yes
```

## Local dev server (separate from production)

For testing the full flow on `http://localhost:8000` (already on-chain via the bridge CLI
subprocess — no tunnel needed):

```bash
cd ~/Projects/encode_hackathon
nohup ./run_server.sh > /tmp/encode_server.log 2>&1 & disown
```

---

## Permanent fix (when you're ready to stop babysitting the tunnel)

Host `sui-bridge/server.mjs` on **Render free tier** (no card) so it's always-on with a
stable URL. Then `SUI_BRIDGE_URL` is set once and never changes. See `DEPLOY.md` §"make
escrow real". The only downside is a ~30–60s cold start after idle.
