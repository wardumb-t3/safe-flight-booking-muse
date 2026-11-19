# How it works

## The pieces

```
                      ┌──────────────── traveller's phone ────────────────┐
                      │ Private Doc Scanner: reads passport on device,     │
                      │ checks MRZ, traveller reviews, seals to own vault  │
                      └───────────────────────┬────────────────────────────┘
                                              ▼ (encrypted to the enclave)
┌──────────── T3N enclave (Intel TDX) ────────────────────────────────────────────┐
│ traveller's tenant:  z:<traveller>:intake   (scanned passport)                   │
│ operator's tenant:   z:<operator>:muse-flight  ── maps: secrets (Duffel token,   │
│                        flight contract            pay agent DID), travellers,     │
│                                                   orders                          │
└───────────▲──────────────────────────────▲─────────────────────────┬─────────────┘
            │ search / hold / status        │ pay-hold                │ HTTPS, passport filled
            │ (Muse's agent key)            │ (pay agent key)         ▼ in by the enclave
        ┌───┴───┐  opens pay page    ┌──────┴──────┐  card in     ┌────────┐
        │ Muse  │ ─────────────────▶ │ pay server  │◀─ Stripe ──  │ Duffel │──▶ airline
        └───────┘                    │ (/pay, /muse.md, /start)   └────────┘
                                     └─────────────┘
```

## A booking, step by step

1. **Search.** Muse calls `search-offers`. The contract queries Duffel; no personal data is involved. It returns offers marked `holdable`, with airline, times and price.
2. **Hold.** Muse calls `hold-offer` with the offer id, the passenger id and the traveller's scan reference. Inside the enclave the contract:
   - reads the traveller's record (title, phone) from `travellers`;
   - reads the passport, either a passport saved by hand or the **scan** from the traveller's own vault (`z:<traveller>:intake`, readable thanks to the traveller's cross-tenant grant);
   - fills name and email through `{{profile.*}}` placeholders, so even the contract code never holds them;
   - sends a Duffel **hold** order.

   Muse gets back only `{ id, pnr, status, total, payment_required_by, slices }`, never passenger data.
3. **Pay.** Muse opens `/pay/<order>`. The card is taken by Stripe's iframe. After it succeeds, the pay server calls the contract's `pay-hold` with its **pay agent** key, and the contract pays the hold from the operator's Duffel balance. Duffel itself checks the amount equals the order total. If Duffel refuses, the card is refunded.
4. **Confirm.** Muse calls `order-status`, which reports `paid` and `ticketed`.

## Who holds which key

| Key | Held by | Can do |
|---|---|---|
| Operator T3N key | The operator, offline | Everything in the operator's tenant, including reading its maps. **Never put it on a server.** |
| Duffel test token | Sealed in the contract's `secrets` map | Read and pay any order on the operator's Duffel account |
| Pay agent key | The pay server (`/etc/muse-vault.env`) | Call `pay-hold` only, and the contract checks it is exactly this agent |
| Traveller T3N key | The traveller (via email sign-in) | Their own vault and record. Never given to Muse |
| Muse's agent key | Muse's secure credential store | `search-offers`, `hold-offer` and `order-status`, for this traveller only, with traffic only to `api.duffel.com` |
| Stripe test keys | The pay server | Create and refund payments |

## Guarantees, and their limits

- **Muse never receives passenger data** from this connector: inputs and outputs carry none. Unit tests check that order summaries strip every passenger field, and `get-traveller` refuses agents even when granted.
- **The pay server never reads an order.** Duffel's order object includes passengers, so the server pays with only the order id and total.
- **Traveller records are readable by the operator.** The operator owns the tenant that stores titles, phone numbers and any hand-saved passports, and, as the seller, can see Duffel orders. The guarantee is "not Muse, not Meta", not "nobody". Travellers' **scanned** passports stay in their own vault; the operator's contract reads them inside the enclave, at booking time.
- **Muse sees the card it pays with**, as with any Muse purchase. Card handling is Muse's and Stripe's.
- **Enclave trust:** the SDK verifies the node's Intel TDX attestation before trusting it. See Terminal 3's documentation for what that does and doesn't guarantee.

## Related repositories

- **[Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight).** The original contract. This fork adds:
  - `hold-offer`, `order-status` and `pay-hold`;
  - `get-traveller`, and hand-saved passports taking priority over scans;
  - sex read as M/F or male/female, and scanner fields the traveller corrected being accepted (both also contributed upstream in z-tenant-flight 0.7.0);
  - hosted mode: one operator contract serving many travellers, reading each traveller's own vault.
- **[Terminal-3/private-doc-scanner](https://github.com/Terminal-3/private-doc-scanner).** The passport scanner, and its privacy model ([docs/privacy-model.md](https://github.com/Terminal-3/private-doc-scanner/blob/main/docs/privacy-model.md)).
- **[Terminal 3 ADK docs](https://docs.terminal3.io/developers/adk/get-started/quickstart).** Tenants, maps, delegation, placeholders and agents.
