// Turns a succeeded card payment into a paid Duffel hold, exactly once.
//
// Called from the pay page right after the card is confirmed and from the
// Stripe webhook, so it must be idempotent: a ledger records each settled
// intent, and a per-intent lock stops the two paths racing.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
export const MAX_AMOUNT = 10_000; // in major units; a guard against a typo'd or hostile amount

export const validOrderId = (id) => typeof id === "string" && /^ord_[A-Za-z0-9]{1,60}$/.test(id);
export const validCurrency = (c) => typeof c === "string" && /^[A-Z]{3}$/.test(c);

/** "228.67" + "USD" → 22867. Rejects anything that isn't a plain positive decimal within MAX_AMOUNT. */
export function toMinorUnits(amount, currency) {
  if (typeof amount !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(amount)) throw new Error("amount must look like 228.67");
  if (!validCurrency(currency)) throw new Error("currency must be a 3-letter ISO code");
  const [whole, frac = ""] = amount.split(".");
  if (Number(amount) <= 0 || Number(amount) > MAX_AMOUNT) throw new Error(`amount must be between 0 and ${MAX_AMOUNT}`);
  if (ZERO_DECIMAL.has(currency)) {
    if (frac && Number(frac) !== 0) throw new Error(`${currency} has no minor units`);
    return Number(whole);
  }
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** 22867 + "USD" → "228.67", the exact string Duffel expects for the order total. */
export function fromMinorUnits(minor, currency) {
  if (ZERO_DECIMAL.has(currency)) return String(minor);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export class Ledger {
  constructor(file) {
    this.file = file;
    this.byIntent = new Map();
    if (file && existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        this.byIntent.set(rec.payment_intent, rec);
      }
    }
  }
  get(intentId) { return this.byIntent.get(intentId); }
  forOrder(orderId) { return [...this.byIntent.values()].filter((r) => r.order_id === orderId); }
  record(rec) {
    this.byIntent.set(rec.payment_intent, rec);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(rec) + "\n");
    }
  }
}

export function createSettler({ stripe, duffel, ledger, log = () => {} }) {
  const inflight = new Map();

  async function settleOnce(intentId) {
    const done = ledger.get(intentId);
    if (done) return done;

    const pi = await stripe.getIntent(intentId);
    const orderId = pi.metadata?.order_id;
    if (!validOrderId(orderId)) return { outcome: "rejected", reason: "intent has no order" };
    if (pi.status !== "succeeded") return { outcome: "pending", reason: `card payment is ${pi.status}` };

    const currency = String(pi.currency).toUpperCase();
    const amount = fromMinorUnits(pi.amount_received ?? pi.amount, currency);
    const res = await duffel.payHold({ orderId, amount, currency });

    let rec;
    if (res.ok) {
      rec = { outcome: "paid", order_id: orderId, payment_intent: intentId, duffel_payment: res.payment.id, amount, currency, at: new Date().toISOString() };
    } else {
      // Duffel refused (wrong amount, expired hold, already paid elsewhere…):
      // give the traveller their money back rather than keep it.
      log({ event: "duffel_refused", order_id: orderId, code: res.code, status: res.status });
      await stripe.refund(intentId);
      rec = { outcome: "refunded", order_id: orderId, payment_intent: intentId, reason: res.code, amount, currency, at: new Date().toISOString() };
    }
    ledger.record(rec);
    log({ event: "settled", ...rec });
    return rec;
  }

  return function settle(intentId) {
    if (typeof intentId !== "string" || !/^pi_[A-Za-z0-9_]{1,80}$/.test(intentId)) {
      return Promise.resolve({ outcome: "rejected", reason: "bad payment_intent id" });
    }
    if (!inflight.has(intentId)) {
      inflight.set(intentId, settleOnce(intentId).finally(() => inflight.delete(intentId)));
    }
    return inflight.get(intentId);
  };
}

export const defaultLedgerPath = (dataDir) => `${dataDir}/settled.jsonl`;
