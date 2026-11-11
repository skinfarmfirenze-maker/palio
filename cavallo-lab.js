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
  const zp = mesh && mesh.userData && mesh.userData.zampe;   // §7: il corpo dondola un poco al passo
  if (zp && zp.attivo) {
    y += zp.dy;
    if (zp.colloYaw || zp.colloPitch) { _ruotaCollo(x, y, z, zp.colloYaw || 0, zp.colloPitch || 0, _cq, 0); x = _cq[0]; y = _cq[1]; z = _cq[2]; }
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

// ══════════════════════════════════════════════════════════════════════════════
// 5. FLESSIONE LATERALE DEL CORPO IN CURVA
// ──────────────────────────────────────────────────────────────────────────────
// Un cavallo che affronta una curva non ruota come un blocco rigido: si incurva
// lungo l'arco, il muso entra per primo, il collo segue, il tronco quasi non si
// piega e il posteriore esce un poco. È il difetto più visibile dei cavalli nei
// videogiochi, e da noi si nota nelle due curve del Casato e di San Martino.
//
// Il nostro cavallo NON ha scheletro (1 mesh, 15 morph target, 0 ossa): non c'è
// una colonna da piegare. La flessione si fa allora nel VERTEX SHADER — ogni
// vertice ruota attorno all'asse verticale di un angolo che dipende da quanto è
// avanti o indietro lungo il corpo. Costa una manciata di istruzioni per vertice
// su 796 vertici: nulla.
//
// L'angolo segue un profilo che tiene il TRONCO RIGIDO e lascia la piega a collo
// e posteriore (0.4·s + 0.6·s³): il dorso di un cavallo vero si flette pochissimo
// in laterale, la mobilità sta quasi tutta nel collo.
//
// La patch va inserita DOPO `morphtarget_vertex`, altrimenti la flessione viene
// sovrascritta dalla miscela dei morph. Se three.js cambiasse il nome del chunk
// il replace fallirebbe in silenzio: qui viene verificato e segnalato.

const BEND_PROFILO = "0.4 * s + 0.6 * s * s * s";

// Abilita la flessione su una mesh di cavallo. Clona il materiale (altrimenti
// tutti i cavalli in pista si piegherebbero insieme) e restituisce lo stato da
// passare alle altre funzioni. Idempotente: richiamarla non fa danni.
export function abilitaFlessione(mesh, opts = {}) {
  if (!mesh || !mesh.geometry) return null;
  if (mesh.userData.flessione) return mesh.userData.flessione;

  const geo = mesh.geometry;
  // ⚠️ NON usare geo.boundingBox: three lo allarga fino a comprendere gli estremi di
  // TUTTI i morph target, e su questo cavallo la semilunghezza usciva 360 invece di
  // 161 — la flessione risultava un decimo di quella voluta. L'estensione va presa
  // dalle posizioni di BASE.
  let zMin = Infinity, zMax = -Infinity;
  const ap = geo.attributes && geo.attributes.position;
  if (ap) {
    for (let i = 0; i < ap.count; i += 1) {
      const z = ap.getZ(i);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  } else { zMin = -1; zMax = 1; }
  const zMid = opts.zMid !== undefined ? opts.zMid : (zMin + zMax) / 2;
  const zHalf = opts.zHalf !== undefined ? opts.zHalf : Math.max(1e-4, (zMax - zMin) / 2);

  const mat = mesh.material.clone();
  mesh.material = mat;

  const st = {
    uBend: { value: 0 },      // radianti al culmine (muso e coda)
    uZMid: { value: zMid },
    uZHalf: { value: zHalf },
    corrente: 0,
    patchOk: false,
  };

  const precedente = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof precedente === "function") precedente(shader, renderer);
    shader.uniforms.uBend = st.uBend;
    shader.uniforms.uZMid = st.uZMid;
    shader.uniforms.uZHalf = st.uZHalf;

    const testa = "uniform float uBend;\nuniform float uZMid;\nuniform float uZHalf;\n" +
      "float bendAngolo(float z) {\n" +
      "  float s = clamp((z - uZMid) / uZHalf, -1.0, 1.0);\n" +
      "  return uBend * (" + BEND_PROFILO + ");\n" +
      "}\n";
    shader.vertexShader = testa + shader.vertexShader;

    // POSIZIONE: dopo la miscela dei morph, altrimenti viene cancellata.
    const ancoraPos = "#include <morphtarget_vertex>";
    if (shader.vertexShader.indexOf(ancoraPos) === -1) {
      console.warn("[cavallo-lab] flessione NON applicata: manca", ancoraPos);
      return;
    }
    shader.vertexShader = shader.vertexShader.replace(ancoraPos, ancoraPos + `
  {
    float a = bendAngolo(transformed.z);
    float ca = cos(a), sa = sin(a);
    float dz = transformed.z - uZMid;
    float nx = transformed.x * ca + dz * sa;
    float nz = -transformed.x * sa + dz * ca;
    transformed.x = nx;
    transformed.z = uZMid + nz;
  }`);

    // NORMALI: stessa rotazione, altrimenti la luce resta quella del corpo dritto
    // e la piega non si legge. Qui `position` è la posa di bind: per
    // l'illuminazione lo scarto rispetto alla posa morphata è irrilevante.
    const ancoraNrm = "#include <morphnormal_vertex>";
    if (shader.vertexShader.indexOf(ancoraNrm) !== -1) {
      shader.vertexShader = shader.vertexShader.replace(ancoraNrm, ancoraNrm + `
  {
    float a = bendAngolo(position.z);
    float ca = cos(a), sa = sin(a);
    float nx = objectNormal.x * ca + objectNormal.z * sa;
    float nz = -objectNormal.x * sa + objectNormal.z * ca;
    objectNormal.x = nx;
    objectNormal.z = nz;
  }`);
    }
    st.patchOk = true;
    st.vs = shader.vertexShader;   // sonda: lo shader che three riceve davvero
  };
  mat.needsUpdate = true;

  mesh.userData.flessione = st;
  return st;
}

// Angolo di flessione al culmine che corrisponde a una curva di raggio R.
// Un corpo lungo L che segue un arco di raggio R si piega di L/(2R) da metà a
// estremità: è la piega "giusta", quella che fa seguire al cavallo la traiettoria
// invece di scivolarci sopra di traverso.
//   curvatura = 1/R, con segno: positiva a sinistra, negativa a destra.
export function flessioneDaCurvatura(mesh, curvatura, opts = {}) {
  const st = mesh && mesh.userData && mesh.userData.flessione;
  if (!st) return 0;
  // La semilunghezza è in unità del GLB: va portata in unità di MONDO, perché la
  // curvatura arriva in 1/unità-di-gioco. La scala sta sul padre (il gioco scala il
  // gruppo, non la mesh), quindi si legge dalla matrice mondo, non da mesh.scale.
  if (mesh.updateWorldMatrix) mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld && mesh.matrixWorld.elements;
  const scalaMondo = e ? Math.hypot(e[8], e[9], e[10]) : 1;
  const semiLung = st.uZHalf.value * scalaMondo;
  // guadagno 1 = l'arco geometrico puro. Alla distanza della telecamera di gara la
  // piega giusta si legge poco: 1.4-1.8 rende meglio senza diventare caricatura.
  const max = opts.max !== undefined ? opts.max : 0.42;   // ~24°, oltre è da serpente
  const guadagno = opts.guadagno !== undefined ? opts.guadagno : 1.5;
  return Math.max(-max, Math.min(max, semiLung * curvatura * guadagno));
}

// Porta la flessione verso il valore voluto con un smorzamento esponenziale: il
// cavallo si incurva e si raddrizza in ~`tempo` secondi, non a scatti. Da
// chiamare a ogni frame.
export function aggiornaFlessione(mesh, bendVoluto, dt, tempo = 0.28) {
  const st = mesh && mesh.userData && mesh.userData.flessione;
  if (!st) return 0;
  const k = 1 - Math.exp(-Math.max(1e-4, dt) / Math.max(1e-3, tempo));
  st.corrente += (bendVoluto - st.corrente) * k;
  st.uBend.value = st.corrente;
  return st.corrente;
}

// Inclinazione verso l'interno della curva (come un ciclista): è la fisica, non
// un effetto. v in unità di gioco al secondo, curvatura = 1/R con segno.
// Va applicata dal gioco come rollio del GRUPPO del cavallo, non qui: il fantino
// deve inclinarsi con lui.
export function inclinazioneInCurva(v, curvatura, g = 9.81, max = 0.30) {
  const a = Math.atan((v * v * curvatura) / g);
  return Math.max(-max, Math.min(max, a));
}

// ════════════════════════════════════════════════════════════════════════════
// 6. REAZIONE AI CANAPI — spinte e urti che si VEDONO, senza tremolio
// ════════════════════════════════════════════════════════════════════════════
// Ai canapi i cavalli si toccano davvero (sagoma 0,66), ma chi viene spinto
// scivolava di lato rigido, a gambe ferme, senza reagire. Qui il corpo risponde:
//  · urto: si sbilancia via dal vicino, poi si APPOGGIA contro di lui finché preme;
//  · colpito sulla spalla gira il davanti, colpito sulla groppa gira il dietro;
//  · urto forte o nerbata: si alza un poco davanti;
//  · il fantino oscilla in ritardo (inerzia);
//  · spostato di lato, il cavallo fa i passi (velocità di passo per il mixer).
// Tutto VISIVO: niente torna nella fisica della mossa (posizioni, calca,
// allineamento), quindi non può innescare anelli di retroazione. Contro il
// tremolio: ingressi filtrati (≥ 80 ms) e molle smorzate sotto 1,6 Hz.
export const REAZIONE = {
  filtro: 0.12,                 // s, filtro sugli ingressi
  filtroLento: 0.8,             // s, pressione sostenuta (appoggio)
  vMax: 2.5,                    // u/s: la calca non può più spostare un cavallo più in fretta di così, a vista
  inseguo: 0.05,                // s: con che prontezza la vista recupera lo spostamento della calca
  debitoMax: 1.0,               // u: scarto massimo fra dove il cavallo È e dove lo si VEDE (solo sicurezza)
  // Molle LENTE e quasi senza rimbalzo (z ≥ 0,8): il cavallo si sbilancia e torna,
  // non dondola. Con f 1,1 Hz e z 0,6 una spinta di 37 cm lo faceva oscillare da +4,5°
  // a −7° in 0,4 s: si leggeva come un tremito.
  rollio:     { f: 0.7, z: 0.85, kColpo: 0.45, kAppoggio: 0.07, max: 0.12 },
  imbardata:  { f: 0.6, z: 0.85, kColpo: 0.6, kAppoggio: 0.10, max: 0.16 },
  beccheggio: { f: 1.0, z: 0.8,  kColpo: 1.0, soglia: 0.06, nerbata: 0.4, max: 0.06 },     // soglia: salto del filtro in un frame
  fantino:    { f: 1.2, z: 0.7,  k: 0.8 },
  passo:      { tau: 0.25 },
  // MUSO ADDOSSO (Simone 11/11): chi spinge di proposito verso un vicino gli porta
  // il muso addosso, come per dargli noia. Lento (sale in 0,25 s, cala in 0,6 s) e
  // con «beccate» a 0,9 Hz: niente scatti, niente tremolio.
  muso:       { tieni: 1.2, sale: 0.25, scende: 0.6, yawMax: 0.6, giu: 0.14, becca: 0.9, beccaAmp: 0.25 },   // yawMax 0,6 rad ≈ 34°
};

function molla(x, v, bersaglio, f, z, dt) {
  const w = 2 * Math.PI * f;
  const n = Math.max(1, Math.ceil(dt / 0.012));        // sottopassi: stabile anche a 30 fps
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (-w * w * (x - bersaglio) - 2 * z * w * v) * h;
    x += v * h;
  }
  return [x, v];
}
const _lim = (x, m) => Math.max(-m, Math.min(m, x));
// Spostamento della calca c al netto del movimento proprio o che lo annulla:
// se vanno in versi opposti conta solo l'eccesso della calca; mai più di c.
const _netto = (c, o) => (c * o < 0 ? Math.sign(c) * Math.max(0, Math.abs(c) - Math.abs(o)) : c);
// Limite morbido: se la molla arriva al tetto si ferma lì (niente rimbalzo a scatto).
function _tetto(x, v, m) { if (x > m) return [m, Math.min(v, 0)]; if (x < -m) return [-m, Math.max(v, 0)]; return [x, v]; }

export function azzeraReazione(h) {
  h.reaz = { r: 0, rv: 0, y: 0, yv: 0, p: 0, pv: 0, j: 0, jv: 0,
             vF: 0, vL: 0, tF: 0, tL: 0, passo: 0, nerb: 0, debitoL: 0, debitoP: 0,
             muso: 0, musoTieni: 0, musoAltro: null, musoT: 0 };
}

// Da chiamare a ogni frame per ogni cavallo, DOPO la calca e PRIMA di placeHorse.
// ingresso (alla mossa): { dLat, dProg: spostamento laterale e longitudinale imposto
// dalla calca in questo frame (u), coppia: Σ dLat × braccio (+ = colpito davanti) }.
// Fuori dalla mossa passare null: debiti e molle tornano a zero da soli.
//
// DEBITO: la calca a volte sposta un cavallo di 0,4-1,2 m in UN frame (sagome molto
// sovrapposte): a vista era un teletrasporto. Lo spostamento resta giusto nella
// logica, ma si VEDE recuperato a velocità di spinta (≤ vMax): placeHorse disegna
// il cavallo a (corsia − debitoL, progress − debitoP).
export function aggiornaReazione(h, dt, ingresso) {
  if (!h.reaz) azzeraReazione(h);
  const R = h.reaz, C = REAZIONE;
  if (!(dt > 0)) return R;
  // A debito va solo il SALTO vero. Un cavallo incastrato avanza verso il suo
  // obiettivo e la calca lo respinge, a ogni frame: si annullano, il cavallo è
  // fermo e non c'è niente da nascondere. Prima la respinta entrava tutta nel
  // debito e l'avanzata no → il debito cresceva senza fine e il cavallo veniva
  // disegnato metri avanti, fuori dai canapi (l'Istrice in produzione, 9/11).
  // Movimento proprio = spostamento totale dall'ultimo frame − parte della calca.
  const cL = ingresso ? (ingresso.dLat || 0) : 0, cP = ingresso ? (ingresso.dProg || 0) : 0;
  const propL = R.ultL === undefined ? 0 : (h.lane - R.ultL) - cL;
  const propP = R.ultP === undefined ? 0 : (h.progress - R.ultP) - cP;
  R.ultL = h.lane; R.ultP = h.progress;
  R.debitoL = _lim(R.debitoL + _netto(cL, propL), C.debitoMax);
  R.debitoP = _lim(R.debitoP + _netto(cP, propP), C.debitoMax);
  const passoMax = C.vMax * dt, k = 1 - Math.exp(-dt / C.inseguo);
  const mostraL = _lim(R.debitoL * k, passoMax), mostraP = _lim(R.debitoP * k, passoMax);
  R.debitoL -= mostraL; R.debitoP -= mostraP;
  if (Math.abs(R.debitoL) < 1e-5) R.debitoL = 0;
  if (Math.abs(R.debitoP) < 1e-5) R.debitoP = 0;
  // La coppia segue la stessa parte dello spostamento che si vede.
  const quota = ingresso && Math.abs(ingresso.dLat) > 1e-6 ? _lim(mostraL / ingresso.dLat, 1) : 0;
  const vExt = mostraL / dt;
  const tExt = ingresso ? (ingresso.coppia || 0) * Math.max(quota, 0) / dt : 0;

  const a = 1 - Math.exp(-dt / C.filtro), aL = 1 - Math.exp(-dt / C.filtroLento);
  const vPrima = R.vF, tPrima = R.tF;
  R.vF += (vExt - R.vF) * a;  R.vL += (vExt - R.vL) * aL;
  R.tF += (tExt - R.tF) * a;  R.tL += (tExt - R.tL) * aL;
  const dv = R.vF - vPrima, dtq = R.tF - tPrima;

  // ROLLIO (+ = schiena verso la corsia +): il colpo lo sbilancia nel verso della
  // spinta, la pressione che dura lo fa appoggiare CONTRO chi spinge.
  R.rv += C.rollio.kColpo * dv;
  [R.r, R.rv] = molla(R.r, R.rv, -C.rollio.kAppoggio * _lim(R.vL / 0.5, 1), C.rollio.f, C.rollio.z, dt);
  [R.r, R.rv] = _tetto(R.r, R.rv, C.rollio.max);

  // IMBARDATA (+ = muso a sinistra, verso la corsia −): spinto davanti verso la
  // corsia + → il muso va verso la corsia + (imbardata −); spinto dietro → il contrario.
  R.yv += -C.imbardata.kColpo * dtq;
  [R.y, R.yv] = molla(R.y, R.yv, -C.imbardata.kAppoggio * _lim(R.tL / 0.5, 1), C.imbardata.f, C.imbardata.z, dt);
  [R.y, R.yv] = _tetto(R.y, R.yv, C.imbardata.max);

  // BECCHEGGIO (− = si alza davanti): urto forte o nerbata appena presa.
  const nerbNuova = (h.nerbLock || 0) > R.nerb + 1;      // nerbLock riparte da 4 s
  R.nerb = h.nerbLock || 0;
  if (Math.abs(dv) > C.beccheggio.soglia) R.pv -= C.beccheggio.kColpo * (Math.abs(dv) - C.beccheggio.soglia);
  if (nerbNuova) { R.pv -= C.beccheggio.nerbata; R.rv += 0.25 * (h.nerbSide || 0); }
  [R.p, R.pv] = molla(R.p, R.pv, 0, C.beccheggio.f, C.beccheggio.z, dt);
  [R.p, R.pv] = _tetto(R.p, R.pv, C.beccheggio.max);

  // FANTINO: segue il rollio del cavallo in ritardo, con un poco di controfase.
  [R.j, R.jv] = molla(R.j, R.jv, -C.fantino.k * R.r, C.fantino.f, C.fantino.z, dt);

  // MUSO ADDOSSO: ingresso.muso = il vicino che questo cavallo sta spingendo di
  // proposito (giocatore con Q/P o A/L, AI con shoveDir). Lo si tiene per `tieni`
  // secondi dopo l'ultima spinta; la testa la gira §7 (aggiornaZampe).
  const M = C.muso;
  if (ingresso && ingresso.muso) { R.musoAltro = ingresso.muso; R.musoTieni = M.tieni; }
  else R.musoTieni = Math.max(0, (R.musoTieni || 0) - dt);
  const voglia = R.musoTieni > 0 ? 1 : 0, mu = R.muso || 0;
  R.muso = mu + (voglia - mu) * (1 - Math.exp(-dt / (voglia > mu ? M.sale : M.scende)));
  if (!voglia && R.muso < 0.01) { R.muso = 0; R.musoAltro = null; }
  R.musoT = ((R.musoT || 0) + dt) % 1000;

  // PASSO: velocità laterale VISTA (spinta mostrata + movimento proprio), per le zampe.
  const lv = h.lane - R.debitoL;
  const vLat = R.laneVista === undefined ? 0 : Math.abs((lv - R.laneVista) / dt);
  R.laneVista = lv;
  R.passo += (Math.min(vLat, 3) - R.passo) * (1 - Math.exp(-dt / C.passo.tau));
  return R;
}


// ════════════════════════════════════════════════════════════════════════════
// 7. ZAMPE AL PASSO — il cavallo del gioco cammina e trotta (tondino, canapi)
// ════════════════════════════════════════════════════════════════════════════
// horse_master.glb ha UNA sola falcata di galoppo registrata (15 forme, niente
// ossa). Al tondino e ai canapi si vedeva quel galoppo al rallentatore: cavalli
// «in volo», e da fermi la posa base, con una posteriore tesa indietro.
// Qui le zampe hanno ossa vere, ricavate dalla mesh stessa: spalla o anca
// (virtuale) → avambraccio o gaskin → stinco → pastorale → zoccolo, nel piano di
// marcia. Da fermo: quattro zoccoli a terra, stinchi verticali. Al passo (4 tempi,
// laterale) e al trotto (diagonale) lo zoccolo in appoggio resta piantato
// (cinematica inversa) e in volo la gamba si piega. Sopra ~6 u/s si torna, sfumando,
// al galoppo registrato: la corsa resta IDENTICA a prima.
// POSTERIORI (Simone 11/11, «stai sbagliando la forma delle zampe posteriori»): da fermo
// garretto sotto la punta della natica, stinco verticale, gaskin che scende a ~45° dalla
// grassella; gaskin e stinco con lunghezze da cavallo vero (il tubo del modello si accorcia).
// Solo a vista: niente torna nella logica del gioco.
// ZAMPE_DATI è calcolato una volta, fuori dal gioco, su QUESTO modello (cartella
// PALIO/rig-zampe-glb, `python3 esporta.py`). Se il GLB cambia l'impronta non torna:
// le zampe restano come prima (galoppo registrato), senza errori.
export const ZAMPE = {
  vPasso: [2.2, 3.2],           // u/s: dal passo al trotto
  vGaloppo: [5.5, 7.5],         // u/s: dal trotto al galoppo registrato
  corsaMax: 90,                 // unità del modello: oltre, la frequenza sale invece della falcata
  filtro: 0.3,                  // s, filtro sulla velocità vista (niente tremolio)
};
const ZAMPE_DATI = {"nv":796,"impronta":160177.3,"riposo":[[12,25.03,109.14,47.49],[13,20.9,109.02,33.7],[22,25.53,92.59,44.32],[23,19.87,88.9,34.44],[24,20.52,82.07,41.9],[25,25.2,79.19,57.17],[26,23.11,97.28,60.47],[27,21.8,83.44,64.56],[28,19.73,117.99,59.89],[34,24.2,73.89,51.96],[35,25.53,92.59,44.32],[36,25.2,79.19,57.17],[37,21.8,83.44,64.56],[38,16.8,62.41,84.93],[39,17.9,58.96,82.36],[44,17.5,55.52,79.39],[45,14.5,49.76,87.37],[46,15.2,51.72,89.41],[51,14.8,83.19,66.76],[52,16.0,91.55,64.33],[73,0.0,119.25,69.56],[78,0.0,94.25,70.24],[79,-0.05,86.74,64.59],[80,10.3,88.78,67.07],[81,9.0,81.41,60.82],[82,8.0,74.36,43.87],[107,4.2,128.98,-93.7],[120,21.8,83.44,64.56],[121,14.8,83.19,66.76],[122,16.8,62.41,84.93],[123,12.4,63.79,85.96],[128,11.5,48.39,85.84],[129,11.8,53.27,77.14],[134,16.0,71.3,46.61],[135,7.0,51.72,89.11],[136,5.9,58.87,81.86],[137,7.8,48.39,85.64],[138,7.4,54.06,77.76],[139,8.0,74.36,43.87],[140,6.4,75.68,57.5],[153,0.0,80.92,54.88],[154,0.0,79.29,41.52],[155,6.4,75.68,57.5],[168,11.8,30.93,112.69],[169,13.6,29.07,110.65],[170,14.3,53.38,91.25],[171,12.0,27.71,108.72],[176,9.2,32.21,113.92],[177,11.8,30.93,112.69],[178,11.4,54.45,92.47],[179,14.3,53.38,91.25],[180,9.6,26.35,107.09],[189,6.9,27.52,108.22],[190,5.4,29.18,110.45],[205,9.2,22.94,127.03],[206,9.2,19.44,121.86],[207,14.1,21.87,125.61],[208,12.7,18.47,120.53],[225,4.2,136.09,-154.39],[231,16.0,71.3,46.61],[232,24.2,73.89,51.96],[233,3.3,134.31,-89.31],[237,0.0,133.44,-91.33],[240,3.3,134.31,-89.31],[245,0.0,133.44,-91.33],[254,0.03,131.77,-107.81],[255,0.03,133.19,-124.03],[259,-0.09,130.0,-141.01],[268,9.0,81.41,60.82],[269,7.3,62.03,84.12],[270,6.7,30.94,112.39],[271,7.6,53.29,90.85],[273,8.7,25.94,131.59],[274,11.9,24.97,130.27],[276,0.0,106.57,71.11],[277,8.0,105.25,69.63],[315,9.0,29.57,120.76],[316,12.0,28.47,120.74],[317,6.0,28.48,120.34],[318,3.7,25.61,118.38],[319,6.4,26.52,113.4],[320,12.3,26.61,114.0],[321,9.4,26.34,112.2],[322,14.2,25.61,118.68],[323,12.0,28.47,120.74],[339,14.06,110.23,65.66],[340,0.0,106.57,71.11],[341,8.0,105.25,69.63],[346,-23.67,97.61,-58.89],[348,-27.55,105.58,-59.45],[349,-30.52,73.87,-69.06],[350,-23.95,71.35,-66.45],[355,-27.48,114.54,-73.2],[360,-13.88,135.44,-86.41],[361,-21.54,115.98,-89.86],[362,-24.0,68.23,-93.94],[363,-25.8,74.44,-95.12],[364,-20.2,69.95,-113.13],[365,-20.4,73.8,-116.16],[384,-24.1,87.49,-86.29],[385,-28.37,83.11,-78.29],[386,-21.8,80.41,-96.65],[387,-17.33,78.54,-121.28],[390,-11.4,28.79,-125.18],[391,-11.9,29.49,-122.36],[392,-17.9,66.15,-119.51],[393,-18.0,65.06,-115.55],[423,0.0,119.25,69.56],[426,-10.74,116.5,-98.4],[427,-15.2,101.67,-94.25],[429,-0.05,86.74,64.59],[431,0.0,94.25,70.24],[452,-4.47,130.29,-92.53],[469,-21.8,80.41,-96.65],[470,-17.6,83.66,-96.95],[471,-17.33,78.54,-121.28],[472,-16.99,81.06,-123.0],[475,-14.1,64.84,-114.57],[476,-8.4,29.66,-120.38],[483,-13.8,83.9,-97.12],[484,-9.8,74.04,-97.46],[485,-9.53,80.62,-121.82],[486,-10.2,76.2,-118.19],[497,0.0,79.29,41.52],[499,0.0,80.92,54.88],[500,-6.75,89.35,-77.87],[502,-4.54,88.06,-74.59],[516,-11.2,19.95,-122.75],[517,-11.3,19.78,-117.87],[518,-11.3,28.09,-128.0],[519,-9.6,21.62,-124.73],[524,-7.5,19.98,-115.57],[525,-11.3,28.09,-128.0],[526,-8.4,27.04,-129.26],[527,-9.6,21.62,-124.73],[528,-7.4,22.57,-125.34],[533,-4.4,30.66,-125.28],[534,-2.4,21.5,-121.89],[535,-5.6,28.72,-128.07],[536,-4.3,22.52,-124.64],[537,-15.96,83.47,-56.05],[538,-10.01,82.6,-52.57],[539,-13.8,66.72,-93.15],[540,-10.0,70.39,-113.23],[541,-4.4,30.63,-122.41],[542,-10.3,63.9,-116.32],[543,-9.3,65.77,-119.18],[544,-3.3,21.33,-117.93],[549,-9.2,12.55,-125.43],[550,-6.0,12.46,-123.19],[551,-11.5,11.64,-123.17],[552,-5.0,11.68,-118.76],[564,-5.01,135.84,-154.15],[566,-8.22,130.53,-158.05],[567,-8.22,130.53,-158.05],[577,-3.3,134.37,-89.34],[581,0.0,133.44,-91.33],[584,-3.3,134.37,-89.34],[585,-4.2,135.6,-97.49],[589,0.0,133.44,-91.33],[592,-18.73,83.88,-61.14],[595,-6.27,132.71,-107.37],[596,-8.05,134.23,-123.36],[599,0.03,131.77,-107.81],[600,0.03,133.19,-124.03],[602,-8.18,130.79,-141.34],[604,-0.09,130.0,-141.01],[624,0.0,106.57,71.11],[625,-11.5,70.34,-123.59],[626,-14.7,69.83,-123.6],[627,-16.1,67.82,-122.41],[628,-16.1,67.82,-122.41],[633,-15.9,68.59,-112.1],[634,-19.5,65.41,-93.24],[635,-23.95,71.35,-66.45],[636,-30.52,73.87,-69.06],[637,-28.37,83.11,-78.29],[638,-24.1,87.49,-86.29],[639,-24.1,87.49,-86.29],[640,-16.82,89.91,-91.72],[641,-6.83,82.97,-81.4],[642,-8.48,90.43,-90.84],[643,-6.1,9.89,-111.67],[644,-7.5,19.98,-115.57],[645,-11.0,10.02,-115.44],[646,-11.3,19.78,-117.87],[647,-2.4,21.5,-121.89],[648,-3.3,21.33,-117.93],[649,-0.2,12.31,-118.82],[650,-1.6,11.11,-114.37],[651,-4.3,22.52,-124.64],[652,-2.2,13.31,-124.23],[653,-9.6,21.62,-124.73],[654,-7.4,22.57,-125.34],[655,-9.2,12.55,-125.43],[656,-6.0,12.46,-123.19],[657,-11.5,11.64,-123.17],[658,-11.2,19.95,-122.75],[659,-9.2,12.55,-125.43],[660,-9.6,21.62,-124.73],[672,-6.83,82.97,-81.4],[686,0.0,106.57,71.11],[688,-8.48,90.43,-90.84],[689,-16.82,89.91,-91.72],[692,-6.1,9.89,-111.67],[693,-11.0,10.02,-115.44],[695,3.1,21.78,125.0],[696,4.7,25.17,130.18],[697,5.8,18.48,120.24],[698,6.9,27.52,108.22],[699,6.4,26.52,113.4],[700,7.8,48.39,85.64],[701,7.4,54.06,77.76],[702,8.0,74.36,43.87],[722,-2.2,13.31,-124.23],[723,-0.2,12.31,-118.82],[724,-1.6,11.11,-114.37],[725,-3.3,21.33,-117.93],[726,-1.6,11.11,-114.37],[727,-4.4,30.63,-122.41],[728,-3.3,21.33,-117.93],[729,-10.3,63.9,-116.32],[730,-10.0,70.39,-113.23],[731,-13.8,66.72,-93.15],[732,-18.73,83.88,-61.14],[733,14.1,21.87,125.61],[734,12.7,18.47,120.53],[735,14.2,25.61,118.68],[736,12.3,26.61,114.0],[737,9.2,19.44,121.86],[738,9.4,26.34,112.2],[739,6.4,26.52,113.4],[740,5.8,18.48,120.24],[741,3.1,21.78,125.0],[742,3.7,25.61,118.38],[743,5.8,18.48,120.24],[744,6.4,26.52,113.4],[745,4.7,25.17,130.18],[746,6.0,28.48,120.34],[747,8.7,25.94,131.59],[748,9.0,29.57,120.76],[749,11.9,24.97,130.27],[750,12.0,28.47,120.74],[751,11.9,24.97,130.27],[752,12.0,28.47,120.74],[781,-0.09,130.0,-141.01],[782,-0.09,130.0,-141.01]],"gambe":{"AS":{"ant":true,"zo":[205,206,207,208,273,274,695,696,697,733,734,737,740,741,743,745,747,749,751],"pas":[315,316,317,318,319,320,321,322,323,699,735,736,738,739,742,744,746,748,750,752],"fet":[168,169,171,176,177,180,189,190,270,698],"cr":[45,46,128,135,137,170,178,179,271,700],"ur":[38,39,44,122,123,129,136,138,269,701],"pv":[[22,0.325],[23,0.216],[24,0.619],[25,1.0],[26,0.525],[27,1.0],[34,1.0],[35,0.325],[36,1.0],[37,1.0],[51,1.0],[52,0.793],[78,0.169],[79,0.341],[80,0.855],[81,1.0],[82,1.0],[120,1.0],[121,1.0],[134,1.0],[139,1.0],[140,1.0],[153,0.399],[154,0.377],[155,1.0],[231,1.0],[232,1.0],[268,1.0],[276,0.006],[277,0.129],[339,0.027],[340,0.006],[341,0.129],[429,0.341],[431,0.169],[497,0.377],[499,0.399],[624,0.006],[686,0.006],[702,1.0]],"Jt":[55.94,77.93],"Jm":[85.25,54.91],"Jf":[110.5,29.24],"Jc":[121.48,24.63],"L1":37.2685,"L2":36.0121,"LP":11.902,"LZ":9.7256,"th0":{"U":-0.6656,"C":-0.7937,"Pas":-0.398,"Zo":0.1023},"delta":0.0884,"eps":0.0435,"LUC":73.209,"zoPiatto":-1.0443,"Vn":[40.06,125.46],"T":[-5.88,7.53],"Lv":41.2311,"thvN":-1.3258,"zN":70.78},"AD":{"ant":true,"zo":[545,546,547,548,620,621,708,709,710,755,756,758,759,761,763,765,767,769,771],"pas":[661,662,663,664,665,666,667,668,669,707,753,754,757,760,762,764,766,768,770,772],"fet":[512,513,515,520,521,523,531,532,616,706],"cr":[388,389,473,474,514,522,529,530,615,705],"ur":[378,379,382,466,468,477,479,480,614,704],"pv":[[78,0.157],[79,0.32],[153,0.421],[154,0.368],[276,0.01],[340,0.01],[356,0.05],[366,0.713],[367,0.427],[368,0.514],[369,1.0],[370,0.502],[371,1.0],[380,1.0],[381,1.0],[383,1.0],[394,0.738],[395,1.0],[428,1.0],[429,0.32],[430,0.803],[431,0.157],[432,1.0],[465,1.0],[467,1.0],[478,1.0],[481,1.0],[482,1.0],[497,0.368],[498,1.0],[499,0.421],[575,1.0],[576,1.0],[613,1.0],[623,0.094],[624,0.01],[684,0.045],[685,0.094],[686,0.01],[694,0.427],[703,1.0]],"Jt":[50.06,85.46],"Jm":[46.07,50.19],"Jf":[38.88,15.59],"Jc":[46.48,6.17],"L1":35.4901,"L2":35.3392,"LP":12.1077,"LZ":5.6571,"th0":{"U":-1.6833,"C":-1.7757,"Pas":-0.8921,"Zo":-1.9286},"delta":-0.0923,"eps":-0.0461,"LUC":70.7537,"zoPiatto":-1.9286,"Vn":[40.06,125.46],"T":[0.0,0.0],"Lv":41.2311,"thvN":-1.3258,"zN":61.16},"PS":{"ant":false,"zo":[297,299,301,302,303,304,305,307,308,309,310,313,690,691,718,719,720,721],"pas":[172,173,174,181,182,183,184,187,191,200,298,300,306,311,312,314,716,717,783],"fet":[47,49,132,133,175,185,186,188,192,199,715],"cr":[48,50,130,131,197,198,278,279,280,714],"ur":[18,20,43,125,127,142,195,284,285,713],"pv":[[19,1.0],[21,1.0],[40,0.212],[41,0.544],[42,1.0],[76,0.02],[77,0.227],[124,1.0],[126,1.0],[141,1.0],[156,0.107],[157,0.028],[158,0.057],[196,1.0],[286,1.0],[287,1.0],[291,0.212],[292,0.544],[293,0.655],[294,0.778],[295,0.23],[326,0.23],[327,0.115],[343,0.655],[344,0.778],[425,0.02],[501,0.057],[673,0.115],[711,0.544],[712,1.0]],"Jt":[-51.82,82.76],"Jm":[-112.84,62.05],"Jf":[-123.55,21.03],"Jc":[-117.62,9.1],"L1":44.0,"L2":34.0,"LP":13.3244,"LZ":9.3388,"th0":{"U":-2.8144,"C":-1.8262,"Pas":-1.1096,"Zo":-0.6878},"delta":0.7505,"eps":0.3248,"LUC":72.6651,"zoPiatto":-0.6875,"Vn":[-84.0,121.5],"T":[-10.18,0.74],"Lv":43.909,"thvN":-1.046,"zN":-80.33,"stira":[[5,0.9956,-0.11,0.33,1.0],[6,0.9098,1.63,-4.79,1.0],[18,0.0481,-0.8,2.35,1.0],[19,0.3682,-1.13,3.33,1.0],[20,0.087,0.63,-1.85,1.0],[21,0.3858,0.9,-2.64,1.0],[40,0.675,-3.25,9.57,1.0],[41,0.5419,-4.93,14.53,0.499],[42,0.348,-3.0,8.84,1.0],[43,0.0146,-2.36,6.95,1.0],[64,0.859,0.52,-1.54,1.0],[124,0.3463,-4.0,11.78,1.0],[125,-0.0043,-3.2,9.44,1.0],[126,0.3454,-4.04,11.9,1.0],[127,0.0079,-3.05,8.99,1.0],[141,0.3406,-0.85,2.5,1.0],[142,0.0169,-1.7,5.0,1.0],[156,0.7027,-4.14,12.2,0.6],[157,0.7388,-3.34,9.85,0.6],[193,1.0103,0.19,-0.57,1.0],[194,1.0029,0.14,-0.42,1.0],[195,0.0851,0.45,-1.31,1.0],[196,0.4023,1.49,-4.38,1.0],[284,0.0851,0.45,-1.31,1.0],[285,0.0986,1.12,-3.29,1.0],[286,0.4023,1.49,-4.38,1.0],[287,0.3978,1.86,-5.49,1.0],[288,0.9956,-0.11,0.33,1.0],[289,0.9098,1.63,-4.79,1.0],[290,0.859,0.52,-1.54,1.0],[291,0.675,-3.25,9.57,1.0],[292,0.5419,-4.93,14.53,0.499],[293,0.5018,-5.28,15.56,0.418],[294,0.4646,-5.61,16.53,0.341],[295,0.6469,-2.73,8.05,1.0],[296,0.9956,-0.11,0.33,1.0],[326,0.6469,-2.73,8.05,1.0],[343,0.5018,-5.28,15.56,0.418],[344,0.4646,-5.61,16.53,0.341],[711,0.5419,-4.93,14.53,0.499],[712,0.348,-3.0,8.84,1.0],[713,0.0146,-2.36,6.95,1.0]],"stiraAng0":0.3272},"PD":{"ant":false,"zo":[549,550,551,552,643,645,649,650,652,655,656,657,659,692,693,722,723,724,726],"pas":[516,517,519,524,527,528,534,536,544,644,646,647,648,651,653,654,658,660,725,728],"fet":[390,391,476,518,525,526,533,535,541,727],"cr":[392,393,475,542,543,625,626,627,628,729],"ur":[364,365,486,540,633,730],"pv":[[158,0.017],[327,0.043],[349,0.041],[350,0.017],[362,1.0],[363,1.0],[384,0.611],[385,0.3],[386,1.0],[387,0.071],[427,0.16],[469,1.0],[470,0.917],[471,0.071],[472,0.032],[483,0.795],[484,1.0],[485,0.068],[500,0.073],[501,0.017],[502,0.02],[539,1.0],[634,1.0],[635,0.017],[636,0.041],[637,0.3],[638,0.611],[639,0.611],[640,0.658],[641,0.323],[642,0.369],[672,0.323],[673,0.043],[688,0.369],[689,0.658],[731,1.0]],"Jt":[-59.47,81.04],"Jm":[-116.84,69.05],"Jf":[-125.14,29.18],"Jc":[-120.44,16.45],"L1":44.0,"L2":34.0,"LP":13.5679,"LZ":9.9423,"th0":{"U":-2.9356,"C":-1.7759,"Pas":-1.2172,"Zo":-0.7147},"delta":0.7505,"eps":0.3248,"LUC":72.6651,"zoPiatto":-0.7014,"Vn":[-84.0,122.0],"T":[-2.53,2.96],"Lv":43.909,"thvN":-1.046,"zN":-78.91,"stira":[[349,0.8149,1.03,-4.95,1.0],[350,0.8496,1.65,-7.88,1.0],[362,0.3797,1.12,-5.37,1.0],[363,0.3817,-0.17,0.81,1.0],[364,0.0652,-0.03,0.12,1.0],[365,0.028,-0.92,4.42,1.0],[384,0.5746,-2.41,11.55,0.6],[385,0.693,-1.2,5.75,1.0],[386,0.3769,-1.43,6.85,1.0],[387,-0.041,-2.08,9.98,1.0],[469,0.3769,-1.43,6.85,1.0],[470,0.3832,-2.09,10.01,1.0],[471,-0.041,-2.08,9.98,1.0],[472,-0.0609,-2.66,12.74,1.0],[483,0.3813,-2.15,10.28,1.0],[484,0.3411,-0.19,0.9,1.0],[485,-0.0426,-2.52,12.09,1.0],[486,0.0025,-1.49,7.12,1.0],[500,0.7218,-2.43,11.65,0.6],[502,0.7719,-2.04,9.76,0.6],[537,1.0657,-0.34,1.64,1.0],[538,1.1207,-0.03,0.12,1.0],[539,0.3876,1.46,-6.97,1.0],[540,0.0649,-0.12,0.56,1.0],[592,0.982,-0.64,3.06,1.0],[633,0.0777,0.29,-1.39,1.0],[634,0.3815,1.72,-8.21,1.0],[635,0.8496,1.65,-7.88,1.0],[636,0.8149,1.03,-4.95,1.0],[637,0.693,-1.2,5.75,1.0],[638,0.5746,-2.41,11.55,0.6],[639,0.5746,-2.41,11.55,0.6],[640,0.4923,-3.12,14.96,0.504],[641,0.6405,-1.3,6.24,1.0],[642,0.5089,-3.19,15.28,0.48],[672,0.6405,-1.3,6.24,1.0],[688,0.5089,-3.19,15.28,0.48],[689,0.4923,-3.12,14.96,0.504],[730,0.0649,-0.12,0.56,1.0],[731,0.3876,1.46,-6.97,1.0],[732,0.982,-0.64,3.06,1.0]],"stiraAng0":0.206}}};
// Collo e testa: perno alla base del collo, pesi che crescono verso la nuca (la testa
// ruota tutta, il collo si curva). Stessa origine dei dati delle zampe.
const COLLO_DATI = {"perno":[0.0,128.0,42.0],"v":[[14,0.022],[28,0.015],[30,0.022],[31,0.713],[32,0.129],[33,0.954],[53,0.613],[54,1.0],[55,1.0],[56,0.883],[57,0.946],[58,0.978],[59,0.947],[60,0.997],[61,0.997],[62,0.947],[63,1.0],[72,0.894],[73,0.131],[83,0.591],[84,1.0],[85,0.613],[86,1.0],[87,1.0],[88,1.0],[89,1.0],[90,1.0],[91,1.0],[92,1.0],[93,0.889],[94,1.0],[95,1.0],[96,1.0],[97,1.0],[98,1.0],[99,1.0],[100,0.942],[101,0.972],[102,0.942],[103,1.0],[104,1.0],[105,1.0],[106,1.0],[108,1.0],[109,1.0],[110,1.0],[111,1.0],[112,0.962],[113,0.99],[114,1.0],[115,1.0],[116,0.939],[117,1.0],[118,1.0],[119,1.0],[143,1.0],[144,1.0],[145,1.0],[146,1.0],[147,1.0],[148,1.0],[149,1.0],[150,1.0],[151,1.0],[152,1.0],[161,0.995],[163,0.989],[201,1.0],[202,1.0],[203,1.0],[204,1.0],[209,1.0],[210,1.0],[211,1.0],[212,1.0],[213,1.0],[214,1.0],[215,1.0],[216,1.0],[217,1.0],[218,1.0],[219,1.0],[226,1.0],[227,0.976],[228,1.0],[260,1.0],[261,1.0],[262,1.0],[263,1.0],[264,1.0],[265,1.0],[266,1.0],[267,1.0],[272,1.0],[281,0.977],[282,1.0],[283,1.0],[324,1.0],[325,1.0],[328,1.0],[329,1.0],[342,0.129],[357,0.041],[372,0.036],[374,0.041],[375,0.134],[376,0.697],[377,0.951],[396,1.0],[397,1.0],[398,0.603],[399,1.0],[400,1.0],[401,1.0],[402,0.904],[403,0.964],[404,1.0],[405,1.0],[406,1.0],[407,1.0],[408,1.0],[409,1.0],[410,0.956],[411,0.999],[412,0.999],[413,0.956],[414,0.981],[422,0.894],[423,0.131],[433,1.0],[434,1.0],[435,0.603],[436,0.591],[437,1.0],[438,1.0],[439,1.0],[440,1.0],[441,1.0],[442,1.0],[443,0.889],[444,1.0],[445,0.942],[446,0.942],[447,0.972],[448,1.0],[449,1.0],[450,1.0],[451,1.0],[453,1.0],[454,1.0],[455,1.0],[456,1.0],[457,0.993],[458,0.967],[459,1.0],[460,1.0],[461,0.939],[462,1.0],[463,1.0],[464,1.0],[487,1.0],[488,1.0],[489,1.0],[490,1.0],[491,1.0],[492,1.0],[493,1.0],[494,1.0],[495,1.0],[496,1.0],[504,0.991],[505,0.995],[553,1.0],[554,1.0],[555,1.0],[556,1.0],[557,1.0],[558,1.0],[559,1.0],[560,1.0],[561,1.0],[562,1.0],[563,1.0],[570,1.0],[571,1.0],[605,1.0],[606,1.0],[607,1.0],[608,1.0],[609,1.0],[610,1.0],[611,1.0],[612,1.0],[617,1.0],[618,1.0],[619,1.0],[630,0.981],[631,1.0],[632,1.0],[670,1.0],[671,1.0],[674,1.0],[687,0.134],[773,1.0],[774,1.0],[775,1.0],[776,1.0],[777,1.0],[778,1.0],[779,1.0],[780,1.0],[784,1.0],[785,1.0],[786,1.0],[787,1.0],[788,1.0],[789,1.0],[790,1.0],[791,1.0],[792,1.0],[793,1.0],[794,1.0],[795,1.0]]};
const ZAMPE_ORDINE = ["AS", "AD", "PS", "PD"];
const ZAMPE_PASSO = { PS: 0, AS: 0.25, PD: 0.5, AD: 0.75 };     // laterale a 4 tempi
const ZAMPE_TROTTO = { PS: 0, AS: 0.5, PD: 0.5, AD: 1.0 };      // diagonale (AD+PS, AS+PD)
// Posteriori: in volo il garretto si CHIUDE (gaskin indietro, stinco avanti), come nel cavallo vero.
const ZAMPE_PIEGA = { ant: { C: -0.8, Pas: -0.6, Zo: -0.9, U: 0.2 }, post: { C: 0.55, Pas: -0.4, Zo: -0.5, U: -0.35 } };
const _ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _ang = (az, ay, bz, by) => Math.atan2(by - ay, bz - az);

// Cinematica inversa dell'appoggio: zoccolo piatto a terra in zc (unità del modello).
function _appoggio(G, zc, dy) {
  const thv = G.thvN + 0.55 * (zc - G.zN) / 80;                  // la spalla/anca segue la gamba
  const tz = G.Vn[0] + G.Lv * Math.cos(thv), ty = G.Vn[1] + dy + G.Lv * Math.sin(thv);
  const cz = zc - G.LZ * Math.cos(G.zoPiatto), cy = -G.LZ * Math.sin(G.zoPiatto);   // corona
  // nodello: a LUC dal perno e a LP dalla corona, DIETRO la corona
  let fz, fy;
  const dz = cz - tz, dyy = cy - ty, d = Math.hypot(dz, dyy);
  if (d > G.LUC + G.LP || d < Math.abs(G.LUC - G.LP) || d === 0) {
    fz = tz + G.LUC * dz / d; fy = ty + G.LUC * dyy / d;          // gamba tesa
  } else {
    const a = (G.LUC * G.LUC - G.LP * G.LP + d * d) / (2 * d), h = Math.sqrt(Math.max(G.LUC * G.LUC - a * a, 0));
    const mz = tz + a * dz / d, my = ty + a * dyy / d, pz = -dyy / d, py = dz / d;
    const z1 = mz + h * pz, y1 = my + h * py, z2 = mz - h * pz, y2 = my - h * py;
    if (z1 < z2) { fz = z1; fy = y1; } else { fz = z2; fy = y2; }
  }
  const thU = _ang(tz, ty, fz, fy) - G.eps;
  return { v: thv, U: thU, C: thU + G.delta, Pas: _ang(fz, fy, cz, cy), Zo: G.zoPiatto };
}

function _statoGamba(G, n, fase, k, corsa, piega, dy) {
  const off = ZAMPE_PASSO[n] + (ZAMPE_TROTTO[n] - ZAMPE_PASSO[n]) * k;
  const b = 0.62 + (0.45 - 0.62) * k;
  const f = ((fase - off) % 1 + 1) % 1;
  if (f < b) return _appoggio(G, G.zN + corsa * (0.5 - f / b), dy);
  const s = (f - b) / (1 - b);
  const a0 = _appoggio(G, G.zN - corsa / 2, dy), a1 = _appoggio(G, G.zN + corsa / 2, dy);
  const t = s * s * (3 - 2 * s), bb = Math.pow(Math.sin(Math.PI * s), 1.3) * piega;
  const P = G.ant ? ZAMPE_PIEGA.ant : ZAMPE_PIEGA.post, out = {};
  for (const q in a0) out[q] = a0[q] + (a1[q] - a0[q]) * t + (P[q] || 0) * bb;
  return out;
}

// Scrive la posa in `out` (Float32Array delle posizioni) a partire dalla posa di riposo.
function _posaZampe(R, stati, dy, out) {
  out.set(R);
  if (dy) for (let i = 1; i < out.length; i += 3) out[i] += dy;
  for (const n of ZAMPE_ORDINE) {
    const G = ZAMPE_DATI.gambe[n], a = stati[n];
    const dv = a.v - G.thvN, cv = Math.cos(dv), sv = Math.sin(dv);
    const Vz = G.Vn[0], Vy = G.Vn[1];
    // spalla/coscia: osso virtuale, pesato sulla pelle
    for (let i = 0; i < G.pv.length; i += 1) {
      const v = G.pv[i][0], w = G.pv[i][1];
      const qz = R[3 * v + 2] + G.T[0] - Vz, qy = R[3 * v + 1] + G.T[1] - Vy;
      out[3 * v + 2] = (1 - w) * R[3 * v + 2] + w * (cv * qz - sv * qy + Vz);
      out[3 * v + 1] = (1 - w) * (R[3 * v + 1] + dy) + w * (sv * qz + cv * qy + Vy + dy);
    }
    const qz = G.Jt[0] + G.T[0] - Vz, qy = G.Jt[1] + G.T[1] - Vy;
    const tz = cv * qz - sv * qy + Vz, ty = sv * qz + cv * qy + Vy + dy;
    const mz = tz + G.L1 * Math.cos(a.U), my = ty + G.L1 * Math.sin(a.U);
    const fz = mz + G.L2 * Math.cos(a.C), fy = my + G.L2 * Math.sin(a.C);
    const kz = fz + G.LP * Math.cos(a.Pas), ky = fy + G.LP * Math.sin(a.Pas);
    const osso = (lista, J0, z1, y1, dth, peso) => {
      const c = Math.cos(dth), s = Math.sin(dth);
      for (let i = 0; i < lista.length; i += 1) {
        const v = lista[i], pz = R[3 * v + 2] - J0[0], py = R[3 * v + 1] - J0[1];
        const nz = c * pz - s * py + z1, ny = s * pz + c * py + y1;
        if (peso === 1) { out[3 * v + 2] = nz; out[3 * v + 1] = ny; }
        else if (peso === 0) { out[3 * v + 2] = 0.5 * nz; out[3 * v + 1] = 0.5 * ny; }
        else { out[3 * v + 2] += 0.5 * nz; out[3 * v + 1] += 0.5 * ny; }
      }
    };
    osso(G.ur, G.Jt, tz, ty, a.U - G.th0.U, 1);
    osso(G.cr, G.Jm, mz, my, a.C - G.th0.C, 1);
    osso(G.pas, G.Jf, fz, fy, a.Pas - G.th0.Pas, 1);
    osso(G.zo, G.Jc, kz, ky, a.Zo - G.th0.Zo, 1);
    osso(G.fet, G.Jf, fz, fy, a.C - G.th0.C, 0);            // nodello: metà stinco (attaccato al suo capo basso)…
    osso(G.fet, G.Jf, fz, fy, a.Pas - G.th0.Pas, 2);         // …metà pastorale
    if (G.stira) {
      // POSTERIORI: il tubo garretto→grassella si accorcia. Ogni vertice sta a una
      // frazione t dell'asse fra garretto (mz,my) e grassella (tz,ty), con il suo
      // scostamento dall'asse ruotato quanto l'asse.
      const da = Math.atan2(ty - my, tz - mz) - G.stiraAng0, c = Math.cos(da), s = Math.sin(da);
      for (let i = 0; i < G.stira.length; i += 1) {
        const r = G.stira[i], v = r[0], t = r[1], w = r[4];
        const pz = mz + t * (tz - mz) + c * r[2] - s * r[3], py = my + t * (ty - my) + s * r[2] + c * r[3];
        out[3 * v + 2] += (pz - out[3 * v + 2]) * w;
        out[3 * v + 1] += (py - out[3 * v + 1]) * w;
      }
    }
  }
  return out;
}

function _ruotaCollo(px, py, pz, yaw, pitch, out, i) {
  const P = COLLO_DATI.perno;
  const x = px - P[0], y = py - P[1], z = pz - P[2];
  const cb = Math.cos(pitch), sb = Math.sin(pitch);
  const y2 = y * cb - z * sb, z2 = y * sb + z * cb;
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  out[i] = P[0] + x * ca + z2 * sa; out[i + 1] = P[1] + y2; out[i + 2] = P[2] - x * sa + z2 * ca;
}
const _cq = new Float32Array(3);
function _posaCollo(out, yaw, pitch) {
  const V = COLLO_DATI.v;
  for (let k = 0; k < V.length; k += 1) {
    const v = V[k][0], w = V[k][1], i = 3 * v;
    _ruotaCollo(out[i], out[i + 1], out[i + 2], yaw * w, pitch * w, out, i);
  }
}
const _molla = (x, v, b, f, z, dt) => {
  const w = 2 * Math.PI * f, n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
  for (let i = 0; i < n; i += 1) { v += (-w * w * (x - b) - 2 * z * w * v) * h; x += v * h; }
  return [x, v];
};
let _ct = null;      // Vector3 di lavoro per il bersaglio del muso

function _preparaZampe(mesh) {
  const ud = mesh.userData;
  if (ud.zampe !== undefined) return ud.zampe;
  ud.zampe = null;
  const g = mesh.geometry, pos = g && g.attributes && g.attributes.position;
  if (!pos || pos.count !== ZAMPE_DATI.nv) return null;
  let imp = 0;
  for (let i = 0; i < pos.array.length; i += 1) imp += Math.abs(pos.array[i]);
  if (Math.abs(imp - ZAMPE_DATI.impronta) > 2) return null;
  const geo = g.clone();                 // geometria propria: le posizioni cambiano cavallo per cavallo
  mesh.geometry = geo;
  const base = new Float32Array(geo.attributes.position.array);
  const riposo = new Float32Array(base);
  for (const r of ZAMPE_DATI.riposo) { riposo[3 * r[0]] = r[1]; riposo[3 * r[0] + 1] = r[2]; riposo[3 * r[0] + 2] = r[3]; }
  const delta = (geo.morphAttributes && geo.morphAttributes.position || []).map((a) => a.array);
  ud.zampe = { geo, base, riposo, delta, rel: geo.morphTargetsRelative !== false, tmp: new Float32Array(base.length),
               fase: 0, v: 0, vAv: 0, om: 0, dy: 0, attivo: false, px: null, pz: 0, yaw: 0,
               cy: 0, cyv: 0, cp: 0, cpv: 0 };
  return ud.zampe;
}

// Torna alla posa base del GLB (cavallo caduto, o fuori dal passo).
export function ripristinaZampe(mesh) {
  const Z = mesh && mesh.userData && mesh.userData.zampe;
  if (!Z || !Z.attivo) return;
  Z.geo.attributes.position.array.set(Z.base);
  Z.geo.attributes.position.needsUpdate = true;
  Z.attivo = false; Z.dy = 0;
}

let _zp = null, _zd = null, _zs = null;     // Vector3 presi dalla mesh stessa (il modulo non importa three)
// Da chiamare a ogni frame DOPO mixer.update. Restituisce true se ha messo lei le
// zampe (passo, trotto o sfumatura verso il galoppo): allora i pesi del galoppo
// sono già stati usati e azzerati e il chiamante non deve toccarli.
// false = galoppo pieno: tutto come prima (pesi del mixer sulla posa base).
export function aggiornaZampe(mesh, dt, cavallo) {
  try { return _aggiornaZampe(mesh, dt, cavallo); }
  catch (e) {                                       // mai fermare il gioco per le zampe: si torna al galoppo registrato
    console.warn("[zampe] spente su questo cavallo:", e);
    try { ripristinaZampe(mesh); } catch (e2) { /* niente */ }
    if (mesh && mesh.userData) mesh.userData.zampe = null;
    return false;
  }
}
function _aggiornaZampe(mesh, dt, cavallo) {
  const Z = _preparaZampe(mesh);
  if (!Z) return false;
  if (!(dt > 0)) return Z.attivo;
  if (!_zp) { _zp = mesh.position.clone(); _zd = mesh.position.clone(); _zs = mesh.position.clone(); }
  mesh.getWorldPosition(_zp); mesh.getWorldDirection(_zd); mesh.getWorldScale(_zs);
  const yaw = Math.atan2(_zd.x, _zd.z);
  let vI = 0, vAvI = 0, omI = 0;
  if (Z.px !== null) {
    const dx = _zp.x - Z.px, dz = _zp.z - Z.pz, d = Math.hypot(dx, dz);
    if (d < 2.5) {                                   // un salto più lungo non è camminare (chiamata, cambio scena)
      vI = d / dt; vAvI = (dx * _zd.x + dz * _zd.z) / dt;
      let dyaw = yaw - Z.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      omI = dyaw / dt;
    }
  }
  Z.px = _zp.x; Z.pz = _zp.z; Z.yaw = yaw;
  const a = 1 - Math.exp(-dt / ZAMPE.filtro);
  Z.v += (vI - Z.v) * a; Z.vAv += (vAvI - Z.vAv) * a; Z.om += (Math.max(-3, Math.min(3, omI)) - Z.om) * a;
  const gal = _ss(ZAMPE.vGaloppo[0], ZAMPE.vGaloppo[1], Z.v);
  const pos = Z.geo.attributes.position, infl = mesh.morphTargetInfluences;
  if (gal >= 1) { ripristinaZampe(mesh); Z.cy = Z.cyv = Z.cp = Z.cpv = 0; if (cavallo) cavallo.scattoVista = null; return false; }
  // andatura dalla velocità vista
  const scala = Math.abs(_zs.z) || 1;                // unità di gioco per unità del modello
  const vEff = Math.hypot(Z.v, Math.abs(Z.om) * 0.8);   // girarsi sul posto = fare i passi
  const k = _ss(ZAMPE.vPasso[0], ZAMPE.vPasso[1], Z.v);
  const duty = 0.62 + (0.45 - 0.62) * k;
  let f = (0.75 + 0.15 * vEff) + ((1.15 + 0.1 * vEff) - (0.75 + 0.15 * vEff)) * k;
  let corsa = (Z.vAv * duty / f) / scala;
  if (Math.abs(corsa) > ZAMPE.corsaMax) { f *= Math.abs(corsa) / ZAMPE.corsaMax; corsa = Math.sign(corsa) * ZAMPE.corsaMax; }
  const moto = _ss(0.03, 0.4, vEff);
  Z.fase = (Z.fase + f * moto * dt) % 1;
  const piega = moto * Math.min(1, 0.35 + Math.abs(corsa) / 60);
  const dy = -(1.0 + 1.5 * k) * Math.cos(4 * Math.PI * Z.fase) * piega;
  const stati = {};
  for (const n of ZAMPE_ORDINE) stati[n] = _statoGamba(ZAMPE_DATI.gambe[n], n, Z.fase, k, corsa, piega, dy);
  const SC = _scatto(Z, cavallo, dt);               // §9: scatto al via, canape forzato, distratto
  if (SC) for (const n of ZAMPE_ORDINE) {
    const O = ZAMPE_DATI.gambe[n].ant ? SC.ant : SC.post;
    for (const q in O) stati[n][q] += O[q];
  }
  const out = pos.array;
  _posaZampe(Z.riposo, stati, dy, out);
  // sfumatura verso il galoppo registrato (posizioni del clip calcolate qui, poi pesi a zero)
  if (infl) {
    if (gal > 0) {
      const t = Z.tmp; t.set(Z.base);
      let somma = 0;
      for (let m = 0; m < infl.length && m < Z.delta.length; m += 1) {
        const w = infl[m]; if (!w) continue; somma += w;
        const D = Z.delta[m];
        for (let i = 0; i < t.length; i += 1) t[i] += w * D[i];
      }
      if (!Z.rel && somma) for (let i = 0; i < t.length; i += 1) t[i] -= somma * Z.base[i];
      for (let i = 0; i < out.length; i += 1) out[i] += (t[i] - out[i]) * gal;
    }
    infl.fill(0);
  }
  // MUSO ADDOSSO (§6 decide chi e quanto, qui si gira la testa): il bersaglio è il
  // collo del vicino, portato nelle coordinate del modello.
  const R6 = cavallo && cavallo.reaz, M6 = REAZIONE.muso;
  let yawB = 0, pitchB = 0;
  if (R6 && R6.muso > 0.005 && R6.musoAltro && R6.musoAltro.group) {
    if (!_ct) _ct = _zp.clone();
    _ct.set(0, 1.5, 0.9); R6.musoAltro.group.localToWorld(_ct); mesh.worldToLocal(_ct);
    const P = COLLO_DATI.perno;
    const verso = Math.max(-M6.yawMax, Math.min(M6.yawMax, Math.atan2(_ct.x - P[0], Math.max(_ct.z - P[2], 1))));
    const becca = Math.sin(2 * Math.PI * M6.becca * R6.musoT);
    yawB = verso * R6.muso * (1 - M6.beccaAmp + M6.beccaAmp * becca);
    pitchB = M6.giu * R6.muso * (0.7 + 0.3 * becca);
  }
  if (SC && SC.guarda) { yawB = SC.guarda; pitchB = -0.12; }           // distratto: guarda la folla
  const fCollo = SC && SC.sorpreso ? 3.0 : 1.1;                         // si accorge del via: la testa scatta avanti
  [Z.cy, Z.cyv] = _molla(Z.cy, Z.cyv, yawB, fCollo, 0.8, dt);
  [Z.cp, Z.cpv] = _molla(Z.cp, Z.cpv, pitchB, fCollo, 0.8, dt);
  const cpTot = Z.cp + (SC ? SC.collo : 0);
  if (Math.abs(Z.cy) > 1e-4 || Math.abs(cpTot) > 1e-4) _posaCollo(out, Z.cy * (1 - gal), cpTot * (1 - gal));
  pos.needsUpdate = true;
  Z.attivo = true; Z.dy = dy * (1 - gal); Z.colloYaw = Z.cy * (1 - gal); Z.colloPitch = cpTot * (1 - gal);
  return true;
}


// ════════════════════════════════════════════════════════════════════════════
// 9. SCATTO DAI CANAPI — raccolta, spinta, prime falcate; canape forzato; distratto
// ════════════════════════════════════════════════════════════════════════════
// Simone 11/11: «migliora lo scattino di F alla mossa, deve essere una mossa in cui chi
// è reattivo scatta, chi è distratto rimane lì come un coglione». Prima al via il corpo
// SCIVOLAVA avanti di 1,6 u e tornava (seno su progVista): finto. Ora, a vista:
//  · RACCOLTA (0-0,3 s): il dietro si carica (garretti piegati, posteriori sotto il
//    corpo); il davanti resta BASSO (anteriori appena piegati): niente impennata, non
//    deve sembrare un salto sopra il canape (Simone);
//  · SPINTA (0,15-0,5 s): posteriori distesi indietro, anteriori che allungano avanti
//    radenti, muso giù, il corpo si butta avanti; il fantino si piega sul collo;
//  · poi le falcate le fa §7 con la velocità vera (la fiancata buona la dà il gioco).
// Intensità: fiancata buona («perfetta») 1; «anticipo» (F appena dopo il via) 0,6;
// partenza normale 0,35; DISTRATTO che si accorge tardi 0,55, con la testa che scatta.
// Il DISTRATTO (h.distratto, deciso dal gioco al via) finché aspetta (h.launching) resta
// fermo a guardare la folla, testa girata. Il CANAPE FORZATO (h.scattoT ai canapi): si
// butta di petto contro la corda, muso giù, testa su all'urto, poi torna.
// Uscita: h.scattoVista = { pitch, dy, fantino } per placeHorse (beccheggio e quota del
// gruppo, piega in avanti del fantino); le gambe e il collo li pone qui §7.
export const SCATTO = {
  intensita: { perfetta: 1.0, anticipo: 0.6, normale: 0.35, sorpreso: 0.55, canape: 1.0 },
  durata: 1.2,          // s
  guarda: 0.45,         // rad: quanto gira la testa il distratto
};
const _bmp = (t, a, b) => { if (t <= a || t >= b) return 0; const x = (t - a) / (b - a); return Math.sin(Math.PI * x); };
function _scatto(Z, h, dt) {
  if (!h) return null;
  // ── trigger
  const via = h.launchRamp != null && h.launchRamp < 0.08 && !h.launching;
  if (h.launchRamp != null && h.launchRamp > 0.5) h._scattoVia = false;
  let nuovo = null;
  if ((h.scattoT || 0) > 0.42 && !(h._sc && h._sc.tipo === "canape" && h._sc.t < 0.6)) nuovo = "canape";
  else if (via && !h._scattoVia) {
    h._scattoVia = true;
    nuovo = h.fiancaTipo === "perfetta" ? "perfetta" : h.fiancaTipo === "anticipo" ? "anticipo" : (h._eraDistratto ? "sorpreso" : "normale");
  } else if (h.fiancaTipo === "anticipo" && h._sc && h._sc.tipo !== "anticipo" && h._sc.tipo !== "perfetta" && h._sc.t > 0.2 && !h._anticipoVisto) {
    nuovo = "anticipo"; h._anticipoVisto = true;
  } else if ((h.balzoT || 0) > 0.5 && !(h._sc && h._sc.tipo === "perfetta")) nuovo = "perfetta";
  if (!h.fiancaTipo) h._anticipoVisto = false;
  if (nuovo) h._sc = { tipo: nuovo, t: 0, A: SCATTO.intensita[nuovo] };
  // ── distratto che aspetta: testa girata verso la folla
  const aspetta = !!(h.distratto && h.launching);
  if (aspetta) { if (!h._latoGuarda) h._latoGuarda = Math.random() < 0.5 ? -1 : 1; h._eraDistratto = true; }
  else if (!h.launching && h._eraDistratto && h.launchRamp > 0.5) h._eraDistratto = false;
  const c = h._sc;
  if (!c && !aspetta) { h.scattoVista = null; return null; }
  const out = { ant: {}, post: {}, collo: 0, guarda: aspetta ? h._latoGuarda * SCATTO.guarda : 0, sorpreso: false };
  let pitch = 0, dyg = 0, fantino = 0;
  if (c) {
    c.t += dt;
    const t = c.t, A = c.A;
    if (c.tipo === "canape") {
      // di petto contro la corda: anteriori avanti, posteriori che spingono, muso giù,
      // all'urto (t ≈ 0,25) la testa va su; poi torna
      const s = _bmp(t, 0, 0.5), urto = _bmp(t, 0.18, 0.45);
      out.ant = { U: 0.45 * s, C: -0.25 * s };
      out.post = { U: 0.25 * s, C: -0.3 * s };
      out.collo = 0.12 * s - 0.3 * urto;
      pitch = 0.10 * s; dyg = 0.02 * s; fantino = 0.25 * s;
      if (t > 0.6) h._sc = null;
    } else {
      const r = _bmp(t, 0, 0.3), sp = _bmp(t, 0.15, 0.52);
      // Scatto BASSO e potente (Simone: «non deve saltare il canape»): il dietro si
      // carica, gli anteriori NON si alzano — si piegano appena e allungano avanti
      // radenti, il corpo si butta avanti col muso basso. Niente impennata.
      out.ant = { U: (0.12 * r + 0.65 * sp) * A, C: (-0.45 * r - 0.25 * sp) * A, Pas: -0.25 * r * A, Zo: -0.25 * r * A };
      out.post = { U: (-0.3 * r + 0.35 * sp) * A, C: (0.55 * r - 0.4 * sp) * A };
      out.collo = (0.05 * r + 0.18 * sp) * A;     // testa avanti e giù, non su
      pitch = (-0.08 * r + 0.10 * sp) * A;        // appena seduto, poi muso giù nella spinta
      dyg = (-0.05 * r + 0.02 * sp) * A;
      const e1 = Math.min(1, t / 0.2), e2 = Math.max(0, Math.min(1, (t - 0.8) / 0.6));
      fantino = 0.35 * A * e1 * (1 - e2);
      out.sorpreso = c.tipo === "sorpreso" && t < 0.4;
      if (t > SCATTO.durata + 0.2) h._sc = null;
    }
  }
  h.scattoVista = { pitch, dy: dyg, fantino };
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. CADUTA DEL CAVALLO — corpo rigido con gravità e contatto vero col tufo
// ════════════════════════════════════════════════════════════════════════════
// Simone 11/11: «fai proprio una dinamica di caduta corretta». La logica (chi cade,
// quando, quanto resta giù, la scivolata) è del gioco: horse.caduto, cadutoTimer,
// cadutoDir, cadutoSlide. Qui il corpo è un CORPO RIGIDO attorno al suo baricentro:
//  · TUFFO    — il davanti cede (carpi piegati): beccheggio in avanti che accelera,
//               il baricentro cade con la gravità (all'inizio il dietro regge un po'),
//               il rollio verso il fianco comincia; lo slancio in avanti continua
//               (lo fa il gioco con la scivolata);
//  · CONTATTO — calcolato sui VERTICI DEL CORPO: tocca per primo il punto più basso
//               (petto o spalla nel tuffo). Il corpo non entra mai nel tufo e non
//               galleggia: l'altezza del baricentro la decide il contatto. All'urto:
//               rimbalzo, colpo di frusta del collo, polvere e scossa (eventi al gioco);
//  · SUL FIANCO — la gravità lo rovescia sul fianco (rollio fino a CADUTA.roll, con un
//               piccolo rimbalzo), il dietro ricade (beccheggio che torna a zero con
//               una molla smorzata), sbandata in imbardata che si spegne strisciando,
//               zampe che scalciano sempre meno;
//  · RIALZATA — negli ultimi CADUTA.rialzata s di cadutoTimer: sul petto con le zampe
//               raccolte, su il davanti, su il dietro, muso di nuovo nel verso della pista.
// Contro i materassi: quando la scivolata ci arriva contro il gioco segna h.cadMuro (0..1)
// e qui il corpo sobbalza, si stacca dal fianco, gira e fa il colpo di frusta.
// Lato: cadutoDir > 0 → sul fianco verso la corsia + (interno), < 0 → verso la corsia −
// (esterno, i materassi). Uscita per placeHorse: h.cadVista = { roll, pitch, yaw, dx, dy,
// dz } — angoli (ordine YXZ) e spostamento del gruppo nel riferimento della pista, così
// che si ruoti attorno al baricentro e non attorno agli zoccoli. Eventi: h.cadImpatto
// (0..1, una volta all'urto), h.cadStriscia (0..1 mentre striscia) per polvere e suoni.
export const CADUTA = {
  g: 10.9,            // u/s² (1 u ≈ 0,9 m)
  sostegno: 0.18,     // s: all'inizio il dietro regge ancora metà del peso
  tuffo: 5.5,         // rad/s²: il muso va giù (finché non tocca)
  tuffoMax: 0.75,     // rad
  rollio0: 0.6,       // rad/s: comincia a piegarsi sul fianco già nel tuffo
  rollioA: 5.0,       // rad/s²: la gravità lo rovescia
  roll: 1.5,          // rad: tutto sul fianco, zampe quasi orizzontali sul tufo
  rimbalzo: 0.22,     // restituzione all'urto (verticale e del rollio)
  imbardata0: 0.35,   // rad/s: sbandata (la pista gira sotto, il corpo va dritto)
  affonda: 0.06,      // u: quanto una zampa può affondare nel tufo (morbido) prima di reggere il corpo
  strisciaAttrito: 1.4, // 1/s: la sbandata si spegne strisciando
  rialzata: 1.6,      // s, presi dalla fine di cadutoTimer
  pSu: 0.42,          // rad: muso su da seduto
  dySeduto: -0.29,    // u
  dyPetto: -0.78,     // u: sul petto
  scalcia: 1.8,       // Hz
};
const _c01 = (x) => Math.max(0, Math.min(1, x));
const _ese = (x) => { x = _c01(x); return x * x * (3 - 2 * x); };
const _lrp = (a, b, t) => a + (b - a) * t;
function _mix(A, B, t) { const o = {}; for (const k in A) o[k] = A[k] + ((B[k] ?? A[k]) - A[k]) * t; return o; }
function _cede(G, a) { return G.ant ? { ...a, U: a.U + 0.25, C: a.C - 1.5, Pas: a.Pas - 0.6, Zo: a.Zo - 0.6 } : a; }
function _distesa(G, a, ph, amp) {
  const s = Math.sin(ph), c = Math.max(0, Math.cos(ph));
  return G.ant
    ? { ...a, U: a.U + 0.35 + 0.35 * amp * s, C: a.C - 0.25 - 0.45 * amp * c, Pas: a.Pas - 0.3, Zo: a.Zo - 0.3 }
    : { ...a, U: a.U - 0.15 + 0.3 * amp * s, C: a.C + 0.15 + 0.4 * amp * c, Pas: a.Pas - 0.3, Zo: a.Zo - 0.4 };
}
// Sul petto: zampe ripiegate piatte sotto il corpo (la pancia resta ~0,13 u sopra il tufo).
const _RACC = { ant: { U: -3.002, C: 0.07, Pas: -2.618, Zo: -2.793 }, post: { U: -0.209, C: -3.072, Pas: -2.967, Zo: -3.107 } };
function _raccolta(G, a) { return { ...a, ...(G.ant ? _RACC.ant : _RACC.post) }; }
const _FASE_ZAMPA = { AS: 0, AD: 1.7, PS: 3.4, PD: 5.1 };

// Rotazione R = Ry(yaw)·Rx(pitch)·Rz(roll) (ordine YXZ di three.js) applicata a (x,y,z).
function _ruota(yaw, pitch, roll, x, y, z, o) {
  const cz = Math.cos(roll), sz = Math.sin(roll);
  const x1 = x * cz - y * sz, y1 = x * sz + y * cz, z1 = z;
  const cx = Math.cos(pitch), sx = Math.sin(pitch);
  const y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  o[0] = x1 * cy + z2 * sy; o[1] = y2; o[2] = -x1 * sy + z2 * cy;
  return o;
}
const _rv = [0, 0, 0];
// Punti del corpo (niente gambe) nel riferimento del GRUPPO, relativi al baricentro.
function _corpoCaduta(mesh, h, Z) {
  if (Z.corpo) return Z.corpo;
  const gamba = new Set();
  for (const n of ZAMPE_ORDINE) {
    const G = ZAMPE_DATI.gambe[n];
    for (const k of ["zo", "pas", "fet", "cr", "ur"]) for (const v of G[k]) gamba.add(v);
    if (G.stira) for (const r of G.stira) gamba.add(r[0]);
  }
  mesh.updateWorldMatrix(true, false); h.group.updateWorldMatrix(true, false);
  const inv = h.group.matrixWorld.clone().invert();
  const M = inv.multiply(mesh.matrixWorld);      // modello → gruppo (non dipende da dove sta il gruppo)
  const e = M.elements, R = Z.riposo, pts = [];
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < R.length / 3; v += 1) {
    if (gamba.has(v)) continue;
    const x = R[3 * v], y = R[3 * v + 1], z = R[3 * v + 2];
    const gx = e[0] * x + e[4] * y + e[8] * z + e[12], gy = e[1] * x + e[5] * y + e[9] * z + e[13], gz = e[2] * x + e[6] * y + e[10] * z + e[14];
    pts.push(gx, gy, gz); cx += gx; cy += gy; cz += gz;
  }
  const n = pts.length / 3; cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < pts.length; i += 3) { pts[i] -= cx; pts[i + 1] -= cy; pts[i + 2] -= cz; }
  const zampa = new Uint8Array(R.length / 3); gamba.forEach((v) => { zampa[v] = 1; });
  Z.corpo = { pts: new Float32Array(pts), c: [cx, cy, cz], M: Float32Array.from(e), zampa };
  return Z.corpo;
}
// Punto più basso del corpo (rispetto al baricentro) con questa rotazione.
function _piuBasso(P, yaw, pitch, roll) {
  let m = Infinity;
  for (let i = 0; i < P.length; i += 3) {
    _ruota(yaw, pitch, roll, P[i], P[i + 1], P[i + 2], _rv);
    if (_rv[1] < m) m = _rv[1];
  }
  return m;
}

export function aggiornaCaduta(mesh, dt, cavallo) {
  try { return _aggiornaCaduta(mesh, dt, cavallo); }
  catch (e) {
    console.warn("[caduta] animazione spenta su questo cavallo:", e);
    if (cavallo) { cavallo.cadVista = null; cavallo.cad = null; }
    return false;
  }
}
function _aggiornaCaduta(mesh, dt, h) {
  const Z = _preparaZampe(mesh);
  if (!Z || !h || !h.group) return false;
  if (!h.caduto) {
    if (h.cad) { h.cad = null; Z.px = null; }
    h.cadVista = h.cadutoRoll ? { roll: 0, pitch: 0, yaw: 0, dx: 0, dy: 0, dz: 0 } : null;
    h.cadStriscia = 0;
    return false;
  }
  if (!(dt > 0)) return true;
  const K = CADUTA, corpo = _corpoCaduta(mesh, h, Z), P = corpo.pts, cc = corpo.c;
  if (!h.cad) {
    h.cad = { t: 0, lato: (h.cadutoDir || 1) > 0 ? 1 : -1, th: 0, wth: 0, ph: 0, wph: 0, ps: 0, wps: K.imbardata0,
              yc: cc[1], vy: 0, contatto: false, tC: 0, collo: 0, wcollo: 0, ultimo: null };
    h.cad.wph = h.cad.lato * K.rollio0;
  }
  const c = h.cad, lato = c.lato, resto = h.cadutoTimer ?? 0;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), hs = dt / n;
  let impatto = 0;
  if (h.cadMuro && resto >= K.rialzata) {
    // BATTE contro i materassi strisciando (il gioco segna h.cadMuro, 0..1): sobbalza,
    // il colpo lo stacca un poco dal fianco, il treno posteriore gira, colpo di frusta.
    const k = h.cadMuro, giro = (Math.random() < 0.5 ? -1 : 1);
    if (!c.contatto) {            // SI IMPANCIA: il petto si ferma contro i materassi, il dietro va avanti
      c.wth += 2.2 * k; c.wph -= lato * 0.8 * k; c.wps += giro * 0.8 * k;
    } else {                      // già sul fianco, ci striscia contro: piccolo sobbalzo, si stacca e gira
      c.vy = Math.max(c.vy, 0.6 * k); c.wph -= lato * 1.2 * k; c.wps += giro * 1.2 * k;
    }
    c.wcollo += -5 * k;
    impatto = 0.5 + 0.5 * k;
  }
  h.cadMuro = 0;
  if (resto >= K.rialzata) {
    for (let i = 0; i < n; i += 1) {
      c.t += hs;
      // ── angoli
      if (!c.contatto) {
        if (c.th < K.tuffoMax) c.wth += K.tuffo * hs;
        else c.wth *= Math.exp(-10 * hs);               // oltre il massimo il tuffo si ferma (il collo e il petto lo reggono)
        c.wph += lato * K.rollioA * hs;
      } else {
        // il dietro ricade: beccheggio verso ~0 con una molla smorzata (2 Hz, z 0,55)
        const w = 2 * Math.PI * 1.6;
        c.wth += (-w * w * (c.th - 0.04) - 2 * 0.55 * w * c.wth) * hs;
        // la gravità lo rovescia sul fianco
        if (Math.abs(c.ph) < K.roll) c.wph += lato * K.rollioA * 1.6 * Math.max(0.25, Math.cos(c.ph)) * hs;
        c.wps *= Math.exp(-K.strisciaAttrito * hs);
      }
      c.th += c.wth * hs; c.ph += c.wph * hs; c.ps += c.wps * hs;
      if (Math.abs(c.ph) >= K.roll) {                     // appoggiato sul fianco: rimbalzo piccolo, poi fermo
        c.ph = lato * K.roll;
        if (c.wph * lato > 0) c.wph = -c.wph * K.rimbalzo;
      }
      c.wph *= Math.exp(-(c.contatto ? 2.5 : 0.3) * hs);
      // ── baricentro: gravità (all'inizio il dietro regge metà del peso)
      c.vy -= K.g * (c.t < K.sostegno ? 0.5 : 1) * hs;
      c.yc += c.vy * hs;
      // ── contatto sul punto più basso del corpo
      const basso = c.yc + _piuBasso(P, c.ps, c.th, c.ph);
      if (basso < 0) {
        c.yc -= basso;
        if (c.vy < 0) {
          if (!c.contatto) { impatto = Math.max(impatto, _c01(-c.vy / 6 + 0.35)); c.contatto = true; c.tC = c.t; c.wcollo = -4.5; }
          c.vy = -c.vy * K.rimbalzo;
          if (c.vy < 0.4) c.vy = 0;
        }
      }
      // ── collo: giù nel tuffo, colpo di frusta all'urto, poi testa un po' su
      const bersCollo = !c.contatto ? 0.22 * _c01(c.th / 0.5) : -0.18;
      const wc = 2 * Math.PI * 2.2;
      c.wcollo += (-wc * wc * (c.collo - bersCollo) - 2 * 0.5 * wc * c.wcollo) * hs;
      c.collo += c.wcollo * hs;
    }
    c.ultimo = { th: c.th, ph: c.ph, ps: c.ps, yc: c.yc, collo: c.collo };
  }
  // ── zampe
  const stati = {}, tA = c.contatto ? c.t - c.tC : 0;
  let th = c.th, ph = c.ph, ps = c.ps, yc = c.yc, collo = c.collo;
  if (resto < K.rialzata) {
    const u = c.ultimo || { th, ph, ps, yc, collo };
    const r = 1 - Math.max(0, resto) / K.rialzata;
    const r1 = _ese(r / 0.35), r2 = _ese((r - 0.35) / 0.3), r3 = _ese((r - 0.65) / 0.35);
    ph = _lrp(u.ph, lato * 0.12, r1) * (1 - r3);
    th = _lrp(_lrp(u.th, 0, r1), -K.pSu, r2) * (1 - r3);
    ps = u.ps * (1 - _ese(r / 0.9));
    const yPetto = cc[1] + K.dyPetto, ySeduto = cc[1] + K.dySeduto;
    yc = _lrp(_lrp(_lrp(u.yc, yPetto, r1), ySeduto, r2), cc[1], r3);
    collo = _lrp(u.collo, 0, r2);
    const basso = yc + _piuBasso(P, ps, th, ph);
    if (basso < 0) yc -= basso;                           // mai dentro il tufo, nemmeno rialzandosi
    for (const nm of ZAMPE_ORDINE) {
      const G = ZAMPE_DATI.gambe[nm], f = _appoggio(G, G.zN, 0);
      const dist = _distesa(G, f, 0, 0.2);
      let a = _mix(dist, _raccolta(G, f), r1);
      stati[nm] = _mix(a, f, G.ant ? r2 : r3);
    }
    h.cadStriscia = 0;
  } else {
    const kTuffo = _c01(c.th / 0.6);
    const amp = c.contatto ? 0.25 + 0.75 * Math.exp(-tA * 1.2) + 0.6 * Math.pow(Math.max(0, Math.sin(tA * 2.2)), 6) : 1;
    for (const nm of ZAMPE_ORDINE) {
      const G = ZAMPE_DATI.gambe[nm], f = _appoggio(G, G.zN, 0);
      const dist = _distesa(G, f, 2 * Math.PI * K.scalcia * (c.contatto ? tA : c.t) + _FASE_ZAMPA[nm], amp);
      stati[nm] = c.contatto ? _mix(_cede(G, f), dist, _ese(tA / 0.35)) : _mix(f, G.ant ? _cede(G, f) : dist, G.ant ? kTuffo : _ese(c.t / 0.4));
    }
    h.cadStriscia = c.contatto ? _c01((h.cadutoSlide || 0) / 8) : 0;
  }
  // ── posa della mesh
  const pos = Z.geo.attributes.position, infl = mesh.morphTargetInfluences;
  _posaZampe(Z.riposo, stati, 0, pos.array);
  if (collo) _posaCollo(pos.array, 0, collo);
  if (infl) infl.fill(0);
  pos.needsUpdate = true;
  Z.attivo = true; Z.dy = 0; Z.colloYaw = 0; Z.colloPitch = collo; Z.cy = Z.cyv = Z.cp = Z.cpv = 0;
  // ── contatto finale su TUTTA la mesh posata: il corpo non entra mai nel tufo, le
  //    zampe (raccolte, distese) al massimo di CADUTA.affonda. Se serve, il corpo sale.
  {
    const a = pos.array, e = corpo.M, fl = corpo.zampa;
    let mC = Infinity, mZ = Infinity;
    for (let v = 0, i = 0; i < a.length; v += 1, i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      _ruota(ps, th, ph, e[0] * x + e[4] * y + e[8] * z + e[12] - cc[0], e[1] * x + e[5] * y + e[9] * z + e[13] - cc[1], e[2] * x + e[6] * y + e[10] * z + e[14] - cc[2], _rv);
      if (fl[v]) { if (_rv[1] < mZ) mZ = _rv[1]; } else if (_rv[1] < mC) mC = _rv[1];
    }
    const su = Math.max(0, -(yc + mC), -(yc + mZ + K.affonda));
    if (su > 0) { yc += su; if (resto >= K.rialzata) { c.yc += su; if (c.vy < 0) c.vy = 0; } }
  }
  // ── uscita: rotazione attorno al BARICENTRO → spostamento del gruppo
  _ruota(ps, th, ph, cc[0], cc[1], cc[2], _rv);
  h.cadVista = { roll: ph, pitch: th, yaw: ps, dx: cc[0] - _rv[0], dy: yc - _rv[1], dz: cc[2] - _rv[2] };
  if (impatto) h.cadImpatto = Math.max(h.cadImpatto || 0, impatto);
  return true;
}



// ════════════════════════════════════════════════════════════════════════════
// 10. IL CANAPE — fune pesante che cade quando la rincorsa passa il verrocchino, e gli zoccoli la scompigliano
// ════════════════════════════════════════════════════════════════════════════
// Simone 11/11: «il canape anteriore (è una fune pesante)…», poi «si deve abbassare dal
// momento in cui la rincorsa passa il verrocchino, non quando preme F». QUANDO cade lo
// decide il gioco (argomento `cade` di aggiorna): al via o alla mossa falsa.
// Prima era un cilindro rigido che scendeva di 0,58 in 0,34 s tremolando e
// spariva. Ora è una FUNE a 46 nodi (Verlet): finché è tesa sta fra i due pali; quando
// cade i capi scendono lungo i pali e il peso la porta giù — si incurva in mezzo, tocca il
// tufo, rimbalza appena e si adagia storta, un poco ondulata. Chi parte davanti se la porta un poco fra le
// zampe: gli zoccoli la trascinano e la sollevano, la fune si piega in anse e si scompiglia
// a terra (il suo peso la trattiene). Dopo un po' (in gara) sparisce. Dopo la mossa
// falsa torna su (capi prima, poi il mezzo); dopo il palio torna tesa alla mossa nuova. Solo a vista. THREE lo passa il gioco (questo modulo non lo importa).
export const CANAPE = {
  nodi: 46, lasco: 1.015,   // fune spessa ma flessibile: tanti nodi, si piega in anse (non una stecca)
  g: 10.9,                  // u/s²
  smorza: 0.995,            // smorzamento Verlet per passo
  attritoTufo: 0.82,        // a terra la fune quasi non scivola
  iter: 14,                 // vincoli di lunghezza per passo
  sparisce: 7.0,            // s a terra prima di sparire (in gara)
  // ZOCCOLI (Simone: «chi parte avanti si porta un pochino dietro fra le zampe il canape…
  // lo deve un po' sfilacciare in terra»): i nodi a terra sotto le zampe di un cavallo che
  // passa vengono trascinati col suo moto e sollevati un poco; il peso della fune li
  // trattiene (non si allontanano più di `tirata` da dove sono caduti).
  // zoccoli misurati sul cavallo del gioco (u dal centro del cavallo, lungo il muso):
  // anteriori a +1,05, posteriori a −0,82, ±0,18 di lato; raggioZ copre la falcata.
  zampe: { davanti: 1.05, dietro: -0.82, raggioZ: 0.45, largo: 0.4, presa: 0.55, alzaV: 1.6, vMax: 6.0 },
  tirata: 1.6,              // u: quanto un pezzo di fune si lascia trascinare via da dove è caduto
  onda: 0.7,                // u/s: quando cade si scompone un poco di lato, a terra non resta una stecca
  risale: 1.2,              // s: dopo la mossa falsa la fune TORNA SU, prima i capi lungo i pali poi il mezzo
  risaleRitardo: 0.35,      // quota del tempo di cui il mezzo parte dopo i capi
};
export function creaCanapeFune(THREE, a, b, alto, raggio, materiale) {
  const K = CANAPE, N = K.nodi, R = 8;
  const A = new THREE.Vector3(a.x, alto, a.z), B = new THREE.Vector3(b.x, alto, b.z);
  const lungTesa = A.distanceTo(B), seg = lungTesa * K.lasco / (N - 1);
  const p = new Float32Array(N * 3), q = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * R * 3), nor = new Float32Array(N * R * 3), idx = [];
  for (let i = 0; i < N - 1; i += 1) for (let j = 0; j < R; j += 1) {
    const a0 = i * R + j, a1 = i * R + (j + 1) % R, b0 = a0 + R, b1 = a1 + R;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, materiale);
  mesh.castShadow = true; mesh.frustumCulled = false;
  const st = { cade: false, tTerra: 0, giu: false, posato: null, moto: 0, onda: false, su: null };
  const nx = -(B.z - A.z) / lungTesa, nz = (B.x - A.x) / lungTesa;   // orizzontale, di traverso alla fune
  const tesa = () => {
    for (let i = 0; i < N; i += 1) {
      const t = i / (N - 1), sag = 0.035 * Math.sin(Math.PI * t);   // la fune tesa pende appena
      p[3 * i] = A.x + (B.x - A.x) * t; p[3 * i + 1] = alto - sag; p[3 * i + 2] = A.z + (B.z - A.z) * t;
    }
    q.set(p); st.cade = false; st.tTerra = 0; st.giu = false; st.posato = null; st.su = null; mesh.visible = true;
  };
  const tubo = () => {
    const T = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3(), su = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i += 1) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      T.set(p[3 * i1] - p[3 * i0], p[3 * i1 + 1] - p[3 * i0 + 1], p[3 * i1 + 2] - p[3 * i0 + 2]).normalize();
      U.copy(su).addScaledVector(T, -su.dot(T)); if (U.lengthSq() < 1e-6) U.set(1, 0, 0); U.normalize();
      V.copy(T).cross(U);
      for (let j = 0; j < R; j += 1) {
        const ang = (j / R) * Math.PI * 2, c = Math.cos(ang), s2 = Math.sin(ang), k = 3 * (i * R + j);
        const nx = U.x * c + V.x * s2, ny = U.y * c + V.y * s2, nz = U.z * c + V.z * s2;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
        pos[k] = p[3 * i] + nx * raggio; pos[k + 1] = p[3 * i + 1] + ny * raggio; pos[k + 2] = p[3 * i + 2] + nz * raggio;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  };
  tesa(); tubo();
  const passo = (h, piedi) => {
    const terra = raggio, Zp = K.zampe;
    // appena sganciata: un'ondina di traverso, diversa a ogni caduta (due seni lungo la fune)
    if (st.onda) {
      st.onda = false;
      const f1 = Math.random() * 6.283, f2 = Math.random() * 6.283, k1 = 1.1 + Math.random() * 0.6, k2 = 2.7 + Math.random() * 1.0;
      for (let i = 0; i < N; i += 1) {
        const t = i / (N - 1), v = K.onda * (0.6 * Math.sin(6.283 * k1 * t + f1) + 0.4 * Math.sin(6.283 * k2 * t + f2));
        q[3 * i] -= nx * v * h; q[3 * i + 2] -= nz * v * h;
      }
    }
    // zoccoli: i nodi a terra sotto le zampe vengono trascinati col cavallo e alzati appena
    if (piedi && piedi.length) for (let i = 0; i < N; i += 1) {
      const k = 3 * i;
      if (p[k + 1] > terra + 0.06) continue;
      for (const c of piedi) {
        const dx = p[k] - c.x, dz = p[k + 2] - c.z;
        const fz = dx * c.fx + dz * c.fz, lat = dx * c.fz - dz * c.fx;
        if (Math.abs(lat) > Zp.largo || fz > Zp.davanti + 0.5 || fz < Zp.dietro - 0.5) continue;
        const g1 = Math.exp(-(((fz - Zp.davanti) / Zp.raggioZ) ** 2)), g2 = Math.exp(-(((fz - Zp.dietro) / Zp.raggioZ) ** 2));
        const w = Math.max(g1, g2) * (1 - Math.abs(lat) / Zp.largo) * Zp.presa;
        if (w < 0.02) continue;
        // il pezzo va verso la velocità dello zoccolo (al massimo vMax: a gran velocità lo
        // zoccolo la colpisce e la scalcia, non se la porta via), e uno zoccolo che la prende
        // la alza appena. Nel passo di Verlet la velocità è (p − q)/h.
        const sc = c.v > Zp.vMax ? Zp.vMax / c.v : 1, tx = c.vx * sc, tz = c.vz * sc;
        const ux = (p[k] - q[k]) / h, uz = (p[k + 2] - q[k + 2]) / h, uy = (p[k + 1] - q[k + 1]) / h;
        q[k] = p[k] - (ux + (tx - ux) * w) * h; q[k + 2] = p[k + 2] - (uz + (tz - uz) * w) * h;
        const vy = Zp.alzaV * w * Math.min(1, c.v / 5);
        if (uy < vy) q[k + 1] = p[k + 1] - vy * h;
      }
    }
    for (let i = 0; i < N; i += 1) {
      const k = 3 * i;
      for (let c = 0; c < 3; c += 1) {
        const v = (p[k + c] - q[k + c]) * K.smorza;
        q[k + c] = p[k + c];
        p[k + c] += v + (c === 1 ? -K.g * h * h : 0);
      }
    }
    for (let it = 0; it < K.iter; it += 1) {
      for (let i = 0; i < N - 1; i += 1) {
        const k = 3 * i, l = k + 3;
        const dx = p[l] - p[k], dy = p[l + 1] - p[k + 1], dz = p[l + 2] - p[k + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6, e = (d - seg) / d * 0.5;
        p[k] += dx * e; p[k + 1] += dy * e; p[k + 2] += dz * e;
        p[l] -= dx * e; p[l + 1] -= dy * e; p[l + 2] -= dz * e;
      }
      // sganciata ai due pali: i capi sono liberi e la fune viene giù tutta col suo peso
      // il peso la trattiene: un pezzo non si allontana più di K.tirata da dove è caduto
      if (st.posato) for (let i = 0; i < N; i += 1) {
        const k = 3 * i, dx = p[k] - st.posato[k], dz = p[k + 2] - st.posato[k + 2], d = Math.hypot(dx, dz);
        if (d > K.tirata) { const e = (d - K.tirata) / d * 0.5; p[k] -= dx * e; p[k + 2] -= dz * e; }
      }
      // il tufo
      for (let i = 0; i < N; i += 1) {
        const k = 3 * i;
        if (p[k + 1] < terra) {
          p[k + 1] = terra;
          q[k] = p[k] - (p[k] - q[k]) * K.attritoTufo; q[k + 2] = p[k + 2] - (p[k + 2] - q[k + 2]) * K.attritoTufo;
          if (q[k + 1] < terra - 0.002) q[k + 1] = terra + (terra - q[k + 1]) * 0.25;   // rimbalzo piccolo
        }
      }
    }
  };
  // piedi: [{ x, z, vx, vz, fx, fz }] — posizione (mondo), velocità e direzione del muso
  // dei cavalli vicini (le dà il gioco a ogni frame); fuori serve solo chi è sulla fune.
  const vicino = (piedi) => {
    if (!piedi || !piedi.length) return null;
    const out = [];
    for (const c of piedi) {
      if (!Number.isFinite(c.x + c.z + c.vx + c.vz + c.fx + c.fz)) continue;   // dati non validi: si ignora
      let dmin = Infinity;
      for (let i = 0; i < N; i += 3) dmin = Math.min(dmin, Math.hypot(p[3 * i] - c.x, p[3 * i + 2] - c.z));
      if (dmin < 2.6) out.push({ ...c, v: Math.hypot(c.vx, c.vz) });
    }
    return out.length ? out : null;
  };
  // RISALITA (Simone 11/11: «dopo una mossa falsa deve tornare su il canape»): da dove è
  // caduta la fune torna tesa fra i pali in K.risale secondi — i capi salgono per primi
  // lungo i pali, il mezzo li segue. Se era sparita (dopo il palio) torna tesa e basta.
  const risali = (dt) => {
    if (!st.su) st.su = { t: 0, da: Float32Array.from(p) };
    st.su.t += dt;
    const u = Math.min(1, st.su.t / K.risale), rit = K.risaleRitardo;
    if (u >= 1) { tesa(); tubo(); return; }
    for (let i = 0; i < N; i += 1) {
      const t = i / (N - 1), sag = 0.035 * Math.sin(Math.PI * t);
      const tx = A.x + (B.x - A.x) * t, ty = alto - sag, tz = A.z + (B.z - A.z) * t;
      const ui = Math.min(1, Math.max(0, (u - rit * Math.sin(Math.PI * t)) / (1 - rit)));
      const e = ui * ui * (3 - 2 * ui), k = 3 * i, d = st.su.da;
      p[k] = d[k] + (tx - d[k]) * e; p[k + 1] = d[k + 1] + (ty - d[k + 1]) * e; p[k + 2] = d[k + 2] + (tz - d[k + 2]) * e;
    }
    q.set(p); tubo();
  };
  const aggiorna = (dt, cade, spariscaDopo, piedi) => {
    if (!cade) {
      if (!st.cade && !st.giu && mesh.visible) return;                 // già tesa
      if (!mesh.visible || K.risale <= 0) { tesa(); tubo(); return; }  // era sparita: tesa e basta
      risali(dt); return;
    }
    if (st.su) { st.su = null; st.giu = false; st.tTerra = 0; st.posato = null; }   // ricade a metà risalita
    if (!st.cade) st.onda = true;
    st.cade = true;
    if (!mesh.visible) return;
    const zampe = st.giu ? vicino(piedi) : null;
    if (st.giu && st.tTerra > 2.0 && !zampe && st.moto <= 0) {
      if (spariscaDopo && st.tTerra > K.sparisce) mesh.visible = false;
      st.tTerra += dt; return;                          // ferma a terra e nessuno sopra: niente calcoli
    }
    if (zampe) st.moto = 1.0; else st.moto -= dt;       // dopo che passano, ancora 1 s per assestarsi
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = Math.min(dt, 0.05) / n;
    for (let i = 0; i < n; i += 1) passo(h, zampe);
    let alto2 = 0; for (let i = 1; i < N - 1; i += 1) alto2 = Math.max(alto2, p[3 * i + 1]);
    if (alto2 < raggio + 0.03 && !st.giu) { st.giu = true; st.posato = Float32Array.from(p); }
    if (st.giu) st.tTerra += dt;
    tubo();
  };
  return { mesh, aggiorna, tesa, stato: st };
}
