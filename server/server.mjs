// muse-vault pay server: the checkout page for a held flight, and the step
// that pays the hold once the card payment succeeds.
//
//   GET  /pay/<order_id>?amount=228.67&currency=USD   checkout page (card form in Stripe's iframe)
//   POST /api/pay/intent    {order_id, amount, currency}   → {clientSecret}
//   POST /api/pay/complete  {payment_intent}               → {outcome, ...}
//   GET  /api/pay/status/<order_id>                        → what this server settled for the order
//   POST /api/stripe/webhook                               (optional, needs STRIPE_WEBHOOK_SECRET)
//   GET  /start, /edit                                     redirect to the onboarding page (ONBOARDING_URL), /edit to its edit mode
//   GET  /api/scan-link                                    a fresh Private Doc Scanner link for a passport
//   GET  /muse-vault.json                                  the operator config travellers' setup reads
//   GET  /muse.md, /                                       the guide Muse follows, and a landing page
//
// It holds the Stripe keys and a T3N pay-agent key that can only call the
// contract's `pay-hold`. It never holds the Duffel token and never reads an
// order, so it sees no passenger details.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createStripe, stripeKeys, verifyWebhook } from "./lib/stripe.mjs";
import { createPayHold, payAgentKey } from "./lib/payhold.mjs";
import { readFileSync } from "node:fs";
import { Ledger, createSettler, defaultLedgerPath, toMinorUnits, validOrderId } from "./lib/settle.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const MAX_BODY = 64 * 1024;
const SCANNER_URL = (process.env.SCANNER_URL || "https://experiments-eta-ten.vercel.app/").replace(/\/?$/, "/");

const keys = stripeKeys();
const stripe = createStripe({ secret: keys.secret });
// The operator config (written by `npm run operator`) says which contract to call.
const operatorConfig = JSON.parse(readFileSync(join(PUBLIC, "muse-vault.json"), "utf8"));
const duffel = createPayHold({ key: payAgentKey(), config: operatorConfig });
const ledger = new Ledger(defaultLedgerPath(DATA_DIR));
const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
const settle = createSettler({ stripe, duffel, ledger, log });

const TYPES = { ".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

function send(res, code, body, type = "application/json") {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  // Objects are serialised; file contents (Buffers) and strings go out as they are.
  const raw = typeof body === "string" || Buffer.isBuffer(body);
  res.end(raw ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveFile(res, rel) {
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.setHeader("X-Robots-Tag", "noindex");
    send(res, 200, data, TYPES[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  // Answer HEAD like GET (Node drops the body), so `curl -I` checks see the real status.
  if (req.method === "HEAD") req.method = "GET";
  try {
    if (req.method === "GET" && /^\/pay\/[^/]+$/.test(p)) return serveFile(res, "pay.html");
    if (req.method === "GET" && p === "/api/pay/config") return send(res, 200, { publishableKey: keys.publishable });

    if (req.method === "POST" && p === "/api/pay/intent") {
      const { order_id, amount, currency } = JSON.parse((await readBody(req)) || "{}");
      if (!validOrderId(order_id)) return send(res, 400, { error: "order_id must look like ord_…" });
      let amountMinor;
      try { amountMinor = toMinorUnits(amount, currency); } catch (e) { return send(res, 400, { error: e.message }); }
      const paid = ledger.forOrder(order_id).find((r) => r.outcome === "paid");
      if (paid) return send(res, 409, { error: "this order is already paid", outcome: "paid" });
      const created = await stripe.createIntent({ amountMinor, currency, orderId: order_id });
      // The idempotent create replays its first response, so read the intent's current state.
      const pi = await stripe.getIntent(created.id);
      log({ event: "intent", order_id, amount, currency, intent: pi.id, status: pi.status });
      // The same order and amount always map to the same intent. If it was already
      // charged (an earlier attempt whose confirmation failed), don't charge again:
      // the page goes straight to confirming the booking.
      if (pi.status === "succeeded") return send(res, 200, { alreadyCharged: true, paymentIntent: pi.id });
      return send(res, 200, { clientSecret: pi.client_secret, paymentIntent: pi.id });
    }

    if (req.method === "POST" && p === "/api/pay/complete") {
      const { payment_intent } = JSON.parse((await readBody(req)) || "{}");
      try {
        const r = await settle(payment_intent);
        return send(res, r.outcome === "rejected" ? 400 : 200, r);
      } catch (e) {
        // The card payment stands; the booking wasn't confirmed yet. Safe to retry: settle is idempotent.
        log({ event: "settle_failed", payment_intent, message: e.message });
        return send(res, 502, { outcome: "retry", reason: "The card payment went through, but confirming the seat with the airline failed. Don't pay again: try confirming again in a minute." });
      }
    }

    const status = p.match(/^\/api\/pay\/status\/([^/]+)$/);
    if (req.method === "GET" && status) {
      if (!validOrderId(status[1])) return send(res, 400, { error: "order_id must look like ord_…" });
      const recs = ledger.forOrder(status[1]).map(({ outcome, duffel_payment, amount, currency, at, reason }) => ({ outcome, duffel_payment, amount, currency, at, reason }));
      return send(res, 200, { order_id: status[1], settlements: recs });
    }

    if (req.method === "POST" && p === "/api/stripe/webhook") {
      const raw = await readBody(req);
      if (!verifyWebhook(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
        return send(res, 400, { error: "bad signature" });
      }
      const event = JSON.parse(raw);
      if (event.type === "payment_intent.succeeded") await settle(event.data?.object?.id);
      return send(res, 200, { received: true });
    }

    if (req.method === "GET" && (p === "/start" || p === "/edit")) {
      const base = process.env.ONBOARDING_URL;
      // /edit opens the onboarding page's edit mode, for travellers who already sealed their passport.
      const target = base && p === "/edit" ? `${base.replace(/\/?$/, "/")}?edit` : base;
      if (!target || !/^https:\/\//.test(target)) return send(res, 404, "Onboarding is not configured (set ONBOARDING_URL).", "text/plain");
      res.statusCode = 302;
      res.setHeader("Location", target);
      return res.end();
    }
    if (req.method === "GET" && p === "/api/scan-link") {
      // 128 random bits: the first account to seal to an id owns it, so it must not be guessable.
      const request_id = `vault_${randomBytes(16).toString("hex")}`;
      return send(res, 200, { request_id, link: `${SCANNER_URL}?req=${request_id}&types=passport` });
    }
    if (req.method === "GET" && p === "/muse-vault.json") return serveFile(res, "muse-vault.json");
    if (req.method === "GET" && (p === "/" || p === "/muse.md")) return serveFile(res, p === "/" ? "index.html" : "muse.md");
    return send(res, 404, { error: "not found" });
  } catch (e) {
    log({ event: "error", path: p, message: e.message });
    if (!res.headersSent) send(res, e instanceof SyntaxError ? 400 : 502, { error: e instanceof SyntaxError ? "bad JSON" : "upstream error" });
  }
}).listen(PORT, HOST, () => log({ event: "listening", url: `http://${HOST}:${PORT}` }));
