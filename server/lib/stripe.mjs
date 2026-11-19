// Minimal Stripe REST client (no SDK). Test-mode keys only unless ALLOW_LIVE=1.
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

export function stripeKeys(env = process.env) {
  const secret = env.STRIPE_SECRET_KEY || "";
  const publishable = env.STRIPE_PUBLISHABLE_KEY || "";
  const live = env.ALLOW_LIVE === "1";
  if (!live && (!secret.startsWith("sk_test_") || !publishable.startsWith("pk_test_"))) {
    throw new Error("Stripe keys must be test-mode (sk_test_/pk_test_) unless ALLOW_LIVE=1");
  }
  return { secret, publishable };
}

export function createStripe({ secret, fetchImpl = fetch }) {
  async function call(method, path, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${secret}` };
    let body;
    if (params) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(params);
    }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetchImpl(`${API}${path}`, { method, headers, body });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `Stripe HTTP ${res.status}`);
    return json;
  }
  return {
    createIntent: ({ amountMinor, currency, orderId }) =>
      call(
        "POST",
        "/payment_intents",
        {
          amount: String(amountMinor),
          currency: currency.toLowerCase(),
          "payment_method_types[0]": "card",
          description: `Flight order ${orderId}`,
          "metadata[order_id]": orderId,
        },
        // Same order and amount → same intent, so repeated clicks don't stack charges.
        `intent-${orderId}-${currency}-${amountMinor}`,
      ),
    getIntent: (id) => call("GET", `/payment_intents/${encodeURIComponent(id)}`),
    refund: (paymentIntentId) =>
      call("POST", "/refunds", { payment_intent: paymentIntentId }, `refund-${paymentIntentId}`),
  };
}

/** Verifies a Stripe-Signature header (v1 scheme, 5-minute tolerance). */
export function verifyWebhook(rawBody, header, secret, nowSecs = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=")).filter((p) => p.length === 2),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(nowSecs - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
