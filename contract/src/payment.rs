//! `pay-hold`: pays a held Duffel order from the operator's Duffel balance.
//!
//! Only the operator's pay agent may call it: the call must be delegated, made
//! for the operator itself, by the agent whose DID the operator recorded in
//! `secrets` as `pay_agent_did`. The pay server holds that agent's key and
//! calls this after the traveller's card payment succeeds, so the Duffel token
//! never leaves this tenant. Duffel checks the amount against the order total
//! itself; a refusal comes back as `{ paid: false, code }` so the pay server
//! can refund the card.

use serde_json::Value;

#[derive(serde::Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct PayHoldReq {
    pub order_id: String,
    pub amount: String,
    pub currency: String,
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct PayHoldResult {
    pub paid: bool,
    pub payment_id: Option<String>,
    /// Duffel's error code when it refused the payment, e.g.
    /// `payment_amount_does_not_match_order_amount`.
    pub code: Option<String>,
}

pub fn parse(input: &[u8]) -> Result<PayHoldReq, String> {
    let req: PayHoldReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("pay-hold: bad input: {e}"))?;
    if !crate::booking::valid_order_id(&req.order_id) {
        return Err("pay-hold: order_id must look like ord_…".to_string());
    }
    let amount_ok = {
        let mut parts = req.amount.splitn(2, '.');
        let whole = parts.next().unwrap_or("");
        let frac = parts.next();
        !whole.is_empty()
            && whole.len() <= 7
            && whole.bytes().all(|b| b.is_ascii_digit())
            && frac.is_none_or(|f| !f.is_empty() && f.len() <= 2 && f.bytes().all(|b| b.is_ascii_digit()))
    };
    if !amount_ok {
        return Err("pay-hold: amount must look like 228.67".to_string());
    }
    if req.currency.len() != 3 || !req.currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("pay-hold: currency must be a 3-letter ISO code".to_string());
    }
    Ok(req)
}

pub fn body(req: &PayHoldReq) -> Value {
    serde_json::json!({
        "data": {
            "order_id": req.order_id,
            "payment": { "type": "balance", "amount": req.amount, "currency": req.currency }
        }
    })
}

/// Reads Duffel's `POST /air/payments` response. A 4xx is a refusal the pay
/// server should refund; anything else unexpected is an error to retry.
pub fn interpret(code: u16, payload: &[u8]) -> Result<PayHoldResult, String> {
    let json: Value = serde_json::from_slice(payload).unwrap_or(Value::Null);
    match code {
        200 | 201 => Ok(PayHoldResult {
            paid: true,
            payment_id: json["data"]["id"].as_str().map(|s| s.to_string()),
            code: None,
        }),
        400..=499 => Ok(PayHoldResult {
            paid: false,
            payment_id: None,
            code: Some(json["errors"][0]["code"].as_str().unwrap_or("refused").to_string()),
        }),
        other => Err(alloc::format!("Duffel payment failed: HTTP {other}")),
    }
}

pub fn pay_hold(input: &[u8]) -> Result<Vec<u8>, String> {
    let req = parse(input)?;

    #[cfg(target_arch = "wasm32")]
    {
        let out = pay_hold_wasm(&req)?;
        serde_json::to_vec(&out).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        drop(req);
        Err("pay-hold is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
fn pay_hold_wasm(req: &PayHoldReq) -> Result<PayHoldResult, String> {
    use crate::host::{
        interfaces::{http as http_iface, kv_store, logging},
        tenant::tenant_context,
    };

    let tenant = tenant_context::tenant_did();
    let secrets = alloc::format!("z:{}:secrets", hex::encode(&tenant));
    let pay_agent = kv_store::get(&secrets, b"pay_agent_did")?
        .ok_or("pay-hold: no pay agent recorded; the operator sets pay_agent_did in secrets")?;
    let caller = tenant_context::calling_user_did();
    let agent = tenant_context::authenticated_did();
    let allowed = tenant_context::is_delegated()
        && caller.as_deref() == Some(tenant.as_slice())
        && agent.map(hex::encode).as_deref().map(str::as_bytes) == Some(pay_agent.as_slice());
    if !allowed {
        return Err("pay-hold: only the operator's pay agent can pay held orders".to_string());
    }

    let key = kv_store::get(&secrets, b"duffel_api_key")?.ok_or("duffel_api_key not found in secrets")?;
    let key = alloc::string::String::from_utf8(key).map_err(|e| e.to_string())?;
    logging::info("pay-hold: calling Duffel POST /air/payments")?;
    let resp = http_iface::call(&http_iface::Request {
        method: http_iface::Verb::Post,
        url: "https://api.duffel.com/air/payments".to_string(),
        headers: Some(alloc::vec![
            ("Authorization".to_string(), alloc::format!("Bearer {key}")),
            ("Duffel-Version".to_string(), "v2".to_string()),
            ("Accept".to_string(), "application/json".to_string()),
        ]),
        payload: Some(serde_json::to_vec(&body(req)).map_err(|e| e.to_string())?),
    })
    .map_err(|e| alloc::format!("duffel payment: {e}"))?;
    let out = interpret(resp.code, &resp.payload)?;
    logging::info(if out.paid { "pay-hold: paid" } else { "pay-hold: refused by Duffel" })?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(v: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn parses_valid_input() {
        let r = parse(&input(serde_json::json!({ "order_id": "ord_ABC", "amount": "228.67", "currency": "USD" }))).unwrap();
        assert_eq!(body(&r)["data"]["payment"]["type"], "balance");
        assert_eq!(body(&r)["data"]["payment"]["amount"], "228.67");
    }

    #[test]
    fn rejects_bad_input() {
        for v in [
            serde_json::json!({ "order_id": "ord_../x", "amount": "1.00", "currency": "USD" }),
            serde_json::json!({ "order_id": "ord_A", "amount": "1.005", "currency": "USD" }),
            serde_json::json!({ "order_id": "ord_A", "amount": "-1", "currency": "USD" }),
            serde_json::json!({ "order_id": "ord_A", "amount": "1.", "currency": "USD" }),
            serde_json::json!({ "order_id": "ord_A", "amount": "1.00", "currency": "usd" }),
            serde_json::json!({ "order_id": "ord_A", "amount": "1.00", "currency": "USD", "type": "card" }),
        ] {
            assert!(parse(&input(v.clone())).is_err(), "{v} accepted");
        }
    }

    #[test]
    fn interprets_duffel_responses() {
        let ok = interpret(201, br#"{"data":{"id":"pay_1","amount":"1"}}"#).unwrap();
        assert_eq!(ok, PayHoldResult { paid: true, payment_id: Some("pay_1".into()), code: None });
        let refused = interpret(422, br#"{"errors":[{"code":"payment_amount_does_not_match_order_amount"}]}"#).unwrap();
        assert!(!refused.paid);
        assert_eq!(refused.code.as_deref(), Some("payment_amount_does_not_match_order_amount"));
        assert!(interpret(503, b"").is_err(), "a server error is retried, not refunded");
    }

    #[test]
    fn non_wasm_returns_err() {
        let e = pay_hold(&input(serde_json::json!({ "order_id": "ord_A", "amount": "1.00", "currency": "USD" }))).unwrap_err();
        assert!(e.contains("only implemented"));
    }
}
