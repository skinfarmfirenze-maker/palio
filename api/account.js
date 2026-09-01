// Account utenti del Palio — condivisi da TUTTI i dispositivi.
// Store: stesso Vercel KV / Upstash Redis di api/albo.js (via REST, nessuna dipendenza npm).
// Password: hash scrypt col modulo `crypto` nativo di Node (mai in chiaro, mai restituita).
//
// Azioni (POST con body JSON { action: ... }):
//   · signup    { nome, cognome, email, password, contrada } → crea l'account
//   · login     { email, password }                          → verifica le credenziali
//   · palio     { email }                                    → +1 al conteggio palii dell'utente
//   · adminList { adminKey }                                 → elenco di TUTTI gli account (solo owner)
// GET ?admin=<KEY> è una scorciatoia equivalente ad adminList.
//
// Variabili d'ambiente (su Vercel):
//   KV_REST_API_URL + KV_REST_API_TOKEN  (o UPSTASH_REDIS_REST_URL + _TOKEN)  → lo store
//   PALIO_ADMIN_KEY  → password della sezione admin (senza, l'elenco account è disabilitato)

const crypto = require("crypto");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ACCOUNTS_SET = "palio:accounts";              // SET di tutte le email (minuscole)
const acctKey = (email) => `palio:acct:${email}`;   // HASH per account

// Le 17 contrade ammesse nel campo "contrada" (id). Vuoto = nessuna contrada.
const CONTRADE_IDS = new Set([
  "aquila", "bruco", "chiocciola", "civetta", "drago", "giraffa", "istrice",
  "leocorno", "lupa", "nicchio", "oca", "onda", "pantera", "selva", "tartuca",
  "torre", "valdimontone",
]);

async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("redis " + res.status);
  return res.json(); // [{ result: ... }, ...]
}

// HGETALL via REST → { campo: valore } (stringhe).
function hashToObj(result) {
  const o = {};
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i += 2) o[result[i]] = result[i + 1];
  } else if (result && typeof result === "object") {
    for (const k of Object.keys(result)) o[k] = result[k];
  }
  return o;
}

// ── Password: scrypt con salt per-utente ──────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const got = hashPassword(password, salt);
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Email valida (basilare) e normalizzata.
function normEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// Vista PUBBLICA di un account (mai pwHash/pwSalt).
function publicAccount(h) {
  return {
    nome: h.nome || "",
    cognome: h.cognome || "",
    email: h.email || "",
    contrada: h.contrada || "",
    palii: Number(h.palii) || 0,
    vinti: Number(h.vinti) || 0,
    created: Number(h.created) || 0,
    eta: Number(h.eta) || 0,
    sesso: h.sesso || "",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(503).json({ error: "no-store" });
    return;
  }

  // GET ?admin=<KEY> → scorciatoia per l'elenco account.
  if (req.method === "GET") {
    const adminKey = (req.query && req.query.admin) || "";
    return adminList(adminKey, res);
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const action = body.action;

  try {
    if (action === "signup") return await signup(body, res);
    if (action === "login") return await login(body, res);
    if (action === "update") return await updateAccount(body, res);
    if (action === "delete") return await deleteAccount(body, res);
    if (action === "palio") return await bumpPalio(body, res);
    if (action === "win") return await bumpWin(body, res);
    if (action === "playerWins") return await playerWins(body, res);
    if (action === "feedback") return await addFeedback(body, res);
    if (action === "pollVote") return await pollVote(body, res);
    if (action === "pollResults") return await pollResults(body, res);
    if (action === "statVote") return await statVote(body, res);
    if (action === "statResults") return await statResults(body, res);
    if (action === "jkStatVote") return await jkStatVote(body, res);
    if (action === "jkStatResults") return await jkStatResults(body, res);
    if (action === "setStatOverride") return await setStatOverride(body, res);
    if (action === "statOverrides") return await statOverrides(res);
    if (action === "proposeHorse") { body.kind = "horse"; return await propose(body, res); }
    if (action === "acceptedHorses") { body.kind = "horse"; return await acceptedItems(body, res); }
    if (action === "propose") return await propose(body, res);
    if (action === "accepted") return await acceptedItems(body, res);
    if (action === "proposalsList") return await proposalsList(body, res);
    if (action === "proposalDecide") return await proposalDecide(body, res);
    if (action === "setHorseTier") return await setHorseTier(body, res);
    if (action === "adminList") return await adminList(body.adminKey, res);
    res.status(400).json({ error: "bad-action" });
  } catch (e) {
    res.status(500).json({ error: "server" });
  }
};

async function signup(body, res) {
  // Iscrizioni aperte ora; si chiudono dal 23 agosto 2026 alle 12:00 ora italiana
  // (= 10:00 UTC, CEST +2). Blocco anche lato server.
  if (Date.now() >= Date.UTC(2026, 7, 23, 10, 0, 0)) { res.status(403).json({ error: "iscrizioni-chiuse" }); return; }
  const nome = String(body.nome || "").trim().slice(0, 60);
  const cognome = String(body.cognome || "").trim().slice(0, 60);
  const email = normEmail(body.email);
  const password = String(body.password || "");
  let contrada = String(body.contrada || "").trim().toLowerCase();
  if (contrada && !CONTRADE_IDS.has(contrada)) contrada = "";
  const eta = parseInt(body.eta, 10) || 0;
  let sesso = String(body.sesso || "").trim().toUpperCase();
  if (!["M", "F", "A"].includes(sesso)) sesso = "";
  if (!nome || !cognome) { res.status(400).json({ error: "nome-cognome" }); return; }
  if (!email) { res.status(400).json({ error: "email" }); return; }
  if (password.length < 6) { res.status(400).json({ error: "password-corta" }); return; }
  if (!eta || eta < 4 || eta > 120) { res.status(400).json({ error: "eta" }); return; }

  // Email già registrata?
  const [{ result: exists }] = await redisPipeline([["SISMEMBER", ACCOUNTS_SET, email]]);
  if (Number(exists) === 1) { res.status(409).json({ error: "email-esiste" }); return; }

  const salt = crypto.randomBytes(16).toString("hex");
  const pwHash = hashPassword(password, salt);
  const created = Date.now();
  await redisPipeline([
    ["SADD", ACCOUNTS_SET, email],
    ["HSET", acctKey(email),
      "nome", nome, "cognome", cognome, "email", email, "contrada", contrada,
      "eta", String(eta), "sesso", sesso,
      "pwHash", pwHash, "pwSalt", salt, "palii", "0", "created", String(created)],
  ]);
  res.status(200).json({ ok: true, account: { nome, cognome, email, contrada, eta, sesso, palii: 0, created } });
}

async function login(body, res) {
  const email = normEmail(body.email);
  const password = String(body.password || "");
  if (!email) { res.status(400).json({ error: "email" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", acctKey(email)]]);
  const h = hashToObj(result);
  if (!h.email) { res.status(404).json({ error: "no-account" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) {
    res.status(401).json({ error: "credenziali" });
    return;
  }
  res.status(200).json({ ok: true, account: publicAccount(h) });
}

// Modifica dell'account: serve la PASSWORD ATTUALE per autenticare. Si possono
// cambiare nome, cognome, contrada e (opzionale) la password. L'email NON cambia
// (è la chiave). Ritorna l'account pubblico aggiornato.
async function updateAccount(body, res) {
  const email = normEmail(body.email);
  const password = String(body.password || "");
  if (!email) { res.status(400).json({ error: "email" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", acctKey(email)]]);
  const h = hashToObj(result);
  if (!h.email) { res.status(404).json({ error: "no-account" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) { res.status(401).json({ error: "credenziali" }); return; }

  const nome = String(body.nome != null ? body.nome : h.nome).trim().slice(0, 60);
  const cognome = String(body.cognome != null ? body.cognome : h.cognome).trim().slice(0, 60);
  let contrada = String(body.contrada != null ? body.contrada : h.contrada).trim().toLowerCase();
  if (contrada && !CONTRADE_IDS.has(contrada)) contrada = "";
  if (!nome || !cognome) { res.status(400).json({ error: "nome-cognome" }); return; }

  const cmds = [["HSET", acctKey(email), "nome", nome, "cognome", cognome, "contrada", contrada]];
  const newPassword = body.newPassword != null ? String(body.newPassword) : "";
  if (newPassword) {
    if (newPassword.length < 6) { res.status(400).json({ error: "password-corta" }); return; }
    const salt = crypto.randomBytes(16).toString("hex");
    cmds.push(["HSET", acctKey(email), "pwHash", hashPassword(newPassword, salt), "pwSalt", salt]);
  }
  await redisPipeline(cmds);
  res.status(200).json({ ok: true, account: { nome, cognome, email, contrada, palii: Number(h.palii) || 0, created: Number(h.created) || 0 } });
}

// Eliminazione dell'account: serve la PASSWORD ATTUALE. Rimuove hash + set.
async function deleteAccount(body, res) {
  const email = normEmail(body.email);
  const password = String(body.password || "");
  if (!email) { res.status(400).json({ error: "email" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", acctKey(email)]]);
  const h = hashToObj(result);
  if (!h.email) { res.status(404).json({ error: "no-account" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) { res.status(401).json({ error: "credenziali" }); return; }
  await redisPipeline([
    ["SREM", ACCOUNTS_SET, email],
    ["DEL", acctKey(email)],
  ]);
  res.status(200).json({ ok: true });
}

// +1 al conteggio palii dell'utente (chiamato all'inizio di ogni palio).
async function bumpPalio(body, res) {
  const email = normEmail(body.email);
  if (!email) { res.status(400).json({ error: "email" }); return; }
  // BATCH: il client accumula i palii e li invia a gruppi (n), non 1 alla volta.
  let n = parseInt(body.n, 10); if (!(n >= 1)) n = 1; if (n > 100) n = 100;
  const [{ result: exists }] = await redisPipeline([["SISMEMBER", ACCOUNTS_SET, email]]);
  if (Number(exists) !== 1) { res.status(404).json({ error: "no-account" }); return; }
  const [{ result: palii }] = await redisPipeline([["HINCRBY", acctKey(email), "palii", n]]);
  res.status(200).json({ ok: true, palii: Number(palii) || 0 });
}

// +1 al conteggio palii VINTI dell'utente (chiamato quando il giocatore vince).
// Se arriva anche la contrada, incrementa pure il conteggio vittorie PER CONTRADA
// (hash separato palio:acctwins:<email>), che l'admin può aprire.
const winsKey = (email) => `palio:acctwins:${email}`;
async function bumpWin(body, res) {
  const email = normEmail(body.email);
  if (!email) { res.status(400).json({ error: "email" }); return; }
  const [{ result: exists }] = await redisPipeline([["SISMEMBER", ACCOUNTS_SET, email]]);
  if (Number(exists) !== 1) { res.status(404).json({ error: "no-account" }); return; }
  const cmds = [["HINCRBY", acctKey(email), "vinti", 1]];
  let contrada = String(body.contrada || "").trim().toLowerCase();
  if (contrada && CONTRADE_IDS.has(contrada)) cmds.push(["HINCRBY", winsKey(email), contrada, 1]);
  const out = await redisPipeline(cmds);
  res.status(200).json({ ok: true, vinti: Number(out[0] && out[0].result) || 0 });
}

// Dettaglio vittorie PER CONTRADA di un giocatore — solo admin.
async function playerWins(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!body.adminKey || String(body.adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const email = normEmail(body.email);
  if (!email) { res.status(400).json({ error: "email" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", winsKey(email)]]);
  const h = hashToObj(result);
  const byContrada = {};
  Object.keys(h).forEach((k) => { byContrada[k] = Number(h[k]) || 0; });
  res.status(200).json({ ok: true, email, byContrada });
}

// Consiglio/suggerimento di un giocatore → lista Redis (letta solo dall'admin).
const FEEDBACK_LIST = "palio:feedback";
async function addFeedback(body, res) {
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) { res.status(400).json({ error: "vuoto" }); return; }
  const email = normEmail(body.email) || "";   // opzionale: chi l'ha mandato, se loggato
  const entry = JSON.stringify({ text, email, created: Date.now() });
  await redisPipeline([
    ["LPUSH", FEEDBACK_LIST, entry],
    ["LTRIM", FEEDBACK_LIST, 0, 499],   // tiene gli ultimi 500
  ]);
  res.status(200).json({ ok: true });
}

// ── SONDAGGIO cavalli: ogni giocatore vota il tier (brenna/bono/bombolone) che
// vorrebbe per ciascun cavallo. Un voto per DISPOSITIVO per cavallo (modificabile).
// Store: un HASH per cavallo (campo = id votante, valore = tier) + un SET dei
// cavalli votati. L'aggregato si calcola contando i valori.
const POLL_HORSES_SET = "palio:poll:horses";
const pollHorseKey = (h) => `palio:poll:h:${h}`;
const POLL_TIERS = new Set(["brenna", "bono", "bombolone"]);

async function pollVote(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const horse = String(body.horse || "").trim().slice(0, 80);
  const tier = String(body.tier || "").trim().toLowerCase();
  if (!voter || !horse) { res.status(400).json({ error: "dati" }); return; }
  if (!POLL_TIERS.has(tier)) { res.status(400).json({ error: "tier" }); return; }
  await redisPipeline([
    ["SADD", POLL_HORSES_SET, horse],
    ["HSET", pollHorseKey(horse), voter, tier],
  ]);
  res.status(200).json({ ok: true });
}

async function pollResults(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const [{ result: horses }] = await redisPipeline([["SMEMBERS", POLL_HORSES_SET]]);
  const list = Array.isArray(horses) ? horses : [];
  const results = {};
  const mine = {};
  if (list.length) {
    const out = await redisPipeline(list.map((h) => ["HGETALL", pollHorseKey(h)]));
    list.forEach((h, i) => {
      const votes = hashToObj(out[i] && out[i].result);
      const c = { brenna: 0, bono: 0, bombolone: 0 };
      Object.keys(votes).forEach((k) => { const t = votes[k]; if (c[t] != null) c[t] += 1; });
      results[h] = c;
      if (voter && votes[voter] != null) mine[h] = votes[voter];
    });
  }
  res.status(200).json({ ok: true, results, mine });
}

// ── VOTO STATISTICHE cavalli: i giocatori votano 1..5 per POTENZA e TURN di ogni
// cavallo. Store: un HASH per (stat, cavallo) → voter:valore. Media = aggregato.
const SV_HORSES = "palio:svhorses";
const svKey = (stat, horse) => `palio:sv:${stat}:${horse}`;
const SV_STATS = new Set(["potenza", "turn"]);

async function statVote(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const horse = String(body.horse || "").trim().slice(0, 80);
  const stat = String(body.stat || "").trim().toLowerCase();
  const value = Math.round(Number(body.value));
  if (!voter || !horse) { res.status(400).json({ error: "dati" }); return; }
  if (!SV_STATS.has(stat)) { res.status(400).json({ error: "stat" }); return; }
  if (!(value >= 1 && value <= 5)) { res.status(400).json({ error: "value" }); return; }
  await redisPipeline([
    ["SADD", SV_HORSES, horse],
    ["HSET", svKey(stat, horse), voter, String(value)],
  ]);
  res.status(200).json({ ok: true });
}

async function statResults(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const [{ result: horses }] = await redisPipeline([["SMEMBERS", SV_HORSES]]);
  const list = Array.isArray(horses) ? horses : [];
  const results = {};
  if (list.length) {
    const cmds = [];
    list.forEach((h) => { cmds.push(["HGETALL", svKey("potenza", h)]); cmds.push(["HGETALL", svKey("turn", h)]); });
    const out = await redisPipeline(cmds);
    const agg = (votes) => {
      const vals = Object.keys(votes).map((k) => Number(votes[k])).filter((n) => n >= 1 && n <= 5);
      const n = vals.length;
      const avg = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
      return { avg: Math.round(avg * 10) / 10, n };
    };
    list.forEach((h, i) => {
      const pv = hashToObj(out[i * 2] && out[i * 2].result);
      const tv = hashToObj(out[i * 2 + 1] && out[i * 2 + 1].result);
      results[h] = {
        potenza: { ...agg(pv), mine: pv[voter] != null ? Number(pv[voter]) : null },
        turn: { ...agg(tv), mine: tv[voter] != null ? Number(tv[voter]) : null },
      };
    });
  }
  res.status(200).json({ ok: true, results });
}

// ── VOTO STATISTICHE FANTINI: 1..5 per Mossa/Difesa/Terzo/Fedeltà/Curva ────────
const JKV_SET = "palio:jkvjockeys";
const jkvKey = (stat, jk) => `palio:jkv:${stat}:${jk}`;
const JK_STATS = ["mossa", "difesa", "terzo", "fedelta", "curva"];
const JK_STATS_SET = new Set(JK_STATS);
const JK_ALL = ["mossa", "difesa", "terzo", "fedelta", "curva", "ingaggio"];   // + prezzo

async function jkStatVote(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const jk = String(body.jockey || "").trim().slice(0, 80);
  const stat = String(body.stat || "").trim().toLowerCase();
  const value = Math.round(Number(body.value));
  if (!voter || !jk) { res.status(400).json({ error: "dati" }); return; }
  if (stat === "ingaggio") {
    if (!(value >= 0 && value <= 150)) { res.status(400).json({ error: "value" }); return; }   // prezzo 0..150
  } else {
    if (!JK_STATS_SET.has(stat)) { res.status(400).json({ error: "stat" }); return; }
    if (!(value >= 1 && value <= 5)) { res.status(400).json({ error: "value" }); return; }
  }
  await redisPipeline([["SADD", JKV_SET, jk], ["HSET", jkvKey(stat, jk), voter, String(value)]]);
  res.status(200).json({ ok: true });
}

async function jkStatResults(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const [{ result: jks }] = await redisPipeline([["SMEMBERS", JKV_SET]]);
  const list = Array.isArray(jks) ? jks : [];
  const results = {};
  if (list.length) {
    const cmds = [];
    list.forEach((j) => JK_ALL.forEach((s) => cmds.push(["HGETALL", jkvKey(s, j)])));
    const out = await redisPipeline(cmds);
    const agg = (votes) => {
      const vals = Object.keys(votes).map((k) => Number(votes[k])).filter((n) => Number.isFinite(n) && n >= 0);
      const n = vals.length;
      return { avg: n ? Math.round((vals.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0, n };
    };
    list.forEach((j, i) => {
      const o = {};
      JK_ALL.forEach((s, k) => {
        const v = hashToObj(out[i * JK_ALL.length + k] && out[i * JK_ALL.length + k].result);
        o[s] = { ...agg(v), mine: v[voter] != null ? Number(v[voter]) : null };
      });
      results[j] = o;
    });
  }
  res.status(200).json({ ok: true, results });
}

// ── OVERRIDE STAT (admin): applica/cambia i valori di un cavallo o fantino.
// Store: HASH per kind, campo = "nome|stat" → valore. Il gioco li carica al boot.
const OV_KEY = (kind) => `palio:ov:${kind}`;   // kind = horse | jockey
async function setStatOverride(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!body.adminKey || String(body.adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const kind = String(body.kind || "").toLowerCase();
  if (kind !== "horse" && kind !== "jockey") { res.status(400).json({ error: "kind" }); return; }
  const name = String(body.name || "").trim().slice(0, 80);
  const stat = String(body.stat || "").trim().toLowerCase();
  if (!name || !stat) { res.status(400).json({ error: "dati" }); return; }
  const field = `${name}|${stat}`;
  const raw = body.value;
  if (raw === "" || raw == null) { await redisPipeline([["HDEL", OV_KEY(kind), field]]); res.status(200).json({ ok: true }); return; }
  const value = Math.round(Number(raw));
  if (!(value >= 0 && value <= 150)) { res.status(400).json({ error: "value" }); return; }   // 1-5 stat · 0-150 ingaggio
  await redisPipeline([["HSET", OV_KEY(kind), field, String(value)]]);
  res.status(200).json({ ok: true });
}

async function statOverrides(res) {
  const [{ result: h }, { result: j }] = await redisPipeline([["HGETALL", OV_KEY("horse")], ["HGETALL", OV_KEY("jockey")]]);
  res.status(200).json({ ok: true, horse: hashToObj(h), jockey: hashToObj(j) });
}

// ── PROPOSTE dei giocatori (cavalli / fantini / tipi di accordo) ──────────────
// I giocatori propongono; l'admin accetta o rifiuta. Gli elementi ACCETTATI
// finiscono in un hash "accepted" che il gioco carica.
//   kind "horse" → il valore accettato è il TIER (brenna/bono/bombolone)
//   kind "jockey" → valore "1" (il gioco genera le statistiche dal nome)
//   kind "deal"   → valore "1" (nuovo tipo di accordo, informativo)
const PROP_KINDS = new Set(["horse", "jockey", "deal"]);
const propHash = (kind) => `palio:prop:${kind}`;   // campo = nome minuscolo → JSON proposta
const accHash = (kind) => `palio:acc:${kind}`;     // campo = nome → valore (tier o "1")
function propKind(body) { const k = String(body.kind || "horse"); return PROP_KINDS.has(k) ? k : null; }

async function propose(body, res) {
  const kind = propKind(body);
  if (!kind) { res.status(400).json({ error: "kind" }); return; }
  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, kind === "deal" ? 120 : 40);
  const by = String(body.voter || "").trim().slice(0, 80);
  let tier = String(body.tier || "bono").trim().toLowerCase();
  if (!POLL_TIERS.has(tier)) tier = "bono";
  // STAMINA proposta dal giocatore. Tenuta dentro l'intervallo dei barberi veri
  // (70-100): fuori di li' non e' un cavallo, e' un mezzo per vincere sempre.
  let stamina = parseInt(body.stamina, 10);
  if (!Number.isFinite(stamina)) stamina = 0;
  else stamina = Math.max(70, Math.min(100, stamina));
  if (!name || name.length < 2) { res.status(400).json({ error: "nome" }); return; }
  const field = name.toLowerCase();
  const [{ result: existing }] = await redisPipeline([["HGET", propHash(kind), field]]);
  if (existing) { res.status(200).json({ ok: true, already: true }); return; }  // già proposto
  const entry = JSON.stringify({ name, tier, stamina, by, created: Date.now(), status: "pending", kind });
  await redisPipeline([["HSET", propHash(kind), field, entry]]);
  res.status(200).json({ ok: true });
}

// Elementi accettati (pubblico): { nome: valore }. Per i cavalli il valore è il tier.
async function acceptedItems(body, res) {
  const kind = propKind(body);
  if (!kind) { res.status(400).json({ error: "kind" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", accHash(kind)]]);
  const h = hashToObj(result);
  const items = {};
  Object.keys(h).forEach((k) => { items[k] = h[k]; });
  // "horses" per retro-compatibilità col client cavalli.
  res.status(200).json({ ok: true, items, horses: kind === "horse" ? items : undefined });
}

// Elenco proposte di un kind (solo admin).
async function proposalsList(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!body.adminKey || String(body.adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const kind = propKind(body);
  if (!kind) { res.status(400).json({ error: "kind" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", propHash(kind)]]);
  const h = hashToObj(result);
  const proposals = Object.keys(h)
    .map((k) => { try { return JSON.parse(h[k]); } catch (e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  res.status(200).json({ ok: true, proposals });
}

// Accetta/rifiuta una proposta (solo admin). Accettando, l'elemento entra nel gioco.
async function proposalDecide(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!body.adminKey || String(body.adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const kind = propKind(body);
  if (!kind) { res.status(400).json({ error: "kind" }); return; }
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) { res.status(400).json({ error: "nome" }); return; }
  const field = name.toLowerCase();
  const decision = String(body.decision || "").toLowerCase();
  const [{ result: raw }] = await redisPipeline([["HGET", propHash(kind), field]]);
  if (!raw) { res.status(404).json({ error: "no-proposal" }); return; }
  let p; try { p = JSON.parse(raw); } catch (e) { p = { name, tier: "bono" }; }
  if (decision === "accept") {
    let tier = String(body.tier || p.tier || "bono").toLowerCase();
    if (!POLL_TIERS.has(tier)) tier = "bono";
    // Se chi propone ha scelto una stamina, la si porta accanto al tier come
    // "tier:stamina" (es. "bono:88"). Senza, resta il solo tier come prima: il
    // formato vecchio continua a funzionare.
    let stam = parseInt(body.stamina != null ? body.stamina : p.stamina, 10);
    if (!Number.isFinite(stam) || stam <= 0) stam = 0;
    else stam = Math.max(70, Math.min(100, stam));
    p.status = "accepted"; p.tier = tier; if (stam) p.stamina = stam;
    const val = kind === "horse" ? (stam ? tier + ":" + stam : tier) : "1";
    await redisPipeline([
      ["HSET", propHash(kind), field, JSON.stringify(p)],
      ["HSET", accHash(kind), p.name, val],
    ]);
    res.status(200).json({ ok: true, status: "accepted" });
  } else if (decision === "reject") {
    p.status = "rejected";
    await redisPipeline([
      ["HSET", propHash(kind), field, JSON.stringify(p)],
      ["HDEL", accHash(kind), p.name],
    ]);
    res.status(200).json({ ok: true, status: "rejected" });
  } else { res.status(400).json({ error: "decision" }); }
}

// Cambio di classe di un cavallo ESISTENTE (dal sondaggio): l'admin applica il
// nuovo tier senza che ci sia una "proposta". Va nell'hash accepted dei cavalli,
// che il gioco applica al roster. tier vuoto = rimuove l'override.
async function setHorseTier(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!body.adminKey || String(body.adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const name = String(body.name || "").trim().slice(0, 40);
  if (!name) { res.status(400).json({ error: "nome" }); return; }
  const tier = String(body.tier || "").trim().toLowerCase();
  if (tier && !POLL_TIERS.has(tier)) { res.status(400).json({ error: "tier" }); return; }
  if (tier) await redisPipeline([["HSET", accHash("horse"), name, tier]]);
  else await redisPipeline([["HDEL", accHash("horse"), name]]);
  res.status(200).json({ ok: true });
}

// Elenco di TUTTI gli account + i consigli — solo se adminKey combacia con PALIO_ADMIN_KEY.
async function adminList(adminKey, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return; }
  if (!adminKey || String(adminKey) !== secret) { res.status(403).json({ error: "forbidden" }); return; }
  const [{ result: emails }, { result: fbRaw }] = await redisPipeline([
    ["SMEMBERS", ACCOUNTS_SET],
    ["LRANGE", FEEDBACK_LIST, 0, 199],   // ultimi 200 consigli
  ]);
  const feedback = (Array.isArray(fbRaw) ? fbRaw : [])
    .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter(Boolean);
  const list = Array.isArray(emails) ? emails : [];
  if (!list.length) { res.status(200).json({ ok: true, accounts: [], feedback }); return; }
  const out = await redisPipeline(list.map((e) => ["HGETALL", acctKey(e)]));
  const accounts = out
    .map((r) => publicAccount(hashToObj(r && r.result)))
    .filter((a) => a.email)
    .sort((a, b) => b.palii - a.palii);
  res.status(200).json({ ok: true, accounts, feedback });
}
