// ══════════════════════════════════════════════════════════════════════════════
// ANELLO DELLA PISTA — ESTRATTO VERBATIM da game-3d.js
// ──────────────────────────────────────────────────────────────────────────────
// NON modificare a mano: rigenerare con  node estrai-pista.mjs
// Serve SOLO al banco di prova (piazza-test.html), perché la scenografia va
// vista sulla pista VERA del gioco e non su una ricostruzione a occhio.
// ══════════════════════════════════════════════════════════════════════════════
import * as THREE from "three";

const TAU = Math.PI * 2;

const TRACK_HALF_WIDTH = 11.5;

const AI_LANE_LIMIT = TRACK_HALF_WIDTH - 0.82;

const MOSSA_FRONT_LIMIT = -1.0;

const MOSSA_BACK_LIMIT = -7.0;

const MOSSA_FLARE = 3.0;        // quanto si allarga, verso l'esterno

const MOSSA_FLARE_SPAN = 40;

const RINCORSA_VARCO_WIDTH = 3.6;   // varco d'entrata (verrocchino più interno)

const RINCORSA_START_PROGRESS = MOSSA_BACK_LIMIT - 3.4;

const CAMPO_RADIUS = 68;
const CAMPO_BASE_Z = -36;
// Raggio degli spigoli delle due curve a 90°. DEVE restare maggiore della
// semi-larghezza pista (11.5): con un raggio più piccolo il bordo interno
// avrebbe raggio negativo. A 16 il bordo interno ha raggio ~4.5: curva netta.
const CAMPO_CORNER_RADIUS = 16;
// Mossa poco dopo la curva a 90° del lato sinistro (in alto a sinistra dello
// schermo): posizione speculare rispetto a prima (180° - 132° = 48°).
const CAMPO_MOSSA_ANGLE = THREE.MathUtils.degToRad(48);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function positiveMod(value, mod) {
  return ((value % mod) + mod) % mod;
}

function angleDiff(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  return diff;
}

class SemicircleCampoCurve extends THREE.Curve {
  constructor(radius, baseZ, cornerRadius, startAngle) {
    super();
    this.radius = radius;
    this.baseZ = baseZ;
    this.cornerRadius = cornerRadius;
    this.bottomZ = baseZ - cornerRadius;
    this.startAngle = startAngle;
    this.arcToRightLength = radius * startAngle;
    this.cornerLength = cornerRadius * Math.PI * 0.5;
    this.straightLength = Math.max(1, radius * 2 - cornerRadius * 2);
    this.arcToStartLength = radius * (Math.PI - startAngle);
    this.totalLength = this.arcToRightLength + this.cornerLength + this.straightLength + this.cornerLength + this.arcToStartLength;
  }

  pointFromAngle(theta) {
    return new THREE.Vector3(
      Math.cos(theta) * this.radius,
      0,
      this.baseZ + Math.sin(theta) * this.radius
    );
  }

  getPoint(t, target = new THREE.Vector3()) {
    let distance = clamp(1 - t, 0, 1) * this.totalLength;
    if (distance <= this.arcToRightLength) {
      return target.copy(this.pointFromAngle(this.startAngle - distance / this.radius));
    }
    distance -= this.arcToRightLength;
    if (distance <= this.cornerLength) {
      const phi = -distance / this.cornerRadius;
      return target.set(
        this.radius - this.cornerRadius + Math.cos(phi) * this.cornerRadius,
        0,
        this.baseZ + Math.sin(phi) * this.cornerRadius
      );
    }
    distance -= this.cornerLength;
    if (distance <= this.straightLength) {
      return target.set(this.radius - this.cornerRadius - distance, 0, this.bottomZ);
    }
    distance -= this.straightLength;
    if (distance <= this.cornerLength) {
      const phi = -Math.PI * 0.5 - distance / this.cornerRadius;
      return target.set(
        -this.radius + this.cornerRadius + Math.cos(phi) * this.cornerRadius,
        0,
        this.baseZ + Math.sin(phi) * this.cornerRadius
      );
    }
    distance -= this.cornerLength;
    return target.copy(this.pointFromAngle(Math.PI - distance / this.radius));
  }
}

function buildCampoCurve() {
  return new SemicircleCampoCurve(CAMPO_RADIUS, CAMPO_BASE_Z, CAMPO_CORNER_RADIUS, CAMPO_MOSSA_ANGLE);
}

const track = {
  curve: buildCampoCurve(),
  samples: [],
  length: 0
};

function precomputeTrack() {
  const count = 900;
  let total = 0;
  const pts = track.curve.getSpacedPoints(count);
  for (let i = 0; i < count; i += 1) {
    const point = pts[i];
    const next = pts[(i + 1) % count];
    const prev = pts[(i - 1 + count) % count];
    if (i > 0) total += point.distanceTo(pts[i - 1]);
    const tangent = next.clone().sub(prev).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    track.samples.push({ point, tangent, normal, yaw: Math.atan2(tangent.x, tangent.z), cum: total, curve: 0 });
  }
  total += pts[0].distanceTo(pts[count - 1]);
  track.length = total;

  for (let i = 0; i < track.samples.length; i += 1) {
    const prev = track.samples[(i - 8 + track.samples.length) % track.samples.length];
    const next = track.samples[(i + 8) % track.samples.length];
    const signedCurve = angleDiff(next.yaw, prev.yaw);
    track.samples[i].curve = clamp(Math.abs(signedCurve) * 1.4, 0, 1);
    track.samples[i].signedCurve = signedCurve;
  }
}

function sampleAt(distance) {
  if (!Number.isFinite(distance)) distance = 0;   // rete di sicurezza: mai un NaN → freeze
  const d = positiveMod(distance, track.length);
  const raw = (d / track.length) * track.samples.length;
  const i = Math.floor(raw) % track.samples.length;
  const j = (i + 1) % track.samples.length;
  const t = raw - Math.floor(raw);
  const a = track.samples[i];
  const b = track.samples[j];
  const point = a.point.clone().lerp(b.point, t);
  const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return {
    point,
    tangent,
    normal,
    yaw: Math.atan2(tangent.x, tangent.z),
    curve: lerp(a.curve, b.curve, t),
    signedCurve: lerp(a.signedCurve, b.signedCurve, t)
  };
}

function campoOutward(point) {
  const campoBottomZ = CAMPO_BASE_Z - CAMPO_CORNER_RADIUS;
  if (point.z <= campoBottomZ + 1.15 && Math.abs(point.x) < CAMPO_RADIUS * 0.96) {
    return new THREE.Vector3(0, 0, -1);
  }
  const v = new THREE.Vector3(point.x, 0, point.z - CAMPO_BASE_Z);
  if (v.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 1);
  return v.normalize();
}

// offsetA/offsetB possono essere NUMERI (nastro a larghezza costante) oppure
// FUNZIONI del campione: serve per svasare la pista ai canapi.
// Quanto la pista è allargata verso l'esterno alla distanza `cum` lungo il tracciato.
// Campana liscia (smoothstep) centrata sui canapi: si apre e si richiude senza
// spigoli, così i cavalli che scattano non si trovano mai fuori dal manto.
function mossaFlareAt(cum) {
  const L = track.length;
  // Difensivo: chiamata con un `cum` non valido (es. da un campione interpolato di
  // sampleAt, che NON espone cum) restituiva NaN e propagava NaN a tutte le
  // geometrie che dipendono dalla svasatura.
  if (!L || !Number.isFinite(cum)) return 0;
  const centro = positiveMod((MOSSA_BACK_LIMIT + MOSSA_FRONT_LIMIT) * 0.5, L);
  let d = positiveMod(cum - centro, L);
  if (d > L * 0.5) d -= L;
  const t = clamp(1 - Math.abs(d) / MOSSA_FLARE_SPAN, 0, 1);
  return MOSSA_FLARE * t * t * (3 - 2 * t);
}
// Bordo esterno e limiti della mossa, calcolati DOVE stanno i canapi (quindi con
// la svasatura piena). Sono funzioni perché track.length non esiste al caricamento.
// Bordo esterno di riferimento per verrocchino e rincorsa: si basa sulla svasatura
// MINIMA lungo TUTTO il tratto che la rincorsa percorre (dal punto più arretrato
// dello slancio fino al canape), non su quella massima ai canapi. Usando il massimo,
// le corsie finivano fuori dal manto là dove la svasatura si era già richiusa.
function mossaOuterEdge() {
  const L = track.length || 1;
  let minFlare = Infinity;
  for (let p = RINCORSA_START_PROGRESS - 5.0; p <= MOSSA_FRONT_LIMIT; p += 0.25) {
    minFlare = Math.min(minFlare, mossaFlareAt(positiveMod(p, L)));
  }
  return TRACK_HALF_WIDTH + (Number.isFinite(minFlare) ? minFlare : 0);
}
function verrocchinoLane() { return -(mossaOuterEdge() - RINCORSA_VARCO_WIDTH); }
function rincorsaLane() { return -(mossaOuterEdge() - 1.4); }

// ── LARGHEZZA VARIABILE (planimetria reale di Piazza del Campo) ──────────────
// La pista NON è larga uguale: i palchi la strizzano a imbuto nelle curve.
// Il restringimento entra SEMPRE dal lato ESTERNO (lane negativa = palchi);
// i colonnini interni restano dove sono. In scala relativa al reale (10 m alla
// mossa, ~7 dopo San Martino): 23 unità → ~16 nel punto più stretto.
//   · rettilineo mossa / Fonte Gaia: larghezza piena;
//   · imbuto in ingresso a San Martino;
//   · SUBITO DOPO la curva stringe ancora (la cappella sotto la Torre) e resta
//     stretto per tutto il rettilineo del Palazzo Comunale;
//   · Casato stretto, e in USCITA si riallarga di colpo (l'"inganno": la
//     centrifuga ti porta largo proprio dove la pista si apre).
const NARROW_SM = 3.0;         // dentro San Martino
const NARROW_CAPPELLA = 3.5;   // subito dopo, fino al Palazzo (il punto più stretto)
const NARROW_CASATO = 3.2;     // dentro il Casato
const NARROW_FUNNEL_IN = 26;   // metri di imbuto prima di San Martino
const NARROW_RELEASE = 16;     // uscita Casato: si riapre in fretta
// Confini delle due curve (cum di ingresso/uscita), trovati in init() cercando
// i tratti ad alta curvatura: la prima curva dopo la mossa è San Martino.
let SM_IN = 0, SM_OUT = 0, CAS_IN = 0, CAS_OUT = 0, NARROW_READY = false;
function computeTrackNarrows() {
  NARROW_READY = false;
  const spans = [];
  let inSpan = false, start = 0;
  track.samples.forEach((s) => {
    // `curve` è il valore NORMALIZZATO dei campioni (lo stesso che usa riskFall
    // con soglia 0.2 per "si cade solo in curva"): gli spigoli stanno sopra 0.2,
    // il curvone della mossa sotto. Con una soglia più bassa (0.03) il curvone
    // intero risultava "curva" e San Martino partiva dal canapo: mossa strizzata.
    const alto = (s.curve || 0) > 0.2;
    if (alto && !inSpan) { inSpan = true; start = s.cum; }
    if (!alto && inSpan) { inSpan = false; spans.push([start, s.cum]); }
  });
  if (inSpan) spans.push([start, track.length]);
  if (spans.length < 2) return;                        // pista inattesa: niente strettoie
  [SM_IN, SM_OUT] = spans[0];                          // prima curva incontrata correndo = San Martino
  [CAS_IN, CAS_OUT] = spans[spans.length - 1];         // ultima = Casato
  NARROW_READY = true;
}
function trackNarrowAt(cum) {
  if (!NARROW_READY || !track.length || !Number.isFinite(cum)) return 0;
  const d = positiveMod(cum, track.length);
  const ss = (a, b, x) => { const t = clamp((x - a) / Math.max(0.001, b - a), 0, 1); return t * t * (3 - 2 * t); };
  if (d < SM_IN - NARROW_FUNNEL_IN) return 0;
  if (d < SM_IN) return NARROW_SM * ss(SM_IN - NARROW_FUNNEL_IN, SM_IN, d);
  if (d < SM_OUT) return NARROW_SM;
  if (d < SM_OUT + 14) return lerp(NARROW_SM, NARROW_CAPPELLA, ss(SM_OUT, SM_OUT + 14, d));   // la cappella
  if (d < CAS_IN - 18) return NARROW_CAPPELLA;
  if (d < CAS_IN) return lerp(NARROW_CAPPELLA, NARROW_CASATO, ss(CAS_IN - 18, CAS_IN, d));
  if (d < CAS_OUT) return NARROW_CASATO;
  if (d < CAS_OUT + NARROW_RELEASE) return NARROW_CASATO * (1 - ss(CAS_OUT, CAS_OUT + NARROW_RELEASE, d));
  return 0;
}
// Limite di corsia ESTERNO effettivo a una data progressione di gara.
function outerLimitAt(progress) { return AI_LANE_LIMIT - trackNarrowAt(positiveMod(progress || 0, track.length || 1)); }

// ── ALTIMETRIA VISIVA ────────────────────────────────────────────────────────
// La quota del terreno lungo l'anello, SOLO estetica: non tocca velocità,
// stamina né cadute. Il rettilineo della mossa (quota 0) è il punto alto;
// San Martino crolla in picchiata (−1.2), il rettilineo del Palazzo è il fondo,
// e la rampa del Casato si impenna negli ultimi metri per tornare a quota 0.
// Il profilo parte e chiude a 0 sull'arco della mossa: canapi, tondino e
// verrocchino restano dove sono sempre stati.
const ALTI_FONDO = -1.2;
function trackHeightAt(cum) {
  if (!NARROW_READY || !track.length || !Number.isFinite(cum)) return 0;
  const d = positiveMod(cum, track.length);
  const ss = (a, b, x) => { const t = clamp((x - a) / Math.max(0.001, b - a), 0, 1); return t * t * (3 - 2 * t); };
  if (d < SM_IN - 6) return 0;                                        // mossa/Fonte Gaia: piano
  if (d < SM_OUT + 12) return ALTI_FONDO * ss(SM_IN - 6, SM_OUT + 12, d);   // la picchiata di San Martino
  if (d < CAS_IN - 15) return ALTI_FONDO;                             // il fondo, davanti al Palazzo
  if (d < CAS_OUT) return ALTI_FONDO * (1 - ss(CAS_IN - 15, CAS_OUT, d));   // la rampa del Casato
  return 0;
}

// hA/hB (opzionali): quota per-vertice dei due bordi del nastro. Di default
// entrambi seguono l'altimetria della pista; passare () => 0 su un bordo crea
// una SPONDA che raccorda la pista abbassata al piano circostante.

function createRibbonMesh(offsetA, offsetB, material, y = 0.02, hA, hB) {
  const vertices = [];
  const uvs = [];
  const indices = [];
  const samples = track.samples;
  const hFnA = hA || ((s) => trackHeightAt(s.cum));
  const hFnB = hB || hA || ((s) => trackHeightAt(s.cum));
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const oA = typeof offsetA === "function" ? offsetA(s, i) : offsetA;
    const oB = typeof offsetB === "function" ? offsetB(s, i) : offsetB;
    const a = s.point.clone().addScaledVector(s.normal, oA);
    const b = s.point.clone().addScaledVector(s.normal, oB);
    vertices.push(a.x, y + hFnA(s), a.z, b.x, y + hFnB(s), b.z);
    uvs.push(i / samples.length, 0, i / samples.length, 1);
  }
  for (let i = 0; i < samples.length; i += 1) {
    const n = (i + 1) % samples.length;
    // Avvolgimento in senso ANTIORARIO visto dall'alto: così la faccia frontale
    // del nastro guarda in ALTO ed è effettivamente visibile/illuminata. Con il
    // verso opposto (originale) la pista di tufo era una faccia rivolta in basso:
    // scartata dal culling, lasciava vedere il mattone rosso del centro sotto.
    indices.push(i * 2, i * 2 + 1, n * 2, n * 2, i * 2 + 1, n * 2 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // Faccia orizzontale rivolta in alto: normale verso l'ALTO, così riceve il
  // cielo dell'hemisphere e il sole (prima, con la normale in basso, prendeva la
  // luce di terra bruna e sembrava scura e rossa).
  const upNormals = new Float32Array(vertices.length);
  for (let n = 1; n < upNormals.length; n += 3) upNormals[n] = 1;
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(upNormals, 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createShapeMesh(scale, material, y) {
  const shape = new THREE.Shape();
  track.samples.forEach((s, index) => {
    const x = s.point.x * scale;
    const z = CAMPO_BASE_Z + (s.point.z - CAMPO_BASE_Z) * scale;
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

// Geometria piatta della conchiglia del Campo (ShapeGeometry, scala data), riusata
// per il lastricato base e per l'overlay dei nove spicchi.
function campoShapeGeometry(scale) {
  const shape = new THREE.Shape();
  track.samples.forEach((s, index) => {
    const x = s.point.x * scale;
    const z = CAMPO_BASE_Z + (s.point.z - CAMPO_BASE_Z) * scale;
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Texture tileabile di mattoni a SPINA DI PESCE (terracotta senese), fughe scure.

function makeCylinderBetween(start, end, radius, material) {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  return mesh;
}

// Texture procedurale del tufo: sabbia terrosa con chiazze morbide (zone
// consumate), grana fine e brevi solchi di zoccoli. È quasi neutra: modula il
// VALORE della superficie senza spostarne la tinta, così il tufo "vive" senza
// sembrare piatto. Viene moltiplicata per il colore del materiale.

function makeTufoTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#e2ddd2";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 64; i += 1) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 12 + Math.random() * 44;
    const dark = Math.random() < 0.5;
    const a = 0.07 + Math.random() * 0.11;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? `rgba(92,76,56,${a})` : `rgba(252,247,235,${a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  const id = ctx.getImageData(0, 0, 256, 256);
  const dd = id.data;
  for (let i = 0; i < dd.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    dd[i] += n; dd[i + 1] += n; dd[i + 2] += n;
  }
  ctx.putImageData(id, 0, 0);
  for (let i = 0; i < 140; i += 1) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const l = 6 + Math.random() * 24;
    ctx.strokeStyle = `rgba(92,72,52,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.8 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + l, y + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export {
  TAU, TRACK_HALF_WIDTH, AI_LANE_LIMIT,
  CAMPO_RADIUS, CAMPO_BASE_Z, CAMPO_CORNER_RADIUS, CAMPO_MOSSA_ANGLE,
  MOSSA_FLARE, MOSSA_FLARE_SPAN,
  clamp, lerp, positiveMod, angleDiff,
  track, precomputeTrack, sampleAt, campoOutward,
  mossaFlareAt, computeTrackNarrows, trackNarrowAt, trackHeightAt, outerLimitAt,
  createRibbonMesh, makeCylinderBetween, makeTufoTexture
};
