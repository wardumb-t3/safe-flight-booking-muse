import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  T3nClient,
  TenantClient,
  setEnvironment,
  loadWasmComponent,
  resolveTrustAnchor,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

export const TAIL = "muse-flight";
/** The contract's version, read from its Cargo.toml so the setup scripts can't drift from the build. */
export const VERSION = (() => {
  const toml = readFileSync(new URL("../contract/Cargo.toml", import.meta.url), "utf8");
  const v = toml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!v) throw new Error("could not read the contract version from contract/Cargo.toml");
  return v;
})();
export const DUFFEL_HOST = "api.duffel.com";
/** Functions the traveller's Muse agent may call. book-offer (instant) is deliberately left out. */
export const AGENT_FUNCTIONS = ["search-offers", "hold-offer", "order-status"];

/** What the operator publishes and every traveller's setup reads. No secrets in here. */
export interface OperatorConfig {
  node_url: string;
  operator_tenant_did: string;
  contract_id: string; // z:<operator tid>:muse-flight
  contract_numeric_id: number;
  contract_version: string;
  pay_base_url: string; // e.g. https://probe.example.com
  duffel_host: string;
}

export function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. Add it to setup/.env (see .env.example); never paste it into a chat.`);
  return v;
}

export async function signIn() {
  setEnvironment("testnet");
  const key = need("T3N_API_KEY");
  const address = eth_get_address(key);
  const t3n = new T3nClient({
    trustAnchor: await resolveTrustAnchor("testnet"),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });
  await t3n.handshake();
  const did = (await t3n.authenticate(createEthAuthInput(address))).value;
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid: did });
  return { t3n, tenant, did };
}

/** Sets KEY=value in setup/.env, replacing an existing line. Only for non-secret values. */
export function recordEnv(key: string, value: string) {
  const line = `${key}=${value}`;
  const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(".env", pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`.trimStart());
}

export async function loadOperatorConfig(source: string): Promise<OperatorConfig> {
  const text = /^https?:\/\//.test(source) ? await (await fetch(source)).text() : readFileSync(source, "utf8");
  const cfg = JSON.parse(text) as OperatorConfig;
  for (const k of ["operator_tenant_did", "contract_id", "contract_numeric_id", "contract_version", "pay_base_url"] as const) {
    if (!cfg[k]) throw new Error(`operator config is missing ${k}`);
  }
  return cfg;
}
