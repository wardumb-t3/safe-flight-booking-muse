// The traveller's own T3N session, in their browser. Everything here runs as
// the traveller (their email sign-in); this page has no server and no key of
// its own. Calls go through the same-origin relay /t3 (a Vercel rewrite to the
// node), and the SDK verifies the node's TDX attestation before trusting it.
import type * as T3n from "@terminal3/t3n-sdk";
import { AGENT_FUNCTIONS, agentName, isMuseAgentName, museVaultGrantees, vaultReadGrant, type OperatorConfig } from "./flow.ts";

/** The traveller record as get-traveller returns it (sex as Duffel's m / f). */
export interface TravellerRecord {
  title: string;
  phone_number: string;
  passport?: { number: string; issuing_country: string; expires_on: string; date_of_birth: string; sex: string };
}

type Sdk = typeof T3n;

export class Session {
  private constructor(
    private readonly sdk: Sdk,
    private readonly client: T3n.T3nClient,
    readonly did: string,
    private readonly baseUrl: string,
  ) {}

  /** Handshake (attestation checked), then email-code sign-in unless a session cookie resumed one. */
  static async signIn(email: string, getOtpCode: () => Promise<string>): Promise<Session> {
    const sdk = await import("@terminal3/t3n-sdk");
    sdk.setEnvironment("testnet");
    const baseUrl = new URL("/t3", location.href).href;
    const trustAnchor = await sdk.fetchTrustedManifest("testnet", { baseUrl });
    if (sdk.isUnsafeTrustServer(trustAnchor)) throw new Error("Refusing an unverified trust anchor.");
    const client = new sdk.T3nClient({ baseUrl, trustAnchor, wasmComponent: await sdk.loadWasmComponent() });
    const hs = await client.handshake();
    let did = hs.did?.value;
    if (!hs.authenticated && !client.isAuthenticated()) {
      did = (await client.authenticate(sdk.createEmailOtpAuthInput({ email, getOtpCode }))).value;
    }
    if (!did || !client.isAuthenticated()) throw new Error("Not signed in to Terminal 3.");
    return new Session(sdk, client, did, baseUrl);
  }

  private tenant() {
    return new this.sdk.TenantClient({ t3n: this.client, baseUrl: this.baseUrl, tenantDid: this.did });
  }

  /** The scanner's view of a request: which documents and fields arrived, never their values. */
  async scannerStatus(requestId: string): Promise<unknown | null> {
    const contract = this.tenant().canonicalName("doc-intake");
    const version = await this.sdk.getContractVersion(this.baseUrl, contract).catch(() => null);
    if (!version) return null;
    return this.client.executeAndDecode({ contract_id: contract, contract_version: version, function_name: "status", input: { request_id: requestId } });
  }

  /** Lets the hosted flight contract read this traveller's scanner vault (and only that map). */
  async grantVaultRead(cfg: OperatorConfig): Promise<void> {
    await this.tenant().maps.update("intake", { extraReadGrants: [vaultReadGrant(cfg)] as unknown as string[] });
  }

  /** Saves (replaces) the traveller record. With a passport, it is used instead of the scan when booking. */
  async saveTraveller(cfg: OperatorConfig, title: string, phone: string, passport?: TravellerRecord["passport"]): Promise<unknown> {
    return this.client.executeAndDecode({
      contract_id: cfg.contract_id,
      contract_version: cfg.contract_version,
      function_name: "save-traveller",
      input: { title, phone_number: phone, ...(passport ? { passport } : {}) },
    });
  }

  /** The traveller's own record, through the contract's self-only get-traveller. */
  async getTraveller(cfg: OperatorConfig): Promise<TravellerRecord | null> {
    const out = (await this.client.executeAndDecode({
      contract_id: cfg.contract_id,
      contract_version: cfg.contract_version,
      function_name: "get-traveller",
      input: {},
    })) as { found: boolean; traveller?: TravellerRecord };
    return out.found && out.traveller ? out.traveller : null;
  }

  /** The traveller's own scanner record (their vault entry), to pre-fill the edit form on their device. */
  async readScanRecord(requestId: string): Promise<unknown | null> {
    const raw = await this.tenant().maps.entryGet("intake", `req:${requestId}`).catch(() => null);
    return raw ? JSON.parse(raw) : null;
  }

  /** The traveller's Muse keys (agents this page created), across their organisations. */
  async listMuseAgents(): Promise<{ did: string; name: string; org: string }[]> {
    const orgData = this.sdk.createOrgDataClientFromSession(this.client, this.baseUrl);
    const out: { did: string; name: string; org: string }[] = [];
    for (const org of (await this.client.myOrgs()).map((d) => d.value)) {
      let cursor: string | undefined;
      do {
        const page = await orgData.listAgents({ orgDid: org, limit: 50, ...(cursor ? { cursor } : {}) });
        for (const a of page.agents) if (isMuseAgentName(a.name)) out.push({ did: a.did, name: a.name, org });
        cursor = page.next_cursor;
      } while (cursor);
    }
    // Dated names sort oldest first; newest last.
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** All of the traveller's standing delegation grants. */
  async delegationGrants(): Promise<{ grantee: string; contract_id: string; function?: string }[]> {
    return (await this.client.getMemberDelegation()).grants;
  }

  /**
   * Retires the traveller's earlier muse-vault keys, except `keep`: removes their
   * grants (freeing delegate slots) and deletes the agents where this account
   * administers them. Returns how many keys were retired.
   */
  async retireMuseKeys(cfg: OperatorConfig, keep?: string): Promise<number> {
    const old = museVaultGrantees(await this.delegationGrants(), cfg.contract_id).filter((d) => d !== keep);
    if (old.length) await this.client.removeMemberDelegationGrants(old.map((grantee) => ({ grantee })));
    const agents = await this.listMuseAgents().catch(() => []);
    for (const a of agents) {
      if (a.did !== keep && (old.includes(a.did) || !keep)) {
        await this.client.deleteAgent(a.org, a.did).catch(() => { /* already gone, or not ours to delete */ });
      }
    }
    return old.length;
  }

  /** The traveller's spendable balance, in whole credits. */
  async availableCredits(): Promise<number> {
    return (await this.client.getBalance()).available / 1_000_000;
  }

  async fundAgent(agentDid: string, credits: number): Promise<void> {
    await this.client.fundAgent(agentDid, this.sdk.toBaseUnits(credits));
  }

  /** Creates Muse's agent (in the traveller's own organisation) and grants it search / hold / status only. */
  async createMuseAgent(cfg: OperatorConfig): Promise<{ agentDid: string; apiKey: string }> {
    const orgs = (await this.client.myOrgs()).map((d) => d.value);
    const org = orgs[0] ?? (await this.client.createOrganisation("muse-vault")).value;
    const agent = await this.client.createAgent(org, agentName());
    const agentDid = agent.agentDid.value;
    await this.client.updateMemberDelegation(
      this.sdk.fanOutGrant<T3n.BoundGrant>(
        { grantee: agentDid, contract_id: cfg.contract_id, scopes: [], allowed_hosts: [cfg.duffel_host] },
        AGENT_FUNCTIONS,
      ),
    );
    return { agentDid, apiKey: agent.apiKey };
  }
}
