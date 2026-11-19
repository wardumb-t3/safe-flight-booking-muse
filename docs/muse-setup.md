# Setting up Muse

muse-vault is a Muse **custom connector**. Meta's help centre describes custom connectors like this: you ask Muse to create one, and "Muse will guide you through the process, which can involve retrieving API information from the service". Meta doesn't review custom connectors, so Muse learns everything about this one from a guide your pay server publishes: **`https://<your pay server>/muse.md`** ([source](../server/public/muse.md)).

That guide tells Muse:
- the rules: never ask for passport details in chat; the key goes only in the secure credential field;
- how to send the user to the setup page and build the connector from the message the user pastes back;
- the API: one `POST /api/invoke` call per function, with the agent key in the `X-T3N-Api-Key` header;
- how to book: search, confirm, hold, pay on the checkout page, check status;
- what to do on errors: out of credits (top up), details refused (edit page), version changes, failed payment confirmation.

## The starting message

Users start with this message, using your pay server's address:

```
Set up a custom connector called "muse-vault" so you can book air tickets for me without ever seeing my passport.

1. Read and follow its guide: https://<your pay server>/muse.md
2. Send me the setup link from the guide. I'll scan my passport and sign in there, then paste back the message it gives me.
3. Create the connector from that message, and ask me for the agent key in your secure credential field, never in chat.
4. Never ask me for passport details, date of birth, phone or email in chat.
```

Or they start on the setup page (`/start`), then paste its final message into Muse. That message already contains the guide link, and Muse picks up from there.

## What the user does in Muse

1. **Approve new sites.** Muse may ask before visiting your pay server and `cn-api.sg.testnet.t3n.terminal3.io` (the T3N network). Both are needed.
2. **Paste the setup page's final message.** It contains the non-secret settings: `node_url`, `contract_id`, `contract_version`, `pii_did`, `scanner_request_id`, `pay_base_url`, `agent_did`.
3. **Give the key through Muse's secure credential field**, never in chat. Muse's own security design keeps connector credentials in its credential store and gives the model only a stand-in token.
4. Muse confirms setup is complete and asks whether to book a first flight. It doesn't search until the user asks.

## Booking, and the test card

- Muse offers only flights that can be **held**, holds the chosen one, and opens `https://<pay server>/pay/<order>?amount=…&currency=…`.
- **On testnet it pays with Stripe's public test card** (`4242 4242 4242 4242`) and tells the user why: test mode declines every real card, including Link's one-time cards. The checkout page and payment steps are the same ones a Link card uses once live, but **the test card doesn't go through Link**.
- When you go live, add `"mode": "live"` to `muse-vault.json`; the guide tells Muse to use the user's Link wallet then.

We tested that Muse can fill card fields inside an embedded iframe on a page you host, with a real Link card. Test mode declined it as expected, which shows the card was filled in and submitted. See [verification.md](verification.md#1-muse-pays-on-a-checkout-page-we-host).

## Keeping Muse up to date

Muse may keep its own copy of the guide. After you change `muse.md`, or upgrade the contract, ask users to tell Muse:

> Fetch https://<your pay server>/muse.md again and replace any saved muse-vault instructions with it.

After a contract upgrade, they also tell Muse the new `contract_version` (from `/muse-vault.json`) and open `/edit` once.

## Removing it

- In Muse, remove the connector and its saved credential.
- In the [T3N dashboard](https://testnet.network.terminal3.io), delete the "Muse (muse-vault) …" agent, so its key stops working.
