// ══════════════════════════════════════════════════════════════════════════════
// FANTINO DEL PALIO — modello procedurale "lofted"
// ──────────────────────────────────────────────────────────────────────────────
// Perché non le primitive: il fantino vecchio era un assemblaggio di capsule e
// box staccati (si vedevano le giunzioni), e la vestizione a gusci sopra un corpo
// nudo dava l'effetto "lattina" (cilindri rigidi infilati sulle membra).
// Qui il corpo è generato come SUPERFICIE CONTINUA: ogni membro è un loft di
// sezioni ellittiche/superellittiche lungo una curva, con raggi che variano come
// varia un corpo umano (spalla grossa → gomito → polso sottile). La livrea NON è
// fatta di pezzi appiccicati sopra: è DIPINTA sui vertici della stessa superficie
// (colore per-vertice), quindi la stoffa segue il corpo come stoffa vera.
// ══════════════════════════════════════════════════════════════════════════════
import * as THREE from "three";

const TAU = Math.PI * 2;

// Taglia del fantino: 0.90 = 10% più basso (Simone, 2026-08-29). Ancorata a SEDUTA_Y,
// la quota del bacino su cui è tarato l'appoggio sul dorso del cavallo.
const TAGLIA = 0.90;
const SEDUTA_Y = 1.78;

// ── Livrea: le 17 terne colore ufficiali (identiche a quelle di game-3d.js) ────
export const LIV = {
  bianco:     "#F2EAD6",
  nero:       "#1A1712",
  giallo:     "#EFC531",
  gialloOro:  "#E3AE1F",
  rosso:      "#C22530",
  cremisi:    "#A8102E",
  verde:      "#16833F",
  arancio:    "#E07A24",
  rosaAntico: "#C87F8E",
  rossoRosa:  "#EE93A4",   // Valdimontone: rosa CHIARO (schiarito ancora su richiesta di Simone), lontano dalla Chiocciola
  rossoAcceso: "#DC2A33",  // Chiocciola: accanto al giallo il rosso base si spegne, qui è alzato per pareggiare la Giraffa
  celeste:    "#5AB0E0",
  azzurro:    "#1E7BC4",
  blu:        "#1B4FA0",
  turchino:   "#123C7A",
};

// colors = [ principale (giubbetto+zucchino), secondario (maniche+pantaloni), liste ]
export const CONTRADE = [
  { id: "aquila", name: "Aquila", colors: [LIV.gialloOro, LIV.gialloOro, LIV.nero], silkStripe: LIV.turchino },
  { id: "bruco", name: "Bruco", colors: [LIV.verde, LIV.giallo, LIV.turchino] },
  { id: "chiocciola", name: "Chiocciola", colors: [LIV.rossoAcceso, LIV.giallo, LIV.turchino] },
  { id: "civetta", name: "Civetta", colors: [LIV.nero, LIV.rosso, LIV.bianco] },
  { id: "drago", name: "Drago", colors: [LIV.rosaAntico, LIV.verde, LIV.giallo] },
  { id: "giraffa", name: "Giraffa", colors: [LIV.rosso, LIV.bianco, LIV.bianco] },
  { id: "istrice", name: "Istrice", colors: [LIV.bianco, LIV.rosso, LIV.blu], silkStripe: LIV.nero,
    fasce: [LIV.rosso, LIV.blu, LIV.nero] },   // campo BIANCO a fasce sottili: i 4 colori si vedono tutti
  { id: "leocorno", name: "Leocorno", colors: [LIV.bianco, LIV.arancio, LIV.azzurro] },
  { id: "lupa", name: "Lupa", colors: [LIV.bianco, LIV.nero, LIV.arancio] },
  { id: "nicchio", name: "Nicchio", colors: [LIV.blu, LIV.blu, LIV.rosso], silkStripe: LIV.giallo },
  { id: "oca", name: "Oca", colors: [LIV.bianco, LIV.verde, LIV.rosso] },
  { id: "onda", name: "Onda", colors: [LIV.bianco, LIV.celeste, LIV.celeste] },
  { id: "pantera", name: "Pantera", colors: [LIV.rosso, LIV.celeste, LIV.bianco], silkStripe: LIV.bianco },
  { id: "selva", name: "Selva", colors: [LIV.verde, LIV.arancio, LIV.bianco] },
  { id: "tartuca", name: "Tartuca", colors: [LIV.giallo, LIV.turchino, LIV.turchino] },
  { id: "torre", name: "Torre", colors: [LIV.cremisi, LIV.cremisi, LIV.bianco], silkStripe: LIV.blu },
  { id: "valdimontone", name: "Valdimontone", colors: [LIV.rossoRosa, LIV.giallo, LIV.bianco] },
];

// ══ 1. MOTORE GEOMETRICO ══════════════════════════════════════════════════════
// loftLimb(): genera un membro come superficie continua.
//   path    : punti guida (Vector3) → curva CatmullRom morbida
//   profile : t → { rx, ry, sq } raggi della sezione a quel punto (sq = squadratura)
//   colorFn : (t, ang, pos, nrm) → THREE.Color  — la livrea, dipinta per vertice
// Le sezioni sono SUPERELLISSI: con sq=2 sono ellissi (arti), con sq=3.2 sono
// rettangoli smussati (torace umano: piatto davanti/dietro, stretto ai lati).
function superellipse(ang, rx, ry, sq) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const e = 2 / sq;
  return [
    rx * Math.sign(c) * Math.pow(Math.abs(c), e),
    ry * Math.sign(s) * Math.pow(Math.abs(s), e),
  ];
}

export function loftLimb({ path, profile, colorFn, steps = 26, radial = 18, capStart = true, capEnd = true, capDepth = 1, twist = null, align = null, rilievo = null }) {
  const curve = new THREE.CatmullRomCurve3(path, false, "catmullrom", 0.4);
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [], nor = [], col = [], idx = [], uvs = [];
  const P = new THREE.Vector3(), V = new THREE.Vector3(), N = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const proj = new THREE.Vector3();
  // I frame di Frenet ruotano in modo imprevedibile lungo la curva: se la texture
  // fosse mappata su di essi, la livrea uscirebbe storta e diversa a ogni membro.
  // Con `align` si ancora il vertice u=0 a una direzione del MONDO (di norma "dietro",
  // dove sta la cucitura vera del capo), così la mappa è sempre orientata uguale.
  // L'angolo si calcola UNA VOLTA SOLA, sulla sezione dove il riferimento è più
  // netto, e poi si tiene costante: i frame di Frenet sono già continui lungo la
  // curva, quindi un offset fisso li segue senza strappi. Ricalcolarlo sezione per
  // sezione lo faceva saltare dove la tangente sfiora la direzione di riferimento,
  // e la mesh si attorcigliava in vele di tessuto.
  let angoloBase = 0;
  if (align) {
    let migliore = -1;
    for (let i = 0; i < steps; i += 1) {
      proj.copy(align).addScaledVector(frames.tangents[i], -align.dot(frames.tangents[i]));
      const forza = proj.lengthSq();
      if (forza > migliore) {
        migliore = forza;
        angoloBase = Math.atan2(proj.dot(frames.binormals[i]), proj.dot(frames.normals[i]));
      }
    }
    if (migliore < 1e-6) angoloBase = 0;
  }

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    curve.getPointAt(t, P);
    const prof = profile(t);
    const rot = (twist ? twist(t) : 0) + angoloBase;
    const nrmF = frames.normals[Math.min(i, steps - 1)];
    const binF = frames.binormals[Math.min(i, steps - 1)];
    for (let j = 0; j <= radial; j += 1) {
      const ang = (j / radial) * TAU;
      // Il rilievo increspa il raggio: sono le pieghe della stoffa, prese nella
      // silhouette e non solo dipinte, così il contorno del capo non è mai un
      // arco perfetto (è l'arco perfetto a far sembrare tutto plastica).
      const k = rilievo ? 1 + rilievo(t, ang) : 1;
      const [ex, ey] = superellipse(ang + rot, prof.rx * k, prof.ry * k, prof.sq || 2);
      V.copy(P).addScaledVector(nrmF, ex).addScaledVector(binF, ey);
      pos.push(V.x, V.y, V.z);
      // normale approssimata dal centro sezione verso il vertice (poi ricalcolata)
      N.copy(V).sub(P).normalize();
      nor.push(N.x, N.y, N.z);
      uvs.push(j / radial, t);
      const c = colorFn ? colorFn(t, ang, V, N) : tmpC.set("#ffffff");
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Tappi: un polo al centro dell'estremità, così il membro è CHIUSO e non si
  // vede il buco del tubo (era uno dei difetti visibili del vecchio approccio).
  const addCap = (t, flip) => {
    curve.getPointAt(t, P);
    const prof = profile(t);
    const nrmF = frames.normals[flip ? 0 : steps - 1];
    const binF = frames.binormals[flip ? 0 : steps - 1];
    const tanF = frames.tangents[flip ? 0 : steps - 1];
    const poleR = Math.min(prof.rx, prof.ry) * 0.55;
    const base = pos.length / 3;
    // anello di raccordo + polo
    const rotCap = angoloBase;
    for (let j = 0; j <= radial; j += 1) {
      const ang = (j / radial) * TAU;
      const [ex, ey] = superellipse(ang + rotCap, prof.rx * 0.62, prof.ry * 0.62, prof.sq || 2);
      V.copy(P).addScaledVector(nrmF, ex).addScaledVector(binF, ey).addScaledVector(tanF, (flip ? -1 : 1) * poleR * 0.75 * capDepth);
      pos.push(V.x, V.y, V.z);
      N.copy(V).sub(P).normalize(); nor.push(N.x, N.y, N.z); uvs.push(j / radial, t);
      const c = colorFn ? colorFn(t, ang, V, N) : tmpC.set("#ffffff");
      col.push(c.r, c.g, c.b);
    }
    V.copy(P).addScaledVector(tanF, (flip ? -1 : 1) * poleR * 1.15 * capDepth);
    pos.push(V.x, V.y, V.z); nor.push(tanF.x * (flip ? -1 : 1), tanF.y, tanF.z); uvs.push(0.5, t);
    const cp = colorFn ? colorFn(t, 0, V, tanF) : tmpC.set("#ffffff");
    col.push(cp.r, cp.g, cp.b);
    const pole = pos.length / 3 - 1;
    const ring0 = flip ? 0 : steps * (radial + 1);
    for (let j = 0; j < radial; j += 1) {
      const r0 = ring0 + j, r1 = ring0 + j + 1, c0 = base + j, c1 = base + j + 1;
      if (flip) { idx.push(r0, c0, r1, r1, c0, c1); idx.push(c0, pole, c1); }
      else { idx.push(r0, r1, c0, r1, c1, c0); idx.push(c0, c1, pole); }
    }
  };
  if (capEnd) addCap(1, false);
  if (capStart) addCap(0, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();   // normali vere → superficie liscia, niente sfaccettature
  return g;
}

// Sferoide colorabile per vertice (testa, giunti, mani): stesso trattamento
// del loft, così i raccordi hanno lo stesso colore e non si "staccano".
export function blobGeo({ rx, ry, rz, colorFn, wSeg = 22, hSeg = 16, phiLength = TAU, thetaStart = 0, thetaLength = Math.PI }) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg, 0, phiLength, thetaStart, thetaLength);
  g.scale(rx, ry, rz);
  const p = g.attributes.position, n = g.attributes.normal;
  const col = [];
  const V = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 1) {
    V.fromBufferAttribute(p, i); N.fromBufferAttribute(n, i);
    const ang = Math.atan2(V.x, V.z);
    const c = colorFn ? colorFn(V, N, ang) : new THREE.Color("#ffffff");
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ══ 2. LIVREA ═════════════════════════════════════════════════════════════════
// Come è fatto DAVVERO il giubbetto (dalle foto del fantino del Leocorno):
//  · giubbetto diviso VERTICALMENTE a metà nei due colori della Contrada, con la
//    cucitura centrale e il collo nel colore delle liste;
//  · maniche nel colore principale, polsino in liste;
//  · pantaloni nel secondario con banda verticale principale sul lato esterno,
//    risvolto in liste alla caviglia;
//  · scarpe BASSE scure (i fantini corrono con scarpe da ginnastica, non stivali);
//  · zucchino a spicchi alternati, bordo in liste;
//  · stemma ovale della Contrada sul dorso.
export function livreaOf(contrada) {
  const c0 = new THREE.Color(contrada.colors[0]);   // principale
  const c1 = new THREE.Color(contrada.colors[1]);   // secondario
  const c2 = new THREE.Color(contrada.colors[2]);   // liste
  const cS = contrada.silkStripe ? new THREE.Color(contrada.silkStripe) : null;
  const fasceAttive = Boolean(contrada.fasce);
  return { c0, c1, c2, cS, fasceAttive, monocroma: contrada.colors[0] === contrada.colors[1] };
}

// ══ 2a. LE STOFFE ═════════════════════════════════════════════════════════════
// La livrea è dipinta su TEXTURE, non sui vertici: col colore per-vertice ogni
// cucitura sfumava sul quarto vicino (una lista di 1 cm diventava una banda larga),
// perché il colore si interpola fra un vertice e l'altro. Sulla texture invece i
// bordi restano netti come su una stoffa cucita, e ci stanno anche i dettagli
// piccoli — alamari, filetti, polsini — che a occhio fanno "vestito" e non "tinta".
// Convenzione delle UV (garantita da loftLimb con `align`): u=0 è la cucitura
// DIETRO, u=0.5 è il centro del petto; v=0 è in basso (orlo), v=1 in alto (collo).
function tela(w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return { cv, g: cv.getContext("2d") };
}
function texDa(cv, ripetiU) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (ripetiU) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = ripetiU; }
  return t;
}
const uX = (u, W) => Math.round(u * W);
const vY = (v, H) => Math.round((1 - v) * H);

// Normal map procedurale del tessuto: si disegna un'altezza (pieghe morbide +
// grana della trama) e la si converte in normali per differenze finite.
function normalMapTessuto(W, H, pieghe, seed = 1) {
  const { cv, g } = tela(W, H);
  g.fillStyle = "#808080"; g.fillRect(0, 0, W, H);
  // pieghe: bande morbide diagonali, come le grinze di una casacca indossata
  for (let i = 0; i < pieghe; i += 1) {
    const r = seededRnd(seed + i * 7.13);
    const x = r * W, larg = W * (0.05 + 0.09 * seededRnd(seed + i * 3.7));
    const grad = g.createLinearGradient(x - larg, 0, x + larg, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, seededRnd(seed + i * 11.3) > 0.5 ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.save();
    g.translate(x, H / 2); g.rotate((seededRnd(seed + i * 5.1) - 0.5) * 0.5); g.translate(-x, -H / 2);
    g.fillRect(x - larg, 0, larg * 2, H);
    g.restore();
  }
  // grana della trama
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (seededRnd(i * 0.017 + seed) - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // altezza → normali
  const alt = g.getImageData(0, 0, W, H).data;
  const out = g.createImageData(W, H);
  const at = (x, y) => alt[((y + H) % H * W + (x + W) % W) * 4];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / 255;
      const dy = (at(x, y + 1) - at(x, y - 1)) / 255;
      const nx = -dx * 1.6, ny = -dy * 1.6, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const o = (y * W + x) * 4;
      out.data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[o + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function seededRnd(seed) {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// GIUBBETTO: campo a quarti alternati, cuciture verticali nel colore delle liste,
// collo e orlo, alamari sul petto (le asole che si vedono nelle foto).
export function texturaGiubbetto(contrada) {
  const W = 384, H = 480;   // più fitto: lo stemma dipinto qui deve restare leggibile
  const { cv, g } = tela(W, H);
  const [c0, c1, c2] = contrada.colors;
  // Quarti: dietro-dx | davanti-dx | davanti-sx | dietro-sx
  const quarti = [c1, c0, c1, c0];
  quarti.forEach((c, i) => { g.fillStyle = c; g.fillRect(uX(i / 4, W), 0, Math.ceil(W / 4) + 1, H); });
  if (contrada.fasce) {
    // Livrea a FASCE (Istrice): campo uniforme nel colore principale, attraversato
    // da gruppi di righe sottili nei colori delle fasce — così tutti i colori della
    // Contrada compaiono sul giubbetto, non solo i primi due.
    g.fillStyle = c0; g.fillRect(0, 0, W, H);
    const spW = Math.round(W * 0.020);
    let k = 0;
    for (let x = W * 0.045; x < W * 0.98; x += W * 0.085, k += 1) {
      g.fillStyle = contrada.fasce[k % contrada.fasce.length];
      g.fillRect(Math.round(x), 0, spW, H);
    }
  }
  // Cuciture: centro schiena (u=0/1), fianchi (u=0.25 e 0.75), centro petto (u=0.5).
  g.fillStyle = c2;
  [0, 0.5].forEach((u) => g.fillRect(uX(u, W), 0, 2, H));          // centro petto e schiena
  g.fillRect(W - 2, 0, 2, H);
  // Righina del secondo colore di lista, sui fianchi (Istrice, Nicchio, Pantera…).
  if (contrada.silkStripe && !contrada.fasce) {
    g.fillStyle = contrada.silkStripe;
    [0.22, 0.78].forEach((u) => g.fillRect(uX(u, W) - 2, 0, 4, H));
  }
  // Collo (in alto) e orlo (in basso).
  g.fillStyle = c2; g.fillRect(0, 0, W, Math.round(H * 0.012));
  g.fillStyle = c2; g.fillRect(0, vY(0.04, H), W, Math.round(H * 0.022));
  // ALAMARI: le tre asole chiare sul davanti del giubbetto.
  g.fillStyle = c2;
  [0.72, 0.60, 0.48].forEach((v) => {
    g.fillRect(uX(0.5, W) - Math.round(W * 0.032), vY(v, H), Math.round(W * 0.064), Math.round(H * 0.012));
  });
  const tex = texDa(cv);
  // STEMMA sulla schiena, DIPINTO nella texture (incollato alla stoffa): la
  // cucitura posteriore sta a u=0, quindi l'ovale va disegnato a cavallo dei due
  // bordi della mappa (metà a x=0, metà a x=W). Anisotropia della tela: la
  // circonferenza del busto (~0.73 u) sta su W px, l'altezza (~0.554 v) su H px.
  const anisoGiubbetto = (H / 0.554) / (W / 0.73);
  const cyStemma = vY(0.58, H);
  const rxStemma = Math.round(W * 0.107), ryStemma = Math.round(H * 0.171);
  [0, W].forEach((cx) => {
    disegnaStemmaIncollato(g, cx, cyStemma, rxStemma, ryStemma, contrada, anisoGiubbetto, () => {
      tex.needsUpdate = true;
      if (typeof texturaStemma.onEmblema === "function") texturaStemma.onEmblema(contrada.id);
    });
  });
  return tex;
}

// MANICA: colore principale con polsino in liste e una spalla appena più chiara
// (il rilievo del deltoide, che altrimenti si perde in una manica tutta uguale).
export function texturaManica(contrada) {
  const W = 64, H = 128;
  const { cv, g } = tela(W, H);
  const [c0, , c2] = contrada.colors;
  g.fillStyle = c0; g.fillRect(0, 0, W, H);
  if (contrada.fasce) {
    const spW = Math.round(W * 0.045);
    let k = 0;
    for (let x = W * 0.06; x < W * 0.96; x += W * 0.16, k += 1) {
      g.fillStyle = contrada.fasce[k % contrada.fasce.length];
      g.fillRect(Math.round(x), 0, spW, H);
    }
  }
  g.fillStyle = c2; g.fillRect(0, vY(0.98, H), W, Math.round(H * 0.075));  // polsino (v alto)
  return texDa(cv);
}

// PANTALONE: fondo nel colore secondario con la banda verticale del principale sul
// lato ESTERNO della gamba (u=0, ancorato in fuori), filettata di liste, e risvolto
// alla caviglia.
export function texturaPantalone(contrada) {
  const W = 128, H = 128;
  const { cv, g } = tela(W, H);
  const [c0, c1, c2] = contrada.colors;
  if (contrada.fasce) {
    // Fasce (Istrice): pantalone bianco, tripla riga colorata sul lato esterno.
    g.fillStyle = c0; g.fillRect(0, 0, W, H);
    const rw = Math.round(W * 0.045);
    contrada.fasce.forEach((cf, k) => {
      g.fillStyle = cf;
      g.fillRect(Math.round(k * rw * 1.7), 0, rw, H);
      g.fillRect(W - Math.round(k * rw * 1.7) - rw, 0, rw, H);
    });
  } else {
    g.fillStyle = c1; g.fillRect(0, 0, W, H);
    const banda = Math.round(W * 0.13);
    g.fillStyle = c0;
    g.fillRect(0, 0, banda, H); g.fillRect(W - banda, 0, banda, H);
    g.fillStyle = c2;
    g.fillRect(banda, 0, 3, H); g.fillRect(W - banda - 3, 0, 3, H);
  }
  g.fillStyle = c2; g.fillRect(0, vY(0.98, H), W, Math.round(H * 0.055));  // risvolto (caviglia)
  return texDa(cv);
}

// ZUCCHINO: spicchi alternati nei due colori, cuciture e fascia inferiore in liste.
export function texturaZucchino(contrada) {
  const W = 256, H = 128, SPICCHI = 6;
  const { cv, g } = tela(W, H);
  const [c0, c1, c2] = contrada.colors;
  for (let i = 0; i < SPICCHI; i += 1) {
    if (contrada.fasce) g.fillStyle = i % 2 === 0 ? c0 : contrada.fasce[(i >> 1) % contrada.fasce.length];
    else g.fillStyle = i % 2 === 0 ? c0 : c1;
    g.fillRect(Math.round((i / SPICCHI) * W), 0, Math.ceil(W / SPICCHI) + 1, H);
  }
  g.fillStyle = c2;
  for (let i = 0; i < SPICCHI; i += 1) g.fillRect(Math.round((i / SPICCHI) * W) - 1, 0, 3, H);
  g.fillRect(0, Math.round(H * 0.88), W, Math.round(H * 0.12));            // fascia
  return texDa(cv);
}

// ══ 2a-bis. IL VOLTO ══════════════════════════════════════════════════════════
// Il volto è DIPINTO sulla texture della testa, non fatto di sferette: gli occhi
// hanno sclera, iride e pupilla, le sopracciglia hanno peli e la bocca ha due
// labbra — cose impossibili con le primitive, che davano l'effetto pupazzo.
// Convenzione UV della sfera three.js: il davanti (+Z) sta a u=0.25, v cresce
// dall'alto verso il basso. Le quote v corrispondono alle proporzioni di un viso
// vero: occhi a metà testa, bocca a due terzi.
export function texturaVolto(skinHex) {
  const W = 512, H = 512;
  const { cv, g } = tela(W, H);
  const skin = new THREE.Color(skinHex);
  const scuro = skin.clone().multiplyScalar(0.78);
  const css = (c) => "#" + c.getHexString();
  g.fillStyle = css(skin); g.fillRect(0, 0, W, H);

  const X = (u) => u * W, Y = (v) => v * H;
  const specchio = (du) => [0.25 - du, 0.25 + du];

  // Ombre morbide: orbite e incavo delle guance danno struttura al viso.
  specchio(0.052).forEach((u) => {
    const gr = g.createRadialGradient(X(u), Y(0.455), 2, X(u), Y(0.455), 26);
    gr.addColorStop(0, "rgba(60,38,22,0.28)");
    gr.addColorStop(1, "rgba(60,38,22,0)");
    g.fillStyle = gr;
    g.fillRect(X(u) - 30, Y(0.455) - 30, 60, 60);
  });

  // OCCHI: mandorla di sclera, iride castana, pupilla, riflesso, riga delle ciglia.
  specchio(0.052).forEach((u, i) => {
    const cx = X(u), cy = Y(0.458);
    g.save();
    g.beginPath(); g.ellipse(cx, cy, 13.5, 7.5, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#EFE7D6"; g.fillRect(cx - 15, cy - 9, 30, 18);       // sclera
    g.fillStyle = "#5A3A1E";
    g.beginPath(); g.arc(cx + (i === 0 ? 1.5 : -1.5), cy + 0.5, 6.1, 0, Math.PI * 2); g.fill();   // iride (guarda avanti)
    g.fillStyle = "#171310";
    g.beginPath(); g.arc(cx + (i === 0 ? 1.5 : -1.5), cy + 0.5, 3.0, 0, Math.PI * 2); g.fill();   // pupilla
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.arc(cx + (i === 0 ? 3.4 : -3.4), cy - 1.6, 1.3, 0, Math.PI * 2); g.fill();   // riflesso
    g.restore();
    // palpebra/ciglia sopra, più marcata; sotto un filo appena visibile
    g.strokeStyle = "#2A1D12"; g.lineWidth = 2.4; g.lineCap = "round";
    g.beginPath(); g.ellipse(cx, cy - 0.8, 13.5, 7.2, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    g.strokeStyle = "rgba(42,29,18,0.35)"; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(cx, cy + 1, 12.5, 6.4, 0, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
  });

  // SOPRACCIGLIA: arcata piena, leggermente inclinata verso l'esterno.
  specchio(0.052).forEach((u, i) => {
    const cx = X(u), cy = Y(0.402), dir = i === 0 ? -1 : 1;
    g.strokeStyle = "#33220F"; g.lineWidth = 4.6; g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx - 14 * dir, cy + 3);
    g.quadraticCurveTo(cx, cy - 3.5, cx + 13 * dir, cy + 1);
    g.stroke();
  });

  // NASO in pittura: ombra del dorso e delle narici (il volume ce lo mette la
  // geometria, qui solo le ombre che lo raccordano al viso).
  g.strokeStyle = "rgba(60,38,22,0.30)"; g.lineWidth = 2.2;
  [-1, 1].forEach((d) => {
    g.beginPath();
    g.moveTo(X(0.25) + d * 5, Y(0.47));
    g.quadraticCurveTo(X(0.25) + d * 7.5, Y(0.545), X(0.25) + d * 9, Y(0.565));
    g.stroke();
  });
  g.fillStyle = "rgba(40,24,12,0.55)";
  [-1, 1].forEach((d) => {
    g.beginPath(); g.ellipse(X(0.25) + d * 5.6, Y(0.578), 2.6, 1.7, d * 0.5, 0, Math.PI * 2); g.fill();
  });

  // BOCCA: labbro superiore più scuro (in ombra), inferiore più carnoso e caldo,
  // con la linea di contatto marcata e due fossette agli angoli.
  const my = Y(0.652), mw = 19;
  const labbraSup = skin.clone().multiplyScalar(0.66).offsetHSL(0.988 - 1, 0.06, 0);
  const labbraInf = skin.clone().multiplyScalar(0.88).offsetHSL(0.99 - 1, 0.10, 0);
  g.fillStyle = css(labbraSup);
  g.beginPath();
  g.moveTo(X(0.25) - mw, my);
  g.quadraticCurveTo(X(0.25) - 6, my - 5.5, X(0.25) - 1.5, my - 4.2);
  g.quadraticCurveTo(X(0.25), my - 3.4, X(0.25) + 1.5, my - 4.2);
  g.quadraticCurveTo(X(0.25) + 6, my - 5.5, X(0.25) + mw, my);
  g.closePath(); g.fill();
  g.fillStyle = css(labbraInf);
  g.beginPath();
  g.moveTo(X(0.25) - mw + 2, my + 0.5);
  g.quadraticCurveTo(X(0.25), my + 8.5, X(0.25) + mw - 2, my + 0.5);
  g.closePath(); g.fill();
  g.strokeStyle = "rgba(35,18,8,0.75)"; g.lineWidth = 1.8; g.lineCap = "round";
  g.beginPath();
  g.moveTo(X(0.25) - mw, my);
  g.quadraticCurveTo(X(0.25), my + 2.2, X(0.25) + mw, my);
  g.stroke();
  // ombra sotto il labbro inferiore
  g.strokeStyle = "rgba(60,38,22,0.25)"; g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(X(0.25) - 8, my + 9);
  g.quadraticCurveTo(X(0.25), my + 11.5, X(0.25) + 8, my + 9);
  g.stroke();

  // Guance: un velo di colore vivo, viso da corsa sotto il sole.
  specchio(0.075).forEach((u) => {
    const gr = g.createRadialGradient(X(u), Y(0.56), 2, X(u), Y(0.56), 20);
    gr.addColorStop(0, "rgba(190,90,60,0.16)");
    gr.addColorStop(1, "rgba(190,90,60,0)");
    g.fillStyle = gr;
    g.fillRect(X(u) - 22, Y(0.56) - 22, 44, 44);
  });
  // Ombra della mandibola: stacca il viso dal collo.
  const gr = g.createLinearGradient(0, Y(0.78), 0, Y(0.92));
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, css(scuro));
  g.fillStyle = gr; g.fillRect(0, Y(0.78), W, Y(0.92) - Y(0.78));

  return texDa(cv);
}

// ── Stemma INCOLLATO: disegnato dentro la texture di un capo ──────────────────
// Il piano 3D flottante mostrava aria tra ovale e schiena (specie di lato, in
// gioco): dipinto NELLA texture del giubbetto invece segue stoffa e pieghe al
// millimetro — incollato per costruzione. `aniso` = (px per unità in v) / (px
// per unità in u) della mappa: serve per disegnare il PNG con le proporzioni
// giuste su una tela non isometrica.
function disegnaStemmaIncollato(g, cx, cy, rxPx, ryPx, contrada, aniso, alCarico) {
  const [c0, c1, c2] = contrada.colors;
  const ovale = (sx, sy) => { g.beginPath(); g.ellipse(cx, cy, rxPx * sx, ryPx * sy, 0, 0, Math.PI * 2); };
  const base = () => {
    ovale(1, 1); g.fillStyle = "#C9A227"; g.fill();               // cornice dorata
    ovale(0.94, 0.94); g.fillStyle = c2; g.fill();                // filetto in liste
    ovale(0.885, 0.885); g.save(); g.clip();
    g.fillStyle = "#F4EEDF"; g.fillRect(cx - rxPx, cy - ryPx, rxPx * 2, ryPx * 1.6);
    g.fillStyle = c0; g.fillRect(cx - rxPx, cy + ryPx * 0.6, rxPx, ryPx * 0.4);   // punta nei
    g.fillStyle = c1; g.fillRect(cx, cy + ryPx * 0.6, rxPx, ryPx * 0.4);          // colori Contrada
    g.restore();
    // corona sopra l'ovale
    g.fillStyle = "#C9A227";
    const cw = rxPx * 0.62, ch = ryPx * 0.22, ctop = cy - ryPx * 1.24;
    g.beginPath();
    g.moveTo(cx - cw, ctop + ch);
    g.lineTo(cx - cw, ctop + ch * 0.35);
    g.lineTo(cx - cw * 0.55, ctop + ch * 0.75);
    g.lineTo(cx - cw * 0.18, ctop);
    g.lineTo(cx + cw * 0.18, ctop);
    g.lineTo(cx + cw * 0.55, ctop + ch * 0.75);
    g.lineTo(cx + cw, ctop + ch * 0.35);
    g.lineTo(cx + cw, ctop + ch);
    g.closePath(); g.fill();
  };
  base();
  const img = new Image();
  img.onload = () => {
    g.save();
    ovale(0.885, 0.885); g.clip();
    // contain nel campo, correggendo l'anisotropia della tela
    const maxW = rxPx * 2 * 0.84, maxH = ryPx * 2 * 0.78;
    const hPx = Math.min(maxH, maxW * aniso * (img.height / img.width));
    const wPx = hPx * (img.width / img.height) / aniso;
    g.drawImage(img, cx - wPx / 2, cy - hPx / 2 - ryPx * 0.03, wPx, hPx);
    g.restore();
    g.lineWidth = Math.max(2, rxPx * 0.09); g.strokeStyle = c2;
    ovale(0.90, 0.90); g.stroke();
    g.lineWidth = Math.max(2, rxPx * 0.11); g.strokeStyle = "#C9A227";
    ovale(0.975, 0.975); g.stroke();
    if (alCarico) alCarico();
  };
  img.src = "assets/stemmi/" + contrada.id + ".png";
}

// ══ 2b. STEMMA sul dorso ══════════════════════════════════════════════════════
// Sul dorso del giubbetto i fantini portano lo stemma della Contrada: uno scudo
// OVALE bordato, sormontato dalla corona. Qui lo scudo, il bordo e il campo (nei
// colori veri della Contrada) sono generati su canvas; l'emblema araldico figurato
// — unicorno, aquila, oca… — si innesta come disegno dentro il campo.
export function texturaStemma(contrada, disegnaEmblema) {
  const W = 256, H = 320;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const [c0, c1, c2] = contrada.colors;
  const cx = W / 2, cy = H * 0.54, rx = W * 0.40, ry = H * 0.38;

  const ovale = (sx, sy) => {
    g.beginPath();
    g.ellipse(cx, cy, rx * sx, ry * sy, 0, 0, Math.PI * 2);
  };
  // Bordo esterno dorato + filetto nel colore delle liste.
  ovale(1, 1); g.fillStyle = "#C9A227"; g.fill();
  ovale(0.955, 0.955); g.fillStyle = c2; g.fill();
  // Campo dello scudo: avorio, così l'ovale STACCA sul giubbetto (con i colori
  // della Contrada si confondeva col tessuto e da lontano spariva), con la punta
  // inferiore nei colori della Contrada come sugli stemmi veri.
  ovale(0.90, 0.90); g.save(); g.clip();
  g.fillStyle = "#F4EEDF"; g.fillRect(0, 0, W, H);
  g.fillStyle = c0; g.fillRect(0, H * 0.80, cx, H);
  g.fillStyle = c1; g.fillRect(cx, H * 0.80, cx, H);
  g.fillStyle = c2; g.fillRect(0, H * 0.795, W, 4);
  if (typeof disegnaEmblema === "function") disegnaEmblema(g, cx, cy, rx, ry, contrada);
  g.restore();
  // Corona sopra lo scudo (i fantini la portano ricamata sopra l'ovale).
  g.fillStyle = "#C9A227";
  const cw = rx * 0.62, ch = ry * 0.24, ctop = cy - ry * 1.02;
  g.beginPath();
  g.moveTo(cx - cw, ctop + ch);
  g.lineTo(cx - cw, ctop + ch * 0.35);
  g.lineTo(cx - cw * 0.55, ctop + ch * 0.75);
  g.lineTo(cx - cw * 0.18, ctop);
  g.lineTo(cx + cw * 0.18, ctop);
  g.lineTo(cx + cw * 0.55, ctop + ch * 0.75);
  g.lineTo(cx + cw, ctop + ch * 0.35);
  g.lineTo(cx + cw, ctop + ch);
  g.closePath(); g.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  // EMBLEMA VERO della Contrada: PNG ritagliato dalla bandiera (assets/stemmi/),
  // disegnato dentro il campo appena l'immagine arriva. Se il file manca, resta
  // l'ovale araldico semplice: nessun errore, solo meno dettaglio.
  const img = new Image();
  img.onload = () => {
    g.save();
    ovale(0.88, 0.88); g.clip();
    const scala = Math.min((rx * 2 * 0.86) / img.width, (ry * 2 * 0.80) / img.height);
    const w = img.width * scala, h = img.height * scala;
    g.drawImage(img, cx - w / 2, cy - h / 2 - H * 0.008, w, h);
    g.restore();
    // ribadisco bordo e filetto sopra l'immagine, così l'emblema resta incorniciato
    g.lineWidth = 5; g.strokeStyle = c2;
    ovale(0.915, 0.915); g.stroke();
    g.lineWidth = 7; g.strokeStyle = "#C9A227";
    ovale(0.975, 0.975); g.stroke();
    tex.needsUpdate = true;
    if (typeof texturaStemma.onEmblema === "function") texturaStemma.onEmblema(contrada.id);
  };
  img.src = "assets/stemmi/" + contrada.id + ".png";
  return tex;
}

// ══ 3. IL FANTINO ═════════════════════════════════════════════════════════════
// MISURE. Le unità del gioco sono metri (il dorso del cavallo sta a y≈1.44). Un
// uomo seduto misura ~90 cm dal bacino alla sommità del capo, quindi il fantino
// vive fra y≈1.78 (bacino sul dorso nudo) e y≈2.62 (cima dello zucchino). Erano
// queste le quote del fantino precedente: il modello nuovo si siede identico.
// POSA: monta A PELO — busto chino in avanti, ginocchia alte e stretteal costato,
// piede libero (niente sella né staffe).
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// rampa(): interpola una serie di misure chiave lungo il membro con raccordo
// morbido (smoothstep), così il profilo del corpo cambia come cambia un corpo —
// vita stretta, torace pieno, spalle larghe — invece che a gradini.
function rampa(t, stops) {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, v0] = stops[i], [t1, v1] = stops[i + 1];
    if (t <= t1 || i === stops.length - 2) {
      const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
    }
  }
  return stops[stops.length - 1][1];
}

export function buildFantino(contrada, opts = {}) {
  const build = opts.build || { spalle: 0.92, arti: 1.08, testa: 0.94, corpo: 0.90 };
  const skin = new THREE.Color(opts.skin || "#C98D5E");
  const skinScuro = skin.clone().multiplyScalar(0.74);
  const L = livreaOf(contrada);
  const nero = new THREE.Color("#141210");
  const B = 0.94 + 0.12 * (build.corpo - 0.9);    // corporatura, vicina a 1
  const A = build.arti, T = build.testa, S = build.spalle;

  const rider = new THREE.Group();
  const opaco = (m) => {
    m.side = THREE.DoubleSide;
    m.transparent = false;
    m.opacity = 1;
    m.depthWrite = true;
    return m;
  };
  const mat = opaco(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }));
  const matPelle = opaco(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.0 }));
  // Le stoffe: una texture per capo + la NORMAL MAP del tessuto (grana della
  // trama e grinze morbide). Senza, ogni capo resta una superficie di plastica
  // verniciata; con, la luce si rompe come su una stoffa.
  const seedStoffa = contrada.id.charCodeAt(0) * 3.1;
  const stoffa = (map, seed, ripeti) => {
    const m = opaco(new THREE.MeshStandardMaterial({ map, roughness: 0.68, metalness: 0.0 }));
    m.normalMap = normalMapTessuto(160, 160, 6, seed);
    m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping;
    m.normalMap.repeat.set(ripeti || 1, ripeti || 1);
    m.normalScale.set(0.75, 0.75);
    return m;
  };
  const matGiubbetto = stoffa(texturaGiubbetto(contrada), seedStoffa, 2);
  const matManica = stoffa(texturaManica(contrada), seedStoffa + 1, 1.5);
  const matPantalone = stoffa(texturaPantalone(contrada), seedStoffa + 2, 1.5);
  const matZucchino = opaco(new THREE.MeshStandardMaterial({ map: texturaZucchino(contrada), roughness: 0.55, metalness: 0.0 }));
  const DIETRO = new THREE.Vector3(0, 0, -1);
  const add = (geo, material) => {
    const m = new THREE.Mesh(geo, material || mat);
    m.castShadow = true;
    rider.add(m); return m;
  };

  // ── BUSTO ──────────────────────────────────────────────────────────────────
  // Superficie unica dal bacino alla base del collo. Il profilo si stringe in
  // vita, si apre al torace, raggiunge il massimo alle spalle e RIENTRA di netto
  // sul collo (senza questo rientro il giubbetto finiva a disco sopra le spalle).
  const bustoPath = [
    V3(0, 1.780, -0.115),   // bacino, seduto a pelo
    V3(0, 1.878, -0.052),
    V3(0, 1.975, 0.020),
    V3(0, 2.075, 0.098),
    V3(0, 2.170, 0.165),    // spalle
    V3(0, 2.232, 0.205),    // base collo
  ];
  const bustoProfile = (t) => ({
    rx: rampa(t, [[0, 0.092], [0.26, 0.090], [0.60, 0.122], [0.80, 0.142 * (0.86 + 0.16 * S)], [0.92, 0.128], [1, 0.084]]) * B,
    ry: rampa(t, [[0, 0.088], [0.26, 0.084], [0.60, 0.104], [0.80, 0.106], [0.92, 0.098], [1, 0.078]]) * B,
    sq: 2.0,
  });
  const seedPieghe = contrada.id.length * 2.7;
  const piegheBusto = (t, ang) => {
    const dove = Math.sin(Math.PI * Math.min(1, t / 0.72));         // massime in vita, zero alle spalle
    return 0.020 * dove * Math.sin(ang * 3 + t * 7 + seedPieghe)
         + 0.010 * dove * Math.sin(ang * 7 - t * 12 + seedPieghe * 1.7);
  };
  add(loftLimb({ path: bustoPath, profile: bustoProfile, steps: 32, radial: 28, align: DIETRO, capEnd: false, rilievo: piegheBusto }), matGiubbetto);

  // ── COLLO + TESTA ──────────────────────────────────────────────────────────
  add(loftLimb({
    path: [V3(0, 2.186, 0.176), V3(0, 2.232, 0.204), V3(0, 2.278, 0.230)],
    profile: (t) => ({ rx: (0.052 - 0.005 * t) * T, ry: (0.055 - 0.005 * t) * T, sq: 2 }),
    colorFn: () => skin, steps: 6, radial: 14,
  }), matPelle);

  // Testa col volto DIPINTO: occhi, sopracciglia e bocca stanno sulla texture
  // (dettaglio vero), naso e orecchie restano scolpiti (profilo vero).
  const matVolto = new THREE.MeshStandardMaterial({ map: texturaVolto(opts.skin || "#C98D5E"), roughness: 0.72 });
  const geoTesta = new THREE.SphereGeometry(1, 36, 28);
  geoTesta.scale(0.087 * T, 0.106 * T, 0.097 * T);
  const testa = new THREE.Mesh(geoTesta, matVolto);
  testa.position.set(0, 2.362, 0.245);
  testa.castShadow = true;
  rider.add(testa);
  // NASO scolpito: dorso che scende dalla fronte, punta e ali delle narici.
  const naso = new THREE.Group();
  const dorsoNaso = new THREE.Mesh(loftLimb({
    path: [V3(0, 2.390, 0.330), V3(0, 2.372, 0.344), V3(0, 2.354, 0.353), V3(0, 2.347, 0.349)],
    profile: (t) => ({ rx: (0.007 + 0.006 * t) * T, ry: (0.009 + 0.004 * t) * T, sq: 2 }),
    colorFn: () => skin, steps: 8, radial: 10, capStart: false,
  }), matPelle);
  dorsoNaso.castShadow = true;
  naso.add(dorsoNaso);
  [-1, 1].forEach((d) => {
    const ala = new THREE.Mesh(blobGeo({ rx: 0.006 * T, ry: 0.0055 * T, rz: 0.006 * T, colorFn: () => skin }), matPelle);
    ala.position.set(d * 0.0105 * T, 2.349, 0.336);
    naso.add(ala);
  });
  rider.add(naso);
  // Mento: appena accennato, il grosso del profilo lo fa già la mandibola dipinta.
  const mento = new THREE.Mesh(blobGeo({ rx: 0.026 * T, ry: 0.013 * T, rz: 0.011 * T, colorFn: () => skin.clone().multiplyScalar(0.88) }), matPelle);
  mento.position.set(0, 2.289, 0.312); rider.add(mento);
  [-1, 1].forEach((s) => {
    const orecchio = new THREE.Mesh(blobGeo({ rx: 0.010 * T, ry: 0.026 * T, rz: 0.018 * T, colorFn: () => skin }), matPelle);
    orecchio.position.set(s * 0.084 * T, 2.354, 0.235); rider.add(orecchio);
  });

  // ── ZUCCHINO a spicchi ─────────────────────────────────────────────────────
  // Calotta bassa calzata sulle orecchie: spicchi alternati nei due colori della
  // Contrada (come gli zucchini veri) e fascia inferiore nel colore delle liste.
  const calotta = new THREE.SphereGeometry(1, 48, 18, 0, TAU, 0, Math.PI * 0.72);
  calotta.scale(0.0975 * T, 0.0855 * T, 0.107 * T);
  const zucchino = new THREE.Mesh(calotta, matZucchino);
  zucchino.position.set(0, 2.404, 0.235);
  zucchino.rotation.x = -0.16;   // beccheggio all'indietro: la calotta copre la nuca, la fronte resta libera
  zucchino.castShadow = true;
  rider.add(zucchino);

  // ── BRACCIA ────────────────────────────────────────────────────────────────
  // Perno sulla SPALLA (contratto invariato: il gioco anima rider.userData.rightArm).
  // La geometria è locale al perno e continua dal deltoide alla mano: la piega del
  // gomito la dà la curva, non due tubi accostati.
  function costruisciBraccio(sign) {
    const arm = new THREE.Group();
    arm.position.set(sign * 0.112 * S, 2.178, 0.152);
    const path = [
      V3(sign * -0.055, -0.024, -0.008),     // dentro il giubbetto: l'innesto non si vede
      V3(sign * 0.006, -0.058 * A, 0.010),
      V3(sign * 0.026, -0.138 * A, 0.058),     // gomito
      V3(sign * 0.016, -0.184 * A, 0.138),
      V3(sign * 0.002, -0.210 * A, 0.224),     // polso, sulle redini
    ];
    // Deltoide pieno → bicipite → avambraccio → polso sottile: il rastremarsi del
    // braccio è quello che toglie l'aria di "tubo" alla manica.
    const profile = (t) => {
      const r = rampa(t, [[0, 0.037], [0.22, 0.046], [0.46, 0.038], [0.74, 0.032], [1, 0.023]]) * B;
      return { rx: r, ry: r * (1.10 - 0.10 * t), sq: 2.05 };
    };
    // Manica nel colore PRINCIPALE, polsino nel colore delle liste.
    const piegheManica = (t, ang) => {
      const gomito = Math.exp(-Math.pow((t - 0.48) / 0.16, 2));     // grinze al gomito
      return 0.045 * gomito * Math.sin(ang * 4 + t * 26 + seedPieghe);
    };
    const manica = new THREE.Mesh(loftLimb({
      path, profile, steps: 24, radial: 18, align: DIETRO, capDepth: 0.12, rilievo: piegheManica,
    }), matManica);
    manica.castShadow = true;
    arm.add(manica);
    // MANO che stringe le redini: palmo, quattro dita che si arricciano attorno
    // alla redine e pollice serrato di lato. Non più una sferetta: a distanza di
    // gioco si legge il PUGNO, da vicino si contano le dita.
    const mano = new THREE.Group();
    mano.position.set(sign * 0.0, -0.219 * A, 0.238);
    mano.rotation.x = -0.5;                    // il pugno segue l'avambraccio
    const palmo = new THREE.Mesh(blobGeo({
      rx: 0.019, ry: 0.027, rz: 0.023,
      colorFn: (v) => (v.z > 0.010 ? skin : skinScuro),
    }), matPelle);
    palmo.castShadow = true;
    mano.add(palmo);
    // Quattro dita: nascono dalla nocca in alto davanti e si arricciano in giù
    // e indietro, come attorno a una redine orizzontale.
    for (let d = 0; d < 4; d += 1) {
      const x = (d - 1.5) * 0.0105;
      const dito = new THREE.Mesh(loftLimb({
        path: [
          V3(x, 0.020 - d * 0.001, 0.016),
          V3(x, 0.012, 0.030),
          V3(x, -0.004, 0.034),
          V3(x, -0.016, 0.024),
          V3(x, -0.018, 0.010),
        ],
        profile: (t) => ({ rx: 0.0050 - 0.0012 * t, ry: 0.0050 - 0.0012 * t, sq: 2 }),
        colorFn: () => skin, steps: 10, radial: 8, capStart: false,
      }), matPelle);
      dito.castShadow = true;
      mano.add(dito);
    }
    // Pollice: dal lato interno, serrato in avanti sopra le dita.
    const pollice = new THREE.Mesh(loftLimb({
      path: [
        V3(sign * -0.016, 0.006, 0.004),
        V3(sign * -0.013, -0.001, 0.020),
        V3(sign * -0.006, -0.006, 0.031),
      ],
      profile: (t) => ({ rx: 0.0056 - 0.0012 * t, ry: 0.0056 - 0.0012 * t, sq: 2 }),
      colorFn: () => skin, steps: 6, radial: 8, capStart: false,
    }), matPelle);
    pollice.castShadow = true;
    mano.add(pollice);
    arm.add(mano);
    arm.userData.hand = mano;
    return arm;
  }
  const braccioSx = costruisciBraccio(-1);
  const braccioDx = costruisciBraccio(1);
  rider.userData.rightArm = braccioDx;
  rider.userData.leftArm = braccioSx;
  rider.add(braccioSx, braccioDx);

  // ── NERBO ──────────────────────────────────────────────────────────────────
  // Chiaro (nerbo di bue essiccato), lungo e sottile, tenuto nella mano destra:
  // è figlio del braccio destro, così segue la frustata.
  const nerbo = new THREE.Group();
  const nerboMesh = new THREE.Mesh(loftLimb({
    path: [V3(0, 0.03, 0.02), V3(0.012, -0.10, -0.13), V3(0.026, -0.22, -0.29), V3(0.038, -0.31, -0.44)],
    profile: (t) => ({ rx: 0.0085 - 0.0035 * t, ry: 0.0085 - 0.0035 * t, sq: 2 }),
    colorFn: () => new THREE.Color("#D9C08A"), steps: 12, radial: 8,
  }), mat);
  nerboMesh.castShadow = true;
  nerbo.add(nerboMesh);
  nerbo.position.set(0.0, -0.219 * A, 0.238);
  braccioDx.add(nerbo);
  rider.userData.whip = nerbo;

  // ── GAMBE ──────────────────────────────────────────────────────────────────
  // A pelo il ginocchio sta ALTO e stretto al costato e il piede resta libero.
  [-1, 1].forEach((sign) => {
    // x ricalcolate per il fantino RIDOTTO del 10%: il cavallo resta grande uguale,
    // quindi a parità di aderenza le gambe devono aprirsi di più nel modello.
    const xAnca = sign * 0.082, xCav = sign * 0.268;
    const path = [
      V3(xAnca, 1.795, -0.068),          // DENTRO il bacino (semiasse 0.108): l'anca non deve sbucare
      V3(sign * 0.170, 1.762, 0.020),    // esce dal bacino e si porta sul fianco
      V3(sign * 0.222, 1.712, 0.070),
      V3(sign * 0.243, 1.672, 0.128),    // ginocchio appoggiato al costato
      V3(sign * 0.259, 1.572, 0.116),    // coscia lungo il fianco
      V3(xCav, 1.478, 0.066),            // caviglia: sfiora la pancia, non la insegue
    ];
    const profile = (t) => {
      const r = rampa(t, [[0, 0.070], [0.35, 0.058], [0.55, 0.050], [0.80, 0.040], [1, 0.032]]) * B;
      return { rx: r, ry: r * (1.06 - 0.08 * t), sq: 2.2 };
    };
    // La banda del pantalone corre sul lato ESTERNO: si ancora l'anello in fuori,
    // così la banda cade sempre dalla parte giusta su entrambe le gambe.
    const fuori = new THREE.Vector3(sign, 0, 0);
    const piegheGamba = (t, ang) => {
      const ginocchio = Math.exp(-Math.pow((t - 0.5) / 0.18, 2));
      const fondo = Math.exp(-Math.pow((t - 0.92) / 0.10, 2));
      return 0.035 * ginocchio * Math.sin(ang * 4 + t * 21 + seedPieghe)
           + 0.030 * fondo * Math.sin(ang * 6 + seedPieghe * 2.3);
    };
    const gamba = new THREE.Mesh(loftLimb({ path, profile, steps: 26, radial: 18, align: fuori, capDepth: 0.12, rilievo: piegheGamba }), matPantalone);
    gamba.castShadow = true;
    rider.add(gamba);

    // SCARPA bassa scura: al Palio si corre in scarpe da ginnastica, non stivali.
    const scarpa = new THREE.Mesh(blobGeo({
      rx: 0.037, ry: 0.030, rz: 0.070,
      colorFn: (v) => (v.y < -0.010 ? new THREE.Color("#0d0c0b") : nero),
    }), mat);
    scarpa.position.set(sign * 0.272, 1.446, 0.098);   // piede in fuori, appoggiato sulla pancia
    scarpa.rotation.x = -0.30;
    scarpa.castShadow = true;
    rider.add(scarpa);
  });

  // ── SEDERE e RACCORDI D'ANCA ───────────────────────────────────────────────
  // A pelo il fantino POGGIA col bacino sul dorso nudo: senza questi volumi il
  // busto finiva aperto (si vedeva l'interno del giubbetto da dietro) e le cosce
  // nascevano staccate, con buchi visibili all'anca. Due glutei + bacino nel
  // tessuto del pantalone chiudono il fondoschiena appoggiandolo al cavallo, e
  // un raccordo per lato salda la coscia al tronco.
  const colSedere = L.fasceAttive ? L.c0 : L.c1;
  const matSedere = opaco(new THREE.MeshStandardMaterial({ color: colSedere, roughness: 0.68, metalness: 0.0 }));
  matSedere.normalMap = normalMapTessuto(96, 96, 5, contrada.id.length * 1.9);
  matSedere.normalMap.wrapS = matSedere.normalMap.wrapT = THREE.RepeatWrapping;
  matSedere.normalScale.set(0.75, 0.75);
  // Un SOLO volume liscio (a pezzi separati sembrava un grappolo): un ellissoide
  // largo quanto le anche, infilato sotto l'orlo del giubbetto, che affonda di
  // qualche millimetro nel dorso — il peso del fantino appoggiato sul cavallo.
  const bacino = new THREE.Mesh(blobGeo({
    rx: 0.108, ry: 0.070, rz: 0.118,
    colorFn: () => new THREE.Color("#ffffff"),
  }), matSedere);
  bacino.position.set(0, 1.780, -0.098);   // arretrato: davanti lo coprono le cosce, dietro fa la curva del fondoschiena
  bacino.castShadow = true;
  rider.add(bacino);

  // Lo STEMMA sul dorso non è più un piano flottante: è dipinto DENTRO la
  // texture del giubbetto (vedi texturaGiubbetto), incollato alla stoffa.

  // ── TAGLIA DEL FANTINO ──────────────────────────────────────────────────────
  // Fantini più piccoli del 10% (richiesta di Simone). La riduzione si applica QUI
  // dentro, non alla scala d'integrazione del gioco, così la chat Palio non deve
  // toccare nulla. È ancorata al punto di SEDUTA: il bacino resta esattamente dove
  // appoggia sul dorso e il corpo si accorcia verso il basso, invece di sprofondare.
  const inner = new THREE.Group();
  while (rider.children.length) inner.add(rider.children[0]);
  inner.scale.setScalar(TAGLIA);
  inner.position.y = SEDUTA_Y * (1 - TAGLIA);
  rider.add(inner);

  rider.userData.contrada = contrada.id;
  rider.userData.taglia = TAGLIA;
  return rider;
}
