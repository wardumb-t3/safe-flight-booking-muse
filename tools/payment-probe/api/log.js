// Records what happened on the page, so the run can be read back from the
// Vercel function logs. Never logs card data: the card fields live in Stripe's
// iframe and this page cannot read them.
const ALLOWED = new Set([
  "page_loaded",
  "card_form_ready",
  "card_field_focused",
  "card_complete",
  "pay_clicked",
  "result",
  "checkout_clicked",
]);

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const { event, detail } = req.body || {};
  if (!ALLOWED.has(event)) {
    res.status(400).json({ error: "unknown event" });
    return;
  }
  const safe = {
    probe: event,
    at: new Date().toISOString(),
    ua: String(req.headers["user-agent"] || "").slice(0, 200),
    detail: typeof detail === "object" && detail !== null ? {
      code: detail.code ?? null,
      decline_code: detail.decline_code ?? null,
      message: typeof detail.message === "string" ? detail.message.slice(0, 200) : null,
      status: detail.status ?? null,
      brand: detail.brand ?? null,
    } : null,
  };
  console.log(JSON.stringify(safe));
  res.status(204).end();
}
