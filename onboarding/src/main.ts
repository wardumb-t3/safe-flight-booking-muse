import QRCode from "qrcode";
import config from "../../server/public/muse-vault.json";
import {
  TITLES, fundingPlan, connectorSettings, newRequestId, normalisePhone, normaliseSex,
  passportFromScanRecord, passportProblems, passportReceived, scanLink, validEmail, validRequestId,
  type OperatorConfig, type PassportForm,
} from "./flow.ts";
import type { Session } from "./t3n.ts";

const cfg = config as OperatorConfig;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLParagraphElement>("status");
const say = (text: string, bad = false) => { statusEl.textContent = text; statusEl.className = bad ? "bad" : ""; };

// Per-browser memory of the scan request and email, so a reload resumes the flow.
const store = {
  get: (k: string) => { try { return localStorage.getItem(`muse-vault:${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`muse-vault:${k}`, v); } catch { /* private mode */ } },
};

let requestId = new URLSearchParams(location.search).get("req") ?? store.get("req") ?? "";
if (!validRequestId(requestId)) requestId = newRequestId();
store.set("req", requestId);
let session: Session | null = null;
// "?edit": a returning traveller reviewing or correcting their details.
const editMode = new URLSearchParams(location.search).has("edit");

function show(step: string) {
  for (const s of ["scan", "signin", "details", "edit", "done"]) {
    const el = $(`s-${s}`);
    el.hidden = s !== step && !(s === "scan" && !editMode && step !== "done" && step !== "edit");
    el.classList.toggle("done", s !== step);
  }
}

// 1. Scan.
const link = scanLink(requestId);
$<HTMLAnchorElement>("scan-link").href = link;
QRCode.toCanvas($<HTMLCanvasElement>("qr"), link, { width: 180, margin: 1 }).catch(() => { $("qr").hidden = true; });
$("scan-done").addEventListener("click", () => { show("signin"); $<HTMLInputElement>("email").focus(); });

// 2. Sign in with an email code.
const emailEl = $<HTMLInputElement>("email");
emailEl.value = store.get("email") ?? "";
let resolveCode: ((code: string) => void) | null = null;
$("signin").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("signin");
  if (resolveCode) {
    const code = $<HTMLInputElement>("otp").value.trim();
    if (!/^\d{4,8}$/.test(code)) return say("Enter the code from the email.", true);
    btn.disabled = true;
    say("Checking the code…");
    resolveCode(code);
    return;
  }
  const email = emailEl.value.trim();
  if (!validEmail(email)) return say("Enter a valid email.", true);
  store.set("email", email);
  btn.disabled = true;
  say("Checking the Terminal 3 enclave and sending your code…");
  try {
    const { Session } = await import("./t3n.ts");
    session = await Session.signIn(email, () => new Promise<string>((resolve) => {
      resolveCode = resolve;
      $("otp-row").hidden = false;
      btn.textContent = "Sign in";
      btn.disabled = false;
      $<HTMLInputElement>("otp").focus();
      say("We've emailed you a code.");
    }));
    say(`Signed in as ${session.did}`);
    const credits = await session.availableCredits().catch(() => null);
    if (credits !== null) $("vault-state").dataset.credits = String(credits);
    if (editMode) await loadEdit();
    else await checkVault();
  } catch (err) {
    resolveCode = null;
    btn.textContent = "Send me a code";
    btn.disabled = false;
    $("otp-row").hidden = true;
    say(`Sign-in failed: ${(err as Error).message}`, true);
  }
});

// 3. Vault check, details, connect.
const titleEl = $<HTMLSelectElement>("title");
for (const t of TITLES) titleEl.add(new Option(t[0].toUpperCase() + t.slice(1), t));

async function checkVault() {
  show("details");
  const state = $("vault-state");
  state.textContent = "Looking for your sealed passport…";
  try {
    const status = await session!.scannerStatus(requestId);
    if (status === null) {
      state.textContent = "No scanner vault on this account yet. Scan and seal your passport first (step 1), signed in with this same email, then press Connect.";
      return;
    }
    if (!passportReceived(status)) {
      state.textContent = "Your vault doesn't have this passport scan yet. Finish 'Seal and send' in the scanner, then press Connect again.";
    } else {
      state.textContent = "✓ Passport found in your vault (checked by the enclave; this page never sees its values).";
      const credits = Number(state.dataset.credits);
      if (Number.isFinite(credits)) state.textContent += ` Your account has ${Math.floor(credits)} test credits.`;
    }
    $<HTMLButtonElement>("connect").disabled = false;
  } catch (err) {
    state.textContent = `Couldn't check the vault: ${(err as Error).message}`;
  }
}

$("connect").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("connect");
  const title = titleEl.value;
  const phone = normalisePhone($<HTMLInputElement>("phone").value);
  if (!title) return say("Choose your title.", true);
  if (!phone) return say("Enter your phone in international format, e.g. +6591234567.", true);
  btn.disabled = true;
  let step = "checking the passport scan";
  const at = (name: string, text: string) => { step = name; say(text); };
  try {
    at("checking the passport scan", "Checking the passport scan…");
    const st = await session!.scannerStatus(requestId).catch(() => null);
    // A returning traveller on a new device has a new scan reference; a passport
    // they saved earlier on the edit page is enough to connect.
    const saved = st !== null && passportReceived(st) ? null : await session!.getTraveller(cfg).catch(() => null);
    if ((st === null || !passportReceived(st)) && !saved?.passport) {
      btn.disabled = false;
      return say("Your vault doesn't have this passport scan yet. Finish 'Seal and send' in the scanner first, or, if you set up muse-vault before, use 'Review or correct your travel details' to check your saved passport.", true);
    }
    at("granting the flight contract read access", "Letting the flight contract read your passport vault…");
    await session!.grantVaultRead(cfg);
    at("saving title and phone", "Saving your title and phone inside the enclave…");
    await session!.saveTraveller(cfg, title, phone);
    // A new key replaces any earlier muse-vault key: their grants would otherwise
    // pile up against T3N's limit of 10 delegates per account.
    at("retiring earlier Muse keys", "Retiring any earlier muse-vault keys…");
    const retired = await session!.retireMuseKeys(cfg);
    at("creating Muse's key", retired ? `Retired ${retired} earlier key(s). Creating Muse's new key…` : "Creating Muse's limited key…");
    const agent = await session!.createMuseAgent(cfg);
    // Show the key before anything else can fail: it can't be fetched again.
    $("agent-key").textContent = agent.apiKey;
    $("settings").textContent = connectorSettings(cfg, session!.did, requestId, agent.agentDid);
    store.set("agent", agent.agentDid);
    show("done");
    agentDid = agent.agentDid;
    await fund();
  } catch (err) {
    btn.disabled = false;
    const msg = (err as Error).message;
    const hint = /InsufficientCredit|insufficient credit/i.test(msg)
      ? " Your Terminal 3 account doesn't have enough test credits for this step."
      : /delegat/i.test(msg) && /max|limit|too many|10/i.test(msg)
        ? " Your account has reached Terminal 3's limit of 10 delegates. Earlier muse-vault keys were retired; the rest belong to other apps. Remove one in your Terminal 3 dashboard and try again."
        : "";
    say(`Setup failed while ${step}: ${msg}.${hint}`, true);
  }
});

// Edit mode: review and correct the saved record.
for (const t of TITLES) $<HTMLSelectElement>("e-title").add(new Option(t[0].toUpperCase() + t.slice(1), t));
const ef = {
  title: $<HTMLSelectElement>("e-title"), phone: $<HTMLInputElement>("e-phone"), number: $<HTMLInputElement>("e-number"),
  country: $<HTMLInputElement>("e-country"), expiry: $<HTMLInputElement>("e-expiry"), dob: $<HTMLInputElement>("e-dob"),
  sex: $<HTMLSelectElement>("e-sex"),
};
function fillPassport(p: PassportForm) {
  ef.number.value = p.number; ef.country.value = p.issuing_country; ef.expiry.value = p.expires_on;
  ef.dob.value = p.date_of_birth; ef.sex.value = p.sex;
}
async function loadEdit() {
  show("edit");
  void loadTopUp();
  const source = $("edit-source");
  say("Loading your details…");
  try {
    // Re-applied on every visit, so a new contract version can still read the scan.
    await session!.grantVaultRead(cfg).catch(() => { /* no scanner vault: hand-entered passport only */ });
    const rec = await session!.getTraveller(cfg);
    if (rec) { ef.title.value = rec.title; ef.phone.value = rec.phone_number; }
    if (rec?.passport) {
      fillPassport({ ...rec.passport, sex: normaliseSex(rec.passport.sex) });
      source.textContent = "Showing the passport details you saved by hand. They're used instead of your scan.";
    } else {
      const scan = passportFromScanRecord(await session!.readScanRecord(requestId));
      if (scan) fillPassport(scan);
      source.textContent = scan
        ? "Pre-filled from your passport scan, loaded only into this page on your device. Check every field (especially Sex: M or F), then save."
        : "No saved passport or scan found for this browser. Enter the details as printed on your passport.";
    }
    say(rec ? "Loaded. Correct anything that's wrong, then save." : "No travel details saved yet. Fill them in and save.");
  } catch (err) {
    say(`Couldn't load your details: ${(err as Error).message}`, true);
  }
}
async function saveEdit(withPassport: boolean) {
  const phone = normalisePhone(ef.phone.value);
  if (!ef.title.value) return say("Choose your title.", true);
  if (!phone) return say("Enter your phone in international format, e.g. +6591234567.", true);
  const p: PassportForm = {
    number: ef.number.value.trim(), issuing_country: ef.country.value.trim().toUpperCase(),
    expires_on: ef.expiry.value, date_of_birth: ef.dob.value, sex: normaliseSex(ef.sex.value),
  };
  if (withPassport) {
    const problems = passportProblems(p);
    if (problems.length) return say(problems.join(" "), true);
  }
  for (const b of ["e-save", "e-use-scan"]) $<HTMLButtonElement>(b).disabled = true;
  try {
    say("Saving inside the enclave…");
    await session!.saveTraveller(cfg, ef.title.value, phone, withPassport ? { ...p, sex: p.sex } : undefined);
    say(withPassport
      ? "Saved. Muse's next hold uses these passport details."
      : "Saved. Muse's next hold uses your passport scan.");
  } catch (err) {
    say(`Couldn't save: ${(err as Error).message}`, true);
  } finally {
    for (const b of ["e-save", "e-use-scan"]) $<HTMLButtonElement>(b).disabled = false;
  }
}
// Topping up an existing Muse key, so a low balance never means a new key.
async function loadTopUp() {
  const sel = $<HTMLSelectElement>("t-agent");
  sel.length = 0;
  try {
    const [agents, credits] = await Promise.all([session!.listMuseAgents(), session!.availableCredits()]);
    $("t-balance").textContent = `Your account has ${Math.floor(credits)} test credits to give.`;
    if (!agents.length) {
      $("t-balance").textContent += " No Muse key found: finish setup first.";
      $<HTMLButtonElement>("t-fund").disabled = true;
      return;
    }
    const remembered = store.get("agent");
    for (const a of agents) sel.add(new Option(`${a.name} · …${a.did.slice(-6)}`, a.did));
    sel.value = agents.some((a) => a.did === remembered) ? remembered! : agents[agents.length - 1]!.did;
    const plan = fundingPlan(credits);
    $<HTMLInputElement>("t-amount").value = String(plan.enough ? plan.amount : Math.max(0, Math.floor(credits - 30)));
    $<HTMLButtonElement>("t-fund").disabled = false;
  } catch (err) {
    $("t-balance").textContent = `Couldn't load your keys: ${(err as Error).message}`;
  }
}
$("t-fund").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("t-fund");
  const agentDid = $<HTMLSelectElement>("t-agent").value;
  const amount = Math.floor(Number($<HTMLInputElement>("t-amount").value));
  if (!agentDid) return say("Choose the Muse key to top up.", true);
  if (!(amount >= 1)) return say("Enter how many credits to add.", true);
  btn.disabled = true;
  try {
    const credits = await session!.availableCredits();
    if (amount > credits) return say(`You only have ${Math.floor(credits)} credits to give.`, true);
    say("Adding credits…");
    await session!.fundAgent(agentDid, amount);
    store.set("agent", agentDid);
    say(`Added ${amount} credits to Muse's key (…${agentDid.slice(-6)}). Tell Muse to try again.`);
    await loadTopUp();
  } catch (err) {
    say(`Couldn't add credits: ${(err as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
});

$("t-retire").addEventListener("click", async () => {
  const keep = $<HTMLSelectElement>("t-agent").value;
  if (!keep) return say("Choose the Muse key you're using now; the others will be removed.", true);
  if (!confirm(`Keep the key ending …${keep.slice(-6)} and remove every other muse-vault key? Muse stops working if it holds one you remove.`)) return;
  try {
    say("Removing old muse-vault keys…");
    const n = await session!.retireMuseKeys(cfg, keep);
    say(n ? `Removed ${n} old key(s). Kept …${keep.slice(-6)}.` : "No old keys to remove.");
    await loadTopUp();
  } catch (err) {
    say(`Couldn't remove old keys: ${(err as Error).message}`, true);
  }
});

$("e-save").addEventListener("click", () => void saveEdit(true));
$("e-use-scan").addEventListener("click", () => void saveEdit(false));

// Funding Muse's agent from the traveller's own balance.
let agentDid = "";
async function fund() {
  const btn = $<HTMLButtonElement>("fund");
  btn.hidden = true;
  try {
    say("Adding credits to Muse's key…");
    const available = await session!.availableCredits();
    const plan = fundingPlan(available);
    if (!plan.enough) {
      btn.hidden = false;
      return say(`Muse's key is ready but has no credits: your account has ${Math.floor(available)} test credits left. Top up your Terminal 3 account, then press "Add credits".`, true);
    }
    await session!.fundAgent(agentDid, plan.amount);
    say(`Done. Muse's key has ${plan.amount} credits (about ${Math.floor(plan.amount / 100)} bookings). Add the key and settings to Muse.`);
  } catch (err) {
    btn.hidden = false;
    say(`Muse's key is ready, but adding credits failed: ${(err as Error).message}. Press "Add credits" to try again.`, true);
  }
}
$("fund").addEventListener("click", () => void fund());

// 4. Copy buttons.
const copy = (id: string, label: string) => async () => {
  try { await navigator.clipboard.writeText($(id).textContent ?? ""); say(`${label} copied.`); }
  catch { say("Copy failed; select the text and copy it yourself.", true); }
};
$("copy-key").addEventListener("click", copy("agent-key", "Key"));
$("copy-settings").addEventListener("click", copy("settings", "Message"));

show(editMode ? "signin" : "scan");
