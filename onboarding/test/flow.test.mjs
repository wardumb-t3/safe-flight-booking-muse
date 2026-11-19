import { test } from "node:test";
import assert from "node:assert/strict";
import { fundingPlan, connectorSettings, newRequestId, normalisePhone, passportReceived, scanLink, validEmail, validRequestId, vaultReadGrant } from "../src/flow.ts";

const cfg = { node_url: "https://n", operator_tenant_did: "did:t3n:op", contract_id: "z:op:muse-flight", contract_numeric_id: 1145, contract_version: "0.9.1", pay_base_url: "https://pay", duffel_host: "api.duffel.com" };

test("request ids are 128-bit hex and validated", () => {
  const id = newRequestId();
  assert.ok(validRequestId(id), id);
  assert.notEqual(id, newRequestId());
  assert.equal(newRequestId(() => new Uint8Array(16)), "vault_" + "00".repeat(16));
  for (const bad of ["", "vault_", "vault_XYZ", "vault_" + "0".repeat(31), "req_" + "0".repeat(32)]) assert.ok(!validRequestId(bad), bad);
});

test("scan link asks for a passport", () => {
  assert.equal(scanLink("vault_ab", "https://s.example"), "https://s.example/?req=vault_ab&types=passport");
});

test("phone normalisation", () => {
  assert.equal(normalisePhone("+65 9123-4567"), "+6591234567");
  assert.equal(normalisePhone("(+44) 20 7123 4567"), "+442071234567");
  for (const bad of ["91234567", "+0123456789", "+65", "+65 abc"]) assert.equal(normalisePhone(bad), null, bad);
});

test("email check", () => {
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("a@b"));
});

test("cross-tenant grant names the hosted contract", () => {
  assert.deepEqual(vaultReadGrant(cfg), { tenant_contract: { tenant: "did:t3n:op", contract: 1145 } });
});

test("passport detection from the scanner status view", () => {
  assert.ok(!passportReceived(null));
  assert.ok(!passportReceived({ request_id: "x", received: false }));
  assert.ok(passportReceived({ received: true, documents: [{ doc_type: "passport" }] }));
  assert.ok(!passportReceived({ received: true, documents: [{ doc_type: "payslip" }] }));
});

test("connector settings never contain the key", () => {
  const s = connectorSettings(cfg, "did:t3n:me", "vault_ab");
  assert.match(s, /pii_did: did:t3n:me/);
  assert.match(s, /scanner_request_id: vault_ab/);
  assert.match(s, /https:\/\/pay\/muse\.md/);
  assert.match(s, /custom connector called "muse-vault"/);
  assert.doesNotMatch(s, /t3n_key_/);
});

test("funding plan fits the traveller's balance", () => {
  assert.deepEqual(fundingPlan(1000), { amount: 200, enough: true });
  assert.deepEqual(fundingPlan(246.07), { amount: 200, enough: true });
  assert.deepEqual(fundingPlan(150), { amount: 120, enough: true });
  assert.deepEqual(fundingPlan(100), { amount: 0, enough: false });
  assert.deepEqual(fundingPlan(0), { amount: 0, enough: false });
});

import { normaliseSex, passportFromScanRecord, passportProblems } from "../src/flow.ts";

test("sex is normalised to M or F", () => {
  for (const [raw, want] of [["Female", "F"], ["female", "F"], ["F", "F"], ["MALE", "M"], ["m", "M"], ["X", ""], ["<", ""], [undefined, ""]]) {
    assert.equal(normaliseSex(raw), want, String(raw));
  }
});

test("pre-fill from a scanner record maps the fields and fixes sex", () => {
  const rec = { owner: "1", submission: { documents: [{ doc_type: "passport", fields: {
    document_number: { value: "000000000" }, issuing_country: { value: "GBR" }, date_of_expiry: { value: "2031-04-11" },
    date_of_birth: { value: "1990-04-12" }, sex: { value: "Female" } } }] } };
  assert.deepEqual(passportFromScanRecord(rec), { number: "000000000", issuing_country: "GBR", expires_on: "2031-04-11", date_of_birth: "1990-04-12", sex: "F" });
  assert.equal(passportFromScanRecord({ submission: { documents: [{ doc_type: "payslip", fields: {} }] } }), null);
  assert.equal(passportFromScanRecord(null), null);
});

test("passport form validation names fields, not values", () => {
  assert.deepEqual(passportProblems({ number: "X1", issuing_country: "SG", expires_on: "2031-01-01", date_of_birth: "1990-01-01", sex: "F" }), []);
  const p = passportProblems({ number: " ", issuing_country: "Singapore", expires_on: "01/01/2031", date_of_birth: "1990-13-45", sex: "" });
  assert.equal(p.length, 5);
  assert.ok(p.every((m) => !m.includes("Singapore") && !m.includes("01/01/2031")));
});

import { agentName, isMuseAgentName } from "../src/flow.ts";

test("agent names are dated and recognisable", () => {
  const n = agentName(new Date("2026-11-19T10:42:05Z"));
  assert.equal(n, "Muse (muse-vault) 2026-11-19 10:42 UTC");
  assert.ok(isMuseAgentName(n));
  assert.ok(isMuseAgentName("Muse (muse-vault)"));
  assert.ok(!isMuseAgentName("muse-vault pay server"));
});

test("settings carry the agent DID when known, never the key", () => {
  const s = connectorSettings(cfg, "did:t3n:me", "vault_ab", "did:t3n:agent");
  assert.match(s, /agent_did: did:t3n:agent/);
  assert.doesNotMatch(connectorSettings(cfg, "did:t3n:me", "vault_ab"), /agent_did/);
});

import { museVaultGrantees, granteeCount } from "../src/flow.ts";

test("only grantees whose every grant is on muse-vault count as muse-vault keys", () => {
  const C = "z:op:muse-flight";
  const grants = [
    { grantee: "did:t3n:a", contract_id: C }, { grantee: "did:t3n:a", contract_id: C },
    { grantee: "did:t3n:b", contract_id: C }, { grantee: "did:t3n:b", contract_id: "z:other:app" },
    { grantee: "did:t3n:c", contract_id: "z:other:app" },
    { grantee: "did:t3n:d", contract_id: C },
  ];
  assert.deepEqual(museVaultGrantees(grants, C), ["did:t3n:a", "did:t3n:d"]);
  const withPayAgent = [...grants, { grantee: "did:t3n:pay", contract_id: C, function: "pay-hold" }];
  assert.ok(!museVaultGrantees(withPayAgent, C).includes("did:t3n:pay"), "the pay agent is never retired");
  assert.equal(granteeCount(grants), 4);
});
