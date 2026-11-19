# Dashboards: where everything lives

Five dashboards are involved. Everything stays in **test mode** until you deliberately go live.

## Terminal 3 (T3N)

**https://testnet.network.terminal3.io**: sign in with the account's email.

| You'll use it to | Where |
|---|---|
| See your agents (Muse keys named "Muse (muse-vault) <date>", and the operator's "muse-vault pay server") | **AI Agents** |
| See and remove which agents can act for you, on which contract and functions, and which hosts they can reach | **AI Agents** → an agent → its permissions; **Remove** to revoke |
| Delete an agent whose key was lost or exposed | **AI Agents** → **Remove** |

Things the dashboard doesn't show:
- **An agent's credit balance.** Travellers top up Muse's key on the setup page's edit mode (`/edit` → **Top up Muse's key**). The operator tops up the pay agent with `npm run operator … --pay-credits N`.
- **Your own balance.** The setup page shows it after you sign in.

An account can grant **at most 10 agents**. The setup page retires older muse-vault keys when it creates a new one, and **Remove my other muse-vault keys** on `/edit` cleans up by hand.

## Duffel

**https://app.duffel.com**

1. Sign up, then switch the dashboard to **Test mode** (the toggle in the top bar).
2. **Developers → Access tokens → Create token.** Copy the `duffel_test_…` token into `setup/.env` as `DUFFEL_API_KEY`. It's only used by `npm run operator`, which seals it inside the contract. It never goes on the pay server.
3. **Orders** lists every booking: held ("awaiting payment"), paid and ticketed. As the operator, you can see passenger details here, as any travel seller can.
4. Test mode has unlimited balance, so held orders are paid from it. **Duffel Airways (`ZZ`)** is Duffel's test airline and supports holds.

Optional: **Duffel Payments** (Duffel's own card form) must be enabled by Duffel support; it isn't needed here.

## Stripe

**https://dashboard.stripe.com**

1. Make sure **Test mode** is on.
2. **Developers → API keys:** copy the **Publishable key** (`pk_test_…`) and **Secret key** (`sk_test_…`) into `/etc/muse-vault.env`.
3. **Payments** lists each attempt. A decline with "your request was in test mode, but used a non test card" means someone paid with a real card: expected on testnet.
4. **Optional webhook** (lets a payment be confirmed even if the browser closes mid-checkout): **Developers → Webhooks → Add endpoint** at `https://<pay server>/api/stripe/webhook`, event `payment_intent.succeeded`. Put its signing secret in `/etc/muse-vault.env` as `STRIPE_WEBHOOK_SECRET`.

## Vercel

**https://vercel.com/dashboard**: hosts the setup page.

| Setting | Value |
|---|---|
| Repository | Your fork |
| Root Directory | `onboarding` |
| Include files outside the root directory | **On** (the build reads `server/public/muse-vault.json`) |
| Framework | Vite (`vercel.json` sets the build and output) |
| Production branch | The branch with your `muse-vault.json` (usually `main`) |
| Environment variables | None required. Optional: `VITE_SCANNER_URL` |

**Deployments** shows each build. Every push to the production branch redeploys.

## Muse

In Muse's **Settings**:

| You'll use it to | Where |
|---|---|
| See or remove the muse-vault connector and its saved key | **Connectors** |
| Review which sites and actions Muse may perform without asking | **Permissions** (including **Allowed websites**) |
| See what Muse did, and the approvals you gave | The **Activity log** (tap the assistant icon) |
| Stop Muse training on your conversations | **Data controls** → *Help improve our AI models* |

## Your pay server (VPS)

| Check | Command |
|---|---|
| Is it running? | `systemctl status muse-vault --no-pager` |
| Live logs (one JSON line per event) | `journalctl -u muse-vault -f` |
| Which contract is it serving? | `curl -s https://<pay server>/muse-vault.json` |
| Is the guide current? | `curl -s https://<pay server>/muse.md | head` |
