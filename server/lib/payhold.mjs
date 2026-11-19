// Pays a held order through the contract's `pay-hold`, authenticated as the
// operator's pay agent. The server holds that agent key, never the Duffel
// token: the key can call `pay-hold` and nothing else, and `pay-hold` returns
// no passenger data.
export function payAgentKey(env = process.env) {
  const key = env.T3N_PAY_AGENT_KEY || "";
  if (!key.startsWith("t3n_key_")) throw new Error("T3N_PAY_AGENT_KEY must be the pay agent's key (t3n_key_…) printed by `npm run operator`");
  return key;
}

/**
 * @param {{ key: string, config: { node_url: string, contract_id: string, contract_version: string, operator_tenant_did: string }, fetchImpl?: typeof fetch }} opts
 */
export function createPayHold({ key, config, fetchImpl = fetch }) {
  return {
    /** Same contract as the old Duffel client: {ok, payment?} or {ok:false, code} for a refusal to refund; throws to retry. */
    async payHold({ orderId, amount, currency }) {
      const res = await fetchImpl(`${config.node_url.replace(/\/+$/, "")}/api/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-T3N-Api-Key": key },
        body: JSON.stringify({
          contract_id: config.contract_id,
          contract_version: config.contract_version,
          function_name: "pay-hold",
          pii_did: config.operator_tenant_did,
          input: { order_id: orderId, amount, currency },
        }),
      });
      const text = await res.text();
      if (res.status === 403 && /InsufficientCredit/.test(text)) {
        // The operator's pay agent is out of credits: nothing reaches Duffel until it is topped up.
        throw new Error("pay agent out of credits: fund it with `npm run operator -- --pay-url <url> --pay-credits <n>` (card payment kept; retry after funding)");
      }
      if (!res.ok) {
        // Not a Duffel refusal (that comes back as 200 with paid=false): out of
        // credit, not granted, node trouble. Leave the card payment in place and retry.
        throw new Error(`pay-hold HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const out = JSON.parse(text);
      if (out.paid) return { ok: true, payment: { id: out.payment_id } };
      return { ok: false, code: out.code || "refused", status: 422 };
    },
  };
}
