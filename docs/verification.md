# Verification log

Everything below ran on 2026-11-18 against real test environments: Duffel test mode, Stripe test mode, and a real Meta Muse account. No money moved.

## 1. Muse pays on a checkout page we host

The probe is in [`tools/payment-probe/`](../tools/payment-probe/), hosted on a VPS. It's a $1.00 purchase offered two ways. We asked Muse: "buy the $1.00 test item… pay with Link".

| | A. Card fields in an embedded iframe (the shape of Duffel's card form) | B. Stripe-hosted Checkout |
|---|---|---|
| Muse showed an itemised spec and asked for approval first | ✅ | ✅ |
| Muse filled the card fields inside the iframe | ✅ number, expiry, CVC and ZIP | ✅ |
| Card submitted | ✅ | ✅ |
| Result | `Declined … test mode, but used a non test card (code: test_mode_live_card)` | Same decline |
| Personal details Muse had to type into the page | None besides the card | Email, name and billing country |

What we learned:
- **Muse's Link wallet pays on a third-party page, including card fields inside an iframe.** The test-mode decline is the expected pass signal: a real Link card was filled in and submitted.
- **Link issued a new one-time card for each purchase.** Both were backed by the user's saved card.
- **A card-only page (option A) is the better pattern.** Muse doesn't have to type the traveller's email or name into it.

## 2. Held orders and settlement (Duffel and Stripe test APIs)

| Check | Result |
|---|---|
| Holdable offers on Duffel test (LHR→JFK) | 104 of 209 offers can be held, including Duffel Airways (`ZZ`) |
| Hold order with a passport, then pay it from the balance | ✅ paid, e-ticket issued |
| Pay a hold with the **wrong** amount | Refused: `payment_amount_does_not_match_order_amount` |
| Pay the same hold twice | Refused: `order_type_not_eligible_for_payment` |
| Full path: hold → `/api/pay/intent` → card (Stripe test Visa) → `/api/pay/complete` | ✅ `outcome: paid`, Duffel shows the order paid with 1 ticket |
| Repeat `/api/pay/complete` | Same result; Duffel is paid only once |
| New intent for an already-paid order | `409 this order is already paid` |
| Tampered amount: card charged $1.00 for a $217.68 hold | Duffel refused, the server refunded the $1.00 on Stripe (`refunded: true`), and the hold stayed unpaid |

The pay server never reads a Duffel order, because Duffel's order object includes the passengers. Duffel enforces the amount itself, so the server needs only the order id and the total.

## 3. The contract on T3N testnet

These ran on the hosted demo, contract `z:72ffa900…:muse-flight` 0.8.0 (id 1142), registered by `setup/operator.ts`. The operator and traveller were the same account for this run. The passport was the fictional sample from `contract/examples/traveller.json`.

| Check | Result |
|---|---|
| `save-traveller` (the traveller's own call) | `{saved: true, has_passport: true}` |
| `search-offers` as the traveller's agent | 10 offers, each with `holdable`, `payment_required_by`, airline and times |
| `hold-offer` as the agent | `status: awaiting_payment`, PNR `USDLQH`. The passport went from the enclave to Duffel, and the response has **no passenger data** |
| `order-status` | Same summary, no passenger data |
| `pay-hold` with the wrong amount (pay agent) | `{paid: false, code: payment_amount_does_not_match_order_amount}` |
| `pay-hold` with the right amount (pay agent) | `{paid: true}`; `order-status` then shows `status: paid, ticketed: true` |
| The traveller's agent calls `pay-hold` (not granted) | `403`, refused by the node |
| The traveller grants their **own** agent `pay-hold` and calls it | `400 contract error: pay-hold: only the operator's pay agent can pay held orders` |
| The agent calls `book-offer` (instant booking, not granted) | `403` |

The Duffel token now exists in one place only: the operator tenant's `secrets` map, which only the contract can read. The pay server holds a T3N key that can call `pay-hold` and nothing else.

### 0.9.0 (2026-11-19): sex as a word, correcting records

A real scan reported the passport's sex as `Female`, so every hold was refused ("sex is not M or F"). The fixes, checked live on testnet (contract id 1143):

| Check | Result |
|---|---|
| `save-traveller` with `sex: "Female"` | Saved; stored as Duffel's `f`. A scan's `Female` / `Male` is read the same way |
| `get-traveller` (the traveller's own call) | Returns their record, so the onboarding page's **edit mode** (`?edit`) can show it for correction |
| `get-traveller` from an agent, even one granted the function | `400 … only the customer can do this for themselves; an agent cannot` |
| `hold-offer` with a hand-saved passport and a bogus scan reference | `awaiting_payment`: a passport saved by hand wins over the scan |

### 0.9.1 (2026-11-19): fields corrected in the scanner are accepted

Ported from z-tenant-flight 0.7.0 (Terminal-3/z-tenant-flight PR #15). A scanned field is used if the scanner verified it **or** the traveller corrected it in the scanner's review. Only an unconfirmed OCR guess is refused. Format, expiry and owner checks still apply. Registered on testnet as contract id 1145.

## 4. Not available yet

- **Duffel Payments** (Duffel's own card form and Payment Intents) is switched off on our test account (`unavailable_feature`) and needs Duffel support to enable it. Until then, the card form is Stripe's, and the hold is paid from the Duffel balance.
- **Real (live) Link payments** need live Stripe and Duffel accounts, with Terminal 3 as the merchant of record.
