# Safe Flight Booking for Muse

**Let Meta's Muse book your flight without ever seeing your passport.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue) ![network: T3N testnet](https://img.shields.io/badge/T3N-testnet-0f6e63) ![payments: test mode](https://img.shields.io/badge/payments-test%20mode-555) ![status: reference implementation](https://img.shields.io/badge/status-reference-orange)

Muse is Meta's personal AI agent. It can search flights, book them and pay. To book a flight today it has to handle your passport details in plain text, inside a VM that Meta says it can access "when necessary to support, secure or operate the service". By default those details also become part of the interactions Muse trains on.

This open-source **Muse custom connector** (`muse-vault`) keeps that data away from Muse:

- Your passport is scanned on **your phone** and sealed to **your own [Terminal 3 (T3N)](https://www.terminal3.io) vault**.
- A contract running inside a **hardware enclave** fills in your passport, date of birth, phone and email, and sends them **straight to the airline's booking system** ([Duffel](https://duffel.com)).
- Muse only ever handles flight offers, a booking reference and a checkout link. You approve the payment like any Muse purchase.

```
You ── scan passport (phone) ──▶ Private Doc Scanner ──sealed──▶ your T3N vault
Muse ── search / hold / status ──▶ T3N enclave: flight contract ──passport, DOB, phone, email──▶ Duffel ──▶ airline
  │        (agent key; no personal data in or out)
  └── opens pay page, pays ──▶ pay server ── pay-hold ──▶ contract ──▶ Duffel   (pay server sees no passenger data)
```

> **Open-source reference software, running on testnet.** Bookings are Duffel **test** orders and payments are Stripe **test** payments, so no real tickets are issued and no real money moves. Read the code before you rely on it; see the [Disclaimer](#disclaimer).

## Choose your path

| I want to… | Start here |
|---|---|
| **Try it in Muse now**, on the hosted demo | [docs/try-it.md](docs/try-it.md) (about 10 minutes, no code) |
| **Get a Terminal 3 account and keys** | [docs/t3n-quickstart.md](docs/t3n-quickstart.md) |
| **Host my own copy** (contract, pay server, setup page) | [docs/self-host.md](docs/self-host.md) |
| **Set up Muse** (connector, key, approvals, test card) | [docs/muse-setup.md](docs/muse-setup.md) |
| **Find my way around the dashboards** (T3N, Duffel, Stripe, Vercel, Muse) | [docs/dashboards.md](docs/dashboards.md) |
| **Understand how it works**, and who sees what | [docs/architecture.md](docs/architecture.md) |
| **Fix an error** | [docs/troubleshooting.md](docs/troubleshooting.md) |
| **See what's been tested** | [docs/verification.md](docs/verification.md) |

## Who sees what

| | Passport, date of birth, phone, email | Card |
|---|---|---|
| **Muse / Meta** | **Never** | On testnet, Stripe's public test card. Live: Link's one-time card, as with any Muse purchase |
| T3N enclave (contract code) | Inside the enclave only | — |
| Duffel and the airline | Yes, as needed to issue the ticket | — |
| The operator (whoever hosts this, as seller of record) | Can see orders in its Duffel dashboard, as any travel seller can | — |
| Pay server | No (it never reads an order) | Stripe's card iframe takes the card; the server sees only the payment result |
| Other travellers | No | No |

Details, and the limits of these guarantees: [docs/architecture.md](docs/architecture.md).

## What's in this repo

| Path | What it is |
|---|---|
| [`contract/`](contract/) | The T3N flight contract (Rust → WASM): `search-offers`, `hold-offer`, `order-status`, `pay-hold`, plus the traveller's `save-traveller`, `get-traveller` and `forget-traveller`. Forked from [Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight) (MIT). |
| [`server/`](server/) | Pay server (Node, no dependencies): the checkout page `/pay/<order>`, settling a hold after payment, `/start` and `/edit` redirects, `/api/scan-link`, and **`/muse.md`, the guide Muse follows**. |
| [`onboarding/`](onboarding/) | The traveller's setup page (Vite, for Vercel): passport scan, T3N sign-in, vault grant, Muse's agent key, edit details, top up credits. Runs entirely in the traveller's browser. |
| [`setup/`](setup/) | One-time scripts: `operator` (host the contract, create the pay agent) and `traveller` (a terminal alternative to the setup page). |
| [`examples/`](examples/) | A fictional [sample passport](examples/sample-passport.png) (stamped SPECIMEN) for testing without your own. |
| [`tools/payment-probe/`](tools/payment-probe/) | A small page that checks Muse can pay on a checkout page you host. |
| [`docs/`](docs/) | The guides linked above. |

## Related repositories

This connector is built from these Terminal 3 open-source projects. Read them too: they do much of the privacy-critical work.

| Repo | Role here |
|---|---|
| [Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight) | The original T3N flight-booking contract (Duffel, placeholders, traveller records, scanner passports). `contract/` is a fork that adds hold-then-pay, `order-status`, `pay-hold`, `get-traveller` and a hosted (multi-traveller) mode. |
| [Terminal-3/private-doc-scanner](https://github.com/Terminal-3/private-doc-scanner) | Reads the passport **on the traveller's phone**, checks its machine-readable zone, and seals the reviewed fields to the traveller's own vault. The setup page links to Terminal 3's hosted copy, or to yours. |
| [Terminal 3 ADK docs](https://docs.terminal3.io/developers/adk/get-started/quickstart) | T3N accounts, the SDK, tenant contracts, delegation, `http-with-placeholders`. |
| [`@terminal3/t3n-sdk`](https://www.npmjs.com/package/@terminal3/t3n-sdk) | The SDK the setup page and scripts use. |

## Status and limits

- **Testnet only.** T3N testnet, Duffel test mode, Stripe test mode. Going live needs live Duffel and Stripe accounts with you as the merchant of record, and the legal and licensing review that selling air travel requires.
- **One traveller per vault**, adult fares, one-way searches.
- **Passports with unspecified sex can't be booked**, because Duffel only accepts M or F.
- **Credits.** Every call uses T3N test credits. Travellers top up Muse's key on the setup page; the operator tops up the pay agent. See [docs/self-host.md](docs/self-host.md#keeping-the-pay-agent-in-credits).
- **Muse custom connectors are unreviewed by Meta.** Muse learns how to use this one from [`server/public/muse.md`](server/public/muse.md).

## Disclaimer

Safe Flight Booking for Muse is open-source reference software. It is provided "as is", without warranties or conditions of any kind, as set out in the [MIT licence](LICENSE).

- **You are responsible for your use of it.** Before you use it with real passports, real payments or in production, review, test and, where appropriate, independently audit the code, its dependencies (including [z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight), [private-doc-scanner](https://github.com/Terminal-3/private-doc-scanner) and the T3N SDK) and your deployment, to make sure they are safe and suitable for your purposes.
- **It runs on test infrastructure.** The hosted demo and the default configuration use T3N testnet and Duffel and Stripe test modes. Test environments can be reset, rate-limited or changed without notice. Don't rely on them for real travel.
- **Results can be wrong.** Passport scanning, validation and booking can fail or produce incorrect results. Always check the details shown before you approve a booking or payment.
- **Your deployment, your obligations.** Whoever hosts or runs this, including anyone who forks it, is responsible for its configuration, for keeping keys and secrets safe (T3N keys, agent keys, Duffel and Stripe keys), for funding and operating it, and for complying with the data-protection, consumer, payments, travel-selling and other laws that apply to them and their users. Nothing in this repository is legal, compliance, financial or security advice.
- **Third-party services have their own terms.** Meta Muse, Terminal 3, Duffel, Stripe and the airlines are governed by their own terms and privacy policies. This project isn't affiliated with or endorsed by Meta.
- **Fork it and make it your own.** You may use, modify and redistribute the code under the licence. Changes you make, and the copies you run, are yours to maintain and secure.

The authors and contributors are not liable for any loss or damage arising from the use of this software, to the extent permitted by applicable law. Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE). `contract/` is derived from [Terminal-3/z-tenant-flight](https://github.com/Terminal-3/z-tenant-flight) (MIT). Dependencies are permissively licensed: `@terminal3/t3n-sdk` (MIT), `wit-bindgen`, `serde`, `serde_json`, `hex` (MIT/Apache-2.0), Vite (MIT), `qrcode` (MIT).
