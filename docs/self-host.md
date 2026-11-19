# Host your own copy

This guide takes you from a fork to your own working connector: your contract on T3N, your pay server, and your setup page. Allow about an hour the first time.

> Read the [Disclaimer](../README.md#disclaimer) first. When you host this, you are the operator, and, once live, the seller of record. Review the code, keep the keys safe, and stay on test mode until you've done your own security and legal review.

## What you'll run

| Piece | Where | Holds |
|---|---|---|
| **Flight contract** (`contract/`) | Your T3N tenant | The Duffel token (sealed in its `secrets` map), traveller records, order ownership |
| **Pay server** (`server/`) | Any Node 22 host with HTTPS and a writable disk; a small VPS with Caddy is assumed here | Stripe keys and a **pay agent key** that can only call `pay-hold`. **No** Duffel token, **no** passenger data |
| **Setup page** (`onboarding/`) | Vercel (or any static host that can proxy `/t3/*`) | Nothing: it runs in the traveller's browser as the traveller |
| **Private Doc Scanner** | Terminal 3's hosted copy by default, or [your own](https://github.com/Terminal-3/private-doc-scanner) | Nothing: it reads the passport on the phone and seals it to the traveller's vault |

## 0. Accounts and keys you need

| Account | What to get | Guide |
|---|---|---|
| **T3N** (operator) | Your T3N key | [t3n-quickstart.md](t3n-quickstart.md) |
| **T3N** (a test traveller, different email) | For testing as a user | [t3n-quickstart.md](t3n-quickstart.md) |
| **Duffel** | A **test** access token (`duffel_test_…`) | [dashboards.md → Duffel](dashboards.md#duffel) |
| **Stripe** | **Test** secret and publishable keys (`sk_test_…`, `pk_test_…`) | [dashboards.md → Stripe](dashboards.md#stripe) |
| **Hosting** | A VPS (or other Node host) with a hostname, plus a Vercel account | [dashboards.md → Vercel](dashboards.md#vercel) |

No domain? Use **sslip.io**: `vault.<your-ip-with-dashes>.sslip.io` (e.g. `vault.203-0-113-5.sslip.io`) resolves to your VPS, and Caddy can get a real certificate for it.

## 1. Fork and build the contract

Fork **wardumb-t3/safe-flight-booking-muse** on GitHub, then:

```bash
git clone https://github.com/<you>/safe-flight-booking-muse && cd safe-flight-booking-muse
```
```bash
rustup target add wasm32-wasip2 && cd contract && cargo test --target x86_64-unknown-linux-gnu && cargo build --release && cd ..
```

This produces `contract/target/wasm32-wasip2/release/muse_vault_flight.wasm`. Read [`contract/src/`](../contract/src/) before you deploy it: `booking.rs` (orders), `payment.rs` (`pay-hold`), `traveller.rs` (passport handling).

## 2. Register the contract (operator setup)

```bash
cd setup && npm install && cp .env.example .env
```

In `setup/.env`, **in your editor**, set:
- `T3N_API_KEY`: your operator T3N key;
- `DUFFEL_API_KEY`: your Duffel test token.

Then run, replacing the URL with your pay server's address:

```bash
npm run operator -- --pay-url https://vault.example.com
```

It prints each step, and it is safe to re-run:
- registers `z:<your tid>:muse-flight` at the version in `contract/Cargo.toml`;
- creates the private maps `secrets`, `travellers` and `orders`, readable only by the contract;
- seals the Duffel token in `secrets`;
- creates the **pay agent**, grants it `pay-hold` only, and funds it with 200 credits;
- writes `server/public/muse-vault.json`, the public config the pay server and setup page use.

**It prints the pay agent's key once.** Save it in your password manager; it goes into the pay server's environment in step 3. It also records ids in `setup/.env` (`OPERATOR_CONTRACT_ID`, `PAY_AGENT_DID`). Keep that file; it's git-ignored.

**Commit the new `server/public/muse-vault.json` to your fork.** The setup page is built from it; until you commit it, your page points at the hosted demo.

```bash
cd .. && git add server/public/muse-vault.json && git commit -m "Point at my operator" && git push
```

## 3. Deploy the pay server

On your VPS, with Node 22 and [Caddy](https://caddyserver.com/docs/install):

```bash
sudo useradd --system --no-create-home musevault 2>/dev/null; sudo git clone --depth 1 https://github.com/<you>/safe-flight-booking-muse /tmp/sfb && sudo mkdir -p /opt/muse-vault && sudo rm -rf /opt/muse-vault/server && sudo cp -r /tmp/sfb/server /opt/muse-vault/
```
```bash
sudo install -m 600 /dev/null /etc/muse-vault.env && sudo nano /etc/muse-vault.env
```

Put in:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
T3N_PAY_AGENT_KEY=t3n_key_...           # from step 2
ONBOARDING_URL=https://<your-vercel-app>  # from step 4; add it then
# Optional: STRIPE_WEBHOOK_SECRET=whsec_...  (see dashboards.md → Stripe)
# Optional: SCANNER_URL=https://<your scanner>  (default: Terminal 3's hosted scanner)
```

The server refuses live Stripe keys unless you also set `ALLOW_LIVE=1`. Don't, until you're ready to go live.

```bash
sudo cp /opt/muse-vault/server/deploy/muse-vault.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now muse-vault
```

The service listens on `127.0.0.1:3200`; check nothing else uses that port with `sudo ss -ltnp | grep ':3200 '`. For HTTPS, add the block from [`server/deploy/Caddyfile`](../server/deploy/Caddyfile) to `/etc/caddy/Caddyfile` **once**, with your hostname. Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Check it:
```bash
curl -s https://vault.example.com/muse-vault.json
```
The JSON should show **your** `contract_id`.

Logs: `journalctl -u muse-vault -f`. Each event is one JSON line.

## 4. Deploy the setup page (Vercel)

1. **Add New → Project** → import **your fork**.
2. **Root Directory:** `onboarding`. **Framework:** Vite. No environment variables are needed. The build reads `../server/public/muse-vault.json`, so keep **"Include files outside the root directory"** on (Settings → Build and Deployment).
3. Optional: set `VITE_SCANNER_URL` to your own Private Doc Scanner deployment.
4. **Deploy**, then open the URL. You should see **"Set up muse-vault"** with a QR code.

`onboarding/vercel.json` proxies `/t3/*` to the T3N testnet node, so the page only ever talks to its own origin, and sets a strict content security policy.

Then go back to the VPS: add `ONBOARDING_URL=https://<your-vercel-app>` to `/etc/muse-vault.env` and run `sudo systemctl restart muse-vault`. Now `https://vault.example.com/start` redirects to your setup page, and `/edit` to its edit mode.

## 5. Try it as a traveller

Follow [try-it.md](try-it.md), replacing the demo URLs with yours (`https://vault.example.com/muse.md` and `/start`), and use your **second** T3N account as the traveller. Muse setup details: [muse-setup.md](muse-setup.md).

## Running it

### Keeping the pay agent in credits

The pay agent pays every held order. If it runs out, the card is charged but the booking isn't confirmed yet. The pay page then says so and offers **Confirm booking again (no new charge)**, and the server logs `pay agent out of credits`. T3N can't report an agent's balance, so top it up regularly:

```bash
cd setup && npm run operator -- --pay-url https://vault.example.com --pay-credits 3000
```

Then finish any stuck payment. Pressing **Confirm booking again**, or reopening the pay link, only confirms; it never charges twice. Or on the VPS:
```bash
curl -s -X POST -H 'content-type: application/json' -d '{"payment_intent":"pi_..."}' http://127.0.0.1:3200/api/pay/complete
```

### Upgrading the contract

1. Change `contract/`, bump the version in **`Cargo.toml`, `src/lib.rs` (`CONTRACT_VERSION`) and `wit/world.wit`** (all three), then `cargo build --release`.
2. Run `npm run operator -- --pay-url … --pay-credits 0`. It registers the new version (a **new contract id**), points the maps and pay agent at it, and rewrites `muse-vault.json`.
3. Commit `muse-vault.json`, redeploy the pay server (copy and restart), and let Vercel redeploy the setup page.
4. **Existing travellers** must open `/edit` once (which re-grants their vault to the new contract id) and update `contract_version` in Muse. The guide tells Muse to do this when it sees a version error.

### Updating the guide Muse reads

[`server/public/muse.md`](../server/public/muse.md) is the connector's documentation and rules for Muse. Edit it, redeploy the pay server, and ask users to tell Muse to re-read it.

## Checklist before anyone else uses your copy

- [ ] Reviewed `contract/`, `server/`, `onboarding/`, and the [related repos](../README.md#related-repositories).
- [ ] Keys are only in password managers, `setup/.env` (local, git-ignored) and `/etc/muse-vault.env` (mode 600).
- [ ] Still on test keys (`sk_test_`, `pk_test_`, `duffel_test_`).
- [ ] `muse-vault.json` in your fork shows **your** contract.
- [ ] You know how you'll top up the pay agent, and who watches the logs.
- [ ] You've published your own terms and privacy notice, if anyone else will use it.
