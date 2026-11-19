//! muse-vault flight contract — a fork of Terminal-3/z-tenant-flight that
//! lets a personal agent (Muse) hold a flight for a customer without seeing
//! their details; the customer then pays on a checkout page.
//!
//! - `get-traveller`: the customer reads back their own record, to edit it.
//! - `save-traveller` / `forget-traveller`: the customer saves or deletes
//!   their own traveller record (title, phone, and optionally a passport) in
//!   `z:<tid>:travellers`. Refused on a delegated call.
//! - `search-offers`: Duffel offer search over plain `http` (no PII).
//! - `hold-offer`: like `book-offer`, but a Duffel hold order (no payment);
//!   the muse-vault pay server settles it after the traveller pays.
//! - `order-status`: a held or booked order's status, without passenger data.
//! - `pay-hold`: pays a held order from the operator's Duffel balance; only
//!   the operator's pay agent may call it, so the Duffel token stays here.
//! - `book-offer`: Duffel order over `http-with-placeholders`. Name and email
//!   are `{{profile.*}}` markers the host fills from the customer's T3N
//!   profile; title and phone come from the traveller record; the passport,
//!   with date of birth and sex, from that record or from a passport sealed
//!   with the Private Doc Scanner (`z:<tid>:intake`).
//!
//! Maps (create before first use, readable and writable by this contract):
//! `secrets` (`duffel_api_key`, seeded by the tenant), `travellers` and
//! `orders` (which customer each order was placed for).
//! Hosted once by an operator for many customers. A customer's scanned
//! passport stays in their own tenant (`z:<customer>:intake`); they let this
//! contract read it with a cross-tenant `extraReadGrants` entry.
#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

/// Scanned fields the traveller corrected in the scanner are accepted (z-tenant-flight 0.7.0). PATCH.
pub const CONTRACT_VERSION: &str = "0.9.1";

wit_bindgen::generate!({
    world: "muse-vault-flight",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod booking;
mod payment;
mod countries;
mod search;
pub mod traveller;

struct Component;

#[cfg(target_arch = "wasm32")]
mod store {
    use alloc::format;
    use alloc::string::{String, ToString};
    use alloc::vec::Vec;

    use crate::host::interfaces::{kv_store, logging};
    use crate::host::tenant::tenant_context;
    use crate::traveller;

    /// The caller's own record key. Refused on a delegated call, so an agent
    /// can never write or delete a customer's traveller record.
    fn self_key(op: &str) -> Result<Vec<u8>, String> {
        let user = tenant_context::calling_user_did()
            .ok_or_else(|| format!("{op}: no calling customer; call through an authenticated T3N session"))?;
        if tenant_context::is_delegated() {
            return Err(format!("{op}: only the customer can do this for themselves; an agent cannot"));
        }
        Ok(hex::encode(user).into_bytes())
    }

    fn map() -> String {
        format!("z:{}:{}", hex::encode(tenant_context::tenant_did()), traveller::TRAVELLERS_MAP_TAIL)
    }

    pub fn save(input: &[u8]) -> Result<Vec<u8>, String> {
        let key = self_key("save-traveller")?;
        let t = traveller::parse_traveller(input)?;
        let bytes = serde_json::to_vec(&t).map_err(|e| e.to_string())?;
        kv_store::put(&map(), &key, &bytes)?;
        logging::info("save-traveller: record saved")?;
        serde_json::to_vec(&serde_json::json!({ "saved": true, "has_passport": t.passport.is_some() }))
            .map_err(|e| e.to_string())
    }

    /// The customer's own record, for them to review and edit. Refused on a
    /// delegated call, so an agent can never read it.
    pub fn get() -> Result<Vec<u8>, String> {
        let key = self_key("get-traveller")?;
        match kv_store::get(&map(), &key)? {
            Some(bytes) => {
                let t: traveller::Traveller =
                    serde_json::from_slice(&bytes).map_err(|_| "get-traveller: stored record could not be read".to_string())?;
                serde_json::to_vec(&serde_json::json!({ "found": true, "traveller": t })).map_err(|e| e.to_string())
            }
            None => serde_json::to_vec(&serde_json::json!({ "found": false })).map_err(|e| e.to_string()),
        }
    }

    pub fn forget() -> Result<Vec<u8>, String> {
        let key = self_key("forget-traveller")?;
        let deleted = kv_store::delete(&map(), &key)?;
        logging::info("forget-traveller: record deleted")?;
        serde_json::to_vec(&serde_json::json!({ "deleted": deleted })).map_err(|e| e.to_string())
    }
}

#[cfg(target_arch = "wasm32")]
impl exports::z::muse_vault_flight::contracts::Guest for Component {
    fn save_traveller(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("save-traveller: missing input")?;
        store::save(&input)
    }

    fn get_traveller(
        _req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        store::get()
    }

    fn forget_traveller(
        _req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        store::forget()
    }

    fn search_offers(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("search-offers: missing input")?;
        search::search_offers(&input)
    }

    fn book_offer(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("book-offer: missing input")?;
        booking::place_order(booking::OrderKind::Instant, &input)
    }

    fn hold_offer(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("hold-offer: missing input")?;
        booking::place_order(booking::OrderKind::Hold, &input)
    }

    fn order_status(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("order-status: missing input")?;
        booking::order_status(&input)
    }

    fn pay_hold(
        req: exports::z::muse_vault_flight::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("pay-hold: missing input")?;
        payment::pay_hold(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }
}
