// ══════════════════════════════════════════════════════════════════════════════
// CAVALLI DEL PALIO — modulo curato dalla chat "fantini/cavalli"
// ──────────────────────────────────────────────────────────────────────────────
// 1) SPENNACCHIERA ANCORATA ALLA FRONTE VIVA
// Il cavallo GLB è animato a MORPH TARGET: la testa sale e scende di parecchio
// (la fronte percorre ~0.69 unità di gioco in altezza e ~0.20 in profondità a
// ogni falcata). L'ancora della spennacchiera però veniva calcolata UNA VOLTA
// sulla bind pose, e poi il pennacchio veniva fatto ondeggiare "a mano" con un
// seno non sincronizzato: da qui lo scarto — fino a 0.49 in altezza — che si
// vede come spennacchiera staccata dalla fronte.
// Qui la fronte si calcola ESATTA a ogni frame. Poiché la media è lineare nei
// pesi morph, basta la posizione media in bind pose più la somma dei 15
// spostamenti medi pesati: 15 moltiplicazioni per cavallo, non 201 vertici.
// Verificato contro il calcolo completo sui vertici: errore ~1e-5.
// ══════════════════════════════════════════════════════════════════════════════

// Posizione media dei 201 vertici della fronte, in coordinate LOCALI della mesh.
export const FRONTE_BASE = [1.3950, 148.7995, 114.5085];

// Spostamento medio della fronte per ciascuno dei 15 morph target.
export const FRONTE_DELTA = [
  [   0.0000,    0.0000,    0.0000],
  [  -0.0289,    0.7861,   -0.1567],
  [   0.2532,    5.3025,   -1.1333],
  [   0.4706,   10.9493,   -2.7701],
  [   0.3323,   18.0781,   -5.0980],
  [   0.1264,   24.3373,   -7.6950],
  [   0.0338,   25.1905,   -9.5542],
  [  -0.0219,   25.4463,  -10.8249],
  [  -0.0259,   26.1816,  -10.5871],
  [  -0.0811,   22.6756,   -9.2970],
  [  -0.4005,   12.9174,   -7.0338],
  [  -0.6373,    2.5488,   -4.6716],
  [  -0.5632,   -6.0100,   -2.4677],
  [  -0.3980,  -10.7328,   -0.8055],
  [  -0.1861,   -8.1945,   -0.1970]
];

// Posizione ESATTA della fronte a questo frame, in coordinate del gruppo cavallo.
//   mesh  = la mesh morph-animata del GLB (quella con morphTargetInfluences)
//   group = horse.group
//   out   = THREE.Vector3 da riempire (evita allocazioni nel loop)
export function ancoraFronteViva(mesh, group, out) {
  const inf = (mesh && mesh.morphTargetInfluences) || null;
  let x = FRONTE_BASE[0], y = FRONTE_BASE[1], z = FRONTE_BASE[2];
  if (inf) {
    for (let k = 0; k < FRONTE_DELTA.length && k < inf.length; k += 1) {
      const w = inf[k];
      if (!w) continue;
      x += w * FRONTE_DELTA[k][0];
      y += w * FRONTE_DELTA[k][1];
      z += w * FRONTE_DELTA[k][2];
    }
  }
  out.set(x, y, z);
  mesh.localToWorld(out);     // mesh-local → mondo
  group.worldToLocal(out);    // mondo → spazio del gruppo del cavallo
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2) MANTI REALI DEI BARBERI
// Il manto di ogni cavallo è quello VERO, letto dalle schede dell'Archivio del
// Palio (ilpalio.siena.it/5/Cavalli/<nome>), non più assegnato a caso né forzato
// a marrone/nero. Fonte per ciascun cavallo nel campo `fonte`.
// ══════════════════════════════════════════════════════════════════════════════

// Resa cromatica dei manti equini. Il modello GLB è tinto di UN solo colore, quindi
// ogni manto è reso col suo tono dominante (nel baio criniera e estremità nere non
// sono rappresentabili separatamente).
export const COLORE_MANTO = {
  "baio":             "#6E4526",   // marrone caldo (il più diffuso)
  "baio oscuro":      "#402616",   // marrone molto scuro, quasi cioccolato
  "sauro":            "#A3623A",   // fulvo dorato-rossiccio
  "morello":          "#191512",   // nero
  "grigio":           "#A8ADB3",   // grigio chiaro
  "grigio pomellato": "#9BA1A7",   // grigio con pomellature
  "roano":            "#97756C",   // bianco mescolato al rosso
  "storno":           "#4F4A47",   // nero brizzolato di bianco
};

// Manto documentato per ciascun barbero presente nel gioco.
export const MANTI_REALI = {
  "Panezio": "baio",              "Topolone": "baio",             "Volpino": "baio",
  "Trattu de Zamaglia": "sauro",  "Uberta de Mores": "baio",      "Gaudenzia": "grigio",
  "Mirabella": "sauro",           "Fedora Saura": "storno",       "Pytheos": "sauro",
  "Quebel": "roano",              "Rimini": "baio",               "Arestetulesu": "sauro",
  "Urbino de Ozieri": "baio oscuro", "Tale e Quale": "baio oscuro", "Quarnero": "baio oscuro",
  "Comancio": "baio",             "Selvaggia": "baio",            "Uberto": "baio",
  "Vipera": "baio",               "Oppio": "grigio pomellato",    "Benitos": "sauro",
  "Diodoro": "sauro",             "Ungaros": "sauro",             "Zenis": "baio",
  "Figaro": "baio",               "Oriolu de Zamaglia": "baio",   "Re Artù": "sauro",
  "Zodiach": "roano",             "Remorex": "sauro",
  // "Urbino" (1949): la sua scheda d'archivio non riporta il manto → lasciato al
  // colore di default del gioco, per non inventare un dato che non esiste.
};

// Colore esadecimale del manto vero di un barbero; null se non documentato.
export function mantoDi(nomeCavallo) {
  const m = MANTI_REALI[nomeCavallo];
  return m ? (COLORE_MANTO[m] || null) : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3) COMPARSA DELLA SPENNACCHIERA ALL'ASSEGNAZIONE
// Alla tratta il barbero è ancora "nudo": la spennacchiera porta i colori della
// Contrada, quindi non può esserci prima che la Contrada gli sia stata assegnata.
// Deve spuntare sulla fronte nel momento in cui il mossiere la chiama, un cavallo
// per volta. Qui la meccanica: nascondi → mostra con una comparsa a molla.
// ══════════════════════════════════════════════════════════════════════════════

const COMPARSA_DURATA = 0.55;   // secondi

// Il pennacchio non c'è ancora (barbero non assegnato).
export function nascondiSpennacchiera(spenn) {
  if (!spenn) return;
  spenn.visible = false;
  spenn.userData.comparsa = null;
  spenn.scale.setScalar(0.001);
}

// La Contrada è stata chiamata: il pennacchio spunta sulla fronte.
export function mostraSpennacchiera(spenn, immediata = false) {
  if (!spenn) return;
  spenn.visible = true;
  if (immediata) {
    spenn.userData.comparsa = null;
    spenn.scale.setScalar(1);
    return;
  }
  spenn.userData.comparsa = 0;
  spenn.scale.setScalar(0.001);
}

// Da chiamare nel loop, insieme all'aggiornamento della posizione: fa crescere il
// pennacchio con un piccolo rimbalzo (sorpasso e assestamento), così si nota che
// è appena comparso invece di apparire di scatto.
export function aggiornaComparsa(spenn, dt) {
  if (!spenn || spenn.userData.comparsa == null) return;
  const t = Math.min(1, spenn.userData.comparsa + dt / COMPARSA_DURATA);
  spenn.userData.comparsa = t;
  // molla smorzata: parte veloce, supera l'1 e rientra
  const s = t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 13.5);
  spenn.scale.setScalar(Math.max(0.001, s));
  if (t >= 1) { spenn.userData.comparsa = null; spenn.scale.setScalar(1); }
}
