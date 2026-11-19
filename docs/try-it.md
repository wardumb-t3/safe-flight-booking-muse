# Try it in Muse (hosted demo)

You can try the whole flow without hosting anything, using the demo that the project maintainers run. It takes about 10 minutes.

> **Testnet demo.** Bookings are Duffel test orders and payments are Stripe test payments: no real ticket, no real charge. The demo can be reset or rate-limited at any time. Scan a passport only if you're comfortable storing it on a testnet vault; you can also use a sample passport image. See the [Disclaimer](../README.md#disclaimer).

| Demo endpoint | URL |
|---|---|
| Setup page | https://muse-vault-onboarding.vercel.app |
| Guide Muse reads | https://muse-vault-onboarding.vercel.app/muse.md |
| Edit details, top up credits | https://muse-vault-onboarding.vercel.app/?edit |

## What you need

- A **Meta Muse** account, in a country where Muse is available.
- A **phone** with a camera, for scanning the passport.
- A **Terminal 3 testnet account**. You can create it during setup at [terminal3.io/claim-page](https://www.terminal3.io/claim-page); it's free and comes with test credits. Use the same email throughout.

## 1. Start in Muse

Send Muse this message:

```
Set up a custom connector called "muse-vault" so you can book air tickets for me without ever seeing my passport.

1. Read and follow its guide: https://muse-vault-onboarding.vercel.app/muse.md
2. Send me the setup link from the guide. I'll scan my passport and sign in there, then paste back the message it gives me.
3. Create the connector from that message, and ask me for the agent key in your secure credential field, never in chat.
4. Never ask me for passport details, date of birth, phone or email in chat.
```

Muse may ask you to approve visiting `muse-vault-onboarding.vercel.app` and, later, `cn-api.sg.testnet.t3n.terminal3.io`. Approve both: they're the setup page, guide and pay page, and the T3N network.

## 2. Setup page (the link Muse sends you)

1. **Scan your passport.** Scan the QR code with your phone, or tap **Open the scanner**. Pick **Passport**, review the fields, then **Seal and send**, signing in with your Terminal 3 email. The first time, this also creates your vault (it uses about 1,100 test credits, once).
2. Back on the setup page, click **I've sealed it**, then **sign in** with the same email and the code it sends you.
3. Enter your **title** and **phone**, then click **Connect**. The page lets the flight contract read your passport vault, saves your title and phone inside the enclave, and creates a key for Muse that can only search, hold and check status. It funds that key from your credits.
4. **Copy the message** it shows and paste it into Muse. When Muse asks for the key, paste it into Muse's **secure credential field**, never in the chat. The key is shown only once.

Muse then says setup is complete and asks if you'd like to book your first flight.

## 3. Book a flight

1. Tell Muse where and when, for example: *"London to New York on 20 December."*
2. Muse shows flights that can be held, with their price and the deadline to pay. Pick one and confirm.
3. Muse holds the seat (your passport goes from the enclave to Duffel) and opens the pay page.
4. On testnet, Muse pays with **Stripe's public test card** (`4242 4242 4242 4242`) and tells you why: test mode declines real cards, including Link's. You approve the amount as for any purchase.
5. Muse checks the order. **Done** when it reports `paid` and `ticketed`, with a booking reference.

## Afterwards

- **Fix a detail** (for example the passport's sex, a renewed passport, or a new phone number): open the edit page. Muse sends you there too if a hold is refused because of your details.
- **Out of credits:** the edit page's **Top up Muse's key** adds credits to the key Muse already has. You don't need a new key.
- **Remove everything:** delete the agent in the [T3N dashboard](https://testnet.network.terminal3.io), and remove the connector in Muse.

Problems: [troubleshooting.md](troubleshooting.md).
