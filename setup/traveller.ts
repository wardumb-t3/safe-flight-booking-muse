/**
 * Traveller setup, run once on your own computer (never inside Muse: it uses
 * your T3N key, which can read your own vault).
 *
 *   npm run traveller -- --config https://<pay server>/muse-vault.json
 *
 * 1. Checks your passport is in your Private Doc Scanner vault.
 * 2. Lets the muse-vault flight contract read that vault (and nothing else).
 * 3. Saves your title and phone number to the contract (typed here, never in a chat).
 * 4. Creates an agent key for Muse, grants it search / hold / status only, and funds it.
 * 5. Prints the connector card you give Muse.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fanOutGrant, toBaseUnits, type BoundGrant } from "@terminal3/t3n-sdk";
import { AGENT_FUNCTIONS, loadOperatorConfig, recordEnv, signIn } from "./common.js";

const DEFAULT_CREDITS = 300;
const TITLES = ["mr", "ms", "mrs", "miss", "dr"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const configSource = arg("--config") ?? process.env.MUSE_VAULT_CONFIG;
if (!configSource) throw new Error("usage: npm run traveller -- --config https://<pay server>/muse-vault.json");
const cfg = await loadOperatorConfig(configSource);
const rl = createInterface({ input: stdin, output: stdout });

console.log(`\nmuse-vault: flight contract ${cfg.contract_id} ${cfg.contract_version}\n`);
const { t3n, tenant, did } = await signIn();
console.log(`signed in as ${did}`);

// 1. Passport vault.
const scannerId = Number(await tenant.maps.entryGet("config", "contract_id").catch(() => null));
if (!scannerId) {
  console.log(
    "\nNo Private Doc Scanner vault found in your account yet.\n" +
      "Scan your passport first: open the scanner link Muse gave you on your phone, sign in with the same\n" +
      "email as this T3N account, and finish 'Seal and send'. Then run this again.",
  );
  process.exit(1);
}
console.log(`passport vault found (scanner contract ${scannerId})`);

// 2. Cross-tenant read grant: the hosted contract may read your scanner vault's intake map.
// `readers` only takes contracts in your own tenant, so a foreign contract goes in extraReadGrants.
const grantEntry = { tenant_contract: { tenant: cfg.operator_tenant_did, contract: cfg.contract_numeric_id } };
await tenant.maps.update("intake", { extraReadGrants: [grantEntry] as unknown as string[] });
console.log(`your vault ${tenant.canonicalName("intake")} is now readable by ${cfg.contract_id} (contract ${cfg.contract_numeric_id})`);

// 3. Traveller record: title and phone, typed here.
let title = "";
while (!TITLES.includes(title)) title = (await rl.question(`Title (${TITLES.join("/")}): `)).trim().toLowerCase();
let phone = "";
while (!/^\+[1-9]\d{6,14}$/.test(phone)) phone = (await rl.question("Phone in international format (e.g. +6591234567): ")).replace(/[\s-]/g, "");
const saved = await t3n.executeAndDecode({
  contract_id: cfg.contract_id,
  contract_version: cfg.contract_version,
  function_name: "save-traveller",
  input: { title, phone_number: phone },
});
console.log("save-traveller:", saved);

// 4. Agent for Muse.
let agentDid = process.env.AGENT_DID?.trim();
let newKey: string | undefined;
if (!agentDid) {
  const orgs = (await t3n.myOrgs()).map((d) => d.value);
  let org = process.env.ORG_DID?.trim() || orgs[0];
  if (!org) {
    org = (await t3n.createOrganisation("muse-vault")).value;
    console.log(`created organisation ${org}`);
  }
  recordEnv("ORG_DID", org);
  const agent = await t3n.createAgent(org, "Muse (muse-vault)");
  agentDid = agent.agentDid.value;
  newKey = agent.apiKey;
  recordEnv("AGENT_DID", agentDid);
  console.log(`created agent ${agentDid}`);
}
await t3n.updateMemberDelegation(
  fanOutGrant<BoundGrant>(
    { grantee: agentDid, contract_id: cfg.contract_id, scopes: [], allowed_hosts: [cfg.duffel_host] },
    AGENT_FUNCTIONS,
  ),
);
console.log(`granted ${agentDid}: ${AGENT_FUNCTIONS.join(", ")} (egress ${cfg.duffel_host} only)`);
const credits = Number(arg("--credits") ?? DEFAULT_CREDITS);
await t3n.fundAgent(agentDid, toBaseUnits(credits));
console.log(`funded the agent with ${credits} credits from your balance`);

const scannerRef = (await rl.question("\nScanner reference for your passport (the vault_… id in the scan link Muse gave you; Enter to skip): ")).trim();
rl.close();

// 5. Connector card.
console.log(`
──────────────── muse-vault connector card ────────────────
Give Muse everything below EXCEPT the key line, in chat.
Give the key only in Muse's secure credential field when it asks.

  node_url            ${cfg.node_url}
  contract_id         ${cfg.contract_id}
  contract_version    ${cfg.contract_version}
  pii_did             ${did}
  scanner_request_id  ${scannerRef || "(ask the traveller)"}
  pay_base_url        ${cfg.pay_base_url}
${newKey ? `\n  X-T3N-Api-Key       ${newKey}\n  (shown once; store it in Muse's secure credential field, nowhere else)` : "\n  X-T3N-Api-Key       the agent key you saved when the agent was created"}
───────────────────────────────────────────────────────────
`);
