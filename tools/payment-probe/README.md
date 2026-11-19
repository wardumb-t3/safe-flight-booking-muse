# Payment probe

A standalone check that Muse can pay on a checkout page you host. It isn't needed to run safe-flight-booking-muse; it's here so you can repeat the test. Results: [docs/verification.md](../../docs/verification.md).

This page checks one thing: can Muse pay on a checkout page we host? It sells a **$1.00 test-mode** item in two ways:

- **A. Card form on our page.** Stripe's card fields load in an embedded iframe. That's the same setup Duffel's card form uses, so it shows whether Muse can fill the card form on a hosted airline checkout.
- **B. Stripe Checkout.** Stripe's own hosted page, with card and Link turned on.

The keys are Stripe **test** keys, so no real money can move. Muse's Link wallet issues a real one-time card, and test mode **declines** real cards with a "test mode" message. A decline like that is a **pass**: it proves Muse filled in the card and submitted it.

## Deploy on a VPS

You need Node.js 20 or newer, Caddy for HTTPS, and a hostname whose DNS points at the VPS (for example `probe.yourdomain.com`). Muse needs a public `https://` URL. `server.mjs` serves the page and runs the same `api/` handlers as Vercel, with no npm dependencies.

```bash
# 1. Code
sudo useradd --system --no-create-home probe
sudo git clone --depth 1 https://github.com/wardumb-t3/safe-flight-booking-muse /tmp/sfb
sudo cp -r /tmp/sfb/tools/payment-probe /opt/payment-probe

# 2. Keys (test keys only; the server refuses live keys). Edit the file in your
#    editor so the keys never land in shell history.
sudo install -m 600 /dev/null /etc/payment-probe.env
sudo nano /etc/payment-probe.env
#   STRIPE_SECRET_KEY=sk_test_...
#   STRIPE_PUBLISHABLE_KEY=pk_test_...

# 3. Service (listens on 127.0.0.1:3000)
sudo cp /opt/payment-probe/deploy/payment-probe.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now payment-probe

# 4. HTTPS: put deploy/Caddyfile's block in /etc/caddy/Caddyfile with your hostname
sudo systemctl reload caddy
```

Logs: `journalctl -u payment-probe -f`. Each step prints one JSON line (see "Read the results" below).

To try it without systemd: `cd /opt/payment-probe && STRIPE_SECRET_KEY=… STRIPE_PUBLISHABLE_KEY=… node server.mjs`.

## Deploy (Vercel)

1. Create a new Vercel project and set its root directory to `tools/payment-probe`. Use the "Other" framework preset with no build command; `vercel.json` sets the output to `public/`.
2. Add these environment variables (Production):
   - `STRIPE_SECRET_KEY`: your `sk_test_…` key
   - `STRIPE_PUBLISHABLE_KEY`: your `pk_test_…` key

   Both functions refuse to run with live keys.
3. Deploy, then open the URL in your own browser once to check the card field appears.

## Run it in Muse

Send Muse this message (swap in your URL):

> Please buy the $1.00 test item at https://YOUR-APP.vercel.app using option A ("Pay on this page"). Pay with Link. Then go back and buy it again with option B ("Go to checkout"). Tell me exactly what happened at each step and what message the page showed.

Note what Muse does at each point:
- Does Muse ask you to approve visiting the site, or approve the purchase? Note what each prompt said.
- **Option A:** do you see "Declined: … test mode …" (pass: card filled and submitted), a form error, or does Muse say it can't fill the field (fail: iframe)?
- **Option B:** does Muse reach Stripe's page, fill the card, and submit?

## Read the results

On a VPS, run `journalctl -u payment-probe`. On Vercel, open the project's **Logs**. Each step writes one JSON line:

| Event | Meaning |
|---|---|
| `page_loaded` | Muse opened the page |
| `card_form_ready` | The card iframe loaded |
| `card_field_focused` | Something focused the card field |
| `card_complete` | The card field held a complete card number, expiry and CVC (only the brand is logged) |
| `pay_clicked` | The pay button was pressed |
| `result` | What Stripe returned: a status, plus `code` and `decline_code` on an error |
| `checkout_clicked` / `checkout_created` | Option B started |

The Stripe dashboard (test mode), under **Payments**, also shows each attempt and why it was declined. No card data reaches our code: the card fields belong to Stripe's iframe, and the logs record only the brand and Stripe's result codes.
