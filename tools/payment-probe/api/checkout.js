import { stripePost, PRICE_CENTS, PRODUCT } from "./_stripe.js";

// Variant B: Stripe-hosted Checkout, with card and Link enabled.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  try {
    const session = await stripePost("/checkout/sessions", {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": PRICE_CENTS,
      "line_items[0][price_data][product_data][name]": PRODUCT,
      "line_items[0][quantity]": 1,
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "link",
      success_url: `${origin}/result.html?variant=checkout&status=paid`,
      cancel_url: `${origin}/result.html?variant=checkout&status=cancelled`,
      "metadata[probe]": "stripe-checkout",
    });
    console.log(JSON.stringify({ probe: "checkout_created", id: session.id }));
    res.redirect(303, session.url);
  } catch (e) {
    console.error(JSON.stringify({ probe: "checkout_error", message: e.message }));
    res.status(500).send(`Checkout error: ${e.message}`);
  }
}
