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
