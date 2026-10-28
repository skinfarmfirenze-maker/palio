// Account utenti del Palio — condivisi da TUTTI i dispositivi.
// Store: stesso Vercel KV / Upstash Redis di api/albo.js (via REST, nessuna dipendenza npm).
// Password: hash scrypt col modulo `crypto` nativo di Node (mai in chiaro, mai restituita).
//
// Azioni (POST con body JSON { action: ... }):
//   · signup    { nome, cognome, email, password, contrada } → crea l'account
//   · login     { email, password }                          → verifica le credenziali
//   · palio     { email }                                    → +1 al conteggio palii dell'utente
//   · adminList { adminKey }                                 → elenco di TUTTI gli account (solo owner)
//   · tele      { corse: [...] }                             → righe ANONIME delle corse (a gruppi)
//   · teleStats { adminKey, giorni }                         → conti delle corse per l'admin
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

// ── PROTEZIONI ───────────────────────────────────────────────────────────────
// Nessun limite ai tentativi voleva dire: la chiave admin (dietro cui ci sono
// email, eta' e sesso di tutti gli iscritti) e le password dei giocatori si
// potevano provare all'infinito. Ora i tentativi SBAGLIATI si contano per
// indirizzo IP e oltre la soglia si risponde 429 per un quarto d'ora. I tentativi
// giusti non costano comandi in piu' (a parte una lettura).
const RL_FINESTRA = 15 * 60;
function ipDi(req) {
  const h = (req && req.headers) || {};
  return String(h["x-forwarded-for"] || h["x-real-ip"] || "").split(",")[0].trim().slice(0, 64) || "sconosciuto";
}
async function bloccato(chiave, max) {
  const [{ result }] = await redisPipeline([["GET", chiave]]);
  return Number(result) >= max;
}
async function segnaTentativo(chiave) {
  const [{ result: n }] = await redisPipeline([["INCR", chiave]]);
  if (Number(n) === 1) await redisPipeline([["EXPIRE", chiave, RL_FINESTRA]]);
}
// Confronto a tempo costante (un confronto normale si ferma al primo carattere diverso).
function chiaveUguale(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const ADMIN_TENTATIVI = 8;     // solo l'admin: stretto
const LOGIN_TENTATIVI = 60;    // password SBAGLIATE per IP in 15 minuti (IP condivisi degli operatori)
async function adminOk(body, res) {
  const secret = process.env.PALIO_ADMIN_KEY;
  if (!secret) { res.status(503).json({ error: "admin-non-configurato" }); return false; }
  const k = `palio:rl:admin:${body.__ip}`;
  if (await bloccato(k, ADMIN_TENTATIVI)) { res.status(429).json({ error: "troppi-tentativi" }); return false; }
  if (!body.adminKey || !chiaveUguale(body.adminKey, secret)) {
    await segnaTentativo(k);
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}
// Nomi di cavalli e fantini: lettere (anche accentate), numeri, spazi, apostrofo,
// punto e trattino. Fuori da qui e' spazzatura o un tentativo di iniettare testo.
const NOME_OK = /^[\p{L}\p{N} '\u2019.\-]{2,40}$/u;
function nomeValido(n) { return NOME_OK.test(String(n || "")); }
// Tetti agli elenchi aperti a tutti (voti, proposte): senza, si potevano riempire
// di nomi inventati e ogni lettura dei risultati costava un comando per nome.
const TETTO_NOMI_VOTATI = 400;
const TETTO_PROPOSTE = 500;
async function aggiungiConTetto(set, nome, tetto, altri) {
  const out = await redisPipeline([["SADD", set, nome], ["SCARD", set], ...altri]);
  if (Number(out[0].result) === 1 && Number(out[1].result) > tetto) {
    await redisPipeline([["SREM", set, nome], ...altri.map((c) => ["HDEL", c[1], c[2]])]);
    return false;
  }
  return true;
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

  // GET = solo le LETTURE PUBBLICHE, uguali per tutti (cavalli e fantini accettati,
  // correzioni delle statistiche): le tiene la cache di Vercel per 10 minuti, cosi'
  // quasi nessuna visita avvia la funzione. Niente piu' GET ?admin=<KEY>: la chiave
  // nell'indirizzo finiva nei log e nella cronologia; l'admin passa in POST.
  if (req.method === "GET") {
    const q = req.query || {};
    const leggi = String(q.leggi || "");
    const LETTURE = { acceptedHorses: 1, accepted: 1, statOverrides: 1 };
    if (!LETTURE[leggi]) { res.status(405).json({ error: "method" }); return; }
    const corpo = { action: leggi, kind: q.kind ? String(q.kind) : undefined };
    // Si mette in cache solo una risposta riuscita.
    const json = res.json.bind(res);
    res.json = (j) => {
      if (j && j.ok) res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      return json(j);
    };
    try {
      if (leggi === "statOverrides") return await statOverrides(res);
      if (leggi === "acceptedHorses") { corpo.kind = "horse"; return await acceptedItems(corpo, res); }
      return await acceptedItems(corpo, res);
    } catch (e) {
      res.status(500).json({ error: "server" });
      return;
    }
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  body.__ip = ipDi(req);   // messo QUI, dopo il parsing: il client non puo' sceglierlo
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
    if (action === "privacyRequest") return await addPrivacyRequest(body, res);
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
    if (action === "palii24") return await palii24(body, res);
    if (action === "tele") return await teleSalva(body, res);
    if (action === "teleStats") return await teleStats(body, res);
    if (action === "adminList") return await adminList(body, res);
    res.status(400).json({ error: "bad-action" });
  } catch (e) {
    res.status(500).json({ error: "server" });
  }
};

async function signup(body, res) {
  // Iscrizioni chiuse dal 23 agosto 2026 (demo riservata) e RIAPERTE con il gioco:
  // dal 25 ottobre 2026 alle 10:00 di Roma (= 09:00 UTC) chiunque puo' iscriversi.
  const chiuse = Date.now() >= Date.UTC(2026, 7, 23, 10, 0, 0) && Date.now() < Date.UTC(2026, 9, 25, 9, 0, 0);
  if (chiuse) { res.status(403).json({ error: "iscrizioni-chiuse" }); return; }
  // Al massimo 30 account nuovi in un quarto d'ora dallo stesso indirizzo. Non
  // meno: molti telefoni escono su internet con l'IP condiviso dell'operatore, e
  // al lancio una soglia bassa bloccherebbe giocatori veri. Ferma le raffiche.
  const kIscr = `palio:rl:signup:${body.__ip}`;
  if (await bloccato(kIscr, 30)) { res.status(429).json({ error: "troppi-tentativi" }); return; }
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
  // Almeno 14 anni: sotto, in Italia, servirebbe il consenso dei genitori.
  if (!eta || eta > 120) { res.status(400).json({ error: "eta" }); return; }
  if (eta < 14) { res.status(400).json({ error: "eta-minima" }); return; }

  // Email già registrata?
  const [{ result: exists }] = await redisPipeline([["SISMEMBER", ACCOUNTS_SET, email]]);
  if (Number(exists) === 1) { res.status(409).json({ error: "email-esiste" }); return; }

  await segnaTentativo(kIscr);
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
  const kLogin = `palio:rl:login:${body.__ip}`;
  if (await bloccato(kLogin, LOGIN_TENTATIVI)) { res.status(429).json({ error: "troppi-tentativi" }); return; }
  const [{ result }] = await redisPipeline([["HGETALL", acctKey(email)]]);
  const h = hashToObj(result);
  if (!h.email) { res.status(404).json({ error: "no-account" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) {
    await segnaTentativo(kLogin);
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
  if (await bloccato(`palio:rl:login:${body.__ip}`, LOGIN_TENTATIVI)) { res.status(429).json({ error: "troppi-tentativi" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) { await segnaTentativo(`palio:rl:login:${body.__ip}`); res.status(401).json({ error: "credenziali" }); return; }

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
  if (await bloccato(`palio:rl:login:${body.__ip}`, LOGIN_TENTATIVI)) { res.status(429).json({ error: "troppi-tentativi" }); return; }
  if (!verifyPassword(password, h.pwSalt, h.pwHash)) { await segnaTentativo(`palio:rl:login:${body.__ip}`); res.status(401).json({ error: "credenziali" }); return; }
  await redisPipeline([
    ["SREM", ACCOUNTS_SET, email],
    ["DEL", acctKey(email)],
  ]);
  try { await cancellaTracce(email); } catch (e) { /* l'account e' gia' cancellato: le tracce si riprovano a mano */ }
  res.status(200).json({ ok: true });
}

// "Elimina account" deve cancellare TUTTO quello che porta l'email, non solo
// l'account: vittorie per contrada, voti, consigli, proposte e richieste privacy.
// E' raro (un account alla volta), quindi qui si puo' spendere qualche comando.
async function cancellaTracce(email) {
  const cmds = [["DEL", winsKey(email)]];
  const [{ result: poll }, { result: sv }, { result: jk }, { result: fb }, { result: pr }, ...props] = await redisPipeline([
    ["SMEMBERS", POLL_HORSES_SET], ["SMEMBERS", SV_HORSES], ["SMEMBERS", JKV_SET],
    ["LRANGE", FEEDBACK_LIST, 0, -1], ["LRANGE", PRIVACY_LIST, 0, -1],
    ...[...PROP_KINDS].map((k) => ["HGETALL", propHash(k)]),
  ]);
  (poll || []).forEach((h) => cmds.push(["HDEL", pollHorseKey(h), email]));
  (sv || []).forEach((h) => { cmds.push(["HDEL", svKey("potenza", h), email]); cmds.push(["HDEL", svKey("turn", h), email]); });
  (jk || []).forEach((j) => JK_ALL.forEach((st) => cmds.push(["HDEL", jkvKey(st, j), email])));
  const tuoi = (lista) => (lista || []).filter((t) => { try { return String(JSON.parse(t).email || "").toLowerCase() === email; } catch (e) { return false; } });
  tuoi(fb).forEach((t) => cmds.push(["LREM", FEEDBACK_LIST, 0, t]));
  tuoi(pr).forEach((t) => cmds.push(["LREM", PRIVACY_LIST, 0, t]));
  [...PROP_KINDS].forEach((k, i) => {
    const h = hashToObj(props[i] && props[i].result);
    Object.keys(h).forEach((campo) => {
      try { const o = JSON.parse(h[campo]); if (String(o.by || "").toLowerCase() === email) { o.by = ""; cmds.push(["HSET", propHash(k), campo, JSON.stringify(o)]); } } catch (e) { /* niente */ }
    });
  });
  for (let i = 0; i < cmds.length; i += 400) await redisPipeline(cmds.slice(i, i + 400));
}

// Contatore dei palii per FASCIA ORARIA (UTC), per sapere quanti se ne corrono
// nelle ultime 24 ore. Ogni casella scade da sola dopo 26 ore: nessuno storico
// da tenere pulito, e il conto costa due comandi in piu' su una chiamata che il
// client manda gia' a gruppi.
const P2 = (n) => String(n).padStart(2, "0");
const oraKey = (d) => `palio:h24:${d.getUTCFullYear()}${P2(d.getUTCMonth() + 1)}${P2(d.getUTCDate())}${P2(d.getUTCHours())}`;
const ORA_TTL = 26 * 3600;

// +1 al conteggio palii dell'utente (chiamato all'inizio di ogni palio).
async function bumpPalio(body, res) {
  const email = normEmail(body.email);
  if (!email) { res.status(400).json({ error: "email" }); return; }
  // BATCH: il client accumula i palii e li invia a gruppi (n), non 1 alla volta.
  let n = parseInt(body.n, 10); if (!(n >= 1)) n = 1; if (n > 100) n = 100;
  const [{ result: exists }] = await redisPipeline([["SISMEMBER", ACCOUNTS_SET, email]]);
  if (Number(exists) !== 1) { res.status(404).json({ error: "no-account" }); return; }
  const ok = oraKey(new Date());
  const [{ result: palii }] = await redisPipeline([
    ["HINCRBY", acctKey(email), "palii", n],
    ["INCRBY", ok, n],
    ["EXPIRE", ok, ORA_TTL],
  ]);
  res.status(200).json({ ok: true, palii: Number(palii) || 0 });
}

// Quanti palii sono stati corsi nelle ultime 24 ore (solo admin). Somma le 24
// caselle orarie; perOra[0] e' l'ora in corso, perOra[23] quella di 23 ore fa.
async function palii24(body, res) {
  if (!(await adminOk(body, res))) return;
  const adesso = Date.now();
  const chiavi = [];
  for (let i = 0; i < 24; i++) chiavi.push(oraKey(new Date(adesso - i * 3600000)));
  const [{ result }] = await redisPipeline([["MGET", ...chiavi]]);
  const perOra = (result || []).map((x) => Number(x) || 0);
  res.status(200).json({ ok: true, totale: perOra.reduce((a, b) => a + b, 0), perOra });
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
  if (!(await adminOk(body, res))) return;
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
// Richieste dal modulo dell'informativa privacy (non c'e' un'email del titolare:
// arrivano qui e si leggono nel portale admin). Tenute le ultime 200.
const PRIVACY_LIST = "palio:privacy";
async function addPrivacyRequest(body, res) {
  const text = String(body.text || "").trim().slice(0, 1000);
  if (text.length < 5) { res.status(400).json({ error: "vuoto" }); return; }
  const grezza = String(body.email || "").trim();
  const email = grezza ? normEmail(grezza) : "";
  if (grezza && !email) { res.status(400).json({ error: "email" }); return; }
  const k = `palio:rl:privacy:${body.__ip}`;
  if (await bloccato(k, 5)) { res.status(429).json({ error: "troppi-tentativi" }); return; }
  await segnaTentativo(k);
  await redisPipeline([
    ["LPUSH", PRIVACY_LIST, JSON.stringify({ text, email, created: Date.now() })],
    ["LTRIM", PRIVACY_LIST, 0, 199],
  ]);
  res.status(200).json({ ok: true });
}

const POLL_HORSES_SET = "palio:poll:horses";
const pollHorseKey = (h) => `palio:poll:h:${h}`;
const POLL_TIERS = new Set(["brenna", "bono", "bombolone"]);

async function pollVote(body, res) {
  const voter = String(body.voter || "").trim().slice(0, 80);
  const horse = String(body.horse || "").trim().slice(0, 80);
  const tier = String(body.tier || "").trim().toLowerCase();
  if (!voter || !horse) { res.status(400).json({ error: "dati" }); return; }
  if (!POLL_TIERS.has(tier)) { res.status(400).json({ error: "tier" }); return; }
  if (!nomeValido(horse)) { res.status(400).json({ error: "nome" }); return; }
  if (!(await aggiungiConTetto(POLL_HORSES_SET, horse, TETTO_NOMI_VOTATI, [["HSET", pollHorseKey(horse), voter, tier]]))) {
    res.status(429).json({ error: "troppi-nomi" }); return;
  }
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
  if (!nomeValido(horse)) { res.status(400).json({ error: "nome" }); return; }
  if (!(await aggiungiConTetto(SV_HORSES, horse, TETTO_NOMI_VOTATI, [["HSET", svKey(stat, horse), voter, String(value)]]))) {
    res.status(429).json({ error: "troppi-nomi" }); return;
  }
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
  if (!nomeValido(jk)) { res.status(400).json({ error: "nome" }); return; }
  if (!(await aggiungiConTetto(JKV_SET, jk, TETTO_NOMI_VOTATI, [["HSET", jkvKey(stat, jk), voter, String(value)]]))) {
    res.status(429).json({ error: "troppi-nomi" }); return;
  }
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
  if (!(await adminOk(body, res))) return;
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
  if (kind !== "deal" && !nomeValido(name)) { res.status(400).json({ error: "nome" }); return; }
  const field = name.toLowerCase();
  const [{ result: existing }, { result: quante }] = await redisPipeline([["HGET", propHash(kind), field], ["HLEN", propHash(kind)]]);
  if (existing) { res.status(200).json({ ok: true, already: true }); return; }  // già proposto
  if (Number(quante) >= TETTO_PROPOSTE) { res.status(429).json({ error: "troppe-proposte" }); return; }
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
  if (!(await adminOk(body, res))) return;
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
  if (!(await adminOk(body, res))) return;
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
  if (!(await adminOk(body, res))) return;
  const name = String(body.name || "").trim().slice(0, 40);
  if (!name) { res.status(400).json({ error: "nome" }); return; }
  const tier = String(body.tier || "").trim().toLowerCase();
  if (tier && !POLL_TIERS.has(tier)) { res.status(400).json({ error: "tier" }); return; }
  if (tier) await redisPipeline([["HSET", accHash("horse"), name, tier]]);
  else await redisPipeline([["HDEL", accHash("horse"), name]]);
  res.status(200).json({ ok: true });
}

// Elenco di TUTTI gli account + i consigli — solo se adminKey combacia con PALIO_ADMIN_KEY.
// ── DATI DELLE CORSE (anonimi) ───────────────────────────────────────────────
// Ogni palio giocato lascia una riga: com'e' andato, dove si e' fermato chi l'ha
// lasciato a meta', su che dispositivo e quanto fluido. NIENTE email ne' nome:
// servono a migliorare il gioco, non a seguire le persone.
// Una LISTA per giorno (ora di Roma). Il client manda le righe a gruppi, e ogni
// gruppo costa UN comando (LPUSH con piu' valori): la quota di Upstash e' gia'
// saltata una volta. EXPIRE solo alla prima riga del giorno, LTRIM solo oltre il tetto.
const TELE_TTL = 60 * 24 * 3600;          // ogni giorno si cancella da solo dopo 60 giorni
const TELE_TETTO_GIORNO = 10000;          // righe massime tenute per giorno
const TELE_LETTURA_GIORNO = 4000;         // righe lette per giorno dalle statistiche
const teleKey = (giorno) => `palio:tele:${giorno}`;
function giornoRoma(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d).replace(/-/g, "");
}
// Campi ammessi e loro forma: tutto il resto si butta. s = testo (lunghezza max),
// n = numero (min, max), o = oggetto di numeri (chiavi brevi), a = elenco di numeri.
const TELE_CAMPI = {
  v: ["s", 12], esito: ["s", 12], fase: ["s", 12], dur: ["n", 0, 7200], ora: ["n", 0, 23],
  lingua: ["s", 3], disp: ["s", 4], touch: ["n", 0, 1], pwa: ["n", 0, 1], w: ["n", 0, 9999], h: ["n", 0, 9999],
  dpr: ["n", 0, 8], gpu: ["s", 48], modo: ["s", 10], palio: ["s", 14], ruolo: ["s", 10],
  contrada: ["s", 14], rinc: ["n", 0, 1], fantino: ["s", 24], cavallo: ["s", 32], fascia: ["s", 10],
  mossaS: ["n", 0, 3600], falsa: ["n", 0, 9], corsaS: ["n", 0, 600], pos: ["n", 0, 10], scosso: ["n", 0, 1],
  caduti: ["n", 0, 10], minSella: ["n", 0, 10], vince: ["s", 14], vinceFascia: ["s", 10], vinceFantino: ["s", 24], vinceCavallo: ["s", 40],
  nerbate: ["n", 0, 999], fps: ["n", 0, 240], fpsMin: ["n", 0, 240], lenti: ["n", 0, 100],
  camere: ["o", 8], posStoria: ["a", 80], spot: ["n", 0, 99], denari: ["n", -99999, 999999], nPalio: ["n", 0, 99999],
};
function pulisciRiga(r) {
  if (!r || typeof r !== "object") return null;
  const o = {};
  for (const k of Object.keys(TELE_CAMPI)) {
    if (r[k] === undefined || r[k] === null) continue;
    const [tipo, a, b] = TELE_CAMPI[k];
    const x = r[k];
    if (tipo === "s") { const t = String(x).slice(0, a); if (t) o[k] = t; }
    else if (tipo === "n") { const n = Number(x); if (Number.isFinite(n)) o[k] = Math.round(Math.min(b, Math.max(a, n)) * 10) / 10; }
    else if (tipo === "o" && typeof x === "object" && !Array.isArray(x)) {
      const m = {};
      Object.keys(x).slice(0, a).forEach((c) => { const n = Number(x[c]); if (/^[a-z0-9]{1,14}$/i.test(c) && Number.isFinite(n)) m[c] = Math.round(Math.max(0, Math.min(3600, n))); });
      o[k] = m;
    } else if (tipo === "a" && Array.isArray(x)) {
      o[k] = x.slice(0, a).map((n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0))));
    }
  }
  if (!o.esito) return null;
  return o;
}
async function teleSalva(body, res) {
  const corse = Array.isArray(body.corse) ? body.corse.slice(0, 20) : [];
  const adesso = Date.now();
  const righe = corse.map(pulisciRiga).filter(Boolean)
    .map((r) => JSON.stringify(Object.assign(r, { ts: adesso })))
    .filter((t) => t.length <= 1200);
  if (!righe.length) { res.status(200).json({ ok: true, n: 0 }); return; }
  const k = teleKey(giornoRoma(new Date(adesso)));
  // ALBO GLOBALE: viaggia con le righe (prima erano due chiamate a /api/albo per
  // ogni palio). +1 ai palii per ogni corsa partita, +1 a contrada/cavallo/fantino
  // vincitori per ogni arrivo. Gli stessi controlli dell'Albo: solo contrade vere
  // e nomi validi.
  const albo = [];
  corse.map(pulisciRiga).filter(Boolean).forEach((r) => {
    if (r.esito === "arrivo" || r.fase === "race") albo.push(["INCRBY", "palio:totalePalii", 1]);
    if (r.esito !== "arrivo") return;
    if (!r.vince || !CONTRADE_IDS.has(r.vince)) return;   // un arrivo vero ha sempre una contrada vera
    albo.push(["HINCRBY", "palio:albo:contrada", r.vince, 1]);
    if (r.vinceCavallo && nomeValido(r.vinceCavallo)) albo.push(["HINCRBY", "palio:albo:cavallo", r.vinceCavallo, 1]);
    if (r.vinceFantino && nomeValido(r.vinceFantino)) albo.push(["HINCRBY", "palio:albo:fantino", r.vinceFantino, 1]);
  });
  const [{ result: len }] = await redisPipeline([["LPUSH", k, ...righe], ...albo]);
  const extra = [];
  if (Number(len) <= righe.length) extra.push(["EXPIRE", k, TELE_TTL]);           // prima riga del giorno
  if (Number(len) > TELE_TETTO_GIORNO) extra.push(["LTRIM", k, 0, TELE_TETTO_GIORNO - 1]);
  if (extra.length) await redisPipeline(extra);
  res.status(200).json({ ok: true, n: righe.length });
}

// Statistiche per l'admin: legge gli ultimi N giorni e restituisce i CONTI, non
// le righe (piu' le ultime 40 righe grezze, per guardarci dentro).
async function teleStats(body, res) {
  if (!(await adminOk(body, res))) return;
  let giorni = parseInt(body.giorni, 10); if (!(giorni >= 1)) giorni = 1; if (giorni > 30) giorni = 30;
  const righe = [];
  let troncato = false;
  for (let i = 0; i < giorni; i++) {
    const k = teleKey(giornoRoma(new Date(Date.now() - i * 864e5)));
    const [{ result }] = await redisPipeline([["LRANGE", k, 0, TELE_LETTURA_GIORNO - 1]]);
    const lista = Array.isArray(result) ? result : [];
    if (lista.length >= TELE_LETTURA_GIORNO) troncato = true;
    lista.forEach((t) => { try { righe.push(JSON.parse(t)); } catch (e) { /* riga rotta: si salta */ } });
  }
  res.status(200).json({ ok: true, giorni, troncato, ...aggregaTele(righe) });
}

function aggregaTele(tutte) {
  // Le righe "attesa" non sono palii (il giocatore ha trovato la modalita'
  // bloccata dai minuti di attesa): si contano a parte.
  const attese = tutte.filter((r) => r.esito === "attesa");
  const righe = tutte.filter((r) => r.esito !== "attesa");
  const conta = (arr, f) => arr.reduce((m, r) => { const k = f(r); if (k !== undefined && k !== null && k !== "") m[k] = (m[k] || 0) + 1; return m; }, {});
  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const mediana = (arr) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
  const arrivi = righe.filter((r) => r.esito === "arrivo");
  const giocate = arrivi.filter((r) => r.ruolo === "play" || !r.ruolo);
  const conFps = righe.filter((r) => r.fps > 0);
  // Gruppo con: corse, vinte dal giocatore, posizione media.
  const perGruppo = (arr, f) => {
    const g = {};
    arr.forEach((r) => {
      const k = f(r); if (!k) return;
      const x = g[k] || (g[k] = { n: 0, vinte: 0, pos: [] });
      x.n++; if (r.pos === 1) x.vinte++; if (r.pos > 0) x.pos.push(r.pos);
    });
    return Object.keys(g).map((k) => ({ k, n: g[k].n, vinte: g[k].vinte, posMedia: r1(media(g[k].pos)) })).sort((a, b) => b.n - a.n);
  };
  const fpsPer = (f) => {
    const g = {};
    conFps.forEach((r) => { const k = f(r); if (!k) return; (g[k] || (g[k] = [])).push(r); });
    return Object.keys(g).map((k) => ({
      k, n: g[k].length,
      fps: r1(mediana(g[k].map((r) => r.fps))),
      fpsMin: r1(mediana(g[k].filter((r) => r.fpsMin > 0).map((r) => r.fpsMin))),
      sotto30: Math.round(g[k].filter((r) => r.fps < 30).length / g[k].length * 100),
    })).sort((a, b) => b.n - a.n);
  };
  const camere = {};
  righe.forEach((r) => { Object.keys(r.camere || {}).forEach((c) => { camere[c] = (camere[c] || 0) + r.camere[c]; }); });
  const rincorse = righe.filter((r) => r.rinc === 1);
  return {
    totale: righe.length,
    attese: attese.length,
    // Nuovi (primi 3 palii su quel dispositivo) contro chi gioca da piu' tempo.
    nuovi: { n: righe.filter((r) => r.nPalio > 0 && r.nPalio <= 3).length, abbandoni: righe.filter((r) => r.nPalio > 0 && r.nPalio <= 3 && r.esito !== "arrivo").length },
    esperti: { n: righe.filter((r) => r.nPalio > 3).length, abbandoni: righe.filter((r) => r.nPalio > 3 && r.esito !== "arrivo").length },
    attesePerModo: attese.reduce((m, r) => { const k = r.modo || "?"; m[k] = (m[k] || 0) + 1; return m; }, {}),
    arrivi: arrivi.length,
    abbandoni: righe.filter((r) => r.esito !== "arrivo").length,
    abbandoniPerFase: conta(righe.filter((r) => r.esito !== "arrivo"), (r) => r.fase),
    esiti: conta(righe, (r) => r.esito),
    dispositivi: conta(righe, (r) => r.disp),
    lingue: conta(righe, (r) => r.lingua),
    pwa: righe.filter((r) => r.pwa === 1).length,
    modi: conta(righe, (r) => r.modo),
    palii: conta(righe, (r) => r.palio),
    ore: conta(righe, (r) => r.ora),
    versioni: conta(righe, (r) => r.v),
    durataMedia: r1(media(righe.map((r) => r.dur || 0))),
    mossaMedia: r1(media(arrivi.filter((r) => r.mossaS > 0).map((r) => r.mossaS))),
    mossaConFalsa: arrivi.length ? Math.round(arrivi.filter((r) => r.falsa > 0).length / arrivi.length * 100) : null,
    corsaMedia: r1(media(arrivi.filter((r) => r.corsaS > 0).map((r) => r.corsaS))),
    vintePerc: giocate.length ? r1(giocate.filter((r) => r.pos === 1).length / giocate.length * 100) : null,
    posMedia: r1(media(giocate.filter((r) => r.pos > 0).map((r) => r.pos))),
    scossoPerc: giocate.length ? Math.round(giocate.filter((r) => r.scosso === 1).length / giocate.length * 100) : null,
    cadutiMedi: r1(media(arrivi.map((r) => r.caduti || 0))),
    cadutiDistrib: conta(arrivi, (r) => r.caduti),
    nerbateMedie: r1(media(giocate.map((r) => r.nerbate || 0))),
    spotTot: righe.reduce((a, r) => a + (r.spot || 0), 0),
    rincorsa: { n: rincorse.length, abbandoni: rincorse.filter((r) => r.esito !== "arrivo").length, vinte: rincorse.filter((r) => r.pos === 1).length },
    perFascia: perGruppo(giocate, (r) => r.fascia),
    perFantino: perGruppo(giocate, (r) => r.fantino).slice(0, 20),
    perContrada: perGruppo(giocate, (r) => r.contrada),
    perRuolo: perGruppo(arrivi, (r) => r.ruolo),
    vinciContrada: conta(arrivi, (r) => r.vince),
    vinciFascia: conta(arrivi, (r) => r.vinceFascia),
    vinciFantino: Object.entries(conta(arrivi, (r) => r.vinceFantino)).sort((a, b) => b[1] - a[1]).slice(0, 15),
    fpsDispositivo: fpsPer((r) => r.disp),
    fpsGpu: fpsPer((r) => r.gpu).slice(0, 15),
    lentiMedi: r1(media(conFps.map((r) => r.lenti || 0))),
    camere,
    ultime: righe.slice(0, 40),
  };
}

async function adminList(body, res) {
  if (!(await adminOk(body, res))) return;
  const [{ result: emails }, { result: fbRaw }, { result: prRaw }] = await redisPipeline([
    ["SMEMBERS", ACCOUNTS_SET],
    ["LRANGE", FEEDBACK_LIST, 0, 199],   // ultimi 200 consigli
    ["LRANGE", PRIVACY_LIST, 0, 199],    // richieste dal modulo privacy
  ]);
  const leggi = (raw) => (Array.isArray(raw) ? raw : [])
    .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter(Boolean);
  const feedback = leggi(fbRaw);
  const privacy = leggi(prRaw);
  const list = Array.isArray(emails) ? emails : [];
  if (!list.length) { res.status(200).json({ ok: true, accounts: [], feedback, privacy }); return; }
  const out = await redisPipeline(list.map((e) => ["HGETALL", acctKey(e)]));
  const accounts = out
    .map((r) => publicAccount(hashToObj(r && r.result)))
    .filter((a) => a.email)
    .sort((a, b) => b.palii - a.palii);
  res.status(200).json({ ok: true, accounts, feedback, privacy });
}
