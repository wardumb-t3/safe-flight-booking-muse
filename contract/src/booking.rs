//! Orders: `book-offer` (instant, paid from the Duffel balance), `hold-offer`
//! (pay later, settled after the traveller pays on a checkout page) and
//! `order-status`.
//!
//! The inputs carry no passenger details. Name and email are `{{profile.*}}`
//! markers the host fills from the customer's T3N profile, so those values
//! never enter this contract. Title and phone come from the customer's
//! traveller record; the passport, with date of birth and sex, from that
//! record or from a passport sealed with the Private Doc Scanner.
//!
//! Duffel's order responses echo the passengers back, so every response goes
//! through [`order_summary`], which copies out only non-personal fields.

use serde_json::Value;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookOfferReq {
    pub offer_id: String,
    /// Opaque Duffel passenger id from search-offers. Not PII.
    pub passenger_id: String,
    pub total_amount: String,
    pub total_currency: String,
    /// The Private Doc Scanner reference of a sealed passport to use instead
    /// of the passport in the traveller record.
    #[serde(default)]
    pub scanner_request_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderStatusReq {
    pub order_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderKind {
    /// Paid now from the Duffel balance.
    Instant,
    /// Held without payment; settled later from the balance once the
    /// traveller has paid on the checkout page.
    Hold,
}

/// What an agent may see about an order. Nothing in here identifies the
/// traveller.
#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct OrderSummary {
    pub id: String,
    pub pnr: String,
    /// `awaiting_payment`, `paid` or `cancelled`.
    pub status: String,
    pub total_amount: String,
    pub total_currency: String,
    pub payment_required_by: Option<String>,
    pub price_guarantee_expires_at: Option<String>,
    /// True once the airline has issued an e-ticket.
    pub ticketed: bool,
    pub slices: alloc::vec::Vec<SliceSummary>,
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
pub struct SliceSummary {
    pub origin: String,
    pub destination: String,
    pub departing_at: Option<String>,
    pub arriving_at: Option<String>,
    pub carrier: Option<String>,
    pub flight_number: Option<String>,
}

pub const ORDERS_MAP_TAIL: &str = "orders";

/// Keeps only non-personal fields of a Duffel order (`data` object).
pub fn order_summary(order: &Value) -> Result<OrderSummary, String> {
    let s = |v: &Value| v.as_str().map(|x| x.to_string());
    let id = s(&order["id"]).ok_or("Duffel order missing id")?;
    let pnr = s(&order["booking_reference"]).ok_or("Duffel order missing booking_reference")?;
    let total_amount = s(&order["total_amount"]).ok_or("Duffel order missing total_amount")?;
    let total_currency = s(&order["total_currency"]).ok_or("Duffel order missing total_currency")?;
    let ps = &order["payment_status"];
    let awaiting = ps["awaiting_payment"]
        .as_bool()
        .ok_or("Duffel order missing payment_status.awaiting_payment")?;
    let status = if order["cancelled_at"].is_string() {
        "cancelled"
    } else if awaiting {
        "awaiting_payment"
    } else {
        "paid"
    };
    let ticketed = order["documents"]
        .as_array()
        .is_some_and(|d| d.iter().any(|doc| doc["type"].as_str() == Some("electronic_ticket")));
    let slices = order["slices"]
        .as_array()
        .map(|slices| {
            slices
                .iter()
                .map(|sl| {
                    let segs = sl["segments"].as_array();
                    let first = segs.and_then(|v| v.first());
                    let last = segs.and_then(|v| v.last());
                    SliceSummary {
                        origin: s(&sl["origin"]["iata_code"]).unwrap_or_default(),
                        destination: s(&sl["destination"]["iata_code"]).unwrap_or_default(),
                        departing_at: first.and_then(|x| s(&x["departing_at"])),
                        arriving_at: last.and_then(|x| s(&x["arriving_at"])),
                        carrier: first.and_then(|x| s(&x["marketing_carrier"]["iata_code"])),
                        flight_number: first.and_then(|x| s(&x["marketing_carrier_flight_number"])),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(OrderSummary {
        id,
        pnr,
        status: status.to_string(),
        total_amount,
        total_currency,
        payment_required_by: s(&ps["payment_required_by"]),
        price_guarantee_expires_at: s(&ps["price_guarantee_expires_at"]),
        ticketed,
        slices,
    })
}

/// Duffel order ids are `ord_` followed by letters and digits. Checked before
/// the id goes into a URL path.
pub fn valid_order_id(id: &str) -> bool {
    id.len() > 4 && id.len() <= 64 && id.starts_with("ord_") && id[4..].bytes().all(|b| b.is_ascii_alphanumeric())
}

/// The Duffel `POST /air/orders` body. Hold orders carry no `payments`.
pub fn order_body(kind: OrderKind, req: &BookOfferReq, passenger: Value) -> Value {
    let mut data = serde_json::json!({
        "type": match kind { OrderKind::Instant => "instant", OrderKind::Hold => "hold" },
        "selected_offers": [req.offer_id],
        "passengers": [passenger],
    });
    if kind == OrderKind::Instant {
        data["payments"] = serde_json::json!([{
            "type": "balance",
            "amount": req.total_amount,
            "currency": req.total_currency,
        }]);
    }
    serde_json::json!({ "data": data })
}

/// Entry point for `book-offer` and `hold-offer`. `input` is the raw JSON
/// bytes from the node's `generic-input.input` field.
pub fn place_order(kind: OrderKind, input: &[u8]) -> Result<Vec<u8>, String> {
    let name = fn_name(kind);
    let req: BookOfferReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("{name}: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        let summary = place_order_wasm(kind, req)?;
        serde_json::to_vec(&summary).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        drop(req);
        Err(alloc::format!("{name} is only implemented on the wasm32 target"))
    }
}

/// Entry point for `order-status`.
pub fn order_status(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: OrderStatusReq =
        serde_json::from_slice(input).map_err(|e| alloc::format!("order-status: bad input: {e}"))?;
    if !valid_order_id(&req.order_id) {
        return Err("order-status: order_id must look like ord_…".to_string());
    }

    #[cfg(target_arch = "wasm32")]
    {
        let summary = order_status_wasm(req)?;
        serde_json::to_vec(&summary).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        drop(req);
        Err("order-status is only implemented on the wasm32 target".to_string())
    }
}

fn fn_name(kind: OrderKind) -> &'static str {
    match kind {
        OrderKind::Instant => "book-offer",
        OrderKind::Hold => "hold-offer",
    }
}

const DUFFEL_BASE: &str = "https://api.duffel.com";
const DUFFEL_VERSION: &str = "v2";

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{http as http_iface, http_with_placeholders as hwp, kv_store, logging},
    tenant::tenant_context,
};

#[cfg(target_arch = "wasm32")]
fn caller_hex(op: &str) -> Result<alloc::string::String, alloc::string::String> {
    let caller = tenant_context::calling_user_did()
        .ok_or_else(|| alloc::format!("{op}: no calling customer; call through an authenticated T3N session"))?;
    Ok(hex::encode(&caller))
}

#[cfg(target_arch = "wasm32")]
fn map(tail: &str) -> alloc::string::String {
    alloc::format!("z:{}:{tail}", hex::encode(tenant_context::tenant_did()))
}

/// Orders are recorded per customer, so `order-status` only answers for the
/// customer an order was placed for, even though one Duffel account serves
/// every tenant.
#[cfg(target_arch = "wasm32")]
fn order_key(caller_hex: &str, order_id: &str) -> alloc::vec::Vec<u8> {
    alloc::format!("{caller_hex}:{order_id}").into_bytes()
}

#[cfg(target_arch = "wasm32")]
fn place_order_wasm(kind: OrderKind, req: BookOfferReq) -> Result<OrderSummary, String> {
    use crate::traveller;
    let name = fn_name(kind);

    let caller_hex = caller_hex(name)?;
    let traveller_bytes = kv_store::get(&map(traveller::TRAVELLERS_MAP_TAIL), caller_hex.as_bytes())?
        .ok_or_else(|| alloc::format!("{name}: no traveller record for this customer; the customer saves one with save-traveller"))?;
    let t: traveller::Traveller = serde_json::from_slice(&traveller_bytes)
        .map_err(|_| alloc::format!("{name}: stored traveller record could not be read"))?;

    // A passport saved by hand wins over the scan, so only read the vault when there isn't one.
    let scanned = match (&t.passport, req.scanner_request_id.as_deref()) {
        (None, Some(id)) => Some((|| {
            let key = alloc::format!("req:{id}");
            // The scanner vault lives in the customer's own tenant, not in the
            // tenant that hosts this contract; the customer lets this contract
            // read it with a cross-tenant `extraReadGrants` entry.
            let vault = alloc::format!("z:{caller_hex}:{}", traveller::SCANNER_INTAKE_MAP_TAIL);
            let record = kv_store::get(&vault, key.as_bytes())
                .map_err(|e| alloc::format!("{name}: reading the scanner vault: {e}"))?
                .ok_or_else(|| alloc::format!("{name}: no scanned passport found for this reference"))?;
            traveller::passport_from_scanner(&record, &caller_hex)
        })()),
        _ => None,
    };
    let passport = traveller::pick_passport(t.passport.as_ref(), scanned).map_err(|e| alloc::format!("{name}: {e}"))?;
    let passenger = traveller::passenger(
        &req.passenger_id,
        &t,
        &passport,
        traveller::today(tenant_context::cluster_timestamp_secs()),
    )?;

    let api_key = get_api_key()?;
    let body = order_body(kind, &req, passenger);
    logging::info(&alloc::format!("{name}: calling Duffel POST /air/orders"))?;

    let resp = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: alloc::format!("{DUFFEL_BASE}/air/orders"),
        headers: Some(duffel_headers(&api_key)),
        payload: Some(serde_json::to_vec(&body).map_err(|e| e.to_string())?),
    })
    .map_err(|e| alloc::format!("duffel create-order: {}", format_http_error(e)))?;

    if resp.code != 200 && resp.code != 201 {
        // The response body can echo passenger details, so only the status
        // is logged or returned.
        logging::error(&alloc::format!("{name}: Duffel create-order HTTP {}", resp.code))?;
        return Err(alloc::format!("Duffel create-order failed: HTTP {}", resp.code));
    }

    let order: Value = serde_json::from_slice(&resp.payload).map_err(|e| e.to_string())?;
    let summary = order_summary(&order["data"])?;
    kv_store::put(&map(ORDERS_MAP_TAIL), &order_key(&caller_hex, &summary.id), b"1")?;
    logging::info(&alloc::format!("{name}: Duffel order created"))?;
    Ok(summary)
}

#[cfg(target_arch = "wasm32")]
fn order_status_wasm(req: OrderStatusReq) -> Result<OrderSummary, String> {
    let caller_hex = caller_hex("order-status")?;
    if kv_store::get(&map(ORDERS_MAP_TAIL), &order_key(&caller_hex, &req.order_id))?.is_none() {
        return Err("order-status: no order with this id was placed for this customer".to_string());
    }
    let api_key = get_api_key()?;
    let resp = http_iface::call(&http_iface::Request {
        method: http_iface::Verb::Get,
        url: alloc::format!("{DUFFEL_BASE}/air/orders/{}", req.order_id),
        headers: Some(duffel_headers(&api_key)),
        payload: None,
    })
    .map_err(|e| alloc::format!("duffel get-order: {e}"))?;
    if resp.code != 200 {
        logging::error(&alloc::format!("order-status: Duffel get-order HTTP {}", resp.code))?;
        return Err(alloc::format!("Duffel get-order failed: HTTP {}", resp.code));
    }
    let order: Value = serde_json::from_slice(&resp.payload).map_err(|e| e.to_string())?;
    order_summary(&order["data"])
}

/// Render a typed `http-with-placeholders` error as a contract-facing string.
/// Never includes resolved PII — only field names and host-side reasons.
#[cfg(target_arch = "wasm32")]
fn format_http_error(e: hwp::HttpError) -> alloc::string::String {
    match e {
        hwp::HttpError::EgressDenied(host) => alloc::format!("egress denied for host {host}"),
        hwp::HttpError::PlaceholderDenied(marker) => {
            alloc::format!("placeholder not permitted: {marker}")
        }
        hwp::HttpError::PlaceholderUnknown(field) => {
            alloc::format!("user profile missing field: {field}")
        }
        hwp::HttpError::PlaceholderNoUserContext => {
            "no user context bound for placeholder resolution".to_string()
        }
        hwp::HttpError::UpstreamError(reason) => alloc::format!("upstream: {reason}"),
    }
}

#[cfg(target_arch = "wasm32")]
fn get_api_key() -> Result<alloc::string::String, alloc::string::String> {
    let bytes = kv_store::get(&map("secrets"), b"duffel_api_key")
        .map_err(|e| alloc::format!("kv read: {e}"))?
        .ok_or("duffel_api_key not found in z:<tid>:secrets — populate it via the tenant SDK before use")?;
    alloc::string::String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
fn duffel_headers(
    api_key: &str,
) -> alloc::vec::Vec<(alloc::string::String, alloc::string::String)> {
    // Content-Type is set automatically by the host HTTP function via
    // .json() — sending it explicitly creates a duplicate that Duffel rejects.
    alloc::vec![
        (
            "Authorization".to_string(),
            alloc::format!("Bearer {api_key}"),
        ),
        ("Duffel-Version".to_string(), DUFFEL_VERSION.to_string()),
        ("Accept".to_string(), "application/json".to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req() -> BookOfferReq {
        BookOfferReq {
            offer_id: "off_1".into(),
            passenger_id: "pas_1".into(),
            total_amount: "228.67".into(),
            total_currency: "USD".into(),
            scanner_request_id: None,
        }
    }

    /// A Duffel order shaped like the API's, including the passenger details
    /// it echoes back.
    fn duffel_order(awaiting: bool) -> Value {
        json!({
            "id": "ord_0000BCZ5WtSaYQDhHKCUq0",
            "booking_reference": "7EQKGR",
            "total_amount": "228.67",
            "total_currency": "USD",
            "cancelled_at": null,
            "payment_status": {
                "awaiting_payment": awaiting,
                "payment_required_by": "2026-11-21T06:54:57Z",
                "price_guarantee_expires_at": "2026-11-20T06:54:57Z",
                "paid_at": if awaiting { Value::Null } else { json!("2026-11-18T06:55:15Z") }
            },
            "documents": if awaiting { json!([]) } else { json!([{ "type": "electronic_ticket", "unique_identifier": "1" }]) },
            "passengers": [{
                "id": "pas_1", "given_name": "Testy", "family_name": "Example",
                "born_on": "1990-04-12", "email": "testy@example.com", "phone_number": "+442071234567",
                "identity_documents": [{ "unique_identifier": "000000000" }]
            }],
            "slices": [{
                "origin": { "iata_code": "LHR" }, "destination": { "iata_code": "JFK" },
                "segments": [{
                    "departing_at": "2026-12-15T09:00:00", "arriving_at": "2026-12-15T12:10:00",
                    "marketing_carrier": { "iata_code": "ZZ" }, "marketing_carrier_flight_number": "1234"
                }]
            }]
        })
    }

    #[test]
    fn summary_of_held_order() {
        let s = order_summary(&duffel_order(true)).unwrap();
        assert_eq!(s.status, "awaiting_payment");
        assert_eq!(s.pnr, "7EQKGR");
        assert_eq!(s.payment_required_by.as_deref(), Some("2026-11-21T06:54:57Z"));
        assert!(!s.ticketed);
        assert_eq!(s.slices[0].origin, "LHR");
        assert_eq!(s.slices[0].carrier.as_deref(), Some("ZZ"));
    }

    #[test]
    fn summary_of_paid_order_is_ticketed() {
        let s = order_summary(&duffel_order(false)).unwrap();
        assert_eq!(s.status, "paid");
        assert!(s.ticketed);
    }

    #[test]
    fn summary_never_contains_passenger_details() {
        let out = serde_json::to_string(&order_summary(&duffel_order(true)).unwrap()).unwrap();
        for pii in ["Testy", "Example", "1990-04-12", "testy@example.com", "+442071234567", "000000000"] {
            assert!(!out.contains(pii), "summary leaked {pii}: {out}");
        }
    }

    #[test]
    fn cancelled_order() {
        let mut o = duffel_order(true);
        o["cancelled_at"] = json!("2026-11-19T00:00:00Z");
        assert_eq!(order_summary(&o).unwrap().status, "cancelled");
    }

    #[test]
    fn hold_body_has_no_payments() {
        let b = order_body(OrderKind::Hold, &req(), json!({ "id": "pas_1" }));
        assert_eq!(b["data"]["type"], "hold");
        assert!(b["data"].get("payments").is_none());
    }

    #[test]
    fn instant_body_pays_from_balance() {
        let b = order_body(OrderKind::Instant, &req(), json!({ "id": "pas_1" }));
        assert_eq!(b["data"]["type"], "instant");
        assert_eq!(b["data"]["payments"][0]["type"], "balance");
        assert_eq!(b["data"]["payments"][0]["amount"], "228.67");
    }

    #[test]
    fn order_id_validation() {
        assert!(valid_order_id("ord_0000BCZ5WtSaYQDhHKCUq0"));
        for bad in ["", "ord_", "ord_../x", "pay_123", "ord_a/b", "ord_a?b=1"] {
            assert!(!valid_order_id(bad), "{bad} accepted");
        }
    }

    #[test]
    fn non_wasm_entry_points_err() {
        let input = serde_json::to_vec(&json!({
            "offer_id": "off_1", "passenger_id": "pas_1", "total_amount": "1.00", "total_currency": "USD"
        }))
        .unwrap();
        assert!(place_order(OrderKind::Hold, &input).unwrap_err().contains("hold-offer is only implemented"));
        assert!(place_order(OrderKind::Instant, &input).unwrap_err().contains("book-offer is only implemented"));
        let status = serde_json::to_vec(&json!({ "order_id": "ord_abc" })).unwrap();
        assert!(order_status(&status).unwrap_err().contains("only implemented"));
    }

    #[test]
    fn rejects_inline_pii_fields() {
        let input = serde_json::to_vec(&json!({
            "offer_id": "off_1", "passengers": [{ "given_name": "Jane" }],
            "total_amount": "1.00", "total_currency": "USD"
        }))
        .unwrap();
        assert!(place_order(OrderKind::Hold, &input).unwrap_err().contains("bad input"));
        assert!(order_status(b"{\"order_id\":\"ord_x\",\"email\":\"a\"}").unwrap_err().contains("bad input"));
    }
}
