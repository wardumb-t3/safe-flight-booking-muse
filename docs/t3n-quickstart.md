# Terminal 3 (T3N) quickstart for builders

Hosting your own copy needs a T3N testnet account for the **operator** (you), and ideally a second one for testing as a **traveller**. This page gets you from zero to a working key in about 10 minutes. The full official guide is the [Terminal 3 ADK quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart).

## Concepts you'll meet

| Term | What it is here |
|---|---|
| **T3N account (DID)** | Your identity on Terminal 3, `did:t3n:<40 hex>`. Its **key** is an Ethereum-style private key that signs everything you do. Keep it like a root password. |
| **Tenant** | Your own namespace on T3N, where your contracts and their private maps live. Every account has one. |
| **Tenant contract** | WASM code you register in your tenant, e.g. `z:<your tid>:muse-flight`. It runs inside the enclave. |
| **Map** | Private key-value storage for a contract (`secrets`, `travellers`, `orders`). Only the contracts you list can read it, and so can you as the owner. |
| **Organisation and agent** | An agent is a separate identity with an **API key** (`t3n_key_…`). It can call only the functions it's been **granted**, for only the users who granted it. Muse gets one; the pay server gets one. |
| **Delegation (grant)** | A user lets an agent call specific contract functions on their behalf, optionally only to specific hosts. An account can grant at most 10 agents. |
| **Placeholders** | `{{profile.first_name}}` and similar in an outbound request. The enclave fills them from the user's profile just before the request leaves, so the contract code never sees the values. |
| **Credits** | Test credits that pay for calls. Agents pay for their own calls; you fund them from your balance. |

## 1. Create an account

1. Go to **[terminal3.io/claim-page](https://www.terminal3.io/claim-page)** and sign up with your email.
2. You get a **`did:t3n:…`**, a **T3N key** (shown once) and **test credits**.
3. **Save the key in a password manager straight away.** Never paste it into a chat, an AI assistant, a commit or a log.

For testing, create a **second account with a different email** to play the traveller. That way you test the cross-account parts (a traveller's vault read by your contract) the way real users will.

## 2. Check you can reach testnet

| Endpoint | Purpose |
|---|---|
| `https://cn-api.sg.testnet.t3n.terminal3.io` | The T3N testnet node (API) |
| `https://testnet.network.terminal3.io` | The T3N dashboard (agents, delegations) |

If you build in a sandboxed environment, such as a cloud coding agent, allow `cn-api.sg.testnet.t3n.terminal3.io` in its network settings.

## 3. Install the toolchain

| Tool | Why |
|---|---|
| **Node.js 22+** | Setup scripts, pay server, setup page |
| **Rust** with `rustup target add wasm32-wasip2` | To build the contract |

```bash
git clone https://github.com/wardumb-t3/safe-flight-booking-muse
```
```bash
cd safe-flight-booking-muse/setup && npm install && cp .env.example .env
```

Open `setup/.env` **in your editor** and put your operator key after `T3N_API_KEY=`.

## 4. Check the key works

```bash
npx tsx --env-file-if-exists=.env -e 'import("./common.ts").then(async ({ signIn }) => { const { t3n, did } = await signIn(); console.log(did, (await t3n.getBalance()).available / 1e6, "credits"); })'
```

You should see your `did:t3n:…` and your credit balance. It signs in through an attested handshake: the SDK checks the enclave's TDX attestation before trusting the node.

## Credits: how much you'll use

| Action | Who pays | Roughly |
|---|---|---|
| Register the contract (operator, once per version) | Operator | ~1,000 |
| Traveller's first passport scan (creates their vault) | Traveller | ~1,100 |
| A search plus a hold | The traveller's Muse agent | ~100 |
| Paying a hold | The operator's pay agent | ~100 |

When your balance runs low on testnet, ask for more test credits in the **[Terminal 3 developer Telegram group](https://t.me/terminal3developer)**; that's also the place for help from the Terminal 3 team. You can't transfer credits between accounts yourself.

Next: **[self-host.md](self-host.md)**.
