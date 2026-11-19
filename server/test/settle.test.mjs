import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Ledger, createSettler, fromMinorUnits, toMinorUnits, validOrderId } from "../lib/settle.mjs";
import { verifyWebhook } from "../lib/stripe.mjs";

function fakes({ intent, duffelResult }) {
  const calls = { pay: [], refund: [] };
  const stripe = {
    getIntent: async () => intent,
    refund: async (id) => { calls.refund.push(id); return { id: "re_1" }; },
  };
  const duffel = { payHold: async (a) => { calls.pay.push(a); return duffelResult; } };
  return { stripe, duffel, calls };
}

const succeeded = { id: "pi_1", status: "succeeded", amount: 22867, amount_received: 22867, currency: "usd", metadata: { order_id: "ord_ABC" } };

test("amount conversion round-trips", () => {
  assert.equal(toMinorUnits("228.67", "USD"), 22867);
  assert.equal(toMinorUnits("228.6", "USD"), 22860);
  assert.equal(toMinorUnits("228", "USD"), 22800);
  assert.equal(fromMinorUnits(22867, "USD"), "228.67");
  assert.equal(fromMinorUnits(22800, "USD"), "228.00");
  assert.equal(toMinorUnits("5000", "JPY"), 5000);
  assert.equal(fromMinorUnits(5000, "JPY"), "5000");
});

test("amount validation", () => {
  for (const bad of ["", "-1", "0", "1e3", "12.345", "abc", "99999999", "10001"]) {
    assert.throws(() => toMinorUnits(bad, "USD"), undefined, bad);
  }
  assert.throws(() => toMinorUnits("10", "usd"));
  assert.throws(() => toMinorUnits("10.50", "JPY"));
});

test("order id validation", () => {
  assert.ok(validOrderId("ord_0000BCZ5WtSaYQDhHKCUq0"));
  for (const bad of ["", "ord_", "ord_../x", "pay_1", "ord_a b", undefined]) assert.ok(!validOrderId(bad), String(bad));
});

test("pays the hold once and records it", async () => {
  const { stripe, duffel, calls } = fakes({ intent: succeeded, duffelResult: { ok: true, payment: { id: "pay_1" } } });
  const ledger = new Ledger(null);
  const settle = createSettler({ stripe, duffel, ledger });
  const [a, b] = await Promise.all([settle("pi_1"), settle("pi_1")]);
  assert.equal(a.outcome, "paid");
  assert.deepEqual(a, b);
  assert.equal(calls.pay.length, 1, "racing calls pay Duffel once");
  assert.deepEqual(calls.pay[0], { orderId: "ord_ABC", amount: "228.67", currency: "USD" });
  assert.equal((await settle("pi_1")).duffel_payment, "pay_1");
  assert.equal(calls.pay.length, 1, "a later call reads the ledger");
});

test("refunds when Duffel refuses the payment", async () => {
  const { stripe, duffel, calls } = fakes({ intent: succeeded, duffelResult: { ok: false, status: 422, code: "order_expired", error: "x" } });
  const r = await createSettler({ stripe, duffel, ledger: new Ledger(null) })("pi_1");
  assert.equal(r.outcome, "refunded");
  assert.equal(r.reason, "order_expired");
  assert.deepEqual(calls.refund, ["pi_1"]);
});

test("does nothing until the card payment succeeded", async () => {
  const { stripe, duffel, calls } = fakes({ intent: { ...succeeded, status: "requires_payment_method" } });
  const r = await createSettler({ stripe, duffel, ledger: new Ledger(null) })("pi_1");
  assert.equal(r.outcome, "pending");
  assert.equal(calls.pay.length, 0);
});

test("rejects intents not made by this server", async () => {
  const { stripe, duffel, calls } = fakes({ intent: { ...succeeded, metadata: {} } });
  const settle = createSettler({ stripe, duffel, ledger: new Ledger(null) });
  assert.equal((await settle("pi_1")).outcome, "rejected");
  assert.equal((await settle("not-an-id")).outcome, "rejected");
  assert.equal(calls.pay.length, 0);
});

test("webhook signature check", () => {
  const secret = "whsec_test", body = '{"type":"x"}', t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.ok(verifyWebhook(body, `t=${t},v1=${sig}`, secret, t));
  assert.ok(!verifyWebhook(body, `t=${t},v1=${sig}`, "wrong", t));
  assert.ok(!verifyWebhook(body + " ", `t=${t},v1=${sig}`, secret, t));
  assert.ok(!verifyWebhook(body, `t=${t},v1=${sig}`, secret, t + 3600), "stale timestamp");
  assert.ok(!verifyWebhook(body, undefined, secret, t));
});
