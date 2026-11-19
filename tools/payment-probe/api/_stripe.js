// Minimal Stripe REST helper (no SDK dependency). Test-mode keys only.
const API = "https://api.stripe.com/v1";

export function secretKey() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_…) for the probe");
  }
  return key;
}

function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === "object") form(v, key, out);
    else if (v !== undefined) out.append(key, String(v));
  }
  return out;
}

export async function stripePost(path, params) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(params),
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export const PRICE_CENTS = 100;
export const PRODUCT = "muse-vault payment probe (test purchase)";
