// ══════════════════════════════════════════════════════════════════════════════
// EPOCHE DEL PALIO — i due gruppi con cui si compone una corsa
// ──────────────────────────────────────────────────────────────────────────────
// PALIO STORICO  = dal dopoguerra alla fine del secolo (fino al 2005)
// PALIO MODERNO  = dal 2006 a oggi
// Gli anni sono quelli in cui ciascuno ha davvero corso il Palio, presi
// dall'Archivio (ilpalio.siena.it). I FANTINI DI FANTASIA — quelli che in
// Archivio non esistono — stanno in ENTRAMBI i gruppi: non appartenendo a
// nessuna epoca reale, possono correre in tutte e due.
// ══════════════════════════════════════════════════════════════════════════════

// ── BARBERI ───────────────────────────────────────────────────────────────────
export const BARBERI_STORICI = [
  "Gaudenzia",                // 1952-1960, 15 palii
  "Uberta de Mores",          // 1958-1962, 11 palii
  "Urbino",                   // 1958-1958, 2 palii
  "Topolone",                 // 1962-1972, 17 palii
  "Selvaggia",                // 1963-1968, 9 palii
  "Mirabella",                // 1970-1974, 8 palii
  "Panezio",                  // 1972-1984, 20 palii
  "Quebel",                   // 1974-1979, 11 palii
  "Rimini",                   // 1974-1982, 12 palii
  "Urbino de Ozieri",         // 1977-1979, 4 palii
  "Figaro",                   // 1985-1993, 16 palii
  "Vipera",                   // 1986-1989, 6 palii
  "Galleggiante",             // 1987-1993, 11 palii
  "Pytheos",                  // 1989-1993, 7 palii
  "Uberto",                   // 1989-1994, 7 palii
  "Oriolu de Zamaglia",       // 1993-1996, 5 palii
  "Quarnero",                 // 1994-1997, 6 palii
  "Re Artù",                  // 1995-2000, 9 palii
  "Zodiach",                  // 2001-2006, 10 palii
  "Berio",                    // 2002-2005, 6 palii
];

export const BARBERI_MODERNI = [
  "Fedora Saura",             // 2006-2011, 8 palii
  "Indianos",                 // 2010-2014, 7 palii
  "Mocambo",                  // 2010-2016, 8 palii
  "Oppio",                    // 2013-2019, 6 palii
  "Preziosa Penelope",        // 2015-2016, 3 palii
  "Trattu de Zamaglia",       // 2018-2018, 1 palii
  "Tale e Quale",             // 2018-2025, 3 palii
  "Remorex",                  // 2018-2022, 4 palii
  "Violenta da Clodia",       // 2018-2023, 5 palii
  "Volpino",                  // 2022-2026, 2 palii
  "Arestetulesu",             // 2022-2026, 3 palii
  "Ungaros",                  // 2022-2025, 4 palii
  "Zio Frac",                 // 2022-2025, 5 palii
  "Reo Confesso",             // 2022-2023, 4 palii
  "Viso d'Angelo",            // 2022-2026, 10 palii
  "Zenis",                    // 2023-2025, 4 palii
  "Anda e Bola",              // 2023-2026, 5 palii
  "Comancio",                 // 2024-2025, 2 palii
  "Benitos",                  // 2024-2026, 4 palii
  "Brivido Sardo",            // 2024-2024, 2 palii
  "Diodoro",                  // 2025-2026, 4 palii
];

// ── FANTINI ───────────────────────────────────────────────────────────────────
// Reali, con gli anni di attività verificati in Archivio.
export const FANTINI_STORICI_REALI = [
  "Ganascia",     // Ottavio Bertini, 1930-1953, 36 palii
  "Ciancone",     // Giuseppe Gentili, 1945-1971, 40 palii
  "Vittorino",    // Vittorio Pisani, 1953-1964, 22 palii
  "Aceto",        // Andrea Degortes, 1964-1996, 59 palii — il più corso di sempre
  "Bazzino",      // Silvano Vigni, 1978-1996, 31 palii
  "Il Pesse",     // Salvatore Ladu, 1978-2005, 46 palii
  "Legno",        // Sebastiano Deledda, 1979-1995, 7 palii  (⚠ nel gioco è dato a Leonardo Viti)
  "Falchino",     // Massimo Coghe, 1986-2006, 35 palii
  "Veleno",       // Efisio Melis: fantino STORICO (anni '30-'50), nel gioco sta fra i moderni
  "Canapino",     // Leonardo Viti, 1960-1986, 46 palii (era "Bastiano": corretto nel gioco)
  "Zurlino",      // ⚠ in Archivio Zurlino è Carlo Lotti, e correva nell'Ottocento
];

export const FANTINI_MODERNI_REALI = [
  "Brio",         // Andrea Mari, 2001-2019, 32 palii
  "Gingillo",     // Giuseppe Zedde, 2002-2026, 36 palii
  "Tittìa",       // Giovanni Atzeni, 2003-2026, 43 palii
  "Scompiglio",   // Jonatan Bartoletti, 2007-2026, 34 palii
  "Grandine",     // Sebastiano Murtas, 2012-2026, 16 palii
  "Brigante",     // Carlo Sanna, 2014-2026, 20 palii
  "Bellocchio",   // Enrico Bruschelli, 2014-2026, 11 palii
  "Tempesta",     // Andrea Coghe, 2017-2025, 10 palii
  "Tamurè",       // Federico Guglielmi, 2022-2026, 7 palii
  "Fastidio",     // Diego Minucci, esordio 2026
];

// Di fantasia: nessun riscontro in Archivio → corrono in ENTRAMBE le epoche.
export const FANTINI_FITTIZI = [
  "Grido", "Peto", "Tramonto", "Nespola", "Sbigo", "Il Sordo", "Fedele",
];

export const FANTINI_STORICI = [...FANTINI_STORICI_REALI, ...FANTINI_FITTIZI];
export const FANTINI_MODERNI = [...FANTINI_MODERNI_REALI, ...FANTINI_FITTIZI];

// ── Accesso per gruppo ────────────────────────────────────────────────────────
// gruppo = "storico" | "moderno"
export function barberiDelPalio(gruppo) {
  return gruppo === "storico" ? BARBERI_STORICI.slice() : BARBERI_MODERNI.slice();
}
export function fantiniDelPalio(gruppo) {
  return gruppo === "storico" ? FANTINI_STORICI.slice() : FANTINI_MODERNI.slice();
}
export function eFittizio(nickFantino) {
  return FANTINI_FITTIZI.indexOf(nickFantino) !== -1;
}

// ── SCELTA DEL GIOCATORE ──────────────────────────────────────────────────────
// Il gioco parte sul PALIO MODERNO; il giocatore può passare allo storico dalle
// impostazioni (in basso a sinistra). La scelta si ricorda fra una partita e
// l'altra: è una preferenza, non qualcosa da ri-scegliere ogni volta.
export const PALIO_DEFAULT = "moderno";
const CHIAVE = "palio.epoca";

export function epocaScelta() {
  try {
    const v = localStorage.getItem(CHIAVE);
    return v === "storico" || v === "moderno" ? v : PALIO_DEFAULT;
  } catch (e) { return PALIO_DEFAULT; }   // storage negato (private browsing): default
}

export function impostaEpoca(gruppo) {
  const g = gruppo === "storico" ? "storico" : "moderno";
  try { localStorage.setItem(CHIAVE, g); } catch (e) { /* si prosegue comunque */ }
  return g;
}

// Barberi e fantini dell'epoca attualmente scelta, pronti per la tratta.
export function rosterCorrente() {
  const g = epocaScelta();
  return { epoca: g, barberi: barberiDelPalio(g), fantini: fantiniDelPalio(g) };
}

export const ETICHETTE = {
  storico: { titolo: "Palio storico", sottotitolo: "Dal dopoguerra al 2005" },
  moderno: { titolo: "Palio moderno", sottotitolo: "Dal 2006 a oggi" },
};
