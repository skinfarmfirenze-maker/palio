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

// Manto documentato per ciascun barbero presente nel gioco (40 su 41: manca solo
// Urbino del 1949, la cui scheda non riporta il manto).
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
  // Barberi aggiunti al gioco dopo la prima raccolta (verificati il 31/08):
  "Zio Frac": "baio",             "Preziosa Penelope": "baio", "Galleggiante": "baio",
  "Anda e Bola": "baio",          "Reo Confesso": "baio",      "Viso d'Angelo": "baio",
  "Violenta da Clodia": "baio",   "Indianos": "storno",        "Berio": "baio",
  "Brivido Sardo": "baio",        "Mocambo": "sauro",
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


// ══════════════════════════════════════════════════════════════════════════════
// 4) EPOCHE STORICHE DEI BARBERI
// Anni in cui ciascun cavallo ha effettivamente corso il Palio, dall'Archivio
// (ilpalio.siena.it, ricerca per nome). Utile per comporre tratte coerenti:
// un palio "storico" con barberi e fantini della stessa età, invece di mescolare
// Gaudenzia (1952) con Diodoro (2025).
// NOTA sui nomi: alcuni barberi sono registrati col suffisso AA (anglo-arabo) —
// "Diodoro AA", "Benitos AA" — e Topolone corse anche come Ettore, Dragone ed
// Eucalipto: per lui vale la carriera intera, non il solo periodo col nome finale.
// ══════════════════════════════════════════════════════════════════════════════
export const EPOCHE_BARBERI = {
  "Gaudenzia": { dal: 1952, al: 1960, palii: 15, epoca: "dopoguerra" },
  "Uberta de Mores": { dal: 1958, al: 1962, palii: 11, epoca: "dopoguerra" },
  "Urbino": { dal: 1958, al: 1958, palii: 2, epoca: "dopoguerra" },
  "Topolone": { dal: 1962, al: 1972, palii: 17, epoca: "dopoguerra" },
  "Selvaggia": { dal: 1963, al: 1968, palii: 9, epoca: "dopoguerra" },
  "Mirabella": { dal: 1970, al: 1974, palii: 8, epoca: "anni_oro" },
  "Panezio": { dal: 1972, al: 1984, palii: 20, epoca: "anni_oro" },
  "Quebel": { dal: 1974, al: 1979, palii: 11, epoca: "anni_oro" },
  "Rimini": { dal: 1974, al: 1982, palii: 12, epoca: "anni_oro" },
  "Urbino de Ozieri": { dal: 1977, al: 1979, palii: 4, epoca: "anni_oro" },
  "Figaro": { dal: 1985, al: 1993, palii: 16, epoca: "anni_oro" },
  "Vipera": { dal: 1986, al: 1989, palii: 6, epoca: "anni_oro" },
  "Galleggiante": { dal: 1987, al: 1993, palii: 11, epoca: "anni_oro" },
  "Pytheos": { dal: 1989, al: 1993, palii: 7, epoca: "anni_oro" },
  "Uberto": { dal: 1989, al: 1994, palii: 7, epoca: "anni_oro" },
  "Oriolu de Zamaglia": { dal: 1993, al: 1996, palii: 5, epoca: "fine_secolo" },
  "Quarnero": { dal: 1994, al: 1997, palii: 6, epoca: "fine_secolo" },
  "Re Artù": { dal: 1995, al: 2000, palii: 9, epoca: "fine_secolo" },
  "Zodiach": { dal: 2001, al: 2006, palii: 10, epoca: "fine_secolo" },
  "Berio": { dal: 2002, al: 2005, palii: 6, epoca: "fine_secolo" },
  "Fedora Saura": { dal: 2006, al: 2011, palii: 8, epoca: "contemporanei" },
  "Indianos": { dal: 2010, al: 2014, palii: 7, epoca: "contemporanei" },
  "Mocambo": { dal: 2010, al: 2016, palii: 8, epoca: "contemporanei" },
  "Oppio": { dal: 2013, al: 2019, palii: 6, epoca: "contemporanei" },
  "Preziosa Penelope": { dal: 2015, al: 2016, palii: 3, epoca: "contemporanei" },
  "Trattu de Zamaglia": { dal: 2018, al: 2018, palii: 1, epoca: "contemporanei" },
  "Tale e Quale": { dal: 2018, al: 2025, palii: 3, epoca: "contemporanei" },
  "Remorex": { dal: 2018, al: 2022, palii: 4, epoca: "contemporanei" },
  "Violenta da Clodia": { dal: 2018, al: 2023, palii: 5, epoca: "contemporanei" },
  "Volpino": { dal: 2022, al: 2026, palii: 2, epoca: "contemporanei" },
  "Arestetulesu": { dal: 2022, al: 2026, palii: 3, epoca: "contemporanei" },
  "Ungaros": { dal: 2022, al: 2025, palii: 4, epoca: "contemporanei" },
  "Zio Frac": { dal: 2022, al: 2025, palii: 5, epoca: "contemporanei" },
  "Reo Confesso": { dal: 2022, al: 2023, palii: 4, epoca: "contemporanei" },
  "Viso d'Angelo": { dal: 2022, al: 2026, palii: 10, epoca: "contemporanei" },
  "Zenis": { dal: 2023, al: 2025, palii: 4, epoca: "contemporanei" },
  "Anda e Bola": { dal: 2023, al: 2026, palii: 5, epoca: "contemporanei" },
  "Comancio": { dal: 2024, al: 2025, palii: 2, epoca: "contemporanei" },
  "Benitos": { dal: 2024, al: 2026, palii: 4, epoca: "contemporanei" },
  "Brivido Sardo": { dal: 2024, al: 2024, palii: 2, epoca: "contemporanei" },
  "Diodoro": { dal: 2025, al: 2026, palii: 4, epoca: "contemporanei" },
};

export const EPOCHE = {
  dopoguerra:    { label: "Dopoguerra",   dal: 1945, al: 1969 },
  anni_oro:      { label: "Anni d'oro",   dal: 1970, al: 1989 },
  fine_secolo:   { label: "Fine secolo",  dal: 1990, al: 2005 },
  contemporanei: { label: "Contemporanei", dal: 2006, al: 2100 },
};

// Epoca di un barbero ("dopoguerra" | "anni_oro" | "fine_secolo" | "contemporanei"),
// null se non documentato.
export function epocaDi(nomeCavallo) {
  const r = EPOCHE_BARBERI[nomeCavallo];
  return r ? r.epoca : null;
}

// Barberi di una data epoca.
export function barberiDiEpoca(epoca) {
  return Object.keys(EPOCHE_BARBERI).filter((n) => EPOCHE_BARBERI[n].epoca === epoca);
}
