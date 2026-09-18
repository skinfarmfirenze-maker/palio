// ── SPOT FACOLTATIVI ─────────────────────────────────────────────────────────
// Non c'e' nessuna pubblicita' obbligatoria: lo spot lo guarda SOLO chi vuole
// qualcosa in cambio, e lo decide lui premendo un tasto. Tutto quello che si
// ottiene sono DENARI, cioe' la preparazione del palio — niente che renda piu'
// veloce un cavallo in corsa: l'albo delle vittorie e' condiviso fra tutti i
// giocatori e deve continuare a dire chi gioca meglio.
//
// La rete pubblicitaria non e' ancora collegata. Con rete "prova" si vede uno
// spot finto di 15 secondi, che serve a provare tutto il giro: offerta →
// attesa → premio. Quando l'account sara' approvato bastera' cambiare `rete`.

export const PUBBLICITA = {
  attiva: true,
  rete: "prova",          // "prova" = spot finto · "adsense" = H5 Games Ads
  durata: 15,             // secondi (vale solo per lo spot finto)
  maxPerPalio: 2,         // oltre questo i tasti spariscono: non si tampina
};

let __visti = 0;
export function azzeraSpotDelPalio() { __visti = 0; }
export function spotDisponibile() {
  return PUBBLICITA.attiva && __visti < PUBBLICITA.maxPerPalio;
}
export function spotVisti() { return __visti; }

// ── LO SPOT VERO E PROPRIO ──────────────────────────────────────────────────
// `poi(ok)` viene chiamata con true se lo spot e' stato visto fino in fondo.
function riproduci(poi) {
  if (PUBBLICITA.rete === "adsense") {
    // H5 Games Ads: la durata e la skippabilita' le decide Google, noi diciamo
    // solo quando c'e' un buon momento e cosa dare in cambio.
    try {
      if (typeof window.adBreak === "function") {
        window.adBreak({
          type: "reward",
          name: "denari",
          beforeReward: (mostra) => mostra(),
          adDismissed: () => poi(false),
          adViewed: () => poi(true),
          adBreakDone: (p) => { if (p && p.breakStatus !== "viewed") poi(false); },
        });
        return;
      }
    } catch (e) { /* si ripiega sullo spot finto */ }
  }
  spotFinto(poi);
}

// Spot finto: pannello nero, conto alla rovescia, niente uscita. Serve a vedere
// come si sente il gioco con la pubblicita' dentro, prima di collegare la rete.
function spotFinto(poi) {
  const ov = document.createElement("div");
  ov.id = "spotOverlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;"
    + "align-items:center;justify-content:center;gap:16px;background:#07060a;color:#e8e4dc;"
    + "font-family:inherit;text-align:center;padding:24px";
  ov.innerHTML =
    '<div style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.5">Pubblicità</div>'
    + '<div style="font-size:clamp(22px,4vw,34px);font-weight:800;color:#f0cb35">Spot dimostrativo</div>'
    + '<div style="font-size:13px;opacity:.6;max-width:min(420px,88vw);line-height:1.5">'
    + 'Qui andrà lo spot vero quando la rete pubblicitaria sarà collegata.</div>'
    + '<div id="spotConto" style="font-size:clamp(44px,12vw,72px);font-weight:800;'
    + 'font-variant-numeric:tabular-nums;color:#f6e6bd">' + PUBBLICITA.durata + '</div>';
  document.body.appendChild(ov);

  // Il gioco tace mentre passa lo spot, e riprende il volume dopo.
  const audio = [];
  try {
    document.querySelectorAll("audio").forEach((a) => { audio.push([a, a.volume]); a.volume = 0; });
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (e) { /* niente */ }

  let restano = PUBBLICITA.durata;
  const conto = ov.querySelector("#spotConto");
  const t = setInterval(() => {
    restano -= 1;
    if (conto) conto.textContent = Math.max(0, restano);
    if (restano > 0) return;
    clearInterval(t);
    ov.remove();
    try { audio.forEach(([a, v]) => { a.volume = v; }); } catch (e) { /* niente */ }
    poi(true);
  }, 1000);
}

// ── L'OFFERTA ───────────────────────────────────────────────────────────────
// Il tasto che il giocatore vede PRIMA: dice cosa ottiene e quanto dura. Da qui
// si puo' sempre tornare indietro — e' il punto della cosa.
export function offriSpot({ titolo, premio, onPremio, onNiente }) {
  if (!spotDisponibile()) { if (onNiente) onNiente(); return; }
  const vecchio = document.getElementById("spotOfferta");
  if (vecchio) vecchio.remove();
  const ov = document.createElement("div");
  ov.id = "spotOfferta";
  ov.style.cssText = "position:fixed;inset:0;z-index:10040;display:flex;align-items:center;"
    + "justify-content:center;background:rgba(9,6,4,.84);backdrop-filter:blur(3px);padding:18px";
  ov.innerHTML =
    '<div style="width:min(420px,94vw);background:linear-gradient(180deg,#3a2a17 0%,#17110a 78%);'
    + 'border:1px solid rgba(240,203,53,.45);border-radius:16px;padding:22px 24px;text-align:center;'
    + 'color:#f3e7cf;box-shadow:0 18px 50px rgba(0,0,0,.6)">'
    + '<div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#b7ad96;margin-bottom:8px">'
    + PUBBLICITA.durata + ' secondi di pubblicità</div>'
    + '<div style="font-size:19px;font-weight:800;color:#f0cb35;line-height:1.35;margin-bottom:6px">'
    + titolo + '</div>'
    + '<div style="font-size:14px;opacity:.9;margin-bottom:18px">' + premio + '</div>'
    + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'
    + '<button id="spotSi" style="font:inherit;font-size:14px;font-weight:800;padding:11px 22px;border:none;'
    + 'border-radius:10px;background:#f0cb35;color:#2a1d0c;cursor:pointer">Guarda lo spot</button>'
    + '<button id="spotNo" style="font:inherit;font-size:14px;font-weight:700;padding:11px 22px;'
    + 'border:1px solid rgba(240,203,53,.5);border-radius:10px;background:rgba(20,14,8,.7);'
    + 'color:#f3e7cf;cursor:pointer">No, grazie</button>'
    + '</div></div>';
  document.body.appendChild(ov);

  const chiudi = () => { const o = document.getElementById("spotOfferta"); if (o) o.remove(); };
  const no = ov.querySelector("#spotNo");
  if (no) no.addEventListener("click", () => { chiudi(); if (onNiente) onNiente(); });
  const si = ov.querySelector("#spotSi");
  if (si) si.addEventListener("click", () => {
    chiudi();
    riproduci((visto) => {
      if (visto) { __visti += 1; if (onPremio) onPremio(); }
      else if (onNiente) onNiente();
    });
  });
  // Toccare il fondo scuro = no grazie.
  ov.addEventListener("click", (e) => { if (e.target === ov) { chiudi(); if (onNiente) onNiente(); } });
}

// Tastino uniforme "▶ Guarda uno spot": lo usano tutti e quattro i punti.
export function tastoSpot(testo) {
  const b = document.createElement("button");
  b.className = "spot-btn";
  b.type = "button";
  b.textContent = "▶ " + testo;
  b.style.cssText = "font:inherit;font-size:12px;font-weight:800;padding:6px 12px;border-radius:9px;"
    + "border:1px solid rgba(240,203,53,.55);background:rgba(240,203,53,.14);color:#f0cb35;cursor:pointer";
  return b;
}
