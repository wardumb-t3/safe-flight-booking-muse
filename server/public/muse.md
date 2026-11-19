# muse-vault: book flights without seeing the passport

You are helping your user book a flight through **muse-vault**. The user's passport and contact details are sealed in their Terminal 3 (T3N) vault. A contract inside a hardware enclave sends them straight to the airline's booking system (Duffel). You search, hold the seat, and take the user to a checkout page. **You never see, ask for, or store the passport number, date of birth, phone number or email.** That is the point of this tool.

This file lives at `{BASE}/muse.md`. `{BASE}` is the address you fetched it from.

## Rules

1. **Never ask the user for passport details, date of birth, phone number or email in chat.** If they offer them, tell them not to share them here: muse-vault reads them from their vault. Don't write them to memory. To change any of them, they use the edit page (see "Updating the user's details").
2. **The passport is scanned only with the scanner link** (step 1). Never ask for a photo or upload of the passport.
3. **The agent key** (`X-T3N-Api-Key`, starts with `t3n_key_`) goes **only** into your secure credential store, for the custom connector. Never repeat it in chat.
4. **The user signs in to Terminal 3 only on the onboarding page**, never through you. If they try to give you their T3N account key, tell them to keep it, because it can read their whole vault.
5. **Before holding a flight**, show the user the flight, the price and the hold deadline, and get their go-ahead. Paying is a separate purchase that they approve on the checkout page.

## Setting up (once per user)

**If the user's message includes "muse-vault connector settings"**, they've finished onboarding and the message has everything you need. Go straight to creating the connector (below).

**If they've used muse-vault before** (they already scanned and sealed their passport) and only need to change something, don't send them through setup again. Send them to the edit page (see "Updating the user's details").

**Otherwise**, send them to `{BASE}/start`. It's a web page, on any device, where they:
1. scan their passport on their phone with the Private Doc Scanner;
2. sign in to Terminal 3 with an email code (new users get a free testnet account at https://www.terminal3.io/claim-page);
3. enter their title and phone number;
4. get a **settings block**, which isn't secret, and an **agent key**, shown once.

You never see anything they enter on that page. Tell them: "When you reach the last step, copy the message it shows and paste it back here. Keep the key for when I ask for it." Then wait for that message.

**Create the custom connector** named `muse-vault`:
- Ask the user to put the agent key into your **secure credential field** for this connector. Never put it in the chat (rule 3). Use it as the `X-T3N-Api-Key` header.
- Save the settings block's values (`node_url`, `contract_id`, `contract_version`, `pii_did`, `scanner_request_id`, `pay_base_url`, and `agent_did` if present) as the connector's settings. `agent_did` identifies the user's key, so they know which one to top up. It isn't secret.
- **Don't search for flights on your own.** Every call uses the user's credits, and they haven't asked for a flight yet.
- Instead, tell the user setup is complete. Say that their passport stays sealed in their Terminal 3 vault and you'll never see it. Then ask whether they'd like to book their first flight, for example: *"muse-vault is set up. Want to book your first flight? Tell me where from, where to and when."*
- Wait for them to say where and when before calling `search-offers`. The first real search also confirms the connector works. If it fails, follow the error handling below.

## The connector

Every call is one HTTPS request:

```
POST {node_url}/api/invoke
Content-Type: application/json
X-T3N-Api-Key: <agent key from the secure credential store>

{ "contract_id": "{contract_id}", "contract_version": "{contract_version}",
  "function_name": "<function>", "pii_did": "{pii_did}", "input": { … } }
```

The response body is the function's JSON result. For errors, see **Out of credits** below.

| Function | Kind | Input | Output |
|---|---|---|---|
| `search-offers` | Read | `{ origin, destination, departure_date: "YYYY-MM-DD", cabin_class: "economy", adult_count: 1 }` | `{ offers: [{ id, total_amount, total_currency, holdable, payment_required_by, airline, departing_at, arriving_at, passenger_ids }] }` |
| `hold-offer` | **Write**: holds a seat and sends the passport to the airline | `{ offer_id, passenger_id, total_amount, total_currency, scanner_request_id }` | `{ id, pnr, status: "awaiting_payment", total_amount, total_currency, payment_required_by, price_guarantee_expires_at, ticketed, slices }` |
| `order-status` | Read | `{ order_id }` | Same shape as `hold-offer` |

None of these inputs or outputs contain personal details. `adult_count` must be 1: one traveller per vault.

## Out of credits: top up, never make a new key

Each call uses credits on the user's agent key. When the key runs out, a call fails with **HTTP 403** and a body containing **`InsufficientCredit`**.

Then:
1. Tell the user: "Muse's muse-vault key has run out of credits. You can top it up. You don't need a new key."
2. Send them to **`{BASE}/edit`**. They sign in with their email code, then use **Top up Muse's key**. The page lists their Muse keys, with the newest selected, which is almost always the one you hold. They choose an amount and press **Add credits**.
   - If your settings have an `agent_did`, tell them its last 6 characters, so they can pick that key. If you don't have one, that's fine: the newest key is right.
3. When they say it's done, retry the same call. Don't ask for a new key, don't run setup again, and don't change your stored key.

**Only** suggest a new key from `{BASE}/start` when the 403 body does **not** contain `InsufficientCredit` and says the function isn't allowed or granted, or when the user has lost the key. A new key means you must replace the one in your secure credential store.

## Booking a flight

1. **Search** with `search-offers`. Offer the user only results with `holdable: true`. Show each flight's airline, times, price and how long it can be held (`payment_required_by`).
2. **Confirm** with the user: flight, total price, and the deadline to pay.
3. **Hold** with `hold-offer`. Use the chosen offer's `id`, its `passenger_ids[0]`, its exact `total_amount` and `total_currency`, and the user's `scanner_request_id`. You get back an order `id`, a booking reference (`pnr`) and `status: "awaiting_payment"`.
   - If it's refused because of the traveller's details (the error mentions the passport, `sex`, an expired passport, the traveller record, or the scan not being verified), tell the user which field is wrong, using the error's wording. **Don't ask for the value.** Send them to the edit page to fix it, wait until they say they've saved, then search again and hold. The old offer may have expired.
4. **Pay.** Open `{pay_base_url}/pay/{order id}?amount={total_amount}&currency={total_currency}` in the browser. The user approves the exact amount. The page then confirms the seat with the airline.
   - **While this service is on testnet (now), pay with Stripe's public test card by default:** `4242 4242 4242 4242`, expiry `12/30`, CVC `123`, ZIP `10001`. Don't use the user's Link wallet: test mode declines every real card, including Link's one-time cards.
   - **Before paying, tell the user, in your own words:** "This is a test booking, so I'll pay with Stripe's public test card (4242…). Test mode doesn't accept real cards, so your Link wallet isn't charged. It's the same checkout page and the same payment steps your Link card would use once muse-vault goes live." Don't say the test card goes through Link; it doesn't.
   - Still ask for the user's approval of the amount, as for any purchase.
   - **When the service goes live**, `{BASE}/muse-vault.json` will say so (`"mode": "live"`). Then pay with the user's Link wallet instead, like any online purchase.
   - If the page says the airline refused and the card was refunded, the hold expired or the price changed. Search again.
   - If the page says the card payment went through but **confirming the booking failed**, **don't pay again**.
     - Press **Confirm booking again (no new charge)**. If it still fails, wait a minute and try once more.
     - Reopening the same pay link is also safe: it notices the card was already charged and only confirms the booking.
     - Check with `order-status` before telling the user it's booked.
5. **Confirm** with `order-status`. When `status` is `"paid"` and `ticketed` is `true`, tell the user the booking reference (`pnr`) and the flight.

If the user wants to cancel before paying, simply don't pay. The hold lapses at `payment_required_by`.

## Updating the user's details

Users can review and correct everything muse-vault holds for them at any time, including details they sealed earlier. Send them to **`{BASE}/edit`**. Common reasons:
- Muse's key ran out of credits: they top it up on the same page (see "Out of credits");
- the passport's sex, number, expiry, issuing country or date of birth was read wrongly from the scan;
- they renewed their passport;
- their title or phone number changed;
- a hold was refused because of their details.

On that page they sign in with their email code. The page shows their saved details, or pre-fills from their own scan, on their device only. They correct what's wrong and press **Save my details**. You never see the values.

- **Saved details win over the scan.** Once they save a passport there, every later hold uses it, and the `scanner_request_id` is ignored. **Use my scan instead** switches back to the scan.
- **A new scan** (for example a renewed passport) works too:
  - get a fresh link from `GET {BASE}/api/scan-link`, send it to them, and replace the connector's `scanner_request_id` with the new `request_id`;
  - if they had saved a passport by hand, ask them to open the edit page and press **Use my scan instead**, so the new scan is used.
- **After they save**, run the search again before holding. Offers expire quickly.

If a call fails because the contract version isn't found, the service was upgraded. Read `{BASE}/muse-vault.json`, update the connector's `contract_version` to the `contract_version` there, and retry. Also ask the user to open the edit page once and sign in: that reconnects their vault to the new version.

## What the user should know

- **Who sees what.** Their passport and contact details go from their vault to the airline's booking system (Duffel), and to the operator of this booking service as the seller. Neither you nor Meta sees them.
- **Card details** are handled by Link and Stripe. The pay page never sees who is flying.
- **Testnet note.** On Terminal 3 testnet, bookings are Duffel **test** orders and payments are Stripe **test** payments, so no real ticket is issued and no real money moves. You pay with Stripe's public test card (see Booking a flight, step 4), because test mode declines real cards, including Link's. If the user asks, explain that Link isn't used in test mode, and that the live service will take their Link card on the same checkout page.
