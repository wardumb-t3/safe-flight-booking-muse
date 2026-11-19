# Sample passport (fictional)

[`sample-passport.png`](sample-passport.png) is a **made-up passport for testing**. It isn't a real document and doesn't belong to a real person, and it's stamped **SPECIMEN** in the photo box. Use it to try the flow without scanning your own passport.

| Field | Value |
|---|---|
| Name | SCHMIDT, INGRID |
| Nationality / issuing country | PRT |
| Passport number | IP7769378 |
| Date of birth | 1965-12-15 |
| Sex | F |
| Expiry | 2033-04-08 |

All of its machine-readable zone (MRZ) check digits are valid: document number, date of birth, expiry and the composite. So the Private Doc Scanner can verify it. The scanner's parser reports sex as `female`, which the contract maps to Duffel's `f`.

## How to use it

1. Open this image on a computer screen, or print it.
2. Open the scanner link from the setup page **on your phone**, pick **Passport**, and scan the image. You can also save the image to the phone and upload it in the scanner.
3. Review the fields and **Seal and send** as usual.

## Good to know

- **The ticket's name comes from your T3N profile, not the passport.** muse-vault fills the passenger's given and family name from the traveller's Terminal 3 profile. A test booking made with this sample therefore carries your account's name, with this sample's passport number, date of birth and sex.
- **It's still stored.** Sealed details go to your own testnet vault and into Duffel **test** orders, like any scan.
- **Don't use it outside testing.** It exists only to exercise this software on testnet.
