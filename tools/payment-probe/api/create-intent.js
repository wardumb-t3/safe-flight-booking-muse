import { stripePost, PRICE_CENTS, PRODUCT } from "./_stripe.js";

// Variant A: card fields rendered by Stripe inside an iframe on our own page,
// the same shape as Duffel's card form. Card only, so the agent has to fill
// the card fields rather than take a wallet shortcut.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const pi = await stripePost("/payment_intents", {
      amount: PRICE_CENTS,
      currency: "usd",
      description: PRODUCT,
      "payment_method_types[0]": "card",
      metadata: { probe: "embedded-card-iframe" },
    });
    console.log(JSON.stringify({ probe: "intent_created", id: pi.id }));
    res.status(200).json({ clientSecret: pi.client_secret });
  } catch (e) {
    console.error(JSON.stringify({ probe: "intent_error", message: e.message }));
    res.status(500).json({ error: e.message });
  }
}
