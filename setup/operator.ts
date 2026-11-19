/**
 * Operator setup, run once by whoever hosts muse-vault (e.g. Terminal 3).
 *
 *   npm run operator -- --pay-url https://pay.example.com [--out ../server/public/muse-vault.json]
 *
 * Registers the flight contract in the operator's own tenant, creates its
 * private maps, seals the Duffel token there (no traveller ever holds it),
 * creates the pay agent the pay server uses (it can call `pay-hold` only),
 * and writes the public config that travellers' setup reads.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fanOutGrant, getContractVersion, getNodeUrl, toBaseUnits, type BoundGrant, type TenantClient } from "@terminal3/t3n-sdk";
import { DUFFEL_HOST, TAIL, VERSION, need, recordEnv, signIn, type OperatorConfig } from "./common.js";

const WASM_CANDIDATES = [
  new URL("../contract/target/wasm32-wasip2/release/muse_vault_flight.wasm", import.meta.url),
  new URL("./muse_vault_flight.wasm", import.meta.url),
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function createMap(tenant: TenantClient, tail: string, id: number) {
  const acl = { readers: { only: [id] }, writers: { only: [id] } };
  try {
    await tenant.maps.create({ tail, visibility: "private", ...acl });
  } catch (err) {
    if (!/already.?exists/i.test(String((err as Error).message))) throw err;
    await tenant.maps.update(tail, acl);
  }
  console.log(`map ${tenant.canonicalName(tail)} → contract ${id}`);
}

const payUrl = arg("--pay-url")?.replace(/\/+$/, "");
if (!payUrl || !/^https:\/\//.test(payUrl)) throw new Error("usage: npm run operator -- --pay-url https://<your pay server>");
const out = arg("--out") ?? "../server/public/muse-vault.json";

const duffelKey = need("DUFFEL_API_KEY");
if (!duffelKey.startsWith("duffel_test_") && process.env.ALLOW_LIVE !== "1") {
  throw new Error("DUFFEL_API_KEY must be a Duffel test token (duffel_test_…) unless ALLOW_LIVE=1");
}

const { t3n, tenant, did } = await signIn();
const contractId = `z:${did.slice("did:t3n:".length)}:${TAIL}`;

let deployed: string | null = null;
try { deployed = await getContractVersion(getNodeUrl(), contractId); } catch { /* not registered yet */ }

let id: number;
if (deployed !== VERSION) {
  const wasmUrl = WASM_CANDIDATES.find((u) => existsSync(u));
  if (!wasmUrl) throw new Error("No contract build found: run `cargo build --release` in muse-vault/contract.");
  const wasm = readFileSync(wasmUrl);
  console.log(`wasm sha256 ${createHash("sha256").update(wasm).digest("hex")}`);
  id = (await tenant.contracts.register({ tail: TAIL, version: VERSION, wasm })).contract_id;
  recordEnv("OPERATOR_CONTRACT_ID", String(id));
  console.log(`registered ${contractId} ${VERSION} as contract id ${id}`);
} else {
  // T3N has no call that looks an existing contract's id up again.
  id = Number(process.env.OPERATOR_CONTRACT_ID);
  if (!id) throw new Error(`${contractId} ${VERSION} is registered but OPERATOR_CONTRACT_ID is not in setup/.env`);
  console.log(`${contractId} ${VERSION} already registered (contract id ${id})`);
}

await createMap(tenant, "secrets", id);
await createMap(tenant, "travellers", id);
await createMap(tenant, "orders", id);
await tenant.maps.entrySet("secrets", "duffel_api_key", duffelKey);
console.log("Duffel token sealed in secrets (not shown)");

// The pay agent: the pay server's only credential. It may call pay-hold, for
// the operator, and the contract checks it is exactly this agent.
let payAgent = process.env.PAY_AGENT_DID?.trim();
let payKey: string | undefined;
if (!payAgent) {
  const orgs = (await t3n.myOrgs()).map((d) => d.value);
  let org = process.env.OPERATOR_ORG_DID?.trim() || orgs[0];
  if (!org) org = (await t3n.createOrganisation("muse-vault operator")).value;
  recordEnv("OPERATOR_ORG_DID", org);
  const agent = await t3n.createAgent(org, "muse-vault pay server");
  payAgent = agent.agentDid.value;
  payKey = agent.apiKey;
  recordEnv("PAY_AGENT_DID", payAgent);
  console.log(`created pay agent ${payAgent}`);
}
await tenant.maps.entrySet("secrets", "pay_agent_did", payAgent.slice("did:t3n:".length).toLowerCase());
await t3n.updateMemberDelegation(
  fanOutGrant<BoundGrant>({ grantee: payAgent, contract_id: contractId, scopes: [], allowed_hosts: [DUFFEL_HOST] }, ["pay-hold"]),
);
console.log(`granted ${payAgent}: pay-hold (egress ${DUFFEL_HOST} only)`);
const credits = Number(arg("--pay-credits") ?? 200);
if (credits > 0) {
  await t3n.fundAgent(payAgent, toBaseUnits(credits));
  console.log(`funded the pay agent with ${credits} credits`);
}

const config: OperatorConfig = {
  node_url: getNodeUrl(),
  operator_tenant_did: did,
  contract_id: contractId,
  contract_numeric_id: id,
  contract_version: VERSION,
  pay_base_url: payUrl,
  duffel_host: DUFFEL_HOST,
};
writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
console.log(`wrote ${out}; publish it at ${payUrl}/muse-vault.json`);
if (payKey) {
  console.log(`\nPay agent key (shown once). Put it in the pay server's /etc/muse-vault.env as\n  T3N_PAY_AGENT_KEY=${payKey}\nand nowhere else.`);
}
