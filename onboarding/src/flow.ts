// Pure helpers for the onboarding flow (no SDK, no DOM), unit-tested in test/.

export interface OperatorConfig {
  node_url: string;
  operator_tenant_did: string;
  contract_id: string;
  contract_numeric_id: number;
  contract_version: string;
  pay_base_url: string;
  duffel_host: string;
}

export const TITLES = ["mr", "ms", "mrs", "miss", "dr"] as const;
export const AGENT_FUNCTIONS = ["search-offers", "hold-offer", "order-status"];
/** The Private Doc Scanner the setup page sends travellers to. Terminal 3's hosted copy by default; set VITE_SCANNER_URL at build time to use your own. */
export const SCANNER_URL: string =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_SCANNER_URL) ||
  "https://experiments-eta-ten.vercel.app/";
/** Credits to give Muse's agent. On testnet one search plus one booking used about 100 (z-tenant-flight README). */
export const TARGET_AGENT_CREDITS = 200;
/** Never fund below this: fewer won't cover a search and a hold. */
export const MIN_AGENT_CREDITS = 100;
/** Left in the traveller's own balance for their own calls (sign-in, grants, re-running setup). */
export const KEEP_FOR_TRAVELLER = 30;

/** How much to fund the agent from what the traveller has, in whole credits. */
export function fundingPlan(availableCredits: number): { amount: number; enough: boolean } {
  const amount = Math.min(TARGET_AGENT_CREDITS, Math.floor(availableCredits - KEEP_FOR_TRAVELLER));
  return amount >= MIN_AGENT_CREDITS ? { amount, enough: true } : { amount: 0, enough: false };
}

/** Agents get a dated name, so a traveller can tell their current Muse key from older ones. */
export const AGENT_NAME_PREFIX = "Muse (muse-vault)";
export function agentName(now = new Date()): string {
  return `${AGENT_NAME_PREFIX} ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
export const isMuseAgentName = (name: string) => name.startsWith(AGENT_NAME_PREFIX);

/** 128 random bits, as the scanner expects: the first account to seal to an id owns it. */
export function newRequestId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return "vault_" + [...random(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const validRequestId = (id: string) => /^vault_[0-9a-f]{32}$/.test(id);

export function scanLink(requestId: string, base = SCANNER_URL): string {
  return `${base.replace(/\/?$/, "/")}?req=${requestId}&types=passport`;
}

/** Normalises and checks a phone number in international format; returns null if invalid. */
export function normalisePhone(raw: string): string | null {
  const p = raw.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** The cross-tenant read grant on the traveller's scanner vault for the hosted contract. */
export function vaultReadGrant(cfg: OperatorConfig) {
  return { tenant_contract: { tenant: cfg.operator_tenant_did, contract: cfg.contract_numeric_id } };
}

/** Whether the scanner's `status` view says a passport arrived for this request. */
export function passportReceived(status: unknown): boolean {
  const s = status as { received?: boolean; doc_type?: string; documents?: { doc_type?: string }[] } | null;
  if (!s || s.received === false) return false;
  if (s.doc_type) return s.doc_type === "passport";
  return Array.isArray(s.documents) ? s.documents.some((d) => d.doc_type === "passport") : Boolean(s.received);
}

/**
 * The one message the traveller pastes into Muse: what muse-vault is, where its
 * guide is, and the non-secret settings. Never includes the agent key, which
 * goes into Muse's secure credential field.
 */
export function connectorSettings(cfg: OperatorConfig, piiDid: string, requestId: string, agentDid?: string): string {
  return [
    `Create a custom connector called "muse-vault" so you can book flights for me without seeing my passport.`,
    `Read its guide first and follow it: ${cfg.pay_base_url}/muse.md`,
    `Ask me for the agent key in your secure credential field; don't ask for it in chat.`,
    ``,
    `muse-vault connector settings (not secret):`,
    `node_url: ${cfg.node_url}`,
    `contract_id: ${cfg.contract_id}`,
    `contract_version: ${cfg.contract_version}`,
    `pii_did: ${piiDid}`,
    `scanner_request_id: ${requestId}`,
    `pay_base_url: ${cfg.pay_base_url}`,
    ...(agentDid ? [`agent_did: ${agentDid}`] : []),
  ].join("\n");
}

/** The passport fields a traveller can edit, as the contract's save-traveller takes them. */
export interface PassportForm {
  number: string;
  issuing_country: string;
  expires_on: string;
  date_of_birth: string;
  sex: "M" | "F" | "";
}

/** "Female", "f", "FEMALE" → "F"; "Male", "m" → "M"; anything else → "" (the traveller chooses). */
export function normaliseSex(raw: unknown): "M" | "F" | "" {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "F" || s === "FEMALE") return "F";
  if (s === "M" || s === "MALE") return "M";
  return "";
}

/** Pre-fill values from the traveller's own scanner record (their vault entry `req:<id>`). */
export function passportFromScanRecord(record: unknown): PassportForm | null {
  const docs = (record as { submission?: { documents?: { doc_type?: string; fields?: Record<string, { value?: string }> }[] } })
    ?.submission?.documents;
  const doc = docs?.find((d) => d.doc_type === "passport");
  if (!doc?.fields) return null;
  const v = (k: string) => String(doc.fields?.[k]?.value ?? "");
  return {
    number: v("document_number"),
    issuing_country: v("issuing_country"),
    expires_on: v("date_of_expiry"),
    date_of_birth: v("date_of_birth"),
    sex: normaliseSex(v("sex")),
  };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

/** Field-level problems with a passport form; empty when it can be saved. Messages never repeat the value. */
export function passportProblems(p: PassportForm): string[] {
  const out: string[] = [];
  if (!p.number.trim()) out.push("Passport number is required.");
  if (!/^[A-Za-z]{2,3}$/.test(p.issuing_country.trim())) out.push("Issuing country must be a 2- or 3-letter code, e.g. SG or SGP.");
  if (!isDate(p.expires_on)) out.push("Expiry date must be YYYY-MM-DD.");
  if (!isDate(p.date_of_birth)) out.push("Date of birth must be YYYY-MM-DD.");
  if (p.sex !== "M" && p.sex !== "F") out.push("Choose M or F, as printed on the passport.");
  return out;
}

/** The most agents one account can grant access to (T3N's MAX_DELEGATEES). */
export const MAX_DELEGATEES = 10;

/**
 * Grantees that are muse-vault keys: every one of their grants is on the
 * muse-vault contract. Grants to anything else are never touched.
 */
export function museVaultGrantees(grants: { grantee: string; contract_id: string; function?: string }[], contractId: string): string[] {
  const contracts = new Map<string, Set<string>>();
  const payAgents = new Set<string>();
  for (const g of grants) {
    const set = contracts.get(g.grantee) ?? new Set<string>();
    set.add(g.contract_id);
    contracts.set(g.grantee, set);
    // The operator's pay agent also holds only muse-vault grants; never retire it.
    if (g.function === "pay-hold") payAgents.add(g.grantee);
  }
  return [...contracts]
    .filter(([did, ids]) => !payAgents.has(did) && [...ids].every((id) => id === contractId))
    .map(([did]) => did);
}

/** How many distinct grantees the account has. */
export const granteeCount = (grants: { grantee: string }[]) => new Set(grants.map((g) => g.grantee)).size;
