# Troubleshooting

Every problem below was hit during testing. Find the message you see.

## Setup page

| Message | Cause | Fix |
|---|---|---|
| `InsufficientCredit (account=…, required=…, available=0)` | That T3N account has no credits left. `required` is the minimum balance to start a call, not a charge. | Ask for more test credits in the [Terminal 3 developer Telegram group](https://t.me/terminal3developer), then retry. Muse's key shows as soon as it's created, so a failed top-up doesn't lose it; use **Add credits**. |
| "Your account has reached Terminal 3's limit of 10 delegates" | An account can grant at most 10 agents. | **Connect** retires earlier muse-vault keys automatically. If the remaining slots belong to other apps, remove one in the T3N dashboard. |
| "Your vault doesn't have this passport scan yet" | The scan wasn't sealed under this email, or this browser has a different scan reference. | Finish **Seal and send** in the scanner, with the same email. On a new device, use **Review or correct your travel details** to check your saved passport. |
| Sign-in hangs or fails at "Checking the Terminal 3 enclave" | The `/t3` relay can't reach testnet. | Check `onboarding/vercel.json`'s rewrite, and that testnet is up. |

## Holding a flight

| Error from `hold-offer` | Cause | Fix |
|---|---|---|
| `scanned passport sex is not M or F` | The passport's sex is unspecified (`<` / `X`). Duffel accepts only M or F. | It can't be booked through Duffel. (Contract versions before 0.9.0 also refused `Female` / `Male`; upgrade.) |
| `scanned passport <field> was not verified by the scanner or confirmed by you` | The scanner couldn't verify that field, and it wasn't corrected during review. | Rescan in good light, correct the field in the scanner's review step, or save the passport on `/edit`. |
| `the passport has expired` | The expiry date is in the past. | Save the renewed passport on `/edit`, or rescan. |
| `no traveller record for this customer` | Setup didn't finish **Connect**. | Run setup again, or save details on `/edit`. |
| `user profile missing field: first_name` | The traveller's T3N profile has no name. | Set the name in the T3N profile, then retry. |
| `egress denied for host api.duffel.com` | Muse's key wasn't granted `api.duffel.com`. | Create a fresh key with **Connect**. |
| HTTP **403** containing `InsufficientCredit` | Muse's key is out of credits. | `/edit` → **Top up Muse's key**. No new key needed. |
| HTTP 403 without `InsufficientCredit` | The key isn't granted that function, or was removed. | Create a fresh key with **Connect** and replace it in Muse. |
| A contract-version error | The contract was upgraded. | Read `/muse-vault.json`, update `contract_version` in Muse, and open `/edit` once. |

## Paying

| What you see | Cause | Fix |
|---|---|---|
| "Card declined: … test mode, but used a non test card" | A real card, including Link's, on test mode. | Pay with `4242 4242 4242 4242`. Muse does this by default on testnet. |
| "The card payment went through, but confirming the seat … failed" | Usually the **pay agent is out of credits** (logged as `pay agent out of credits`). | Operator: `npm run operator -- --pay-url … --pay-credits 3000`. Then press **Confirm booking again (no new charge)**, or reopen the pay link. Neither charges twice. |
| "The airline did not accept the payment … your card was refunded" | The hold expired, or the price changed. | Search again and hold a new offer. |
| "This order is already paid" | It is. | Ask Muse for `order-status`. |

## Pay server

| Symptom | Check |
|---|---|
| `/start` returns "Onboarding is not configured" | `ONBOARDING_URL=https://…` missing from `/etc/muse-vault.env`. Restart after adding it. |
| `/muse-vault.json` shows the demo's contract | You haven't run `npm run operator` and committed the new `server/public/muse-vault.json`, or the server copy is stale. |
| Caddy: `ambiguous site definition` | The site block was added twice. Keep one, then `caddy validate` and reload. |
| The service exits on start | `journalctl -u muse-vault -n 30`: usually a missing or live-mode key. |

## Still stuck?

Ask in the official **[Terminal 3 developer Telegram group](https://t.me/terminal3developer)** for test credits or help with T3N. For problems with this connector, open an issue on this repo. Report security issues privately ([SECURITY.md](../SECURITY.md)).
