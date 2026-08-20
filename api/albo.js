// Albo delle Vittorie GLOBALE — condiviso da TUTTI i dispositivi.
// Store: Vercel KV / Upstash Redis via API REST (nessuna dipendenza npm da installare).
// GET  → restituisce { contrada:{id:conteggio}, cavallo:{...}, fantino:{...} }
// POST → { contrada, cavallo, fantino } : incrementa di 1 (HINCRBY, atomico) e
//        restituisce l'albo aggiornato.
//
// Variabili d'ambiente (iniettate quando colleghi lo store KV/Upstash al progetto
// su Vercel): KV_REST_API_URL + KV_REST_API_TOKEN  (oppure UPSTASH_REDIS_REST_URL
// + UPSTASH_REDIS_REST_TOKEN). Opzionale ALBO_WRITE_KEY: se impostata, le POST
// devono inviare lo stesso valore nell'header "x-palio-key".

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CATS = ["contrada", "cavallo", "fantino"];
const keyFor = (cat) => `palio:albo:${cat}`;

// Esegue una pipeline di comandi Redis via REST Upstash. Ritorna l'array dei result.
async function redisPipeline(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error("redis " + res.status);
  return res.json(); // [{ result: ... }, ...]
}

// HGETALL via REST torna un array [campo, valore, campo, valore] oppure un oggetto:
// normalizza a { campo: numero }.
function hashToObj(result) {
  const o = {};
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i += 2) o[result[i]] = Number(result[i + 1]) || 0;
  } else if (result && typeof result === "object") {
    for (const k of Object.keys(result)) o[k] = Number(result[k]) || 0;
  }
  return o;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Store non ancora configurato: rispondi vuoto (il gioco ripiega sul locale, niente crash).
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(200).json({ contrada: {}, cavallo: {}, fantino: {}, _nostore: true });
    return;
  }
  try {
    if (req.method === "POST") {
      const secret = process.env.ALBO_WRITE_KEY;
      if (secret && req.headers["x-palio-key"] !== secret) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};

      // ── RESET & RE-SEED (solo admin): ripulisce le chiavi dell'albo e le riscrive
      // coi valori ATTUALI (storico preservato). SICUREZZA: legge prima lo stato e,
      // se risulta VUOTO (replica vuota), ANNULLA senza toccare nulla.
      if (body.adminReset) {
        if (String(body.adminReset) !== process.env.PALIO_ADMIN_KEY) { res.status(403).json({ error: "forbidden" }); return; }
        let snap = null;
        for (let k = 0; k < 10 && !snap; k += 1) {
          const out = await redisPipeline([...CATS.map((c) => ["HGETALL", keyFor(c)]), ["GET", "palio:totalePalii"]]);
          const contrada = hashToObj(out[0] && out[0].result);
          const tot = Number(out[CATS.length] && out[CATS.length].result) || 0;
          if (Object.keys(contrada).length >= 15 && tot > 0) {
            snap = { contrada, cavallo: hashToObj(out[1] && out[1].result), fantino: hashToObj(out[2] && out[2].result), totalePalii: tot };
          }
        }
        if (!snap) { res.status(503).json({ error: "letto-vuoto-annullato" }); return; }   // SAFETY: non azzerare mai
        const rc = [["DEL", keyFor("contrada")], ["DEL", keyFor("cavallo")], ["DEL", keyFor("fantino")], ["DEL", "palio:totalePalii"]];
        for (const cat of CATS) {
          const h = snap[cat]; const pairs = [];
          for (const f of Object.keys(h)) { if (h[f]) { pairs.push(String(f), String(h[f])); } }
          if (pairs.length) rc.push(["HSET", keyFor(cat), ...pairs]);
        }
        rc.push(["SET", "palio:totalePalii", String(snap.totalePalii || 0)]);
        await redisPipeline(rc);
        res.status(200).json({ ok: true, reseeded: true, totalePalii: snap.totalePalii, contrade: Object.keys(snap.contrada).length, cavalli: Object.keys(snap.cavallo).length, fantini: Object.keys(snap.fantino).length });
        return;
      }

      const cmds = [];
      const meta = [];
      for (const cat of CATS) {
        const field = body[cat];
        if (field) { cmds.push(["HINCRBY", keyFor(cat), String(field), 1]); meta.push(["cat", cat, field]); }
      }
      // Conteggio GLOBALE dei palii corsi (da tutti i giocatori, tutti i
      // dispositivi): il client invia { palio: 1 } all'INIZIO di ogni palio.
      if (body.palio) { cmds.push(["INCRBY", "palio:totalePalii", 1]); meta.push(["palio"]); }
      if (cmds.length) {
        // RISPOSTA SNELLA: esegue SOLO gli incrementi e restituisce i NUOVI valori
        // (HINCRBY/INCRBY li ritornano già), SENZA rileggere l'intero albo.
        // Prima ogni palio costava ~5 comandi (1 incremento + 4 riletture) → ora 1.
        // Questo è ciò che aveva sfondato la quota Free di Upstash (993K/500K).
        const out = await redisPipeline(cmds);
        const resp = { ok: true };
        meta.forEach((m, i) => {
          const val = Number(out[i] && out[i].result) || 0;
          if (m[0] === "cat") { resp[m[1]] = resp[m[1]] || {}; resp[m[1]][m[2]] = val; }
          else resp.totalePalii = val;
        });
        res.status(200).json(resp);
        return;
      }
    } else if (req.method !== "GET") {
      res.status(405).json({ error: "method" });
      return;
    }
    // Leggi e restituisci l'albo completo + il totale palii corsi.
    const out = await redisPipeline([
      ...CATS.map((cat) => ["HGETALL", keyFor(cat)]),
      ["GET", "palio:totalePalii"],
    ]);
    const albo = {};
    CATS.forEach((cat, i) => { albo[cat] = hashToObj(out[i] && out[i].result); });
    albo.totalePalii = Number(out[CATS.length] && out[CATS.length].result) || 0;
    res.status(200).json(albo);
  } catch (e) {
    // In caso di errore store: rispondi vuoto senza rompere il gioco.
    res.status(200).json({ contrada: {}, cavallo: {}, fantino: {}, _error: true });
  }
};
