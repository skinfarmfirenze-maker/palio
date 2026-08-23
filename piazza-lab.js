// ══════════════════════════════════════════════════════════════════════════════
// SCENOGRAFIA DI PIAZZA DEL CAMPO — steccati e palchi
// ──────────────────────────────────────────────────────────────────────────────
// Curata dalla chat "grafica" (steccati, palchi, palazzi). Fantini e cavalli
// stanno in un'altra chat: qui non si tocca nulla che li riguardi.
//
// Cosa c'era prima in game-3d.js: due file di paletti sottili con due corrimano
// cilindrici su ENTRAMBI i lati (uguali dentro e fuori) e tre panche di legno
// alte 34 cm. In piazza non è così, e le due barriere non si somigliano affatto:
//
//   · LATO INTERNO (verso il Campo)  → il "colonnino": pilastrini di travertino
//     con fra l'uno e l'altro una staccionata di legno chiaro (due correnti e
//     una fitta serie di stecche verticali). È bassa, chiara, e si vede sempre
//     sullo sfondo del lastricato.
//   · LATO ESTERNO (verso i palazzi) → la "palancata" dipinta: pannelli di legno
//     verde salvia decorati a finti marmi, rosoni quadrilobati e scudi, con
//     bordure a dentelli e un corrimano di legno scuro sopra. È più alta.
//   · Dietro la palancata salgono i PALCHI: gradinate di legno bruno addossate
//     alle facciate, con le scalette diagonali di servizio.
//
// Tutto è generato come SUPERFICIE SPAZZATA lungo l'anello (un profilo 2D
// trascinato lungo la linea della barriera), non come sequenza di mesh separate:
// una manciata di draw call invece di migliaia di paletti, e nessuna giunzione
// visibile là dove la pista si svasa ai canapi o si strizza negli imbuti.
// ══════════════════════════════════════════════════════════════════════════════
import * as THREE from "three";

const TAU = Math.PI * 2;

// ── Misure (unità di gioco ≈ metri: il garrese del cavallo sta a ~1.7) ────────
export const MIS = {
  // Palancata dipinta (esterno)
  estSporgenza: 0.35,      // quanto sta fuori dal bordo pista
  estAltezza: 1.32,        // altezza dei pannelli dipinti
  estSpessore: 0.16,
  estPannello: 2.62,       // larghezza di un pannello (passo della texture)
  estCorrimano: 0.15,      // sezione del corrimano di legno in cima

  // Colonnino + staccionata (interno)
  // 0.35: i paracarri di pietra del lato interno sono stati RIMOSSI dal gioco
  // (commit c14f5a8, su nostra proposta: nella piazza vera non ci sono blocchi
  // davanti al colonnino), quindi la staccionata può stare accostata al bordo.
  intSporgenza: 0.35,
  intAltezza: 1.02,
  intPasso: 4.2,           // interasse dei pilastrini di travertino
  intPilastro: 0.34,       // lato del pilastrino
  intStecca: 0.30,         // interasse delle stecche verticali

  // Palchi
  palcoFronte: 1.15,       // dove comincia la gradinata, oltre il bordo pista
  palcoFile: 8,
  palcoPedata: 0.52,       // profondità di una fila
  palcoAlzata: 0.46,       // dislivello fra due file
  palcoBase: 1.32,         // quota della prima panca (sopra la palancata)
  palcoScalaOgni: 17,      // una scaletta di servizio ogni tot lungo l'anello
  palcoSostegnoOgni: 2.3   // montanti sotto la gradinata
};
// Fin dove arrivano i palchi verso l'esterno: le facciate devono stare oltre.
export const PALCHI_FONDO = MIS.palcoFronte + MIS.palcoFile * MIS.palcoPedata;

// ── Tinte ────────────────────────────────────────────────────────────────────
export const COL = {
  salvia: "#a3ab7a",       // il verde dei pannelli
  salviaScuro: "#6f7850",
  crema: "#e7dfc4",
  avorio: "#f0ead6",
  ocra: "#b9964e",
  rossoDec: "#9d4a44",
  verdeDec: "#4f5c3a",
  marmoRosa: "#b06a6a",
  marmoRosso: "#a2515a",
  marmoGrigio: "#7f8994",
  legnoPalco: 0x6b4430,
  legnoPalcoScuro: 0x4a2d20,
  legnoCorrimano: 0x5a3a28,
  travertino: 0xe9e3d3,
  legnoChiaro: 0xdfd6bd
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. IL PERCORSO — stazioni lungo l'anello
// ──────────────────────────────────────────────────────────────────────────────
// `ctx` è il contratto col gioco: gli passiamo i campioni della pista e tre
// funzioni che il gioco già possiede. Nessuna geometria viene ricostruita qui.
//   campioni      = track.samples
//   fuori(p)      = campoOutward(p)                       versore verso i palazzi
//   largoEsterno(s) = TRACK_HALF_WIDTH + mossaFlareAt - trackNarrowAt
//   largoInterno(s) = TRACK_HALF_WIDTH
//   quota(s)      = trackHeightAt(s.cum)
// ══════════════════════════════════════════════════════════════════════════════
// I VARCHI sono intervalli in cum {da, a} (gestiscono il wrap del giro): dove
// cadono, la scenografia non si costruisce. Servono per la zona mossa (la
// palancata lascerebbe la rincorsa senza corridoio), per la Cappella di Piazza
// e per l'entrone, che bucano le gradinate.
function dentroVarchi(cum, varchi, giro) {
  if (!varchi || !varchi.length) return false;
  const c = ((cum % giro) + giro) % giro;
  return varchi.some((v) => {
    const da = ((v.da % giro) + giro) % giro;
    const a = ((v.a % giro) + giro) % giro;
    return da <= a ? (c >= da && c <= a) : (c >= da || c <= a);
  });
}

function stazioni(ctx, { lato, extra = 0, passo = 3 }) {
  const camp = ctx.campioni;
  const out = [];
  const segno = lato === "interno" ? -1 : 1;
  for (let i = 0; i <= camp.length; i += passo) {
    const s = camp[i % camp.length];
    // Lo spostamento laterale segue la NORMALE del campione, non la radiale:
    // la pista non è un cerchio e nei corner (San Martino, Casato) le due
    // direzioni divergono — con la radiale la barriera si staccava dal bordo
    // o entrava in pista ("si deforma nelle curve", segnalato dalla chat gioco).
    // È la stessa convenzione delle barriere storiche di game-3d.js:
    // p = point + normal * (outwardSign * offset).
    const radiale = ctx.fuori(s.point);
    const lat = (s.normal && s.normal.isVector3)
      ? s.normal.clone().multiplyScalar(s.normal.dot(radiale) >= 0 ? 1 : -1)
      : radiale.clone();
    const largo = lato === "interno" ? ctx.largoInterno(s) : ctx.largoEsterno(s);
    const p = s.point.clone().addScaledVector(lat, segno * (largo + extra));
    p.y = ctx.quota(s);
    out.push({ p, fuori: lat.multiplyScalar(segno), cum: s.cum });
  }
  out.giro = camp[camp.length - 1].cum + (camp[1].cum - camp[0].cum);
  // Tangente e distanza percorsa lungo QUESTA linea (non lungo l'asse pista):
  // così i pannelli hanno tutti la stessa larghezza anche dove la pista si svasa.
  let corsa = 0;
  for (let i = 0; i < out.length; i += 1) {
    const prev = out[(i - 1 + out.length) % out.length];
    const next = out[(i + 1) % out.length];
    out[i].avanti = next.p.clone().sub(prev.p).setY(0).normalize();
    if (i > 0) corsa += out[i].p.distanceTo(out[i - 1].p);
    out[i].s = corsa;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. SPAZZATA DI UN PROFILO
// ──────────────────────────────────────────────────────────────────────────────
// `profilo` = polilinea nel piano perpendicolare al cammino: ogni punto ha
//   d = quanto è spostato verso l'esterno rispetto alla linea di base
//   y = quota sopra il terreno
//   v = coordinata di texture lungo il profilo
// Ogni SEGMENTO fra due punti diventa una striscia continua lungo l'anello, con
// vertici propri: le normali restano lisce lungo la corsa e nette sugli spigoli
// (gli scalini dei palchi devono avere lo spigolo vivo, non sfumato).
// `mat` sul punto i = materiale del segmento i→i+1; `salta: true` = buco (per
// tornare indietro nel profilo senza disegnare la faccia).
// ══════════════════════════════════════════════════════════════════════════════
function spazza(staz, profilo, materiali, { uScala = 1, chiudi = true, varchi = null, soloTra = null } = {}) {
  const giro = staz.giro || (staz[staz.length - 1].cum + 1);
  const fuoriZona = (st) => dentroVarchi(st.cum, varchi, giro)
    || (soloTra && !dentroVarchi(st.cum, soloTra, giro));
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  const gruppi = [];
  const N = chiudi ? staz.length : staz.length;

  for (let seg = 0; seg < profilo.length - 1; seg += 1) {
    const a = profilo[seg];
    const b = profilo[seg + 1];
    if (a.salta) continue;
    const inizio = idx.length;
    const base = pos.length / 3;
    for (let i = 0; i < N; i += 1) {
      const st = staz[i];
      const u = st.s / uScala;
      [a, b].forEach((pt) => {
        pos.push(
          st.p.x + st.fuori.x * pt.d,
          st.p.y + pt.y,
          st.p.z + st.fuori.z * pt.d
        );
        uv.push(u, pt.v);
      });
    }
    for (let i = 0; i < N - 1; i += 1) {
      if (fuoriZona(staz[i]) || fuoriZona(staz[(i + 1) % staz.length])) continue;
      const k = base + i * 2;
      idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
    gruppi.push({ start: inizio, count: idx.length - inizio, mat: a.mat || 0 });
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  gruppi.forEach((g) => geo.addGroup(g.start, g.count, g.mat));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materiali);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. TEXTURE
// ══════════════════════════════════════════════════════════════════════════════

function tela(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, x: c.getContext("2d") };
}
function finisci(c, ripetiX, ripetiY) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(ripetiX || 1, ripetiY || 1);
  return t;
}
function rumore(x, w, h, forza, colore = "0,0,0") {
  for (let i = 0; i < w * h * 0.045; i += 1) {
    x.fillStyle = `rgba(${colore},${Math.random() * forza})`;
    x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random());
  }
}

// ── Venatura di finto marmo dentro un rettangolo ─────────────────────────────
function finteVene(x, rx, ry, rw, rh, base, vena) {
  x.save();
  x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
  x.fillStyle = base; x.fillRect(rx, ry, rw, rh);
  for (let i = 0; i < 14; i += 1) {
    x.strokeStyle = vena;
    x.globalAlpha = 0.18 + Math.random() * 0.3;
    x.lineWidth = 0.6 + Math.random() * 2.2;
    x.beginPath();
    let px = rx - 4 + Math.random() * rw;
    let py = ry + Math.random() * rh;
    x.moveTo(px, py);
    for (let k = 0; k < 5; k += 1) {
      px += rw * (0.12 + Math.random() * 0.2);
      py += (Math.random() - 0.5) * rh * 0.5;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  x.globalAlpha = 1;
  x.restore();
}

// ── Rosone quadrilobato (il motivo più ricorrente sui pannelli) ──────────────
function quadrilobo(x, cx, cy, r, riemp, bordo) {
  const l = r * 0.58;
  x.beginPath();
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
    const ax = cx + dx * l * 0.72, ay = cy + dy * l * 0.72;
    x.moveTo(ax + l, ay);
    x.arc(ax, ay, l, 0, TAU);
  });
  x.fillStyle = riemp; x.fill();
  x.lineWidth = r * 0.1; x.strokeStyle = bordo; x.stroke();
  // Bottone centrale e quattro perle negli sguanci: è così che sono dipinti.
  x.beginPath(); x.arc(cx, cy, r * 0.26, 0, TAU);
  x.fillStyle = bordo; x.fill();
  x.beginPath(); x.arc(cx, cy, r * 0.12, 0, TAU);
  x.fillStyle = riemp; x.fill();
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
    x.beginPath();
    x.arc(cx + dx * l * 0.95, cy + dy * l * 0.95, r * 0.08, 0, TAU);
    x.fillStyle = bordo; x.fill();
  });
}

// ── Bordura a dentelli (la fascia decorata sopra e sotto i pannelli) ─────────
function dentelli(x, y, w, h, passo, a, b) {
  for (let px = 0; px < w; px += passo) {
    x.fillStyle = ((px / passo) | 0) % 2 ? a : b;
    x.fillRect(px, y, passo * 0.62, h);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// La PALANCATA DIPINTA. Un pannello per riquadro di texture; quattro riquadri
// per giro di canvas, così lungo l'anello i motivi non si ripetono a pettine.
// `onEmblema(ctx, cx, cy, r, i)` (opzionale) permette di dipingere lo stemma
// vero di una contrada dentro lo scudo ovale, come fa il giubbetto dei fantini.
// ══════════════════════════════════════════════════════════════════════════════
export function texturaPalancata({ risoluzione = 1024, pannelli = 4, onEmblema = null } = {}) {
  const W = risoluzione * pannelli;
  const H = Math.round(risoluzione * 0.5);   // pannello 2:1 come in piazza
  const { c, x } = tela(W, H);
  const P = risoluzione;

  for (let i = 0; i < pannelli; i += 1) {
    const x0 = i * P;
    // Fondo verde salvia, sporcato: il legno dipinto non è mai piatto.
    x.fillStyle = COL.salvia;
    x.fillRect(x0, 0, P, H);
    for (let k = 0; k < 26; k += 1) {
      const g = x.createRadialGradient(
        x0 + Math.random() * P, Math.random() * H, 0,
        x0 + Math.random() * P, Math.random() * H, P * (0.06 + Math.random() * 0.18)
      );
      const scuro = Math.random() < 0.5;
      g.addColorStop(0, scuro ? "rgba(70,78,48,0.16)" : "rgba(226,224,190,0.16)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(x0, 0, P, H);
    }

    // Cornice: fascia crema in alto e in basso con dentelli rossi/verdi.
    const bordo = H * 0.11;
    x.fillStyle = COL.crema;
    x.fillRect(x0, 0, P, bordo);
    x.fillRect(x0, H - bordo * 1.25, P, bordo * 1.25);
    x.save(); x.beginPath(); x.rect(x0, 0, P, H); x.clip();
    dentelli(x, bordo * 0.26, W, bordo * 0.42, P * 0.045, COL.rossoDec, COL.verdeDec);
    dentelli(x, H - bordo * 0.72, W, bordo * 0.42, P * 0.045, COL.verdeDec, COL.rossoDec);
    x.restore();
    x.strokeStyle = COL.salviaScuro; x.lineWidth = P * 0.008;
    x.strokeRect(x0 + P * 0.004, bordo, P - P * 0.008, H - bordo * 2.25);

    // Montanti chiari ai lati: incorniciano il pannello anche in verticale.
    x.fillStyle = COL.crema;
    x.fillRect(x0, bordo, P * 0.032, H - bordo * 2.25);
    x.fillRect(x0 + P - P * 0.032, bordo, P * 0.032, H - bordo * 2.25);

    // Riquadro interno filettato d'ocra, con quadrotti agli angoli.
    const rx = x0 + P * 0.052, ry = bordo + H * 0.055;
    const rw = P * 0.896, rh = H - bordo * 2.25 - H * 0.115;
    x.strokeStyle = COL.ocra; x.lineWidth = P * 0.011;
    x.strokeRect(rx, ry, rw, rh);
    x.fillStyle = COL.ocra;
    [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([qx, qy]) => {
      x.fillRect(qx - P * 0.018, qy - P * 0.018, P * 0.036, P * 0.036);
    });

    // Motivo centrale: si alternano finto marmo, rosone e scudo ovale.
    const cx = x0 + P * 0.5, cy = ry + rh * 0.5;
    const variante = i % 3;
    if (variante === 0) {
      const mw = rw * 0.62, mh = rh * 0.8;
      finteVene(x, cx - mw / 2, cy - mh / 2, mw, mh, COL.marmoRosso, "#e8c3bd");
      x.strokeStyle = COL.crema; x.lineWidth = P * 0.012;
      x.strokeRect(cx - mw / 2, cy - mh / 2, mw, mh);
      quadrilobo(x, cx, cy, rh * 0.3, COL.crema, COL.verdeDec);
    } else if (variante === 1) {
      const mw = rw * 0.33, mh = rh * 0.84;
      finteVene(x, x0 + P * 0.1, cy - mh / 2, mw, mh, COL.marmoGrigio, "#dfe6ec");
      finteVene(x, x0 + P * 0.9 - mw, cy - mh / 2, mw, mh, COL.marmoGrigio, "#dfe6ec");
      quadrilobo(x, cx, cy, rh * 0.42, COL.marmoRosso, COL.crema);
    } else {
      const mw = rw * 0.66, mh = rh * 0.86;
      finteVene(x, cx - mw / 2, cy - mh / 2, mw, mh, COL.marmoGrigio, "#e4eaf0");
      x.strokeStyle = COL.crema; x.lineWidth = P * 0.012;
      x.strokeRect(cx - mw / 2, cy - mh / 2, mw, mh);
      // Scudo ovale: di suo è crema liscio, ma il gioco può dipingerci lo stemma.
      x.save();
      x.beginPath();
      x.ellipse(cx, cy, rh * 0.3, rh * 0.4, 0, 0, TAU);
      x.fillStyle = COL.avorio; x.fill();
      x.lineWidth = P * 0.014; x.strokeStyle = COL.ocra; x.stroke();
      x.restore();
      if (onEmblema) {
        x.save();
        x.beginPath();
        x.ellipse(cx, cy, rh * 0.28, rh * 0.38, 0, 0, TAU);
        x.clip();
        onEmblema(x, cx, cy, rh * 0.38, i);
        x.restore();
      }
    }

    // Ogni tavolato ha preso il sole in modo diverso: velatura per pannello.
    const vel = ((i * 37) % 5) / 4;
    x.fillStyle = `rgba(${vel < 0.5 ? "236,228,190" : "84,92,58"},${0.05 + vel * 0.07})`;
    x.fillRect(x0, 0, P, H);

    // Cucitura fra un pannello e l'altro + cerniere.
    x.fillStyle = "rgba(48,44,30,0.55)";
    x.fillRect(x0, 0, P * 0.012, H);
    x.fillStyle = "rgba(40,36,28,0.5)";
    x.fillRect(x0 - P * 0.01, H * 0.24, P * 0.03, H * 0.06);
    x.fillRect(x0 - P * 0.01, H * 0.7, P * 0.03, H * 0.06);
  }

  // Polvere di tufo che risale dal basso: sta sempre lì, in gara.
  const polvere = x.createLinearGradient(0, H, 0, H * 0.74);
  polvere.addColorStop(0, "rgba(214,182,120,0.38)");
  polvere.addColorStop(1, "rgba(214,182,120,0)");
  x.fillStyle = polvere;
  x.fillRect(0, H * 0.74, W, H * 0.26);
  rumore(x, W, H, 0.05);
  return finisci(c, 1, 1);
}

// ── Legno dei palchi: assi lunghe, venatura, chiodi, consumo ─────────────────
export function texturaLegno({ risoluzione = 512, tinta = "#6b4430" } = {}) {
  const W = risoluzione, H = Math.round(risoluzione * 0.5);
  const { c, x } = tela(W, H);
  x.fillStyle = tinta; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 5; i += 1) {   // assi affiancate
    const y = (i / 5) * H;
    x.fillStyle = `rgba(255,240,220,${0.02 + Math.random() * 0.05})`;
    x.fillRect(0, y, W, H / 5 - 1);
    x.fillStyle = "rgba(28,18,12,0.5)";
    x.fillRect(0, y + H / 5 - 1.5, W, 1.5);
  }
  for (let i = 0; i < 260; i += 1) {   // venatura
    const y = Math.random() * H;
    x.strokeStyle = `rgba(${Math.random() < 0.5 ? "34,20,12" : "196,160,124"},${0.05 + Math.random() * 0.12})`;
    x.lineWidth = 0.6 + Math.random() * 1.4;
    x.beginPath();
    x.moveTo(Math.random() * W, y);
    x.bezierCurveTo(W * 0.3, y + (Math.random() - 0.5) * 6, W * 0.6, y + (Math.random() - 0.5) * 6, W, y + (Math.random() - 0.5) * 4);
    x.stroke();
  }
  for (let i = 0; i < 22; i += 1) {   // chiodi
    x.fillStyle = "rgba(30,26,22,0.55)";
    x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 1.6 + Math.random(), 0, TAU); x.fill();
  }
  rumore(x, W, H, 0.07);
  return finisci(c, 1, 1);
}

// ── Legno chiaro verniciato della staccionata interna ────────────────────────
export function texturaLegnoChiaro({ risoluzione = 256 } = {}) {
  const W = risoluzione, H = risoluzione;
  const { c, x } = tela(W, H);
  x.fillStyle = "#e3dac1"; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i += 1) {
    x.strokeStyle = `rgba(${Math.random() < 0.6 ? "150,136,108" : "255,252,240"},${0.06 + Math.random() * 0.12})`;
    x.lineWidth = 0.7 + Math.random();
    x.beginPath();
    const y = Math.random() * H;
    x.moveTo(0, y); x.lineTo(W, y + (Math.random() - 0.5) * 5);
    x.stroke();
  }
  // Sbeccature e polvere in basso, come sui colonnini veri.
  const g = x.createLinearGradient(0, H, 0, H * 0.6);
  g.addColorStop(0, "rgba(190,160,104,0.5)");
  g.addColorStop(1, "rgba(190,160,104,0)");
  x.fillStyle = g; x.fillRect(0, H * 0.6, W, H * 0.4);
  rumore(x, W, H, 0.05);
  return finisci(c, 1, 1);
}

// ── Travertino dei pilastrini ────────────────────────────────────────────────
export function texturaTravertino({ risoluzione = 256 } = {}) {
  const W = risoluzione, H = risoluzione;
  const { c, x } = tela(W, H);
  x.fillStyle = "#e8e1cf"; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i += 1) {
    const g = x.createRadialGradient(Math.random() * W, Math.random() * H, 0, Math.random() * W, Math.random() * H, W * 0.2);
    g.addColorStop(0, Math.random() < 0.5 ? "rgba(150,138,112,0.16)" : "rgba(255,253,244,0.2)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 120; i += 1) {   // i pori orizzontali del travertino
    x.fillStyle = `rgba(140,126,100,${0.06 + Math.random() * 0.14})`;
    x.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 12, 1 + Math.random() * 1.6);
  }
  rumore(x, W, H, 0.05);
  return finisci(c, 1, 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. COSTRUTTORI
// ══════════════════════════════════════════════════════════════════════════════

// Punti equidistanti lungo una linea di stazioni (per pilastrini, stecche,
// scalette, spettatori): la spaziatura è sulla LINEA della barriera, quindi
// resta costante anche dove la pista si svasa o si stringe.
function passiRegolari(staz, passo, { varchi = null, soloTra = null } = {}) {
  const tot = staz[staz.length - 1].s;
  const giro = staz.giro || (staz[staz.length - 1].cum + 1);
  const out = [];
  let k = 0;
  for (let d = 0; d < tot - passo * 0.5; d += passo) {
    while (k < staz.length - 2 && staz[k + 1].s < d) k += 1;
    const a = staz[k], b = staz[k + 1];
    const t = (d - a.s) / Math.max(1e-6, b.s - a.s);
    const cum = a.cum + (b.cum - a.cum) * t;
    if (dentroVarchi(cum, varchi, giro)) continue;
    if (soloTra && !dentroVarchi(cum, soloTra, giro)) continue;
    const p = a.p.clone().lerp(b.p, t);
    const fuori = a.fuori.clone().lerp(b.fuori, t).normalize();
    out.push({ p, fuori, yaw: Math.atan2(fuori.x, fuori.z), s: d, cum });
  }
  return out;
}

function istanze(geo, mat, n) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.castShadow = true;
  im.receiveShadow = true;
  im.count = 0;
  return im;
}

function opaco(par) {
  // Lezione dei fantini: materiali sempre espliciti e a due facce, altrimenti
  // le superfici spazzate mostrano il retro trasparente da certe angolazioni.
  return new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: false, opacity: 1, ...par });
}

// ── LA PALANCATA DIPINTA (lato palchi) ───────────────────────────────────────
export function costruisciSteccatoEsterno(ctx, opz = {}) {
  const H = opz.altezza ?? MIS.estAltezza;
  const SP = opz.spessore ?? MIS.estSpessore;
  const g = new THREE.Group();
  g.name = "SteccatoEsterno";

  const dipinto = opaco({
    map: opz.texturaPalancata || texturaPalancata({ risoluzione: opz.risoluzione || 1024 }),
    roughness: 0.82, metalness: 0
  });
  dipinto.map.repeat.set(1, 1);
  const legno = opaco({ map: opz.texturaLegno || texturaLegno(), color: 0xffffff, roughness: 0.8 });
  const retro = opaco({ color: 0x7d855e, roughness: 0.88 });

  const staz = stazioni(ctx, { lato: "esterno", extra: opz.sporgenza ?? MIS.estSporgenza, passo: opz.passo || 3 });
  const zone = { varchi: opz.varchi || null, soloTra: opz.soloTra || null };

  // Corpo: faccia dipinta verso la pista, cappello e retro lisci.
  const corpo = spazza(staz, [
    { d: 0, y: 0, v: 0, mat: 0 },
    { d: 0, y: H, v: 1, mat: 1 },
    { d: SP, y: H, v: 1, mat: 2 },
    { d: SP, y: 0, v: 0 }
  ], [dipinto, legno, retro], { uScala: opz.pannello ?? MIS.estPannello, ...zone });
  g.add(corpo);

  // Corrimano di legno scuro che corre in cima, un filo a sbalzo sui due lati.
  const c = opz.corrimano ?? MIS.estCorrimano;
  const rail = spazza(staz, [
    { d: -0.05, y: H, v: 0, mat: 0 },
    { d: -0.05, y: H + c, v: 0.25, mat: 0 },
    { d: SP + 0.05, y: H + c, v: 0.6, mat: 0 },
    { d: SP + 0.05, y: H, v: 0.85, mat: 0 },
    { d: -0.05, y: H, v: 1 }
  ], [legno], { uScala: 2.2, ...zone });
  g.add(rail);

  return g;
}

// ── IL COLONNINO: pilastrini di travertino + staccionata chiara (lato Campo) ──
export function costruisciSteccatoInterno(ctx, opz = {}) {
  const H = opz.altezza ?? MIS.intAltezza;
  const g = new THREE.Group();
  g.name = "SteccatoInterno";

  const legnoChiaro = opaco({ map: opz.texturaLegnoChiaro || texturaLegnoChiaro(), color: 0xffffff, roughness: 0.84 });
  const pietra = opaco({ map: opz.texturaTravertino || texturaTravertino(), color: 0xffffff, roughness: 0.72 });

  const staz = stazioni(ctx, { lato: "interno", extra: opz.sporgenza ?? MIS.intSporgenza, passo: opz.passo || 3 });
  const zone = { varchi: opz.varchi || null, soloTra: opz.soloTra || null };

  // Due correnti orizzontali: quello alto fa da corrimano, quello basso tiene
  // le stecche. Sezione piatta, come le assi vere.
  const corrente = (y, h, sp) => spazza(staz, [
    { d: -sp / 2, y, v: 0, mat: 0 },
    { d: -sp / 2, y: y + h, v: 0.3, mat: 0 },
    { d: sp / 2, y: y + h, v: 0.6, mat: 0 },
    { d: sp / 2, y, v: 0.9, mat: 0 },
    { d: -sp / 2, y, v: 1 }
  ], [legnoChiaro], { uScala: 2.4, ...zone });
  g.add(corrente(H - 0.13, 0.13, 0.11));
  g.add(corrente(H * 0.42, 0.10, 0.09));

  // Stecche verticali fitte fra un pilastrino e l'altro.
  const stecche = passiRegolari(staz, opz.stecca ?? MIS.intStecca, zone);
  const imS = istanze(new THREE.BoxGeometry(0.085, H - 0.1, 0.045), legnoChiaro, stecche.length);
  const dummy = new THREE.Object3D();
  let n = 0;
  stecche.forEach((q) => {
    dummy.position.set(q.p.x, q.p.y + (H - 0.1) * 0.5, q.p.z);
    dummy.rotation.set(0, q.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    imS.setMatrixAt(n, dummy.matrix);
    n += 1;
  });
  imS.count = n;
  imS.instanceMatrix.needsUpdate = true;
  g.add(imS);

  // Pilastrini di travertino: fusto + cappello leggermente aggettante.
  const pil = passiRegolari(staz, opz.passoPilastri ?? MIS.intPasso, zone);
  const L = opz.pilastro ?? MIS.intPilastro;
  const imP = istanze(new THREE.BoxGeometry(L, H + 0.12, L), pietra, pil.length);
  const imC = istanze(new THREE.BoxGeometry(L * 1.12, 0.075, L * 1.12), pietra, pil.length);
  let m = 0;
  pil.forEach((q) => {
    dummy.position.set(q.p.x, q.p.y + (H + 0.12) * 0.5, q.p.z);
    dummy.rotation.set(0, q.yaw, 0);
    dummy.updateMatrix();
    imP.setMatrixAt(m, dummy.matrix);
    dummy.position.y = q.p.y + H + 0.12;
    dummy.updateMatrix();
    imC.setMatrixAt(m, dummy.matrix);
    m += 1;
  });
  imP.count = m; imC.count = m;
  imP.instanceMatrix.needsUpdate = true;
  imC.instanceMatrix.needsUpdate = true;
  g.add(imP, imC);

  return g;
}

// ── I PALCHI: gradinate di legno addossate ai palazzi ────────────────────────
// Ritorna { gruppo, posti } — `posti` sono le sedute (posizione + verso) su cui
// il gioco (o costruisciPubblicoPalchi) mette gli spettatori.
export function costruisciPalchi(ctx, opz = {}) {
  const file = opz.file ?? MIS.palcoFile;
  const pedata = opz.pedata ?? MIS.palcoPedata;
  const alzata = opz.alzata ?? MIS.palcoAlzata;
  const base = opz.base ?? MIS.palcoBase;
  const g = new THREE.Group();
  g.name = "Palchi";

  const legno = opaco({ map: opz.texturaLegno || texturaLegno(), color: 0xffffff, roughness: 0.85 });
  const legnoScuro = opaco({ map: opz.texturaLegno || texturaLegno(), color: 0x9a8074, roughness: 0.9 });
  const sotto = opaco({ map: opz.texturaLegno || texturaLegno(), color: 0x4a3a30, roughness: 0.95 });

  const staz = stazioni(ctx, { lato: "esterno", extra: opz.fronte ?? MIS.palcoFronte, passo: opz.passo || 3 });
  const zone = { varchi: opz.varchi || null, soloTra: opz.soloTra || null };

  // Profilo a scalinata: zoccolo cieco, poi pedata/alzata per ogni fila.
  const prof = [];
  let v = 0;
  const punto = (d, y, mat) => { prof.push({ d, y, v, mat }); };
  punto(0, 0, 2);                       // zoccolo scuro sotto la prima panca
  v += base / 0.7; punto(0, base, 0);
  let d = 0, y = base;
  for (let r = 0; r < file; r += 1) {
    d += pedata; v += pedata / 0.7; punto(d, y, 1);          // pedata (panca)
    y += alzata; v += alzata / 0.7; punto(d, y, r === file - 1 ? 2 : 0);   // alzata
  }
  v += 0.6; punto(d + 0.25, y, 2);      // spallina in cima
  v += (y) / 0.7; punto(d + 0.25, 0);   // chiusura sul retro (verso i palazzi)

  g.add(spazza(staz, prof, [legno, legnoScuro, sotto], { uScala: 2.2, ...zone }));

  // Scalette di servizio appoggiate alla gradinata, come in piazza.
  const passoScala = opz.scalaOgni ?? MIS.palcoScalaOgni;
  const scale = passiRegolari(staz, passoScala, zone);
  const dTop = d + 0.1, yTop = y;
  const dBot = 0.15, yBot = 0.05;
  const Ldd = dTop - dBot, Lyy = yTop - yBot;
  const Lung = Math.hypot(Ldd, Lyy);
  const theta = Math.atan2(Ldd, Lyy);
  const imRail = istanze(new THREE.BoxGeometry(0.075, Lung, 0.075), legnoScuro, scale.length * 2);
  const RUNG = 9;
  const imRung = istanze(new THREE.BoxGeometry(0.46, 0.05, 0.05), legnoScuro, scale.length * RUNG);
  const dummy = new THREE.Object3D();
  const asseX = new THREE.Vector3(1, 0, 0);
  let a = 0, b = 0;
  scale.forEach((q) => {
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, q.yaw, 0))
      .multiply(new THREE.Quaternion().setFromAxisAngle(asseX, theta));
    const tang = new THREE.Vector3(q.fuori.z, 0, -q.fuori.x);   // lungo l'anello
    const mezzo = q.p.clone()
      .addScaledVector(q.fuori, (dBot + dTop) * 0.5)
      .setY(q.p.y + (yBot + yTop) * 0.5);
    [-0.23, 0.23].forEach((off) => {
      dummy.position.copy(mezzo).addScaledVector(tang, off);
      dummy.quaternion.copy(quat);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      imRail.setMatrixAt(a, dummy.matrix); a += 1;
    });
    for (let k = 0; k < RUNG; k += 1) {
      const t = (k + 0.5) / RUNG;
      dummy.position.copy(q.p)
        .addScaledVector(q.fuori, dBot + Ldd * t)
        .setY(q.p.y + yBot + Lyy * t);
      dummy.quaternion.copy(quat);
      dummy.updateMatrix();
      imRung.setMatrixAt(b, dummy.matrix); b += 1;
    }
  });
  imRail.count = a; imRung.count = b;
  imRail.instanceMatrix.needsUpdate = true;
  imRung.instanceMatrix.needsUpdate = true;
  g.add(imRail, imRung);

  // Ringhiera sul fronte della gradinata: nelle foto spunta sopra la palancata
  // dipinta ed è il dettaglio che dice "palco" a colpo d'occhio.
  if (opz.ringhiera !== false) {
    const yR = base + 0.52;
    const corr = (y, h) => spazza(staz, [
      { d: 0.02, y, v: 0, mat: 0 },
      { d: 0.02, y: y + h, v: 0.3, mat: 0 },
      { d: 0.14, y: y + h, v: 0.6, mat: 0 },
      { d: 0.14, y, v: 0.9, mat: 0 },
      { d: 0.02, y, v: 1 }
    ], [legnoScuro], { uScala: 2.2, ...zone });
    g.add(corr(yR, 0.11), corr(base + 0.2, 0.08));
    const monta = passiRegolari(staz, 2.2, zone);
    const imM = istanze(new THREE.BoxGeometry(0.09, 0.66, 0.09), legnoScuro, monta.length);
    const d2 = new THREE.Object3D();
    let k2 = 0;
    monta.forEach((q) => {
      d2.position.copy(q.p).addScaledVector(q.fuori, 0.08);
      d2.position.y = q.p.y + base + 0.30;
      d2.rotation.set(0, q.yaw, 0);
      d2.updateMatrix();
      imM.setMatrixAt(k2, d2.matrix); k2 += 1;
    });
    imM.count = k2;
    imM.instanceMatrix.needsUpdate = true;
    g.add(imM);
  }

  // Sedute: la folla vera è fitta, spalla a spalla.
  const posti = [];
  const passoPosti = opz.passoPosti ?? 0.44;
  const lungoFila = passiRegolari(staz, passoPosti, zone);
  for (let r = 0; r < file; r += 1) {
    lungoFila.forEach((q, i) => {
      if (((i * 7 + r * 3) % 13) === 0) return;        // qualche posto vuoto
      const gig = (k) => ((Math.sin((i * 3.1 + r * 7.7 + k) * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const dd = pedata * (r + 0.58) + (gig(1) - 0.5) * 0.16;
      const tang = new THREE.Vector3(q.fuori.z, 0, -q.fuori.x);
      const p = q.p.clone()
        .addScaledVector(q.fuori, dd)
        .addScaledVector(tang, (r % 2 ? 0.22 : 0) + (gig(2) - 0.5) * 0.18);
      p.y = q.p.y + base + r * alzata;
      posti.push({ p, yaw: Math.atan2(-q.fuori.x, -q.fuori.z), fila: r, cum: q.cum });
    });
  }
  return { gruppo: g, posti, fondo: d + 0.25, altezza: y };
}

// ── PUBBLICO SUI PALCHI ──────────────────────────────────────────────────────
// Seduti: busto + testa, due sole draw call. Colori spenti come la folla vera
// del gioco (stessa tavolozza di game-3d.js), con qualche macchia di contrada.
// Tinte "di contrada" per i settori delle comparse (blocchi monocolore).
const TINTE_COMPARSE = [0xe0b84a, 0xc44135, 0x2e689b, 0x287b55, 0xf0ece2,
  0xd97e2f, 0x7a1f2b, 0x5aa7c7, 0x8e5aa0, 0x27303a];

export function costruisciPubblicoPalchi(posti, opz = {}) {
  const g = new THREE.Group();
  g.name = "PubblicoPalchi";
  // opz.blocchi = { larghezza }: colore per SETTORE lungo l'anello (cum), non
  // per persona — le comparse di una contrada siedono insieme, vestite uguali.
  const blocchi = opz.blocchi || null;
  const tinte = opz.colori || [
    0xe8e4da, 0xf0ece2, 0xdcd6c8, 0xcfc8ba, 0xe6ddcb,     // bianchi/creme: la maggioranza
    0x9aa2ab, 0xb8a890, 0xa89a86, 0x8a8478, 0x736d63,     // grigi e beige
    0x55606b, 0x40484f, 0x6b4a3a, 0x84725c,               // scuri
    0xc44135, 0x2e689b, 0x287b55, 0xe0b84a, 0xb85a8c      // macchie di colore
  ];
  const pelle = [0xd8ac86, 0xc59468, 0xe3c19c, 0xa87b52, 0x8a5f3c];
  const busto = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.125, 0.26, 2, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    posti.length
  );
  const testa = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.095, 7, 5),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    posti.length
  );
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const rnd = (i, k) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  posti.forEach((s, i) => {
    const alt = 0.84 + rnd(i, 1) * 0.3;
    dummy.position.set(s.p.x, s.p.y + 0.26 * alt, s.p.z);
    dummy.rotation.set(0, s.yaw + (rnd(i, 2) - 0.5) * 0.6, 0);
    dummy.scale.set(1, alt, 1);
    dummy.updateMatrix();
    busto.setMatrixAt(i, dummy.matrix);
    if (blocchi && s.cum != null) {
      const settore = Math.floor(s.cum / (blocchi.larghezza || 4.6));
      const tintaSettore = TINTE_COMPARSE[((settore * 7) % TINTE_COMPARSE.length + TINTE_COMPARSE.length) % TINTE_COMPARSE.length];
      // Un po' di gente "normale" in mezzo (accompagnatori): il blocco respira.
      col.setHex(rnd(i, 9) < 0.14 ? tinte[Math.floor(rnd(i, 3) * tinte.length) % tinte.length] : tintaSettore);
      col.multiplyScalar(0.82 + rnd(i, 4) * 0.3);
    } else {
      col.setHex(tinte[Math.floor(rnd(i, 3) * tinte.length) % tinte.length]);
      col.multiplyScalar(0.72 + rnd(i, 4) * 0.5);
    }
    busto.setColorAt(i, col);

    dummy.position.y = s.p.y + 0.26 * alt + 0.25 * alt + 0.055;
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    testa.setMatrixAt(i, dummy.matrix);
    col.setHex(pelle[Math.floor(rnd(i, 5) * pelle.length) % pelle.length]);
    col.multiplyScalar(0.85 + rnd(i, 6) * 0.3);
    testa.setColorAt(i, col);
  });
  [busto, testa].forEach((im) => {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = false;
    g.add(im);
  });
  return g;
}

// ── TUTTO INSIEME ────────────────────────────────────────────────────────────
// opz.mossa  = { da, a } in cum: lì la palancata NON si costruisce (il corridoio
//              della rincorsa e i canapi devono restare liberi).
// opz.palazzo = { cum } (centro del rettilineo del Palazzo, da getStraightCenterP):
//              sul fronte del Palazzo (facciata a bordo+3.2) i palchi normali da
//              8 file lasciano il posto ai PALCHI DELLE COMPARSE (4 file, che
//              finiscono esatti sulla facciata), con i varchi della CAPPELLA DI
//              PIAZZA e dell'ENTRONE, costruiti qui. La palancata resta continua.
export function costruisciPiazza(ctx, opz = {}) {
  const g = new THREE.Group();
  g.name = "ScenografiaPiazza";
  // Texture condivise: una sola volta per scena, non una per pezzo.
  const cond = {
    texturaLegno: opz.texturaLegno || texturaLegno(),
    texturaLegnoChiaro: opz.texturaLegnoChiaro || texturaLegnoChiaro(),
    texturaTravertino: opz.texturaTravertino || texturaTravertino(),
    texturaPalancata: opz.texturaPalancata || texturaPalancata({ risoluzione: opz.risoluzione || 1024, onEmblema: opz.onEmblema || null })
  };

  // Zone del rettilineo del Palazzo, in cum. Il segno di marcia si ricava dal
  // riferimento locale: +x del Palazzo (che nel gioco corre verso la Torre a
  // x=-20.2) può andare nei cum crescenti o decrescenti a seconda del giro.
  let varchiPalchi8 = opz.palchi?.varchi ? [...opz.palchi.varchi] : [];
  let zonaComparse = null;
  let pal = null;
  if (opz.palazzo && opz.palazzo.cum != null) {
    const rif = riferimentoA(ctx, opz.palazzo.cum);
    const inner = rif.fuori.clone().negate();
    const th = Math.atan2(inner.x, inner.z);
    const asseX = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th));
    const segno = asseX.dot(rif.lungo) >= 0 ? 1 : -1;
    const aCum = (x1, x2) => {
      const a = opz.palazzo.cum + segno * x1;
      const b = opz.palazzo.cum + segno * x2;
      return { da: Math.min(a, b), a: Math.max(a, b) };
    };
    pal = {
      tutto: aCum(-24.8, 17.2),                       // dove NON vanno i palchi da 8
      comparse: aCum(-16, 17.2),                      // dove vanno i palchi bassi
      cappella: { span: aCum(-24.5, -16), centro: opz.palazzo.cum + segno * -20.25 },
      entrone: { span: aCum(-15.4, -10.4), centro: opz.palazzo.cum + segno * -12.9 }
    };
    varchiPalchi8.push(pal.tutto);
  }

  const palchi = costruisciPalchi(ctx, { ...opz.palchi, varchi: varchiPalchi8, ...cond });
  g.add(palchi.gruppo);
  let posti = palchi.posti;

  if (pal) {
    const comparse = costruisciPalchi(ctx, {
      file: opz.palazzo.fileComparse ?? 4,
      soloTra: [pal.comparse],
      varchi: [pal.entrone.span],
      scalaOgni: 9,
      ...cond
    });
    comparse.gruppo.name = "PalchiComparse";
    g.add(comparse.gruppo);
    if (opz.pubblico !== false) {
      const pubComparse = costruisciPubblicoPalchi(comparse.posti, { blocchi: { larghezza: 4.6 } });
      pubComparse.name = "PubblicoComparse";
      g.add(pubComparse);
    }
    g.add(costruisciCappella(ctx, { cum: pal.cappella.centro, ...opz.cappella, ...cond }));
    g.add(costruisciEntrone(ctx, { cum: pal.entrone.centro, ...opz.entrone, ...cond }));
  }

  const varchiPalancata = [];
  if (opz.mossa) varchiPalancata.push(opz.mossa);
  if (opz.esterno?.varchi) varchiPalancata.push(...opz.esterno.varchi);
  g.add(costruisciSteccatoEsterno(ctx, { ...opz.esterno, varchi: varchiPalancata.length ? varchiPalancata : null, ...cond }));
  g.add(costruisciSteccatoInterno(ctx, { ...opz.interno, ...cond }));
  if (opz.pubblico !== false) g.add(costruisciPubblicoPalchi(posti, opz.pubblicoOpz || {}));
  return { gruppo: g, posti, palchi, zone: pal };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. IL RETTILINEO DEL PALAZZO — cappella, entrone, palchi delle comparse
// ──────────────────────────────────────────────────────────────────────────────
// Sul rettilineo il Palazzo Pubblico dà direttamente sulla piazza (facciata a
// bordo+3.2 nel gioco): i palchi normali (8 file, fondo 5.31) ci finirebbero
// DENTRO. Lì vanno i palchi bassi delle comparse (4 file: 1.15+4×0.52≈3.2,
// finiscono esatti sulla facciata), e le gradinate si interrompono per la
// CAPPELLA DI PIAZZA (il tabernacolo di marmo ai piedi della Torre) e per
// l'ENTRONE (il portale da cui i cavalli entrano). La palancata dipinta invece
// corre CONTINUA anche davanti a cappella ed entrone, come nelle foto.
// ══════════════════════════════════════════════════════════════════════════════

// Riferimento locale sul bordo esterno a un dato cum: origine sul bordo pista,
// `fuori` verso i palazzi, `lungo` nel verso dei cum crescenti.
function riferimentoA(ctx, cum) {
  const camp = ctx.campioni;
  const giro = camp[camp.length - 1].cum + (camp[1].cum - camp[0].cum);
  const c = ((cum % giro) + giro) % giro;
  let migliore = camp[0], dist = Infinity;
  camp.forEach((s0) => { const d = Math.abs(s0.cum - c); if (d < dist) { dist = d; migliore = s0; } });
  const i = camp.indexOf(migliore);
  const prev = camp[(i - 1 + camp.length) % camp.length];
  const next = camp[(i + 1) % camp.length];
  const lungo = next.point.clone().sub(prev.point).setY(0).normalize();
  const radiale = ctx.fuori(migliore.point);
  const fuori = (migliore.normal && migliore.normal.isVector3)
    ? migliore.normal.clone().multiplyScalar(migliore.normal.dot(radiale) >= 0 ? 1 : -1)
    : radiale.clone();
  const bordo = migliore.point.clone().addScaledVector(fuori, ctx.largoEsterno(migliore));
  bordo.y = ctx.quota(migliore);
  return { bordo, fuori, lungo, yaw: Math.atan2(fuori.x, fuori.z), giro };
}

// ── LA CAPPELLA DI PIAZZA ────────────────────────────────────────────────────
// Tabernacolo di marmo bianco: alto basamento, quattro pilastri con le nicchie
// dei santi, archi a tutto sesto, trabeazione con fregio e una volta bassa
// che si appoggia alla facciata. Sta dietro la palancata, che le passa davanti.
export function costruisciCappella(ctx, opz = {}) {
  const rif = riferimentoA(ctx, opz.cum);
  const g = new THREE.Group();
  g.name = "CappellaDiPiazza";
  const marmo = opaco({ map: opz.texturaTravertino || texturaTravertino(), color: 0xf4efe2, roughness: 0.55 });
  const marmoOmbra = opaco({ color: 0xd8d0bc, roughness: 0.7 });
  const buio = opaco({ color: 0x342a1c, roughness: 0.95 });   // ombra calda, non nero assoluto

  const L = opz.larghezza ?? 8.2;      // fronte lungo la pista
  const D = opz.profondita ?? 2.6;     // sporgenza dalla facciata verso la pista
  const HP = opz.altezzaPilastri ?? 5.6;
  const HB = 0.9;                      // basamento
  const daBordo = opz.daBordo ?? 0.55; // il fronte sta appena dietro la palancata

  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Coordinate locali: x lungo la pista, z verso la pista (fronte a z = 0).
  // Basamento pieno con gradino.
  box(L, HB, D, marmo, 0, HB / 2, -D / 2);
  box(L + 0.4, 0.22, D + 0.3, marmoOmbra, 0, 0.11, -D / 2);
  // Quattro pilastri sul fronte, con nicchia scura e cornicetta.
  const xs = [-L / 2 + 0.45, -L / 6, L / 6, L / 2 - 0.45];
  xs.forEach((x) => {
    box(0.9, HP, 0.9, marmo, x, HB + HP / 2, -0.45);
    box(0.44, 1.1, 0.12, opaco({ color: 0x4a4034, roughness: 0.9 }), x, HB + HP * 0.62, 0.02);   // nicchia
    box(0.56, 0.14, 0.16, marmoOmbra, x, HB + HP * 0.62 + 0.62, 0.03);
    box(0.26, 0.62, 0.1, opaco({ color: 0xbfb49c, roughness: 0.8 }), x, HB + HP * 0.60, 0.05);    // il "santo"
  });
  // Pilastri posteriori (contro la facciata) e volta bassa.
  [-L / 2 + 0.45, L / 2 - 0.45].forEach((x) => box(0.7, HP, 0.7, marmo, x, HB + HP / 2, -D + 0.35));
  // Trabeazione + fregio + cornice aggettante.
  box(L + 0.5, 0.55, D + 0.5, marmo, 0, HB + HP + 0.27, -D / 2);
  box(L + 0.2, 0.35, D + 0.2, marmoOmbra, 0, HB + HP + 0.72, -D / 2);
  box(L + 0.8, 0.28, D + 0.8, marmo, 0, HB + HP + 1.02, -D / 2);
  // Balaustrina in cima (colonnine).
  for (let x = -L / 2 + 0.3; x <= L / 2 - 0.3; x += 0.55) {
    box(0.14, 0.6, 0.14, marmo, x, HB + HP + 1.46, -0.35);
  }
  box(L + 0.2, 0.14, 0.2, marmo, 0, HB + HP + 1.82, -0.35);
  // Fondo in ombra fra i pilastri (l'interno della cappella).
  box(L - 1.4, HP, 0.15, buio, 0, HB + HP / 2, -D + 0.55);

  g.position.copy(rif.bordo).addScaledVector(rif.fuori, daBordo);
  g.rotation.y = rif.yaw + Math.PI;    // fronte verso la pista
  // NB: l'asse x locale dopo la rotazione corre lungo la pista da sé.
  return g;
}

// ── L'ENTRONE ────────────────────────────────────────────────────────────────
// Il portale del Cortile del Podestà: arco a sesto acuto in pietra, strombo,
// passaggio in ombra profonda e le due ante di legno aperte contro il muro.
// Da qui i cavalli ENTRANO in piazza: il varco nelle gradinate è suo.
export function costruisciEntrone(ctx, opz = {}) {
  const rif = riferimentoA(ctx, opz.cum);
  const g = new THREE.Group();
  g.name = "Entrone";
  const pietra = opaco({ map: opz.texturaTravertino || texturaTravertino(), color: 0xcbb896, roughness: 0.8 });
  const cotto = opaco({ color: 0x8a5a3e, roughness: 0.92 });
  const buio = opaco({ color: 0x160f08, roughness: 1 });
  const legnoAnta = opaco({ map: opz.texturaLegno || texturaLegno({ tinta: "#4a3020" }), color: 0xffffff, roughness: 0.85 });

  // Basso e largo, NON monumentale: le trifore dell'estrazione stanno a y 7.0
  // (vano da 5.65 in su) e un portale alto le copriva — la prima contrada
  // estratta spariva dietro l'arco (segnalato da Simone). Cima totale ≈ 5.3.
  const W = opz.larghezza ?? 3.4;      // luce del portale
  const H = opz.altezza ?? 3.3;        // all'imposta dell'arco
  const daFacciata = opz.daFacciata ?? 3.2;   // il portale sta NEL filo della facciata

  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Coordinate locali: fronte del portale a z = 0 (filo facciata), pista verso +z.
  // Passaggio in ombra (tunnel), più profondo della facciata.
  box(W, H + 1.2, 0.2, buio, 0, (H + 1.2) / 2, -1.6);
  box(W + 1.2, 0.4, 3.2, buio, 0, H + 1.0, -1.4);              // intradosso
  [-1, 1].forEach((sgn) => box(0.4, H + 1.2, 3.2, cotto, sgn * (W / 2 + 0.2), (H + 1.2) / 2, -1.4));
  // Cornice di pietra del portale: stipiti + arco a punta stilizzato.
  [-1, 1].forEach((sgn) => box(0.55, H, 0.5, pietra, sgn * (W / 2 + 0.45), H / 2, 0));
  [-1, 1].forEach((sgn) => {
    const b = box(0.42, 1.9, 0.5, pietra, sgn * W * 0.27, H + 0.7, 0);
    b.rotation.z = sgn * 0.55;
  });
  box(0.85, 0.65, 0.6, pietra, 0, H + 1.45, 0);                // chiave con stemma
  box(0.6, 0.42, 0.12, cotto, 0, H + 1.45, 0.32);              // balzana (mezzo scudo)
  // Ante di legno aperte, accostate al muro dentro il passaggio.
  [-1, 1].forEach((sgn) => box(0.14, H - 0.3, W * 0.52, legnoAnta, sgn * (W / 2 - 0.1), (H - 0.3) / 2, -0.95));

  g.position.copy(rif.bordo).addScaledVector(rif.fuori, daFacciata);
  g.rotation.y = rif.yaw + Math.PI;    // fronte verso la pista
  return g;
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. LA PALIZZATA DEL CASATO
// ──────────────────────────────────────────────────────────────────────────────
// All'uscita del Casato non ci sono materassi: c'è una palizzata di TAVOLONI
// VERTICALI di legno scuro, più alta dello steccato normale, coi puntoni di
// rinforzo sul retro. Sostituisce la striscia di box marroni di game-3d.js.
// ══════════════════════════════════════════════════════════════════════════════
export function texturaPalizzata({ risoluzione = 512 } = {}) {
  const W = risoluzione, H = Math.round(risoluzione * 0.6);
  const { c, x } = tela(W, H);
  x.fillStyle = "#5a3b26";
  x.fillRect(0, 0, W, H);
  const asse = W / 14;                       // tavoloni verticali affiancati
  for (let px = 0; px < W; px += asse) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? "30,18,10" : "150,110,74"},${0.08 + Math.random() * 0.1})`;
    x.fillRect(px + 1, 0, asse - 2, H);
    x.fillStyle = "rgba(20,12,6,0.55)";
    x.fillRect(px, 0, 1.6, H);               // fuga fra i tavoloni
    for (let k = 0; k < 30; k += 1) {        // venatura verticale
      x.strokeStyle = `rgba(${Math.random() < 0.5 ? "36,22,12" : "168,128,88"},${0.05 + Math.random() * 0.1})`;
      x.lineWidth = 0.7 + Math.random();
      x.beginPath();
      const vx = px + 2 + Math.random() * (asse - 4);
      x.moveTo(vx, 0);
      x.bezierCurveTo(vx + (Math.random() - 0.5) * 3, H * 0.33, vx + (Math.random() - 0.5) * 3, H * 0.66, vx + (Math.random() - 0.5) * 2, H);
      x.stroke();
    }
    x.fillStyle = "rgba(24,16,10,0.6)";      // chiodi in alto e in basso
    [H * 0.08, H * 0.9].forEach((ny) => { x.beginPath(); x.arc(px + asse * 0.5, ny, 1.8, 0, TAU); x.fill(); });
  }
  // Polvere di tufo alla base.
  const g = x.createLinearGradient(0, H, 0, H * 0.7);
  g.addColorStop(0, "rgba(206,172,110,0.45)");
  g.addColorStop(1, "rgba(206,172,110,0)");
  x.fillStyle = g;
  x.fillRect(0, H * 0.7, W, H * 0.3);
  rumore(x, W, H, 0.06);
  return finisci(c, 1, 1);
}

export function costruisciPalizzata(ctx, opz = {}) {
  const H = opz.altezza ?? 1.7;
  const SP = 0.09;
  const g = new THREE.Group();
  g.name = "PalizzataCasato";
  const tavole = opaco({ map: opz.texturaPalizzata || texturaPalizzata(), roughness: 0.9 });
  const legnoS = opaco({ color: 0x4a3020, roughness: 0.92 });

  const staz = stazioni(ctx, { lato: "esterno", extra: opz.sporgenza ?? 0.15, passo: opz.passo || 2 });
  const zone = { soloTra: [{ da: opz.da, a: opz.a }], varchi: opz.varchi || null };

  g.add(spazza(staz, [
    { d: 0, y: 0, v: 0, mat: 0 },
    { d: 0, y: H, v: 1, mat: 0 },
    { d: SP, y: H, v: 1, mat: 0 },
    { d: SP, y: 0, v: 0 }
  ], [tavole], { uScala: 3.4, ...zone }));
  // Corrente di colmo e puntoni diagonali sul retro, come i cantieri veri.
  g.add(spazza(staz, [
    { d: -0.03, y: H, v: 0, mat: 0 },
    { d: -0.03, y: H + 0.1, v: 0.3, mat: 0 },
    { d: SP + 0.03, y: H + 0.1, v: 0.7, mat: 0 },
    { d: SP + 0.03, y: H, v: 1 }
  ], [legnoS], { uScala: 2, ...zone }));
  const punti = passiRegolari(staz, 2.1, zone);
  const imP = istanze(new THREE.BoxGeometry(0.1, H * 1.28, 0.1), legnoS, punti.length);
  const d = new THREE.Object3D();
  let n = 0;
  punti.forEach((q) => {
    d.position.copy(q.p).addScaledVector(q.fuori, 0.42);
    d.position.y = q.p.y + H * 0.52;
    d.rotation.set(0, q.yaw, 0);
    d.rotation.x = -0.5;                      // puntone appoggiato alla palizzata
    d.updateMatrix();
    imP.setMatrixAt(n, d.matrix);
    n += 1;
  });
  imP.count = n;
  imP.instanceMatrix.needsUpdate = true;
  g.add(imP);
  return g;
}
