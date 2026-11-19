import { test } from "node:test";
import assert from "node:assert/strict";
import { createPayHold, payAgentKey } from "../lib/payhold.mjs";

const config = { node_url: "https://node.example/", contract_id: "z:abc:muse-flight", contract_version: "0.9.1", operator_tenant_did: "did:t3n:abc" };

function fakeFetch(status, body) {
  const seen = [];
  const fn = async (url, init) => { seen.push({ url, init }); return { ok: status < 300, status, text: async () => JSON.stringify(body) }; };
  return { fn, seen };
}

test("calls pay-hold as the operator with the agent key", async () => {
  const { fn, seen } = fakeFetch(200, { paid: true, payment_id: "pay_1" });
  const r = await createPayHold({ key: "t3n_key_x", config, fetchImpl: fn }).payHold({ orderId: "ord_A", amount: "1.00", currency: "USD" });
  assert.deepEqual(r, { ok: true, payment: { id: "pay_1" } });
  assert.equal(seen[0].url, "https://node.example/api/invoke");
  assert.equal(seen[0].init.headers["X-T3N-Api-Key"], "t3n_key_x");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.function_name, "pay-hold");
  assert.equal(body.pii_did, "did:t3n:abc");
  assert.deepEqual(body.input, { order_id: "ord_A", amount: "1.00", currency: "USD" });
});

test("a Duffel refusal is reported for a refund", async () => {
  const { fn } = fakeFetch(200, { paid: false, code: "payment_amount_does_not_match_order_amount" });
  const r = await createPayHold({ key: "t3n_key_x", config, fetchImpl: fn }).payHold({ orderId: "ord_A", amount: "1.00", currency: "USD" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "payment_amount_does_not_match_order_amount");
});

test("node errors throw so the card payment is kept and retried, not refunded", async () => {
  const { fn } = fakeFetch(403, { error: "forbidden" });
  await assert.rejects(createPayHold({ key: "t3n_key_x", config, fetchImpl: fn }).payHold({ orderId: "ord_A", amount: "1.00", currency: "USD" }), /HTTP 403/);
});

test("requires a T3N agent key", () => {
  assert.throws(() => payAgentKey({ T3N_PAY_AGENT_KEY: "duffel_test_x" }));
  assert.equal(payAgentKey({ T3N_PAY_AGENT_KEY: "t3n_key_ok" }), "t3n_key_ok");
});
