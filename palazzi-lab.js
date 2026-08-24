// ══════════════════════════════════════════════════════════════════════════════
// I PALAZZI DI PIAZZA DEL CAMPO — la cortina attorno alla conchiglia
// ──────────────────────────────────────────────────────────────────────────────
// Prima erano 104 scatole a caso (larghezza e altezza random, finestre come
// tessere nere) messe a 5.8 dal bordo pista: leggevano come un recinto di
// container, e per giunta finivano dentro i palchi nuovi.
//
// Qui la cortina è fatta come è fatta davvero:
//   · un ANELLO SPEZZATO in blocchi che condividono gli spigoli — niente fessure
//     fra un palazzo e l'altro, e la piazza resta chiusa;
//   · due famiglie di facciate, quelle vere di piazza: il GOTICO di mattoni con
//     bifore/trifore a sesto acuto, marcapiani di pietra e merlature (Sansedoni,
//     Chigi-Saracini), e l'INTONACO chiaro/rosato con finestre riquadrate di
//     pietra e persiane (Palazzo d'Elci, il fronte verso il Casato);
//   · le facciate sono DIPINTE su canvas (una texture per classe di blocco, non
//     una per palazzo) e il rilievo è dato da cornicione, gronda, tetto di coppi,
//     davanzali e qualche balcone: costa poco e legge da lontano;
//   · d'agosto la piazza è vestita: drappi e bandiere ai balconi, e gente
//     affacciata alle finestre dei primi piani.
//
// Scala: il Campo in gioco è a misura vera in pianta (raggio 68 ≈ 68 m), quindi
// i palazzi vanno alti sul serio — 15÷22 unità (4÷6 piani), non 5÷10 come prima:
// è metà del motivo per cui la piazza sembrava un'arenetta.
// ══════════════════════════════════════════════════════════════════════════════
import * as THREE from "three";

const TAU = Math.PI * 2;

export const MISP = {
  gap: 0.45,          // stacco fra il fondo dei palchi e il filo delle facciate
  profondita: 7.0,    // quanto sono profondi i volumi (verso fuori)
  piano: 3.55,        // altezza di un piano
  altezzaMin: 11.5,
  altezzaMax: 24.5,
  bloccoMin: 15.0,    // larghezza di un palazzo: pochi e LUNGHI (richiesta utente)
  bloccoMax: 27.0,
  cornicione: 0.55,   // sporgenza del cornicione
  falda: 3.6          // profondità della falda del tetto
};

// Tinte vere del Campo: cotto senese, intonaci crema/rosa/ocra, pietra chiara.
const TINTE = {
  gotico: ["#a55c39", "#9c5334", "#b0674a", "#96522f"],
  intonaco: ["#e8d5ab", "#dfa683", "#d3ab6c", "#e9dcbc", "#cf8f6b", "#dcc396"],
  pietra: "#efe7d4",
  cotto: "#8f4a2f",
  tetto: "#a4522c",
  legnoScuro: "#4a3524"
};

// ── utilità di disegno ───────────────────────────────────────────────────────
function tela(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, x: c.getContext("2d") };
}
function rnd(seme) {
  let s = seme * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function sporca(x, w, h, r) {
  // Macchie e colature: nessuna facciata di Siena è di tinta unita.
  for (let i = 0; i < 42; i += 1) {
    const g = x.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, w * (0.05 + r() * 0.22));
    g.addColorStop(0, r() < 0.42 ? "rgba(104,72,44,0.07)" : "rgba(255,244,214,0.09)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 9; i += 1) {   // qualche colatura sotto i davanzali
    const px = r() * w;
    const g = x.createLinearGradient(px, 0, px, h);
    g.addColorStop(0, "rgba(50,36,24,0.0)");
    g.addColorStop(1, "rgba(50,36,24,0.09)");
    x.fillStyle = g;
    x.fillRect(px, r() * h * 0.5, 2 + r() * 5, h * 0.5);
  }
}
function mattoni(x, w, h, tinta, r) {
  x.fillStyle = tinta;
  x.fillRect(0, 0, w, h);
  const alt = Math.max(5, h / 130);          // corso di mattoni
  const lun = alt * 4.4;
  for (let y = 0, riga = 0; y < h; y += alt, riga += 1) {
    const off = (riga % 2) * lun * 0.5;
    for (let px = -lun; px < w + lun; px += lun) {
      const t = 0.06 + r() * 0.16;
      x.fillStyle = r() < 0.5 ? `rgba(40,20,12,${t})` : `rgba(240,196,150,${t * 0.8})`;
      x.fillRect(px + off + 0.6, y + 0.6, lun - 1.4, alt - 1.2);
    }
    x.fillStyle = "rgba(226,206,176,0.16)";  // malta
    x.fillRect(0, y, w, 0.9);
  }
}

// Finestra a sesto acuto (la cella base di bifore e trifore).
function lancetta(x, X, Y, W, H, pietra) {
  const r = W * 0.5;
  x.beginPath();
  x.moveTo(X, Y + H);
  x.lineTo(X, Y + r * 0.9);
  x.quadraticCurveTo(X + r * 0.12, Y + r * 0.1, X + r, Y);
  x.quadraticCurveTo(X + W - r * 0.12, Y + r * 0.1, X + W, Y + r * 0.9);
  x.lineTo(X + W, Y + H);
  x.closePath();
  x.fillStyle = "#2a2119";                 // il buio dell'interno
  x.fill();
  x.lineWidth = Math.max(1.4, W * 0.16);
  x.strokeStyle = pietra;
  x.stroke();
  // vetro: un filo di cielo riflesso in alto
  const g = x.createLinearGradient(X, Y, X, Y + H);
  g.addColorStop(0, "rgba(176,198,214,0.55)");
  g.addColorStop(0.45, "rgba(60,66,70,0.25)");
  g.addColorStop(1, "rgba(20,18,16,0.1)");
  x.fillStyle = g;
  x.fill();
}

// Trifora gotica: tre lancette dentro un arcone di pietra, con oculo sopra.
function trifora(x, X, Y, W, H, luci, pietra) {
  x.fillStyle = pietra;
  x.fillRect(X - W * 0.06, Y - H * 0.06, W * 1.12, H * 1.12);
  const passo = W / luci;
  for (let i = 0; i < luci; i += 1) {
    lancetta(x, X + passo * i + passo * 0.16, Y + H * 0.08, passo * 0.68, H * 0.86, pietra);
  }
  x.strokeStyle = "rgba(90,66,44,0.5)";
  x.lineWidth = 1.2;
  x.strokeRect(X - W * 0.06, Y - H * 0.06, W * 1.12, H * 1.12);
}

// Finestra riquadrata con davanzale e persiane (le facciate a intonaco).
function finestraPersiane(x, X, Y, W, H, pietra, r) {
  x.fillStyle = pietra;                                   // mostra di pietra
  x.fillRect(X - W * 0.12, Y - H * 0.08, W * 1.24, H * 1.18);
  x.fillStyle = "#2b241c";
  x.fillRect(X, Y, W, H);
  const g = x.createLinearGradient(X, Y, X, Y + H);
  g.addColorStop(0, "rgba(170,192,208,0.5)");
  g.addColorStop(1, "rgba(28,26,24,0.35)");
  x.fillStyle = g;
  x.fillRect(X, Y, W, H);
  // Persiane: a volte chiuse (l'estate senese), a volte accostate ai lati.
  const verde = r() < 0.45 ? "#6e7358" : "#8a7a5e";
  const chiuse = r() < 0.42;
  const disegnaAnta = (ax, aw) => {
    x.fillStyle = verde;
    x.fillRect(ax, Y, aw, H);
    x.fillStyle = "rgba(0,0,0,0.22)";
    for (let ly = Y + 2; ly < Y + H - 1; ly += Math.max(2.4, H / 14)) x.fillRect(ax + 1, ly, aw - 2, 1.1);
  };
  if (chiuse) { disegnaAnta(X, W * 0.5); disegnaAnta(X + W * 0.5, W * 0.5); }
  else { disegnaAnta(X - W * 0.18, W * 0.2); disegnaAnta(X + W * 0.98, W * 0.2); }
  x.fillStyle = pietra;                                   // davanzale
  x.fillRect(X - W * 0.2, Y + H * 1.06, W * 1.4, H * 0.09);
  x.fillStyle = "rgba(70,52,36,0.28)";
  x.fillRect(X - W * 0.2, Y + H * 1.15, W * 1.4, H * 0.03);
}

// ── LA TEXTURA DI UNA FACCIATA ───────────────────────────────────────────────
// Una per "classe" di blocco (stile + numero di campate e piani + tinta), non
// una per palazzo: bastano una decina di canvas per tutta la piazza.
export function texturaFacciata({ stile = "intonaco", piani = 5, tinta, seme = 1, larghezza = 256 } = {}) {
  // DUE campate per canvas, disegnate diverse fra loro: ripetendone una sola
  // lungo il fronte si vedeva la fotocopia (finestre tutte identiche a passo fisso).
  const B = larghezza;
  const W = B * 2;
  const alt = Math.min(1600, Math.round(B * (piani * MISP.piano) / 2.9));
  const { c, x } = tela(W, alt);
  const r = rnd(seme);
  const pietra = TINTE.pietra;
  const base = tinta || (stile === "gotico" ? TINTE.gotico[seme % TINTE.gotico.length] : TINTE.intonaco[seme % TINTE.intonaco.length]);

  if (stile === "gotico") mattoni(x, W, alt, base, r);
  else { x.fillStyle = base; x.fillRect(0, 0, W, alt); }

  const hTerra = alt * 0.19;
  x.fillStyle = stile === "gotico" ? "rgba(58,32,20,0.42)" : "rgba(74,56,40,0.34)";
  x.fillRect(0, alt - hTerra, W, hTerra);

  for (let campata = 0; campata < 2; campata += 1) {
    const X0 = campata * B;
    // Pianterreno: arcata in ombra (d'agosto la coprono i palchi, ma dà peso).
    const aw = B * 0.62, ax = X0 + B * 0.19, ay = alt - hTerra * 0.86;
    x.beginPath();
    x.moveTo(ax, alt);
    x.lineTo(ax, ay + aw * 0.45);
    if (stile === "gotico") {
      x.quadraticCurveTo(ax + aw * 0.1, ay, ax + aw * 0.5, ay - aw * 0.12);
      x.quadraticCurveTo(ax + aw * 0.9, ay, ax + aw, ay + aw * 0.45);
    } else x.quadraticCurveTo(ax + aw * 0.5, ay - aw * 0.2, ax + aw, ay + aw * 0.45);
    x.lineTo(ax + aw, alt);
    x.closePath();
    x.fillStyle = "#22190f"; x.fill();
    x.lineWidth = B * 0.02; x.strokeStyle = stile === "gotico" ? "rgba(226,206,176,0.35)" : pietra; x.stroke();

    const hPiano = (alt - hTerra) / piani;
    for (let p = 0; p < piani; p += 1) {
      const y0 = alt - hTerra - hPiano * (p + 1);
      if (stile === "gotico") {
        trifora(x, X0 + B * 0.17, y0 + hPiano * 0.16, B * 0.66, hPiano * 0.66, p === 0 ? 3 : (r() < 0.4 ? 2 : 3), pietra);
      } else {
        // Le finestre non stanno tutte alla stessa quota né hanno tutte la stessa
        // luce: nelle facciate vere l'ultimo piano è più basso e più piccolo.
        const stretta = p === piani - 1 ? 0.82 : 1;
        const ww = B * 0.3 * stretta;
        finestraPersiane(x, X0 + B * 0.5 - ww * 0.5, y0 + hPiano * (0.22 + r() * 0.04), ww, hPiano * 0.5 * stretta, pietra, r);
      }
    }
  }

  // Marcapiani e fasce: continui su tutta la larghezza, non per campata.
  const hPiano = (alt - hTerra) / piani;
  for (let p = 0; p < piani; p += 1) {
    const y0 = alt - hTerra - hPiano * (p + 1);
    if (stile === "gotico") {
      x.fillStyle = pietra;
      x.fillRect(0, y0 + hPiano * 0.93, W, Math.max(2, hPiano * 0.055));
      x.fillStyle = "rgba(80,56,38,0.25)";
      x.fillRect(0, y0 + hPiano * 0.985, W, Math.max(1, hPiano * 0.02));
    } else if (p < piani - 1) {
      x.fillStyle = "rgba(255,250,236,0.22)";
      x.fillRect(0, y0 + hPiano * 0.96, W, Math.max(1.5, hPiano * 0.03));
    }
  }

  // Cornicione dipinto sotto la gronda (il rilievo vero è geometria).
  x.fillStyle = stile === "gotico" ? "rgba(232,214,186,0.55)" : "rgba(255,250,238,0.6)";
  x.fillRect(0, 0, W, alt * 0.022);
  x.fillStyle = "rgba(46,32,22,0.35)";
  for (let px = 0; px < W; px += B * 0.11) x.fillRect(px, alt * 0.022, B * 0.055, alt * 0.014);

  sporca(x, W, alt, r);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ── Coppi del tetto ──────────────────────────────────────────────────────────
export function texturaCoppi({ larghezza = 512 } = {}) {
  const { c, x } = tela(larghezza, larghezza);
  const r = rnd(7);
  x.fillStyle = TINTE.tetto;
  x.fillRect(0, 0, larghezza, larghezza);
  const passo = larghezza / 16;
  for (let y = 0; y < larghezza; y += passo * 0.92) {
    for (let px = 0; px < larghezza; px += passo) {
      const t = 0.22 + r() * 0.42;
      x.fillStyle = r() < 0.5 ? `rgba(58,26,16,${t})` : `rgba(236,158,108,${t})`;
      x.beginPath();
      x.arc(px + passo * 0.5, y + passo * 0.5, passo * 0.46, Math.PI, TAU);
      x.fill();
      x.strokeStyle = "rgba(36,16,10,0.55)";
      x.lineWidth = 1.4;
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ══════════════════════════════════════════════════════════════════════════════
// LA CORTINA
// ──────────────────────────────────────────────────────────────────────────────
// ctx = lo stesso contratto di piazza-lab.js.
// I blocchi CONDIVIDONO gli spigoli: l'anello resta chiuso, senza fessure fra un
// palazzo e l'altro (era il difetto delle 104 scatole sparse).
// opz.varchi = [{ da, a }] in frazione di giro: buchi dove la cortina non va
// costruita (il Palazzo Pubblico, che è un pezzo a sé).
// ══════════════════════════════════════════════════════════════════════════════
export function costruisciPalazzi(ctx, opz = {}) {
  const g = new THREE.Group();
  g.name = "PalazziDelCampo";
  const camp = ctx.campioni;
  const semeGen = rnd(opz.seme ?? 20260822);

  // 1) Il FILO delle facciate: oltre il fondo dei palchi nel punto in cui la
  //    pista è più larga (ai canapi), così non li tocca mai.
  let maxLargo = 0;
  camp.forEach((s) => { maxLargo = Math.max(maxLargo, ctx.largoEsterno(s)); });
  const R = opz.filo ?? (maxLargo + (opz.fondoPalchi ?? 5.31) + (opz.gap ?? MISP.gap));

  const staz = [];
  for (let i = 0; i <= camp.length; i += 1) {
    const s = camp[i % camp.length];
    const f = ctx.fuori(s.point).clone();
    const p = s.point.clone().addScaledVector(f, R);
    p.y = ctx.quota(s);
    staz.push({ p, f, cum: s.cum, giro: (i % camp.length) / camp.length });
  }
  let corsa = 0;
  staz.forEach((st, i) => { if (i > 0) corsa += st.p.distanceTo(staz[i - 1].p); st.s = corsa; });

  const varchi = opz.varchi ? [...opz.varchi] : [];
  // Le STRADE che sbucano in piazza: convertite in varchi della cortina
  // misurando la larghezza LUNGO la linea delle facciate (le frazioni di giro
  // a raggio maggiore valgono più metri che sulla pista).
  const strade = (opz.strade || []).map((v) => {
    let i0 = 0, best = Infinity;
    staz.forEach((st, i) => { const d = Math.abs(st.giro - v.giro); const dd = Math.min(d, 1 - d); if (dd < best) { best = dd; i0 = i; } });
    const mezza = (v.larghezza ?? 6) / 2;
    let iA = i0, iB = i0;
    while (iA > 0 && staz[i0].s - staz[iA].s < mezza) iA -= 1;
    while (iB < staz.length - 1 && staz[iB].s - staz[i0].s < mezza) iB += 1;
    varchi.push({ da: staz[iA].giro, a: staz[iB].giro });
    return { ...v, st: staz[i0] };
  });
  const dentroVarco = (giro) => varchi.some((v) => (v.da <= v.a ? giro >= v.da && giro <= v.a : giro >= v.da || giro <= v.a));

  // 2) Spezzo l'anello in palazzi.
  const blocchi = [];
  let i0 = 0;
  // Se il punto di partenza cade in un varco, si esce dal varco prima di
  // aprire il blocco; se il blocco INCONTRA un varco, si CHIUDE lì (spezzato
  // sul bordo), non si scarta intero: prima un varco largo 7 apriva buchi
  // larghi quanto il palazzo scartato (15-27) e il ponte non arrivava mai
  // ai fronti veri.
  while (i0 < staz.length - 1) {
    while (i0 < staz.length - 1 && dentroVarco(staz[i0].giro)) i0 += 1;
    if (i0 >= staz.length - 1) break;
    const larg = MISP.bloccoMin + semeGen() * (MISP.bloccoMax - MISP.bloccoMin);
    let i1 = i0 + 1;
    while (i1 < staz.length - 1 && staz[i1].s - staz[i0].s < larg && !dentroVarco(staz[i1].giro)) i1 += 1;
    const a = staz[i0], b = staz[i1];
    const attraversaVarco = b.s - a.s < 4;   // moncone troppo corto: non vale un palazzo
    if (!attraversaVarco) {
      const gotico = semeGen() < 0.45;
      const stile = gotico ? "gotico" : "intonaco";
      const larghezza = b.s - a.s;
      const piani = Math.max(3, Math.min(7, Math.round((MISP.altezzaMin + semeGen() * (MISP.altezzaMax - MISP.altezzaMin)) / MISP.piano)));
      const tinta = semeGen();
      blocchi.push({
        a, b, stile, piani, tinta,
        tintaIdx: Math.floor(tinta * (stile === "gotico" ? TINTE.gotico.length : 3)),
        sporgi: semeGen() * 2.2,   // ogni palazzo sta su un filo suo: spigoli e ombre ai giunti
        campate: Math.max(2, Math.round(larghezza / 3.0)),
        torre: semeGen() < 0.3,
        larghezza
      });
    }
    i0 = i1;
  }

  // 3) Geometrie: le facciate si accorpano per CLASSE (stessa texture = stessa
  //    mesh), il resto in poche mesh condivise.
  const perTex = new Map();
  const muri = { pos: [], col: [], idx: [] };
  const cornici = { pos: [], idx: [] };
  const tetti = { pos: [], uv: [], idx: [] };
  const merli = [];
  const finestreVive = [];
  const drappi = [];
  const colore = new THREE.Color();

  const quad = (acc, p1, p2, p3, p4, uv) => {
    const k = acc.pos.length / 3;
    [p1, p2, p3, p4].forEach((p) => acc.pos.push(p.x, p.y, p.z));
    if (uv && acc.uv) acc.uv.push(...uv);
    acc.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    return k;
  };
  const tinteMuro = (b) => (b.stile === "gotico" ? TINTE.gotico[b.tintaIdx % TINTE.gotico.length] : TINTE.intonaco[b.tintaIdx % TINTE.intonaco.length]);

  blocchi.forEach((b, bi) => {
    const A = b.a.p.clone().addScaledVector(b.a.f, b.sporgi);
    const B = b.b.p.clone().addScaledVector(b.b.f, b.sporgi);
    const base = Math.min(A.y, B.y) - 1.2;
    A.y = base; B.y = base;
    const dir = B.clone().sub(A).setY(0).normalize();
    const n = new THREE.Vector3(dir.z, 0, -dir.x);
    if (n.dot(b.a.f) < 0) n.negate();               // sempre verso i palazzi
    const H = b.piani * MISP.piano + 1.2;
    const D = MISP.profondita;
    const su = (p, y) => p.clone().setY(p.y + y);
    const fuoriP = (p, d) => p.clone().addScaledVector(n, d);

    // Facciata (verso la piazza)
    const chiave = `${b.stile}-${b.piani}-${b.tintaIdx}`;
    if (!perTex.has(chiave)) {
      perTex.set(chiave, {
        tex: texturaFacciata({
          stile: b.stile, piani: b.piani, seme: b.tintaIdx + b.piani * 7 + (b.stile === "gotico" ? 31 : 0),
          tinta: tinteMuro(b), larghezza: opz.risoluzione || 256
        }),
        acc: { pos: [], uv: [], idx: [] }
      });
    }
    const gruppoTex = perTex.get(chiave);
    // u va da 0 a "quante campate": la texture di UNA campata si ripete.
    const uRip = b.campate / 2;   // la texture contiene due campate
    quad(gruppoTex.acc, A, B, su(B, H), su(A, H), [0, 0, uRip, 0, uRip, 1, 0, 1]);

    // Fianchi e retro (si vedono dove i palazzi hanno altezze diverse).
    colore.set(tinteMuro(b));
    const primo = muri.pos.length / 3;
    [[A, fuoriP(A, D)], [fuoriP(B, D), B], [fuoriP(A, D), fuoriP(B, D)]].forEach(([p, q]) => {
      quad(muri, p, q, su(q, H), su(p, H));
    });
    for (let k = primo; k < muri.pos.length / 3; k += 1) muri.col.push(colore.r, colore.g, colore.b);

    // Cornicione: aggetto di pietra sotto la gronda.
    const c0 = su(A, H), c1 = su(B, H);
    const sporgi = fuoriP(c0, -MISP.cornicione), sporgi1 = fuoriP(c1, -MISP.cornicione);
    quad(cornici, c0, c1, sporgi1, sporgi);                                  // sotto
    quad(cornici, su(sporgi, 0.42), su(sporgi1, 0.42), su(c1, 0.42), su(c0, 0.42));   // sopra
    quad(cornici, sporgi, sporgi1, su(sporgi1, 0.42), su(sporgi, 0.42));     // fronte

    // Cantonali: lesene di pietra ai due spigoli delle facciate a intonaco.
    if (b.stile !== "gotico") {
      const t = 0.34 / Math.max(0.001, b.larghezza);
      [[0, t], [1 - t, 1]].forEach(([t0, t1]) => {
        const q0 = A.clone().lerp(B, t0).addScaledVector(n, -0.09);
        const q1 = A.clone().lerp(B, t1).addScaledVector(n, -0.09);
        quad(cornici, q0, q1, su(q1, H), su(q0, H));
      });
    }

    // Tetto: falda che sale verso l'interno dell'isolato.
    const g0 = su(sporgi, 0.42), g1 = su(sporgi1, 0.42);
    const r0 = su(fuoriP(g0, MISP.falda), 2.1), r1 = su(fuoriP(g1, MISP.falda), 2.1);
    quad(tetti, g0, g1, r1, r0, [0, 0, b.larghezza / 1.7, 0, b.larghezza / 1.7, 2.4, 0, 2.4]);

    // Merlature sui palazzi gotici (Sansedoni, Chigi-Saracini).
    if (b.stile === "gotico") {
      const quanti = Math.max(4, Math.round(b.larghezza / 1.15));
      for (let m = 0; m < quanti; m += 1) {
        const t = (m + 0.5) / quanti;
        const p = A.clone().lerp(B, t).addScaledVector(n, -MISP.cornicione * 0.45);
        merli.push({ p: su(p, H + 0.42 + 0.42), yaw: Math.atan2(n.x, n.z), tinta: tinteMuro(b) });
      }
    }

    // Torri: in piazza ne spuntano diverse sopra la linea dei tetti.
    if (b.torre) {
      // Le torri di piazza escono DAL palazzo (partono a metà facciata e
      // spuntano sopra i tetti), sono di mattoni e finiscono a merli.
      const larg = Math.min(4.6, Math.max(3.0, b.larghezza * 0.45));
      const fuoriTetto = 4.5 + b.tinta * 5.5;
      const cima = H + fuoriTetto;
      const piede = H * 0.45;
      const centro = A.clone().lerp(B, 0.32 + b.tinta * 0.36).addScaledVector(n, D * 0.3);
      const torre = new THREE.Mesh(
        new THREE.BoxGeometry(larg, cima - piede, larg),
        new THREE.MeshStandardMaterial({ color: TINTE.gotico[b.tintaIdx % TINTE.gotico.length], roughness: 0.96 })
      );
      torre.position.set(centro.x, base + piede + (cima - piede) * 0.5, centro.z);
      torre.rotation.y = Math.atan2(n.x, n.z);
      torre.castShadow = true;
      torre.receiveShadow = true;
      g.add(torre);
      const quantiM = 4;
      for (let mx = 0; mx < quantiM; mx += 1) {
        for (let mz = 0; mz < quantiM; mz += 1) {
          if (mx > 0 && mx < quantiM - 1 && mz > 0 && mz < quantiM - 1) continue;   // solo il bordo
          const off = new THREE.Vector3(
            (mx / (quantiM - 1) - 0.5) * larg * 0.86,
            0,
            (mz / (quantiM - 1) - 0.5) * larg * 0.86
          ).applyAxisAngle(new THREE.Vector3(0, 1, 0), torre.rotation.y);
          merli.push({
            p: new THREE.Vector3(centro.x + off.x, base + cima + 0.4, centro.z + off.z),
            yaw: torre.rotation.y,
            tinta: TINTE.gotico[b.tintaIdx % TINTE.gotico.length]
          });
        }
      }
    }

    // Gente alle finestre e drappi ai davanzali: d'agosto la piazza è vestita.
    const pianiVivi = Math.min(3, b.piani);
    for (let p = 0; p < pianiVivi; p += 1) {
      for (let cq = 0; cq < b.campate; cq += 1) {
        const t = (cq + 0.5) / b.campate;
        const y = base + 1.2 + MISP.piano * (p + 0.62);
        const punto = A.clone().lerp(B, t).setY(y);
        if (semeGen() < 0.5) finestreVive.push({ p: punto.clone().addScaledVector(n, -0.16), yaw: Math.atan2(-n.x, -n.z) });
        if (p < 2 && semeGen() < 0.22) drappi.push({ p: punto.clone().addScaledVector(n, -0.24).setY(y - 1.15), yaw: Math.atan2(-n.x, -n.z), tinta: semeGen() });
      }
    }
  });

  // 4) Mesh finali.
  const mesh = (acc, mat, conUv) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
    if (conUv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uv, 2));
    if (acc.col && acc.col.length) geo.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
    geo.setIndex(acc.idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  perTex.forEach((v) => {
    g.add(mesh(v.acc, new THREE.MeshStandardMaterial({ map: v.tex, roughness: 0.94, side: THREE.DoubleSide }), true));
  });
  g.add(mesh(muri, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })));
  g.add(mesh(cornici, new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.85, side: THREE.DoubleSide })));
  const coppi = opz.texturaCoppi || texturaCoppi();
  g.add(mesh(tetti, new THREE.MeshStandardMaterial({ map: coppi, roughness: 0.92, side: THREE.DoubleSide }), true));

  if (merli.length) {
    const im = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.85, 0.5),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }),
      merli.length
    );
    const d = new THREE.Object3D();
    merli.forEach((m, i) => {
      d.position.copy(m.p);
      d.rotation.set(0, m.yaw, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      im.setColorAt(i, colore.set(m.tinta));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
  }

  if (finestreVive.length) {
    const im = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.13, 0.3, 2, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }),
      finestreVive.length
    );
    const tinte = [0xe8e4da, 0xcfc8ba, 0x9aa2ab, 0x84725c, 0xc44135, 0x2e689b, 0xe0b84a];
    const d = new THREE.Object3D();
    finestreVive.forEach((s, i) => {
      d.position.copy(s.p);
      d.rotation.set(0, s.yaw, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      im.setColorAt(i, colore.setHex(tinte[i % tinte.length]));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    g.add(im);
  }

  if (drappi.length) {
    const im = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.85, 1.6),
      new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }),
      drappi.length
    );
    const tinte = [0x7e1a20, 0x8e1f26, 0x9c2a2f, 0x6d1f4a, 0xb08428, 0x2c4a7c];
    const d = new THREE.Object3D();
    drappi.forEach((s, i) => {
      d.position.copy(s.p);
      d.rotation.set(0, s.yaw, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      im.setColorAt(i, colore.setHex(tinte[Math.floor(s.tinta * tinte.length) % tinte.length]));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    g.add(im);
  }

  // Quinte delle strade: due fianchi di palazzo, il fondo in penombra e il
  // selciato che SALE allontanandosi dalla piazza (le strade di Siena scendono
  // tutte verso il Campo). Vista dalla pista è una fessura d'ombra fra i palazzi.
  strade.forEach((v, vi) => {
    const st = v.st;
    const larg = v.larghezza ?? 6;
    const prof = v.profondita ?? 16;
    const salita = v.salita ?? 2.6;
    const yaw = Math.atan2(st.f.x, st.f.z);
    const tang = new THREE.Vector3(st.f.z, 0, -st.f.x);
    const base = st.p.y - 1.2;
    const sg = new THREE.Group();
    sg.name = "Strada" + vi;
    // Le quinte laterali si aggiungono solo su richiesta ({ quinte: true }):
    // di norma i fianchi della via sono i palazzi veri della cortina.
    if (v.quinte) {
      const muroMat = new THREE.MeshStandardMaterial({ color: TINTE.intonaco[(vi * 2 + 1) % TINTE.intonaco.length], roughness: 0.95 });
      [-1, 1].forEach((sgn) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 13, prof), muroMat);
        m.position.copy(st.p).addScaledVector(tang, sgn * (larg / 2 + 1.2)).addScaledVector(st.f, prof / 2);
        m.position.y = base + 6.5;
        m.rotation.y = yaw;
        m.castShadow = true;
        m.receiveShadow = true;
        sg.add(m);
      });
    }
    const selciato = new THREE.Mesh(new THREE.BoxGeometry(larg + 0.4, 0.3, prof * 1.02),
      new THREE.MeshStandardMaterial({ color: 0x6e5a48, roughness: 0.98 }));
    selciato.position.copy(st.p).addScaledVector(st.f, prof / 2);
    selciato.position.y = base + salita / 2;
    selciato.rotation.y = yaw;
    selciato.rotation.x = -Math.atan2(salita, prof);
    selciato.receiveShadow = true;
    sg.add(selciato);
    const fondo = new THREE.Mesh(new THREE.BoxGeometry(larg + 8, 13.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 1 }));
    fondo.position.copy(st.p).addScaledVector(st.f, prof);
    fondo.position.y = base + salita + 5;
    fondo.rotation.y = yaw;
    sg.add(fondo);
    g.add(sg);
  });

  return { gruppo: g, filo: R, blocchi: blocchi.length };
}
