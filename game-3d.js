import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
// Addon ufficiali (stessa versione, stesso CDN): risolvono "three" via importmap
// dichiarata in index.html — un'unica istanza del motore.
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/utils/SkeletonUtils.js";
// FANTINI NUOVI (modulo curato dalla chat "fantini"): buildFantino(contrada) costruisce
// il rider procedurale "lofted". Stessa istanza THREE (import "three" via importmap).
import { buildFantino, CONTRADE as CONTRADE_FANTINI } from "./fantino-lab.js";
import { BANDIERE } from "./bandiere-data.js";   // bandiere incorporate: 1 richiesta invece di 17
import { ancoraFronteViva, mantoDi, nascondiSpennacchiera, mostraSpennacchiera, aggiornaComparsa } from "./cavallo-lab.js";
import { costruisciPiazza, costruisciPalizzata, PALCHI_FONDO } from "./piazza-lab.js";   // steccati, palchi, pubblico (chat grafica)
import { costruisciPalazzi } from "./palazzi-lab.js";               // cortina dei palazzi (chat grafica)
// Attivi di DEFAULT (sostituiscono il vecchio fantino); disattivabili con ?fantino2=0.
const USE_FANTINO2 = !/[?&]fantino2=0/.test(window.location.search);
const FANTINO_SCALE = 1.8;      // ingrandimento del fantino (×2 poi −10% → 1.8)
const FANTINO_SEAT_Y = 1.78;    // punto di seduta (dorso): fisso durante il riscalo
const FANTINO_SEAT_Z = 0.20;    // seduta più AVANTI sul cavallo (+Z verso la testa)
const FANTINO_CONTRADE_BY_ID = {};
CONTRADE_FANTINI.forEach((c) => { FANTINO_CONTRADE_BY_ID[c.id] = c; });

const FINISH_LAPS = 3;
// DOPO L'ARRIVO: nessuno si inchioda sulla linea. Si tira dritto per un bel
// tratto e poi si scala, fermandosi fra le 15 e le 60 unità oltre il traguardo —
// ognuno con la sua distanza, come in Piazza dove chi si ferma prima e chi
// prosegue quasi fino ai canapi. E si resta AL GALOPPO fino all'ultimo: il
// cavallo rallenta, non si blocca sul posto.
const ARRIVO_MIN = 15;
const ARRIVO_MAX = 60;
// Quanto prosegue QUESTO cavallo: deciso una volta sola al traguardo, non a ogni
// frame (se no la distanza cambierebbe di continuo e la frenata singhiozzerebbe).
function corsaOltreArrivo(horse) {
  if (horse.arrivoExtra == null) {
    horse.arrivoExtra = ARRIVO_MIN + Math.random() * (ARRIVO_MAX - ARRIVO_MIN);
  }
  return horse.arrivoExtra;
}
// Fattore di velocità dopo il traguardo: pieno sulla linea, zero alla sua
// distanza. La radice tiene l'andatura a lungo e scala solo verso la fine.
function frenataArrivo(horse) {
  if (!horse || !horse.finishTime) return 1;
  const oltre = horse.progress - track.length * FINISH_LAPS;
  const q = clamp(1 - oltre / corsaOltreArrivo(horse), 0, 1);
  return Math.sqrt(q);
}
const TRACK_HALF_WIDTH = 11.5;
// 10,9 dal centro pista: i cavalli corrono più addosso al colonnino di prima
// (era 10,68). Chiesto da Simone dopo la proposta della chat Grafica.
const AI_LANE_LIMIT = TRACK_HALF_WIDTH - 0.6;
const BASE_SPEED_LEVEL = 4.72;
// Moltiplicatore globale di velocità della corsa: 1,5x (richiesta) × 1,2x (per
// rendere davvero difficili le due curve a 90°). Si applica all'AVANZAMENTO, non
// al ritmo di sterzata, così alle alte velocità si va larghi in curva.
// Ripristinato a 1.7 (l'esperimento "gara 90-100s" a 1.05 rendeva la guida
// lenta/diversa coi cavalli GLB): torna la velocità di prova di sempre, ~48-52s.
const RACE_SPEED_MULT = 1.7;
const WORLD_SPEED_PER_LEVEL = 2.04;
const PLAYER_STEER_STRENGTH = 18.5;
const PLAYER_LEFT_STEER_MULTIPLIER = 1.45;
const PLAYER_RIGHT_STEER_MULTIPLIER = 1.85;
const HORSE_HEADING_LIMIT = 0.52;
const PLAYER_TURN_RATE = 0.92;
const PLAYER_HEADING_RETURN = 0.965;
const PLAYER_LATERAL_FROM_HEADING = 1.25;
const CURVE_OUTWARD_DRIFT = 0.075;
const HEADING_PROGRESS_PENALTY = 0.18;
const INSIDE_LINE_PROGRESS_BONUS = 0.085;
const PLAYER_LANE_VELOCITY_LIMIT = 9.6;
const PLAYER_STEER_INPUT_FRICTION = 0.872;
const PLAYER_STEER_COAST_FRICTION = 0.752;
const PLAYER_STEER_DEADZONE = 0.035;
const PLAYER_CURVE_PENALTY_SPEED = 6.35;
// Sterzo manuale del giocatore: il cavallo ruota SOLO se si preme A/L. Velocità
// di rotazione (rad/s) e massima deviazione consentita dalla tangente della
// pista (limite anti-testacoda; entro questo angolo non c'è alcuno sterzo
// automatico, l'heading cambia solo per input del giocatore).
const PLAYER_STEER_TURN_RATE = 1.0;
// (non piu' usata: il muso del giocatore non viene piu' riportato sulla tangente)
// const PLAYER_MAX_HEADING_DEV = 1.05;
// ── Sensibilità di sterzata in funzione di velocità e curvatura ───────────────
// Sul rettilineo (e archi dolci) si sterza pieno (0.80). Nelle due curve a 90°
// la sterzata cala con l'andatura: più si va forte, più si va larghi.
//   andatura  1     2     3     4     5
const STRAIGHT_STEER = 0.80;
const CURVE_STEER_BY_ANDATURA = [0.55, 0.55, 0.45, 0.35, 0.27];
// Misurato sulla pista: archi dolci curve≈0.13, curve a 90° curve≈0.57. Il blend
// resta 0 fin oltre gli archi (0.20) e arriva a pieno (1) entro le 90° (0.55).
const CURVE_BLEND_START = 0.20;
const CURVE_BLEND_SPAN = 0.35;
function steerMultForCurve(curve, andatura) {
  const a = clamp(Math.round(andatura || 1), 1, 5);
  const blend = clamp((curve - CURVE_BLEND_START) / CURVE_BLEND_SPAN, 0, 1);
  return lerp(STRAIGHT_STEER, CURVE_STEER_BY_ANDATURA[a - 1], blend);
}
// Limite anteriore al canapo: i cavalli si avvicinano alla linea ma non la
// superano prima del via (niente falsa partenza). Progress 0 = canapo.
const MOSSA_FRONT_LIMIT = -1.0;
// In curva una forza centrifuga spinge il cavallo verso l'esterno: per tenere
// la linea interna (più corta e veloce) bisogna sterzare attivamente verso
// l'interno (tasto L, lato interno nel senso orario). Niente più "svolta
// automatica": chi non corregge va largo, rallenta e rischia la barriera.
const CURVE_CENTRIFUGAL_STRENGTH = 9.5;
// Bonus di velocità per la traiettoria interna (tragitto più corto). Forte in
// curva, lieve sul rettilineo: le linee interne sono sempre favorite.
const INNER_LANE_SPEED_BONUS = 0.14;
const INNER_LANE_BASE_BONUS = 0.022;
// Corpi più grossi e solidi: i cavalli si compenetrano meno e bloccano di più.
// Ingombro fisico del cavallo: più LUNGO che largo, come un cavallo vero. Alzato
// (era 2.75 × 1.55) perché il corpo modellato è più lungo della sagoma di
// collisione: i cavalli sembravano entrare l'uno dentro l'altro.
const HORSE_BLOCK_LENGTH = 3.30;
// Larghezza: MISURATA sul modello, non a occhio. Il pezzo più largo del corpo è
// la groppa (raggio 0.56 × scala 0.82 = 0.46 di semi-larghezza), quindi il cavallo
// è largo ~0.92. La sagoma stava a 1.40, cioè mezzo cavallo più larga del cavallo:
// i corpi si fermavano a mezzo metro di distanza e non si toccavano MAI, per quanto
// li spingessi. 1.02 = il corpo più un margine minimo.
const HORSE_BLOCK_WIDTH = 1.02;
const HORSE_PASS_CLEARANCE = 1.95;
const LEADER_STAMINA_EXTRA_DRAIN = 0.9;
const CAMPO_RADIUS = 68;
const CAMPO_BASE_Z = -36;
// Raggio degli spigoli delle due curve a 90°. DEVE restare maggiore della
// semi-larghezza pista (11.5): con un raggio più piccolo il bordo interno
// avrebbe raggio negativo. A 16 il bordo interno ha raggio ~4.5: curva netta.
const CAMPO_CORNER_RADIUS = 16;
// Il CASATO e' piu' chiuso di San Martino, come in Piazza: raggio piu' stretto,
// quindi angolo piu' vivo. Il bordo INTERNO resta a 11.5 dall'asse, percio' con
// 13 la corda interna gira su un raggio di 1.5: praticamente uno spigolo.
const CAMPO_CORNER_RADIUS_CASATO = 13;
// Mossa poco dopo la curva a 90° del lato sinistro (in alto a sinistra dello
// schermo): posizione speculare rispetto a prima (180° - 132° = 48°).
const CAMPO_MOSSA_ANGLE = THREE.MathUtils.degToRad(48);
const PLAYER_SPEED_MIN = 1;
// Intensità interna massima (scala usata da animazione/camera/AI). Le 5
// andature giocatore (1..5) mappano sull'intensità tramite ANDATURA = intensità/2.
const PLAYER_SPEED_MAX = 10;
// Andature selezionabili: solo 5 (1..5).
const ANDATURA_MAX = 5;
const STAMINA_MIN_ROLL = 70;
const STAMINA_MAX_ROLL = 100;
// Consumo stamina al secondo per ANDATURA (1..5). Negativo = recupera.
// Valori originali (gara ~50s): ripristinati con la velocità a 1.7.
const STAMINA_DRAIN_BY_SPEED = {
  1: -0.90,
  2: 0.25,
  3: 0.95,
  4: 2.25,
  5: 5.5
};
const TAU = Math.PI * 2;
const UP_AXIS = new THREE.Vector3(0, 1, 0);   // asse verticale mondo (riuso: caduta fantino)

// ── Mossa: rifacimento (verrocchino + rincorsa) ───────────────────────────
// Limite posteriore del corridoio fra i due canapi: i 9 cavalli al canapo
// possono arretrare fino a qui ma non oltre. È anche la linea-trigger: quando
// la rincorsa la supera in avanti, parte la gara. (Sposta anche il canapo
// posteriore visivo, costruito a questo progress → spazio fra i canapi più ampio.)
const MOSSA_BACK_LIMIT = -7.0;
// Timeout di sicurezza della mossa (secondi): se la rincorsa non entra, si
// forza comunque la partenza per non bloccare il gioco.
// Tempo massimo della mossa. Non e' piu' fisso: dalle impostazioni (rotellina in
// home) si sceglie fra 5, 10, 20 e 30 minuti. Cinque e' il default, come prima.
let MOSSA_MAX_DURATION = 300.0;
// Durata minima della mossa: la rincorsa non può entrare (e quindi la corsa non
// può partire) prima di questo tempo. Tiene la mossa lunga e tesa.
const MOSSA_MIN_DURATION = 30.0;
// Attesa della rincorsa PRIMA di potersi lanciare, contata come tempo CUMULATIVO
// col campo schierato ai canapi (state.rincorsaWait). NON si azzera quando il
// Mossiere chiama "tutti fuori": la rincorsa è là fuori che aspetta comunque, e
// decide da sé quando entrare — le sue scelte e quelle del Mossiere sono SLEGATE.
const RINCORSA_MIN_TENSION = 35.0;
// ── TONDINO: un unico grande ovale, dietro il canapo posteriore, attorno a cui
// TUTTI i cavalli non ancora chiamati girano insieme (senso antiorario).
// Ovale del tondino: allungato lungo la pista (dietro la mossa) e LARGO DA BORDO
// A BORDO (usa quasi tutta la larghezza). Tutti girano attorno a questo anello.
const TONDINO_CP = MOSSA_BACK_LIMIT - 10;    // centro lungo la pista
const TONDINO_CL = 0.0;                         // centro in corsia (centrato)
const TONDINO_RP = 9.0;                         // semi-lunghezza lungo la pista
// Semi-larghezza in corsia: DENTRO i bordi con margine dallo steccato — se
// l'ovale supera il limite pista i cavalli si schiacciano sul legno e lì
// "sbattono"/laggano. 8.6 + clamp morbido = mai a contatto con lo steccato.
const TONDINO_RL = 8.6;
const TONDINO_LANE_MAX = AI_LANE_LIMIT - 1.4;
const TONDINO_SPIN = -1;                        // verso di rotazione (−1 = antiorario dall'alto)
// Corsia fissa della rincorsa: la più esterna (lato verrocchino).
// Ricalcolate dopo precomputeTrack() per tenere conto della svasatura ai canapi
// (vedi rincorsaLane/verrocchinoLane): qui c'è solo il valore di ripiego.
let RINCORSA_LANE = -(TRACK_HALF_WIDTH - 1.4);
// Larghezza del varco di rincorsa: lo spazio fra il bordo sinistro della pista
// e il paletto del verrocchino, entro cui la rincorsa si lancia. Il paletto
// segna il confine interno del varco; i 9 cavalli al canapo restano a destra.
const RINCORSA_VARCO_WIDTH = 3.6;   // varco d'entrata (verrocchino più interno)
let VERROCCHINO_LANE = -(TRACK_HALF_WIDTH - RINCORSA_VARCO_WIDTH);
// Velocità di spostamento dentro i canapi: la velocità (andatura) muove il
// cavallo nella direzione in cui è girato. (andatura-2) * questo valore.
const MOSSA_MOVE_SPEED = 1.4;
// ── SVASATURA AI CANAPI ──────────────────────────────────────────────────────
// In prossimità del canape la pista si allarga verso l'ESTERNO (lato steccato/
// verrocchino). Serve spazio vero: con la larghezza costante il verrocchino stava
// a −7.9 e l'ultima posta a −7.5, cioè 0.4 di margine, e le 9 Contrade erano
// schiacciate. Allargando fuori, il canape diventa più lungo e le poste respirano.
const MOSSA_FLARE = 3.0;        // quanto si allarga, verso l'esterno
// Span ampio: la svasatura deve restare aperta anche DIETRO i canapi, dove la
// rincorsa prende lo slancio. Con una campana stretta si richiudeva proprio lì e
// la rincorsa si ritrovava fuori dal manto, contro lo steccato.
const MOSSA_FLARE_SPAN = 40;
// NERVOSISMO — è una RISERVA che si accumula, non un valore fisso: ogni botta presa
// ai canapi lo alza, e scende da solo quando il cavallo viene lasciato in pace.
// Oltre la soglia il cavallo perde la posta e arretra finché non si è calmato.
// È così che un fantino "ti dà noia": ti va addosso finché il barbero salta.
const NERV_BACK_THRESHOLD = 0.78;   // sopra questa soglia il cavallo si agita e va dietro
const NERV_CALM_EXIT = 0.70;        // …e non rientra finché non scende sotto questa.
// Secondi MINIMI dietro prima di tornare a cercare la posizione. È un minimo, non
// un timer fisso: scaduto, si rientra solo se ci si è anche calmati sotto
// NERV_CALM_EXIT (se no si tornerebbe in fila a ripigliarsi le stesse botte).
const NERV_BACK_WAIT = 12.0;
// ── TURNS (statistica 1-5 del cavallo) ───────────────────────────────────────
// Soglia di nervosismo oltre la quale il cavallo TIENE la posizione ma comincia a
// girarsi a destra e sinistra, FUORI dal controllo dell'AI e del giocatore.
// TURNS BASSO = salta subito (1 → già a 0.40); TURNS ALTO = regge (5 → 0.68).
// Tutte sotto NERV_BACK_THRESHOLD (0.78): prima ti giri, poi — se continuano a
// lavorartelo — esci dietro.
const TURNS_SOGLIA = { 1: 0.40, 2: 0.50, 3: 0.60, 4: 0.62, 5: 0.68 };
const TURNS_DURATA = 5.0;      // 5s girato+premendo da un lato, poi 5s di pausa, poi l'altro lato
const TURNS_ANGOLO = 1.2;      // ~69°: muso girato FISSO verso il lato scelto
// Rientrato, la Contrada è libera di riprendere subito la posta e ribeccarsi le
// botte, oppure di restare indietro: non c'è alcun blocco che glielo impedisca.
const NERV_HIT_GAIN = 0.01;         // quanto vale UNA BOTTA
// È QUESTO, non il tetto, a decidere quanto in fretta sale il nervosismo sotto
// pressione: +NERV_HIT_GAIN ogni NERV_HIT_COOLDOWN secondi. 1.8s → 0.0057/s,
// 1.2s → 0.0083/s, 0.7s → 0.0143/s. DEVE restare sotto NERV_CALM_AFTER_HIT (2.0s),
// altrimenti fra una botta e l'altra si apre una finestra di decadimento e il
// nervosismo non sale più nemmeno sotto pressione continua.
const NERV_HIT_COOLDOWN = 0.70;     // max UNA botta ogni 0.7s
// TETTO INVALICABILE di salita, applicato sul CAVALLO a fine frame, dopo che tutto
// ha già scritto. Non importa quante sorgenti tocchino il nervosismo né da quante
// Contrade venga colpito insieme: più di così non può salire, punto. È una rete di
// sicurezza voluta: inseguire le singole sorgenti si è già rivelato inaffidabile.
const NERV_MAX_RISE = 0.04;         // al secondo
// Cosa conta come BOTTA: SOLO qualcuno che ti preme addosso deliberatamente —
// il giocatore con Q/P (di lato) o A/L (girandoti contro), l'AI con la sua spinta.
// Ogni pressione conteggiata vale una botta (+NERV_HIT_GAIN). Gli urti di
// carambola, cioè i contatti in cui nessuno sta spingendo verso di te, non
// contano niente.
const NERV_HIT_STREAK = 1;          // ogni pressione conteggiata è già una botta
const NERV_HIT_WINDOW = 3.0;        // se molli più di così, il conteggio riparte da capo
// Nervosismo di PARTENZA per calma (tabella dell'utente). Valori ravvicinati: la
// differenza fra le indoli si gioca sul RECUPERO (NERV_DECAY_BY_CALMA), non sul
// punto di partenza. Tutti sotto la soglia di agitazione 0.78.
const NERV_BASE_BY_CALMA = { 1: 0.62, 2: 0.55, 3: 0.50, 4: 0.45, 5: 0.40 };
// Quanto scende al secondo quando nessuno gli va addosso, PER CALMA: i cavalli
// tranquilli si riprendono in un attimo, gli altri se lo portano dietro.
const NERV_DECAY_BY_CALMA = { 5: 0.03, 4: 0.02 };
const NERV_DECAY = 0.01;            // tutti gli altri (calma 1-2-3)
// NEL TONDINO si scarica MOLTO più in fretta: il cavallo gira largo, lontano dalla
// calca, e quel giro serve proprio a farlo rifiatare. I valori qui sopra sono quelli
// AI CANAPI, dove la tensione resta. Senza questo moltiplicatore un cavallo entrato
// nel tondino al 62% ne perdeva 7 punti in tutta l'attesa: praticamente fermo.
// ×1 = nel tondino si scende ESATTAMENTE come ai canapi (−0.01 / −0.02 / −0.03).
// Il moltiplicatore resta come manopola, ma oggi non moltiplica niente.
const NERV_DECAY_TONDINO = 1;
// Secondi senza botte prima che ricominci a calmarsi. DEVE restare sopra
// NERV_HIT_COOLDOWN: se fosse più corto, fra una botta contata e la successiva si
// aprirebbe una finestra di decadimento più grande del guadagno, e il nervosismo
// non salirebbe MAI nemmeno sotto pressione continua.
const NERV_CALM_AFTER_HIT = 2.0;
// ── NERBATA: colpo di nerbo che danneggia il cavallo accanto. Stesse regole per
// giocatore e AI. 5 colpi "in canna", ricarica come un caricatore.
const NERBATE_MAX = 5;              // colpi massimi in canna
const NERBATA_RECHARGE = 4.0;       // secondi per ricaricarne 1 (fino a NERBATE_MAX)
const NERBATA_NERV = 0.02;          // +2% nervosismo al cavallo colpito (canapi)
const NERBATA_PUSHBACK = 2.0;       // unità di arretramento del colpito (canapi)
const NERBATA_SLOW = 0.15;          // −15% velocità del colpito (in gara)
const NERBATA_SLOW_DUR = 1.5;       // durata del rallentamento in gara (secondi)
const NERBATA_COOLDOWN = 0.6;       // cadenza minima fra due nerbate dello stesso attaccante
const TIER_RANK = { brenna: 0, bono: 1, bombolone: 2 };   // per decidere la "sfavorita"
// Posizione di partenza della rincorsa, dietro al canapo posteriore.
const RINCORSA_START_PROGRESS = MOSSA_BACK_LIMIT - 3.4;
// Ritardo massimo di reazione individuale al via (secondi).
const LAUNCH_MAX_DELAY = 0.35;

// ── RIVALITÀ STORICHE fra Contrade, con INTENSITÀ (0..1): al Palio contano
// più della logica sportiva. 1.0 = rivalità molto forte (marcatura dura,
// contatti, sacrificio della propria partenza); 0.7 = media (disturbo,
// pressione, chiusura, meno sacrificio). Se due rivali sono in gara si
// marcano ai canapi e la rincorsa usa il tempo come arma contro la rivale.
// Rivalità storiche. Intensità tutte a 1.0, TRANNE Torre↔Onda a 0.7. Le Contrade
// non elencate qui (Bruco, Drago, Giraffa, Selva) NON hanno una rivale.
const RIVALS = {
  aquila: { pantera: 1.0 }, pantera: { aquila: 1.0 },
  chiocciola: { tartuca: 1.0 }, tartuca: { chiocciola: 1.0 },
  civetta: { leocorno: 1.0 }, leocorno: { civetta: 1.0 },
  oca: { torre: 1.0 }, torre: { oca: 1.0, onda: 0.7 },
  nicchio: { valdimontone: 1.0 }, valdimontone: { nicchio: 1.0 },
  istrice: { lupa: 1.0 }, lupa: { istrice: 1.0 },
  onda: { torre: 0.7 },
};
function rivalIntensity(idA, idB) { return (RIVALS[idA] && RIVALS[idA][idB]) || 0; }

// Colori UFFICIALI delle 17 Contrade di Siena (fonte: ilpalio.org/colori_contrade).
// Ordine: [colore 1, colore 2, filettatura/liste].
// ── PALETTE DELLE LIVREE ─────────────────────────────────────────────────────
// I colori ufficiali sono pubblicati dal Comune di Siena SOLO a parole
// (palio.comune.siena.it/node/106): non esistono valori HEX ufficiali. Queste
// tonalità sono quindi una CALIBRAZIONE derivata dalle descrizioni, non valori
// certificati. Sono scelte per restare distinguibili sia in pieno sole sia in
// ombra, e soprattutto per NON confondere fra loro celeste / azzurro / blu /
// turchino, che nelle livree senesi sono quattro colori diversi.
const LIV = {
  bianco:     "#F2EAD6",   // bianco avorio (non bianco puro: non brucia al sole)
  nero:       "#1A1712",
  giallo:     "#EFC531",
  gialloOro:  "#E3AE1F",   // oro caldo dell'Aquila, più profondo del giallo
  rosso:      "#C22530",
  // Il Valdimontone ha un rosso SUO, virato al rosa e schiarito: lo distingue
  // dalla Chiocciola e dalla Giraffa, che sono rosso pieno. Stesso colore in
  // fantino-lab, così il fantino e la sua bandiera non hanno due rossi diversi.
  rosaMontone: "#EE93A4",
  cremisi:    "#A8102E",   // Torre: cremisi, più cupo e violaceo del rosso
  verde:      "#16833F",
  arancio:    "#E07A24",
  rosaAntico: "#C87F8E",   // Drago: rosa antico spento, MAI fucsia
  celeste:    "#5AB0E0",   // il più chiaro  (Onda, Pantera)
  azzurro:    "#1E7BC4",   // medio          (Leocorno, Nicchio)
  blu:        "#1B4FA0",   // pieno          (Istrice, Torre)
  turchino:   "#123C7A",   // il più profondo (Aquila, Bruco, Chiocciola, Tartuca)
};
// colors = [ principale (giubbetto+zucchino), secondario (maniche+pantaloni), liste ]
// silkStripe = eventuale SECONDO colore di lista, per le Contrade che ne hanno due.
// Descrizioni verificate su palio.comune.siena.it/node/106 (fonte #1 del brief).
const CONTRADE = [
  { id: "aquila", name: "Aquila", motto: "Giallo oro con liste nere e turchine", colors: [LIV.gialloOro, LIV.gialloOro, LIV.nero], silkStripe: LIV.turchino, coat: "#5b3422" },
  { id: "bruco", name: "Bruco", motto: "Giallo e verde con liste turchine", colors: [LIV.verde, LIV.giallo, LIV.turchino], coat: "#7b4529" },
  { id: "chiocciola", name: "Chiocciola", motto: "Rosso e giallo con liste turchine", colors: [LIV.rosso, LIV.giallo, LIV.turchino], coat: "#4d2b1c" },
  { id: "civetta", name: "Civetta", motto: "Nero e rosso con liste bianche", colors: [LIV.nero, LIV.rosso, LIV.bianco], coat: "#a46b3b" },
  { id: "drago", name: "Drago", motto: "Rosa antico e verde con liste gialle", colors: [LIV.rosaAntico, LIV.verde, LIV.giallo], coat: "#2d2119" },
  { id: "giraffa", name: "Giraffa", motto: "Rosso e bianco", colors: [LIV.rosso, LIV.bianco, LIV.bianco], coat: "#6d4027" },
  { id: "istrice", name: "Istrice", motto: "Bianco con arabeschi rossi, neri e blu", colors: [LIV.bianco, LIV.rosso, LIV.blu], silkStripe: LIV.nero, coat: "#3d241b" },
  { id: "leocorno", name: "Leocorno", motto: "Bianco e arancio con liste azzurre", colors: [LIV.bianco, LIV.arancio, LIV.azzurro], coat: "#8c5430" },
  { id: "lupa", name: "Lupa", motto: "Bianco e nero con liste arancio", colors: [LIV.bianco, LIV.nero, LIV.arancio], coat: "#5d3424" },
  // Il Nicchio è BLU, non azzurro (la dicitura ufficiale "azzurro" indica un blu
  // pieno, non il celeste). Il giallo resta ma con poca superficie: sta nelle
  // righine verticali, mentre il rosso porta le liste di spalle, fascia e zucchino.
  { id: "nicchio", name: "Nicchio", motto: "Blu con liste gialle e rosse", colors: [LIV.blu, LIV.blu, LIV.rosso], silkStripe: LIV.giallo, coat: "#9c6136" },
  { id: "oca", name: "Oca", motto: "Bianco e verde con liste rosse", colors: [LIV.bianco, LIV.verde, LIV.rosso], coat: "#45261a" },
  { id: "onda", name: "Onda", motto: "Bianco e celeste", colors: [LIV.bianco, LIV.celeste, LIV.celeste], coat: "#7b4a2e" },
  { id: "pantera", name: "Pantera", motto: "Rosso e celeste con liste bianche", colors: [LIV.rosso, LIV.celeste, LIV.bianco], silkStripe: LIV.bianco, coat: "#2f2119" },
  { id: "selva", name: "Selva", motto: "Verde e arancio con liste bianche", colors: [LIV.verde, LIV.arancio, LIV.bianco], coat: "#6a3d27" },
  { id: "tartuca", name: "Tartuca", motto: "Giallo e turchino", colors: [LIV.giallo, LIV.turchino, LIV.turchino], coat: "#8a5230" },
  { id: "torre", name: "Torre", motto: "Rosso cremisi con liste bianche e blu", colors: [LIV.cremisi, LIV.cremisi, LIV.bianco], silkStripe: LIV.blu, coat: "#533121" },
  { id: "valdimontone", name: "Valdimontone", motto: "Rosso e giallo con liste bianche", colors: [LIV.rosaMontone, LIV.giallo, LIV.bianco], coat: "#9d6439" }
];

const HORSE_COAT_VARIANTS = [
  { id: "baio", base: "#734022", highlight: "#a86b3d", shade: "#4a2718", dark: "#17100c", muzzle: "#2b1b13", sock: 0.38 },
  { id: "sauro", base: "#9f5630", highlight: "#c27b48", shade: "#6f351f", dark: "#6a321f", muzzle: "#61301f", sock: 0.46 },
  { id: "morello", base: "#181512", highlight: "#38312b", shade: "#0b0908", dark: "#050403", muzzle: "#070605", sock: 0.18 },
  { id: "grigio", base: "#9d9587", highlight: "#c3baaa", shade: "#6d665e", dark: "#34302c", muzzle: "#5c5550", sock: 0.54 },
  { id: "castano-scuro", base: "#4a2a1c", highlight: "#75503a", shade: "#28160f", dark: "#120c09", muzzle: "#21140e", sock: 0.28 }
];

// Distribuzione realistica dei mantelli del Palio: dominano bai, sauri e
// castani, con un paio di morelli; il grigio è raro (1 su 10). Indicizzata per
// posizione del cavallo, così le proporzioni restano garantite ad ogni corsa.
const HORSE_COAT_SEQUENCE = [
  "baio", "sauro", "morello", "castano-scuro", "baio",
  "sauro", "castano-scuro", "morello", "baio", "grigio"
];
function coatVariantForIndex(index) {
  const seq = HORSE_COAT_SEQUENCE;
  const id = seq[((index % seq.length) + seq.length) % seq.length];
  return HORSE_COAT_VARIANTS.find((v) => v.id === id) || HORSE_COAT_VARIANTS[0];
}

const coatTextureCache = new Map();
const HORSE_ANIMATION_PROFILES = {
  idle: { frequency: 0.9, stride: 0.08, bob: 0.018, neck: 0.018, tail: 0.05 },
  walk: { frequency: 1.65, stride: 0.24, bob: 0.032, neck: 0.032, tail: 0.08 },
  trot: { frequency: 2.55, stride: 0.46, bob: 0.052, neck: 0.042, tail: 0.12 },
  gallop: { frequency: 3.55, stride: 0.78, bob: 0.082, neck: 0.058, tail: 0.17 },
  turnLeft: { frequency: 3.25, stride: 0.68, bob: 0.07, neck: 0.052, tail: 0.2 },
  turnRight: { frequency: 3.25, stride: 0.68, bob: 0.07, neck: 0.052, tail: 0.2 },
  startBurst: { frequency: 4.05, stride: 0.92, bob: 0.1, neck: 0.07, tail: 0.24 },
  slowDown: { frequency: 2.15, stride: 0.36, bob: 0.042, neck: 0.036, tail: 0.13 },
  stumbleRecovery: { frequency: 2.45, stride: 0.54, bob: 0.075, neck: 0.07, tail: 0.22 },
  afterRaceIdle: { frequency: 1.1, stride: 0.1, bob: 0.028, neck: 0.045, tail: 0.09 }
};

const ui = {
  sceneRoot: document.getElementById("sceneRoot"),
  screens: {
    menu: document.getElementById("screenMenu"),
    select: document.getElementById("screenSelect"),
    results: document.getElementById("screenResults")
  },
  playButton: document.getElementById("playButton"),
  backToMenuButton: document.getElementById("backToMenuButton"),
  startMossaButton: document.getElementById("startMossaButton"),
  changeContradaButton: document.getElementById("changeContradaButton"),
  replayButton: document.getElementById("replayButton"),
  contradaGrid: document.getElementById("contradaGrid"),
  hud: document.getElementById("hud"),
  rank: document.getElementById("hudRank"),
  lap: document.getElementById("hudLap"),
  speed: document.getElementById("hudSpeed"),
  staminaText: document.getElementById("hudStaminaText"),
  staminaFill: document.getElementById("staminaFill"),
  riskText: document.getElementById("hudRiskText"),
  riskFill: document.getElementById("riskFill"),
  nerbateText: document.getElementById("hudNerbateText"),
  nerbatePips: document.getElementById("nerbatePips"),
  leaderboard: document.getElementById("leaderboard"),
  message: document.getElementById("raceMessage"),
  finalRanking: document.getElementById("finalRanking"),
  resultSummary: document.getElementById("resultSummary"),
  speedVignette: document.getElementById("speedVignette"),
  touchControls: document.getElementById("touchControls"),
  camButton: document.getElementById("camButton"),
  minimap: document.getElementById("minimap")
};

const boot = window.PalioBoot = window.PalioBoot || {};
Object.assign(boot, {
  ready: false,
  showSelect: null,
  showMenu: null,
  startMossa: null
});

const state = {
  mode: "menu",
  selectedContrada: CONTRADE[0],
  difficulty: "hard",   // UNICA modalità: Esperto (niente più scelta difficoltà)
  keys: new Set(),
  touch: { left: false, right: false, latLeft: false, latRight: false },
  horses: [],
  demoHorses: [],
  dust: [],
  flags: [],
  folla: null,        // la folla animata del centro piazza (una InstancedMesh sola)
  clouds: [],
  speedLines: [],
  canapi: null,
  canapiDrop: 0,
  canapiPosteriore: null,   // gruppo verrocchino + canapo posteriore
  canapiDropTimer: 0,       // conto alla rovescia per la sparizione del canapo posteriore
  mossaPhase: "positioning", // fase globale della mossa: 'positioning' | 'tension'
  mossaSubTimer: 0,         // cronometro della fase corrente
  audio: {
    ctx: null,
    hoofTimer: 0,
    lastNerbo: false,
    lastBrake: false
  },
  raceClock: 0,
  mossaTimer: 0,
  mossaDuration: 3.6,
  messageTimer: 0,
  messageText: "",
  lastLapAnnounced: false,
  cameraShake: 0,
  cameraFov: 64,
  cameraMode: "follow", // 'follow' | 'overhead' | 'firstperson'
  overheadAngle: 0,
  cameraPosition: new THREE.Vector3(0, 7, -13),
  cameraLook: new THREE.Vector3(0, 1.9, 0),
  currentLeader: null,
  currentLast: null,
  rankings: [],
  announce: { prevRank: null, lastLap: false, finishNear: false, headToHead: false },
  ui: {
    leaderboardTimer: 0,
    lastRiskLabel: "",
    lastRankKey: "",
    lastPlayerRank: null
  }
};

const scene = new THREE.Scene();
// Foschia di tufo: caldo ma desaturato, una vera "polvere nell'aria" e non un
// filtro arancione. Densità leggermente ridotta così i palazzi sul fondo si
// leggono ancora, dando profondità alla piazza.
scene.fog = new THREE.FogExp2(0xc3aa8c, 0.0040);

// far = 1200: la cupola-cielo ha raggio 380 centrata sull'origine; con far 420 la
// camera del replay/gara, allontanandosi dall'origine, ne tagliava il lato opposto
// e si vedeva il nero di fondo (la "cupola nera"). 1200 la contiene da ovunque.
const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 1200);
// Seconda camera per la mini-cam rincorsa (top-left durante la mossa).
const rincorsaMiniCam = new THREE.PerspectiveCamera(78, 240 / 150, 0.3, 500);
// TELEFONO: boost FPS → niente antialias/ombre e pixelRatio più basso (rilevo il
// touch qui, prima che IS_TOUCH_DEVICE sia definito più sotto).
const _touchBoot = (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)
  && (navigator.maxTouchPoints || 0) > 0;
const renderer = new THREE.WebGLRenderer({ antialias: !_touchBoot, powerPreference: "high-performance" });
// TETTO 1.5 (era 2): su un Retina 2x significa il 44% di pixel in MENO da
// disegnare a ogni frame — è la prima causa di laptop rovente, e a queste
// dimensioni di scena la differenza di nitidezza non si nota. Su TELEFONO 1.25.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, _touchBoot ? 1.25 : 1.5));
renderer.shadowMap.enabled = !_touchBoot;   // niente ombre su telefono (grosso risparmio GPU)
// PCF semplice al posto del PCFSoft: bordi ombra un filo più netti, parecchio
// lavoro GPU in meno su una scena con centinaia di caster.
renderer.shadowMap.type = THREE.PCFShadowMap;
// Resa cinematografica: il tone mapping filmico recupera le alte luci (niente
// più facce "bruciate" piatte) e dà profondità naturale, togliendo l'effetto
// plastica/arcade. Esposizione tarata sulla luce calda del tardo pomeriggio.
// Tone mapping "Neutral" (Khronos PBR Neutral): comprime le alte luci come un
// filmico ma PRESERVA la tinta — niente "spostamento all'arancio" di ACES, che
// faceva virare il tufo giallo verso il rosso. Così la pista resta gialla.
renderer.toneMapping = THREE.NeutralToneMapping !== undefined
  ? THREE.NeutralToneMapping
  : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
ui.sceneRoot.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const tmpVec = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

const materials = {
  // Tufo: giallo-ocra dorato e luminoso, il colore vero della pista del Palio
  // (sabbia gialla, non terra rossa). La texture viene assegnata in buildScene.
  tufo: new THREE.MeshStandardMaterial({ color: 0xf2d486, roughness: 0.98, metalness: 0.0, emissive: 0x5a4818, emissiveIntensity: 0.55 }),
  tufoDark: new THREE.MeshStandardMaterial({ color: 0xcdac63, roughness: 0.97, emissive: 0x40340f, emissiveIntensity: 0.45 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x6b503b, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x8c6c56, roughness: 0.9 }),
  rope: new THREE.MeshStandardMaterial({ color: 0xf0d992, roughness: 0.8 }),
  redRope: new THREE.MeshStandardMaterial({ color: 0xa53b2c, roughness: 0.75 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4ead8, roughness: 0.7 }),
  black: new THREE.MeshStandardMaterial({ color: 0x181410, roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5c3526, roughness: 0.86 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xf2c35a, roughness: 0.62 }),
  barrier: new THREE.MeshStandardMaterial({ color: 0xb8aa83, roughness: 0.72, metalness: 0.02 }),
  barrierDark: new THREE.MeshStandardMaterial({ color: 0x716247, roughness: 0.84 }),
  bannerPanel: new THREE.MeshBasicMaterial({ color: 0xd7caa4, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  water: new THREE.MeshBasicMaterial({ color: 0x8cbec6, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  awning: new THREE.MeshStandardMaterial({ color: 0xb94146, roughness: 0.78 }),
  rut: new THREE.MeshBasicMaterial({ color: 0x6f4028, transparent: true, opacity: 0.22 }),
  tufoScuff: new THREE.MeshBasicMaterial({
    color: 0x6f432b,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  }),
  tufoHighlight: new THREE.MeshBasicMaterial({
    color: 0xe0b16a,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3
  }),
  boost: new THREE.MeshBasicMaterial({ color: 0xffd363, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
};

const shared = {
  flagGeometry: new THREE.PlaneGeometry(1.25, 0.72, 6, 1),
  crowdGeometry: new THREE.CapsuleGeometry(0.11, 0.28, 3, 6),
  chevronGeometry: new THREE.ConeGeometry(0.34, 0.72, 3),
  barrierPostGeometry: new THREE.BoxGeometry(0.13, 0.96, 0.13),
  bannerGeometry: new THREE.PlaneGeometry(1.15, 0.46, 1, 1),
  hoofGeometry: new THREE.BoxGeometry(0.16, 0.018, 0.44),
  boostGeometry: new THREE.PlaneGeometry(0.62, 2.4),
  tufoScuffGeometry: new THREE.PlaneGeometry(0.32, 1.45, 1, 1),
  dustGeometry: new THREE.SphereGeometry(0.16, 7, 5),
  dustPlaneGeometry: new THREE.PlaneGeometry(0.42, 0.42)
};

// Polvere di tufo: tonalità sabbia chiara desaturata, coerente col terreno,
// così quando gli zoccoli la sollevano sembra vera terra e non fumo arancione.
const DUST_COLOR_A = new THREE.Color(0xc3ac82);
const DUST_COLOR_B = new THREE.Color(0xe4d6bb);

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

function makeMat(color, roughness = 0.75) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0.02 });
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function colorCss(color) {
  return `#${color.getHexString()}`;
}

function createCoatTexture(variant, tone = "base", seed = 0) {
  const key = `${variant.id}:${tone}:${seed % 13}`;
  if (coatTextureCache.has(key)) return coatTextureCache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const base = new THREE.Color(variant[tone] || variant.base);
  const highlight = new THREE.Color(variant.highlight);
  const shade = new THREE.Color(variant.shade);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, colorCss(base.clone().lerp(highlight, 0.18)));
  gradient.addColorStop(0.46, colorCss(base));
  gradient.addColorStop(1, colorCss(base.clone().lerp(shade, 0.28)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 320; i += 1) {
    const x = seededUnit(seed + i * 1.91) * canvas.width;
    const y = seededUnit(seed + i * 2.73) * canvas.height;
    const length = 4 + seededUnit(seed + i * 3.17) * 18;
    const alpha = 0.035 + seededUnit(seed + i * 4.41) * 0.08;
    const hairColor = base.clone().lerp(seededUnit(seed + i * 5.13) > 0.48 ? highlight : shade, 0.12 + seededUnit(seed + i * 6.01) * 0.22);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colorCss(hairColor);
    ctx.lineWidth = 0.7 + seededUnit(seed + i * 6.77) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (seededUnit(seed + i * 7.31) - 0.5) * 3.5);
    ctx.stroke();
  }

  for (let i = 0; i < 24; i += 1) {
    const y = seededUnit(seed + i * 8.71) * canvas.height;
    const wave = seededUnit(seed + i * 9.39) * 18;
    ctx.globalAlpha = 0.05 + seededUnit(seed + i * 10.11) * 0.08;
    ctx.strokeStyle = colorCss(base.clone().lerp(i % 2 ? highlight : shade, 0.18));
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-8, y);
    ctx.bezierCurveTo(30, y + wave * 0.3, 72, y - wave * 0.45, 136, y + wave * 0.18);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(tone === "dark" ? 0.8 : 1.28, tone === "dark" ? 0.72 : 0.92);
  texture.colorSpace = THREE.SRGBColorSpace;
  coatTextureCache.set(key, texture);
  return texture;
}

function createHorseCoatMaterial(variant, tone = "base", seed = 0) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(variant[tone] || variant.base),
    map: createCoatTexture(variant, tone, seed),
    roughness: tone === "highlight" ? 0.78 : 0.9,
    metalness: 0.0
  });
}

class SemicircleCampoCurve extends THREE.Curve {
  // I due spigoli hanno raggi DIVERSI: `cornerRadiusCasato` e' il primo ramo
  // percorso da getPoint (che nel verso di marcia e' il CASATO, cum ~285-310),
  // `cornerRadius` il secondo (SAN MARTINO, cum ~156-181). Con raggi diversi i due
  // archi finiscono a quote z diverse, quindi il tratto in mezzo non e' piu'
  // orizzontale ma un segmento fra i due punti: la pendenza e' di un paio di gradi
  // e le tangenti vengono comunque ricalcolate per differenze finite in
  // precomputeTrack, che la smussa.
  constructor(radius, baseZ, cornerRadius, startAngle, cornerRadiusCasato) {
    super();
    this.radius = radius;
    this.baseZ = baseZ;
    this.cornerRadius = cornerRadius;
    this.cornerRadiusCasato = cornerRadiusCasato || cornerRadius;
    this.bottomZ = baseZ - cornerRadius;
    this.startAngle = startAngle;
    this.arcToRightLength = radius * startAngle;
    this.cornerLength = cornerRadius * Math.PI * 0.5;
    this.cornerLengthCasato = this.cornerRadiusCasato * Math.PI * 0.5;
    // Estremi del tratto fra i due spigoli, ciascuno alla quota del proprio arco.
    this.straightA = new THREE.Vector3(radius - this.cornerRadiusCasato, 0, baseZ - this.cornerRadiusCasato);
    this.straightB = new THREE.Vector3(-radius + cornerRadius, 0, baseZ - cornerRadius);
    this.straightLength = Math.max(1, this.straightA.distanceTo(this.straightB));
    this.arcToStartLength = radius * (Math.PI - startAngle);
    this.totalLength = this.arcToRightLength + this.cornerLengthCasato + this.straightLength + this.cornerLength + this.arcToStartLength;
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
    if (distance <= this.cornerLengthCasato) {          // ← il CASATO, il piu' chiuso
      const r = this.cornerRadiusCasato;
      const phi = -distance / r;
      return target.set(
        this.radius - r + Math.cos(phi) * r,
        0,
        this.baseZ + Math.sin(phi) * r
      );
    }
    distance -= this.cornerLengthCasato;
    if (distance <= this.straightLength) {
      return target.copy(this.straightA).lerp(this.straightB, distance / this.straightLength);
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
  return new SemicircleCampoCurve(CAMPO_RADIUS, CAMPO_BASE_Z, CAMPO_CORNER_RADIUS, CAMPO_MOSSA_ANGLE, CAMPO_CORNER_RADIUS_CASATO);
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
// ── L'ALLESTIMENTO DEL PALIO ─────────────────────────────────────────────────
// Il tufo si stende e i palchi si montano solo per i giorni del Palio: quando si
// estraggono le Contrade la Piazza e' ancora quella di tutti i giorni, mattoni
// fino ai palazzi. Tutto cio' che appartiene all'allestimento passa da qui e
// viene acceso o spento da setAllestimentoPalio().
// L'allestimento arriva in DUE tempi, come in Piazza: prima si stende il tufo e si
// monta la pista, poi — piu' avanti — i palchi. Da qui le tre fasi:
//   "nuda"  estrazione delle Contrade: mattoni e basta
//   "tufo"  Tratta: il tufo c'e', i palchi non ancora
//   "palio" il giorno del Palio: tutto montato
const allestimentoPista = [];
const allestimentoPalchi = [];
function addAllestimento(...objs) {
  objs.forEach((o) => { if (o) { allestimentoPista.push(o); scene.add(o); } });
  return objs[0];
}
function addPalchi(...objs) {
  objs.forEach((o) => { if (o) { allestimentoPalchi.push(o); scene.add(o); } });
  return objs[0];
}
// Pezzi della scenografia che sono PALCHI (si montano per ultimi) e pezzi di
// PIETRA (Cappella ed Entrone: non si portano via dopo il Palio). Tutto il resto
// della scenografia — palancata, colonnino — segue il tufo.
const SCENA_PALCHI = new Set(["Palchi", "PubblicoPalchi", "PalchiComparse", "PubblicoComparse",
  "SteccatoEsterno", "VerrocchioMossiere", "PalcoCapitani", "PonteCapitani", "FollaInPiedi"]);
const SCENA_PIETRA = new Set(["CappellaDiPiazza", "Entrone"]);
function setAllestimento(fase) {
  const tufo = fase !== "nuda";
  const palchi = fase === "palio";
  allestimentoPista.forEach((o) => { o.visible = tufo; });
  allestimentoPalchi.forEach((o) => { o.visible = palchi; });
  if (state.scenaPiazza) state.scenaPiazza.children.forEach((c) => {
    if (SCENA_PIETRA.has(c.name)) return;
    c.visible = SCENA_PALCHI.has(c.name) ? palchi : tufo;
  });
  if (state.piazzaNuda) state.piazzaNuda.visible = !tufo;
}

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
function makeHerringboneTexture() {
  const S = 192, L = 64, W = 32, step = L + W;   // S multiplo di step → tiling pulito
  const c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d");
  x.fillStyle = "#2f251d"; x.fillRect(0, 0, S, S);   // malta/fughe (bruno neutro, non rossastro)
  // Marroni SCURI, poco saturi: la piazza non è rossa: è un lastricato bruno.
  const cols = ["#5a4432", "#634c37", "#513d2d", "#6a5340", "#4a382a", "#6f573f"];
  let n = 0;
  const brick = (bx, by, bw, bh) => {
    x.fillStyle = cols[n++ % cols.length];
    x.fillRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
  };
  for (let gy = -step; gy < S + step; gy += step) {
    for (let gx = -step; gx < S + step; gx += step) {
      brick(gx, gy, L, W);            // orizzontale
      brick(gx + L, gy, W, L);        // verticale (forma la L)
      brick(gx - W, gy + W, W, L);    // interlock a sinistra
      brick(gx, gy + L, L, W);        // interlock sotto
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Lastricato del Campo + i NOVE SPICCHI (linee bianche di travertino che convergono
// verso il Palazzo). Puramente decorativo: stessa forma/quota del vecchio campoInner.
function buildCampoPaving() {
  const SCALE = 0.86;   // conchiglia ampia: il lastricato arriva quasi al bordo di travertino
  // 1) BASE — mattoni a spina di pesce.
  const brickTex = makeHerringboneTexture();
  brickTex.repeat.set(10, 10);
  const base = new THREE.Mesh(
    campoShapeGeometry(SCALE),
    new THREE.MeshStandardMaterial({ map: brickTex, color: 0xa89684, roughness: 0.97, metalness: 0 }));
  base.position.y = 0.005;
  base.receiveShadow = false;   // (come prima: niente shadow-acne dal sole basso)
  scene.add(base);

  // 2) OVERLAY — i nove spicchi. UV normalizzate al bounding box → una texture sola
  //    sull'intera conchiglia; le linee oltre il bordo sono ritagliate dalla mesh.
  const lineGeo = campoShapeGeometry(SCALE);
  lineGeo.computeBoundingBox();
  const bb = lineGeo.boundingBox;
  const minX = bb.min.x, maxX = bb.max.x, minZ = bb.min.z, maxZ = bb.max.z;
  const Wd = Math.max(1e-3, maxX - minX), Hd = Math.max(1e-3, maxZ - minZ);
  const pos = lineGeo.attributes.position, uv = lineGeo.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, (pos.getX(i) - minX) / Wd, (pos.getZ(i) - minZ) / Hd);
  uv.needsUpdate = true;

  const s0 = sampleAt(getStraightCenterP());                       // lato Palazzo
  const fx = s0.point.x * SCALE, fz = CAMPO_BASE_Z + (s0.point.z - CAMPO_BASE_Z) * SCALE;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;            // centro conchiglia

  const CV = 1024;
  const cvs = document.createElement("canvas"); cvs.width = cvs.height = CV;
  const g = cvs.getContext("2d");
  const toPx = (X, Z) => [((X - minX) / Wd) * CV, (1 - (Z - minZ) / Hd) * CV];   // V invertita
  const [fpx, fpy] = toPx(fx, fz);
  const [cpx, cpy] = toPx(cx, cz);
  const baseAng = Math.atan2(cpy - fpy, cpx - fpx);
  // Spicchi DISCRETI: travertino smorzato (non bianco pieno) e linea più sottile.
  g.strokeStyle = "#b9ac95"; g.lineCap = "round"; g.lineWidth = CV * 0.0032;
  g.globalAlpha = 0.62;
  const N = 9, SPREAD = (150 * Math.PI) / 180;
  for (let i = 0; i < N; i += 1) {
    const a = baseAng + (i / (N - 1) - 0.5) * SPREAD;
    g.beginPath(); g.moveTo(fpx, fpy);
    g.lineTo(fpx + Math.cos(a) * CV * 2.2, fpy + Math.sin(a) * CV * 2.2);   // oltre il bordo (ritagliato)
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const lines = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.7, depthWrite: false }));
  lines.position.y = 0.02;
  lines.renderOrder = 1;
  scene.add(lines);
}

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

function buildScene() {
  const tufoTex = makeTufoTexture();
  if (tufoTex) {
    // Ripetizione più ampia: le chiazze di tufo consumato diventano più grandi
    // e leggibili, così la pista non sembra una superficie piatta uniforme.
    tufoTex.repeat.set(44, 3.5);
    materials.tufo.map = tufoTex;
    materials.tufo.needsUpdate = true;
  }

  // Contrasto caldo/freddo (il segreto contro il "tutto arancione"): la luce di
  // cielo è fredda, così le OMBRE virano leggermente al freddo; il sole resta
  // caldo e dora le superfici illuminate. Da terra rimbalza il caldo del tufo.
  // Risultato: luce italiana calda ma con profondità, non una tinta unica.
  const hemi = new THREE.HemisphereLight(0xcdd6dc, 0x90764e, 1.7);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3e0, 2.8);
  sun.position.set(-28, 42, -22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75;
  sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75;
  sun.shadow.camera.bottom = -75;
  // Bias contro lo shadow-acne: il sole basso a radenza disegnava ventagli di
  // strisce scure sulle grandi superfici piatte (pista/campo). normalBias
  // elimina l'artefatto mantenendo le ombre dei cavalli.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);

  buildSky(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(190, 170), materials.grass);
  ground.rotation.x = -Math.PI / 2;
  // SOTTO il punto più basso dell'altimetria (−1.2): a −0.04 il prato piatto
  // copriva la pista abbassata a San Martino e la faceva sparire.
  ground.position.y = -1.45;
  ground.receiveShadow = true;
  scene.add(ground);

  // Centro della piazza = "conchiglia" di mattoni a SPINA DI PESCE (terracotta),
  // divisa nei NOVE SPICCHI da linee bianche di travertino che convergono verso il
  // Palazzo — la firma di Piazza del Campo. Solo grafica: non tocca pista/gameplay.
  buildCampoPaving();
  // Il bordo ESTERNO segue la svasatura dei canapi E il profilo di larghezza
  // variabile (imbuti di San Martino/cappella/Casato); l'interno resta fisso.
  const bordoEsterno = (s) => -TRACK_HALF_WIDTH - mossaFlareAt(s.cum) + trackNarrowAt(s.cum);
  addAllestimento(createRibbonMesh(bordoEsterno, TRACK_HALF_WIDTH, materials.tufo, 0.035));
  // SPONDE dell'altimetria: raccordano la pista abbassata (San Martino → Casato)
  // al piano circostante, che resta a quota 0. Bordo vicino alla pista = quota
  // pista, bordo lontano = quota 0. Senza, il nastro abbassato finiva SOTTO la
  // conchiglia e il prato (piatti) e spariva: il cavallo sembrava correre sul
  // mattone del centro piazza.
  const hPista = (s) => trackHeightAt(s.cum);
  const hZero = () => 0;
  // Striscia esterna: segue la quota della pista (i palchi là fuori scendono con lei).
  addAllestimento(createRibbonMesh((s) => bordoEsterno(s) - 1.5, (s) => bordoEsterno(s) - 0.25, materials.tufoDark, 0.025, hPista, hPista));
  // Striscia interna = SPONDA: dal bordo pista (quota pista) su fino alla
  // conchiglia del centro, che resta a quota 0 col suo pubblico.
  addAllestimento(createRibbonMesh(TRACK_HALF_WIDTH + 0.25, TRACK_HALF_WIDTH + 1.5, materials.tufoDark, 0.025, hPista, hZero));
  // LA PIAZZA SENZA IL PALIO: lo stesso anello, ma di mattoni come il resto del
  // Campo. Sta sotto al tufo e si vede solo quando il tufo non c'e' (estrazione).
  {
    const mattoni = makeHerringboneTexture();
    mattoni.repeat.set(24, 3);
    const matPiazza = new THREE.MeshStandardMaterial({ map: mattoni, color: 0xa89684, roughness: 0.97, metalness: 0 });
    const nuda = new THREE.Group();
    nuda.name = "PiazzaSenzaPalio";
    nuda.add(createRibbonMesh(bordoEsterno, TRACK_HALF_WIDTH, matPiazza, 0.030));
    nuda.add(createRibbonMesh((s) => bordoEsterno(s) - 1.5, (s) => bordoEsterno(s) - 0.25, matPiazza, 0.022, hPista, hPista));
    nuda.add(createRibbonMesh(TRACK_HALF_WIDTH + 0.25, TRACK_HALF_WIDTH + 1.5, matPiazza, 0.022, hPista, hZero));
    nuda.visible = false;
    scene.add(nuda);
    state.piazzaNuda = nuda;
  }
  // #2 — BORDO DI TRAVERTINO BIANCO (colonnino): la fascia chiara di marmo che cinge
  // il Campo fra il tufo della pista e il lastricato, come nella realtà. Solo grafica.
  const travMat = new THREE.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 0.68, metalness: 0 });
  scene.add(createRibbonMesh(TRACK_HALF_WIDTH + 1.5, TRACK_HALF_WIDTH + 2.0, travMat, 0.045, hZero, hZero));

  buildTufoScuffs();
  buildCampoLandmarks();
  // ── SCENOGRAFIA (moduli della chat grafica) ────────────────────────────────
  // Steccati, palchi e pubblico. I moduli non conoscono la pista: gliela passiamo
  // noi con queste quattro funzioni, così restano additivi e nessuna costante del
  // tracciato viene toccata.
  const scenaCtx = {
    campioni: track.samples,
    fuori: campoOutward,
    largoEsterno: (s) => TRACK_HALF_WIDTH + mossaFlareAt(s.cum) - trackNarrowAt(s.cum),
    largoInterno: () => TRACK_HALF_WIDTH,
    quota: (s) => trackHeightAt(s.cum),
  };
  scenaCtxRef = scenaCtx;   // lo usa anche buildCurvePadding per la palizzata del Casato
  // try/catch: se un modulo della scenografia fallisce, il GIOCO deve partire
  // comunque (meglio una piazza spoglia che una schermata nera).
  // (Il workaround sulla staccionata interna è stato rimosso: la chat grafica ha
  // corretto stazioni() perché segua la NORMALE della pista invece della radiale.
  // Verificato: distanza dal bordo 12.10 costante in rettilineo, San Martino e Casato.)
  //  · `mossa`  = niente palancata nella zona dei canapi/tondino/rincorsa (−28..0),
  //               altrimenti si tapperebbe il varco d'ingresso della rincorsa;
  //  · `palazzo` = zona del Palazzo Pubblico: palchi delle comparse, Cappella di
  //               Piazza ai piedi della Torre ed Entrone, col varco nelle gradinate.
  try {
    state.scenaPiazza = costruisciPiazza(scenaCtx, {
      // LA MOSSA: il verrocchio del mossiere (pulpito ottagonale) al canape
      // anteriore, dietro di lui il palco dei Capitani nel varco delle gradinate,
      // e il fronte che si allarga 'a punta' invece di seguire la curva. Il varco
      // nella palancata non serve più (nelle foto è continua anche alla mossa):
      // torna con varcoPalancata:true + da/a se in gara dovesse servire.
      // punta 0.45 e non 1.6: le facciate stanno su un anello di raggio fisso,
      // calcolato sul punto in cui la pista e' PIU' LARGA — che e' proprio la
      // mossa — piu' 5.31 di palchi e 0.45 di stacco. Al vertice il margine e'
      // quindi 0.50 secchi: con 1.6 il fronte dei palchi entrava 1.10 DENTRO i
      // palazzi. Per una punta piu' marcata va allargato il filo della cortina.
      mossa: { verrocchioCum: positiveMod(MOSSA_FRONT_LIMIT, track.length), punta: 0.45 },
      // LE VIE che sboccano in Piazza: dove entrano non ci sono gradinate, ma i
      // fotografi a delimitare la pista. La Costarella — la terza — e' gia' dentro
      // l'opzione `mossa` qui sopra, col suo ponte dei Capitani.
      // Due: quella all'esterno di SAN MARTINO (sbocca PRIMA dell'ingresso in
      // curva, non all'apice) con la sua impalcatura, e quella dal lato
      // dell'UFFICIO TURISTICO, fra il Casato e la mossa, che impalcatura non ha.
      // ⚠️ La seconda e' una posizione STIMATA: da correggere guardandola.
      vie: NARROW_READY ? [
        { cum: SM_IN - 3.5, larghezza: 6, impalcatura: true, figure: 6 },
        { cum: CAS_OUT + 25.5, larghezza: 6, impalcatura: false },
      ] : [],
      palazzo: { cum: getStraightCenterP() },
    }).gruppo;
    scene.add(state.scenaPiazza);
  } catch (e) { console.error("scenografia piazza:", e); }

  for (let i = 0; i < track.samples.length; i += 11) {
    const s = track.samples[i];
    // SOLO lato ESTERNO (side −1). Sul lato interno i paracarri sono stati tolti:
    // nella piazza vera non ci sono blocchi di pietra davanti al colonnino, e così
    // la staccionata interna può stare accostata al bordo com'è nella realtà.
    [-1].forEach((side) => {
      const larg = TRACK_HALF_WIDTH + 0.2 + (side < 0 ? mossaFlareAt(s.cum) : 0);
      const p = s.point.clone().addScaledVector(s.normal, side * larg);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.32), materials.stone);
      block.position.set(p.x, 0.18, p.z);
      block.rotation.y = s.yaw;
      block.castShadow = true;
      block.receiveShadow = true;
      addAllestimento(block);
    });
  }

  buildStartLine();
  buildVerrocchino();
  buildCurveChevrons();
  buildCurvePadding();
  // Cortina di palazzi: pochi fronti lunghi, anello chiuso. Il varco 0.565–0.635
  // lascia il posto al Palazzo Pubblico + Torre del Mangia, che restano nostri
  // (ensurePalazzoObjects, già costruito qui sopra).
  try {
    scene.add(costruisciPalazzi(scenaCtx, {
      fondoPalchi: PALCHI_FONDO,
      varchi: [{ da: 0.565, a: 0.635 }],
      // Cortina alta e uniforme, tranne UNO: quello basso alla curva di San
      // Martino. Legato a SM_IN/SM_OUT come la via del Casato, non a un numero
      // scritto a mano: se il tracciato cambia, il palazzo basso lo segue.
      bassi: NARROW_READY ? [{ giro: (SM_IN + SM_OUT) * 0.5 / track.length }] : [],
      strade: [
        // Le bocche in cortina delle due vie qui sopra (stessi cum, se no la via
        // e' aperta nei palchi ma murata nei palazzi, o viceversa).
        ...(NARROW_READY ? [
          { giro: (SM_IN - 3.5) / track.length, larghezza: 6 },
          { giro: (CAS_OUT + 25.5) / track.length, larghezza: 6 },
        ] : []),
        // La COSTARELLA dei Barbieri, che sbuca in piazza subito dopo il canape:
        // sopra la sua bocca passa il ponte dei Capitani (modulo scenografia).
        { giro: 5.5 / track.length, larghezza: 7 },
        // Via del Casato, all'APICE della curva. Legata a CAS_IN/CAS_OUT e non a
        // un numero fisso: il raggio del Casato e' stato stretto e l'apice si e'
        // spostato, un valore scritto a mano sarebbe rimasto indietro.
        { giro: (NARROW_READY ? (CAS_IN + CAS_OUT) * 0.5 / track.length : 0.813), larghezza: 6 },
      ],
    }).gruppo);
  } catch (e) { console.error("scenografia palazzi:", e); }
  ensurePalazzoObjects();   // il Palazzo Pubblico accurato (unico), sempre visibile
  buildCrowdAndFlags();
  buildSpeedLines();
}

// Cielo procedurale: cupola con gradiente orizzonte (arancio siena) -> apice
// (blu). Sprite del sole additivo e qualche nuvola che ruota lenta. Su mobile
// si salta lo shader e si usa un colore di sfondo piatto per le prestazioni.
function buildSky(sun) {
  if (window.innerWidth < 768) {
    scene.background = new THREE.Color(0xc8924a);
    return;
  }

  const skyGeo = new THREE.SphereGeometry(380, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(dot(normalize(vWorldPos), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.89, 0.63, 0.30);
        vec3 apex = vec3(0.33, 0.55, 0.78);
        vec3 col = mix(horizon, apex, smoothstep(0.0, 0.62, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.scale.set(1, -1, 1); // capovolta: si vede dall'interno
  scene.add(sky);
  // Sfondo = blu dell'apice del cielo: se anche un lembo di cupola finisse oltre il
  // far della camera, dietro si vede QUESTO (non il nero di default). Rete di sicurezza.
  scene.background = new THREE.Color(0x548cc7);

  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xfff4c0,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.55,
    fog: false,
    depthWrite: false
  }));
  // Sole lontano, verso la cupola del cielo: così resta un sole distante nella
  // visuale di gioco ma, dall'alto, sta sopra la camera e non appare come un
  // riquadro luminoso sospeso sul campo.
  sunSprite.position.copy(sun.position).normalize().multiplyScalar(330);
  sunSprite.scale.setScalar(34);
  scene.add(sunSprite);

  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    fog: false
  });
  const cloudGeo = new THREE.PlaneGeometry(22, 8);
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * TAU;
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.position.set(Math.cos(angle) * 120, 68, Math.sin(angle) * 120);
    cloud.rotation.x = -Math.PI / 2;
    state.clouds.push(cloud);
    scene.add(cloud);
  }
}

function buildCampoShellRibs() {
  const focus = new THREE.Vector3(0, 0.08, -37.8);
  const ribMat = new THREE.MeshBasicMaterial({ color: 0x8a5a37, transparent: true, opacity: 0.46 });
  for (let i = 0; i <= 12; i += 1) {
    const t = lerp(0.12, 0.88, i / 12);
    const s = sampleAt(track.length * t);
    const inside = s.point.clone().addScaledVector(campoOutward(s.point), -TRACK_HALF_WIDTH * 1.3).setY(0.085);
    const rib = makeCylinderBetween(focus, inside, 0.018, ribMat);
    rib.castShadow = false;
    rib.receiveShadow = false;
    scene.add(rib);
  }
  const fanArc = createRibbonMesh(-TRACK_HALF_WIDTH * 1.28, -TRACK_HALF_WIDTH * 1.22, ribMat, 0.086);
  fanArc.receiveShadow = false;
  scene.add(fanArc);
}

function buildTrackBarriers(opts = {}) {
  // soloInterno: costruisce SOLTANTO la staccionata del lato interno. Serve perché
  // quella del modulo di scenografia si deforma nelle curve (vedi handoff §19):
  // qui si usa la NORMALE della pista, che segue il bordo anche a San Martino e
  // al Casato. Tutto il resto (palancata, palchi, pubblico) resta del modulo.
  const soloInterno = !!opts.soloInterno;
  // ── PUBBLICO SUI PALCHI ESTERNI ────────────────────────────────────────────
  // Spettatori sulle tre file di panche che corrono lungo tutto l'anello, in
  // un'unica InstancedMesh (1 draw call). Stessi offset delle panche: svasatura
  // dei canapi, strettoie degli imbuti e quota altimetrica. Statici: le
  // reazioni animate restano al pubblico del centro piazza.
  if (!soloInterno) (() => {
    const cols = [0x7a6a58, 0x55606b, 0x8a8478, 0x6b4a3a, 0x9a9488, 0x40484f,
      0xb8a890, 0xcfc8ba, 0x736d63, 0x84725c, 0xa89a86, 0xc44135, 0x2e689b, 0x287b55, 0xe0b84a];
    const MAX_PALCHI = 4200;
    const geo = new THREE.CapsuleGeometry(0.11, 0.28, 1, 5);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), MAX_PALCHI);
    const dummy = new THREE.Object3D();
    const tinta = new THREE.Color();
    let n = 0;
    const passo = 2;   // un campione ogni 2 ≈ una persona ogni ~0.9 lungo l'anello
    for (let i = 0; i < track.samples.length && n < MAX_PALCHI; i += passo) {
      const s = track.samples[i];
      const outward = campoOutward(s.point);
      for (let row = 0; row < 3; row += 1) {
        if (Math.random() < 0.18) continue;   // qualche buco: palchi vivi, non a pettine
        const off = TRACK_HALF_WIDTH + mossaFlareAt(s.cum) - trackNarrowAt(s.cum) + 2.4 + row * 0.48
          + (Math.random() - 0.5) * 0.18;
        const p = s.point.clone().addScaledVector(outward, off);
        dummy.position.set(
          p.x + (Math.random() - 0.5) * 0.2,
          0.52 + row * 0.28 + trackHeightAt(s.cum) + Math.random() * 0.06,
          p.z + (Math.random() - 0.5) * 0.2
        );
        const sc = 0.62 + Math.random() * 0.3;
        dummy.scale.set(sc, sc * (0.9 + Math.random() * 0.35), sc);
        dummy.rotation.y = Math.atan2(-outward.x, -outward.z) + (Math.random() - 0.5) * 0.5;   // guardano la pista
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        tinta.setHex(cols[Math.floor(Math.random() * cols.length)]);
        tinta.multiplyScalar(0.7 + Math.random() * 0.55);
        im.setColorAt(n, tinta);
        n += 1;
        if (n >= MAX_PALCHI) break;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = false;
    im.name = "PubblicoPalchi";
    addPalchi(im);
  })();

  const step = 8;
  for (let i = 0; i < track.samples.length; i += step) {
    const s = track.samples[i];
    const next = track.samples[(i + step) % track.samples.length];
    const outwardSign = s.normal.dot(campoOutward(s.point)) >= 0 ? 1 : -1;
    [-1, 1].forEach((side) => {
      const outerSide = side > 0;
      if (soloInterno && outerSide) return;   // l'esterno lo fa il modulo
      // La barriera ESTERNA deve seguire la svasatura dei canapi. Senza questo,
      // restava alla larghezza vecchia e tagliava in mezzo al corridoio della
      // rincorsa, che ora corre più fuori: la rincorsa si trovava la ringhiera
      // addosso proprio dove deve entrare.
      // …e il profilo di larghezza variabile: negli imbuti (San Martino,
      // cappella, Casato) i palchi ENTRANO verso la pista.
      const flareHere = outerSide ? mossaFlareAt(s.cum) - trackNarrowAt(s.cum) : 0;
      const flareNext = outerSide ? mossaFlareAt(next.cum) - trackNarrowAt(next.cum) : 0;
      const baseOff = outwardSign * side * (TRACK_HALF_WIDTH + 0.72);
      const p = s.point.clone().addScaledVector(s.normal, baseOff + outwardSign * side * flareHere);
      const q = next.point.clone().addScaledVector(next.normal, baseOff + outwardSign * side * flareNext);
      // Altimetria visiva: barriere, panche e striscioni seguono la quota della pista.
      const hQui = trackHeightAt(s.cum);
      const hNext = trackHeightAt(next.cum);
      const railHeight = (outerSide ? 0.86 : 0.62) + hQui;
      const lowerHeight = (outerSide ? 0.48 : 0.34) + hQui;
      const railHeightNext = (outerSide ? 0.86 : 0.62) + hNext;
      const lowerHeightNext = (outerSide ? 0.48 : 0.34) + hNext;
      const post = new THREE.Mesh(shared.barrierPostGeometry, materials.barrierDark);
      post.position.set(p.x, hQui + (outerSide ? 0.86 : 0.62) * 0.5, p.z);
      post.rotation.y = s.yaw;
      // I pali sono troppo sottili e numerosi: con il sole basso del tardo
      // pomeriggio proiettano un ventaglio di ombre lunghe e rumorose sulla
      // pista. Niente ombra propria: l'atmosfera resta calda senza l'artefatto.
      post.castShadow = false;
      addAllestimento(post);

      const topRail = makeCylinderBetween(p.clone().setY(railHeight), q.clone().setY(railHeightNext), outerSide ? 0.045 : 0.032, materials.barrier);
      const lowRail = makeCylinderBetween(p.clone().setY(lowerHeight), q.clone().setY(lowerHeightNext), outerSide ? 0.032 : 0.024, materials.barrierDark);
      // Stesso motivo dei pali: corrimano sottili e continui lungo tutto il
      // tracciato, niente ombra propria per evitare la striatura sulla pista.
      topRail.castShadow = false;
      lowRail.castShadow = false;
      addAllestimento(topRail, lowRail);

      if (outerSide && i % (step * 2) === 0) {
        const mid = p.clone().lerp(q, 0.5);
        const banner = new THREE.Mesh(shared.bannerGeometry, materials.bannerPanel);
        banner.position.set(mid.x, 0.55 + (hQui + hNext) * 0.5, mid.z);
        banner.rotation.y = s.yaw;
        banner.castShadow = false;
        addAllestimento(banner);
      }
    });

    if (i % (step * 3) === 0) {
      const outward = campoOutward(s.point);
      const tangentYaw = s.yaw + Math.PI / 2;
      for (let row = 0; row < 3; row += 1) {
        // + svasatura − strettoia: senza, le panche finirebbero DENTRO la pista
        // allargata ai canapi o staccate dai palchi negli imbuti.
        const benchPos = s.point.clone().addScaledVector(outward, TRACK_HALF_WIDTH + mossaFlareAt(s.cum) - trackNarrowAt(s.cum) + 2.4 + row * 0.48);
        const bench = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.12, 0.32), materials.wood);
        bench.position.set(benchPos.x, 0.34 + row * 0.28 + trackHeightAt(s.cum), benchPos.z);
        bench.rotation.y = tangentYaw;
        bench.castShadow = true;
        addAllestimento(bench);
      }
    }
  }
}

function buildStartLine() {
  const s = sampleAt(0);
  // ATTENZIONE: sampleAt() NON restituisce `cum` (ce l'hanno solo i campioni grezzi
  // di track.samples). Qui la linea sta a progress 0, quindi la svasatura si calcola
  // da quel valore: usando s.cum si otteneva NaN e l'intero canape spariva.
  const flareQui = mossaFlareAt(0);
  const stripeSpacing = 0.84;
  // Verso l'ESTERNO le strisce arrivano fino al bordo svasato, altrimenti la linea
  // si interrompeva a metà del tratto allargato.
  const stripeCount = Math.floor(TRACK_HALF_WIDTH / stripeSpacing);
  const stripeCountOut = Math.floor((TRACK_HALF_WIDTH + flareQui) / stripeSpacing);
  for (let i = -stripeCountOut; i < stripeCount; i += 1) {
    const p = s.point.clone().addScaledVector(s.normal, i * stripeSpacing + stripeSpacing * 0.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.035, 1.05), i % 2 === 0 ? materials.white : materials.black);
    box.position.set(p.x, 0.075, p.z);
    box.rotation.y = s.yaw + Math.PI / 2;
    addAllestimento(box);
  }
  // Il canape ANTERIORE tocca i PALCHI ESTERNI: la ringhiera sta 0.72 oltre il
  // bordo svasato della pista, e il canapo si ancora lì — non deve restare un
  // varco fra la fune e lo steccato.
  const estCanape = -(TRACK_HALF_WIDTH + flareQui + 0.72);
  const a = s.point.clone().addScaledVector(s.normal, estCanape).addScaledVector(s.tangent, -0.8);
  const b = s.point.clone().addScaledVector(s.normal, TRACK_HALF_WIDTH).addScaledVector(s.tangent, -0.8);
  const c = s.point.clone().addScaledVector(s.normal, estCanape).addScaledVector(s.tangent, 0.95);
  const d = s.point.clone().addScaledVector(s.normal, TRACK_HALF_WIDTH).addScaledVector(s.tangent, 0.95);
  state.canapi = new THREE.Group();
  state.canapi.add(makeCylinderBetween(a.clone().setY(0.54), b.clone().setY(0.54), 0.058, materials.rope));
  state.canapi.add(makeCylinderBetween(c.clone().setY(0.46), d.clone().setY(0.46), 0.048, materials.redRope));
  const groundCanapo = new THREE.Group();
  groundCanapo.add(makeCylinderBetween(a.clone().setY(0.095), b.clone().setY(0.095), 0.025, materials.rope));
  groundCanapo.add(makeCylinderBetween(c.clone().setY(0.1), d.clone().setY(0.1), 0.02, materials.redRope));
  addAllestimento(groundCanapo);
  [a, b, c, d].forEach((point) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.15, 8), materials.wood);
    post.position.set(point.x, 0.58, point.z);
    post.castShadow = true;
    addAllestimento(post);
  });
  addAllestimento(state.canapi);
}

// Verrocchino + canapo posteriore: il secondo canapo che chiude il corridoio
// della mossa sul retro, con il paletto di legno (verrocchino) sul lato esterno
// attorno a cui la rincorsa si lancia. Nascosto finché non inizia la mossa.
function buildVerrocchino() {
  const front = sampleAt(0);
  const back = sampleAt(MOSSA_BACK_LIMIT);
  const group = new THREE.Group();
  group.name = "canapoPosteriore";

  // Corda posteriore SOLLEVATA: solo dal verrocchino al bordo destro. Il tratto a
  // sinistra del paletto (verso il bordo sinistro) resta aperto: è il varco da cui
  // la rincorsa si lancia.
  const ropeInner = back.point.clone().addScaledVector(back.normal, VERROCCHINO_LANE).setY(0.52);
  const ropeRight = back.point.clone().addScaledVector(back.normal, TRACK_HALF_WIDTH).setY(0.52);
  group.add(makeCylinderBetween(ropeInner, ropeRight, 0.05, materials.rope));
  // Doppino a terra: attraversa tutta la pista e segna la linea del secondo canapo.
  const groundA = back.point.clone().addScaledVector(back.normal, -TRACK_HALF_WIDTH).setY(0.1);
  const groundB = back.point.clone().addScaledVector(back.normal, TRACK_HALF_WIDTH).setY(0.1);
  group.add(makeCylinderBetween(groundA, groundB, 0.022, materials.rope));

  // Palo del canapo posteriore al bordo destro.
  const rightBase = back.point.clone().addScaledVector(back.normal, TRACK_HALF_WIDTH);
  const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.04, 8), materials.wood);
  rightPost.position.set(rightBase.x, 0.52, rightBase.z);
  rightPost.castShadow = true;
  group.add(rightPost);

  // (Nessun paletto al bordo esterno: il varco della rincorsa è delimitato dal
  // verrocchino da un lato e dallo steccato dall'altro.)

  // VERROCCHINO: il paletto di legno robusto piantato sul secondo canapo, al
  // confine interno del varco. Pomello dorato in cima. La rincorsa entra nello
  // spazio fra questo paletto e il bordo sinistro.
  const verroPos = back.point.clone().addScaledVector(back.normal, VERROCCHINO_LANE);
  const verro = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1.3, 12), materials.wood);
  verro.position.set(verroPos.x, 0.65, verroPos.z);
  verro.castShadow = true;
  group.add(verro);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), materials.gold);
  knob.position.set(verroPos.x, 1.32, verroPos.z);
  knob.castShadow = true;
  group.add(knob);

  // (Nessuna corda longitudinale fra i due canapi: nel Palio reale non esiste.
  // Lo spazio della mossa è delimitato solo dai due canapi trasversali.)

  // Materiali privati del gruppo (clonati): così la dissolvenza dopo il via non
  // intacca le altre corde/legni della scena che condividono i materiali base.
  group.traverse((child) => {
    if (child.material) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 1;
    }
  });

  group.visible = false;
  scene.add(group);
  state.canapiPosteriore = group;
}

// Crea il cartello/striscione "MOSSA" sopra la linea di partenza (alto a sinistra
// del semicerchio). Elemento generico, senza marchi o stemmi ufficiali.
function makeSignTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Fondo drappo chiaro con bordo scuro.
    ctx.fillStyle = "#efe3c4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#7a1f1f";
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.fillStyle = "#7a1f1f";
    ctx.font = "bold 78px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}



function buildTufoScuffs() {
  // Due InstancedMesh (per materiale) al posto di 520 mesh singole: da 520
  // draw call a 2. Stesso identico aspetto.
  const TOT = 520;
  const nHi = Math.ceil(TOT / 8);
  const imScuff = new THREE.InstancedMesh(shared.tufoScuffGeometry, materials.tufoScuff, TOT - nHi);
  const imHi = new THREE.InstancedMesh(shared.tufoScuffGeometry, materials.tufoHighlight, nHi);
  const dummy = new THREE.Object3D();
  let iS = 0, iH = 0;
  for (let i = 0; i < TOT; i += 1) {
    const cumScuff = positiveMod((i / TOT) * track.length + (Math.random() - 0.5) * 5.5, track.length);
    const s = sampleAt(cumScuff);
    const lane = lerp(-TRACK_HALF_WIDTH + 0.38, TRACK_HALF_WIDTH - 0.38, Math.random());
    const p = s.point.clone().addScaledVector(s.normal, lane);
    // I segni sul tufo seguono la quota (sampleAt non dà cum: si usa quello calcolato).
    dummy.position.set(p.x, 0.091 + (i % 5) * 0.0008 + trackHeightAt(cumScuff), p.z);
    dummy.rotation.set(-Math.PI / 2, 0, s.yaw + (Math.random() - 0.5) * 0.55);
    dummy.scale.set(0.55 + Math.random() * 1.5, 0.55 + Math.random() * 1.65, 1);
    dummy.updateMatrix();
    if (i % 8 === 0) imHi.setMatrixAt(iH++, dummy.matrix);
    else imScuff.setMatrixAt(iS++, dummy.matrix);
  }
  imScuff.count = iS; imHi.count = iH;
  imScuff.instanceMatrix.needsUpdate = true; imHi.instanceMatrix.needsUpdate = true;
  imScuff.renderOrder = 1; imHi.renderOrder = 1;
  imScuff.castShadow = false; imHi.castShadow = false;
  imScuff.name = "Tufo scuffs"; imHi.name = "Tufo scuffs hi";
  addAllestimento(imScuff, imHi);
}

function buildCampoLandmarks() {
  // Fonte Gaia: all'apice dell'arco (frazione ~0.13, lato opposto al Palazzo
  // Pubblico che sta sul rettilineo), appena dentro il bordo interno della pista,
  // come nella Piazza del Campo reale.
  const fountainAnchor = sampleAt(track.length * 0.13);
  const fountainInside = campoOutward(fountainAnchor.point).multiplyScalar(-1);
  const fountainPos = fountainAnchor.point.clone().addScaledVector(fountainInside, TRACK_HALF_WIDTH * 1.4);
  const fountain = new THREE.Group();

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.22, 1.45), materials.stone);
  plinth.position.y = 0.17;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  fountain.add(plinth);

  const basin = new THREE.Mesh(new THREE.BoxGeometry(2.78, 0.18, 0.95), materials.barrier);
  basin.position.y = 0.38;
  basin.castShadow = true;
  basin.receiveShadow = true;
  fountain.add(basin);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(2.28, 0.56), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.48;
  fountain.add(water);

  for (let i = -1; i <= 1; i += 1) {
    const ornament = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), materials.white);
    ornament.position.set(i * 0.72, 0.58, -0.02);
    ornament.scale.set(1, 1.45, 1);
    ornament.castShadow = true;
    fountain.add(ornament);
  }

  fountain.position.set(fountainPos.x, 0, fountainPos.z);
  fountain.rotation.y = fountainAnchor.yaw + Math.PI / 2;
  scene.add(fountain);
}

let scenaCtxRef = null;   // contesto geometrico condiviso coi moduli di scenografia
function buildCurvePadding() {
  // Materassi di protezione SOLO a San Martino (al Casato, nella realtà, NON ci
  // sono): file di cuscini bianco-crema con fascia rossa addossati al muro
  // esterno. Decorativi. Seguono la strettoia e la quota della pista.
  const padMat = new THREE.MeshStandardMaterial({ color: 0xe6ddca, roughness: 0.9, metalness: 0 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xa83c30, roughness: 0.82, metalness: 0 });
  const step = 5;
  for (let i = 0; i < track.samples.length; i += step) {
    const s = track.samples[i];
    // TRATTO UNICO E CONTINUO: dall'ingresso di San Martino fino a sotto la Torre
    // del Mangia (la Cappella sta a ~SM_OUT+14). Prima si filtrava campione per
    // campione sulla curvatura: dove scendeva sotto soglia restavano BUCHI in mezzo
    // alla fila. Ora è un intervallo unico, quindi la fila non si interrompe mai.
    if (NARROW_READY) {
      if (s.cum < SM_IN - 1 || s.cum > SM_OUT + 17) continue;
    } else if (s.curve < 0.34) continue;                 // ripiego se le curve non sono ancora note
    if (NARROW_READY && s.cum > CAS_IN - 20) continue;   // Casato: niente materassi
    const next = track.samples[(i + step) % track.samples.length];
    // +0.05 (era +0.42): la palancata della scenografia sta a +0.35, i materassi
    // devono restare DAVANTI a lei, come in Piazza.
    const offQui = TRACK_HALF_WIDTH - trackNarrowAt(s.cum) + 0.05;
    const offNext = TRACK_HALF_WIDTH - trackNarrowAt(next.cum) + 0.05;
    const a = s.point.clone().addScaledVector(campoOutward(s.point), offQui);
    const b = next.point.clone().addScaledVector(campoOutward(next.point), offNext);
    const mid = a.clone().lerp(b, 0.5);
    const len = a.distanceTo(b) * 1.12;   // si sovrappongono: nessuna fessura fra un cuscino e l'altro
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const hQui = trackHeightAt(s.cum);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.02, len), padMat);
    pad.position.set(mid.x, 0.6 + hQui, mid.z);
    pad.rotation.y = yaw;
    pad.castShadow = true;
    pad.receiveShadow = true;
    addAllestimento(pad);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, len), bandMat);
    band.position.set(mid.x, 0.78 + hQui, mid.z);
    band.rotation.y = yaw;
    addAllestimento(band);
  }
  // Al CASATO: palizzata di legno del modulo di scenografia (tavoloni verticali,
  // colmo e puntoni sul retro) al posto del vecchio loop di assi.
  if (NARROW_READY && scenaCtxRef) {
    try {
      addAllestimento(costruisciPalizzata(scenaCtxRef, { da: CAS_IN + 6, a: CAS_OUT + NARROW_RELEASE + 6 }));
    } catch (e) { console.error("palizzata Casato:", e); }
  }
}

function buildCurveChevrons() {
  for (let i = 0; i < track.samples.length; i += 18) {
    const s = track.samples[i];
    if (s.curve < 0.48) continue;
    const side = Math.sign(s.signedCurve || 1);
    const p = s.point.clone().addScaledVector(s.normal, side * (TRACK_HALF_WIDTH + 1.18));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), materials.wood);
    post.position.set(p.x, 0.45, p.z);
    post.castShadow = true;
    scene.add(post);

    const chevron = new THREE.Mesh(shared.chevronGeometry, materials.gold);
    chevron.position.set(p.x, 1.12, p.z);
    chevron.rotation.y = s.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    chevron.rotation.z = Math.PI / 2;
    chevron.castShadow = true;
    addAllestimento(chevron);
  }
}

function buildBuildings() {
  // Facciate dei palazzi senesi: ocra, terracotta, raw siena, pietra calda e
  // crema. Tinte varie e meno sature, niente parete tutta uguale e arancione.
  const wallMats = ["#b08a5e", "#a6694a", "#c2a079", "#9d7355", "#8f6a4e", "#b58a62", "#7c5a44", "#c8b189"].map((color) => makeMat(color, 0.93));
  // Finestre varie: alcune buie (vetro in ombra), alcune calde (interno
  // illuminato), alcune con persiane chiare o verdi. Materiali condivisi.
  const windowMats = ["#352a20", "#463626", "#caa46a", "#9c8a6a", "#5c6b52", "#3c2f24"]
    .map((c) => makeMat(c, 0.62));
  const baseMat = makeMat("#6a4e3a", 0.94);   // pianterreno in ombra / archi
  // Spettatori affacciati alle finestre: testa e spalle oltre il davanzale.
  // Solo su una parte delle finestre (~10%) per non appesantire la scena.
  const sillMats = ["#caa07a", "#b8895f", "#9c6b48", "#7a5a44", "#a8704a"].map((c) => makeMat(c, 0.9));
  const sillGeo = new THREE.CapsuleGeometry(0.085, 0.1, 3, 6);
  for (let i = 0; i < 104; i += 1) {
    const s = sampleAt((i / 104) * track.length);
    const outward = campoOutward(s.point);
    const outside = s.point.clone().addScaledVector(outward, TRACK_HALF_WIDTH + 5.8 + Math.random() * 2.2);
    const width = 3.0 + Math.random() * 3.0;
    const height = 5.2 + Math.random() * 5.2;
    const depth = 2.8 + Math.random() * 3.0;
    const building = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMats[i % wallMats.length]);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 1.08, 0.35, depth * 1.08), makeMat("#5d2f25", 0.88));
    roof.position.y = height + 0.2;
    roof.castShadow = true;
    building.add(roof);

    // Pianterreno più scuro: la base in ombra (archi/portici) stacca il volume
    // dal terreno e dà ai palazzi una lettura più realistica.
    const groundFloor = new THREE.Mesh(new THREE.BoxGeometry(width * 1.012, 1.15, depth * 1.012), baseMat);
    groundFloor.position.y = 0.58;
    groundFloor.castShadow = true;
    groundFloor.receiveShadow = true;
    building.add(groundFloor);

    const cols = Math.max(1, Math.floor(width / 1.05));
    const rows = Math.max(1, Math.floor(height / 1.6) - 1);
    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.04), windowMats[(x * 5 + y * 3 + i) % windowMats.length]);
        win.position.set((x - (cols - 1) / 2) * 0.84, 1.45 + y * 1.25, -depth / 2 - 0.026);
        building.add(win);
        if (Math.random() < 0.1) {
          const spettatore = new THREE.Mesh(sillGeo, sillMats[(x + y + i) % sillMats.length]);
          spettatore.position.set(win.position.x, win.position.y - 0.05, -depth / 2 - 0.085);
          spettatore.scale.set(1, 1.2, 0.85);
          building.add(spettatore);
        }
      }
    }

    if (i % 2 === 0) {
      for (let y = 1; y <= Math.min(rows, 3); y += 1) {
        const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.11, 0.34), materials.awning);
        awning.position.set(0, 1.28 + y * 1.22, -depth / 2 - 0.2);
        awning.rotation.x = -0.18;
        awning.castShadow = true;
        building.add(awning);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.68, 0.1, 0.08), materials.barrierDark);
        rail.position.set(0, 0.94 + y * 1.22, -depth / 2 - 0.28);
        rail.castShadow = true;
        building.add(rail);
      }
    }

    building.position.copy(outside);
    building.rotation.y = Math.atan2(outward.x, outward.z);
    scene.add(building);
  }
}

function buildPalazzo() {
  const base = new THREE.Group();
  const brick = makeMat("#9f5838", 0.88);
  const dark = makeMat("#5d2f25", 0.9);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(18, 5.2, 2.2), brick);
  wall.position.set(0, 2.6, 0);
  wall.castShadow = true;
  base.add(wall);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 13, 2.2), dark);
  tower.position.set(7, 6.5, -0.1);
  tower.castShadow = true;
  base.add(tower);
  for (let i = -7; i <= 7; i += 2) {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.08), makeMat("#f1c87c", 0.6));
    windowMesh.position.set(i, 3.4, -1.12);
    base.add(windowMesh);
  }
  const p = sampleAt(track.length * 0.60);
  const outward = campoOutward(p.point);
  base.position.copy(p.point.clone().addScaledVector(outward, TRACK_HALF_WIDTH + 6.2));
  base.rotation.y = Math.atan2(outward.x, outward.z);
  base.scale.set(1.15, 1.15, 1.15);
  scene.add(base);
}

function buildCrowdAndFlags() {
  // Folla vera: in maggioranza abiti neutri/spenti (taupe, grigi, beige, bruni)
  // con qua e là una macchia di colore di contrada. Niente coriandoli saturi.
  const crowdColors = [
    0x7a6a58, 0x55606b, 0x8a8478, 0x6b4a3a, 0x9a9488, 0x40484f,
    0xb8a890, 0xcfc8ba, 0x736d63, 0x84725c, 0x5c5650, 0xa89a86,
    0xc44135, 0x2e689b, 0x287b55, 0xe0b84a
  ];
  // LA FOLLA ANIMATA — quella che salta quando la Piazza esulta. Erano 900 mesh
  // separate: 900 draw call e 900 oggetti da disegnare a ogni fotogramma, ed era
  // di gran lunga la cosa più pesante della scena. Ora sono UNA InstancedMesh
  // sola (una draw call) e di ognuna si tiene solo il dato che serve ad animarla.
  // Il movimento è identico a prima.
  const folla = {
    mesh: null,
    dati: [],            // { x, z, baseY, scala, phase }
    dummy: new THREE.Object3D(),
    sporca: true,        // le matrici vanno riscritte a questo frame
  };
  state.folla = folla;
  const addPerson = (position, size = 1) => {
    folla.dati.push({ x: position.x, z: position.z, baseY: position.y, scala: size,
                      phase: Math.random() * TAU });
  };

  // (RIMOSSI i 420 figuranti in piedi lungo l'anello: stavano a un offset FISSO dal
  // bordo e non tenevano conto della svasatura dei canapi, quindi alla mossa finivano
  // SULLA PISTA di tufo, e altrove dentro le gradinate. Il pubblico esterno adesso è
  // quello seduto sui palchi della scenografia — circa settemila. Resta la folla del
  // centro piazza, che ha il suo test di contenimento.)

  // Pubblico nel cuore della piazza. Posizionamento con test di contenimento
  // reale: un punto candidato è accettato solo se sta dal lato INTERNO della
  // pista e ad almeno (mezza larghezza + margine) dalla linea centrale più
  // vicina. Così nessun figurante finisce sulla pista, né sull'arco né sul
  // rettilineo inferiore (dove lo scaling verso il centro falliva).
  const innerSamples = track.samples;
  const safeDist = TRACK_HALF_WIDTH + 2.6;
  let placed = 0;
  let guard = 0;
  const tmpVec = new THREE.Vector3();
  while (placed < 900 && guard < 40000) {
    guard += 1;
    const qx = (Math.random() * 2 - 1) * 60;
    const qz = CAMPO_BASE_Z + (Math.random() * 78 - 14);
    let bestD2 = Infinity;
    let bestS = null;
    for (let k = 0; k < innerSamples.length; k += 3) {
      const dx = innerSamples[k].point.x - qx;
      const dz = innerSamples[k].point.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = innerSamples[k];
      }
    }
    if (!bestS || Math.sqrt(bestD2) <= safeDist) continue;
    tmpVec.set(qx - bestS.point.x, 0, qz - bestS.point.z);
    if (tmpVec.dot(campoOutward(bestS.point)) >= 0) continue; // scarta il lato esterno
    addPerson(new THREE.Vector3(qx, 0.36 + Math.random() * 0.14, qz), 0.62 + Math.random() * 0.24);
    placed += 1;
  }

  // Costruita la lista, la folla animata diventa un solo oggetto in scena.
  if (folla.dati.length) {
    const im = new THREE.InstancedMesh(shared.crowdGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.95 }), folla.dati.length);
    const col = new THREE.Color();
    folla.dati.forEach((p, i) => im.setColorAt(i, col.setHex(crowdColors[Math.floor(Math.random() * crowdColors.length)])));
    im.castShadow = false;
    im.receiveShadow = false;
    im.name = "FollaAnimata";
    folla.mesh = im;
    scene.add(im);
  }

  // ── LA CONCHIGLIA PIENA ────────────────────────────────────────────────────
  // Migliaia di figuranti STATICI in un'unica InstancedMesh (un solo draw call):
  // è questa massa a dare il colpo d'occhio del Palio vero, la piazza gremita.
  // I 900 qui sopra restano individuali e ANIMATI (saltano con le reazioni della
  // folla); questi riempiono lo spazio fra loro. Stesso test di contenimento.
  const DENSE_COUNT = 16000;
  const denseMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  // Geometria DEDICATA a bassissimo dettaglio: da lontano una capsula con 5
  // spicchi è identica a una con 6+3, ma sono ~30 triangoli invece di ~84.
  // Su 16.000 istanze fa ~0.9 MILIONI di triangoli in meno a frame.
  const denseGeo = new THREE.CapsuleGeometry(0.11, 0.28, 1, 5);
  const dense = new THREE.InstancedMesh(denseGeo, denseMat, DENSE_COUNT);
  const dummy = new THREE.Object3D();
  const tinta = new THREE.Color();
  let nD = 0;
  let guardD = 0;
  while (nD < DENSE_COUNT && guardD < 400000) {
    guardD += 1;
    const qx = (Math.random() * 2 - 1) * 60;
    const qz = CAMPO_BASE_Z + (Math.random() * 78 - 14);
    let bestD2 = Infinity;
    let bestS = null;
    for (let k = 0; k < innerSamples.length; k += 4) {
      const dx = innerSamples[k].point.x - qx;
      const dz = innerSamples[k].point.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestS = innerSamples[k]; }
    }
    if (!bestS || Math.sqrt(bestD2) <= safeDist) continue;
    tmpVec.set(qx - bestS.point.x, 0, qz - bestS.point.z);
    if (tmpVec.dot(campoOutward(bestS.point)) >= 0) continue;   // scarta il lato esterno
    dummy.position.set(qx, 0.34 + Math.random() * 0.12, qz);
    const sc = 0.52 + Math.random() * 0.3;
    dummy.scale.set(sc, sc * (0.85 + Math.random() * 0.4), sc);
    dummy.rotation.y = Math.random() * TAU;
    dummy.updateMatrix();
    dense.setMatrixAt(nD, dummy.matrix);
    // Tinta per-persona: la palette della folla, con luminosità variata perché
    // da lontano non sembri un tappeto uniforme.
    tinta.setHex(crowdColors[Math.floor(Math.random() * crowdColors.length)]);
    tinta.multiplyScalar(0.7 + Math.random() * 0.55);
    dense.setColorAt(nD, tinta);
    nD += 1;
  }
  dense.count = nD;
  dense.instanceMatrix.needsUpdate = true;
  if (dense.instanceColor) dense.instanceColor.needsUpdate = true;
  dense.castShadow = false;
  dense.receiveShadow = false;
  dense.name = "FollaFitta";
  scene.add(dense);   // idem: la conchiglia e' gremita in ogni fase

  // (RIMOSSI i 54 pali con le bandiere di Contrada lungo l'anello: stavano a un
  // offset FISSO dal bordo, quindi dietro le gradinate erano invisibili quasi
  // ovunque ma spuntavano nei VARCHI della scenografia — dopo la mossa, alla bocca
  // della Costarella, e al Casato. Geometria e draw call sprecate per una cosa che
  // o non si vede o si vede dove non deve.)
}

function buildSpeedLines() {
  for (let i = 0; i < 17; i += 1) {
    const line = new THREE.Mesh(shared.boostGeometry, materials.boost.clone());
    line.visible = false;
    line.renderOrder = 2;
    state.speedLines.push(line);
    scene.add(line);
  }
}

function capsuleMesh(radius, length, materialOrColor) {
  const group = new THREE.Group();
  const material = typeof materialOrColor === "string" ? makeMat(materialOrColor, 0.82) : materialOrColor;
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10), material);
  body.scale.set(1, 0.62, length / radius);
  body.castShadow = true;
  group.add(body);
  return group;
}

// ── CORPORATURE DEI FANTINI ──────────────────────────────────────────────────
// I fantini del Palio sono adulti asciutti e compatti, non gemelli. Sei fisici
// credibili distribuiti in modo STABILE per Contrada (stesso id → stesso fisico,
// così il fantino di una Contrada non cambia corpo da un palio all'altro).
// I fattori restano vicini a 1: alterano la silhouette senza staccare il corpo
// dal cavallo, perché le posizioni di aggancio non vengono toccate.
// Fantini ASCIUTTI e slanciati (come i veri fantini del Palio: leggeri e magri).
// Nessuna variante "grassa": corpo/spalle restano ≤ 1.0; arti lunghi.
const JOCKEY_BUILDS = [
  { key: "asciutto", spalle: 0.92, arti: 1.08, testa: 0.94, corpo: 0.90 },
  { key: "minuto",   spalle: 0.86, arti: 1.05, testa: 0.98, corpo: 0.84 },
  { key: "filiforme", spalle: 0.88, arti: 1.14, testa: 0.92, corpo: 0.86 },
  { key: "lungo",    spalle: 0.90, arti: 1.16, testa: 0.90, corpo: 0.88 },
  { key: "scattante", spalle: 0.94, arti: 1.06, testa: 0.95, corpo: 0.90 },
  { key: "veterano", spalle: 0.95, arti: 1.10, testa: 0.93, corpo: 0.92 },
];
function jockeyBuildFor(contradaId) {
  let s = 0;
  for (let i = 0; i < contradaId.length; i += 1) s += contradaId.charCodeAt(i);
  return JOCKEY_BUILDS[s % JOCKEY_BUILDS.length];
}
// Carnagioni: fantini abbronzati da una stagione di corse, non tutti identici.
// Tonalità calde e desaturate — niente pelle rosata da manichino.
const JOCKEY_SKINS = ["#C98D5E", "#D7A06E", "#B87A4C", "#E0B085", "#A9683F", "#CE9666"];
function jockeySkinFor(contradaId) {
  return JOCKEY_SKINS[(contradaId.charCodeAt(0) + contradaId.length) % JOCKEY_SKINS.length];
}

function createHorseModel(contrada, isPlayer, horseIndex = 0) {
  const build = jockeyBuildFor(contrada.id);   // fisico del fantino di questa Contrada
  const skinMat = makeMat(jockeySkinFor(contrada.id), 0.72);   // stessa carnagione per testa e mani
  const group = new THREE.Group();
  group.userData.legs = [];
  group.userData.maneStrands = [];
  group.userData.tailStrands = [];
  group.userData.ears = [];
  group.userData.jockey = new THREE.Group();
  group.userData.firstPersonHidden = [];

  const variant = coatVariantForIndex(horseIndex);
  const markingSeed = contrada.id.length * 17 + contrada.name.charCodeAt(0) + horseIndex * 23;
  const coat = createHorseCoatMaterial(variant, "base", markingSeed);
  const darkCoat = createHorseCoatMaterial(variant, "dark", markingSeed + 5);
  const coatShade = createHorseCoatMaterial(variant, "shade", markingSeed + 11);
  const coatHighlight = createHorseCoatMaterial(variant, "highlight", markingSeed + 17);
  const muzzleMat = makeMat(variant.muzzle, 0.9);
  const clothA = makeMat(contrada.colors[0], 0.65);
  const clothB = makeMat(contrada.colors[1], 0.65);
  const clothC = makeMat(contrada.colors[2], 0.65);

  // ── CORPO: barile equino PROFONDO (più alto che largo), reso con forme LISCE nel
  // colore del mantello. Niente più pannelli/box scuri (sembravano nastro adesivo):
  // il volume muscolare e le ombre le dà la luce sulle superfici curve.
  const body = capsuleMesh(0.66, 1.66, coat);
  body.position.set(0, 1.2, -0.04);
  body.scale.set(0.56, 0.76, 1.42);       // barile LUNGO e non troppo profondo = tronco da cavallo
  group.userData.bodyCore = body;
  group.add(body);

  // Petto/brisket: sporge in avanti e in basso davanti alle spalle.
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), coat);
  chest.scale.set(0.74, 1.04, 0.92);
  chest.position.set(0, 1.04, 0.92);
  chest.castShadow = true;
  group.add(chest);

  // Groppa: alta dietro, degrada verso la coda (linea superiore corretta). Più
  // allungata che tonda, così non sembra una palla.
  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.56, 18, 12), coat);
  rump.scale.set(0.82, 0.94, 1.0);
  rump.position.set(0, 1.22, -0.86);
  rump.rotation.x = 0.14;
  rump.castShadow = true;
  group.add(rump);

  // Garrese: rilievo liscio dove il collo entra nel dorso.
  const withers = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), coat);
  withers.scale.set(0.56, 0.72, 1.02);
  withers.position.set(0, 1.52, 0.46);
  withers.castShadow = true;
  group.add(withers);

  // Ventre: risalita verso il fianco (pancia retratta), tono leggermente più scuro.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 10), coatShade);
  belly.scale.set(0.56, 0.56, 1.24);
  belly.position.set(0, 0.94, -0.04);
  belly.castShadow = true;
  group.add(belly);

  [-1, 1].forEach((side) => {
    // Spalla: piano muscolare liscio inclinato, TUCCATO nel torace (non sporge).
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 10), coat);
    shoulder.scale.set(0.4, 1.02, 0.66);
    shoulder.position.set(side * 0.26, 1.12, 0.56);
    shoulder.rotation.set(0.3, 0, side * 0.22);
    shoulder.castShadow = true;
    group.add(shoulder);

    // Coscia: massa muscolare liscia della groppa, TUCCATA (rifinisce, non sporge).
    const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), coat);
    haunch.scale.set(0.44, 0.88, 0.76);
    haunch.position.set(side * 0.26, 1.02, -0.84);
    haunch.rotation.z = -side * 0.14;
    haunch.castShadow = true;
    group.add(haunch);
  });

  // Collo: più LUNGO e affusolato (si assottiglia verso la nuca), leggermente
  // arcuato. Un rilievo sopra fa da criniera/incollatura (crest).
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.74, 5, 9), coat);
  neck.position.set(0, 1.6, 1.06);
  neck.rotation.x = -0.66;
  neck.scale.set(0.88, 1.06, 0.92);
  neck.castShadow = true;
  group.userData.neck = neck;
  group.add(neck);

  const crest = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.62, 4, 7), coat);
  crest.position.set(0, 1.74, 1.02);
  crest.rotation.x = -0.62;
  crest.scale.set(0.8, 1.0, 0.9);
  crest.castShadow = true;
  group.add(crest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), coat);
  head.scale.set(0.72, 0.92, 1.36);
  head.position.set(0, 1.72, 1.62);
  head.rotation.x = -0.15;
  head.castShadow = true;
  group.userData.head = head;
  group.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), muzzleMat);
  muzzle.scale.set(0.84, 0.64, 1.38);
  muzzle.position.set(0, 1.6, 2.04);
  muzzle.castShadow = true;
  group.add(muzzle);

  [-0.065, 0.065].forEach((x) => {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.025, 7, 5), materials.black);
    nostril.position.set(x, 1.56, 2.22);
    nostril.scale.set(1, 0.7, 0.5);
    group.add(nostril);
  });

  if (markingSeed % 3 !== 1) {
    const blaze = new THREE.Mesh(new THREE.BoxGeometry(markingSeed % 2 ? 0.052 : 0.08, 0.26, 0.015), materials.white);
    blaze.position.set(0, 1.82, 1.92);
    blaze.rotation.x = -0.22;
    group.add(blaze);
  } else {
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 5), materials.white);
    star.scale.set(1, 0.65, 0.25);
    star.position.set(0, 1.88, 1.78);
    group.add(star);
  }

  // ── OCCHI: cornea umida (poco ruvida = riflesso morbido), iride scura ambrata e
  // un puntino speculare bianco: è il riflesso nell'occhio a rendere il cavallo "vivo".
  const corneaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#241813"), roughness: 0.12, metalness: 0.0 });
  const irisMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#3a2413"), roughness: 0.35, metalness: 0.0 });
  [-0.185, 0.185].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), corneaMat);
    eye.position.set(x, 1.77, 1.85);
    eye.scale.set(0.92, 1.0, 0.82);
    eye.castShadow = true;
    group.add(eye);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), irisMat);
    iris.position.set(x + (x > 0 ? 0.012 : -0.012), 1.77, 1.885);
    iris.scale.set(1, 1, 0.55);
    group.add(iris);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), materials.white);
    glint.position.set(x + (x > 0 ? 0.03 : -0.03), 1.795, 1.9);
    group.add(glint);
  });

  [-0.16, 0.16].forEach((x) => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 6), darkCoat);
    ear.position.set(x, 2.02, 1.52);
    ear.rotation.x = -0.32;
    ear.rotation.z = x < 0 ? 0.14 : -0.14;
    ear.castShadow = true;
    group.userData.ears.push(ear);
    group.add(ear);
  });

  const noseband = makeCylinderBetween(new THREE.Vector3(-0.18, 1.64, 2.0), new THREE.Vector3(0.18, 1.64, 2.0), 0.016, materials.black);
  const browBand = makeCylinderBetween(new THREE.Vector3(-0.23, 1.84, 1.75), new THREE.Vector3(0.23, 1.84, 1.75), 0.014, materials.black);
  const cheekLeft = makeCylinderBetween(new THREE.Vector3(-0.19, 1.84, 1.76), new THREE.Vector3(-0.15, 1.62, 2.02), 0.012, materials.black);
  const cheekRight = makeCylinderBetween(new THREE.Vector3(0.19, 1.84, 1.76), new THREE.Vector3(0.15, 1.62, 2.02), 0.012, materials.black);
  group.add(noseband, browBand, cheekLeft, cheekRight);

  // Criniera: ciocche più FINI e fitte (meno "a mattoncini"), che ricadono su un
  // lato del collo. Larghezza e sfasamento variabili per un look da crine.
  for (let i = 0; i < 16; i += 1) {
    const w = 0.045 + (i % 3) * 0.012;
    const mane = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22 + (i % 2) * 0.05, 0.09), darkCoat);
    mane.position.set((i % 2 ? -1 : 1) * 0.02, 1.94 - i * 0.036, 1.28 - i * 0.088);
    mane.rotation.x = -0.5;
    mane.rotation.z = (i % 2 ? -0.12 : 0.08) - 0.06;
    mane.castShadow = true;
    group.userData.maneStrands.push(mane);
    group.add(mane);
  }

  // Ciuffo (forelock): ciocche corte tra le orecchie che ricadono sulla fronte.
  [-0.05, 0, 0.05].forEach((x, k) => {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04), darkCoat);
    lock.position.set(x, 1.94, 1.66);
    lock.rotation.x = 0.55 + k * 0.04;
    lock.rotation.z = x * 2.2;
    lock.castShadow = true;
    group.userData.maneStrands.push(lock);
    group.add(lock);
  });

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.16, 5, 9), darkCoat);
  tail.position.set(0, 1.2, -1.56);
  tail.rotation.x = 1.18;
  tail.castShadow = true;
  group.userData.tail = tail;
  group.add(tail);

  [-0.15, -0.05, 0.06, 0.16].forEach((x) => {
    const tailStrand = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.92 + Math.abs(x) * 0.5, 4, 6), darkCoat);
    tailStrand.position.set(x, 1.05, -1.58);
    tailStrand.rotation.x = 1.28 + x * 0.8;
    tailStrand.castShadow = true;
    group.userData.tailStrands.push(tailStrand);
    group.add(tailStrand);
  });

  // ── A PELO: il Palio si corre SENZA SELLA. Niente sella, sottosella, paletta,
  // gualdrappa, sottopancia né staffe: il fantino monta sul dorso nudo del cavallo.
  // Restano solo la testiera e le redini (per la guida). Un filo di sudore/lucido
  // sul dorso, dove il fantino si siede, per dare realismo al pelo.
  const backSheen = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 8), coatHighlight);
  backSheen.rotation.x = Math.PI / 2;
  backSheen.scale.set(1.1, 1, 0.5);
  backSheen.position.set(0, 1.52, -0.05);
  backSheen.castShadow = true;
  group.add(backSheen);

  const reinLeft = makeCylinderBetween(new THREE.Vector3(-0.2, 2.08, 0.36), new THREE.Vector3(-0.22, 1.66, 1.83), 0.014, materials.black);
  const reinRight = makeCylinderBetween(new THREE.Vector3(0.2, 2.08, 0.36), new THREE.Vector3(0.22, 1.66, 1.83), 0.014, materials.black);
  group.add(reinLeft, reinRight);

  if (isPlayer) {
    const reinMat = makeMat(contrada.colors[0], 0.62);
    const leftRein = makeCylinderBetween(new THREE.Vector3(-0.46, 1.82, -0.34), new THREE.Vector3(-0.23, 1.64, 1.88), 0.032, reinMat);
    const rightRein = makeCylinderBetween(new THREE.Vector3(0.46, 1.82, -0.34), new THREE.Vector3(0.23, 1.64, 1.88), 0.032, reinMat);
    const browBand = makeCylinderBetween(new THREE.Vector3(-0.24, 1.83, 1.76), new THREE.Vector3(0.24, 1.83, 1.76), 0.024, reinMat);
    group.add(leftRein, rightRein, browBand);
  }

  const upperLegGeo = new THREE.CapsuleGeometry(0.1, 0.54, 4, 8);
  const lowerLegGeo = new THREE.CapsuleGeometry(0.05, 0.58, 4, 8);   // cannone sottile
  const jointGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const fetlockGeo = new THREE.SphereGeometry(0.066, 8, 5);
  const hoofGeo = new THREE.CylinderGeometry(0.092, 0.125, 0.15, 12); // zoccolo: tronco svasato
  const hoofMat = makeMat("#2b2018", 0.62);                          // corno scuro, non nero pieno
  [[-0.34, 0.68], [0.34, 0.68], [-0.36, -0.76], [0.36, -0.76]].forEach(([x, z], i) => {
    const leg = new THREE.Group();
    leg.position.set(x, 1.02, z);
    leg.rotation.x = i < 2 ? -0.08 : 0.1;
    const upper = new THREE.Mesh(upperLegGeo, coat);
    upper.position.y = -0.2;
    upper.scale.set(1.04, 1, i < 2 ? 0.92 : 1.08);
    upper.castShadow = true;
    const joint = new THREE.Mesh(jointGeo, i < 2 ? coatShade : coat);
    joint.position.set(0, -0.52, i < 2 ? 0.05 : -0.04);
    joint.scale.set(0.9, 0.84, 0.78);
    joint.castShadow = true;
    const lower = new THREE.Mesh(lowerLegGeo, darkCoat);
    lower.position.set(0, -0.74, i < 2 ? 0.1 : -0.08);
    lower.scale.set(0.86, 1.08, 0.78);
    lower.castShadow = true;
    const fetlock = new THREE.Mesh(fetlockGeo, darkCoat);
    fetlock.position.set(0, -1.02, i < 2 ? 0.15 : -0.13);
    fetlock.scale.set(0.82, 0.7, 1);
    fetlock.castShadow = true;
    const tendon = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.42, 0.032), materials.black);
    tendon.position.set(0, -0.82, i < 2 ? 0.18 : -0.16);
    tendon.rotation.x = i < 2 ? -0.08 : 0.08;
    tendon.castShadow = true;
    const coronet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.032, 0.25), coatShade);
    coronet.position.set(0, -1.075, i < 2 ? 0.18 : -0.16);
    coronet.rotation.x = i < 2 ? -0.09 : 0.09;
    coronet.castShadow = true;
    const hoof = new THREE.Mesh(hoofGeo, hoofMat);
    hoof.position.set(0, -1.13, i < 2 ? 0.19 : -0.16);
    hoof.rotation.x = i < 2 ? -0.12 : 0.12;
    hoof.castShadow = true;
    if (seededUnit(markingSeed * 0.73 + i * 9.17) < variant.sock) {
      const sock = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 6), materials.white);
      sock.position.set(0, -0.9, i < 2 ? 0.12 : -0.1);
      sock.castShadow = true;
      leg.add(sock);
    }
    leg.userData.upper = upper;
    leg.userData.joint = joint;
    leg.userData.lower = lower;
    leg.userData.fetlock = fetlock;
    leg.userData.hoof = hoof;
    leg.add(upper, joint, lower, tendon, fetlock, coronet, hoof);
    group.userData.legs.push(leg);
    group.add(leg);
  });

  const rider = group.userData.jockey;
  // A pelo il fantino siede più basso, appoggiato al dorso nudo (niente sella).
  rider.position.y = -0.06;
  // ── FANTINO NUOVO (fantino-lab.js) al posto del procedurale, salvo ?fantino2=0 ──
  // Stessa convenzione di scala/quote (sella ~y1.82) → si innesta 1:1 nel gruppo
  // jockey, che è figlio del cavallo e viene animato SOLO in rotazione (bob del
  // galoppo): il fantino eredita il moto del cavallo → nessuna vibrazione.
  let fantino2ok = false;
  if (USE_FANTINO2) {
    try {
      const f = buildFantino(FANTINO_CONTRADE_BY_ID[contrada.id] || CONTRADE_FANTINI[7], {});
      // Ingrandimento richiesto: fantino ×2, ANCORATO al punto di seduta (~y1.78)
      // così il bacino resta sul dorso e cresce verso l'alto (niente fluttuazioni).
      const wrap = new THREE.Group();
      f.position.y = -FANTINO_SEAT_Y;
      wrap.add(f);
      wrap.scale.setScalar(FANTINO_SCALE);
      wrap.position.set(0, FANTINO_SEAT_Y, FANTINO_SEAT_Z);   // seduta ancorata + un filo avanti
      rider.add(wrap);
      rider.userData.rightArm = f.userData.rightArm;   // contratto: animazione nerbo/vittoria
      rider.userData.leftArm = f.userData.leftArm;     // redini in gara, su al cielo in vittoria
      rider.userData.whip = f.userData.whip;
      rider.userData.fantino2 = true;                  // posa braccia diversa (già tese avanti)
      fantino2ok = true;
    } catch (e) { console.warn("[fantino2] fallback al fantino procedurale:", e); }
  }
  if (!fantino2ok) {
  // Pantaloni = colore SECONDARIO della Contrada (clothB), coordinati alle maniche.
  // Bacino stretto (fianchi snelli), non un cuscino largo.
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.2, 4, 8), clothB);
  pelvis.position.set(0, 1.82, -0.1);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.scale.set(1.05, 0.82, 0.66);
  pelvis.castShadow = true;
  rider.add(pelvis);

  // Busto SLANCIATO: raggio più piccolo, tronco più lungo, sezione ellittica
  // (stretto di fianco, appena più profondo davanti-dietro) = torace umano magro.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.68, 5, 12), clothA);
  torso.position.set(0, 2.18, 0.1);
  torso.rotation.x = -0.58;
  torso.scale.set(0.92 * build.corpo, 1, 0.7 * build.corpo);
  torso.castShadow = true;
  rider.add(torso);

  // Righina / strisce verticali sul giubbetto (contrade a righe: Istrice, Pantera).
  if (contrada.silkStripe) {
    const stripeMat = makeMat(contrada.silkStripe, 0.6);
    [-0.1, 0, 0.1].forEach((x) => {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.62, 0.05), stripeMat);
      st.position.set(x, 2.18, 0.29);
      st.rotation.x = -0.58;
      st.castShadow = true;
      rider.add(st);
    });
  }

  // Spalle e fascia = le LISTE (clothC): sono le bande di colore che attraversano
  // il giubbetto, quindi devono essere continue con la lista dello zucchino.
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.44 * build.spalle, 0.11, 0.15), clothC);
  shoulders.position.set(0, 2.36, 0.2);
  shoulders.rotation.x = -0.5;
  shoulders.castShadow = true;
  rider.add(shoulders);

  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.12), clothC);
  sash.position.set(0, 2.14, 0.31);
  sash.rotation.set(-0.58, 0, 0.18);
  sash.castShadow = true;
  rider.add(sash);

  // ── STEMMA sul dorso del giubbetto. Prima era un pannello BIANCO grande e
  // sporgente: sembrava un adesivo appiccicato sopra il tessuto. Ora è più piccolo,
  // nel colore delle LISTE (quindi coordinato alla livrea) e quasi a filo del
  // giubbetto, con lo scudo nel colore principale sopra: si legge come ricamo.
  const backShield = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.014), clothC);
  backShield.position.set(0, 2.17, -0.245);
  backShield.rotation.x = -0.5;
  backShield.castShadow = true;
  rider.add(backShield);
  const backEmblem = new THREE.Mesh(new THREE.SphereGeometry(0.072, 9, 6), clothA);
  backEmblem.scale.set(1, 0.78, 0.16);
  backEmblem.position.set(0, 2.17, -0.258);
  backEmblem.rotation.x = -0.5;
  rider.add(backEmblem);

  // COLLO: raccorda le spalle alla testa (prima la testa fluttuava staccata).
  const riderNeck = new THREE.Mesh(new THREE.CapsuleGeometry(0.055 * build.testa, 0.12, 4, 8), skinMat);
  riderNeck.position.set(0, 2.44, 0.27);
  riderNeck.rotation.x = -0.35;
  riderNeck.castShadow = true;
  rider.add(riderNeck);

  // TESTA: ovale come un cranio umano (non una palla), più tonda (più segmenti).
  const headRider = new THREE.Mesh(new THREE.SphereGeometry(0.2 * build.testa, 20, 14), skinMat);
  headRider.position.set(0, 2.54, 0.32);
  headRider.scale.set(0.94, 1.08, 1.0);   // stretta ai lati, un filo allungata in alto/basso
  headRider.castShadow = true;
  rider.add(headRider);
  // Mascella/mento: leggero volume sotto, davanti — dà un profilo, non una sfera.
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.13 * build.testa, 12, 8), skinMat);
  jaw.position.set(0, 2.47, 0.4);
  jaw.scale.set(0.82, 0.7, 0.85);
  jaw.castShadow = true;
  rider.add(jaw);
  // Naso: piccolo rilievo sul davanti del viso (+Z).
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.038 * build.testa, 8, 6), skinMat);
  nose.position.set(0, 2.52, 0.51);
  nose.scale.set(0.8, 1.1, 1.2);
  rider.add(nose);
  // Orecchie: due piccoli dischi ai lati, appena sotto il bordo dello zucchino.
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045 * build.testa, 8, 6), skinMat);
    ear.position.set(s * 0.185 * build.testa, 2.52, 0.3);
    ear.scale.set(0.45, 1.0, 0.75);
    rider.add(ear);
  });
  // ── VOLTO: occhi, sopracciglia e bocca. Piccoli dettagli che trasformano la
  // sfera in una FACCIA. Occhi lucidi scuri incassati, sopracciglia e bocca in
  // pelle più scura (ombra), non nere piatte.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 0.32, metalness: 0.05 });
  const scuroPelle = makeMat("#7d5537", 0.7);   // ombra dei tratti (bocca, sopracciglia)
  const tf = build.testa;
  [-1, 1].forEach((s) => {
    // Occhio: bulbo scuro leggermente incassato nell'orbita.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03 * tf, 10, 8), eyeMat);
    eye.position.set(s * 0.075 * tf, 2.565, 0.455 * tf + 0.13);
    eye.scale.set(1.1, 0.85, 0.7);
    rider.add(eye);
    // Sopracciglio: piccola barra scura sopra l'occhio.
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.07 * tf, 0.02 * tf, 0.03 * tf), scuroPelle);
    brow.position.set(s * 0.078 * tf, 2.6, 0.45 * tf + 0.12);
    brow.rotation.z = s * -0.12;
    rider.add(brow);
    // Zigomo: leggero rilievo sotto l'occhio, dà struttura al viso.
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06 * tf, 8, 6), skinMat);
    cheek.position.set(s * 0.1 * tf, 2.52, 0.4 * tf + 0.12);
    cheek.scale.set(0.7, 0.8, 0.6);
    rider.add(cheek);
  });
  // Bocca: fessura scura, appena curva.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09 * tf, 0.022 * tf, 0.03 * tf), scuroPelle);
  mouth.position.set(0, 2.485, 0.44 * tf + 0.12);
  rider.add(mouth);

  // ── ZUCCHINO: calotta tonda e bassa, calzata fin sopra le orecchie, nel colore
  // PRINCIPALE della Contrada. NIENTE visiera: la visiera lo faceva sembrare un
  // casco da equitazione inglese, che al Palio non esiste. Sotto la vernice c'è un
  // guscio protettivo moderno → finitura satinata, non lucida.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.222 * build.testa, 14, 8, 0, TAU, 0, Math.PI * 0.58), clothA);
  helmet.position.set(0, 2.63, 0.32);
  helmet.scale.set(1, 0.92, 1.04);   // leggermente schiacciata e allungata dietro
  helmet.castShadow = true;
  rider.add(helmet);

  // Bordo inferiore rinforzato: chiude la calotta e nasconde l'attacco sulla testa.
  const helmetRim = new THREE.Mesh(new THREE.TorusGeometry(0.212 * build.testa, 0.022, 6, 18), clothC);
  helmetRim.position.set(0, 2.632, 0.32);
  helmetRim.rotation.x = Math.PI / 2;
  helmetRim.castShadow = true;
  rider.add(helmetRim);

  // Lista dello zucchino: stesso colore delle liste del giubbetto (continuità).
  const helmetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.03, 0.42), clothC);
  helmetStripe.position.set(0, 2.775, 0.315);
  helmetStripe.rotation.x = -0.1;
  helmetStripe.castShadow = true;
  rider.add(helmetStripe);

  // Sottogola: laccio di fissaggio, sottile, dal bordo verso la mandibola.
  const chinStrap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.16, 0.022), materials.black);
  chinStrap.position.set(0.135, 2.53, 0.35);
  chinStrap.rotation.z = 0.22;
  rider.add(chinStrap);
  const chinStrapL = chinStrap.clone();
  chinStrapL.position.x = -0.135;
  chinStrapL.rotation.z = -0.22;
  rider.add(chinStrapL);

  // BRACCIA SNODATE: ogni braccio è un GRUPPO col perno sulla SPALLA, con dentro
  // omero + avambraccio (leggera piega al gomito) + mano chiusa sulle redini. Il
  // gruppo ha la stessa origine e le stesse rotazioni di prima, quindi l'animazione
  // del nerbo/vittoria (che ruota rider.userData.rightArm) continua identica: ora
  // però swinga tutto il braccio articolato, non una singola capsula.
  const upperGeo = new THREE.CapsuleGeometry(0.042 * build.corpo, 0.24 * build.arti, 5, 9);
  const foreGeo = new THREE.CapsuleGeometry(0.034 * build.corpo, 0.24 * build.arti, 5, 9);
  function buildArm(sign) {
    const arm = new THREE.Group();
    arm.position.set(sign * 0.31, 2.1, 0.37);
    arm.rotation.x = -1.05;
    arm.rotation.z = sign * -0.32;
    // Spalla (deltoide) tondeggiante.
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.05 * build.corpo, 10, 8), clothB);
    deltoid.position.set(0, 0.16, 0);
    deltoid.castShadow = true;
    arm.add(deltoid);
    // Omero lungo l'asse Y locale (come la vecchia capsula) — dalla spalla al gomito.
    const upper = new THREE.Mesh(upperGeo, clothB);
    upper.position.set(0, 0.05, 0);
    upper.castShadow = true;
    arm.add(upper);
    // Avambraccio: continua dal gomito con una piega in avanti (+Z) verso le redini.
    const fore = new THREE.Mesh(foreGeo, clothB);
    fore.position.set(0, -0.19, 0.05);
    fore.rotation.x = 0.5;
    fore.castShadow = true;
    arm.add(fore);
    // Mano chiusa a PUGNO sulle redini: palmo + dorso con nocche + pollice piegato
    // sopra. Non più una sfera liscia.
    const fist = new THREE.Group();
    fist.position.set(0, -0.32, 0.12);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.11), skinMat);
    palm.castShadow = true;
    fist.add(palm);
    // Nocche: quattro piccole gobbe sul dorso (verso +Z, dove tiene le redini).
    for (let k = 0; k < 4; k += 1) {
      const knuck = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), skinMat);
      knuck.position.set(-0.036 + k * 0.024, 0.028, 0.058);
      fist.add(knuck);
    }
    // Pollice: piegato di lato sopra le dita.
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.05, 3, 6), skinMat);
    thumb.position.set(0.055, 0.0, 0.02);
    thumb.rotation.z = 0.9;
    thumb.rotation.x = -0.3;
    fist.add(thumb);
    arm.add(fist);
    return arm;
  }
  const armLeft = buildArm(-1);
  const armRight = buildArm(1);
  rider.userData.rightArm = armRight;
  rider.add(armLeft, armRight);

  // MONTA A PELO: niente sella né staffe, quindi la gamba non pende — stringe.
  // Cosce più aderenti al barile (x ravvicinata) e inclinazione che le porta
  // lungo il fianco del cavallo invece che a penzoloni.
  // GAMBE SNODATE: coscia (aderente al barile) → ginocchio → polpaccio → stivale
  // con punta. Posizioni d'aggancio invariate (coscia dove stava, stivale idem):
  // aggiungo solo lo snodo così la gamba sembra articolata, non un unico salsicciotto.
  const thighGeo = new THREE.CapsuleGeometry(0.05 * build.corpo, 0.38 * build.arti, 5, 9);
  const calfGeo = new THREE.CapsuleGeometry(0.038 * build.corpo, 0.26 * build.arti, 5, 9);
  const bootMat = materials.black;
  const skinCalfMat = materials.black;   // stivale alto: il polpaccio è coperto
  [-0.205, 0.205].forEach((x) => {
    // Coscia: pantalone (clothB), stessa posa d'aggancio di prima.
    const thigh = new THREE.Mesh(thighGeo, clothB);
    thigh.position.set(x, 1.82, -0.02);
    thigh.rotation.x = 0.62;
    thigh.rotation.z = x < 0 ? -0.1 : 0.1;
    thigh.castShadow = true;
    rider.add(thigh);
    // Ginocchio.
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.048 * build.corpo, 10, 8), clothB);
    knee.position.set(x * 1.05, 1.66, 0.14);
    knee.castShadow = true;
    rider.add(knee);
    // Polpaccio nello stivale: scende dal ginocchio verso il tallone.
    const calf = new THREE.Mesh(calfGeo, skinCalfMat);
    calf.position.set(x * 1.1, 1.55, 0.12);
    calf.rotation.x = 0.28;
    calf.castShadow = true;
    rider.add(calf);
    // Stivale/piede: pianta + PUNTA arrotondata davanti (verso +Z).
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.075, 0.22), bootMat);
    boot.position.set(x * 1.12, 1.47, 0.2);
    boot.rotation.x = 0.16;
    boot.castShadow = true;
    rider.add(boot);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), bootMat);
    toe.position.set(x * 1.12, 1.46, 0.32);
    toe.scale.set(0.9, 0.85, 1.15);
    toe.castShadow = true;
    rider.add(toe);
    // Tacco.
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.07), bootMat);
    heel.position.set(x * 1.12, 1.44, 0.1);
    rider.add(heel);
  });

  const whip = new THREE.Group();
  whip.add(makeCylinderBetween(new THREE.Vector3(0.34, 1.96, 0.48), new THREE.Vector3(0.47, 1.82, 0.06), 0.013, materials.black));
  whip.add(makeCylinderBetween(new THREE.Vector3(0.47, 1.82, 0.06), new THREE.Vector3(0.56, 1.7, -0.42), 0.009, materials.black));
  whip.position.set(0, 0, 0);
  rider.userData.whip = whip;
  rider.add(whip);
  }   // fine ramo fantino PROCEDURALE (fallback di fantino2)

  group.add(rider);
  group.userData.firstPersonHidden.push(rider);
  group.scale.setScalar(1.08 * 1.10);   // scala UGUALE per TUTTI i cavalli (prima era solo il giocatore → sembrava più grande)

  if (isPlayer) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.035, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffe48b })
    );
    ring.position.y = 0.08;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const boostGroup = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const streak = new THREE.Mesh(shared.boostGeometry, materials.boost.clone());
      streak.position.set((i - 2) * 0.22, 0.8 + i * 0.04, -1.55 - i * 0.42);
      streak.rotation.x = -0.18;
      streak.material.opacity = 0;
      boostGroup.add(streak);
    }
    group.userData.boostGroup = boostGroup;
    group.add(boostGroup);
  }

  return group;
}

function darkenColor(hex, amount) {
  const color = new THREE.Color(hex);
  color.r *= 1 - amount;
  color.g *= 1 - amount;
  color.b *= 1 - amount;
  return `#${color.getHexString()}`;
}

function mixColor(hex, targetHex, amount) {
  const color = new THREE.Color(hex);
  color.lerp(new THREE.Color(targetHex), amount);
  return `#${color.getHexString()}`;
}

function ensureAudio() {
  try { preloadPalioSounds(); } catch (e) { /* niente */ }   // backstop: al 1° gesto i file sono già caldi
  if (state.audio.ctx) return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  state.audio.ctx = new AudioCtor();
}

function playTone(freq, duration, gainValue, type = "sine") {
  const ctx = state.audio.ctx;
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(gainValue, ctx.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration + 0.02);
}

function playHoof(strength) {
  playTone(76 + Math.random() * 20, 0.055, 0.04 + strength * 0.035, "triangle");
}

function playNerbo() {
  playTone(420, 0.045, 0.052, "sawtooth");
  playTone(130, 0.09, 0.04, "square");
}

function playBrake() {
  playTone(92, 0.13, 0.045, "sawtooth");
}

// Zoccolo che scalpita: un tonfo basso e cupo (il cavallo nervoso che pesta al
// canape), a volte con un piccolo schiocco secco.
function playStamp() {
  playTone(44 + Math.random() * 22, 0.09, 0.045 + Math.random() * 0.03, "triangle");
  if (Math.random() < 0.6) playTone(150 + Math.random() * 70, 0.03, 0.022, "square");
}

// ── Suoni UFFICIALI del Palio (file locali in suoni/, presi da ilpalio.org):
// nitriti dei barberi (tratta), Marcia del Palio coi tamburi (estrazione),
// il Sunto (campanone — inizio del palio), Passo alla Vittoria (contrada che
// vince). Riprodotti con <audio>; cache per file, stop/fade gestiti qui.
const __palioAudio = {};
// PRECARICAMENTO: tutti i file audio decodificati IN ANTICIPO, così a mossa e
// all'arrivo non c'è la pausa di decodifica del primo play (= l'audio che "salta").
const PALIO_SOUND_FILES = [
  "MARCIADELPALIOCONTAMBURI.mp3", "NITRITO1.mp3", "NITRITO3.mp3", "NITRITO4.mp3",
  "PASSOAVITTORIA.mp3", "SUNTO-NOTIFICASMS.mp3", "appalusi.m4a", "busta.m4a",
  "corsa.m4a", "finale.m4a", "fine.m4a", "galoppo.m4a", "ingresso.m4a", "intro.m4a",
  "start.m4a", "tamburi.m4a",
  "aquila.m4a", "bruco.m4a", "chiocciola.m4a", "civetta.m4a", "drago.m4a", "giraffa.m4a",
  "istrice.m4a", "leocorno.m4a", "lupa.m4a", "nicchio.m4a", "oca.m4a", "onda.m4a",
  "pantera.m4a", "selva.m4a", "tartuca.m4a", "torre.m4a", "valdimontone.m4a",
];
// NUCLEO da precaricare: SOLO i suoni che partono in momenti rapidi, dove il
// ritardo del primo play si sentirebbe. Tutto il resto (i 17 jingle di Contrada —
// ne serve UNO per palio — e i suoni della Tratta, che hanno tempi lunghi) si
// scarica al primo utilizzo: playPalioSound crea l'Audio al volo. Prima si
// scaricavano tutti e 33 a ogni visita: da soli erano un terzo delle richieste.
const PALIO_SOUND_CORE = [
  "start.m4a", "corsa.m4a", "galoppo.m4a", "ingresso.m4a",
  "intro.m4a", "busta.m4a", "tamburi.m4a", "finale.m4a",
];
let __soundsPreloaded = false;
function preloadPalioSounds() {
  if (__soundsPreloaded) return;
  __soundsPreloaded = true;
  PALIO_SOUND_CORE.forEach((file) => {
    try {
      let a = __palioAudio[file];
      if (!a) { a = new Audio("suoni/" + file); __palioAudio[file] = a; }
      a.preload = "auto";
      a.load();   // scarica + decodifica ora, non al primo play
    } catch (e) { /* niente */ }
  });
}
// TETTO GLOBALE del volume: tutto il gioco suona a max 0.6. Un suono può chiedere
// di sforare il tetto passando `cap` (usato solo per i 3 scoppi della vittoria = 0.7).
const PALIO_VOL_CAP = 0.6;
function playPalioSound(file, { volume = 0.55, stopAfter = 0, loop = false, cap = PALIO_VOL_CAP } = {}) {
  try {
    let a = __palioAudio[file];
    if (!a) { a = new Audio("suoni/" + file); __palioAudio[file] = a; }
    // Annulla dissolvenze/stop programmati da una riproduzione PRECEDENTE dello
    // stesso file: senza questo, uno "stopAfter" vecchio (es. la Marcia
    // dell'estrazione) spegnerebbe la nuova riproduzione in loop.
    if (a.__fadeTimer) { clearInterval(a.__fadeTimer); a.__fadeTimer = null; }
    if (a.__stopTimer) { clearTimeout(a.__stopTimer); a.__stopTimer = null; }
    a.loop = !!loop;
    a.pause(); a.currentTime = 0; a.volume = Math.min(volume, cap);
    a.play().catch(() => {});
    if (stopAfter > 0) {
      a.__stopTimer = setTimeout(() => {
        a.__stopTimer = null;
        a.__fadeTimer = setInterval(() => {          // dissolvenza, poi stop
          a.volume = Math.max(0, a.volume - 0.06);
          if (a.volume <= 0.01) { clearInterval(a.__fadeTimer); a.__fadeTimer = null; a.pause(); }
        }, 50);
      }, stopAfter * 1000);
    }
    return a;
  } catch (e) { return null; }
}
function stopPalioSounds() {
  // Suoni PROGRAMMATI (Sunto dopo l'ingresso, finale dopo il fine): vanno annullati
  // qui, altrimenti chi torna al menu se li sente partire addosso più tardi.
  if (state.suntoTimer) { clearTimeout(state.suntoTimer); state.suntoTimer = null; }
  if (state.finaleTimer) { clearTimeout(state.finaleTimer); state.finaleTimer = null; }
  Object.values(__palioAudio).forEach((a) => {
    try {
      if (a.__fadeTimer) { clearInterval(a.__fadeTimer); a.__fadeTimer = null; }
      if (a.__stopTimer) { clearTimeout(a.__stopTimer); a.__stopTimer = null; }
      a.pause(); a.currentTime = 0;
    } catch (e) { /* niente */ }
  });
}
// Silenzia TUTTO (musica/mp3 + sintesi WebAudio): usato al "Torna al menu".
// L'audio riparte da solo alla prossima gara (resume su gesto in beginEstrazione).
function stopAllAudio() {
  stopPalioSounds();
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* niente */ }   // zittisce la voce del mossiere
  try { const ctx = state.audio && state.audio.ctx; if (ctx && ctx.state === "running") ctx.suspend(); } catch (e) { /* niente */ }
}
const NITRITI = ["NITRITO1.mp3", "NITRITO3.mp3", "NITRITO4.mp3"];
function playNitrito(volume = 0.5) {
  playPalioSound(NITRITI[Math.floor(Math.random() * NITRITI.length)], { volume });
}
// Dissolvenza morbida di un suono già in riproduzione (senza aspettare stopAfter).
function fadePalioSound(file, seconds = 0.5) {
  const a = __palioAudio[file];
  if (!a || a.paused) return;
  if (a.__fadeTimer) { clearInterval(a.__fadeTimer); a.__fadeTimer = null; }
  const step = Math.max(0.02, a.volume / Math.max(1, (seconds * 1000) / 60));
  a.__fadeTimer = setInterval(() => {
    a.volume = Math.max(0, a.volume - step);
    if (a.volume <= 0.01) { clearInterval(a.__fadeTimer); a.__fadeTimer = null; a.pause(); a.currentTime = 0; a.loop = false; }
  }, 60);
}
// Il "rumore del pubblico" (corsa.m4a, come da INFO) tenuto in loop SOTTO tutta la
// corsa e sotto i mortaretti della premiazione.
const CROWD_BED_FILE = "corsa.m4a";
function startCrowdBed(volume = 0.3) { playPalioSound(CROWD_BED_FILE, { volume, loop: true }); }
function fadeCrowdBed(seconds = 2.4) { fadePalioSound(CROWD_BED_FILE, seconds); }
// Lo ZOCCOLIO del gruppo lanciato: in loop sotto tutta la corsa, insieme a corsa.m4a.
const GALOPPO_FILE = "galoppo.m4a";
function startGaloppo(volume = 0.34) { playPalioSound(GALOPPO_FILE, { volume, loop: true }); }
function fadeGaloppo(seconds = 2.4) { fadePalioSound(GALOPPO_FILE, seconds); }
// Sottofondo del TONDINO (la "busta"): gira mentre il mossiere chiama le Contrade
// e sfuma appena si parte.
const BUSTA_FILE = "busta.m4a";
function startBusta(volume = 0.4) { playPalioSound(BUSTA_FILE, { volume, loop: true }); }
function fadeBusta(seconds = 1.2) { fadePalioSound(BUSTA_FILE, seconds); }
// Quanto dura l'ingresso in Piazza prima che entri il Sunto (campanone).
const INGRESSO_PRIMA_DEL_SUNTO = 6.0;
// Quanto dura fine.m4a (il boato dell'arrivo) prima che entri finale.m4a.
const FINE_PRIMA_DEL_FINALE = 8.0;
// START della mossa: parte FORTE e dopo 2s scende a volume normale. Vale anche
// per la mossa falsa (i cavalli partono davvero, il pubblico esplode lo stesso).
function playStartMossa() {
  const a = playPalioSound("start.m4a", { volume: 1.0, stopAfter: 9 });
  if (!a) return;
  if (a.__calaTimer) { clearTimeout(a.__calaTimer); }
  a.__calaTimer = setTimeout(() => {
    a.__calaTimer = null;
    // Non toccare il volume se nel frattempo è già partita la dissolvenza di stop.
    if (!a.paused && !a.__fadeTimer) a.volume = 0.5;
  }, 2000);
}

// MORTARETTO: botto secco (rumore filtrato + tonfo grave). `vol` regola la
// potenza: quello della MOSSA FALSA deve essere un COLPO FORTE che si sente
// sopra tutto (prima a 0.55 spariva sotto il rumore della piazza).
function playMortaretto(vol = 0.55) {
  const ctx = state.audio.ctx;
  if (!ctx) return;
  const dur = 0.6;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 950;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start();
  // CRACK acuto iniziale: è lui a "bucare" il mix e far sembrare il botto vicino.
  const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate);
  const cd = crackBuf.getChannelData(0);
  for (let i = 0; i < cd.length; i += 1) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cd.length, 1.2);
  const crack = ctx.createBufferSource(); crack.buffer = crackBuf;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
  const cg = ctx.createGain(); cg.gain.value = vol * 0.8;
  crack.connect(hp); hp.connect(cg); cg.connect(ctx.destination);
  crack.start();
  playTone(58, 0.5, 0.2 + vol * 0.15, "sine");
}

// COLPO SUI PALCHI: tonfo di LEGNO quando un cavallo batte sullo steccato/palchi e
// cade. Niente file: rumore grave a decadimento rapido (il tonfo) + risonanza
// passa-banda (le assi dei palchi che vibrano) + un thump basso (l'urto fisico).
function playColpoPalchi(vol = 0.7) {
  const ctx = state.audio.ctx;
  if (!ctx) return;
  // 1) TONFO: rumore grave, decadimento rapido — il corpo dell'impatto.
  const dur = 0.34;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 480;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start();
  // 2) LEGNO: risonanza passa-banda con Q alto — le assi che vibrano dopo il colpo.
  const wdur = 0.22;
  const wb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * wdur), ctx.sampleRate);
  const wd = wb.getChannelData(0);
  for (let i = 0; i < wd.length; i += 1) wd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / wd.length, 1.6);
  const wsrc = ctx.createBufferSource(); wsrc.buffer = wb;
  const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 320; wf.Q.value = 3.5;
  const wg = ctx.createGain(); wg.gain.value = vol * 0.7;
  wsrc.connect(wf); wf.connect(wg); wg.connect(ctx.destination);
  wsrc.start();
  // 3) THUMP basso: l'urto fisico grave.
  playTone(70, 0.28, 0.16 + vol * 0.18, "sine");
}

// FOLLA della Piazza: boato ("cheer"), applauso contenuto ("mild"), mormorio
// freddo ("cold"). Rumore bianco inviluppato + passa-banda: niente file.
function playCrowd(kind = "cheer") {
  const ctx = state.audio.ctx;
  if (!ctx) return;
  const dur = kind === "cheer" ? 2.4 : kind === "mild" ? 1.2 : 0.9;
  const vol = kind === "cheer" ? 0.34 : kind === "mild" ? 0.15 : 0.07;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) {
    const t = i / d.length;
    d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(t * 1.6, 1));
  }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "bandpass";
  f.frequency.value = kind === "cold" ? 300 : 820; f.Q.value = 0.6;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start();
}

// ── REAZIONE DEL POPOLO all'estrazione / assegnazione del cavallo. Tre livelli:
//  "cheer" (cavallo forte)  → esultanza: la folla SALTA, boato, camera che vibra;
//  "mild"  (cavallo medio)  → applauso contenuto, atmosfera d'attesa;
//  "cold"  (cavallo debole) → freddezza e tensione: la folla si BLOCCA, brusio cupo.
// L'animazione della folla la legge updateAtmosphere da state.crowdReaction.
function triggerCrowdReaction(kind, message) {
  state.crowdReaction = { kind, t: 0, dur: kind === "cheer" ? 2.8 : kind === "cold" ? 2.0 : 1.4 };
  playCrowd(kind);
  if (kind === "cheer") state.cameraShake = Math.max(state.cameraShake || 0, 0.14);
  if (message) showMessage(message, 1.9, kind === "cheer" ? "good" : kind === "cold" ? "danger" : "");
}

// Centro del RETTILINEO di partenza/corsa (dov'è il Palazzo Comunale): cammina
// dalla mossa (progress 0) in avanti e indietro finché la pista resta dritta e
// prende il punto medio. Calcolato una volta.
let __straightCenterP = null;
function getStraightCenterP() {
  if (__straightCenterP !== null) return __straightCenterP;
  // Il RETTILINEO del Palazzo Comunale è il tratto fra le DUE CURVE a 90°
  // (San Martino e Casato): curvatura ≈ 0. NON è il tratto della mossa (che ha
  // la curvatura dolce della conchiglia, ~0.135): il Palazzo non deve MAI stare
  // all'altezza della mossa. Si cerca la run più lunga con curvatura ~nulla.
  const L = track.length, step = 1.0, thr = 0.06;
  let bestStart = 0, bestLen = 0, runStart = null;
  for (let d = 0; d <= L * 2; d += step) {          // doppio giro: gestisce il wrap
    const flat = (sampleAt(d).curve || 0) < thr;
    if (flat && runStart === null) runStart = d;
    if ((!flat || d >= L * 2) && runStart !== null) {
      const len = d - runStart;
      if (len > bestLen && len <= L) { bestLen = len; bestStart = runStart; }
      runStart = null;
    }
  }
  __straightCenterP = positiveMod(bestStart + bestLen / 2, L);
  return __straightCenterP;
}

// ══ CAVALLI GLB — ponte visivo (SPEC_CAVALLI_REALISTICI_THREEJS) ═════════════
// Sostituisce SOLO la rappresentazione visiva del cavallo con un modello glTF,
// lasciando intatta tutta la logica: il group resta l'ancora autorevole
// (posizione/rotazione da placeHorse), il fantino resta figlio del group, e
// scosso/caduto/replay continuano a funzionare perché agiscono sul group.
//
// Asset attuale: Horse.glb degli esempi ufficiali Three.js (licenza MIT) —
// 1 mesh a morph target, 1 solo clip di galoppo. È il PROTOTIPO TECNICO
// previsto dalla specifica, non la qualità finale: quando arriverà un GLB
// riggato con walk/trot/canter/gallop basterà sostituire il file e mappare i
// clip qui sotto. Fallback: se il caricamento fallisce (o ?horseglb=0) resta
// il cavallo procedurale di sempre.
const HORSE_GLB = {
  url: "assets/horses/horse_master.glb",
  attivo: !/[?&]horseglb=0/.test(window.location.search),
  // Il cavallo va guardato correre verso +Z (i nostri corrono lì). Il modello
  // nudo guarda già in quel verso: 0 (con Math.PI correva all'indietro).
  rotY: 0,
  // Altezza al garrese di base (unità di gioco) × BOOST richiesto dall'utente.
  // altezzaTarget 1.7 = cavallo realistico; boost 4 = "almeno 4 volte" più grande.
  // Un solo numero da toccare per la taglia.
  altezzaTarget: 1.7,
  boost: 2,
  // Rifiniture di posa (manopole singole, ritoccabili a occhio):
  trimY: -0.75,          // affonda gli zoccoli nel tufo (niente galleggio)
  // Alzata INTRINSECA del fantino sopra il dorso (indipendente dall'affondo):
  // alla seduta viene sommato trimY, così il fantino SCENDE insieme al cavallo
  // quando lo affondo. Con trimY -0.18 dava +0.30 (seduta buona di prima); con
  // -0.75 dà -0.27 → il fantino segue il cavallo abbassato.
  fantinoSu: 0.62,   // CORRETTO dalla chat fantini: il 0.92 era tarato su un riferimento sbagliato (garrese invece del dorso) e i fantini "volavano". A 0.62 il sedere appoggia e le cosce fasciano il fianco.
  fantinoAvanti: 0.60,   // lo porta in avanti, sulla groppa/garrese (non sul posteriore) — tarato dalla chat Fantini
  gltf: null, clip: null, scala: 1, pronto: false, fallito: false,
  registrati: [],       // { horse, mixer } — un mixer per cavallo
};
function caricaHorseGlb() {
  if (!HORSE_GLB.attivo) return;
  new GLTFLoader().load(HORSE_GLB.url, (gltf) => {
    try {
      HORSE_GLB.gltf = gltf;
      HORSE_GLB.clip = (gltf.animations && gltf.animations[0]) || null;
      // Il GLB non ha NOMI sui nodi → i track del clip puntano allo UUID della
      // mesh. Sui CLONI lo UUID cambia e l'animazione non si aggancerebbe (bug
      // silenzioso: cavalli rigidi). Battezzo il nodo animato e riscrivo i
      // track su quel nome, che i cloni conservano.
      let animato = null;
      gltf.scene.traverse((o) => { if (!animato && (o.morphTargetInfluences || o.isMesh)) animato = o; });
      if (animato && HORSE_GLB.clip) {
        animato.name = "HorseMesh";
        HORSE_GLB.clip.tracks.forEach((t) => { t.name = t.name.replace(/^[^.]+\./, "HorseMesh."); });
      }
      // Scala dall'altezza della bbox × boost. La CENTRATURA non si calcola più
      // qui (il calcolo "a mano" falliva): si MISURA a runtime in attaccaHorseGlb.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      HORSE_GLB.scala = (HORSE_GLB.altezzaTarget / Math.max(1, size.y)) * HORSE_GLB.boost;
      HORSE_GLB.pronto = true;
      [...state.horses, ...(state.demoHorses || [])].forEach((h) => attaccaHorseGlb(h));
    } catch (e) { HORSE_GLB.fallito = true; console.warn("[horse-glb] attacco fallito, resto sul procedurale:", e); }
  }, undefined, (err) => {
    HORSE_GLB.fallito = true;
    console.warn("[horse-glb] caricamento fallito, resto sul procedurale:", err && err.message);
  });
}
function attaccaHorseGlb(horse) {
  attaccaHorseGlbInner(horse);
}
// Trova la FRONTE del modello scansionando i vertici (niente più numeri a occhio).
// Ritorna il punto in coordinate del GRUPPO del cavallo. La testa in corsa è
// protesa in avanti: i vertici col Z maggiore sono muso/testa; fra quelli prendo
// la fascia ALTA (fronte, sopra il muso). Il risultato è identico per tutti i
// cavalli (stessa geometria) → lo calcolo una volta e lo memorizzo su HORSE_GLB.
const _spennPos = new THREE.Vector3();   // riuso: ancora viva della fronte
function calcolaAncoraFronte(inner, group) {
  if (HORSE_GLB.spennAnchor) return HORSE_GLB.spennAnchor;
  let mesh = null;
  inner.traverse((o) => { if (!mesh && o.isMesh && o.geometry && o.geometry.attributes.position) mesh = o; });
  if (!mesh) return null;
  mesh.updateWorldMatrix(true, false);
  group.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const pts = [];
  let zmax = -Infinity, zmin = Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    mesh.localToWorld(v);     // mesh-local → mondo
    group.worldToLocal(v);    // mondo → spazio del gruppo del cavallo
    pts.push(v.clone());
    if (v.z > zmax) zmax = v.z;
    if (v.z < zmin) zmin = v.z;
  }
  // Frontmost ~12% in Z = testa/muso. (+Z = avanti nel gruppo.)
  const zThresh = zmax - (zmax - zmin) * 0.12;
  const front = pts.filter((p) => p.z >= zThresh);
  if (!front.length) return null;
  // Fra i vertici della testa, la fascia ALTA (55% superiore) = fronte, sopra il muso.
  let ymax = -Infinity, ymin = Infinity;
  front.forEach((p) => { if (p.y > ymax) ymax = p.y; if (p.y < ymin) ymin = p.y; });
  const yThresh = ymax - (ymax - ymin) * 0.55;
  const fronte = front.filter((p) => p.y >= yThresh);
  const c = new THREE.Vector3();
  fronte.forEach((p) => c.add(p));
  c.multiplyScalar(1 / Math.max(1, fronte.length));
  HORSE_GLB.spennAnchor = c;
  return c;
}
// SPENNACCHIERA: il pennacchio che nel Palio si mette sulla FRONTE del cavallo
// (sul frontale della briglia, fra gli occhi) coi COLORI della Contrada — serve
// a riconoscere il barbero anche se è scosso. NON è un ciuffo di piume in cima
// alla testa: è una PALETTA piatta a foglia, dritta e un po' inclinata in
// avanti, con STRISCE VERTICALI nei colori della Contrada, cima arrotondata e
// una rosetta scura alla base (fedele alle spennacchiere reali di Siena).
function buildSpennacchiera(horse, anchor) {
  const g = new THREE.Group();
  const cols = (horse.colors && horse.colors.length ? horse.colors : ["#c0392b", "#ecf0f1", "#2c3e50"]).slice(0, 3);
  const n = cols.length;
  const W = 0.16;          // larghezza totale del rettangolo (PICCOLO)
  const H = 0.34;          // altezza (verticale, rivolta all'insù)
  const D = 0.035;         // spessore (piatto: sottile in Z)
  const sw = W / n;        // larghezza di ogni striscia
  // Un piccolo RETTANGOLO VERTICALE diviso in strisce nei colori della Contrada.
  // La faccia larga guarda in avanti (+Z), le strisce affiancate lungo X → si
  // vedono verticali di fronte. Base a y=0, cresce verso l'alto (rivolto all'insù).
  for (let i = 0; i < n; i++) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(sw * 0.98, H, D),
      new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.7 }));
    box.position.set((i - (n - 1) / 2) * sw, H / 2, 0);
    box.castShadow = true;
    g.add(box);
  }
  // Dritta e rivolta all'insù (nessuna inclinazione).
  g.rotation.x = 0;
  // Posizione ANCORATA alla testa MISURATA del modello (vedi attaccaHorseGlbInner):
  // niente più numeri a occhio che finivano sul collo. anchor = { y, z } in
  // coordinate del gruppo, alto e avanti sulla fronte fra gli occhi.
  const a = anchor || { y: 2.4, z: 2.2 };
  g.position.set(0, a.y, a.z);
  g.name = "spennacchiera";
  return g;
}
function attaccaHorseGlbInner(horse) {
  if (!HORSE_GLB.pronto || !horse || !horse.group || horse.group.userData.glbHorse) return;
  try {
    const inner = SkeletonUtils.clone(HORSE_GLB.gltf.scene);
    const manto = horse.mantoGlb || "#6b4a2a";   // colore assegnato per distribuzione (vedi createHorse)
    // Luminanza del manto: i cavalli chiari ricevono un LEGGERO recupero emissivo
    // che compensa la tinta calda della luce (HemiLight ground #664422 +
    // DirectionalLight #fff2d0) — senza, #c6c3bc appare color sabbia. Emissive
    // TENUE (lum*0.42, cap 0.34) + roughness alta = pelo OPACO, non plasticoso/lucido.
    const _mc = new THREE.Color(manto);
    const _lum = 0.2126 * _mc.r + 0.7152 * _mc.g + 0.0722 * _mc.b;
    const _emIntensity = _lum > 0.35 ? Math.min(_lum * 0.62, 0.5) : 0;
    inner.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.set(manto);
        if ("metalness" in o.material) o.material.metalness = 0;
        if ("roughness" in o.material) o.material.roughness = 1.0;
        if (_emIntensity > 0 && "emissive" in o.material) {
          o.material.emissive = new THREE.Color(manto);
          o.material.emissiveIntensity = _emIntensity;
        }
        o.castShadow = true;
        o.receiveShadow = false;
        o.userData.sharedAsset = true;
      }
    });
    const pivot = new THREE.Group();
    pivot.scale.setScalar(HORSE_GLB.scala);
    pivot.rotation.y = HORSE_GLB.rotY;
    pivot.add(inner);
    // ── CENTRATURA MISURATA (non calcolata) ────────────────────────────────
    // Costruisco il pivot già scalato/ruotato, ne misuro la bounding box VERA,
    // e poi traslo l'INTERO pivot per portarne il centro X/Z sull'origine del
    // gruppo (dove siede il fantino) e i piedi a terra. Nessuna trigonometria,
    // nessuna assunzione sui pivot del modello: è il metodo che non può
    // sbagliare. Il calcolo "a mano" di prima lasciava i cavalli staccati.
    pivot.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(pivot);
    const c = bb.getCenter(new THREE.Vector3());
    pivot.position.set(-c.x, -bb.min.y + HORSE_GLB.trimY, -c.z);   // piedi a terra (+trim)
    // Nasconde il corpo procedurale; il FANTINO (e i suoi accessori) resta, ma
    // va RIALZATO/AVANZATO per sedere sul dorso del cavallo GLB (più alto e
    // centrato diversamente rispetto al corpo procedurale che sostituisce).
    horse.group.children.forEach((ch) => { if (ch !== horse.group.userData.jockey) ch.visible = false; });
    const jk = horse.group.userData.jockey;
    if (jk && !jk.userData.glbSeated) {
      // + trimY: il fantino SCENDE insieme al cavallo affondato (resta in sella).
      jk.position.y += HORSE_GLB.fantinoSu + HORSE_GLB.trimY;
      jk.position.z += HORSE_GLB.fantinoAvanti;
      jk.userData.glbSeated = true;   // una volta sola (l'attach può ripassare)
    }
    horse.group.add(pivot);
    horse.group.userData.glbHorse = pivot;
    // SPENNACCHIERA sulla FRONTE (colori della Contrada): resta anche a cavallo
    // SCOSSO — è figlia del gruppo, non del fantino — così riconosci il barbero
    // senza fantino. Ancorata alla TESTA MISURATA del modello, non a numeri fissi:
    // in coordinate del gruppo la cima del modello è (bb.max.y-bb.min.y)+trimY e il
    // muso è a bb.max.z-c.z (+Z = avanti). La fronte sta alta e appena arretrata dal
    // muso → prendo l'86% dell'altezza e il 78% dell'avanzamento.
    if (!horse.group.userData.spennacchiera) {
      // Ancora MISURATA sui vertici della testa (fronte reale). Fallback prudente
      // se la scansione fallisse: avanti quasi al muso e a mezza altezza.
      const fronte = calcolaAncoraFronte(inner, horse.group);
      const anchor = fronte
        ? { y: fronte.y, z: fronte.z }
        : { y: ((bb.max.y - bb.min.y) + HORSE_GLB.trimY) * 0.5, z: (bb.max.z - c.z) * 0.95 };
      const spenn = buildSpennacchiera(horse, anchor);
      horse.group.add(spenn);
      horse.group.userData.spennacchiera = true;
      // Riferimento + posa base: serve a farla OSCILLARE col galoppo (updateHorseGlb).
      horse.group.userData.spennObj = spenn;
      spenn.userData.baseY = spenn.position.y;
      spenn.userData.baseZ = spenn.position.z;
      spenn.userData.baseRotX = spenn.rotation.x;
      // ALLA TRATTA il barbero e' ancora di nessuno: la spennacchiera porta i
      // colori della Contrada, quindi non puo' stare sulla fronte prima che il
      // mossiere l'abbia chiamata. Spunta in announceTrattaContrada.
      // Si guarda un FLAG SUL CAVALLO e non state.mode: i cavalli (e i loro GLB)
      // nascono molto prima che la modalita' diventi "tratta", quindi al momento
      // dell'attach quel controllo era sempre falso e la spennacchiera restava.
      if (horse.attendeSpenn && !horse.spennRivelata) nascondiSpennacchiera(spenn);
    }
    // FANTINO GLB in sella: usa la bbox del cavallo (bb) per la seduta sul dorso.
    horse.group.userData.horseBB = bb;
    attaccaJockeyGlb(horse, bb);
    const mixer = new THREE.AnimationMixer(inner);
    if (HORSE_GLB.clip) mixer.clipAction(HORSE_GLB.clip).play();
    // Riferimento alla mesh con i morph: serve per METTERLA IN POSA FERMA
    // (tutti i pesi a 0 = cavallo dritto, 4 zampe piantate) al canapo.
    let morphMesh = null;
    inner.traverse((o) => { if (!morphMesh && o.morphTargetInfluences) morphMesh = o; });
    HORSE_GLB.registrati.push({ horse, mixer, morphMesh });
  } catch (e) { console.warn("[horse-glb] istanza fallita per", horse.name, e); }
}
// Ritmo del galoppo legato alla velocità del cavallo: fermo ai canapi = quasi
// immobile; in corsa il ciclo martella. Il cavallo A TERRA congela il clip.
// La cadenza delle zampe è legata alla VELOCITÀ REALE sul terreno (unità/sec),
// non al livello di animazione: così le falcate combaciano col movimento e non
// c'è né "galoppo sospeso" né pattinamento. GAIT_K è tarato perché a piena
// corsa (~25 u/s) il galoppo pompi ~2.4 falcate/sec (veloce, non al rallentatore).
// Fermo (canapo, o caduto) → posa DRITTA con le 4 zampe piantate.
const GAIT_K = 0.145;
function updateHorseGlb(dt) {
  if (!HORSE_GLB.registrati.length) return;
  const step = Math.max(dt, 1 / 120);
  for (let i = HORSE_GLB.registrati.length - 1; i >= 0; i -= 1) {
    const r = HORSE_GLB.registrati[i];
    if (!r.horse.group || !r.horse.group.parent) { HORSE_GLB.registrati.splice(i, 1); continue; }
    const infl = r.morphMesh && r.morphMesh.morphTargetInfluences;
    // CADUTO a terra: fermo davvero (zampe piantate, niente movimento).
    if (r.horse.caduto) { if (infl) infl.fill(0); continue; }
    const gs = Math.abs((r.horse.progress || 0) - (r.horse.prevProgress ?? r.horse.progress)) / step;
    // race: 0 ai canapi / da fermo, → 1 in piena corsa.
    const race = clamp((gs - 0.4) / 6, 0, 1);
    // Cadenza: passo lento fra i canapi (0.55×), galoppo pieno e veloce in corsa.
    r.mixer.update(dt * (race > 0 ? clamp(gs * GAIT_K, 0.15, 6) : 0.55));
    // AMPIEZZA: fra i canapi le zampe si alzano POCO (0.32 = passo accennato, non
    // galoppo in aria); in corsa arriva al 100%. Scalo i pesi dopo il mixer, così
    // il cavallo si muove ma resta coi piedi a terra al canapo.
    if (infl) {
      const amp = 0.32 + 0.68 * race;
      if (amp < 0.999) for (let k = 0; k < infl.length; k += 1) infl[k] *= amp;
    }
    // ── SPENNACCHIERA che segue l'OSCILLAZIONE della testa: la testa GLB fa su e
    // giù (e annuisce) al galoppo; la spennacchiera è agganciata al gruppo, non a
    // un osso, quindi la faccio ondeggiare a mano in SINCRONO con la falcata —
    // una nutata per passo, ampiezza che cresce con la corsa.
    const spenn = r.horse.group.userData && r.horse.group.userData.spennObj;
    if (spenn && spenn.userData && r.morphMesh) {
      // POSIZIONE VERA della fronte, ricalcolata a ogni frame dai morph del galoppo
      // (cavallo-lab). Prima si ondeggiava con un seno NON sincronizzato ai morph:
      // la fronte si muove di 0.69 in altezza per falcata e la spennacchiera si
      // staccava dalla testa. L'offset di montaggio iniziale viene preservato.
      aggiornaComparsa(spenn, dt);   // la molla della comparsa (tratta)
      ancoraFronteViva(r.morphMesh, r.horse.group, _spennPos);
      if (!spenn.userData.offReady) {
        spenn.userData.offX = spenn.position.x - _spennPos.x;
        spenn.userData.offY = spenn.position.y - _spennPos.y;
        spenn.userData.offZ = spenn.position.z - _spennPos.z;
        spenn.userData.offReady = true;
      }
      spenn.position.set(_spennPos.x + spenn.userData.offX,
                         _spennPos.y + spenn.userData.offY,
                         _spennPos.z + spenn.userData.offZ);
      // Resta solo un filo di nutata, SOPRA la posizione vera.
      const cad = race > 0 ? clamp(gs * GAIT_K, 0.15, 6) : 0.55;
      r.spennPhase = (r.spennPhase || 0) + dt * cad * 4.19;
      spenn.rotation.x = (spenn.userData.baseRotX ?? 0) + Math.sin(r.spennPhase) * (0.05 + 0.13 * race);
    }
  }
}

// Distribuzione dei manti dei cavalli GLB: SOLO marrone (varie tonalità) o nero.
// Niente grigi né bianchi. Assegnato per-cavallo alla creazione.
function pickMantoGlb() {
  const r = Math.random();
  if (r < 0.35) return "#1a1512";                                   // nero
  const marroni = ["#6b4a2a", "#7a4526", "#5a3620", "#875233", "#4a2c1b"];
  return marroni[Math.floor(Math.random() * marroni.length)];       // marrone
}
// MANTI FISSI per barbero (per nome): questi cavalli hanno SEMPRE il manto indicato,
// non quello casuale. Solo MARRONE (varie tonalità) o NERO — niente grigi né bianchi.
const MANTI_FISSI = {
  // ex-bianchi → ora marrone/nero
  "Urbino de Ozieri": "#7a4526", "Fedora Saura": "#4a2c1b", "Figaro": "#1a1512",
  // ex-grigi → ora marrone/nero
  "Mirabella": "#6b4a2a", "Selvaggia": "#1a1512", "Oppio": "#5a3620", "Gaudenzia": "#875233", "Anda e Bola": "#1a1512",
  // nero (#1a1512)
  "Comancio": "#1a1512", "Pytheos": "#1a1512", "Benitos": "#1a1512", "Viso d'Angelo": "#1a1512", "Vipera": "#1a1512", "Diodoro": "#1a1512",
  // marrone chiaro
  "Remorex": "#a5734a",
};
const MANTO_BIANCO = "#c6c3bc", MANTO_GRIGIO = "#a2a9b0";
// Imposta il manto GLB di un cavallo e RI-TINGE il modello se già in scena (con
// l'emissive che compensa la luce calda, come alla creazione).
function applyMantoColor(horse, color) {
  horse.mantoGlb = color;
  const glb = horse.group && horse.group.userData && horse.group.userData.glbHorse;
  if (!glb) return;
  const c = new THREE.Color(color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const em = lum > 0.35 ? Math.min(lum * 0.62, 0.5) : 0;
  glb.traverse((o) => {
    if (o.isMesh && o.material) {
      if (o.material.color) o.material.color.set(color);
      if ("roughness" in o.material) o.material.roughness = 1.0;
      if (em > 0 && "emissive" in o.material) {
        o.material.emissive = new THREE.Color(color);
        o.material.emissiveIntensity = em;
      }
    }
  });
}
// Applica il manto fisso (se previsto) e RI-TINGE il cavallo GLB se già in scena.
function applyMantoFisso(horse) {
  // MANTO VERO del barbero, dall'Archivio del Palio (cavallo-lab): baio, sauro,
  // baio oscuro, grigio, roano, storno… Ha la precedenza su tutto. Solo i cavalli
  // il cui manto non è documentato ricadono sulla vecchia tabella marrone/nero.
  const vero = mantoDi(horse && horse.horseName);
  if (vero) { applyMantoColor(horse, vero); return; }
  const m = MANTI_FISSI[horse && horse.horseName];
  if (m) applyMantoColor(horse, m);
}

// ════ FANTINO GLB (modello umano riggato, in sella) ═══════════════════════════
// Modello Xbot (rig mixamo, licenza libera). Lo coloriamo PER REGIONE del corpo
// leggendo l'osso dominante di ogni vertice (giubbetto = colori contrada, maniche,
// pantaloni, pelle, stivali), lo mettiamo in POSA da fantino accovacciato, gli
// aggiungiamo lo zucchino, e lo sediamo sul dorso del cavallo GLB. Fallback: se non
// carica (o ?jockeyglb=0) resta il fantino procedurale.
const JOCKEY_GLB = {
  url: "assets/jockeys/jockey_master.glb",
  // In ANTEPRIMA dietro ?jockeyglb=1 finché non è approvato (default = procedurali).
  attivo: /[?&]jockeyglb=1/.test(window.location.search),
  gltf: null, pronto: false, fallito: false, natH: 2.86,
  // Posa da fantino accovacciato — ossa Quaternius (nomi SENZA punto: UpperLegL, non
  // UpperLeg.L). TARATA A VISTA su jockey-test.html col cavallo GLB.
  // NB: le ossa KayKit hanno il PUNTO nel nome (UpperArm.L, non UpperArmL). La posa
  // va indicizzata con quei nomi ESATTI, altrimenti non si applica (fantino in T-pose).
  pose: {
    Torso: [0.42, 0, 0], Abdomen: [0.22, 0, 0], Neck: [-0.25, 0, 0], Head: [-0.15, 0, 0],
    "UpperLeg.L": [0, 0, 1.4], "UpperLeg.R": [0, 0, -1.4],
    "LowerLeg.L": [0, 0, -1.6], "LowerLeg.R": [0, 0, 1.6],
    // Braccia TESE IN AVANTI verso la testa del cavallo (redini), gomito quasi dritto.
    "UpperArm.L": [0, -0.9, -1.15], "UpperArm.R": [0, 0.9, 1.15],
    "LowerArm.L": [0, -0.15, 0], "LowerArm.R": [0, 0.15, 0],
  },
  // Ricolora PER NOME MATERIALE: Shirt = giubbetto (contrada 0), UnderShirt/Pants =
  // secondario, Detail = liste; i capelli restano scuri sotto lo ZUCCHINO (calotta
  // colorata aggiunta a parte). Skin/Eye/Boots restano.
  backFrac: 0.52, seatDrop: 0.15, seatFwd: 0.45, rotY: 0,
};
function caricaJockeyGlb() {
  if (!JOCKEY_GLB.attivo) return;
  new GLTFLoader().load(JOCKEY_GLB.url, (gltf) => {
    try {
      JOCKEY_GLB.gltf = gltf;
      // POSA la sorgente una volta sola: i cloni (SkeletonUtils) la ereditano.
      gltf.scene.traverse((o) => { if (o.isBone) { const p = JOCKEY_GLB.pose[o.name]; if (p) o.rotation.set(p[0], p[1], p[2]); } });
      gltf.scene.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(gltf.scene);
      JOCKEY_GLB.natH = Math.max(0.1, bb.max.y - bb.min.y);
      JOCKEY_GLB.pronto = true;
      [...state.horses, ...(state.demoHorses || [])].forEach((h) => {
        if (h.group && h.group.userData.glbHorse) attaccaJockeyGlb(h, h.group.userData.horseBB);
      });
    } catch (e) { JOCKEY_GLB.fallito = true; console.warn("[jockey-glb] init fallito:", e); }
  }, undefined, (err) => { JOCKEY_GLB.fallito = true; console.warn("[jockey-glb] load fallito:", err && err.message); });
}
// Aggancia il fantino GLB a un cavallo. bbHorse = bbox del pivot cavallo (spazio gruppo).
function attaccaJockeyGlb(horse, bbHorse) {
  if (!JOCKEY_GLB.pronto || !horse || !horse.group || !bbHorse) return;
  const jkGroup = horse.group.userData.jockey;
  if (!jkGroup || jkGroup.userData.glbJockey) return;
  try {
    const clone = SkeletonUtils.clone(JOCKEY_GLB.gltf.scene);
    const cols = horse.colors || ["#c0392b", "#ecf0f1", "#2c3e50"];
    // Ricolora per nome materiale (materiali CLONATI per non toccare gli altri cavalli).
    const matCol = { Shirt: cols[0], UnderShirt: cols[1], Pants: cols[1], Detail: cols[2], Hair: "#2b2019" };
    clone.traverse((o) => {
      if (!o.isMesh) return;
      const wasArray = Array.isArray(o.material);
      const mats = wasArray ? o.material : [o.material];
      const cloned = mats.map((m) => {
        if (!m) return m;
        const nm = m.clone();
        if (nm.name && matCol[nm.name] && nm.color) nm.color.set(matCol[nm.name]);
        return nm;
      });
      o.material = wasArray ? cloned : cloned[0];
      o.castShadow = true; o.receiveShadow = false;
    });
    clone.updateMatrixWorld(true);
    // ZUCCHINO: calotta nei colori contrada che copre la sommità della testa (aggiunta
    // al MODELLO alla posizione LOCALE della testa — le ossa hanno scala enorme).
    let jkHead = null; clone.traverse((o) => { if (o.name === "Head") jkHead = o; });
    if (jkHead) {
      const hp = clone.worldToLocal(jkHead.getWorldPosition(new THREE.Vector3()));
      const zg = new THREE.Group(); zg.position.set(hp.x, hp.y + 0.30, hp.z + 0.06); clone.add(zg);
      const R = 0.48;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 16, 0, TAU, 0, Math.PI * 0.68), new THREE.MeshStandardMaterial({ color: cols[0], roughness: 0.5 }));
      dome.scale.set(1, 0.98, 1.06); dome.castShadow = true; zg.add(dome);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(R * 0.26, 0.05, R * 2.05), new THREE.MeshStandardMaterial({ color: cols[2] }));
      stripe.position.y = R * 0.02; zg.add(stripe);
    }
    // NERBO nella mano SINISTRA (FistL), aggiunto al modello alla posizione locale.
    // Nome osso mano sinistra: col punto (Fist.L, rig Quaternius/KayKit) o senza (FistL).
    let jkFistL = null; clone.traverse((o) => { if (o.name === "Fist.L" || o.name === "FistL") jkFistL = o; });
    if (jkFistL) {
      const fp = clone.worldToLocal(jkFistL.getWorldPosition(new THREE.Vector3()));
      const ng = new THREE.Group(); ng.position.copy(fp); clone.add(ng);
      const nerbo = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.0, 7), new THREE.MeshStandardMaterial({ color: 0x1e130c, roughness: 0.85 }));
      nerbo.position.set(0, -0.4, 0.1); nerbo.rotation.x = 0.5; nerbo.castShadow = true; ng.add(nerbo);
    }
    // SCALA + SEDUTA sul dorso misurato.
    const jkTarget = HORSE_GLB.altezzaTarget * HORSE_GLB.boost * 0.5;   // ~1.7
    const scala = jkTarget / JOCKEY_GLB.natH;
    const pivot = new THREE.Group();
    pivot.scale.setScalar(scala);
    pivot.rotation.y = JOCKEY_GLB.rotY;
    pivot.add(clone);
    pivot.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(pivot);
    const c = bb.getCenter(new THREE.Vector3());
    const horseH = (bbHorse.max.y - bbHorse.min.y);
    const backY = HORSE_GLB.trimY + horseH * JOCKEY_GLB.backFrac;   // dorso in spazio gruppo
    const jkY = backY - JOCKEY_GLB.seatDrop - (jkGroup.position.y || 0);
    pivot.position.set(-c.x, jkY - bb.min.y, -c.z + JOCKEY_GLB.seatFwd);
    jkGroup.add(pivot);
    jkGroup.userData.glbJockey = pivot;
    // Nasconde il fantino PROCEDURALE (le sue mesh), tenendo il gruppo (per fall/scosso).
    jkGroup.children.forEach((ch) => { if (ch !== pivot) ch.visible = false; });
  } catch (e) { console.warn("[jockey-glb] attacco fallito per", horse.name, e); }
}

function createHorse(contrada, index, isPlayer) {
  const coatVariant = coatVariantForIndex(index);
  const horse = {
    id: contrada.id,
    name: contrada.name,
    colors: contrada.colors,
    coat: contrada.coat,
    coatVariant: coatVariant.id,
    mantoGlb: pickMantoGlb(),   // colore del cavallo GLB: 20% nero, 10% grigio, 5% bianco, 65% marrone
    player: isPlayer,
    group: createHorseModel(contrada, isPlayer, index),
    progress: -9 - Math.floor(index / 2) * 1.2,
    prevProgress: -9 - Math.floor(index / 2) * 1.2,
    lane: lerp(-AI_LANE_LIMIT + 0.35, AI_LANE_LIMIT - 0.35, index / 9),
    laneVelocity: 0,
    speedSetting: isPlayer ? randomInteger(PLAYER_SPEED_MIN, ANDATURA_MAX) : null,
    effectiveSpeedLevel: BASE_SPEED_LEVEL,
    speedLevel: isPlayer ? 2 : BASE_SPEED_LEVEL,
    targetSpeedLevel: isPlayer ? 2 : BASE_SPEED_LEVEL,
    travelSpeed: 0,                               // velocità di movimento giocatore (u/sec), morbida
    staminaMax: randomInteger(STAMINA_MIN_ROLL, STAMINA_MAX_ROLL),
    stamina: STAMINA_MIN_ROLL,
    staminaLimited: false,
    speedPulse: 0,
    brakePulse: 0,
    phase: Math.random() * TAU,                   // solo fase di animazione (estetica)
    // ── Prestazione in GARA identica per tutti (equità) ──────────────────
    // In corsa la differenza la fanno solo stamina (±5) e la linea/andatura
    // copiata da te: skill e lineBias restano costanti. NON così alla mossa…
    skill: 1.0,
    nerves: 0.5,
    // ── …INDOLE alla MOSSA, differenziata per cavallo e fantino ──────────
    // Dà vita al tondino: chi è nervoso, chi calmo, chi aggressivo, chi entra
    // bene o male. Non incide sulla prestazione di corsa (solo sulla mossa/via).
    aggression: 0.3 + Math.random() * 0.7,       // fantino: controllo ↔ disturbo/strategia
    nervousness: 0.2 + Math.random() * 0.7,      // cavallo: calmo ↔ agitato al tondino/canapo
    nervousnessCurrent: 0,                        // valore dinamico, con contagio
    coldBlood: 0.3 + Math.random() * 0.6,        // fantino: freddezza alla mossa (resiste al contagio)
    sprint: 0.75 + Math.random() * 0.5,          // cavallo: rapidità di scatto al via
    reactivity: 0.35 + Math.random() * 0.6,      // prontezza/qualità d'ingresso e di scatto
    stability: 0.3 + Math.random() * 0.65,       // entra/parte dritto ↔ storto
    launchDelay: 0,                               // ritardo di reazione, calcolato al via
    launchDelayTimer: 0,                          // conto alla rovescia del ritardo
    launching: false,                             // true nei primissimi istanti dopo il via
    launchHeadingDev: 0,                          // deviazione del muso al via
    startQuality: "clean",                        // 'clean'|'dirty'|'closed'|'wide'|'slow'
    mossaSubState: "wait",                        // sub-stato individuale (rincorsa: wait|runup|charging)
    rincorsaSpeed: 0,                             // velocità di avvicinamento della rincorsa
    // Piccole variazioni PERSONALI attorno alle medie salvate: ogni cavallo
    // tiene una linea un filo più interna/esterna e va un filo più/meno veloce.
    // Restano piccole (non stravolgono l'equità), ma tolgono l'effetto "cloni".
    lineBias: (Math.random() * 2 - 1),            // offset di corsia (± ~1 unità)
    speedVar: 1 + (Math.random() * 2 - 1) * 0.065, // ±6.5% sulla velocità copiata
    targetLane: lerp(-AI_LANE_LIMIT + 0.35, AI_LANE_LIMIT - 0.35, index / 9),
    surgeTimer: 0,
    surgeCooldown: 1.6 + Math.random() * 3.4,
    surgeTarget: 0,
    mistakeTimer: 0,
    mistakeCooldown: 1.8 + Math.random() * 4,
    finishTime: null,
    lastCurve: 0,
    displayRank: 1,
    boosting: false,
    braking: false,
    sliding: false,
    wasStaminaLimited: false,
    risk: 0,
    collisionFlash: 0,
    // ── NERBATA: 5 colpi "in canna", ricarica 1 ogni NERBATA_RECHARGE secondi.
    nerbate: NERBATE_MAX,
    nerbataRechargeT: 0,
    nerbataCd: 0,         // cadenza minima fra due nerbate dello stesso attaccante
    nerbataSwing: 0,      // >0 = frusta in animazione di colpo
    nerbSlowT: 0          // >0 = rallentato da una nerbata subita (in gara)
  };
  horse.stamina = horse.staminaMax;
  horse.nervousnessCurrent = horse.nervousness;
  // La difficoltà NON tocca più velocità/stamina/bravura grezza: incide solo
  // sulla qualità della TRAIETTORIA delle AI (vedi aiLineSkill / updateAiHorse).
  scene.add(horse.group);
  placeHorse(horse, 0);
  attaccaHorseGlb(horse);   // se il GLB è già pronto; sennò retro-attacca il loader
  return horse;
}

function getHorseAnimationState(horse) {
  // Tagliato il traguardo il cavallo NON si spegne di colpo: finché si muove
  // ancora resta al GALOPPO, e solo quando è quasi fermo passa al passo e poi
  // all'idle. Prima bastava toccare la linea per far scattare l'animazione da
  // fermo, e il cavallo scivolava avanti con le gambe immobili.
  if (horse.finishTime) {
    if (horse.speedLevel > 3.4) return "gallop";
    if (horse.speedLevel > 1.2) return "walk";
    return "afterRaceIdle";
  }
  if (horse.sliding || horse.collisionFlash > 0.55) return "stumbleRecovery";
  if (horse.braking || horse.staminaLimited) return "slowDown";
  if (horse.boosting && horse.speedLevel >= 6.8) return "startBurst";
  if (Math.abs(horse.laneVelocity) > 2.45) return horse.laneVelocity > 0 ? "turnRight" : "turnLeft";
  if (horse.speedLevel < 0.9) return "idle";
  if (horse.speedLevel < 3.1) return "walk";
  if (horse.speedLevel < 5.5) return "trot";
  return "gallop";
}

function placeHorse(horse, time) {
  const sample = sampleAt(horse.progress);
  const animationState = getHorseAnimationState(horse);
  const profile = HORSE_ANIMATION_PROFILES[animationState] || HORSE_ANIMATION_PROFILES.gallop;
  const offset = sample.normal.clone().multiplyScalar(horse.lane);
  const movement = clamp(horse.speedLevel / 8, 0.16, 1.15);
  const gaitTime = time * (profile.frequency + horse.speedLevel * 0.72) + horse.phase;
  // Niente rimbalzo verticale procedurale sui cavalli GLB: la loro animazione di
  // galoppo dà già il movimento del corpo, e il doppio effetto li faceva galleggiare.
  const bob = horse.group.userData.glbHorse ? 0 : Math.sin(gaitTime * 1.22) * profile.bob * movement;
  horse.group.position.copy(sample.point).add(offset);
  // ATTENZIONE: sampleAt() NON restituisce `cum` — la quota si calcola dal
  // progress (modulo giro), come per la svasatura dei canapi.
  horse.group.position.y = 0.02 + bob + trackHeightAt(positiveMod(horse.progress || 0, track.length || 1));
  // Il giocatore, in gara, è orientato dal proprio heading manuale; le AI (e il
  // giocatore alla mossa) seguono la tangente della pista. In ASSISTI il cavallo-
  // focus (rivale) è in autopilot: lo guida l'AI, quindi va orientato come un'AI
  // (tangente pista), NON con l'heading del giocatore (che resterebbe fermo/storto).
  const useHeading = horse.player && !horse.autopilot && horse.heading !== undefined && (state.mode === "race" || state.mode === "finished");
  // Beccheggio/rollio limitati: il movimento laterale dà solo un leggero
  // ondeggiamento (utile per "sculare" alla mossa) ma il cavallo resta sempre
  // dritto e robusto, non si corica mai fino a sparire.
  const leanVel = clamp(horse.laneVelocity, -4, 4);
  // Alla mossa il cavallo può essere GIRATO sul posto (giocatore con A/L, AI per
  // nervosismo) senza cambiare posizione: si somma un angolo di rotazione.
  const mossaTurn = state.mode === "mossa" ? (horse.mossaTurn || 0) : 0;
  // Alla TRATTA i cavalli sono girati verso la camera (presentazione): angolo fisso.
  const trattaTurn = state.mode === "tratta" ? (horse.trattaTurn || 0) : 0;
  // In gara le AI partite storte restano storte finché non si raddrizzano
  // galoppando (raceTurn decade in updateAiHorse, niente scatto al via).
  const raceTurn = (state.mode !== "mossa" && state.mode !== "tratta" && !useHeading) ? (horse.raceTurn || 0) : 0;
  horse.group.rotation.y = (useHeading ? horse.heading : sample.yaw) + leanVel * 0.02 + mossaTurn + trattaTurn + raceTurn;
  horse.group.rotation.z = clamp(
    leanVel * 0.03 +
      (animationState === "stumbleRecovery" ? Math.sin(time * 32 + horse.phase) * 0.045 : 0),
    -0.16,
    0.16
  );
  // CAVALLO CADUTO: coricato sul fianco. Sovrascrive il roll normale (clampato a
  // ±0.16) finché cadutoRoll non torna a zero con la rialzata.
  if (horse.cadutoRoll) horse.group.rotation.z = horse.cadutoRoll;
  horse.lastCurve = sample.curve;
  horse.collisionFlash = Math.max(0, horse.collisionFlash - 0.045);

  const gallop = gaitTime;
  const stridePower = profile.stride * clamp(horse.speedLevel / 6.5, 0.35, 1.18);
  if (horse.group.userData.bodyCore) {
    const breath = Math.sin(gallop * 0.5) * 0.012;
    const stretch = animationState === "startBurst" ? 0.035 : animationState === "slowDown" ? -0.018 : 0;
    horse.group.userData.bodyCore.scale.set(0.72, 0.66 + breath, 1.32 + stretch - breath * 0.8);
  }
  horse.group.userData.legs.forEach((leg, index) => {
    const phase = index === 0 || index === 3 ? 0 : Math.PI;
    const stride = Math.sin(gallop + phase);
    const reach = Math.cos(gallop + phase);
    leg.rotation.x = stride * (0.18 + stridePower * 0.72) + (index < 2 ? -0.06 : 0.1);
    if (leg.userData.upper) leg.userData.upper.rotation.x = reach * (0.06 + stridePower * 0.15);
    if (leg.userData.joint) leg.userData.joint.position.z = (index < 2 ? 0.05 : -0.04) + reach * (0.018 + stridePower * 0.036);
    if (leg.userData.lower) leg.userData.lower.rotation.x = -stride * (0.14 + stridePower * 0.48) + reach * (0.08 + stridePower * 0.14);
    if (leg.userData.fetlock) leg.userData.fetlock.rotation.x = -stride * (0.08 + stridePower * 0.2);
    if (leg.userData.hoof) leg.userData.hoof.rotation.x = (index < 2 ? -0.12 : 0.12) - stride * (0.08 + stridePower * 0.23);
  });
  if (horse.group.userData.tail) {
    horse.group.userData.tail.rotation.x = 1.12 + Math.sin(gallop * 0.52) * profile.tail;
    horse.group.userData.tail.rotation.z = -horse.laneVelocity * 0.06 + Math.sin(time * 4 + horse.phase) * 0.08;
  }
  if (horse.group.userData.tailStrands) {
    horse.group.userData.tailStrands.forEach((strand, index) => {
      strand.rotation.x = 1.24 + Math.sin(gallop * 0.5 + index) * (profile.tail * 0.92);
      strand.rotation.z = -horse.laneVelocity * 0.07 + Math.sin(time * 4.3 + horse.phase + index) * 0.1;
    });
  }
  if (horse.group.userData.head) {
    horse.group.userData.head.rotation.x = -0.18 + Math.sin(gallop * 0.46) * profile.neck + (animationState === "slowDown" ? 0.035 : 0);
  }
  if (horse.group.userData.neck) {
    horse.group.userData.neck.rotation.x = -0.7 + Math.sin(gallop * 0.42) * profile.neck + (animationState === "startBurst" ? -0.035 : 0);
  }
  if (horse.group.userData.ears) {
    horse.group.userData.ears.forEach((ear, index) => {
      ear.rotation.z = (index === 0 ? 0.14 : -0.14) + Math.sin(time * 2.7 + horse.phase + index) * 0.035;
      ear.rotation.x = -0.32 + Math.sin(time * 3.1 + index) * 0.02;
    });
  }
  if (horse.group.userData.maneStrands) {
    horse.group.userData.maneStrands.forEach((strand, index) => {
      strand.rotation.z = (index % 2 ? -0.05 : 0.05) - horse.laneVelocity * 0.018 + Math.sin(time * (4.4 + movement * 2.4) + index + horse.phase) * (0.018 + profile.tail * 0.08);
    });
  }
  const jockey = horse.group.userData.jockey;
  jockey.rotation.x = -0.12 + Math.sin(gallop * 0.5) * 0.052 - clamp(horse.speedLevel - 6, 0, 3) * 0.025 + (animationState === "slowDown" ? 0.045 : 0);
  jockey.rotation.z = -horse.laneVelocity * 0.02;
  // VITTORIA: il fantino vincitore taglia il traguardo e resta col NERBO ALZATO
  // — braccio destro teso in alto, gesto leggibile anche da lontano. Nel replay
  // il nerbo si alza solo al momento del traguardo (replayAtEnd).
  const victorious = state.rankings && state.rankings[0] === horse && (
    state.mode === "finished" ||
    (state.mode === "replayWin" && state.replayAtEnd) ||
    (state.mode === "race" && horse.finishTime != null) ||
    // già a 4 unità dall'arrivo il vincitore in testa ALZA IL NERBO in segno di vittoria.
    // Il braccio si alza un secondo prima di prima (15 unità invece di 4): il
    // gesto della vittoria si vede arrivare, non scatta sul filo.
    (state.mode === "race" && (horse.progress || 0) >= track.length * FINISH_LAPS - 15)
  );
  // NERBATA in corso: colpo secco di frusta di lato (verso la vittima). Ha la
  // priorità sull'animazione normale del braccio/nerbo finché nerbataSwing > 0.
  const nerbando = (horse.nerbataSwing || 0) > 0;
  const nerbSideSign = horse.nerbataSide || 1;   // +1 destra, −1 sinistra
  const f2 = !!jockey.userData.fantino2;
  // Il nerbo è nella mano del braccio "rightArm" (quello che a schermo vedi a SINISTRA):
  // la nerbata usa SEMPRE quel braccio. A destra (K) e sul vecchio fantino = colpo
  // ALZATO di lato. A sinistra (S, solo fantino2) = DISPIEGAMENTO LATERALE (non dall'alto).
  // Il braccio opposto resta sulle redini.
  const nerbLatSx = nerbando && f2 && nerbSideSign < 0;
  if (jockey.userData.rightArm) {
    if (nerbLatSx) {
      jockey.userData.rightArm.rotation.x = -0.2;                        // quasi orizzontale, in avanti
      jockey.userData.rightArm.rotation.z = 1.1;                         // dispiegato lateralmente a sinistra
    } else if (nerbando) {
      jockey.userData.rightArm.rotation.x = -1.9;                        // braccio alzato per colpire
      jockey.userData.rightArm.rotation.z = -0.7 * nerbSideSign;         // sferza di lato
    } else if (victorious) {
      jockey.userData.rightArm.rotation.z = -0.12 + Math.sin(time * 5) * 0.06;
      jockey.userData.rightArm.rotation.x = -2.6;                 // braccio al cielo
    } else if (jockey.userData.fantino2) {
      // NUOVO fantino: braccio GIÀ teso avanti sulle redini (posa costruita ~0).
      // Solo lieve oscillazione col galoppo, MAI sollevato.
      jockey.userData.rightArm.rotation.x = Math.sin(gallop * 0.5) * 0.05 + (horse.boosting ? -0.06 : 0);
      jockey.userData.rightArm.rotation.z = 0;
    } else {
      const nerboActive = horse.player && horse.boosting;
      jockey.userData.rightArm.rotation.z = nerboActive ? -0.46 + Math.sin(gallop * 1.65) * 0.12 : -0.32;
      jockey.userData.rightArm.rotation.x = nerboActive ? -0.9 + Math.sin(gallop * 1.4) * 0.18 : -1.05;
    }
  }
  // BRACCIO SINISTRO: tiene le redini in avanti (come il destro a riposo); si alza
  // dritto al cielo SOLO in vittoria. Nessuna nerbata/oscillazione: sta fermo sulle redini.
  if (jockey.userData.leftArm) {
    if (victorious) {
      jockey.userData.leftArm.rotation.x = -2.6;                         // su, al cielo
      jockey.userData.leftArm.rotation.z = 0.12 + Math.sin(time * 5) * 0.06;
    } else {
      // teso AVANTI sulle redini (posa costruita ~0), giù come il destro; lieve oscillazione
      jockey.userData.leftArm.rotation.x = Math.sin(gallop * 0.5) * 0.05 + (horse.boosting ? -0.06 : 0);
      jockey.userData.leftArm.rotation.z = 0;
    }
  }
  if (jockey.userData.whip) {
    if (nerbLatSx) {
      jockey.userData.whip.rotation.z = 0.3;    // nerbo teso verso il cavallo a SINISTRA
      jockey.userData.whip.rotation.x = 0.1;
    } else if (nerbando) {
      jockey.userData.whip.rotation.z = -1.0 * nerbSideSign;   // frusta scattata di lato
      jockey.userData.whip.rotation.x = -0.2;
    } else if (victorious) {
      jockey.userData.whip.rotation.z = 0.05 + Math.sin(time * 5) * 0.08;  // nerbo dritto in alto
      jockey.userData.whip.rotation.x = -0.5;
    } else {
      jockey.userData.whip.rotation.z = horse.boosting ? -0.16 + Math.sin(gallop * 1.85) * 0.14 : -0.06;
      jockey.userData.whip.rotation.x = horse.boosting ? -0.18 + Math.sin(gallop * 1.35) * 0.12 : -0.08;
    }
  }
  if (horse.group.userData.boostGroup) {
    horse.group.userData.boostGroup.children.forEach((streak, index) => {
      // Streak di velocità rimosse: niente scie/luci gialle, look più realistico.
      const visible = false;
      streak.visible = visible;
      streak.material.opacity = 0;
      streak.position.z = -1.55 - index * 0.42 - Math.sin(time * 18 + index) * 0.18;
      streak.scale.y = 0.85 + clamp(horse.speedLevel / 10, 0, 1) * 0.7;
    });
  }
}

// Materiali CONDIVISI (tufo, pietra, black/white, corde…): NON vanno mai disposti,
// li usano anche fontana, palchi e canapi. Solo i per-cavallo si liberano.
let __sharedMats = null;
function disposeHorseGroup(horse) {
  if (!horse || !horse.group) return;
  scene.remove(horse.group);
  if (!__sharedMats) __sharedMats = new Set(Object.values(materials));
  horse.group.traverse((obj) => {
    // La MESH GLB è un CLONE che condivide la geometria con tutti gli altri
    // cavalli: smaltirla qui romperebbe i cloni ancora vivi. Il materiale del
    // GLB invece è per-cavallo (tinta del mantello) e va smaltito normalmente.
    if (obj.geometry && !obj.userData.sharedAsset) obj.geometry.dispose();   // geometrie per-cavallo
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    mats.forEach((m) => {
      if (!m || __sharedMats.has(m)) return;           // lascia stare i condivisi
      m.dispose();                                     // materiale per-istanza (la texture resta in cache)
    });
  });
}

function removeRaceHorses() {
  [...state.horses, ...state.demoHorses].forEach(disposeHorseGroup);
  state.horses = [];
  state.demoHorses = [];
}

// Ripristina lo sfondo animato del menu/selezione: toglie i cavalli-gara residui
// e ricrea gli 8 cavalli-demo se una gara li aveva rimossi (senza questo, dopo la
// prima corsa il fondale del menu resterebbe vuoto e i cavalli-gara restavano fermi).
function ensureDemoScene() {
  if (!boot.ready) return;   // durante il boot ci pensa init(): evita doppioni
  if (state.horses.length) {
    state.horses.forEach(disposeHorseGroup);
    state.horses = [];
  }
  if (!state.demoHorses.length) createDemoHorses();
}

function pickRaceContrade() {
  const selected = state.selectedContrada || CONTRADE[0];
  // Se c'è stata l'ESTRAZIONE, corrono le 10 Contrade determinate lì (7 di
  // diritto + 3 sorteggiate, o 10 sorteggiate nello straordinario).
  const est = state.estrazione;
  if (est && est.participants && est.participants.length === 10
      && est.participants.some((c) => c.id === selected.id)) {
    return [selected, ...est.participants.filter((c) => c.id !== selected.id)];
  }
  // SQUALIFICATE: chi ha preso tre avvertimenti salta questo Palio. La Contrada
  // del giocatore fa eccezione nella paliata veloce (l'ha appena scelta e
  // resterebbe senza gioco); in campagna la squalifica ha effetto pieno, perché
  // lì non correre significa assistere al Palio della rivale.
  const pool = CONTRADE.filter((contrada) => contrada.id !== selected.id
    && !contradaSqualificata(contrada.id));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [selected, ...pool.slice(0, 9)];
}

function createEntrants() {
  removeRaceHorses();
  const entrants = pickRaceContrade();
  state.horses = entrants.map((contrada, index) => createHorse(contrada, index, index === 0));
  // DOPO SAN MARTINO: garantiamo che ALMENO 6 su 10 restino ESTERNE (verso sinistra)
  // lungo il rettilineo del Palazzo, per poi CHIUDERE STRETTO il Casato. Marchiamo
  // 7 dei 9 AI come "casatoWide" (mescolati, così cambiano ogni palio).
  {
    const ai = state.horses.filter((h) => !h.player);
    for (let i = ai.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); const t = ai[i]; ai[i] = ai[j]; ai[j] = t; }
    ai.forEach((h, i) => { h.casatoWide = i < 7; });
  }
}

function createDemoHorses() {
  state.demoHorses = CONTRADE.slice(0, 8).map((contrada, index) => {
    const horse = createHorse(contrada, index, false);
    horse.progress = (index / 8) * track.length;
    horse.lane = -2.3 + (index % 4) * 1.5;
    horse.speedLevel = 3.2 + index * 0.16;
    placeHorse(horse, 0);
    return horse;
  });
}

function getPlayer() {
  return state.horses.find((horse) => horse.player);
}

function showScreen(name) {
  Object.entries(ui.screens).forEach(([key, screen]) => {
    screen.classList.toggle("active", key === name);
  });
  // Il chip col nome profilo si vede SOLO in home (menu). Durante il gioco (tratta,
  // mossa, gara, risultati, ecc. → name diverso da "menu") va nascosto.
  const chip = document.getElementById("accountChip");
  if (chip) chip.style.display = (name === "menu") ? "flex" : "none";
}

function setHudVisible(visible) {
  ui.hud.classList.toggle("visible", visible);
  ui.touchControls.classList.toggle("visible", visible);
  if (ui.minimap) ui.minimap.style.display = visible ? "block" : "none";
  if (!visible) {
    ui.speedVignette.classList.remove("boosting", "braking");
  }
}

// Trasformazione mondo -> mini-mappa (88x88, raggio 44). Calcolata una volta dal
// bounding box del tracciato.
let minimapTransform = null;
function getMinimapTransform() {
  if (minimapTransform) return minimapTransform;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  track.samples.forEach((s) => {
    minX = Math.min(minX, s.point.x);
    maxX = Math.max(maxX, s.point.x);
    minZ = Math.min(minZ, s.point.z);
    maxZ = Math.max(maxZ, s.point.z);
  });
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ) / 2 || 1;
  minimapTransform = { cx, cz, scale: 40 / span };
  return minimapTransform;
}

function worldToMinimap(x, z) {
  const t = getMinimapTransform();
  return {
    px: 44 - (x - t.cx) * t.scale,
    py: 44 - (z - t.cz) * t.scale
  };
}

function drawMinimap() {
  const canvas = ui.minimap;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, 88, 88);

  // Tracciato (un campione ogni 9).
  ctx.strokeStyle = "rgba(200, 160, 80, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < track.samples.length; i += 9) {
    const p = worldToMinimap(track.samples[i].point.x, track.samples[i].point.z);
    if (first) {
      ctx.moveTo(p.px, p.py);
      first = false;
    } else {
      ctx.lineTo(p.px, p.py);
    }
  }
  ctx.closePath();
  ctx.stroke();

  // Cavalli.
  state.horses.forEach((horse) => {
    const s = sampleAt(horse.progress);
    const p = worldToMinimap(s.point.x, s.point.z);
    if (horse.player) {
      ctx.beginPath();
      ctx.arc(p.px, p.py, 4.5, 0, TAU);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#d8a93a";
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, TAU);
      ctx.fillStyle = horse.colors[0];
      ctx.fill();
    }
  });
}

// ── SCHERMATA IMPOSTAZIONI ──────────────────────────────────────────────────
// Si apre dalla rotellina in basso a sinistra della home. Due sole scelte, ma
// pesanti: quale Palio si corre (che cambia cavalli e fantini) e quanto puo'
// durare la mossa. Si applicano subito e restano salvate sul dispositivo.
function openSettingsScreen() {
  if (document.getElementById("settingsOv")) return;
  const s = leggiImpostazioni();
  const ov = document.createElement("div");
  ov.id = "settingsOv";
  ov.style.cssText = "position:fixed;inset:0;z-index:9997;display:flex;align-items:center;justify-content:center;"
    + "background:rgba(9,6,3,.82);color:#f3e7cf;font-family:inherit;padding:22px;overflow:auto";
  const card = "background:rgba(255,246,225,.06);border:1px solid rgba(240,203,53,.28);border-radius:12px;padding:13px 15px;"
    + "cursor:pointer;text-align:left;font:inherit;color:#f3e7cf;width:100%;box-sizing:border-box;transition:border-color .15s";
  const attivo = "border-color:#f0cb35;background:rgba(240,203,53,.14)";
  const epoche = [
    { id: "storico", tit: "Palio storico", sub: "Fino ad Aceto \u2014 i barberi e i fantini dei Palii di quella generazione" },
    { id: "moderno", tit: "Palio moderno", sub: "Dal Duemila in poi \u2014 da Trecciolino ai giorni nostri" },
  ];
  ov.innerHTML =
    '<div style="width:min(520px,96vw);display:flex;flex-direction:column;gap:16px">'
    + '<div style="font-size:clamp(19px,4vw,26px);font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f0cb35;text-align:center">Impostazioni</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    +   '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Quale Palio si corre</div>'
    +   epoche.map((e) => '<button type="button" data-epoca="' + e.id + '" style="' + card + (s.epoca === e.id ? ";" + attivo : "") + '">'
          + '<b style="font-size:16px">' + e.tit + '</b><br><span style="font-size:13px;opacity:.75">' + e.sub + '</span></button>').join("")
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    +   '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Durata massima della mossa</div>'
    +   '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +   MOSSA_MINUTI_SCELTE.map((m) => '<button type="button" data-min="' + m + '" style="font:inherit;font-weight:700;padding:11px 0;border-radius:10px;'
          + 'border:1px solid rgba(240,203,53,.28);background:rgba(255,246,225,.06);color:#f3e7cf;cursor:pointer;flex:1;min-width:64px'
          + (s.mossaMinuti === m ? ";" + attivo : "") + '">' + m + ' min</button>').join("")
    +   '</div>'
    +   '<div style="font-size:12.5px;opacity:.7">Oltre questo tempo il mossiere dà il via comunque.</div>'
    + '</div>'
    + '<button type="button" id="settingsClose" style="font:inherit;font-size:16px;font-weight:800;padding:12px 30px;border-radius:10px;'
    +   'border:none;background:#f0cb35;color:#1a1206;cursor:pointer;align-self:center">Chiudi</button>'
    + '</div>';
  document.body.appendChild(ov);

  const applica = (nuove) => {
    salvaImpostazioni(nuove);
    applicaImpostazioni();
    ov.remove();
    openSettingsScreen();   // ridisegna con la scelta evidenziata
  };
  ov.querySelectorAll("[data-epoca]").forEach((b) => b.addEventListener("click", () => {
    applica({ ...leggiImpostazioni(), epoca: b.dataset.epoca });
  }));
  ov.querySelectorAll("[data-min]").forEach((b) => b.addEventListener("click", () => {
    applica({ ...leggiImpostazioni(), mossaMinuti: parseInt(b.dataset.min, 10) });
  }));
  ov.querySelector("#settingsClose").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
}

function openMenuScreen() {
  state.mode = "menu";
  stopAllAudio();      // tornando al menu si toglie l'audio (riparte alla prossima gara)
  resetCampaign();     // tornare al menu chiude un'eventuale campagna
  const cov = document.getElementById("campaignOverlay"); if (cov) cov.remove();
  showScreen("menu");
  setHudVisible(false);
  ensureDemoScene();   // ripristina i cavalli-demo dello sfondo (dopo una gara)
  setAllestimento("palio");     // uscendo dall'estrazione la Piazza torna allestita
  if (state.estrazioneCrowd) state.estrazioneCrowd.visible = false;
}

function openSelectScreen() {
  state.mode = "select";
  stopPalioSounds();   // via il canto della vincitrice: non deve restare acceso qui
  showScreen("select");
  setHudVisible(false);
  ensureDemoScene();   // ripristina i cavalli-demo dello sfondo (dopo una gara)
  setAllestimento("palio");     // uscendo dall'estrazione la Piazza torna allestita
  if (state.estrazioneCrowd) state.estrazioneCrowd.visible = false;
  // In setup campagna il tasto conferma diventa "Diventa Capitano".
  // ATTENZIONE: questa riga SOVRASCRIVE il testo scritto in index.html a ogni
  // ritorno sulla schermata. Se cambi la scritta del bottone, va cambiata QUI
  // (e nell'HTML per il primo render), altrimenti torna da sola quella vecchia.
  if (ui.startMossaButton) ui.startMossaButton.textContent = (state.campaign && state.campaign.setup) ? "Diventa Capitano" : "và... e torna vincitore";
  renderContradaAlbo();   // Albo dei Capitani della Contrada selezionata (solo in campagna)
}

function showMessage(text, seconds, tone = "") {
  state.messageText = text;
  state.messageTimer = seconds;
  ui.message.textContent = text;
  ui.message.classList.remove("danger", "good");
  if (tone) ui.message.classList.add(tone);
  ui.message.classList.add("visible");
}

function updateMessage(dt) {
  if (state.messageTimer <= 0) return;
  state.messageTimer -= dt;
  if (state.messageTimer <= 0) ui.message.classList.remove("visible");
}

// Scelta della voce del mossiere: una voce MASCHILE italiana, possente. Fra le
// voci italiane disponibili preferisce i nomi maschili noti (macOS "Luca", ecc.)
// ed evita quelli femminili; poi ripiega su qualunque voce italiana/maschile.
let __mossiereVoice = null;
function pickMossiereVoice() {
  const synth = window.speechSynthesis;
  if (!synth || !synth.getVoices) return null;
  const voices = synth.getVoices() || [];
  if (!voices.length) return null;
  const italian = voices.filter((v) => /^it/i.test(v.lang));
  const pool = italian.length ? italian : voices;
  // Sceglie la voce PIÙ NATURALE disponibile (niente più timbro robotico). Le voci
  // "novelty" di macOS (Rocko, Eddy, Grandpa…) suonano finte: penalizzate. Si
  // privilegiano le voci ad alta qualità (premium/enhanced/neural), Google (Chrome,
  // naturale), poi i nomi maschili naturali (Luca/Cosimo), poi Alice/Federica.
  const score = (v) => {
    const n = (v.name || "").toLowerCase();
    let s = 0;
    // Mossiere = voce MASCHILE: i nomi maschili naturali vincono su tutto
    // (Luca è la voce italiana maschile di macOS/Safari; le altre di Windows).
    if (/\bluca\b|cosimo|diego|paolo|roberto|giorgio|riccardo|adamo/.test(n)) s += 150; // maschili naturali (top)
    if (/premium|enhanced|potenziat|neural|natural/.test(n)) s += 100;  // alta qualità
    if (/google/.test(n)) s += 90;                                      // Chrome: voce naturale
    if (/grandpa|\breed\b|rocko/.test(n)) s += 55;                      // macOS: voci MASCHILI (banditore) → meglio di Alice per il mossiere
    if (/\balice\b|federica/.test(n)) s += 30;                          // femminili naturali (ripiego)
    if (/bad news|whisper|organ|bells|bubbles|jester|trinoids|zarvox|boing|wobble|cellos|superstar|good news|\beddy\b|\bflo\b|sandy|shelley|grandma/.test(n)) s -= 120; // voci-giocattolo/robotiche
    if (v.localService === false) s += 20;                              // voci di rete = più naturali
    return s;
  };
  return pool.slice().sort((a, b) => score(b) - score(a))[0];
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  __mossiereVoice = pickMossiereVoice();
  // Le voci arrivano in modo asincrono: aggiorna la scelta quando sono pronte.
  try { window.speechSynthesis.addEventListener("voiceschanged", () => { __mossiereVoice = pickMossiereVoice(); }); } catch (e) {}
}

// Voce del mossiere: pronuncia il nome della Contrada chiamata con una voce
// MASCHILE POSSENTE (timbro profondo, cadenza scandita, volume pieno).
// Silenziosa e senza errori se la sintesi vocale non è disponibile.
function speakContrada(name) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const voice = __mossiereVoice || (__mossiereVoice = pickMossiereVoice());
    const u = new SpeechSynthesisUtterance(name);
    u.lang = (voice && voice.lang) || "it-IT";
    u.rate = 0.9;    // scandita ma naturale
    // Pitch NATURALE (niente distorsione = niente timbro robotico). Solo se resta
    // una voce femminile di ripiego si abbassa un filo (0.82), non fino a distorcere.
    const female = voice && /(alice|federica|elsa|silvia|paola|chiara|female|femmin|donna)/i.test(voice.name || "");
    u.pitch = female ? 0.82 : 0.96;
    u.volume = 1;
    if (voice) u.voice = voice;
    synth.cancel();  // tronca l'eventuale chiamata precedente
    synth.speak(u);
  } catch (e) { /* sintesi vocale non disponibile: si prosegue in silenzio */ }
}

// Chiamata di una Contrada: scritta a schermo (una alla volta, in stampatello)
// + pronuncia vocale. Usata dal mossiere durante la mossa.
function announceCall(name, id) {
  showMessage(name.toUpperCase(), 2.4, "good");
  // La CHIAMATA ai canapi usa il canto/voce della Contrada (jingle dedicato); se
  // manca, ripiega sulla voce sintetica del mossiere.
  if (id) { try { playPalioSound(id + ".m4a", { volume: 0.72 }); } catch (e) { speakContrada(name); } }
  else speakContrada(name);
}

function createContradaGrid() {
  ui.contradaGrid.textContent = "";
  CONTRADE.forEach((contrada) => {
    const button = document.createElement("button");
    button.className = "contrada-card";
    button.type = "button";
    button.setAttribute("role", "option");
    button.dataset.id = contrada.id;
    button.style.setProperty("--c1", contrada.colors[0]);
    button.style.setProperty("--c2", contrada.colors[1]);
    button.style.setProperty("--c3", contrada.colors[2]);
    const flag = document.createElement("img");
    flag.className = "contrada-flag";
    flag.src = BANDIERE[contrada.id];
    flag.alt = contrada.name;
    flag.loading = "lazy";
    const name = document.createElement("strong");
    name.textContent = contrada.name;
    const motto = document.createElement("span");
    motto.textContent = contrada.motto;
    button.append(flag, name, motto);
    button.addEventListener("click", () => selectContrada(contrada));
    ui.contradaGrid.append(button);
  });
  selectContrada(CONTRADE[0]);
}

function selectContrada(contrada) {
  state.selectedContrada = contrada;
  ui.contradaGrid.querySelectorAll(".contrada-card").forEach((button) => {
    const selected = button.dataset.id === contrada.id;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  renderContradaAlbo();   // aggiorna l'Albo dei Capitani (solo in setup campagna)
}

// ── Albo dei Capitani: classifica per Contrada, persistita in localStorage ──
// A fine mandato salvo {capitano, vittorie, purghe}. Quando in setup campagna si
// sceglie una Contrada, mostro i suoi Capitani vittoriosi (più vittorie in alto,
// a parità meno purghe). È un albo d'oro locale, per invogliare a battere i record.
const ALBO_KEY = "palioAlboCapitani";
function loadAlbo() {
  try { return JSON.parse(localStorage.getItem(ALBO_KEY)) || {}; } catch (e) { return {}; }
}
function saveCampaignToAlbo(cmp) {
  if (!cmp || !cmp.contrada) return;
  let albo; try { albo = JSON.parse(localStorage.getItem(ALBO_KEY)) || {}; } catch (e) { albo = {}; }
  const id = cmp.contrada.id;
  const list = albo[id] || (albo[id] = []);
  list.push({ captain: (cmp.captain || "Capitano").slice(0, 24), wins: cmp.wins || 0, purghe: cmp.purghe || 0 });
  list.sort((a, b) => (b.wins - a.wins) || (a.purghe - b.purghe));
  albo[id] = list.slice(0, 20);   // tieni i migliori 20 per Contrada
  try { localStorage.setItem(ALBO_KEY, JSON.stringify(albo)); } catch (e) { /* storage pieno/disabilitato */ }
}
function renderContradaAlbo() {
  const grid = ui.contradaGrid; if (!grid) return;
  const host = grid.parentElement; if (!host) return;
  let box = document.getElementById("contradaAlbo");
  // Solo durante il SETUP della campagna (non nella paliata veloce).
  if (!(state.campaign && state.campaign.setup)) { if (box) box.style.display = "none"; return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "contradaAlbo";
    box.style.cssText = "margin:14px auto 2px;max-width:520px;background:rgba(18,13,8,.55);"
      + "border:1px solid rgba(240,203,53,.35);border-radius:12px;padding:12px 16px;text-align:left;"
      + "font-family:inherit;color:#f3e7cf";
    if (grid.nextSibling) host.insertBefore(box, grid.nextSibling); else host.appendChild(box);
  }
  box.style.display = "";
  const c = state.selectedContrada || CONTRADE[0];
  const winners = (loadAlbo()[c.id] || [])
    .filter((e) => (e.wins || 0) >= 1)
    .sort((a, b) => (b.wins - a.wins) || (a.purghe - b.purghe))
    .slice(0, 6);
  let html = '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f0cb35;'
    + 'margin-bottom:8px">Albo dei Capitani vittoriosi · ' + escapeHtml(c.name) + '</div>';
  if (!winners.length) {
    html += '<div style="font-size:13px;opacity:.72">Nessun capitano vittorioso, ancora. Sarai tu il primo a portare il Palio nella Contrada.</div>';
  } else {
    html += '<div style="display:grid;grid-template-columns:1.4em 1fr auto auto;gap:4px 12px;font-size:13.5px;align-items:center">'
      + '<div></div><div style="opacity:.6;font-size:11px;letter-spacing:.08em">CAPITANO</div>'
      + '<div style="opacity:.6;font-size:11px">VITT.</div><div style="opacity:.6;font-size:11px">PURGHE</div>';
    winners.forEach((e, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
      html += '<div style="text-align:center;opacity:.85">' + medal + '</div>'
        + '<div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(e.captain) + '</div>'
        + '<div style="text-align:center;color:#7fd98c;font-weight:800">' + (e.wins || 0) + '</div>'
        + '<div style="text-align:center;color:#e8896f;font-weight:700">' + (e.purghe || 0) + '</div>';
    });
    html += '</div>';
  }
  box.innerHTML = html;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ══ ALBO DELLE VITTORIE — vittorie per Contrada / Cavallo / Fantino ══════════
// Storico permanente (localStorage), aggiornato a OGNI palio vinto, sia in
// Campagna sia in Paliata veloce. Alimenta anche il bilanciamento vittorie.
const VICTORY_ALBO_KEY = "palioAlboVittorie";
const ALBO_API = "/api/albo";     // funzione serverless: albo GLOBALE condiviso da tutti
let globalAlbo = null;            // albo condiviso caricato dal server (null = non ancora)

function normalizeAlbo(a) {
  a = (a && typeof a === "object") ? a : {};
  a.contrada = a.contrada || {}; a.cavallo = a.cavallo || {}; a.fantino = a.fantino || {};
  a.totalePalii = Number(a.totalePalii) || 0;   // totale palii corsi da tutti (globale)
  return a;
}
// ── FRENI PROVVISORI GLOBALI (condivisi fra TUTTI i giocatori) ───────────────
// Ogni freno resta attivo finché il CONTATORE GLOBALE dei palii corsi (totalePalii,
// condiviso via server) non raggiunge la soglia di fine. Baseline = ~200 palii
// globali al momento dell'attivazione, + la durata richiesta. Non è per-dispositivo:
// tutti i giocatori vedono lo stesso stato perché leggono lo stesso contatore.
const FRENI_END = {
  tartucaOcaTorre: 240,   // 200 + 40: Tartuca/Oca/Torre solo brenne o boni  (scaduto)
  giraffa: 260,           // 200 + 60: Giraffa solo boni  (scaduto)
  tempestaFall: 210,      // 200 + 10: Tempesta cade a San Martino  (scaduto)
  gridoNervoso: 250,      // 200 + 50: il cavallo di Grido +50% nervoso  (scaduto)
  boniQuattro: 700,       // Tartuca/Lupa/Bruco/Selva solo boni, fino al palio 700
  istriceBomboloni: 700,  // Istrice solo bomboloni, fino al palio 700
  torreBrenna: 700,       // Torre solo brenne, fino al palio 700
  brioStamina: 704,       // se corre Brio, +10 stamina al 3° giro
  gridoFall: 700,         // Grido cade (a San Martino), fino al palio 700
  tartucaFall: 630,       // Tartuca guidata da AI cade a San Martino, fino al palio 630
  giraffaFall: 880,       // Giraffa guidata da AI cade al Casato, fino al palio 880
  istriceStamina: 720,    // Istrice guidata da AI: +10 stamina al 3° giro, fino al palio 720
  dragoSelvaFall: 1396,   // Drago e Selva guidate da AI: i cavalli cadono (San Martino), fino al palio 1396
  istriceNoFall: 1696,    // Istrice guidata da AI NON cade (immune), fino al palio 1696
};
function palliGlobali() {
  try { return Number((loadVictoryAlbo() || {}).totalePalii) || 0; } catch (e) { return 0; }
}
// FRENO SILENZIOSO su Bruco (AI): attivo per i PROSSIMI 1000 palii da quando parte
// questo codice. Baseline catturata al primo avvio (sul contatore globale dei palii).
function brucoFallActive() {
  const cur = palliGlobali();
  let base;
  try { base = parseInt(localStorage.getItem("palio.brucoFallBase") || "", 10); } catch (e) { base = NaN; }
  if (!Number.isFinite(base)) {
    base = cur;
    try { localStorage.setItem("palio.brucoFallBase", String(base)); } catch (e) { /* niente */ }
  }
  return cur >= base && cur < base + 1000;
}
// AI più CATTIVE verso il GIOCATORE che corre — le rivali lo nerbano/gli vengono
// addosso e MOLTE PIÙ contrade lo parano per non farlo vincere. Attivo FINO al
// palio 9000 (contatore globale); cur>0 così offline (contatore ignoto) non frena.
function aggroVsPlayerActive() {
  const cur = palliGlobali();
  return cur > 0 && cur < 9000;
}
// FINESTRA 40 palii: all'ISTRICE tocca un BOMBOLONE alla Tratta (richiesta utente).
function istriceBomboloneActive() {
  const cur = palliGlobali();
  let base;
  try { base = parseInt(localStorage.getItem("palio.istriceBombBase") || "", 10); } catch (e) { base = NaN; }
  if (!Number.isFinite(base)) {
    base = cur;
    try { localStorage.setItem("palio.istriceBombBase", String(base)); } catch (e) { /* niente */ }
  }
  return cur >= base && cur < base + 40;
}
// FINESTRA 1800 palii: i BOMBOLONI escono solo alle Contrade che hanno una rivale
// (Bruco, Drago, Giraffa, Selva non ne hanno → niente bombolone in questa finestra).
function bomboloneRivalsOnlyActive() {
  const cur = palliGlobali();
  let base;
  try { base = parseInt(localStorage.getItem("palio.bombRivalBase") || "", 10); } catch (e) { base = NaN; }
  if (!Number.isFinite(base)) {
    base = cur;
    try { localStorage.setItem("palio.bombRivalBase", String(base)); } catch (e) { /* niente */ }
  }
  return cur >= base && cur < base + 1800;
}
function frenoAttivo(key) {
  const end = FRENI_END[key];
  if (end == null) return false;
  const cur = palliGlobali();
  return cur > 0 && cur < end;   // cur>0: se il conteggio globale non è noto, non frenare
}
// Freno a FINESTRA globale [start, end): attivo solo mentre il contatore globale
// dei palii sta nell'intervallo. Usato per gli handicap "prima X, poi Y".
function frenoRange(start, end) {
  const cur = palliGlobali();
  return cur > 0 && cur >= start && cur < end;
}

// SHUFFLE BAG delle poste del giocatore: garantisce che in ogni blocco di 20 palii
// gli capitino TUTTE le n posizioni al canapo (ogni posizione ×2), in ordine casuale.
// Il sacchetto persiste in localStorage; quando si svuota si ricarica e rimescola.
function nextPlayerPost(n) {
  let bag = [];
  try { bag = JSON.parse(localStorage.getItem("palio.postBag") || "[]"); } catch (e) { bag = []; }
  const valido = Array.isArray(bag) && bag.length > 0
    && bag.every((p) => Number.isInteger(p) && p >= 0 && p < n);
  if (!valido) {
    bag = [];
    for (let k = 0; k < 2; k += 1) for (let p = 0; p < n; p += 1) bag.push(p);   // ogni posizione ×2
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  const post = bag.pop();
  try { localStorage.setItem("palio.postBag", JSON.stringify(bag)); } catch (e) { /* niente */ }
  return post;
}
// Registra UN palio corso nel totale GLOBALE (tutti i dispositivi). Chiamato una
// volta all'inizio di ogni palio. Aggiorna subito il locale, poi il server.
function recordPalioRun() {
  let a; try { a = JSON.parse(localStorage.getItem(VICTORY_ALBO_KEY)) || {}; } catch (e) { a = {}; }
  a = normalizeAlbo(a);
  a.totalePalii += 1;
  globalAlbo = a;
  try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(a)); } catch (e) { /* niente */ }
  // ── SOVVENZIONI ALLE CONTRADE (valgono in OGNI modalità, paliate veloci
  // comprese — earnBudgetAll scrive direttamente sul tesoro persistente):
  //  · ogni 2 palii giocati → +50 a tutte;
  //  · ogni 20 palii giocati → +800 a tutte (elargizione grande).
  try {
    let n2 = (parseInt(localStorage.getItem("palio.bonus2") || "0", 10) || 0) + 1;
    if (n2 >= 2) {
      n2 = 0;
      earnBudgetAll(50);
      if (typeof showMessage === "function") showMessage("Sovvenzione: +50 denari a tutte le contrade", 2.2, "good");
    }
    localStorage.setItem("palio.bonus2", String(n2));
    let n = (parseInt(localStorage.getItem("palio.bonus20") || "0", 10) || 0) + 1;
    if (n >= 20) {
      n = 0;
      earnBudgetAll(800);
      if (typeof showMessage === "function") showMessage("Elargizione della città: +800 denari a tutte le contrade", 2.8, "good");
    }
    localStorage.setItem("palio.bonus20", String(n));
  } catch (e) { /* niente */ }
  try {
    fetch(ALBO_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ palio: 1 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((srv) => {
        // Risposta SNELLA { ok, totalePalii }: aggiorna SOLO il totale dal server,
        // conservando contrada/cavallo/fantino locali (non riletti per risparmiare comandi).
        if (srv && srv.ok && typeof srv.totalePalii === "number") {
          globalAlbo = normalizeAlbo(globalAlbo || {});
          globalAlbo.totalePalii = srv.totalePalii;
          try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(globalAlbo)); } catch (e) { /* niente */ }
        }
      })
      .catch(() => { /* offline */ });
  } catch (e) { /* niente */ }
  // Contatore LOCALE dei palii corsi dal giocatore (per il popup feedback al 3°).
  try {
    if (getAccount()) {
      const n = (parseInt(localStorage.getItem("palio.playerRuns") || "0", 10) || 0) + 1;
      localStorage.setItem("palio.playerRuns", String(n));
    }
  } catch (e) { /* niente */ }
  // +1 al conteggio palii dell'ACCOUNT (per l'admin). BATCH: il conteggio LOCALE
  // sale subito di 1 (profilo sempre giusto), ma si INVIA al server solo ogni 5
  // palii — un HINCRBY con n=5 invece di 5 chiamate → 1/5 dei comandi. Se l'invio
  // fallisce (offline) il pending viene ripristinato e riparte al prossimo giro.
  try {
    const acc = getAccount();
    if (acc && acc.email) {
      acc.palii = (Number(acc.palii) || 0) + 1;
      setAccount(acc);
      let pend = (parseInt(localStorage.getItem("palio.acctPending") || "0", 10) || 0) + 1;
      localStorage.setItem("palio.acctPending", String(pend));
      if (pend >= 5) {
        const n = pend;
        localStorage.setItem("palio.acctPending", "0");
        fetch(ACCOUNT_API, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "palio", email: acc.email, n }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((srv) => {
            if (srv && srv.ok && typeof srv.palii === "number") { acc.palii = srv.palii; setAccount(acc); }
          })
          .catch(() => {   // offline: rimetti i palii nel pending, si riproveranno
            try { const cur = parseInt(localStorage.getItem("palio.acctPending") || "0", 10) || 0; localStorage.setItem("palio.acctPending", String(cur + n)); } catch (e) { /* niente */ }
          });
      }
    }
  } catch (e) { /* niente */ }
}
// Legge l'albo: se quello GLOBALE è stato caricato dal server lo usa (uguale per
// tutti i dispositivi); altrimenti ripiega sulla copia locale (offline / senza store).
function loadVictoryAlbo() {
  if (globalAlbo) return globalAlbo;
  try { const a = JSON.parse(localStorage.getItem(VICTORY_ALBO_KEY)); return (a && typeof a === "object") ? a : {}; } catch (e) { return {}; }
}
// Scarica l'albo GLOBALE dal server e lo rende la fonte di verità (mirror in
// localStorage come cache/fallback). Silenzioso se offline o store non configurato.
async function fetchGlobalAlbo(force) {
  // CACHE 45s per-device (anche fra reload): l'albo GET faceva 4 letture a OGNI
  // caricamento pagina; con i giocatori che rientrano in massa e i redeploy che
  // ricaricano tutti, era il grosso delle letture. Il contatore intanto sale già
  // in locale a ogni palio, quindi 45s di ritardo sul sync globale vanno benissimo.
  try {
    if (!force) {
      const ts = parseInt(localStorage.getItem("palio.alboTs") || "0", 10) || 0;
      if (Date.now() - ts < 45000) {
        const a = JSON.parse(localStorage.getItem(VICTORY_ALBO_KEY));
        if (a && typeof a === "object") { globalAlbo = normalizeAlbo(a); return globalAlbo; }
      }
    }
  } catch (e) { /* cache illeggibile: si legge dal server */ }
  try {
    const res = await fetch(ALBO_API, { cache: "no-store" });
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw || raw._nostore || raw._error) return null;   // store non pronto: resta sul locale
    const a = normalizeAlbo(raw);
    globalAlbo = a;
    try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(a)); localStorage.setItem("palio.alboTs", String(Date.now())); } catch (e) { /* niente */ }
    return a;
  } catch (e) { return null; }   // niente rete/API: si resta sul fallback locale
}
function recordVictoryToAlbo(winner) {
  if (!winner) return;
  // 1) Aggiornamento LOCALE immediato (feedback subito + fallback offline).
  let a; try { a = JSON.parse(localStorage.getItem(VICTORY_ALBO_KEY)) || {}; } catch (e) { a = {}; }
  a = normalizeAlbo(a);
  const nick = winner.jockey && winner.jockey.nick;
  if (winner.id) a.contrada[winner.id] = (a.contrada[winner.id] || 0) + 1;
  if (winner.horseName) a.cavallo[winner.horseName] = (a.cavallo[winner.horseName] || 0) + 1;
  if (nick) a.fantino[nick] = (a.fantino[nick] || 0) + 1;
  globalAlbo = a;
  try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(a)); } catch (e) { /* niente */ }
  // 2) Invio al server dell'albo GLOBALE: incrementi ATOMICI (HINCRBY), poi
  // sincronizza con la verità del server. Se offline, resta solo il locale.
  try {
    fetch(ALBO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrada: winner.id || null, cavallo: winner.horseName || null, fantino: nick || null }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((srv) => {
        // Risposta SNELLA { ok, contrada/cavallo/fantino: {id:nuovoTot} }: fondi SOLO
        // i campi incrementati, senza rileggere (né azzerare) il resto dell'albo.
        if (srv && srv.ok) {
          globalAlbo = normalizeAlbo(globalAlbo || {});
          ["contrada", "cavallo", "fantino"].forEach((cat) => {
            if (srv[cat]) Object.keys(srv[cat]).forEach((k) => { globalAlbo[cat][k] = srv[cat][k]; });
          });
          try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(globalAlbo)); } catch (e) { /* niente */ }
        }
      })
      .catch(() => { /* offline: pazienza */ });
  } catch (e) { /* niente */ }
}
// (Rimosso winBalanceByContrada: il freno/spinta di velocità in base alle vittorie
// non esiste più. L'unico svantaggio della più vittoriosa è la brenna garantita
// ogni 4 palii alla Tratta — vedi beginTratta. balanceMult resta = 1 per tutti.)

// Schermata "Albo delle Vittorie": tre classifiche (Contrade / Cavalli / Fantini)
// ordinate per numero di palii vinti. Aperta dal menu principale.
// ⚠️ Il backend a volte risponde VUOTO (un'istanza Redis vuota risponde a caso):
// una risposta vuota NON deve azzerare il dato buono. Riconosci il vuoto e ritenta.
function alboVuoto(srv) {
  if (!srv) return true;
  const totC = Object.values(srv.contrada || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  return (Number(srv.totalePalii) || 0) === 0 && totC === 0;
}
function fetchAlboGlobale(cb, tentativi) {
  const n = tentativi || 0;
  try {
    fetch(ALBO_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((srv) => {
        if (srv && !srv._error && !srv._nostore && !alboVuoto(srv)) {
          globalAlbo = normalizeAlbo(srv);
          try { localStorage.setItem(VICTORY_ALBO_KEY, JSON.stringify(globalAlbo)); } catch (e) { /* niente */ }
          if (cb) cb(globalAlbo);
        } else if (n < 2) { setTimeout(() => fetchAlboGlobale(cb, n + 1), 260); }   // risposta vuota: ritenta poche volte
      })
      .catch(() => { if (n < 2) setTimeout(() => fetchAlboGlobale(cb, n + 1), 260); });
  } catch (e) { /* niente */ }
}
function openAlboVittorie() {
  // Dalle 21:00 del 21 ago (fase DEMO): albo momentaneamente RIMOSSO per tutti,
  // Mario Rossi compreso. Nasconde anche il bottone del menu.
  if (typeof DEMO_CLOSE_AT !== "undefined" && Date.now() >= DEMO_CLOSE_AT) {
    const b = document.getElementById("alboButton"); if (b) b.style.display = "none";
    return;
  }
  renderAlboVittorie(loadVictoryAlbo());   // subito col dato LOCALE (istantaneo)
  fetchAlboGlobale((a) => { if (document.getElementById("alboOverlay")) renderAlboVittorie(a); });
}
function renderAlboVittorie(a) {
  const nameContrada = (id) => { const c = CONTRADE.find((x) => x.id === id); return c ? c.name : id; };
  const sections = [
    { title: "Contrade", icon: "🏳️", data: a.contrada || {}, label: nameContrada, all: true },
    { title: "Cavalli", icon: "🐎", data: a.cavallo || {}, label: (k) => k },
    { title: "Fantini", icon: "🏇", data: a.fantino || {}, label: (k) => k },
  ];
  const old = document.getElementById("alboOverlay"); if (old) old.remove();
  const ov = document.createElement("div"); ov.id = "alboOverlay";
  const panel = document.createElement("div"); panel.className = "albo-panel";
  const totale = Number(a.totalePalii) || 0;
  let html = '<div class="albo-title">Albo delle Vittorie</div>'
    + '<div class="albo-sub">Palii vinti — Campagna e Paliata veloce</div>'
    + '<div class="albo-sub" style="margin-top:-4px;opacity:.8">🏁 Palii corsi da tutti i giocatori: <b style="color:#f0cb35">'
    + totale.toLocaleString("it-IT") + '</b></div><div class="albo-cols">';
  sections.forEach((s) => {
    // Contrade: SEMPRE tutte e 17 (anche a 0 vittorie). Cavalli/Fantini: i primi 10.
    const rows = s.all
      ? CONTRADE.map((c) => ({ k: c.id, n: s.data[c.id] || 0 })).sort((x, y) => y.n - x.n)
      : Object.keys(s.data).map((k) => ({ k, n: s.data[k] })).sort((x, y) => y.n - x.n).slice(0, 10);
    html += '<div class="albo-col"><div class="albo-col-head">' + s.icon + " " + s.title + "</div>";
    if (!rows.length) html += '<div class="albo-empty">Ancora nessuna vittoria.</div>';
    else rows.forEach((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
      html += '<div class="albo-row"><span class="albo-rank">' + medal + "</span>"
        + '<span class="albo-name">' + escapeHtml(s.label(r.k)) + "</span>"
        + '<span class="albo-wins">' + r.n + "</span></div>";
    });
    html += "</div>";
  });
  html += '</div><button type="button" id="alboCloseBtn" class="btn btn-primary">Chiudi</button>';
  panel.innerHTML = html;
  ov.appendChild(panel);
  document.body.appendChild(ov);
  const close = document.getElementById("alboCloseBtn");
  close.addEventListener("click", () => ov.remove());
  try { close.focus(); } catch (e) { /* niente */ }
}

// Spinta laterale che il GIOCATORE sta esercitando ora: −1 (Q, sinistra),
// +1 (P, destra), 0 se non spinge. Serve a capire se sta andando addosso a qualcuno.
function controlsLateral() {
  const c = getControls();
  return (c.latRight ? 1 : 0) - (c.latLeft ? 1 : 0);
}
// Sterzata del giocatore: A = sinistra, L = destra. Girarsi CONTRO un vicino conta
// come pressione tanto quanto lo spostamento laterale.
function controlsTurn() {
  const c = getControls();
  return (c.right ? 1 : 0) - (c.left ? 1 : 0);
}

function getControls() {
  const g = state.gamepad || {};
  return {
    left: state.keys.has("KeyA") || state.touch.left || !!g.left,
    right: state.keys.has("KeyL") || state.touch.right || !!g.right,
    // Spostamento LATERALE dentro i canapi: Q = SINISTRA, P = DESTRA (si spinge
    // sui cavalli accanto senza girarsi). Sul pad: levetta destra. Su telefono:
    // le freccette in basso a destra.
    latLeft: state.keys.has("KeyQ") || !!g.latLeft || !!state.touch.latLeft,
    latRight: state.keys.has("KeyP") || !!g.latRight || !!state.touch.latRight
  };
}

// ── Controller PlayStation (Gamepad API) ────────────────────────────────────
// Sterzo: levetta SINISTRA (asse 0). X (croce) = marcia su, O (cerchio) = giù.
function pollGamepad() {
  if (!state.gamepad) state.gamepad = { left: false, right: false, prevX: false, prevO: false };
  const g = state.gamepad;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) { if (p && p.connected) { gp = p; break; } }
  if (!gp) { g.left = false; g.right = false; g.latLeft = false; g.latRight = false; g.prevX = false; g.prevO = false; g.prevR1 = false; g.prevL1 = false; g.prevNavPrev = false; g.prevNavNext = false; return; }
  const dead = 0.30;
  const ax = gp.axes[0] || 0;    // levetta SINISTRA orizzontale
  const ay = gp.axes[1] || 0;    // levetta SINISTRA verticale
  const ax2 = gp.axes[2] || 0;   // levetta DESTRA orizzontale
  const inRace = isRaceMode();
  if (inRace) {
    // In gara/mossa: levetta SX gira il cavallo, levetta DX si sposta di lato.
    g.left = ax < -dead;
    g.right = ax > dead;
    g.latLeft = ax2 < -dead;
    g.latRight = ax2 > dead;
    g.prevNavPrev = false; g.prevNavNext = false;
  } else {
    // Nei menu: niente sterzo; la levetta SX (o il D-pad) scorre i pulsanti.
    g.left = g.right = g.latLeft = g.latRight = false;
    const dU = !!(gp.buttons[12] && gp.buttons[12].pressed);
    const dD = !!(gp.buttons[13] && gp.buttons[13].pressed);
    const dL = !!(gp.buttons[14] && gp.buttons[14].pressed);
    const dR = !!(gp.buttons[15] && gp.buttons[15].pressed);
    const navPrev = ax < -0.5 || ay < -0.5 || dL || dU;
    const navNext = ax > 0.5 || ay > 0.5 || dR || dD;
    if (navPrev && !g.prevNavPrev) uiMoveFocus(-1);
    if (navNext && !g.prevNavNext) uiMoveFocus(1);
    g.prevNavPrev = navPrev; g.prevNavNext = navNext;
  }
  // X = buttons[0], O = buttons[1] (mapping "standard"). Fronte di salita:
  // un solo scatto per pressione, come la tastiera.
  const xNow = !!(gp.buttons[0] && gp.buttons[0].pressed);
  const oNow = !!(gp.buttons[1] && gp.buttons[1].pressed);
  if (xNow && !g.prevX) {
    ensureAudio(); if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    if (inRace) adjustPlayerSpeed(1);   // in gara: X = marcia su
    else uiActivate();                   // nei menu: X = INVIO (conferma/avanti)
  }
  if (oNow && !g.prevO) {
    ensureAudio(); if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    if (inRace) adjustPlayerSpeed(-1);   // in gara: O = marcia giù
  }
  // R1 / L1 (dorsali, buttons[5] e [4]) = NERBATA a destra / a sinistra, come K e S
  // sulla tastiera. Fronte di salita: un colpo per pressione.
  const r1Now = !!(gp.buttons[5] && gp.buttons[5].pressed);
  const l1Now = !!(gp.buttons[4] && gp.buttons[4].pressed);
  if ((r1Now && !g.prevR1) || (l1Now && !g.prevL1)) {
    ensureAudio(); if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    if (inRace) {
      const pl = getPlayer();
      if (pl) tiraNerbata(pl, (r1Now && !g.prevR1) ? 1 : -1, state.mode === "mossa" ? "mossa" : "race");
    }
  }
  // D-PAD durante la MOSSA: offerte rapide all'asta della rincorsa, senza mouse.
  //   ←  prima offerta (la più bassa)   ↑  offerta centrale   →  terza (la più alta)
  if (state.mode === "mossa") {
    const dpL = !!(gp.buttons[14] && gp.buttons[14].pressed);
    const dpU = !!(gp.buttons[12] && gp.buttons[12].pressed);
    const dpR = !!(gp.buttons[15] && gp.buttons[15].pressed);
    const bids = [...document.querySelectorAll(".astaBidBtn")];
    if (bids.length) {
      if (dpL && !g.prevDpL && bids[0]) bids[0].click();
      if (dpU && !g.prevDpU && bids[1]) bids[1].click();
      if (dpR && !g.prevDpR && bids[2]) bids[2].click();
    }
    g.prevDpL = dpL; g.prevDpU = dpU; g.prevDpR = dpR;
  } else { g.prevDpL = false; g.prevDpU = false; g.prevDpR = false; }
  g.prevR1 = r1Now;
  g.prevL1 = l1Now;
  g.prevX = xNow;
  g.prevO = oNow;
}

function cycleCameraMode() {
  // TUTTE le inquadrature, sempre: la tua sul cavallo per prima, poi le due da
  // regia (le stesse del replay), poi le altre. Prima laterale e aerea si vedevano
  // solo cadendo.
  const order = ["follow", "laterale", "aerea", "top3", "overhead", "firstperson"];
  const idx = order.indexOf(state.cameraMode);
  state.cameraMode = order[(idx + 1) % order.length];
  const nomi = {
    follow: "Il tuo cavallo",
    laterale: "Laterale, di profilo",
    aerea: "Aerea su San Martino",
    top3: "Sui primi 3 dall'alto",
    overhead: "Tutta la Piazza",
    firstperson: "Prima persona",
  };
  showMessage(`Camera: ${nomi[state.cameraMode] || ""}`, 0.9);
}

// Camera "sui primi 3 dall'alto": insegue RAVVICINATO le prime tre Contrade da
// una quota alta, guardando in basso. Usata sia in gara sia nel replay (tasto C).
// L'altezza si adatta a quanto sono sparse, così restano tutte e tre in quadro.
function computeTop3Camera(dt) {
  const ranked = state.horses
    .filter((h) => !h.isRincorsa)
    .slice()
    .sort((a, b) => (b.progress || 0) - (a.progress || 0));
  const top = ranked.slice(0, 3);
  if (!top.length || !top[0].group) return false;
  const centroid = new THREE.Vector3();
  top.forEach((h) => centroid.add(h.group.position));
  centroid.multiplyScalar(1 / top.length);
  let spread = 0;
  for (let i = 0; i < top.length; i += 1) {
    for (let j = i + 1; j < top.length; j += 1) {
      spread = Math.max(spread, top[i].group.position.distanceTo(top[j].group.position));
    }
  }
  const s = sampleAt(top[0].progress);
  const fwd = s.tangent.clone().normalize();
  const height = clamp(13 + spread * 0.55, 13, 34);
  const back = clamp(5.5 + spread * 0.12, 5.5, 11);
  const camPos = centroid.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, height, 0));
  const look = centroid.clone().add(new THREE.Vector3(0, 0.8, 0));
  const k = clamp(dt * 4.2, 0, 1);
  state.cameraPosition.lerp(camPos, k);
  state.cameraLook.lerp(look, k);
  camera.position.copy(state.cameraPosition);
  camera.lookAt(state.cameraLook);
  state.cameraFov += (52 - state.cameraFov) * clamp(dt * 4, 0, 1);
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
  return true;
}

// ══ NAVIGAZIONE UI UNIFICATA (INVIO da tastiera · levetta sx + X da gamepad) ══
// Un solo modello per "andare avanti / saltare / confermare" e per spostarsi tra
// i pulsanti dei menu, valido in ogni fase (menu, chooser, estrazione, tratta,
// scelta fantino, campagna, risultati). Usa il fuoco nativo del browser come
// evidenziazione (vedi :focus-visible in style.css).
function isRaceMode() { return state.mode === "race" || state.mode === "mossa"; }
function uiIsTyping(event) {
  // event.target = da dove parte il tasto (sopravvive anche se il campo viene
  // rimosso dal DOM durante il gestore, es. INVIO sul nome → cambia schermata):
  // così l'INVIO non "rimbalza" su window causando un doppio avanzamento.
  const el = (event && event.target) || document.activeElement;
  return !!(el && el.tagName && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}
// Visibile a schermo? getClientRects funziona anche con position:fixed (dove
// offsetParent è null): 0 rettangoli = display:none o fuori dal render.
function uiOnScreen(el) { return !!(el && el.getClientRects().length > 0); }
function uiShown(el) { return uiOnScreen(el) && !el.disabled; }
// Il "layer" UI in cima (dal più sopra verso il basso), dove cercare i pulsanti.
function activeUILayer() {
  const ids = ["gameTips", "finalitaScreen", "pwGate", "alboOverlay", "hvOverlay", "campaignOverlay", "palioChooser", "sfOverlay", "trattaHud", "estrHud"];
  for (const id of ids) { const el = document.getElementById(id); if (uiOnScreen(el)) return el; }
  const scr = document.querySelector(".screen.active");
  if (uiOnScreen(scr)) return scr;
  return null;
}
// I pulsanti selezionabili col gamepad/frecce nel layer in cima, in ordine.
function uiFocusables() {
  const layer = activeUILayer();
  if (!layer) return [];
  return [...layer.querySelectorAll("button, .contrada-card, .pc-card, .sf-card, .hv-card, input[type='checkbox'], [role='option']")]
    .filter((b) => uiOnScreen(b) && !b.disabled);
}
// Il pulsante "avanti/salta/conferma" del layer in cima.
function uiPrimaryButton() {
  for (const id of ["estrGoBtn", "estrSkipBtn", "trattaGoBtn", "trattaSkipBtn", "sfGoBtn", "sfConfirmBtn", "hvConfirmBtn", "alboCloseBtn", "spectateSkipBtn"]) {
    const el = document.getElementById(id); if (uiShown(el)) return el;
  }
  const layer = activeUILayer();
  if (!layer) return null;
  if (layer.id === "pwGate") return document.getElementById("pwBtn");
  const cmp = [...layer.querySelectorAll(".cmp-btn")].filter(uiShown);
  if (cmp.length) return cmp[cmp.length - 1];   // l'ultimo = avanti/conferma/continua
  const cont = document.getElementById("campaignContinueBtn"); if (uiShown(cont)) return cont;
  const prim = layer.querySelector(".btn-primary"); if (uiShown(prim)) return prim;
  const anyBtn = layer.querySelector("button"); return uiShown(anyBtn) ? anyBtn : null;
}
// INVIO / X: attiva il pulsante a fuoco, oppure il primario del layer.
function uiActivate() {
  const af = document.activeElement;
  const attivabile = af && uiShown(af) && uiFocusables().includes(af)
    && (af.tagName === "BUTTON" || (af.tagName === "INPUT" && af.type === "checkbox"));
  if (attivabile) { af.click(); return; }
  const primary = uiPrimaryButton();
  if (primary) primary.click();
}
// Sposta il fuoco tra i pulsanti del layer (levetta sx / frecce): un passo.
function uiMoveFocus(dir) {
  const list = uiFocusables();
  if (!list.length) return;
  let idx = list.indexOf(document.activeElement);
  if (idx < 0) idx = dir > 0 ? -1 : 0;
  idx = (idx + dir + list.length) % list.length;
  const next = list[idx];
  try { next.focus(); } catch (e) { /* niente */ }
  markUiFocus(next);   // evidenziazione ESPLICITA (col gamepad :focus-visible non scatta)
  try { next.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* niente */ }
}
// Illumina l'elemento selezionato con la levetta/frecce. Il browser applica
// :focus-visible solo quando riconosce la navigazione da tastiera: col controller
// il fuoco è programmatico e resterebbe invisibile. Qui lo marchiamo a mano.
function markUiFocus(el) {
  document.querySelectorAll(".ui-focus").forEach((o) => { if (o !== el) o.classList.remove("ui-focus"); });
  if (el && el.classList) el.classList.add("ui-focus");
}
// Appena si torna al mouse/dito, l'evidenziazione da levetta si spegne.
window.addEventListener("mousedown", () => {
  document.querySelectorAll(".ui-focus").forEach((o) => o.classList.remove("ui-focus"));
});

// "Torna al menu principale": zittisce musica/voce e riporta all'inizio, da
// qualunque fase. Rimuove gli overlay di fase che openMenuScreen non tocca.
function returnToMainMenu() {
  if (state.scelta) {
    try { if (state.scelta.countdown) clearInterval(state.scelta.countdown); } catch (e) { /* niente */ }
    (state.scelta.aiTimers || []).forEach((t) => { try { clearTimeout(t); } catch (e) { /* niente */ } });
    state.scelta = null;
  }
  ["palioChooser", "sfOverlay", "estrHud", "trattaHud", "hvOverlay", "alboOverlay"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
  const albo = document.getElementById("contradaAlbo"); if (albo) albo.style.display = "none";
  openMenuScreen();   // fa già: stopAllAudio (musica+voce) + resetCampaign + schermata menu + demo
}

// Bottone "‹ Menu" fisso in alto a sinistra: presente in ogni fase tranne il
// menu stesso; sopra gli HUD di fase ma sotto la password.
function ensureMenuHomeBtn() {
  let b = document.getElementById("menuHomeBtn");
  if (b) return b;
  b = document.createElement("button");
  b.id = "menuHomeBtn"; b.type = "button"; b.textContent = "‹ Menu";
  b.setAttribute("aria-label", "Torna al menu principale");
  b.addEventListener("click", returnToMainMenu);
  document.body.appendChild(b);
  return b;
}
function refreshMenuHomeBtn() {
  const b = ensureMenuHomeBtn();
  b.style.display = (state.mode && state.mode !== "menu") ? "" : "none";
}

// "Salta all'avvio" — appare SOLO quando ASSISTI al palio della rivale (mossa in
// autopilot): schiera le Contrade al canapo, la rincorsa fianca e la corsa PARTE
// subito, così non devi guardare tutta la mossa.
function spectateSkipToStart() {
  if (state.mode !== "mossa") return;
  const rincorsa = state.horses.find((h) => h.isRincorsa);
  const runners = state.horses.filter((h) => !h.isRincorsa).sort((a, b) => (a.postIndex ?? 0) - (b.postIndex ?? 0));
  const spread = Math.max(1, TRACK_HALF_WIDTH - 1.2);
  runners.forEach((h, i) => {
    h.mossaProgress = MOSSA_FRONT_LIMIT;                       // schierate al canapo
    h.progress = MOSSA_FRONT_LIMIT;
    const t = runners.length > 1 ? i / (runners.length - 1) : 0.5;
    h.lane = -spread + 2 * spread * t;                         // dal palo interno all'esterno
    h.mossaLane = h.lane;
    h.mossaTurn = 0;                                           // dritte verso la pista
    h.called = true; h.entering = false;
  });
  if (rincorsa) {
    // NON si sposta di forza chi sta gia' arrivando: qui la rincorsa veniva
    // teletrasportata al canapo e buttata in mezzo alla pista (lane 0) proprio nell'istante del via, e per il
    // giocatore era uno scatto in piena corsa. Adesso si porta avanti solo chi e'
    // rimasto indietro, e la linea che si e' scelto non gliela tocca nessuno.
    rincorsa.progress = Math.max(rincorsa.progress, MOSSA_BACK_LIMIT + 0.15);
    rincorsa.prevProgress = rincorsa.progress - 0.01;
  }
  releaseRace();
  showMessage("Ha fiancato, la mossa è valida!", 1.8, "good");   // dopo il Via, così resta a schermo il messaggio giusto
}
function ensureSpectateSkipBtn() {
  let b = document.getElementById("spectateSkipBtn");
  if (b) return b;
  b = document.createElement("button");
  b.id = "spectateSkipBtn"; b.type = "button"; b.textContent = "Salta all'avvio ▶";
  b.setAttribute("aria-label", "Salta la mossa e vai alla partenza");
  b.addEventListener("click", spectateSkipToStart);
  document.body.appendChild(b);
  return b;
}
function refreshSpectateSkipBtn() {
  const b = ensureSpectateSkipBtn();
  const cmp = state.campaign;
  const show = state.mode === "mossa" && cmp && cmp.active && cmp.currentMode === "spectate";
  b.style.display = show ? "" : "none";
}

// Joystick analogico (telefono): orizzontale = gira il cavallo (come A/L),
// verticale = andatura (su accelera, giù rallenta, uno scatto per spinta).
function bindTouchStick() {
  const stick = document.getElementById("touchStick");
  const knob = document.getElementById("touchStickKnob");
  if (!stick || !knob) return;
  let active = false, pid = null, cx = 0, cy = 0, R = 48, lastThrottle = 0;
  const reset = () => {
    active = false; pid = null; lastThrottle = 0;
    state.touch.left = false; state.touch.right = false;
    knob.style.transform = "translate(-50%,-50%)";
  };
  const move = (e) => {
    if (!active || (pid !== null && e.pointerId !== pid)) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > R) { dx = dx / dist * R; dy = dy / dist * R; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / R, ny = dy / R;
    const deadX = 0.30;
    state.touch.left = nx < -deadX;    // sterzo sx/dx (on/off, come tastiera)
    state.touch.right = nx > deadX;
    const thr = 0.55;                  // andatura: su accelera, giù rallenta
    if (ny < -thr && lastThrottle !== -1) { adjustPlayerSpeed(1); lastThrottle = -1; }
    else if (ny > thr && lastThrottle !== 1) { adjustPlayerSpeed(-1); lastThrottle = 1; }
    else if (Math.abs(ny) < thr * 0.5) { lastThrottle = 0; }   // riarma vicino al centro
  };
  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    active = true; pid = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2;
    try { stick.setPointerCapture(e.pointerId); } catch (err) { /* niente */ }
    ensureAudio(); if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    move(e);
  });
  stick.addEventListener("pointermove", move);
  const up = (e) => { if (pid !== null && e.pointerId !== pid) return; reset(); };
  stick.addEventListener("pointerup", up);
  stick.addEventListener("pointercancel", up);
  reset();
}

// ── DISPOSITIVO TOUCH (telefono + iPad, anche se iPadOS si spaccia per Mac) ────
const IS_TOUCH_DEVICE = (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)
  && (navigator.maxTouchPoints || 0) > 0;

// ── STERZO A INCLINAZIONE (come i giochi di macchine) ─────────────────────────
// Si guida inclinando il telefono a destra/sinistra. Leggiamo la GRAVITÀ dal
// sensore di movimento e la proiettiamo sull'asse ORIZZONTALE dello schermo
// (indipendente da come è tenuto il telefono), così l'inclinazione = sterzo.
let tiltEnabled = false;
const TILT_SPAN = 4.2;   // m/s² per fondo-corsa (~25° di inclinazione = sterzata piena)
const TILT_SIGN = 1;     // se lo sterzo risultasse invertito: mettere -1
function startTiltSteering() {
  if (tiltEnabled) return;
  tiltEnabled = true;
  window.addEventListener("devicemotion", (e) => {
    const g = e.accelerationIncludingGravity;
    if (!g) return;
    const ang = (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle : (window.orientation || 0);
    let sx;                                  // gravità lungo l'orizzontale DELLO SCHERMO
    if (ang === 90) sx = g.y;
    else if (ang === 270 || ang === -90) sx = -g.y;
    else if (ang === 180) sx = -g.x;
    else sx = g.x;                           // 0 / portrait
    const driving = state.mode === "race" || state.mode === "mossa";
    if (!driving) { state.touch.left = false; state.touch.right = false; return; }
    const n = clamp((sx / TILT_SPAN) * TILT_SIGN, -1, 1);
    const dead = 0.22;
    state.touch.left = n < -dead;
    state.touch.right = n > dead;
    state.tiltSteer = n;
  });
}
// iOS 13+ richiede il permesso ai sensori, e solo dopo un gesto dell'utente.
function requestTiltPermission() {
  try {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === "function") {
      DME.requestPermission().then((s) => { if (s === "granted") startTiltSteering(); }).catch(() => { /* niente */ });
    } else { startTiltSteering(); }
  } catch (e) { /* niente */ }
}

// --- Mappa intensità interna (1..10) -> velocità nel mondo (u/sec) -------
// Usata dai cavalli AI e dall'animazione del galoppo. Lineare:
//   travel = SPEED_BASE + intensità * SPEED_SLOPE
//   SPEED_BASE = 8.25, SPEED_SLOPE = 0.875  =>  f(2)=10, f(10)=17
const SPEED_BASE = 8.25;
const SPEED_SLOPE = 0.875;
function speedToTravel(speedLevel) {
  return SPEED_BASE + speedLevel * SPEED_SLOPE;
}

// --- Velocità di crociera (u/sec) di ciascuna andatura del giocatore (1..5) --
// Sorgente di verità per il MOVIMENTO del giocatore: l'andatura sceglie
// direttamente la velocità. L'intensità interna (andatura*2) resta usata solo
// per l'animazione, così alle andature alte il galoppo resta pieno. Il passaggio
// da un'andatura all'altra è morbido: la velocità sfuma, senza scatti.
//   1 -> 10 · 2 -> 11 · 3 -> 12.2 · 4 -> 13.5 · 5 -> 15
const ANDATURA_SPEED = [0, 10, 11, 12.2, 13.5, 15];
function andaturaToSpeed(andatura) {
  const a = clamp(Math.round(andatura), PLAYER_SPEED_MIN, ANDATURA_MAX);
  return ANDATURA_SPEED[a];
}

// Andatura massima consentita (1..5) in base alla stamina residua.
function getMaxAllowedSpeedByStamina(stamina, staminaMax = STAMINA_MIN_ROLL) {
  const ratio = stamina / Math.max(1, staminaMax);
  if (ratio <= 0.1) return 2;
  if (ratio <= 0.25) return 3;
  if (ratio <= 0.5) return 4;
  return 5;
}

// Andatura effettiva del giocatore (1..5): quella scelta, eventualmente ridotta
// dalla stamina.
function getPlayerEffectiveSpeed(player) {
  const chosenAndatura = firstLapCapAndatura(player, clamp(Math.round(player.speedSetting || 1), PLAYER_SPEED_MIN, ANDATURA_MAX));
  return getEffectiveSpeedByStamina(chosenAndatura, player.stamina, player.staminaMax);
}

function getEffectiveSpeedByStamina(chosenSpeed, stamina, staminaMax) {
  const maxAllowedSpeed = getMaxAllowedSpeedByStamina(stamina, staminaMax);
  return Math.min(chosenSpeed, maxAllowedSpeed);
}

// PRIMO GIRO DI PIAZZA: al 1° giro l'andatura è contenuta — tutti max 4, tranne le
// due AI segnate con firstLapCap=3. Dal 2° giro in poi si torna liberi (3-4-5).
function firstLapCapAndatura(horse, andatura) {
  if (state.mode === "race" && Math.floor(Math.max(0, horse.progress) / track.length) === 0) {
    return Math.min(andatura, horse.firstLapCap || 4);
  }
  return andatura;
}

function getStaminaRateForHorse(horse, demandSpeed) {
  let baseRate = STAMINA_DRAIN_BY_SPEED[demandSpeed] || 0;

  // ── DEFICIT DEL GIOCATORE ──────────────────────────────────────────────────
  // Un umano guida meglio dell'AI e la corsa gli riesce troppo facile. Piccolo
  // handicap DICHIARATO (non un vantaggio nascosto: le regole restano simmetriche,
  // questa è una zavorra voluta): SOLO al 2° giro, se tieni andatura 4 o 5, la
  // stamina cala del 5% in più. Al 3° giro NON si applica. Solo il giocatore,
  // solo consumo (baseRate>0). Indice giro: 0=primo, 1=secondo, 2=terzo.
  if (isHuman(horse) && baseRate > 0 && demandSpeed >= 4 && state.mode === "race"
      && Math.floor(Math.max(0, horse.progress) / track.length) === 1) {
    baseRate *= 1.05;
  }

  const leaderPressure =
    state.mode === "race" && state.currentLeader === horse
      ? LEADER_STAMINA_EXTRA_DRAIN
      : 0;

  // (Malus di stamina dell'ULTIMA contrada RIMOSSO: l'ultimo non va zavorrato
  // ancora di più — al recupero ci pensa l'accelerazione del rubber-band.)
  return baseRate + leaderPressure;
}

function adjustPlayerSpeed(delta) {
  const player = getPlayer();
  if (!player || player.finishTime || (state.mode !== "mossa" && state.mode !== "race")) return;
  const current = clamp(Math.round(player.speedSetting || 1), PLAYER_SPEED_MIN, ANDATURA_MAX);
  const next = clamp(current + delta, PLAYER_SPEED_MIN, ANDATURA_MAX);
  if (next === current) return;
  player.speedSetting = next;
  player.targetSpeedLevel = getPlayerEffectiveSpeed(player) * 2;
  // Cambio di andatura morbido: nessuno scatto di velocità, niente colpo di
  // nerbo o di camera. La velocità sfuma verso la nuova andatura in updatePlayer.
  showMessage(`Andatura ${next}/5`, 0.42, delta > 0 ? "good" : "");
}

// ══ L'ESTRAZIONE DELLE CONTRADE — completa le 10 partecipanti (prima della ══
// ══ Tratta). Rappresentata come RITO PUBBLICO DELLE BANDIERE: l'urna sta   ══
// ══ dentro Palazzo Comunale (non si vede); la Piazza capisce il risultato   ══
// ══ dagli squilli dei Trombetti e dalle bandiere esposte alle finestre.     ══
//
// Palio ORDINARIO (2 luglio / 16 agosto, art. 4 del Regolamento): corrono di
// diritto le 7 Contrade che NON hanno corso il Palio corrispondente dell'anno
// precedente (bandiere esposte al primo piano fin dal mattino); le altre 3 si
// sorteggiano fra le 10 che l'avevano corso. Palio STRAORDINARIO: tutte e 10
// sorteggiate direttamente. Le non partecipanti vanno al secondo piano, in
// ordine di estrazione.
const PALIO_TYPES = {
  luglio: { id: "luglio", label: "Palio di Provenzano", data: "2 luglio", nota: "7 di diritto + 3 sorteggiate" },
  agosto: { id: "agosto", label: "Palio dell'Assunta", data: "16 agosto", nota: "7 di diritto + 3 sorteggiate" },
  straordinario: { id: "straordinario", label: "Palio Straordinario", data: "", nota: "10 sorteggiate direttamente" },
};

// Composizione del campo. La Contrada del GIOCATORE corre sempre (è un gioco):
// negli ordinari entra fra le 7 di diritto (più probabile) o fra le 3 estratte;
// nello straordinario è garantita fra le 10 sorteggiate.
function computeEstrazione(tipoId) {
  const player = state.selectedContrada || CONTRADE[0];
  const others = shuffleInPlace(CONTRADE.filter((c) => c.id !== player.id)); // 16
  let diritto = [], drawn = [], rest = [];
  if (tipoId === "straordinario") {
    drawn = shuffleInPlace([player, ...others.slice(0, 9)]);   // 10 estratte, ordine casuale
    rest = others.slice(9);                                     // 7 non partecipanti
  } else if (Math.random() < 0.7) {
    diritto = shuffleInPlace([player, ...others.slice(0, 6)]); // giocatore di diritto
    const urn = shuffleInPlace(others.slice(6));                // le 10 che corsero, RIMESCOLATE a ogni estrazione
    drawn = urn.slice(0, 3);                                    // 3 estratte, ordine di uscita sempre nuovo
    rest = urn.slice(3);
  } else {
    diritto = others.slice(0, 7);                               // giocatore NON di diritto…
    const urnOthers = others.slice(7);
    drawn = shuffleInPlace([player, ...urnOthers.slice(0, 2)]); // …ma estratto a sorte
    rest = urnOthers.slice(2);
  }
  return {
    tipo: PALIO_TYPES[tipoId] || PALIO_TYPES.luglio,
    diritto, drawn,
    participants: [...diritto, ...drawn],                       // le 10 che corrono
    nonRunners: shuffleInPlace([...rest]),                      // secondo piano, in ordine di estrazione
  };
}

// Squilli dei Trombetti di Palazzo (sintesi: tromba = dente di sega filtrato).
function playTrombetti(kind = "fanfare") {
  const ctx = state.audio.ctx;
  if (!ctx) return;
  const note = (freq, t0, dur, gain = 0.055) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, ctx.currentTime + t0);
    f.type = "lowpass"; f.frequency.value = 2400; f.Q.value = 1.1;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + t0 + 0.03);
    g.gain.setValueAtTime(gain, ctx.currentTime + t0 + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + t0);
    o.stop(ctx.currentTime + t0 + dur + 0.05);
  };
  if (kind === "squillo") { note(784, 0, 0.15); note(784, 0.19, 0.38); return; }
  if (kind === "chiarine") {
    // CHIARINE: doppia frase cerimoniale (~4.2s). L'estrazione comincia solo
    // quando hanno smesso di suonare.
    note(523, 0, 0.22); note(659, 0.26, 0.22); note(784, 0.52, 0.22); note(1046, 0.78, 0.6, 0.062);
    note(784, 1.7, 0.2); note(659, 1.94, 0.2); note(784, 2.18, 0.2); note(1046, 2.44, 0.5, 0.062);
    note(1046, 3.1, 0.28, 0.05); note(784, 3.42, 0.7, 0.055);
    return;
  }
  // Fanfara d'apertura/chiusura (do-mi-sol-do acuto).
  note(523, 0, 0.16); note(659, 0.18, 0.16); note(784, 0.36, 0.16); note(1046, 0.56, 0.55, 0.062);
}

// Posizione del Palazzo Comunale: al CENTRO DEL RETTILINEO in cui si corre il
// palio (come nella realtà), sul lato esterno. Lì avvengono l'estrazione delle
// Contrade (dalle trifore) e — proprio lì sotto — la Tratta.
const ESTR_SLOT1_Y = 7.0;    // finestre primo piano (partecipanti)
const ESTR_SLOT2_Y = 11.0;   // finestre secondo piano (non partecipanti)

// Facciata del Palazzo Comunale con Torre: costruita una volta e riusata.
// 10 finestre al primo piano (chi corre) e 7 al secondo (chi non corre).
function ensurePalazzoObjects() {
  if (state.palazzo) return state.palazzo;
  // PALAZZO PUBBLICO di Siena — versione più fedele al monumento vero: arcata di
  // pietra al pianterreno, due piani di TRIFORE (bifore/trifore gotiche col telaio
  // in travertino), coronamento a MERLI GUELFI, e la TORRE DEL MANGIA a sinistra col
  // coronamento a beccatelli, la cella campanaria bianca e il finale. Solo grafica.
  const brick = new THREE.MeshStandardMaterial({ color: 0x9a6647, roughness: 0.9 });   // cotto senese
  const brickDark = new THREE.MeshStandardMaterial({ color: 0x7c4e37, roughness: 0.92 });
  const darkWin = new THREE.MeshStandardMaterial({ color: 0x4a3a29, roughness: 0.85 });   // vano in ombra CALDA (non nero)
  const marmo = new THREE.MeshStandardMaterial({ color: 0xd7c8ab, roughness: 0.6 });       // travertino CALDO (meno bianco)
  const pietra = new THREE.MeshStandardMaterial({ color: 0xc3b48f, roughness: 0.82 });     // pietra calda (arcata/merli)
  const oro = new THREE.MeshStandardMaterial({ color: 0xd6a520, roughness: 0.5, metalness: 0.3 });   // raggiera dorata
  const grp = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); grp.add(m); return m; };
  // Arco a SESTO ACUTO (gotico) in travertino: due barrette bianche che salgono a punta.
  const archPunta = (cx, yBase, halfW, z, len) => {
    for (const sgn of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, len, 0.13), marmo);
      b.position.set(cx + sgn * halfW * 0.5, yBase + len * 0.32, z);
      b.rotation.z = -sgn * 0.62;
      grp.add(b);
    }
  };

  const W = 34;                    // larghezza facciata
  // Corpo principale in cotto (3 fasce: pianterreno di pietra, due piani di trifore).
  box(W, 15, 3, brick, 0, 7.5, 0);
  // PIANTERRENO in pietra bianca con ARCATA a sesto acuto (7 fornici incorniciati).
  box(W + 0.5, 3.9, 3.25, pietra, 0, 1.95, 0.05);
  for (let i = 0; i < 7; i += 1) {
    const x = -14.4 + i * 4.8;
    box(2.0, 3.0, 0.12, darkWin, x, 1.6, 1.55);               // vano del fornice (ombra calda)
    box(0.22, 3.1, 0.15, marmo, x - 1.15, 1.6, 1.6);          // stipite sx
    box(0.22, 3.1, 0.15, marmo, x + 1.15, 1.6, 1.6);          // stipite dx
    box(2.44, 0.24, 0.15, marmo, x, 3.15, 1.6);               // architrave (niente arco a punta)
  }
  // Portone centrale un filo più alto.
  box(2.6, 3.4, 0.12, darkWin, 0, 1.9, 1.56);
  // Due CORNICI marcapiano in travertino che dividono i tre livelli.
  box(W + 0.6, 0.4, 3.2, marmo, 0, 4.0, 0.02);
  box(W + 0.5, 0.34, 3.15, marmo, 0, 9.3, 0.02);

  // TRIFORE: vano scuro + telaio bianco a CORNICE (4 barre ATTORNO, non un box
  // dietro) + 2 colonnine. Strati su z ben separati e SEMPRE davanti al muro
  // (front 1.5): niente facce complanari → niente z-fighting/sfarfallio bianco.
  const trifora = (x, y, big) => {
    const fw = big ? 2.0 : 1.7, fh = big ? 2.7 : 2.2;
    box(fw, fh, 0.08, darkWin, x, y, 1.55);                                    // vano scuro (proud)
    box(fw + 0.5, 0.24, 0.16, marmo, x, y + fh / 2 + 0.12, 1.60);             // architrave
    box(fw + 0.5, 0.24, 0.16, marmo, x, y - fh / 2 - 0.12, 1.60);             // davanzale
    box(0.24, fh + 0.48, 0.16, marmo, x - fw / 2 - 0.12, y, 1.60);            // stipite sx
    box(0.24, fh + 0.48, 0.16, marmo, x + fw / 2 + 0.12, y, 1.60);            // stipite dx
    box(0.12, fh, 0.10, marmo, x - fw * 0.17, y, 1.66);                        // colonnina sx
    box(0.12, fh, 0.10, marmo, x + fw * 0.17, y, 1.66);                        // colonnina dx
  };

  // Finestre/slot bandiere: primo piano (10) e secondo piano (7).
  const slots1 = [], slots2 = [];
  for (let i = 0; i < 10; i += 1) {
    const x = -14.4 + i * 3.2;
    trifora(x, ESTR_SLOT1_Y, true);
    slots1.push(new THREE.Vector3(x, ESTR_SLOT1_Y, 1.75));
  }
  for (let i = 0; i < 7; i += 1) {
    const x = -12.6 + i * 4.2;
    trifora(x, ESTR_SLOT2_Y, false);
    slots2.push(new THREE.Vector3(x, ESTR_SLOT2_Y, 1.75));
  }

  // RAGGIERA (il sole dorato di San Bernardino) al centro, sopra il secondo piano.
  const sole = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.14, 24), oro);
  sole.rotation.x = Math.PI / 2; sole.position.set(0, 13.5, 1.62); grp.add(sole);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.1), oro);
    r.position.set(Math.sin(a) * 1.45, 13.5 + Math.cos(a) * 1.45, 1.6); r.rotation.z = -a; grp.add(r);
  }

  // CORONAMENTO a merli guelfi in pietra calda (parapetto + merli): meno bianco.
  box(W, 0.5, 3.05, pietra, 0, 15.35, 0);                      // cornice/parapetto
  for (let i = 0; i < 13; i += 1) {
    box(1.5, 1.4, 3.1, pietra, -15.6 + i * 2.6, 16.3, 0);      // merli in pietra
  }

  // ── TORRE DEL MANGIA (a SINISTRA, +z verso il Campo) ───────────────────────
  const tx = -20.2;
  box(2.8, 33, 2.8, brick, tx, 16.5, 0);                       // fusto slanciato in cotto
  // OROLOGIO sul fusto (rivolto al Campo), come nella realtà.
  const oroloRim = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 20), marmo);
  oroloRim.rotation.x = Math.PI / 2; oroloRim.position.set(tx, 27, 1.44); grp.add(oroloRim);
  const oroloFace = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.18, 20), darkWin);
  oroloFace.rotation.x = Math.PI / 2; oroloFace.position.set(tx, 27, 1.5); grp.add(oroloFace);
  // beccatelli: galleria aggettante bianca sotto la cella
  box(4.2, 1.6, 4.2, marmo, tx, 33.4, 0);
  box(3.7, 0.7, 3.7, pietra, tx, 32.3, 0);                     // filare di mensole
  // cella campanaria bianca con 4 monofore ad arco
  box(3.5, 4.4, 3.5, marmo, tx, 36.4, 0);
  for (const s of [[1.78, 0], [-1.78, 0], [0, 1.78], [0, -1.78]]) box(0.9, 3.0, 0.6, darkWin, tx + s[0], 36.2, s[1]);
  box(0.55, 2.4, 0.55, brickDark, tx, 36.0, 1.8);             // la campana intravista
  // battlement + guglia/finale
  for (let i = 0; i < 4; i += 1) box(0.7, 0.9, 3.7, marmo, tx - 1.35 + i * 0.9, 39.0, 0);
  box(3.7, 0.5, 0.7, marmo, tx, 39.0, -1.5);
  box(3.7, 0.5, 0.7, marmo, tx, 39.0, 1.5);
  const guglia = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 2.4, 8), brickDark);
  guglia.position.set(tx, 40.6, 0); grp.add(guglia);

  // (La vecchia mini-loggia ai piedi della Torre è stata RIMOSSA: la Cappella di
  // Piazza vera, in marmo, la costruisce ora il modulo di scenografia — vedi
  // l'opzione `palazzo` passata a costruisciPiazza.)

  // Colloca la facciata sul lato esterno della pista, DAVANTI alla cinta di
  // case (il Palazzo dà direttamente sulla piazza), rivolta verso il Campo.
  const s = sampleAt(getStraightCenterP());
  const inner = s.normal.clone().normalize();          // +normal = verso il centro del Campo
  grp.position.copy(s.point).addScaledVector(inner, -(TRACK_HALF_WIDTH + 3.2));
  grp.rotation.y = Math.atan2(inner.x, inner.z);       // facciata rivolta al Campo
  grp.visible = true;                                  // sempre visibile (backdrop reale della Piazza)
  scene.add(grp);
  state.palazzo = { grp, slots1, slots2, flags: [] };
  return state.palazzo;
}

// Bandiera di Contrada: usa le IMMAGINI VERE delle bandiere (da ilpalio.org,
// scaricate in locale in bandiere/{id}.jpg). Finché l'immagine carica — o se
// manca — si vede un fallback coi colori ufficiali (senza scritte). Origine sul
// BORDO ALTO, così l'animazione di srotolamento (scale.y 0→1) pende dalla finestra.
const __flagTexCache = {};
function getFlagImageTexture(contrada, onReady) {
  const cached = __flagTexCache[contrada.id];
  if (cached) { onReady(cached); return; }
  new THREE.TextureLoader().load(
    BANDIERE[contrada.id],
    (tex) => {
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      __flagTexCache[contrada.id] = tex;
      onReady(tex);
    },
    undefined,
    () => { /* immagine assente: resta il fallback a colori */ }
  );
}

function makeContradaFlagMesh(contrada) {
  // Fallback: solo i colori ufficiali della contrada (nessuna iniziale/scritta).
  const W = 128, H = 128;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const [c1, c2, c3] = contrada.colors;
  ctx.fillStyle = c1; ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = c2; ctx.fillRect(W / 2, 0, W / 2, H);
  ctx.strokeStyle = c3; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(-10, 34); ctx.lineTo(W + 10, 70); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-10, 70); ctx.lineTo(W + 10, 106); ctx.stroke();
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide });
  // Le bandiere vere sono quadrate: appena la foto è pronta sostituisce il fallback.
  getFlagImageTexture(contrada, (tex) => { mat.map = tex; mat.needsUpdate = true; });
  const geo = new THREE.PlaneGeometry(2.5, 2.5);
  geo.translate(0, -1.25, 0);                           // origine sul bordo alto
  return new THREE.Mesh(geo, mat);
}

// Espone una bandiera a uno slot (floor 1 = partecipanti, 2 = non partecipanti).
// instant=true la mostra già srotolata (bandiere del mattino / salto).
function exposeFlag(contrada, floor, slotIndex, instant = false) {
  const pal = ensurePalazzoObjects();
  const slot = (floor === 1 ? pal.slots1 : pal.slots2)[slotIndex];
  if (!slot) return;
  const flag = makeContradaFlagMesh(contrada);
  flag.position.copy(slot);
  // Pende sotto il davanzale, ma non troppo: a −1.2 il bordo basso della prima
  // bandiera finiva dietro l'ENTRONE, che le sta davanti e arriva a quota ~5.1.
  flag.position.y -= floor === 1 ? 0.7 : 1.0;
  if (floor === 2) flag.scale.setScalar(0.82);          // secondo piano: più piccole/sobrie
  flag.userData.unroll = instant ? 1 : 0.001;
  flag.scale.y = (floor === 2 ? 0.82 : 1) * flag.userData.unroll;
  pal.grp.add(flag);
  pal.flags.push(flag);
  return flag;
}

function clearPalazzoFlags() {
  if (!state.palazzo) return;
  state.palazzo.flags.forEach((f) => {
    state.palazzo.grp.remove(f);
    if (f.material.map) f.material.map.dispose();
    f.material.dispose(); f.geometry.dispose();
  });
  state.palazzo.flags = [];
}

// ── Cerimonia ────────────────────────────────────────────────────────────────
function beginEstrazione(tipoId, precomputed) {
  ensureAudio();
  if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
  clearConfetti();
  // Paliata veloce: campo casuale (computeEstrazione). Campagna: campo già deciso
  // dalla rotazione storica, passato come `precomputed` → stessa cerimonia.
  state.estrazione = precomputed || computeEstrazione(tipoId);
  state.mode = "estrazione";
  showScreen(null);
  setHudVisible(false);
  (state.demoHorses || []).forEach((h) => { if (h.group) h.group.visible = false; }); // niente cavalli sulla pista
  ensureEstrazioneCrowd().visible = true;                                        // pista piena di gente in attesa
  setAllestimento("nuda");        // l'estrazione e' settimane prima: niente tufo, niente palchi
  const pal = ensurePalazzoObjects();
  clearPalazzoFlags();
  pal.grp.visible = true;
  // Ordinario: le 7 di diritto sono esposte al primo piano FIN DAL MATTINO.
  state.estrazione.diritto.forEach((c, i) => exposeFlag(c, 1, i, true));
  // L'estrazione comincia SOLO dopo che le chiarine hanno smesso di suonare
  // (~4.2s di fanfara + un respiro).
  state.estrazione.timeline = {
    phase: "intro", timer: 5.0, drawnIdx: 0, secondIdx: 0, shake: 0, done: false,
  };
  // Camera subito in posizione (poi updateEstrazione la tiene con leggero sway).
  const s = sampleAt(getStraightCenterP());
  const inner = s.normal.clone().normalize();
  state.cameraPosition.copy(s.point).addScaledVector(inner, TRACK_HALF_WIDTH + 6.5).add(new THREE.Vector3(0, 6.6, 0));
  state.cameraLook.copy(pal.grp.position).add(new THREE.Vector3(0, 7.5, 0));
  buildEstrazioneHud();
  playTrombetti("chiarine");   // le chiarine aprono il rito
  // Marcia del Palio coi tamburi (primi 12 secondi) ad accompagnare il rito.
  stopPalioSounds();
  playPalioSound("MARCIADELPALIOCONTAMBURI.mp3", { volume: 0.5, stopAfter: 12 });
  setEstrazioneLine(state.estrazione.diritto.length
    ? "Di diritto (esposte dal mattino): " + state.estrazione.diritto.map((c) => c.name).join(", ")
    : "Palio straordinario: tutte e dieci le Contrade si sorteggiano", "#f0cb35");
}

function setEstrazioneLine(text, color) {
  const line = document.getElementById("estrLine");
  if (line) { line.textContent = text; line.style.color = color || "#f3e7cf"; }
}

function estrazioneSkip() {
  const E = state.estrazione, T = E && E.timeline;
  if (!T) return;
  while (T.drawnIdx < E.drawn.length) {
    exposeFlag(E.drawn[T.drawnIdx], 1, E.diritto.length + T.drawnIdx, true);
    T.drawnIdx += 1;
  }
  while (T.secondIdx < E.nonRunners.length) {
    exposeFlag(E.nonRunners[T.secondIdx], 2, T.secondIdx, true);
    T.secondIdx += 1;
  }
  estrazioneDone();
}

function estrazioneDone() {
  const T = state.estrazione.timeline;
  T.phase = "done"; T.done = true;
  const cmp = state.estrazione.campaign ? state.campaign : null;
  const go = document.getElementById("estrGoBtn");
  if (cmp) {
    // Esito CAMPAGNA (deciso in nextCampaignPalio): corri / assisti / salta.
    if (cmp.currentMode === "play") { setEstrazioneLine("La tua Contrada è stata estratta! Corri il Palio.", "#7fd98c"); if (go) go.textContent = "Vai alla Tratta →"; }
    else if (cmp.currentMode === "spectate") { setEstrazioneLine(`La tua Contrada non corre, ma corre la rivale ${cmp.rival.name}: fai di TUTTO per non farla vincere!`, "#e8896f"); if (go) go.textContent = "Vai al Palio →"; }
    else { setEstrazioneLine("Né la tua Contrada né la rivale sono uscite: si va al prossimo Palio.", "#c9bfa8"); if (go) go.textContent = "Prossimo Palio →"; }
  } else {
    setEstrazioneLine("Le dieci Contrade del Palio sono fatte. Ora la Tratta: i cavalli.", "#7fd98c");
  }
  const skip = document.getElementById("estrSkipBtn");
  if (skip) skip.style.display = "none";
  if (go) go.style.display = "";
}

function endEstrazione() {
  const hud = document.getElementById("estrHud"); if (hud) hud.remove();
  if (state.estrazioneCrowd) state.estrazioneCrowd.visible = false; // via il pubblico dalla pista
  setAllestimento("tufo");        // alla Tratta il tufo c'e' gia', i palchi no
  // Il Palazzo e le bandiere restano esposti: fanno scena durante Tratta e corsa.
  if (state.estrazione && state.estrazione.campaign) campaignRoutePalio();   // campagna: corri/assisti/salta
  else {
    // PALIATA VELOCE: stesso iter della Campagna → economia one-off, poi i Capitani
    // votano i cavalli (scelta cavalli) e solo dopo si va alla Tratta.
    setupQuickEconomy();
    beginSceltaCavalli();
  }
}

// Pubblico che riempie la PISTA e il campo durante l'estrazione, in attesa delle
// bandiere (niente cavalli: la corsa non è ancora iniziata). Creato una volta.
function ensureEstrazioneCrowd() {
  if (state.estrazioneCrowd) return state.estrazioneCrowd;
  const cols = [0x7a6a58, 0x55606b, 0x8a8478, 0x6b4a3a, 0x9a9488, 0x40484f,
    0xb8a890, 0xcfc8ba, 0x736d63, 0x84725c, 0xa89a86, 0xc44135, 0x2e689b, 0x287b55, 0xe0b84a];
  const mats = cols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const grp = new THREE.Group();
  for (let i = 0; i < 380; i += 1) {
    const s = sampleAt(Math.random() * track.length);
    const inward = campoOutward(s.point).clone().normalize().multiplyScalar(-1); // verso il campo
    const off = 0.6 + Math.random() * (TRACK_HALF_WIDTH * 1.7);                    // pista + campo
    const p = s.point.clone().addScaledVector(inward, off);
    const person = new THREE.Mesh(shared.crowdGeometry, mats[Math.floor(Math.random() * mats.length)]);
    person.position.set(p.x, 0.42 + Math.random() * 0.14, p.z);
    person.scale.setScalar(0.8 + Math.random() * 0.32);
    person.rotation.y = Math.random() * TAU;
    grp.add(person);
  }
  grp.visible = false;
  scene.add(grp);
  state.estrazioneCrowd = grp;
  return grp;
}

function updateEstrazione(dt, time) {
  const E = state.estrazione, T = E && E.timeline;
  if (!T) return;
  T.shake = Math.max(0, T.shake - dt * 1.6);

  // Srotolamento progressivo delle bandiere appena esposte.
  if (state.palazzo) {
    state.palazzo.flags.forEach((f) => {
      if (f.userData.unroll < 1) {
        f.userData.unroll = Math.min(1, f.userData.unroll + dt * 1.8);
        const base = f.scale.x;                        // 1 o 0.82 (secondo piano)
        f.scale.y = base * f.userData.unroll;
      }
      // lieve sventolio
      f.rotation.y = Math.sin(time * 1.7 + f.position.x) * 0.06;
    });
  }

  if (T.phase === "intro") {
    T.timer -= dt;
    if (T.timer <= 0) { T.phase = "suspense"; T.timer = 1.9; setEstrazioneLine("La Piazza guarda le trifore del primo piano…"); }
  } else if (T.phase === "suspense") {
    T.timer -= dt;
    if (T.timer <= 0) {
      const c = E.drawn[T.drawnIdx];
      exposeFlag(c, 1, E.diritto.length + T.drawnIdx, false);
      T.drawnIdx += 1;
      // Niente suoni "strani" quando esce la bandiera: solo il boato del popolo
      // della contrada estratta (la folla che attende esulta).
      triggerCrowdReaction("cheer");
      T.shake = 0.5;
      const isPlayer = (state.selectedContrada && state.selectedContrada.id === c.id);
      setEstrazioneLine(c.name.toUpperCase() + " — correrà il Palio!" + (isPlayer ? "  (la tua Contrada!)" : ""), isPlayer ? "#f0cb35" : "#f3e7cf");
      T.phase = T.drawnIdx < E.drawn.length ? "afterReveal" : "toSecond";
      T.timer = T.drawnIdx < E.drawn.length ? 2.3 : 2.6;
    }
  } else if (T.phase === "afterReveal") {
    T.timer -= dt;
    if (T.timer <= 0) { T.phase = "suspense"; T.timer = 1.4; setEstrazioneLine("La Piazza guarda le trifore del primo piano…"); }
  } else if (T.phase === "toSecond") {
    T.timer -= dt;
    if (T.timer <= 0) {
      T.phase = "second"; T.timer = 0.4;
      setEstrazioneLine("Al secondo piano: le Contrade che non correranno (ordine di estrazione)");
    }
  } else if (T.phase === "second") {
    T.timer -= dt;
    if (T.timer <= 0) {
      if (T.secondIdx < E.nonRunners.length) {
        exposeFlag(E.nonRunners[T.secondIdx], 2, T.secondIdx, false);
        T.secondIdx += 1;
        T.timer = 0.75;
      } else {
        playTrombetti("fanfare");
        estrazioneDone();
      }
    }
  }

  // Camera: piazza larga sul Palazzo, lento ondeggiamento + colpo agli squilli.
  const s = sampleAt(getStraightCenterP());
  const inner = s.normal.clone().normalize();
  const sway = Math.sin(time * 0.22) * 1.8;
  const camPos = s.point.clone()
    .addScaledVector(inner, TRACK_HALF_WIDTH + 6.5)
    .addScaledVector(s.tangent, sway)
    .add(new THREE.Vector3(0, 6.6 + Math.sin(time * 0.31) * 0.3, 0));
  const lookPos = state.palazzo.grp.position.clone().add(new THREE.Vector3(0, 7.5, 0));
  state.cameraPosition.lerp(camPos, clamp(dt * 2.0, 0, 1));
  state.cameraLook.lerp(lookPos, clamp(dt * 2.4, 0, 1));
  camera.position.copy(state.cameraPosition);
  if (T.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * T.shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * T.shake * 0.08;
  }
  camera.lookAt(state.cameraLook);
  state.cameraFov += (52 - state.cameraFov) * clamp(dt * 3, 0, 1);
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
}

// ── HUD dell'estrazione + scelta del Palio ──────────────────────────────────
function ensureEstrazioneHudStyle() {
  if (document.getElementById("estr-hud-style")) return;
  const s = document.createElement("style");
  s.id = "estr-hud-style";
  s.textContent = `
#estrHud{position:fixed;inset:0;z-index:55;pointer-events:none;font-family:inherit;color:#f3e7cf}
#estrHud .es-title{position:absolute;top:26px;left:0;right:0;text-align:center}
#estrHud .es-title h2{margin:0;font-size:clamp(20px,3.4vw,34px);letter-spacing:.16em;color:#f0cb35;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.7)}
#estrHud .es-title p{margin:5px 0 0;font-size:13px;opacity:.9;text-shadow:0 1px 8px rgba(0,0,0,.8)}
#estrHud .es-bottom{position:absolute;bottom:30px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:12px}
#estrLine{font-size:17px;font-weight:600;min-height:22px;max-width:92vw;text-align:center;text-shadow:0 1px 10px rgba(0,0,0,.9)}
#estrHud .es-btns{display:flex;gap:12px;pointer-events:auto}
#estrHud .es-btns button{font:inherit;cursor:pointer;border-radius:10px;padding:12px 26px;border:1px solid rgba(240,203,53,.5);background:rgba(20,14,8,.72);color:#f3e7cf}
#estrHud .es-btns button:hover{filter:brightness(1.15)}
#estrHud .es-btns .go{background:#f0cb35;color:#1a1206;border-color:#f0cb35;font-weight:700}
#palioChooser{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);color:#f3e7cf;font-family:inherit;padding:24px}
#palioChooser h2{margin:0;font-size:clamp(20px,3.6vw,34px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase}
#palioChooser p{margin:0;opacity:.85;font-size:14px}
#palioChooser .pc-cards{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
#palioChooser button.pc-card{font:inherit;cursor:pointer;min-width:200px;text-align:center;padding:18px 20px;border-radius:14px;border:1px solid rgba(240,203,53,.4);background:rgba(255,255,255,.05);color:#f3e7cf;transition:transform .12s ease,border-color .12s ease}
#palioChooser button.pc-card:hover{transform:translateY(-3px);border-color:#f0cb35}
#palioChooser .pc-card strong{display:block;font-size:18px;margin-bottom:4px;color:#f0cb35}
#palioChooser .pc-card small{display:block;opacity:.75;font-size:12px;line-height:1.35}`;
  document.head.appendChild(s);
}

function buildEstrazioneHud() {
  ensureEstrazioneHudStyle();
  const old = document.getElementById("estrHud"); if (old) old.remove();
  const tipo = state.estrazione.tipo;
  const cmp = state.estrazione.campaign ? state.campaign : null;
  const ctx = cmp ? ` · Anno ${palioTitolo(cmp.palioIndex).year} di 4 · Vittorie ${cmp.wins} · Purghe ${cmp.purghe}` : "";
  const hud = document.createElement("div"); hud.id = "estrHud";
  hud.innerHTML =
    '<div class="es-title"><h2>L’Estrazione delle Contrade</h2><p>' +
    tipo.label + (tipo.data ? " — " + tipo.data : "") +
    ' · Palazzo Comunale' + ctx + '</p></div>' +
    '<div class="es-bottom"><div id="estrLine"></div><div class="es-btns">' +
    '<button type="button" id="estrSkipBtn">Salta l’estrazione</button>' +
    '<button type="button" id="estrGoBtn" class="go" style="display:none">Vai alla Tratta →</button>' +
    '</div></div>';
  document.body.appendChild(hud);
  document.getElementById("estrSkipBtn").addEventListener("click", estrazioneSkip);
  document.getElementById("estrGoBtn").addEventListener("click", endEstrazione);
}

// Scelta del Palio: luglio (Provenzano), agosto (Assunta) o straordinario.
function openPalioChooser() {
  stopPalioSounds();   // via il canto della vincitrice: non deve restare acceso sul palio dopo
  ensureEstrazioneHudStyle();
  const old = document.getElementById("palioChooser"); if (old) old.remove();
  const ov = document.createElement("div"); ov.id = "palioChooser";
  const h2 = document.createElement("h2"); h2.textContent = "Che Palio si corre?";
  const p = document.createElement("p"); p.textContent = "Negli ordinari corrono 7 Contrade di diritto + 3 sorteggiate; nello straordinario tutte e 10 a sorte.";
  const cards = document.createElement("div"); cards.className = "pc-cards";
  Object.values(PALIO_TYPES).forEach((tipo) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pc-card";
    const strong = document.createElement("strong"); strong.textContent = tipo.label;
    const small = document.createElement("small");
    small.textContent = (tipo.data ? tipo.data + " · " : "") + tipo.nota;
    b.append(strong, small);
    b.addEventListener("click", () => { ov.remove(); beginEstrazione(tipo.id); });
    cards.appendChild(b);
  });
  ov.append(h2, p, cards);
  document.body.appendChild(ov);
}

// ══════════════════════════════════════════════════════════════════════════
// MODALITÀ CAMPAGNA — la carriera del CAPITANO di Contrada (8 palii in 4 anni)
// ══════════════════════════════════════════════════════════════════════════
// Layer meta sopra il gioco a palio singolo. Si sceglie una Contrada e la si
// guida per 8 palii (2 luglio + 16 agosto, per 4 anni). A ogni palio si fa
// l'ESTRAZIONE (10 Contrade su 17, senza forzare il giocatore): se esce la tua
// corri, se esce solo la rivale ASSISTI, se non esce nessuna delle due si SALTA.
// Obiettivo: vincere almeno un palio e non farlo mai vincere alla rivale (Purga).
const CAMPAIGN_PALII = 8;

function ensureCampaignStyle() {
  if (document.getElementById("campaign-style")) return;
  const st = document.createElement("style");
  st.id = "campaign-style";
  st.textContent = `
  #campaignOverlay{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at 50% 28%, rgba(40,26,14,.82), rgba(16,11,6,.95));font-family:inherit;padding:20px}
  .cmp-panel{max-width:640px;width:94%;max-height:92vh;overflow:auto;background:rgba(28,20,12,.97);
    border:1px solid rgba(240,203,53,.35);border-radius:18px;padding:28px 30px;color:#f3e9d6;text-align:center;
    box-shadow:0 24px 70px rgba(0,0,0,.6)}
  .cmp-kicker{letter-spacing:.24em;font-size:12px;color:#f0cb35;text-transform:uppercase;margin:0 0 6px}
  .cmp-title{font-size:30px;font-weight:800;margin:0 0 14px;color:#f7edd6}
  .cmp-text{font-size:17px;line-height:1.5;color:#e6dbc6;margin:0 0 8px}
  .cmp-big{font-size:22px;font-weight:800;color:#f0cb35}
  .cmp-input{font-size:20px;padding:12px 16px;border-radius:12px;border:1px solid rgba(240,203,53,.4);
    background:rgba(0,0,0,.35);color:#fff;width:80%;max-width:340px;text-align:center;margin:14px 0}
  .cmp-btn{margin-top:16px;font-size:18px;font-weight:700;padding:12px 30px;border-radius:12px;border:none;
    background:#c22530;color:#fff;cursor:pointer}
  .cmp-flags{display:flex;flex-wrap:wrap;gap:9px 8px;justify-content:center;margin:16px 0 26px}
  .cmp-flag{width:58px;height:58px;border-radius:8px;background-size:cover;background-position:center;
    border:2px solid rgba(255,255,255,.14);position:relative}
  .cmp-flag.me{border-color:#f0cb35;box-shadow:0 0 0 2px #f0cb35}
  .cmp-flag.rival{border-color:#e8896f;box-shadow:0 0 0 2px #e8896f}
  .cmp-flag span{position:absolute;bottom:-15px;left:-4px;right:-4px;font-size:9px;color:#d8ccae;white-space:nowrap}
  .cmp-stats{display:flex;gap:26px;justify-content:center;margin:18px 0}
  .cmp-stat b{display:block;font-size:38px;line-height:1;color:#f0cb35}
  .cmp-stat small{font-size:11px;color:#c9bfa8;letter-spacing:.1em;text-transform:uppercase}
  /* Telefono in orizzontale (schermo basso): compatta i pannelli campagna così
     l'elenco delle accoppiate/fantini entra tutto senza scroll infinito. */
  @media (max-height:620px), (max-width:1024px){
    #campaignOverlay{padding:8px}
    .cmp-panel{max-height:96vh;padding:12px 16px;border-radius:12px}
    .cmp-kicker{font-size:10px;margin:0 0 3px}
    .cmp-title{font-size:19px;margin:0 0 7px}
    .cmp-text{font-size:13px;line-height:1.35;margin:0 0 5px}
    .cmp-big{font-size:17px}
    .cmp-btn{margin-top:8px;font-size:14px;padding:8px 22px}
    .cmp-flags{gap:6px 6px;margin:8px 0 16px}
    .cmp-flag{width:42px;height:42px}
    .cmp-stats{gap:16px;margin:8px 0}
    .cmp-stat b{font-size:26px}
    .cmp-list{max-height:72vh !important;gap:3px !important;margin:6px 0 !important}
    .cmp-row{padding:5px 10px !important;font-size:12px !important;gap:8px !important;border-radius:8px !important}
    .cmp-row-flag{width:20px !important;height:20px !important}
    /* Accordi su telefono: le due colonne si IMPILANO e i controlli vanno a tutta
       larghezza, con checkbox grandi da toccare (prima erano microscopiche e affiancate). */
    .cmp-cols{flex-direction:column !important;gap:12px !important;align-items:stretch !important}
    .cmp-ctrl{min-width:0 !important;width:100% !important;align-items:stretch !important}
    .cmp-ctrl label{font-size:13px !important;line-height:1.3 !important;gap:10px !important;padding:5px 2px}
    .cmp-ctrl input[type=checkbox]{width:20px !important;height:20px !important;flex:0 0 auto;margin-top:0}
  }
  `;
  document.head.appendChild(st);
}

function campaignOverlay(build) {
  ensureCampaignStyle();
  const old = document.getElementById("campaignOverlay"); if (old) old.remove();
  const ov = document.createElement("div"); ov.id = "campaignOverlay";
  const panel = document.createElement("div"); panel.className = "cmp-panel";
  build(panel);
  ov.appendChild(panel);
  document.body.appendChild(ov);
  return ov;
}
function closeCampaignOverlay() { const o = document.getElementById("campaignOverlay"); if (o) o.remove(); }
function resetCampaign() {
  state.campaign = null;
  // Invalido la cache della paliata veloce: la campagna ha appena scritto i tesori
  // sullo store persistente, quindi al prossimo accesso la veloce li RICARICA da lì
  // (senza questo mostrava i valori pre-campagna finché non si ricaricava la pagina).
  state.quickBudgets = null;
}

// ── SALVA / RIPRENDI CAMPAGNA ────────────────────────────────────────────────
// La campagna si può interrompere fra un palio e l'altro e riprendere al prossimo
// accesso. Salviamo solo lo stato PERSISTENTE (per id, ricostruito al resume); il
// tesoro è già nello store persistente. Non salviamo lo stato di una corsa in atto.
const CAMPAIGN_SAVE_KEY = "palio.campaignSave";
function serializeCampaign(cmp) {
  if (!cmp || !cmp.active || cmp.quick || !cmp.contrada) return null;
  return {
    v: 1,
    contradaId: cmp.contrada.id,
    rivalId: cmp.rival ? cmp.rival.id : null,
    captain: cmp.captain || "",
    palioIndex: cmp.palioIndex || 0,
    wins: cmp.wins || 0,
    purghe: cmp.purghe || 0,
    jkLock: cmp.jkLock || {},
    circuit: cmp.circuit || null,
    schedule: cmp.schedule || null,
    lastYearBudgeted: cmp.lastYearBudgeted || 1,
    log: (cmp.log || []).slice(-40),
    savedAt: Date.now(),
  };
}
function saveCampaignProgress() {
  try {
    const data = serializeCampaign(state.campaign);
    if (data) localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* niente */ }
}
function loadCampaignSave() {
  try { const s = JSON.parse(localStorage.getItem(CAMPAIGN_SAVE_KEY)); return (s && s.contradaId) ? s : null; } catch (e) { return null; }
}
function clearCampaignSave() { try { localStorage.removeItem(CAMPAIGN_SAVE_KEY); } catch (e) { /* niente */ } }

// Esce dalla campagna in corso (fra un palio e l'altro), salvando i progressi.
function exitCampaignSaving() {
  saveCampaignProgress();
  // togli i bottoni "Continua/Esci" dai risultati, se presenti
  ["campaignContinueBtn", "campaignExitBtn"].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
  ["replayButton", "changeContradaButton", "restartMossaButton"].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ""; });
  closeCampaignOverlay();
  state.campaign = null;   // esco: la campagna resta salvata su disco, non in memoria
  try { stopPalioSounds(); } catch (e) { /* niente */ }
  openMenuScreen();
  toastMsg("Campagna salvata: potrai riprenderla dal menu.");
}

// Riprende la campagna salvata: ricostruisce lo stato e va al prossimo palio.
function resumeCampaign() {
  const s = loadCampaignSave();
  if (!s) { toastMsg("Nessuna campagna da riprendere."); return; }
  const contrada = CONTRADE.find((c) => c.id === s.contradaId);
  if (!contrada) { clearCampaignSave(); toastMsg("Salvataggio non valido."); return; }
  // La rivale si RICALCOLA sempre da RIVALS, non si legge dal salvataggio: una
  // campagna salvata con un abbinamento sbagliato se lo portava dietro per
  // sempre, anche dopo aver corretto la tabella. Le Contrade senza rivale
  // (Bruco, Drago, Giraffa, Selva) restano giustamente senza.
  const rival = pickRival(contrada);
  state.difficulty = "hard";
  const budgets = loadPersistentBudgets();
  state.campaign = {
    active: true, setup: false, quick: false,
    contrada, rival, captain: s.captain || "Capitano",
    palioIndex: s.palioIndex || 0, wins: s.wins || 0, purghe: s.purghe || 0,
    log: Array.isArray(s.log) ? s.log : [], recorded: false, jkLock: s.jkLock || {},
    circuit: s.circuit || { luglio: [], agosto: [] },
    schedule: (Array.isArray(s.schedule) && s.schedule.length) ? s.schedule : buildCampaignSchedule(),
    lastYearBudgeted: s.lastYearBudgeted || 1,
    budgets,
  };
  state.campaign.budget = budgets[contrada.id];
  closeCampaignOverlay();
  const cmp = state.campaign;
  if (cmp.palioIndex >= campaignTotalPalii(cmp)) { showCampaignFinal(); return; }
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = `Capitano ${cmp.captain} · Contrada ${contrada.name}`;
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Bentornato, Capitano";
    const p = document.createElement("div"); p.className = "cmp-text";
    p.innerHTML = `Riprendi il mandato al <b>palio ${cmp.palioIndex + 1}</b> di ${campaignTotalPalii(cmp)}. Vittorie ${cmp.wins} · Purghe ${cmp.purghe}.`;
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Riprendi il mandato →";
    b.addEventListener("click", () => { closeCampaignOverlay(); nextCampaignPalio(); });
    panel.append(k, t, p, b);
  });
}

// ── FREEZE PALIATA VELOCE: max 1 ogni 10 minuti per giocatore (Mario Rossi: illimitato).
const PALIATA_COOLDOWN_MS = 10 * 60 * 1000;
function isMarioRossi(acc) {
  return !!(acc && (acc.nome || "").trim().toLowerCase() === "mario"
    && (acc.cognome || "").trim().toLowerCase() === "rossi");
}
function paliataVeloceAttesaMs() {
  const acc = getAccount();
  if (isMarioRossi(acc)) return 0;                  // illimitato
  const key = "palio.lastVeloce" + (acc && acc.email ? "_" + acc.email : "");
  let last = 0;
  try { last = parseInt(localStorage.getItem(key) || "0", 10) || 0; } catch (e) { last = 0; }
  const elapsed = Date.now() - last;
  return elapsed < PALIATA_COOLDOWN_MS ? (PALIATA_COOLDOWN_MS - elapsed) : 0;   // ms rimanenti (0 = ok)
}
function segnaPaliataVeloce() {
  const acc = getAccount();
  if (isMarioRossi(acc)) return;
  const key = "palio.lastVeloce" + (acc && acc.email ? "_" + acc.email : "");
  try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* niente */ }
}
// Campagna: max 1 ogni 20 minuti per giocatore (Mario Rossi: illimitato).
const CAMPAGNA_COOLDOWN_MS = 20 * 60 * 1000;
function campagnaAttesaMs() {
  const acc = getAccount();
  if (isMarioRossi(acc)) return 0;
  const key = "palio.lastCampagna" + (acc && acc.email ? "_" + acc.email : "");
  let last = 0;
  try { last = parseInt(localStorage.getItem(key) || "0", 10) || 0; } catch (e) { last = 0; }
  const elapsed = Date.now() - last;
  return elapsed < CAMPAGNA_COOLDOWN_MS ? (CAMPAGNA_COOLDOWN_MS - elapsed) : 0;
}
function segnaCampagna() {
  const acc = getAccount();
  if (isMarioRossi(acc)) return;
  const key = "palio.lastCampagna" + (acc && acc.email ? "_" + acc.email : "");
  try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* niente */ }
}
// Toast centrale (visibile sopra qualsiasi overlay).
function toastMsg(text, ms = 3800) {
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;top:16%;left:50%;transform:translateX(-50%);z-index:10001;max-width:min(430px,88vw);"
    + "text-align:center;background:rgba(20,14,8,.96);border:1px solid rgba(232,137,111,.6);color:#f3e7cf;font-family:inherit;"
    + "font-size:15px;line-height:1.45;padding:14px 20px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.6)";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { try { t.remove(); } catch (e) { /* niente */ } }, ms);
}

// Scelta iniziale del giocatore: "Paliata veloce" (gioco singolo) o "Campagna".
function openModeChooser() {
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = "Come vuoi giocare";
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Palio Game";
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:18px;flex-wrap:wrap;justify-content:center;margin-top:8px";
    const col = (label, sub, bg, onClick) => {
      const c = document.createElement("div"); c.style.cssText = "flex:1;min-width:200px";
      const b = document.createElement("button"); b.className = "cmp-btn"; b.style.background = bg; b.style.width = "100%"; b.textContent = label;
      const s = document.createElement("div"); s.className = "cmp-text"; s.style.fontSize = "14px"; s.style.marginTop = "8px"; s.textContent = sub;
      c.append(b, s); b.addEventListener("click", onClick); return c;
    };
    row.append(
      col("Paliata veloce", "Un singolo palio, subito in pista.", "#c22530", () => {
        const wait = paliataVeloceAttesaMs();
        if (wait > 0) {
          const min = Math.max(1, Math.ceil(wait / 60000));
          toastMsg(`Puoi correre una Paliata veloce ogni 10 minuti. Riprova fra ${min} min.`);
          return;
        }
        segnaPaliataVeloce();
        resetCampaign();          // azzera l'eventuale campagna (mette quickBudgets a null)
        // NIENTE reset dei tesori: i denari delle Contrade NON ripartono da capo a
        // ogni paliata. Sono l'unico universo di questo account e si portano dietro
        // tutto quello che e' stato speso e incassato, palio dopo palio.
        closeCampaignOverlay(); openSelectScreen();
      }),
      col("Campagna", "Diventa Capitano: 8 palii in 4 anni.", "#2e6b46", () => {
        const wait = campagnaAttesaMs();
        if (wait > 0) {
          const min = Math.max(1, Math.ceil(wait / 60000));
          toastMsg(`Puoi iniziare una Campagna ogni 20 minuti. Riprova fra ${min} min.`);
          return;
        }
        const saved = loadCampaignSave();
        const start = () => { segnaCampagna(); closeCampaignOverlay(); beginCampaignSetup(); };
        if (saved) {
          if (confirm("Hai una Campagna in corso salvata: iniziarne una NUOVA la cancella. Procedere?")) { clearCampaignSave(); start(); }
        } else { start(); }
      })
    );
    // Se c'è una campagna salvata, aggiungi la colonna "Riprendi la Campagna".
    const saved = loadCampaignSave();
    if (saved) {
      const cName = (CONTRADE.find((c) => c.id === saved.contradaId) || {}).name || "";
      row.append(col("Riprendi la Campagna", `${cName} · palio ${(saved.palioIndex || 0) + 1} · vittorie ${saved.wins || 0}.`, "#3a5db8", () => {
        closeCampaignOverlay(); resumeCampaign();
      }));
    }
    panel.append(k, t, row);
  });
}

function beginCampaignSetup() {
  state.campaign = { active: true, setup: true, contrada: null, rival: null, captain: "", budget: 0, palioIndex: 0, wins: 0, purghe: 0, log: [], recorded: false, jkLock: {} };
  state.difficulty = "hard";   // la Campagna è sempre da ESPERTO (e un filo più dura), senza sceglierlo
  // Storia dei due giri (luglio/agosto) = "chi ha corso l'anno scorso" in quel
  // giro. Bootstrap casuale, così già dal 1° palio vale la rotazione reale.
  const rand10 = () => shuffleInPlace(CONTRADE.slice()).slice(0, 10).map((c) => c.id);
  state.campaign.circuit = { luglio: rand10(), agosto: rand10() };
  state.campaign.schedule = buildCampaignSchedule();
  openSelectScreen();
}

// Scaletta dei palii: 4 anni × (2 luglio + 16 agosto). Con probabilità 1/10 si
// aggiunge NEL MEZZO un Palio Straordinario di settembre (10 Contrade tutte a
// sorte), dopo l'agosto di un'annata centrale.
function buildCampaignSchedule() {
  const sched = [];
  for (let y = 1; y <= 4; y += 1) { sched.push({ type: "luglio", year: y }); sched.push({ type: "agosto", year: y }); }
  if (Math.random() < 0.1) {
    const midYear = Math.random() < 0.5 ? 2 : 3;   // settembre dell'anno 2 o 3
    const pos = midYear === 2 ? 4 : 6;             // dopo l'agosto di quell'anno
    sched.splice(pos, 0, { type: "straordinario", year: midYear });
  }
  return sched;
}

function pickRival(contrada) {
  const map = RIVALS[contrada.id] || {};
  let best = null, bk = -1;
  Object.keys(map).forEach((rid) => { const r = CONTRADE.find((c) => c.id === rid); if (r && map[rid] > bk) { best = r; bk = map[rid]; } });
  return best;   // niente rivale a caso: le Contrade non in RIVALS restano SENZA rivale
}

// Confermata la Contrada nella schermata di selezione (in setup campagna).
function campaignConfirmContrada() {
  const c = state.selectedContrada;
  if (!c) { showMessage("Scegli prima la tua Contrada", 1.4, "danger"); return; }
  state.campaign.contrada = c;
  state.campaign.rival = pickRival(c);
  state.campaign.setup = false;
  showScreen(null);
  campaignMandate();
}

function campaignMandate() {
  const cmp = state.campaign;
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = `Contrada ${cmp.contrada.name}`;
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Sei il Capitano";
    const p = document.createElement("div"); p.className = "cmp-text";
    p.textContent = "Il mandato del Capitano dura 4 anni, porta la gloria nella tua contrada!";
    const r = document.createElement("div"); r.className = "cmp-text"; r.style.marginTop = "10px";
    r.innerHTML = cmp.rival
      ? `La tua rivale storica è la Contrada <b style="color:#e8896f">${cmp.rival.name}</b>: non lasciarla mai vincere.`
      : `La tua Contrada non ha una rivale storica: pensa solo a portare a casa il Palio.`;
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Avanti";
    b.addEventListener("click", () => campaignNameScreen());
    panel.append(k, t, p, r, b);
  });
}

function campaignNameScreen() {
  campaignOverlay((panel) => {
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Il tuo nome, Capitano";
    const input = document.createElement("input"); input.className = "cmp-input"; input.type = "text"; input.maxLength = 24; input.placeholder = "nome";
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Conferma";
    const go = () => { state.campaign.captain = ((input.value || "").trim().slice(0, 24)) || "Capitano"; campaignBudgetScreen(); };
    b.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    panel.append(t, input, document.createElement("br"), b);
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 60);
  });
}

// ── BUDGET PERSISTENTE ───────────────────────────────────────────────────────
// L'UNIVERSO DI OGNI ACCOUNT. Il tesoro delle 17 Contrade non si azzera MAI: tutte
// partono da 5000 denari la primissima volta, poi ognuna sale o scende con quello
// che spende e incassa (ingaggi, corruzioni, accordi, aste, +100/anno in campagna)
// e resta com'è, palio dopo palio. Vale sia per la paliata veloce sia per la
// Campagna — il tesoro è UNO solo — ed è legato all'ACCOUNT, non al dispositivo.
// Capitale iniziale di OGNI Contrada, la primissima volta che si gioca con un
// account. Mario Rossi (lo sviluppatore) resta a 5000 per poter provare tutto
// senza restare a secco; per tutti gli altri 2000, così i denari contano davvero
// e una corruzione da 400 si sente. Chi ha già un tesoro salvato non viene
// toccato: questo valore vale solo per le Contrade mai giocate su quell'account.
const BUDGET_START_DEV = 5000;
const BUDGET_START = 2000;
function budgetIniziale() {
  try { return isMarioRossi(getAccount()) ? BUDGET_START_DEV : BUDGET_START; }
  catch (e) { return BUDGET_START; }
}
// UN UNIVERSO PER ACCOUNT. La chiave porta l'email di chi ha fatto il login: due
// persone che giocano sullo stesso computer hanno due tesori distinti, e chi
// rientra col suo account ritrova i suoi. (Chi non ha ancora un account gioca su
// una chiave "ospite", che diventa la sua appena si registra.)
function budgetStoreKey() {
  let mail = "";
  try { const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); mail = (a && a.email) || ""; } catch (e) { mail = ""; }
  return "palio.budgets.v1" + (mail ? ":" + mail.trim().toLowerCase() : ":ospite");
}
function loadPersistentBudgets() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(budgetStoreKey())) || {}; } catch (e) { saved = {}; }
  // Chi giocava prima che i tesori fossero per-account si porta dietro i suoi:
  // si travasa la vecchia chiave unica la prima volta, invece di ripartire da 5000.
  if (!Object.keys(saved).length) {
    try { saved = JSON.parse(localStorage.getItem("palio.budgets.v1")) || {}; } catch (e) { saved = {}; }
  }
  const budgets = {};
  CONTRADE.forEach((c) => {
    const v = Number(saved[c.id]);
    budgets[c.id] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : budgetIniziale();
  });
  return budgets;
}
function savePersistentBudgets(budgets) {
  if (!budgets) return;
  try { localStorage.setItem(budgetStoreKey(), JSON.stringify(budgets)); } catch (e) { /* storage pieno/disabilitato */ }
}
// ── I SOLDI GIRANO IN OGNI MODALITÀ ──────────────────────────────────────────
// budgetsRef() restituisce SEMPRE un oggetto tesoro valido: quello della campagna
// se attiva, altrimenti uno di PALIATA VELOCE caricato dallo store persistente
// (il tesoro è UNO solo, condiviso fra modalità). Così aste, corruzioni, accordi
// e ingaggi accreditano/addebitano davvero anche fuori dalla campagna — prima
// earnBudget/spendBudget erano no-op senza campagna e i tesori restavano fermi.
function budgetsRef() {
  const cmp = state.campaign;
  if (cmp && cmp.budgets) return cmp.budgets;
  if (!state.quickBudgets) state.quickBudgets = loadPersistentBudgets();
  return state.quickBudgets;
}
function contradaBudget(id) { return budgetsRef()[id] || 0; }
// Ogni spesa/guadagno salva SUBITO: qualunque variazione (chiunque la faccia,
// giocatore o AI) è già persistita quando il palio finisce, comunque finisca.
function spendBudget(id, amount) {
  const b = budgetsRef();
  b[id] = Math.max(0, Math.round((b[id] || 0) - amount));
  const cmp = state.campaign;
  if (cmp && cmp.contrada && id === cmp.contrada.id) cmp.budget = b[id];
  savePersistentBudgets(b);
}
function earnBudget(id, amount) {
  const b = budgetsRef();
  b[id] = Math.round((b[id] || 0) + amount);
  const cmp = state.campaign;
  if (cmp && cmp.contrada && id === cmp.contrada.id) cmp.budget = b[id];
  savePersistentBudgets(b);
}
// Accredito a TUTTE le contrade (sovvenzioni): passa dalle stesse funzioni.
function earnBudgetAll(amount) { CONTRADE.forEach((c) => earnBudget(c.id, amount)); }

// Contatore SOLDI del giocatore, sempre in alto a destra durante tutte le fasi
// pre-corsa della campagna (estrazione, tratta, ingaggio, accordi, corruzione).
// Sparisce quando si corre il palio (mossa/gara) e fuori dalla campagna.
function refreshCampaignMoney() {
  const cmp = state.campaign;
  const show = !!(cmp && cmp.active && cmp.contrada && cmp.budgets
    && (state.mode === "estrazione" || state.mode === "tratta" || state.mode === "scelta"));
  let el = document.getElementById("cmpMoney");
  if (!show) { if (el) el.style.display = "none"; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "cmpMoney";
    el.style.cssText = "position:fixed;top:14px;right:calc(env(safe-area-inset-right,0px) + 16px);z-index:200;display:flex;align-items:center;gap:8px;"
      + "background:rgba(20,14,8,.82);border:1px solid rgba(240,203,53,.55);border-radius:11px;padding:8px 14px;"
      + "font-family:inherit;color:#f3e7cf;font-size:15px;box-shadow:0 3px 14px rgba(0,0,0,.5);pointer-events:none";
    el.innerHTML = '<span style="width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe680,#e0a800);'
      + 'box-shadow:inset 0 0 0 2px rgba(120,80,0,.4);flex:0 0 auto"></span>'
      + '<span style="font-weight:600"><b id="cmpMoneyVal" style="color:#f0cb35;font-size:17px;font-weight:800">0</b> denari'
      + ' · <span id="cmpMoneyContrada" style="opacity:.85"></span></span>';
    document.body.appendChild(el);
  }
  el.style.display = "";
  const val = document.getElementById("cmpMoneyVal");
  if (val) val.textContent = contradaBudget(cmp.contrada.id);
  const cn = document.getElementById("cmpMoneyContrada");
  if (cn && cn.textContent !== cmp.contrada.name) cn.textContent = cmp.contrada.name;
}

function campaignBudgetScreen() {
  const cmp = state.campaign;
  // Tesoro PERSISTENTE anche in Campagna: si riparte da dove si era rimasti
  // (400 alla primissima partita), non più da un sorteggio 300..500.
  cmp.budgets = loadPersistentBudgets();
  cmp.budget = cmp.budgets[cmp.contrada.id];
  cmp.lastYearBudgeted = 1;
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = `Capitano ${cmp.captain} · Contrada ${cmp.contrada.name}`;
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Il Budget della Contrada";
    const p = document.createElement("div"); p.className = "cmp-text";
    p.innerHTML = `La nostra contrada ha un Budget per il palio di <span class="cmp-big">${cmp.budget} denari</span>.`;
    const o = document.createElement("div"); o.className = "cmp-text"; o.style.marginTop = "10px";
    o.textContent = cmp.rival
      ? "Ti aspettano 8 palii. Vinci almeno una volta e non farlo mai vincere alla rivale."
      : "Ti aspettano 8 palii. Vinci almeno una volta: la tua Contrada non ha una rivale.";
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Inizia la carriera";
    b.addEventListener("click", () => { saveCampaignProgress(); closeCampaignOverlay(); nextCampaignPalio(); });
    panel.append(k, t, p, o, b);
  });
}

function palioTitolo(idx) {
  const cmp = state.campaign || {};
  const e = (cmp.schedule && cmp.schedule[idx]) || { type: idx % 2 === 0 ? "luglio" : "agosto", year: Math.floor(idx / 2) + 1 };
  const mese = e.type === "straordinario" ? "Palio Straordinario · Settembre"
    : e.type === "agosto" ? "Palio dell'Assunta · 16 Agosto"
    : "Palio di Provenzano · 2 Luglio";
  return { year: e.year, mese, type: e.type };
}

// Prepara il prossimo palio: estrazione delle 10 Contrade e decisione play/assisti/salta.
// Estrazione storica del Palio (10 corrono). Le 7 Contrade che NON corsero l'anno
// scorso in quel giro (luglio o agosto) corrono DI DIRITTO; le altre 3 sono
// SORTEGGIATE fra le 10 che corsero. Aggiorna la storia del giro per l'anno dopo.
function campaignDrawField(cmp, circuitKey) {
  let lastIds = cmp.circuit && cmp.circuit[circuitKey];
  if (!lastIds || lastIds.length !== 10) lastIds = shuffleInPlace(CONTRADE.slice()).slice(0, 10).map((c) => c.id);
  const lastSet = new Set(lastIds);
  const diritto = CONTRADE.filter((c) => !lastSet.has(c.id));          // 7: non corsero → di diritto
  const ranLast = CONTRADE.filter((c) => lastSet.has(c.id));           // 10: corsero l'anno scorso
  const sorteggiate = shuffleInPlace(ranLast.slice()).slice(0, 3);     // 3 estratte fra quelle
  const field = shuffleInPlace([...diritto, ...sorteggiate]);          // le 10 di quest'anno
  cmp.circuit = cmp.circuit || {};
  cmp.circuit[circuitKey] = field.map((c) => c.id);                    // aggiorna la storia del giro
  return { field, dirittoIds: new Set(diritto.map((c) => c.id)), sorteggiateIds: new Set(sorteggiate.map((c) => c.id)) };
}

function campaignTotalPalii(cmp) { return (cmp.schedule && cmp.schedule.length) || CAMPAIGN_PALII; }

function nextCampaignPalio() {
  const cmp = state.campaign;
  if (!cmp || !cmp.active) return;
  if (cmp.palioIndex >= campaignTotalPalii(cmp)) { showCampaignFinal(); return; }
  cmp.recorded = false;
  cmp.corrupted = {};        // corruzioni azzerate a ogni nuovo palio
  cmp.corruptOrders = {};    // ordini dati ai fantini corrotti (per id): finalità scelte
  cmp.accordi = [];          // accordi fra contrade azzerati a ogni nuovo palio
  cmp.incomingAccordi = null; // proposte in arrivo: rigenerate alla schermata accordi
  cmp.fazione = null;         // il "partito" del favorito avversario: rifatto a ogni palio
  cmp.mormorii = null;        // voci di piazza: rigenerate alla schermata accordi
  const entry = (cmp.schedule && cmp.schedule[cmp.palioIndex]) || { type: cmp.palioIndex % 2 === 0 ? "luglio" : "agosto" };
  cmp.currentType = entry.type;
  // Ogni nuovo anno il budget di TUTTE le contrade cresce di +100 denari.
  const yr = entry.year || (Math.floor(cmp.palioIndex / 2) + 1);
  if (cmp.budgets && yr > (cmp.lastYearBudgeted || 1)) {
    cmp.lastYearBudgeted = yr;
    CONTRADE.forEach((c) => { cmp.budgets[c.id] = (cmp.budgets[c.id] || 0) + 100; });
    if (cmp.contrada) cmp.budget = cmp.budgets[cmp.contrada.id];
    savePersistentBudgets(cmp.budgets);   // anche il +100 annuale resta nel tesoro persistente
  }
  if (entry.type === "straordinario") {
    // Straordinario: 10 Contrade tutte a sorte, niente di diritto; non tocca la storia dei giri.
    const field = shuffleInPlace(CONTRADE.slice()).slice(0, 10);
    cmp.currentDraw = field;
    cmp.currentDiritto = new Set();
    cmp.currentSorteggiate = new Set(field.map((c) => c.id));
  } else {
    const { field, dirittoIds, sorteggiateIds } = campaignDrawField(cmp, entry.type);
    cmp.currentDraw = field;
    cmp.currentDiritto = dirittoIds;
    cmp.currentSorteggiate = sorteggiateIds;
  }
  cmp.playerIn = cmp.currentDraw.some((c) => c.id === cmp.contrada.id);
  cmp.rivalIn = !!(cmp.rival && cmp.currentDraw.some((c) => c.id === cmp.rival.id));
  cmp.currentMode = cmp.playerIn ? "play" : cmp.rivalIn ? "spectate" : "skip";
  campaignEstrazioneScreen();
}

// In campagna l'estrazione usa la STESSA cerimonia della paliata veloce (rito al
// Palazzo, bandiere che si srotolano dalle trifore), ma con il campo già deciso
// dalla rotazione storica (7 di diritto + 3 sorteggiate, o 10 allo straordinario).
function campaignEstrazioneScreen() {
  const cmp = state.campaign;
  closeCampaignOverlay();                       // via eventuali overlay della campagna
  state.selectedContrada = cmp.contrada;        // così la cerimonia evidenzia la TUA Contrada
  const tipo = cmp.currentType === "straordinario" ? PALIO_TYPES.straordinario
    : cmp.currentType === "agosto" ? PALIO_TYPES.agosto : PALIO_TYPES.luglio;
  const diritto = cmp.currentDraw.filter((c) => cmp.currentDiritto && cmp.currentDiritto.has(c.id));
  // Le estratte a sorte: ordine di USCITA rimescolato a OGNI estrazione (mai lo stesso).
  const drawn = shuffleInPlace(cmp.currentDraw.filter((c) => cmp.currentSorteggiate && cmp.currentSorteggiate.has(c.id)));
  const running = new Set(cmp.currentDraw.map((c) => c.id));
  const nonRunners = shuffleInPlace(CONTRADE.filter((c) => !running.has(c.id)));
  const estr = { tipo, diritto, drawn, participants: [...diritto, ...drawn], nonRunners, campaign: true };
  beginEstrazione(tipo.id, estr);
}

function campaignRoutePalio() {
  const cmp = state.campaign;
  const tipo = cmp.currentType === "straordinario" ? PALIO_TYPES.straordinario
    : cmp.currentType === "agosto" ? PALIO_TYPES.agosto : PALIO_TYPES.luglio;
  // Le 10 estratte diventano i partecipanti alla gara (pickRaceContrade le userà).
  state.estrazione = { tipo, diritto: [], drawn: cmp.currentDraw.slice(), participants: cmp.currentDraw.slice(), nonRunners: [] };
  if (cmp.currentMode === "play") {
    state.selectedContrada = cmp.contrada;   // corri con la tua Contrada (palio completo)
    beginSceltaCavalli();                    // PRIMA della Tratta: i Capitani votano i cavalli
  } else if (cmp.currentMode === "spectate") {
    state.selectedContrada = cmp.rival;      // il cavallo-focus è la rivale (autopilot): assisti
    campaignSpectateSetup();
  } else {
    cmp.log.push({ idx: cmp.palioIndex, mode: "skip", winner: null, result: "skip" });
    cmp.palioIndex += 1;
    saveCampaignProgress();
    nextCampaignPalio();
  }
}

// ASSISTI: gara autonoma (tutti AI, cavallo-focus = rivale in autopilot), niente
// mossa interattiva. Si guarda e si scopre se la rivale vince (Purga).
// Ingaggio automatico (senza UI): ogni contrada ingaggia il fantino più forte che
// il suo budget consente, pagandolo. Usato nell'ASSISTI e come base per le AI.
function campaignAutoHireAll() {
  const taken = {};
  const horses = state.horses.slice().sort((a, b) => contradaBudget(b.id) - contradaBudget(a.id));
  horses.forEach((h) => {
    if (h.jockey) { taken[h.jockey.nick] = h.id; return; }
    const b = contradaBudget(h.id);
    let avail = JOCKEYS.filter((j) => !taken[j.nick]);
    const aff = avail.filter((j) => (j.ingaggio || 0) <= b);
    avail = aff.length ? aff : avail.slice().sort((x, y) => (x.ingaggio || 0) - (y.ingaggio || 0)).slice(0, 1);
    avail.sort((x, y) => jockeyStrength(y) - jockeyStrength(x));
    const pick = avail[Math.min(avail.length - 1, Math.floor(Math.random() * Math.random() * 3))] || JOCKEYS[JOCKEYS.length - 1];
    taken[pick.nick] = h.id;
    h.jockey = pick; h.jkMossa = pick.mossa; h.jkDifesa = pick.difesa; h.jkTerzo = pick.terzo;
    h.reactivity = clamp(0.3 + (pick.mossa - 1) * 0.16, 0.2, 0.98);
    h.stability = clamp(0.28 + (pick.mossa - 1) * 0.16, 0.2, 0.98);
    spendBudget(h.id, pick.ingaggio || 0);
  });
}

// ASSISTI (setup): la tua Contrada NON corre ma c'è la rivale. Crea gli entranti
// e ingaggia i fantini, poi — sopra i cavalli fermi in fila (mode "scelta", niente
// mossa) — dà al Capitano la chance di fare accordi per "parare" la rivale e di
// corromperne il fantino. Solo dopo si rilascia la corsa da guardare.
function campaignSpectateSetup() {
  showScreen(null);
  createEntrants();           // rivale = index 0 (autopilot); niente mossa ancora
  state.mode = "scelta";      // tiene i cavalli fermi: nessuna mossa sotto l'overlay
  const names = shuffleInPlace(TRATTA_HORSE_NAMES.slice());
  state.horses.forEach((h, i) => {
    if (!h.horseName) h.horseName = names[i % names.length] || ("Barbero " + (i + 1));
    // LA FASCIA VA PRESA COL NOME. Qui si assegnava solo il nome del barbero, e
    // nelle accoppiate dell'assisti mancavano brenne, boni e bomboloni: senza
    // quel dato non si capisce chi ha il cavallo buono, che è l'unica cosa che
    // conta per decidere su chi scommettere e chi far parare.
    if (!h.horseTier) {
      const dati = HORSE_ROSTER[h.horseName];
      h.horseTier = (dati && dati.tier) || "bono";
      if (dati) {
        if (h.staminaMax == null) h.staminaMax = dati.stamina;
        if (h.scossoStamina == null && dati.scossoStamina != null) h.scossoStamina = dati.scossoStamina;
      }
    }
    if (h.player) h.autopilot = true;   // il focus (rivale) è guidato dall'AI
  });
  campaignAutoHireAll();      // fantini ingaggiati → fedeltà disponibili per accordi/corruzione
  // ASSISTI: prima FAI VEDERE LE ACCOPPIATE (Contrada · Cavallo · Fantino), poi accordi.
  campaignAccoppiateScreen(() => campaignAccordiScreen(true));
}

// Schermata "le accoppiate" (Contrada · Cavallo/fascia · Fantino) delle 10 in gara.
// Usata in ASSISTI prima degli accordi (così sai chi corre prima di scommettere).
function campaignAccoppiateScreen(next) {
  const cmp = state.campaign;
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker";
    k.textContent = cmp && cmp.rival ? `La tua Contrada non corre · c'è la rivale ${cmp.rival.name}` : "Le accoppiate del Palio";
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Le accoppiate";
    const list = document.createElement("div"); list.className = "cmp-list"; list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin:16px 0;max-height:52vh;overflow:auto;text-align:left";
    state.horses.slice().sort((a, b) => a.name.localeCompare(b.name, "it")).forEach((h) => {
      const isRival = cmp && cmp.rival && h.id === cmp.rival.id;
      const tm = TRATTA_TIERS[h.horseTier];
      const row = document.createElement("div"); row.className = "cmp-row";
      row.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(255,246,225,.06);border:1px solid "
        + (isRival ? "rgba(232,137,111,.6)" : "rgba(255,255,255,.1)") + ";border-radius:10px;padding:8px 12px;font-size:14px";
      const flag = document.createElement("div"); flag.className = "cmp-row-flag"; flag.style.cssText = `width:24px;height:24px;border-radius:4px;background:url('${BANDIERE[h.id]}') center/cover;flex:0 0 auto`;
      const info = document.createElement("div"); info.style.flex = "1";
      const tierBadge = tm ? ` <span style="font-size:10.5px;font-weight:700;color:${tm.fg};background:${tm.bg};border-radius:5px;padding:1px 7px">${tm.label}</span>` : "";
      info.innerHTML = `<b${isRival ? ' style="color:#e8896f"' : ""}>${h.name}</b>${isRival ? " (rivale)" : ""} · ${h.horseName || "—"}${tierBadge} · <span style="color:#f0cb35">${h.jockey ? nickUp(h.jockey.nick) : "—"}</span>`;
      row.append(flag, info); list.appendChild(row);
    });
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Vai agli accordi →";
    b.addEventListener("click", () => { closeCampaignOverlay(); next(); });
    panel.append(k, t, list, b);
  });
}

// ASSISTI (via alla mossa): entranti già creati; parte la MOSSA VERA, guidata
// tutta dall'AI (autopilot incluso). NON si rilascia subito: la mossa gira in
// automatico — chiamate, tondino, tensione, rincorsa — e si rilascia da sola
// quando la rincorsa entra e il campo è allineato (come in una mossa normale,
// solo che qui il cavallo-focus è un'AI da guardare, non tu).
function campaignSpectateRelease() {
  startMossa(true);           // fromTratta=true → NON ricrea gli entranti
  state.horses.forEach((h) => { if (h.player) h.autopilot = true; });
  showMessage("Fai di tutto per non far vincere la rivale!", 2.6, "danger");
}

// ── CORRUZIONE DEI FANTINI ────────────────────────────────────────────────────
// Ogni contrada può corrompere i fantini ALTRUI: pagando (80 × fedeltà) quel
// fantino correrà a FAVORE del corruttore. I soldi SPARISCONO dal gioco (a
// differenza degli accordi, che accreditano chi accetta). Anche il TUO fantino
// può essere corrotto da un'altra: te ne accorgi in gara (effetti = Tappa 3).
// Come si presenta una Contrada nelle schermate di scelta: fantino E cavallo,
// con la fascia del barbero colorata. Senza il cavallo il giocatore non si
// ricorda chi sta pagando — ed è il dato che decide se vale la pena.
function rigaContrada(h) {
  const j = h.jockey;
  const cav = h.horseName || "—";
  const tier = h.horseTier || "";
  // Tutto BIANCO: niente giallo sul nome del cavallo né tinte sulla fascia. La
  // gerarchia la fanno il grassetto e l'opacità, non il colore.
  return `<b>${h.name}</b> · ${j ? nickUp(j.nick) : "—"}`
    + ` <span style="opacity:.55">su</span> <b>${cav}</b>`
    + (tier ? ` <span style="opacity:.75;font-size:12px">${tier}</span>` : "")
    + ` <span style="opacity:.65">· fedeltà ${(j && j.fedelta) || 3}</span>`;
}

function corruptionCost(jockey) { return 80 * ((jockey && jockey.fedelta) || 3); }

function campaignAICorruption() {
  const cmp = state.campaign; if (!cmp) return;
  cmp.corrupted = cmp.corrupted || {};
  const running = state.horses.slice();
  running.forEach((corruptor) => {
    if (corruptor.player && !corruptor.autopilot) return;   // il giocatore corrompe dalla schermata
    if (Math.random() > 0.4) return;                         // non tutte tentano
    const budget = contradaBudget(corruptor.id);
    const targets = running.filter((t) => t.id !== corruptor.id && !cmp.corrupted[t.id] && t.jockey && corruptionCost(t.jockey) <= budget);
    if (!targets.length) return;
    // preferisce i più economici (bassa fedeltà) e, a parità, i fantini più forti.
    targets.sort((a, b) => (a.jockey.fedelta - b.jockey.fedelta) || (jockeyStrength(b.jockey) - jockeyStrength(a.jockey)));
    const target = targets[Math.floor(Math.random() * Math.min(targets.length, 3))];
    spendBudget(corruptor.id, corruptionCost(target.jockey));   // i soldi spariscono
    cmp.corrupted[target.id] = corruptor.id;
  });
}

// PER COSA corrompi un fantino. Stesso costo lineare degli accordi (+50%/finalità extra).
// rivalOnly: appare solo se una rivale è in corsa.
const CORRUZIONE_OBIETTIVI = [
  { id: "resta",   label: "Resta ai canapi" },
  { id: "nerba",   label: "Nerba la mia rivale", rivalOnly: true },
  { id: "perdi",   label: "Non provare a vincere" },
  { id: "buttati", label: "Buttati sulla mia rivale in curva", rivalOnly: true },
  { id: "noMossa", label: "Se vai di rincorsa, non dare la mossa alla mia rivale", rivalOnly: true },
  // "fammi passare" ha senso solo se la mia Contrada corre (in ASSISTI non corro).
  { id: "interno", label: "Para le altre contrade andando interno; se ti sono dietro, fammi passare", playOnly: true },
];
function corruptionCostObj(j, n) { return Math.round(corruptionCost(j) * accordoMult(Math.max(1, n || 1))); }

// ── TRATTATIVA A TUTTO SCHERMO ────────────────────────────────────────────────
// Le checkbox delle finalità si aprivano DENTRO la riga della lista e si
// sovrapponevano al resto (illeggibile da telefono E da PC). Ora scegliere di
// trattare con qualcuno apre una schermata dedicata: caselle grandi, costo
// aggiornato live, "← Indietro" e "Conferma".
function openFinalitaScreen(opts) {
  const old = document.getElementById("finalitaScreen"); if (old) old.remove();
  const ov = document.createElement("div");
  ov.id = "finalitaScreen";
  ov.style.cssText = "position:fixed;inset:0;z-index:82;display:flex;flex-direction:column;align-items:center;"
    + "background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:16px 12px;overflow-y:auto";
  const rows = opts.obiettivi.map((o) =>
    `<label style="display:flex;align-items:center;gap:12px;background:rgba(255,246,225,.06);border:1px solid rgba(240,203,53,.3);border-radius:12px;padding:12px 14px;font-size:15px;line-height:1.35;cursor:pointer;text-align:left">`
    + `<input type="checkbox" data-fin="${o.id}" style="width:22px;height:22px;flex:0 0 auto;accent-color:#f0cb35"><span>${o.label}</span></label>`).join("");
  ov.innerHTML =
    `<div style="width:min(560px,96vw);display:flex;flex-direction:column;gap:9px;margin:auto 0;padding:6px 0">`
    + `<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#f0cb35;opacity:.9;text-align:center">${opts.kicker || "Trattativa"}</div>`
    + `<div style="font-size:clamp(20px,4.5vw,28px);font-weight:800;color:#f7edd6;text-align:center">${opts.titolo}</div>`
    + (opts.sub ? `<div style="opacity:.8;font-size:13px;text-align:center;margin-bottom:2px">${opts.sub}</div>` : "")
    + `<div style="display:flex;flex-direction:column;gap:8px">${rows}</div>`
    + `<div style="display:flex;gap:10px;justify-content:center;margin-top:10px;flex-wrap:wrap">`
    + `<button type="button" id="finBack" style="font:inherit;font-size:15px;font-weight:700;padding:12px 26px;border-radius:10px;border:1px solid rgba(240,203,53,.5);background:transparent;color:#f3e7cf;cursor:pointer">← Indietro</button>`
    + `<button type="button" id="finOk" style="font:inherit;font-size:16px;font-weight:800;padding:12px 34px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Conferma</button>`
    + `</div></div>`;
  document.body.appendChild(ov);
  const ok = ov.querySelector("#finOk");
  const boxes = [...ov.querySelectorAll("input[type=checkbox]")];
  const selNow = () => boxes.filter((b) => b.checked).map((b) => b.dataset.fin);
  const recompute = () => {
    const sel = selNow();
    const c = opts.costoDi(sel);
    ok.textContent = sel.length ? `Conferma · ${c}` : "Conferma";
    const bad = sel.length === 0 || c > opts.budget();
    ok.disabled = bad; ok.style.opacity = bad ? ".5" : "1";
  };
  boxes.forEach((b) => b.addEventListener("change", recompute));
  ov.querySelector("#finBack").addEventListener("click", () => ov.remove());
  ok.addEventListener("click", () => {
    const sel = selNow();
    if (!sel.length) return;
    ov.remove();
    opts.onConferma(sel);
  });
  recompute();
}
// Schermata di corruzione (solo PLAY): i 9 fantini altrui, con costo 80×fedeltà.
function campaignCorruptionScreen() {
  const cmp = state.campaign;
  cmp.corrupted = cmp.corrupted || {};
  // "Altri" = tutti i cavalli in gara tranne la TUA Contrada. In "Assisti" la tua
  // non corre, quindi puoi corrompere anche il fantino della rivale.
  const others = state.horses.filter((h) => h.id !== cmp.contrada.id);
  const render = () => campaignOverlay((panel) => {
    const budget = contradaBudget(cmp.contrada.id);
    const rivalRunning = !!(cmp.rival && others.some((h) => h.id === cmp.rival.id));   // ordini "rivale" solo se corre
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = `Contrada ${cmp.contrada.name} · Budget ${budget} denari`;
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Corruzione dei fantini";
    /* (le finalità si scelgono ora in una schermata dedicata: vedi openFinalitaScreen) */
    const sub = document.createElement("div"); sub.className = "cmp-text"; sub.style.fontSize = "14px";
    sub.innerHTML = "Corrompi un fantino avversario: <b>clicca la cifra</b>, poi scegli <b>cosa deve fare</b>. Costo = 80 × fedeltà, +50% per ogni finalità in più. I soldi spariscono dal gioco.";
    const list = document.createElement("div"); list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin:16px 0;max-height:44vh;overflow:auto";
    others.forEach((h) => {
      const j = h.jockey; if (!j) return;
      const cost = corruptionCost(j);
      const mine = cmp.corrupted[h.id] === cmp.contrada.id;
      const taken = !!cmp.corrupted[h.id];
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(18,13,8,.7);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 12px;font-size:14px";
      const flag = document.createElement("div"); flag.style.cssText = `width:24px;height:24px;border-radius:4px;background:url('${BANDIERE[h.id]}') center/cover;flex:0 0 auto`;
      const info = document.createElement("div"); info.style.flex = "1"; info.style.textAlign = "left";
      info.innerHTML = rigaContrada(h);
      const simpleBtn = (txt, opts) => { const b = document.createElement("button"); b.className = "cmp-btn"; b.style.cssText = "margin:0;font-size:14px;padding:7px 16px;flex:0 0 auto"; b.textContent = txt; b.disabled = true; if (opts && opts.bg) b.style.background = opts.bg; else b.style.opacity = ".5"; return b; };
      let btn;
      if (mine) btn = simpleBtn("Corrotto ✓", { bg: "#2e6b46" });
      else if (taken) btn = simpleBtn("Fuori portata");
      else if (h._corRefused) btn = simpleBtn("Ha rifiutato");
      else if (cost > budget) btn = simpleBtn(`${cost} · no fondi`);
      else {
        // PRIMA la cifra, POI le finalità (cosa deve fare il fantino corrotto).
        const ctrl = document.createElement("div");
        ctrl.style.cssText = "display:flex;flex-direction:column;gap:4px;flex:0 0 auto;align-items:flex-end;min-width:236px";
        const openBtn = document.createElement("button"); openBtn.className = "cmp-btn"; openBtn.style.cssText = "margin:0;font-size:13px;padding:6px 14px"; openBtn.textContent = `Corrompi · ${cost}`;
        // "Nerba/Buttati sulla mia rivale" NON compaiono se stai corrompendo proprio il
        // fantino della rivale (non può attaccare sé stesso).
        const isRival = !!(cmp.rival && h.id === cmp.rival.id);
        const inAssisti = cmp.currentMode === "spectate";
        // Un solo fantino comprato può farti passare interno.
        const internoCorrotti = Object.values(cmp.corruptOrders || {})
          .filter((o) => o && o.indexOf("interno") >= 0).length;
        const obiettivi = CORRUZIONE_OBIETTIVI.filter((o) => (!o.rivalOnly || (rivalRunning && !isRival))
          && !(o.playOnly && inAssisti)
          && !(o.id === "interno" && internoCorrotti >= 1));
        openBtn.addEventListener("click", () => {
          // Trattativa a TUTTO SCHERMO (le checkbox inline si sovrapponevano a tutto).
          // "buttati in curva" = killer: +100. "Resta ai canapi" costa il TRIPLO
          // (aggiunge due volte il costo-base): far restare fermo un avversario
          // alla mossa è la cosa più pesante che si possa comprare.
          const costoDi = (sel) => corruptionCostObj(j, sel.length)
            + (sel.indexOf("buttati") >= 0 ? 100 : 0)
            + (sel.indexOf("resta") >= 0 ? corruptionCost(j) * 2 : 0);
          openFinalitaScreen({
            kicker: "Corruzione",
            titolo: `${h.name} · ${nickUp(j.nick)}`,
            sub: `fedeltà ${j.fedelta || 3} · base ${cost} denari · +50% per ogni finalità in più`,
            obiettivi,
            costoDi,
            budget: () => contradaBudget(cmp.contrada.id),
            onConferma: (sel) => {
              const c = costoDi(sel);
              if (c > contradaBudget(cmp.contrada.id)) return;
              // Il fantino può RIFIUTARE: 40% dei casi dice no (non paghi).
              if (Math.random() < 0.40) { h._corRefused = true; render(); return; }
              spendBudget(cmp.contrada.id, c);
              cmp.corrupted[h.id] = cmp.contrada.id;
              cmp.corruptOrders = cmp.corruptOrders || {}; cmp.corruptOrders[h.id] = sel;
              render();
            },
          });
        });
        ctrl.appendChild(openBtn);
        btn = ctrl;
      }
      row.append(flag, info, btn); list.appendChild(row);
    });
    const spectate = cmp.currentMode === "spectate";
    const go = document.createElement("button"); go.className = "cmp-btn"; go.textContent = spectate ? "Assisti al Palio →" : "Alla Mossa →";
    go.addEventListener("click", () => { closeCampaignOverlay(); campaignAICorruption(); if (spectate) campaignSpectateRelease(); else startMossa(true); });
    panel.append(k, t, sub, list, go);
  });
  render();
}

// ── ACCORDI FRA CONTRADE ──────────────────────────────────────────────────────
// Vengono PRIMA della corruzione (tabellone → accordi → corruzione → mossa). A
// differenza della corruzione (soldi che spariscono), qui i soldi si ACCREDITANO
// a chi accetta. Un accordo = una Contrada pagata (helper) aiuta un'altra
// (beneficiary) ai canapi/alla mossa e ne para la rivale; una Contrada che NON
// corre può pagare una in gara per "parare" la propria rivale. Effetti in gara =
// Tappa 3 (leggono state.campaign.accordi: {helper,beneficiary} o {helper,para}).
function accordoCost(jockey) { return 50 * ((jockey && jockey.fedelta) || 3); }
// PER COSA si paga un accordo. Costo LINEARE: base + 50% del base per ogni finalità
// EXTRA (1→100% · 2→150% · 3→200% · 4→250%…), senza tetto.
// rivalOnly: la voce appare SOLO se una rivale (del beneficiario) è in corsa.
const ACCORDO_OBIETTIVI = [
  { id: "para",   label: "Marca la mia rivale e non farla vincere", rivalOnly: true },
  { id: "nerbaRiv",     label: "Nerba la mia rivale", rivalOnly: true },
  { id: "paraInterno",  label: "Para la mia rivale andando interno", rivalOnly: true },
  { id: "curvaAddosso", label: "Buttati addosso alla mia rivale in curva (costa doppio)", rivalOnly: true },
  { id: "paraRallenta", label: "Para la mia rivale rallentandole davanti", rivalOnly: true },
  { id: "paraCanapi",   label: "Para la mia rivale ai canapi", rivalOnly: true },
  { id: "canapi", label: "Aprimi un varco ai canapi" },
  { id: "spingi", label: "Spingi forte ai canapi per me" },
  { id: "passa",  label: "Lasciami passare e para gli altri in corsa" },
  { id: "mossa",  label: "Se vai di rincorsa, la mossa la dai a me" },
  { id: "interno", label: "Para le altre contrade andando interno; se ti sono dietro, fammi passare" },
];
function accordoMult(n) { return 1 + 0.5 * Math.max(0, (n || 1) - 1); }   // +50% del base per finalità extra
function accordoCostObj(jockey, n) { return Math.round(accordoCost(jockey) * accordoMult(Math.max(1, n || 1))); }
// Costo dato l'ELENCO di finalità: come sopra, ma "curvaAddosso" (buttati in curva)
// costa DOPPIO → aggiunge un intero costo-base.
function accordoCostSel(jockey, sel) {
  let c = accordoCostObj(jockey, (sel || []).length);
  // Finalità "pesanti": costano il DOPPIO (un intero costo-base in più).
  if ((sel || []).indexOf("curvaAddosso") >= 0) c += accordoCost(jockey);
  if ((sel || []).indexOf("interno") >= 0) c += accordoCost(jockey);
  return c;
}

// ══ ASTA DELLA RINCORSA ══════════════════════════════════════════════════════
// Dopo la PRIMA mossa falsa o la prima chiamata fuori, tutti sanno chi è di
// rincorsa: si può improvvisare un accordo con lei anche senza averne fatti prima.
// Si tratta SOLO dal tondino: appena una Contrada viene chiamata ai canapi, per
// lei l'asta è finita. Chi ha la prima posta ha pochissimo tempo per giocarsela.
const ASTA_STEP = 10;                 // rilanci a step di 10 denari
const ASTA_BASE_SENZA_ACCORDO = 10;   // base se la rincorsa non ha già un accordo
const ASTA_BLOCCO_RIVALE = 90;        // costo FISSO per "non darla alla rivale"

function openAstaRincorsa() {
  const cmp = state.campaign;
  if (!cmp || !cmp.active || state.asta) return;
  const rin = state.horses.find((h) => h.isRincorsa);
  if (!rin) return;
  // BASE D'ASTA = l'accordo che la rincorsa ha GIÀ (è quella Contrada a farsi dare
  // la mossa di default). Senza accordi si parte da 10.
  let base = ASTA_BASE_SENZA_ACCORDO, holder = null;
  (cmp.accordi || []).forEach((a) => {
    if (a.helper !== rin.id) return;
    if (a.obiettivi && a.obiettivi.indexOf("canapi") < 0) return;   // "mossa a me" solo se scelto
    const chi = a.beneficiary || a.sponsor || null;
    if (chi && RIVALS[chi] && RIVALS[chi][rin.id]) return;   // non si compra la mossa dalla PROPRIA rivale
    const amt = a.amount || 0;
    if (amt >= base) { base = amt; holder = chi; }
  });
  // TRE Contrade decise a spendere quasi tutto pur di aggiudicarsela; le altre
  // rilanciano poco e di rado, così l'asta non esplode a ogni palio.
  const aiIds = state.horses.filter((h) => !h.isRincorsa && !isHuman(h)).map((h) => h.id);
  state.asta = {
    rincorsaId: rin.id,
    // La mossa GARANTITA al prepagante vale il DOPPIO di quanto ha pagato: l'asta
    // parte già da quella cifra (hai pagato 200 → in asta risulti a 400), quindi
    // per scavalcarti si comincia a rilanciare da 410.
    best: holder ? base * 2 : base,
    bestBidder: holder,
    prepaidHolder: holder,                           // chi ha pagato la mossa PRE-palio (accordo)
    prepaidAmount: holder ? base : 0,                // la sua posta: per scavalcarlo servono > 2× questa
    paid: {},                                        // id → denari prepagati (per il rimborso)
    blocco: {},                                      // id → blocco anti-rivale prepagato
    // STORICO delle offerte: paid[] viene azzerato a ogni sorpasso (il rimborso),
    // quindi da solo non racconta nulla. Qui restano tutte, in ordine di arrivo:
    // è quello che il GIOCATORE DI RINCORSA deve vedere.
    offerte: [],
    decise: shuffleInPlace(aiIds.slice()).slice(0, 3),
    aiCd: 2 + Math.random() * 3,
    chiusa: false,
  };
  /* (rimossa la scritta "ora si sa chi è di rincorsa") */
}

// Rilancio. PREPAGATO: i denari si scalano subito e tornano a chi viene scavalcato.
function astaBid(id, amount) {
  const A = state.asta;
  if (!A || A.chiusa) { if (A) A.rifiuto = "chiusa"; return false; }
  A.rifiuto = null;
  // #2: non puoi PAGARE la tua RIVALE (quando è lei di rincorsa) per la mossa.
  if (A.rincorsaId && RIVALS[id] && RIVALS[id][A.rincorsaId]) { A.rifiuto = "rivale"; return false; }
  // #1: MOSSA GARANTITA a chi l'ha pagata pre-palio → per scavalcarlo serve > 2x la sua posta.
  const protegge = A.prepaidHolder && A.bestBidder === A.prepaidHolder && id !== A.prepaidHolder;
  const soglia = protegge ? 2 * (A.prepaidAmount || 0) : A.best;
  // Il motivo del rifiuto va DICHIARATO: prima qualunque no diventava "non hai
  // abbastanza denari", anche quando i denari c'erano e il problema era un altro.
  if (amount <= soglia) { A.rifiuto = "bassa"; A.sogliaRifiuto = soglia; return false; }
  const disponibile = contradaBudget(id) + (A.paid[id] || 0);
  if (disponibile < amount) { A.rifiuto = "denari"; return false; }
  const prev = A.bestBidder;
  if (prev && A.paid[prev]) { earnBudget(prev, A.paid[prev]); A.paid[prev] = 0; }   // RIMBORSO allo scavalcato
  if (A.paid[id]) { earnBudget(id, A.paid[id]); A.paid[id] = 0; }                   // ritira la propria offerta vecchia
  spendBudget(id, amount);
  A.paid[id] = amount;
  A.best = amount;
  A.bestBidder = id;
  A.offerte.push({ id, amount, blocco: false });
  if (A.offerte.length > 40) A.offerte.shift();
  return true;
}

// Contro-asta: paghi perché la rincorsa NON dia la mossa alla tua rivale. Costo
// fisso, non sale. Vale a meno che la rivale non si aggiudichi comunque l'asta
// principale offrendo più di tutti: in quel caso i denari tornano indietro.
function astaBloccaRivale(id, rivalId) {
  const A = state.asta;
  if (!A || A.chiusa || !rivalId || A.blocco[id]) return false;
  if (contradaBudget(id) < ASTA_BLOCCO_RIVALE) return false;
  spendBudget(id, ASTA_BLOCCO_RIVALE);
  A.blocco[id] = { amount: ASTA_BLOCCO_RIVALE, target: rivalId };
  A.offerte.push({ id, amount: ASTA_BLOCCO_RIVALE, blocco: true, target: rivalId });
  if (A.offerte.length > 40) A.offerte.shift();
  return true;
}

// Le AI trattano, ma solo finché sono nel tondino (non ancora chiamate).
function updateAstaAI(dt) {
  const A = state.asta;
  if (!A || A.chiusa) return;
  A.aiCd -= dt;
  if (A.aiCd > 0) return;
  A.aiCd = 1.4 + Math.random() * 2.4;
  const cand = state.horses.filter((h) => !h.isRincorsa && !isHuman(h) && !h.called && h.id !== A.bestBidder
    && !(RIVALS[h.id] && RIVALS[h.id][A.rincorsaId]));   // #2: chi ha la rincorsa come rivale non tratta la mossa
  if (!cand.length) return;
  const h = cand[Math.floor(Math.random() * cand.length)];
  const decisa = A.decise.includes(h.id);
  const budget = contradaBudget(h.id) + (A.paid[h.id] || 0);
  // Le tre decise arrivano a spendere quasi tutto; le altre si fermano presto.
  const tetto = decisa ? budget * 0.92 : Math.min(budget * 0.30, A.best + 40);
  // #1: se c'è un prepagante protetto, per scavalcarlo il rilancio minimo è > 2× la sua posta.
  const protegge = A.prepaidHolder && A.bestBidder === A.prepaidHolder && h.id !== A.prepaidHolder;
  const next = (protegge ? 2 * (A.prepaidAmount || 0) : A.best) + ASTA_STEP;
  if (next > tetto) return;
  if (!decisa && Math.random() > 0.30) return;
  if (astaBid(h.id, next) && A.bestBidder !== (state.campaign.contrada || {}).id && state.messageTimer <= 0) {
    const c = CONTRADE.find((x) => x.id === h.id);
    showMessage(`${c ? c.name : h.name} offre ${next} alla rincorsa`, 1.2, "danger");
  }
}

// Chiusura: la RINCORSA incassa quello che le altre hanno pagato per la mossa.
// Prima quei soldi venivano scalati ai bidder ma accreditati a NESSUNO (svanivano):
// per questo una Contrada di rincorsa "vinceva soldi" ma restava a 0€. Ora:
//  · l'offerta vincente va alla rincorsa;
//  · i blocchi anti-rivale ONORATI (la rivale NON ha spuntato l'asta) vanno alla
//    rincorsa; quelli non onorati (rivale vince lo stesso) si rimborsano al blocco.
function chiudiAstaRincorsa() {
  const A = state.asta;
  if (!A || A.chiusa) return;
  A.chiusa = true;
  let incasso = 0;
  if (A.bestBidder && A.paid[A.bestBidder]) incasso += A.paid[A.bestBidder];   // la mossa venduta
  Object.keys(A.blocco).forEach((id) => {
    const b = A.blocco[id];
    if (A.bestBidder === b.target) earnBudget(id, b.amount);   // rivale ha spuntato: servizio non reso → rimborso
    else incasso += b.amount;                                  // blocco riuscito: pagato alla rincorsa
  });
  if (incasso > 0 && A.rincorsaId) earnBudget(A.rincorsaId, incasso);
}

// La rincorsa ONORA l'accordo: parte quando il vincitore dell'asta è il MEGLIO
// piazzato e almeno 5 Contrade (fra cui la rivale del vincitore) sono dietro o
// girate. Se non c'è un vincitore, nessun vincolo.
// ── PANNELLO DEL GIOCATORE DI RINCORSA: le offerte che ARRIVANO A LUI ─────────
// Chi è di rincorsa non rilancia: sono gli altri a pagarlo perché dia la mossa
// (o perché NON la dia alla loro rivale). Prima questo pannello non esisteva —
// il giocatore di rincorsa restava all'oscuro di tutta la trattativa che lo
// riguardava. Vista di sola lettura: la mossa la decide comunque lui, entrando.
function refreshAstaUIRincorsa(A, el, mioId) {
  const nome = (id) => (CONTRADE.find((c) => c.id === id) || {}).name || id;
  // Ultime offerte, dalla più recente. Una riga per Contrada: di ciascuna si
  // mostra solo l'offerta più alta, altrimenti a furia di rilanci la lista
  // diventa un muro illeggibile.
  const migliori = new Map();
  (A.offerte || []).forEach((o) => {
    if (o.blocco) { migliori.set("B:" + o.id, o); return; }
    const p = migliori.get(o.id);
    if (!p || o.amount > p.amount) migliori.set(o.id, o);
  });
  const ph = (window.innerWidth || 999) < 640;                       // #2: più piccolo su telefono
  const righe = [...migliori.values()].sort((a, b) => b.amount - a.amount).slice(0, ph ? 4 : 6);
  const sig = `R|${A.best}|${A.bestBidder}|${(A.offerte || []).length}|${ph}`;
  if (!el) {
    el = document.createElement("div");
    el.id = "astaPanel";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);z-index:120;"
      + `${ph ? "top:8px;" : "bottom:22px;"}padding:${ph ? "6px 9px" : "10px 16px"};font-size:${ph ? 12 : 14}px;`
      + `gap:${ph ? 3 : 6}px;min-width:${ph ? 190 : 280}px;max-width:94vw;`
      + "background:rgba(20,14,8,.9);border:1px solid rgba(240,203,53,.55);border-radius:12px;"
      + "color:#f3e7cf;font-family:inherit;text-align:center;"
      + "display:flex;flex-direction:column;align-items:stretch";
    document.body.appendChild(el);
  }
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  if (!righe.length) {
    el.innerHTML = '<div style="opacity:.85">Sei di <b style="color:#f0cb35">rincorsa</b>'
      + ' &nbsp;·&nbsp; <span style="opacity:.75">nessuna offerta</span></div>';
    return;
  }
  el.innerHTML =
    `<div style="opacity:.85;margin-bottom:2px;font-size:${ph ? 12 : 13}px">Sei di <b style="color:#f0cb35">rincorsa</b> · ti offrono la mossa</div>`
    + righe.map((o) => {
      const vince = !o.blocco && A.bestBidder === o.id;
      const testo = o.blocco
        ? `${nome(o.id)}: non a ${nome(o.target)}`
        : `${nome(o.id)}`;
      return `<div style="display:flex;justify-content:space-between;gap:${ph ? 8 : 16}px;padding:${ph ? "2px 6px" : "3px 8px"};border-radius:6px;`
        + `background:${vince ? "rgba(46,125,79,.55)" : "rgba(255,255,255,.05)"}">`
        + `<span>${vince ? "★ " : o.blocco ? "✋ " : ""}${testo}</span>`
        + `<b style="color:#f0cb35">${o.amount}</b></div>`;
    }).join("")
    + `<div style="opacity:.7;font-size:${ph ? 10 : 12}px;margin-top:2px">Decidi tu quando entrare</div>`;
}

// Pannello di trattativa del GIOCATORE. Compare solo mentre è nel tondino: appena
// viene chiamato ai canapi sparisce, e per lui l'asta è chiusa.
function refreshAstaUI() {
  const A = state.asta;
  const cmp = state.campaign;
  const me = getPlayer();
  const mioId = cmp && cmp.contrada ? cmp.contrada.id : null;
  const attiva = !!(A && !A.chiusa && me && mioId && state.mode === "mossa" && isHuman(me));
  // #C: da TELEFONO durante la mossa nascondi i box "Posizione" e "Giro" (inutili lì)
  // → lo spazio in alto va ai pannelli dell'asta (spostati in alto su mobile).
  {
    const hideTop = state.mode === "mossa" && (window.innerWidth || 999) < 640;
    const tl = document.querySelector(".hud-top-left");
    const tr = document.querySelector(".hud-top-right");
    if (tl) tl.style.display = hideTop ? "none" : "";
    if (tr) tr.style.display = hideTop ? "none" : "";
  }
  // DUE viste diverse. Da OFFERENTE: sei nel tondino e rilanci (appena vieni
  // chiamato ai canapi, me.called, il pannello sparisce). Da RINCORSA: non
  // rilanci — le offerte arrivano A TE, e le devi vedere per decidere a chi
  // conviene dare la mossa.
  const ioRincorsa = attiva && me.isRincorsa;
  const visibile = attiva && (ioRincorsa || (!me.called));
  let el = document.getElementById("astaPanel");
  if (!visibile) { if (el) el.remove(); return; }
  if (ioRincorsa) { refreshAstaUIRincorsa(A, el, mioId); return; }
  if (!el) {
    const phc = (window.innerWidth || 999) < 640;
    el = document.createElement("div");
    el.id = "astaPanel";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);z-index:120;"
      + `${phc ? "top:8px;" : "bottom:22px;"}padding:${phc ? "6px 10px" : "10px 16px"};gap:${phc ? 6 : 8}px;`
      + "background:rgba(20,14,8,.9);border:1px solid rgba(240,203,53,.55);border-radius:12px;"
      + "color:#f3e7cf;font-family:inherit;text-align:center;max-width:94vw;"
      + "display:flex;flex-direction:column;align-items:center;pointer-events:auto";
    document.body.appendChild(el);
  }
  const rin = state.horses.find((h) => h.id === A.rincorsaId);
  const rinNome = rin ? rin.name : "la rincorsa";
  const inTesta = A.bestBidder === mioId;
  const rivaleERincorsa = !!(A.rincorsaId && RIVALS[mioId] && RIVALS[mioId][A.rincorsaId]);   // #2: non compri la mossa dalla tua rivale
  const proteggePrepagante = !!(A.prepaidHolder && A.bestBidder === A.prepaidHolder && mioId !== A.prepaidHolder);   // #1
  const floorBid = proteggePrepagante ? 2 * (A.prepaidAmount || 0) : A.best;   // soglia da scavalcare
  const rilanci = [10, 50, 100];   // 3 tasti: +10 / +50 / +100, MOSTRATI come cifra assoluta
  const rivId = cmp.rival ? cmp.rival.id : null;
  const rivInGara = rivId && state.horses.some((h) => h.id === rivId && !h.isRincorsa);
  const bloccoFatto = !!A.blocco[mioId];
  const chi = A.bestBidder ? (CONTRADE.find((c) => c.id === A.bestBidder) || {}).name : null;

  // IMPORTANTE: questa funzione gira a ogni frame. Riscrivere innerHTML ogni volta
  // distruggeva e ricreava i pulsanti 60 volte al secondo, e il click del mouse non
  // arrivava mai a completarsi (il bottone spariva fra il premi e il rilascia).
  // Si ridisegna SOLO quando cambia davvero qualcosa.
  // Il tuo budget: durante la mossa l'indicatore in alto a destra è nascosto,
  // quindi senza questo offriresti alla cieca.
  const mieiDenari = contradaBudget(mioId);
  const sig = `${A.best}|${A.bestBidder}|${bloccoFatto}|${rivInGara}|${inTesta}|${mieiDenari}|${floorBid}|${rivaleERincorsa}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  const ph = (window.innerWidth || 999) < 640;                       // #2: più compatto su telefono
  const bs = ph ? "padding:7px 9px;font-size:13px" : "padding:8px 14px;font-size:14px";
  const azione = inTesta
    ? '<div id="astaLead" style="background:#2e7d4f;border-radius:8px;padding:6px 12px;font-weight:800">✓ La rincorsa ti darà la mossa</div>'
    : rivaleERincorsa
      ? '<div style="opacity:.9;font-size:13px;color:#e8896f;font-weight:700">Non puoi comprare la mossa dalla tua rivale</div>'
      : `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">`
        + rilanci.map((inc) => `<button class="astaBidBtn" data-inc="${inc}" type="button" style="font:inherit;cursor:pointer;border:none;border-radius:8px;${bs};background:#f0cb35;color:#1a1206;font-weight:800">Offri ${floorBid + inc}</button>`).join("")
        + `</div>`
        + (proteggePrepagante ? '<div style="opacity:.75;font-size:11px">mossa già pagata: serve il doppio</div>' : "");
  el.innerHTML =
    `<div style="opacity:.85;font-size:${ph ? 12 : 14}px">Tratti con <b style="color:#f0cb35">${rinNome}</b> &nbsp;·&nbsp; hai <b style="color:#f0cb35">${mieiDenari}</b> denari</div>`
    + (inTesta || rivaleERincorsa ? "" : `<div style="font-size:${ph ? 13 : 15}px;font-weight:700">L'ultima offerta era <b style="color:#f0cb35">${A.best}</b>${chi ? ` (${chi})` : ""}, quanto offri?</div>`)
    + azione
    + (rivInGara && !bloccoFatto
      ? `<button id="astaBlockBtn" type="button" style="font:inherit;cursor:pointer;border:1px solid rgba(240,203,53,.5);border-radius:8px;${bs};background:rgba(60,40,20,.9);color:#f3e7cf">Non darla a ${cmp.rival.name} · ${ASTA_BLOCCO_RIVALE}</button>`
      : "")
    + (bloccoFatto ? '<div style="opacity:.8;font-size:12px">Hai pagato perché non la dia alla rivale</div>' : "");

  el.querySelectorAll(".astaBidBtn").forEach((b) => b.addEventListener("click", () => {
    const inc = Number(b.dataset.inc);
    // L'importo si ricalcola ADESSO sulla base corrente, non su quella di quando il
    // pannello e' stato disegnato: fra il disegno e il click una Contrada puo' aver
    // rilanciato, e prima in quel caso l'offerta partiva gia' superata — veniva
    // rifiutata e il gioco diceva "non hai abbastanza denari", che era falso.
    const A2 = state.asta;
    if (!A2 || A2.chiusa) return;
    const prot = !!(A2.prepaidHolder && A2.bestBidder === A2.prepaidHolder && mioId !== A2.prepaidHolder);
    const base = prot ? 2 * (A2.prepaidAmount || 0) : A2.best;
    // Se nel frattempo la base e' salita, NON si offre alla cieca: si avverte, il
    // pannello si aggiorna e il giocatore vede la cifra nuova prima di decidere.
    if (base !== floorBid) {
      showMessage(`Hanno rilanciato: ora l'ultima offerta e' ${A2.best}`, 1.6, "danger");
      return;
    }
    if (astaBid(mioId, base + inc)) {
      showMessage(`Hai offerto ${base + inc} alla rincorsa`, 1.2, "good");
      return;
    }
    const perche = {
      denari: "Non hai abbastanza denari",
      bassa: `Offerta troppo bassa: serve piu' di ${A2.sogliaRifiuto || A2.best}`,
      rivale: "Non puoi comprare la mossa dalla tua rivale",
      chiusa: "L'asta e' chiusa",
    }[A2.rifiuto] || "Offerta non accettata";
    showMessage(perche, 1.6, "danger");
  }));
  const blk = document.getElementById("astaBlockBtn");
  if (blk) blk.addEventListener("click", () => {
    if (!astaBloccaRivale(mioId, rivId)) showMessage("Non hai abbastanza denari", 1.2, "danger");
  });
}

function astaFavorevoleAlVincitore() {
  const A = state.asta;
  if (!A || !A.bestBidder) return true;
  const win = state.horses.find((h) => h.id === A.bestBidder);
  if (!win || !win.called || win.entering) return false;
  const schierati = state.horses.filter((h) => !h.isRincorsa && h.called && !h.entering);
  const punteggio = (h) => (h.mossaProgress || 0) - Math.abs(h.mossaTurn || 0) * 2.2;
  const sWin = punteggio(win);
  if (schierati.some((o) => o !== win && punteggio(o) > sWin)) return false;   // non è il meglio piazzato
  const male = schierati.filter((o) => o !== win
    && ((o.mossaProgress || 0) < (win.mossaProgress || 0) - 1.2 || Math.abs(o.mossaTurn || 0) > 0.5));
  if (male.length < 5) return false;
  const rivId = topRivalId(win.id);
  if (rivId && schierati.some((o) => o.id === rivId) && !male.some((o) => o.id === rivId)) return false;
  return true;
}

// Soprannome del fantino come si MOSTRA: iniziale maiuscola. I nick veri restano
// minuscoli dove servono da chiave (albo delle vittorie, override statistiche):
// cambiarli spezzerebbe lo storico delle vittorie già registrate.
function nickUp(n) { const t = String(n || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
// Rivale principale di una Contrada (intensità massima in RIVALS), per la "para".
function topRivalId(id) {
  const m = RIVALS[id]; if (!m) return null;
  let best = null, v = -1;
  Object.keys(m).forEach((k) => { if (m[k] > v) { v = m[k]; best = k; } });
  return best;
}
// Rivale principale di una Contrada che è ANCHE in gara (per gli aiuti in corsa).
function topRunningRivalId(id) {
  const m = RIVALS[id]; if (!m) return null;
  let best = null, v = -1;
  Object.keys(m).forEach((k) => { if (m[k] > v && state.horses.some((o) => o.id === k)) { v = m[k]; best = k; } });
  return best;
}
// La CONTRADA FAVORITA in gara (la più forte: fascia + stamina + fantino), escluso
// un id (di solito il giocatore). È chi gli aiuti/corrotti vanno a "parare".
function favoriteRunningId(excludeId) {
  let best = null, bs = -1;
  const tierW = { bombolone: 3, bono: 2, brenna: 1 };
  state.horses.forEach((h) => {
    if (h.id === excludeId) return;
    const s = (tierW[h.horseTier] || 2) * 12 + (h.staminaMax || h.stamina || 80) * 0.12 + (h.jockey ? jockeyStrength(h.jockey) : 6);
    if (s > bs) { bs = s; best = h; }
  });
  return best ? best.id : null;
}

// Le PRIME N favorite in gara (stessa forza di favoriteRunningId), escludendo gli
// id passati (es. chi ha pagato la corruzione: al suo padrone non va mai addosso).
function topFavouritesRunning(excludeIds, n) {
  const skip = new Set((excludeIds || []).filter(Boolean));
  const tierW = { bombolone: 3, bono: 2, brenna: 1 };
  return state.horses
    .filter((h) => !skip.has(h.id) && !h.isRincorsa)
    .map((h) => ({ id: h.id, s: (tierW[h.horseTier] || 2) * 12 + (h.staminaMax || h.stamina || 80) * 0.12 + (h.jockey ? jockeyStrength(h.jockey) : 6) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.id);
}

// Proposte in ARRIVO al giocatore (solo PLAY). Si paga SOLO a palio vinto, quindi
// niente vincolo di budget al proponente → ne arrivano di più (almeno una se il
// giocatore corre e c'è chi può proporre).
function campaignBuildIncomingAccordi(cmp) {
  const player = getPlayer(); if (!player) return [];
  const runningSet = new Set(state.horses.map((h) => h.id));
  const base = 50 * ((player.jockey && player.jockey.fedelta) || 3);
  const pool = [];
  // Le proposte ricevute usano le STESSE finalità che il giocatore può proporre.
  const AIUTO_OBIETTIVI = ["canapi", "spingi", "passa", "interno"];   // "vinci" rimossa
  const pickObiettivi = () => shuffleInPlace(AIUTO_OBIETTIVI.slice()).slice(0, 1 + Math.floor(Math.random() * 2));
  state.horses.forEach((h) => {
    if (h.id === player.id || (cmp.rival && h.id === cmp.rival.id)) return;   // né te, né la nemica
    pool.push({ type: "aiuto", from: h.id, fromName: h.name, obiettivi: pickObiettivi(), importo: Math.round(base * (1 + Math.random())) });
  });
  CONTRADE.forEach((c) => {
    if (runningSet.has(c.id) || c.id === cmp.contrada.id) return;   // solo chi non corre (non tu)
    const r = topRivalId(c.id);
    if (!r || !runningSet.has(r) || r === player.id) return;        // la sua rivale corre (e non sei tu)
    const rc = CONTRADE.find((x) => x.id === r);
    pool.push({ type: "para", from: c.id, fromName: c.name, target: r, targetName: rc ? rc.name : r, importo: Math.round(base * (1 + Math.random() * 1.3)) });
  });
  shuffleInPlace(pool);
  return pool.slice(0, 6);
}

// Accordi fra le AI (nessuna UI). Chiamata DOPO le scelte del giocatore. Niente
// pagamento ora: si registra la PROMESSA (amount), pagata solo a palio vinto in
// campaignRecordResult.
// VOCI DI PIAZZA (mormorii): 3 patti "di colore" fra le altre Contrade, in stile
// voce di piazza. Solo cosmetici (danno atmosfera), Contrade diverse dalla tua.
function buildMormorii(cmp) {
  const pool = state.horses.filter((h) => h.id !== cmp.contrada.id).map((h) => h.name);
  const templates = [
    (a, b) => `Si mormora un patto tra ${a} e ${b}…`,
    (a, b) => `${a} e ${b} si sono messe d'accordo`,
    (a, b) => `${a} e ${b}: mano nella mano alla mossa`,
  ];
  const out = [];
  for (let i = 0; i < 3 && pool.length >= 2; i += 1) {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    out.push(templates[i % templates.length](a, b));
  }
  return out;
}
// ── IL PARTITO DEL FAVORITO ────────────────────────────────────────────────────
// A ogni palio una Contrada favorita (MAI il giocatore) arriva alla mossa col suo
// partito già fatto: da 3 a 5 fra Contrade alleate e fantini comprati. Quelle
// Contrade sono già schierate — al giocatore diranno di no quasi sempre — e quei
// fantini non sono più acquistabili. È il contraltare della fazione che il
// giocatore si costruisce pagando: qualcuno, in Piazza, l'ha fatto prima di lui.
function campaignBuildFazione(cmp) {
  if (!cmp || !state.horses || !state.horses.length) return null;
  const myId = cmp.contrada && cmp.contrada.id;
  const capoId = favoriteRunningId(myId);          // il favorito in gara, mai il giocatore
  if (!capoId || capoId === myId) return null;
  cmp.accordi = cmp.accordi || [];
  cmp.corrupted = cmp.corrupted || {};
  cmp.corruptOrders = cmp.corruptOrders || {};
  const quanti = 3 + Math.floor(Math.random() * 3);   // 3..5 fra alleati e fantini
  const membri = [];
  const cand = shuffleInPlace(state.horses.filter((h) => h.id !== capoId && h.id !== myId
    && !h.isRincorsa && h.jockey && rivalIntensity(capoId, h.id) === 0));
  for (const h of cand) {
    if (membri.length >= quanti) break;
    if (Math.random() < 0.68) {
      // Contrada alleata del capo (accordo già stretto).
      cmp.accordi.push({ helper: h.id, beneficiary: capoId, amount: accordoCost(h.jockey), fazione: true });
    } else {
      // Fantino già comprato dal capo: per il giocatore risulta "fuori portata".
      cmp.corrupted[h.id] = capoId;
      cmp.corruptOrders[h.id] = ["perdi"];
    }
    membri.push(h.id);
  }
  cmp.fazione = { capo: capoId, membri };
  return cmp.fazione;
}
// Questa Contrada è già schierata col favorito? (allora al giocatore dice di no)
function inFazioneAvversaria(cmp, id) {
  return !!(cmp && cmp.fazione && cmp.fazione.membri && cmp.fazione.membri.indexOf(id) >= 0);
}
function campaignAIAccordi() {
  const cmp = state.campaign; if (!cmp) return;
  cmp.accordi = cmp.accordi || [];
  const running = state.horses.slice();
  const runningSet = new Set(running.map((h) => h.id));
  const isHelper = (id) => cmp.accordi.some((a) => a.helper === id);
  const isBeneficiary = (id) => cmp.accordi.some((a) => a.beneficiary === id);
  // 1) Aiuti fra Contrade in gara (il giocatore in gara decide da sé).
  running.forEach((ben) => {
    if (ben.player && !ben.autopilot) return;
    if (isBeneficiary(ben.id) || Math.random() > 0.4) return;
    const cand = running.filter((h) => h.id !== ben.id && h.jockey
      && rivalIntensity(ben.id, h.id) === 0 && !isHelper(h.id));
    if (!cand.length) return;
    const helper = cand[Math.floor(Math.random() * cand.length)];
    cmp.accordi.push({ helper: helper.id, beneficiary: ben.id, amount: accordoCost(helper.jockey) });
  });
  // 2) "Para" da chi NON corre verso chi corre (il giocatore non-in-gara decide a UI).
  CONTRADE.forEach((c) => {
    if (runningSet.has(c.id) || (cmp.contrada && c.id === cmp.contrada.id)) return;
    if (Math.random() > 0.3) return;
    const r = topRivalId(c.id);
    if (!r || !runningSet.has(r)) return;
    const cand = running.filter((h) => h.id !== r && h.jockey && !isHelper(h.id));
    if (!cand.length) return;
    const helper = cand[Math.floor(Math.random() * cand.length)];
    cmp.accordi.push({ helper: helper.id, para: r, sponsor: c.id, amount: accordoCost(helper.jockey) });
  });
}

// Schermata ACCORDI. spectate=false (PLAY): proposte ricevute + manda proposte
// alle Contrade in gara. spectate=true (ASSISTI, la tua non corre): paghi una
// Contrada in gara per "parare" la rivale.
function campaignAccordiScreen(spectate) {
  const cmp = state.campaign;
  cmp.accordi = cmp.accordi || [];
  if (cmp.fazione == null) campaignBuildFazione(cmp);   // il favorito ha già il suo partito
  if (!spectate && cmp.incomingAccordi == null) cmp.incomingAccordi = campaignBuildIncomingAccordi(cmp);
  const myId = cmp.contrada.id;
  const render = () => campaignOverlay((panel) => {
    panel.style.maxWidth = spectate ? "640px" : "940px";
    // Il budget SCENDE davvero a ogni proposta mandata (i soldi vengono scalati
    // subito; se poi non vinci ti vengono riaccreditati a fine palio).
    const budget = contradaBudget(myId);
    const rivalRunning = !!(cmp.rival && state.horses.some((h) => h.id === cmp.rival.id));  // "marca la rivale" solo se corre
    if (!cmp.mormorii) cmp.mormorii = buildMormorii(cmp);   // voci di piazza (3 patti fra le altre)
    // Proposte RICEVUTE accettate: max 2 per palio, e non puoi accettare la rivale
    // di una che hai già accettato.
    const accepted = (cmp.incomingAccordi || []).filter((x) => x.decided === "yes");
    const acceptedFroms = accepted.map((x) => x.from);
    const k = document.createElement("p"); k.className = "cmp-kicker";
    k.textContent = `Contrada ${cmp.contrada.name} · Budget ${budget} denari`
      + (accepted.length ? ` · accordi ${accepted.length}/3` : "");
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Gli accordi";
    const sub = document.createElement("div"); sub.className = "cmp-text"; sub.style.fontSize = "14px";
    sub.innerHTML = spectate
      ? `La tua Contrada non corre: paga una Contrada in gara per "parare" la rivale <b>${cmp.rival.name}</b>. <b>Si paga solo se la rivale NON vince.</b>`
      : `Paga una Contrada: <b>clicca la cifra</b>, poi scegli <b>per cosa</b> — ogni finalità in più costa +50% del base. <b>Si paga solo a palio vinto.</b>`;
    // Voci di piazza (3 patti fra le altre Contrade, stile mormorii).
    const voci = document.createElement("div");
    voci.style.cssText = "margin-top:8px;text-align:left;font-size:12.5px;opacity:.75;font-style:italic;line-height:1.55;border-left:3px solid rgba(240,203,53,.35);padding:2px 0 2px 10px";
    voci.innerHTML = "<div style='font-style:normal;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#b7ad96;margin-bottom:3px'>Voci di piazza</div>"
      + (cmp.mormorii || []).map((m) => `• ${m}`).join("<br>");

    const mkRow = (flagId, html, btn) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(255,246,225,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 12px;font-size:14px";
      const flag = document.createElement("div"); flag.style.cssText = `width:24px;height:24px;border-radius:4px;background:url('${BANDIERE[flagId]}') center/cover;flex:0 0 auto`;
      const info = document.createElement("div"); info.style.flex = "1"; info.style.textAlign = "left"; info.innerHTML = html;
      row.append(flag, info, btn); return row;
    };
    const mkBtn = (label) => { const b = document.createElement("button"); b.className = "cmp-btn"; b.style.cssText = "margin:0;font-size:13px;padding:6px 12px;flex:0 0 auto"; b.textContent = label; return b; };
    const disabledBtn = (label, color) => { const b = mkBtn(label); b.disabled = true; if (color) b.style.background = color; else b.style.opacity = ".5"; return b; };
    const boxCol = (title) => {
      const wrap = document.createElement("div"); wrap.style.flex = "1"; wrap.style.minWidth = "0";
      const l = document.createElement("div"); l.style.cssText = "font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#b7ad96;margin:0 0 8px;text-align:left"; l.textContent = title;
      const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow:auto";
      wrap.append(l, box); return { wrap, box };
    };

    const cols = document.createElement("div");
    cols.className = "cmp-cols";
    cols.style.cssText = "display:flex;gap:16px;margin-top:14px;align-items:flex-start;text-align:left" + (spectate ? ";justify-content:center" : "");

    // ── COLONNA SINISTRA: PROPOSTE RICEVUTE (solo PLAY) ──────────────────────
    if (!spectate) {
      const { wrap, box } = boxCol("Proposte ricevute");
      if (!cmp.incomingAccordi.length) { const e = document.createElement("div"); e.style.cssText = "opacity:.55;font-size:13px;padding:12px"; e.textContent = "Nessuna proposta stavolta."; box.appendChild(e); }
      cmp.incomingAccordi.forEach((p) => {
        const finLabels = (p.obiettivi || []).map((id) => (ACCORDO_OBIETTIVI.find((o) => o.id === id) || {}).label).filter(Boolean).join(" · ");
        const html = p.type === "aiuto"
          ? `<b>${p.fromName}</b> · ti dà <b>${p.importo}</b> se vince${finLabels ? `<div style="opacity:.7;font-size:12px;margin-top:2px">Vuole: ${finLabels}</div>` : ""}`
          : `<b>${p.fromName}</b> <span style="opacity:.6">(non corre)</span> · <b>${p.importo}</b> <span style="opacity:.7">se pari la ${p.targetName}</span>`;
        let btn;
        if (p.decided === "yes") btn = disabledBtn("Accettato ✓", "#2e6b46");
        else if (p.decided === "no") btn = disabledBtn("Rifiutato");
        else if (accepted.length >= 3) btn = disabledBtn("Max 3 accordi");                          // max 3 proposte per palio
        else if (acceptedFroms.some((f) => rivalIntensity(p.from, f) > 0)) btn = disabledBtn("Rivale già alleata");  // niente la rivale di una già accettata
        else {
          const wrap2 = document.createElement("div"); wrap2.style.cssText = "display:flex;gap:6px;flex:0 0 auto";
          const ok = mkBtn("Accetta"); ok.style.background = "#2e6b46";
          ok.addEventListener("click", () => {
            cmp.accordi.push(p.type === "aiuto"
              ? { helper: myId, beneficiary: p.from, amount: p.importo, obiettivi: p.obiettivi }
              : { helper: myId, para: p.target, sponsor: p.from, amount: p.importo });
            p.decided = "yes"; render();
          });
          const no = mkBtn("Rifiuta"); no.style.background = "#7a2a2a";
          no.addEventListener("click", () => { p.decided = "no"; render(); });
          wrap2.append(ok, no); btn = wrap2;
        }
        box.appendChild(mkRow(p.from, html, btn));
      });
      cols.appendChild(wrap);
    }

    // ── COLONNA DESTRA: MANDA UNA PROPOSTA (PLAY) / PARA LA RIVALE (ASSISTI) ──
    {
      const { wrap, box } = boxCol(spectate ? "Paga per parare la rivale" : "Manda una proposta");
      if (spectate) wrap.style.maxWidth = "560px";
      state.horses.forEach((h) => {
        if (h.id === myId || (cmp.rival && h.id === cmp.rival.id)) return;   // non a te, non alla nemica/rivale
        const j = h.jockey; if (!j) return;
        const cost = accordoCost(j);
        const schierata = inFazioneAvversaria(cmp, h.id);
        const html = rigaContrada(h)
          + (schierata ? ` <span style="font-size:11px;color:#e8896f">· ha già preso accordi…</span>` : "");
        const allied = cmp.accordi.some((a) => a.helper === h.id && (spectate ? a.para === cmp.rival.id : a.beneficiary === myId));
        let btn;
        if (allied) btn = disabledBtn(spectate ? "Ingaggiata ✓" : "Alleata ✓", "#2e6b46");
        else if (h._accRefused) btn = disabledBtn("Ha rifiutato");
        else if (cost > budget) btn = disabledBtn(`${cost} · no fondi`);   // non puoi promettere più di quanto hai
        else if (spectate) {
          btn = mkBtn(`Para · ${cost}`);
          btn.addEventListener("click", () => {
            // ASSISTI: si sceglie COSA deve fare alla rivale, come in modalità gioco
            // (prima c'era solo un generico "para", senza finalità).
            const obiettiviRiv = ACCORDO_OBIETTIVI.filter((o) => o.rivalOnly);
            openFinalitaScreen({
              kicker: `Paga per parare ${cmp.rival.name}`,
              titolo: `${h.name} · ${nickUp(j.nick)}`,
              sub: `fedeltà ${j.fedelta || 3} · base ${cost} denari · +50% per ogni finalità in più · si paga solo se la rivale NON vince`,
              obiettivi: obiettiviRiv,
              costoDi: (sel) => accordoCostSel(j, sel),
              budget: () => contradaBudget(myId),
              onConferma: (sel) => {
                const c = accordoCostSel(j, sel);
                if (c > contradaBudget(myId)) return;
                // Parare = rinunciare a vincere: chi monta un BOMBOLONE rifiuta spesso (75%).
                if (h.horseTier === "bombolone" && Math.random() >= 0.25) { h._accRefused = true; render(); return; }
                // Già schierata col favorito: rifiuta solo se le chiedi di parare PROPRIO
                // il suo capo; parare un'altra Contrada non le costa nulla e accetta.
                if (inFazioneAvversaria(cmp, h.id)) {
                  const capoId = cmp.fazione && cmp.fazione.capo;
                  const conflitto = !cmp.rival || cmp.rival.id === capoId;
                  if (conflitto && Math.random() >= 0.25) { h._accRefused = true; render(); return; }
                }
                spendBudget(myId, c);
                cmp.accordi.push({ helper: h.id, para: cmp.rival.id, sponsor: myId, amount: c, prepaid: true, obiettivi: sel });
                render();
              },
            });
          });
        } else {
          // PLAY: PRIMA si clicca la CIFRA, POI compaiono le finalità da spuntare.
          const ctrl = document.createElement("div");
          ctrl.className = "cmp-ctrl";
          ctrl.style.cssText = "display:flex;flex-direction:column;gap:4px;flex:0 0 auto;align-items:flex-end;min-width:240px";
          const openBtn = mkBtn(`Proponi · ${cost}`);
          const conFin = (id) => (cmp.accordi || []).filter((a) => a.beneficiary === myId
            && a.obiettivi && a.obiettivi.indexOf(id) >= 0).length;
          const internoPresi = conFin("interno");
          const passaPresi = conFin("passa");
          const obiettivi = ACCORDO_OBIETTIVI.filter((o) => (!o.rivalOnly || rivalRunning)   // "marca la rivale" solo se corre
            && !(o.id === "interno" && internoPresi >= 1)                                    // max 1 Contrada a pararti andando interno
            && !(o.id === "passa" && passaPresi >= 1));                                      // max 1 Contrada a lasciarti passare
          openBtn.addEventListener("click", () => {
            // Trattativa a TUTTO SCHERMO (le checkbox inline si sovrapponevano a tutto).
            openFinalitaScreen({
              kicker: "Manda una proposta",
              titolo: `${h.name} · ${nickUp(j.nick)}`,
              sub: `fedeltà ${j.fedelta || 3} · base ${cost} denari · +50% per ogni finalità in più · si paga solo a palio vinto`,
              obiettivi,
              costoDi: (sel) => accordoCostSel(j, sel),
              budget: () => contradaBudget(myId),
              onConferma: (sel) => {
                const c = accordoCostSel(j, sel);
                if (c > contradaBudget(myId)) return;
                // RIFIUTO: base 30%. Ma chi monta un BOMBOLONE dice spesso NO alle
                // proposte che lo fanno PERDERE (lasciami vincere/passare, para, ecc.):
                // con quel cavallo vuole correre per vincere → accetta solo il 25%.
                const PERDENTI = ["vinci", "passa", "interno", "para", "paraInterno", "curvaAddosso", "paraRallenta", "paraCanapi"];
                const perdente = sel.some((id) => PERDENTI.indexOf(id) >= 0);
                // Si dice di sì più facilmente: in Piazza i denari parlano, e il no
                // secco rendeva quasi inutile spendere. (Era 0.7 / 0.25.)
                let pAccetta = (h.horseTier === "bombolone" && perdente) ? 0.40 : 0.85;
                // GIÀ SCHIERATA col favorito. Non è un no automatico: dipende da cosa chiedi.
                //  · se chiedi SOLO di parare la tua rivale, e la tua rivale NON è il capo con
                //    cui si è schierata, non le costa nulla — anzi fa un favore al suo partito:
                //    accetta volentieri;
                //  · se invece le chiedi qualcosa che aiuta TE a vincere (o di parare proprio
                //    il suo capo), è in conflitto col patto che ha già preso: quasi sempre no,
                //    ma qualcuna si lascia comprare lo stesso.
                if (inFazioneAvversaria(cmp, h.id)) {
                  const ANTI_RIVALE = ["para", "nerbaRiv", "paraInterno", "curvaAddosso", "paraRallenta", "paraCanapi"];
                  const soloAntiRivale = sel.length > 0 && sel.every((id) => ANTI_RIVALE.indexOf(id) >= 0);
                  const rivaleId = cmp.rival && cmp.rival.id;
                  const capoId = cmp.fazione && cmp.fazione.capo;
                  if (soloAntiRivale && rivaleId && rivaleId !== capoId) pAccetta = Math.max(pAccetta, 0.88);
                  else pAccetta = Math.min(pAccetta, 0.35);
                }
                if (Math.random() < pAccetta) { spendBudget(myId, c); cmp.accordi.push({ helper: h.id, beneficiary: myId, amount: c, prepaid: true, obiettivi: sel }); }
                else h._accRefused = true;
                render();
              },
            });
          });
          ctrl.appendChild(openBtn);
          btn = ctrl;
        }
        box.appendChild(mkRow(h.id, html, btn));
      });
      cols.appendChild(wrap);
    }

    const go = document.createElement("button"); go.className = "cmp-btn"; go.textContent = "Alla corruzione →";
    go.addEventListener("click", () => { closeCampaignOverlay(); campaignAIAccordi(); campaignCorruptionScreen(); });
    panel.append(k, t, sub, voci, cols, go);
  });
  render();
}

// Registra l'esito del palio corrente (chiamata all'arrivo del vincitore).
function campaignRecordResult() {
  const cmp = state.campaign;
  if (!cmp || !cmp.active || cmp.recorded) return;
  cmp.recorded = true;
  const winner = state.rankings && state.rankings[0];
  const rec = { idx: cmp.palioIndex, mode: cmp.currentMode, winner: winner ? winner.name : null, result: "other" };
  if (winner && winner.id === cmp.contrada.id) { cmp.wins += 1; rec.result = "win"; }
  else if (winner && cmp.rival && winner.id === cmp.rival.id) { cmp.purghe += 1; rec.result = "purga"; }
  // ── ACCORDI. Le proposte del GIOCATORE (prepaid) sono GIÀ state scalate quando
  // le ha mandate: a "successo" i soldi vanno all'helper, altrimenti gli vengono
  // RIACCREDITATI. Gli altri accordi (fra AI, o quelli in cui il giocatore è helper
  // e viene pagato) si pagano SOLO a palio vinto, come prima.
  const myid = cmp.contrada ? cmp.contrada.id : null;
  (cmp.accordi || []).forEach((a) => {
    if (a.amount == null) return;
    if (a.prepaid) {
      let success;
      if (a.beneficiary === myid) success = !!(winner && winner.id === myid);        // hai vinto il palio
      else if (a.sponsor === myid) success = !(winner && winner.id === a.para);        // la rivale NON ha vinto (para riuscita)
      else success = false;
      if (success) earnBudget(a.helper, a.amount);   // paghi l'helper (avevi già scalato)
      else earnBudget(myid, a.amount);               // RIMBORSO: non hai vinto → riavere i soldi
      return;
    }
    let payer = null;
    if (a.beneficiary != null) { if (winner && winner.id === a.beneficiary) payer = a.beneficiary; }
    else if (a.para != null && a.sponsor != null) { if (!winner || winner.id !== a.para) payer = a.sponsor; }
    if (payer) { const pay = Math.min(a.amount, contradaBudget(payer)); spendBudget(payer, pay); earnBudget(a.helper, pay); }
  });
  cmp.log.push(rec);
}

// Alla schermata risultati, in campagna: nascondi i tasti del palio singolo e
// mostra "Continua la carriera" (o "Fine mandato" all'ultimo).
function campaignContinueButton() {
  const cmp = state.campaign;
  if (!cmp || !cmp.active || cmp.quick) return;   // veloce: niente "Continua la carriera"
  ["replayButton", "changeContradaButton", "restartMossaButton"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.style.display = "none";
  });
  if (document.getElementById("campaignContinueBtn")) return;
  const btn = document.createElement("button");
  btn.id = "campaignContinueBtn"; btn.className = "btn btn-primary"; btn.type = "button";
  btn.textContent = cmp.palioIndex >= campaignTotalPalii(cmp) - 1 ? "Fine mandato" : "Continua la carriera";
  const host = document.querySelector("#screenResults .select-actions") || (ui.replayButton && ui.replayButton.parentElement);
  if (host) host.appendChild(btn);
  btn.addEventListener("click", () => {
    btn.remove();
    const ex = document.getElementById("campaignExitBtn"); if (ex) ex.remove();
    ["replayButton", "changeContradaButton", "restartMossaButton"].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = ""; });
    state.horses.forEach((h) => { h.autopilot = false; });
    cmp.palioIndex += 1;
    saveCampaignProgress();   // salva il progresso al confine tra i palii
    showScreen(null);
    nextCampaignPalio();
  });
  // Tasto ESCI: salva e torna al menu (si riprende dal menu al prossimo accesso).
  if (cmp.palioIndex < campaignTotalPalii(cmp) - 1 && !document.getElementById("campaignExitBtn")) {
    const ex = document.createElement("button");
    ex.id = "campaignExitBtn"; ex.className = "btn"; ex.type = "button"; ex.textContent = "Esci (riprendi dopo)";
    if (host) host.appendChild(ex);
    ex.addEventListener("click", () => {
      state.horses.forEach((h) => { h.autopilot = false; });
      cmp.palioIndex += 1;   // il palio appena corso è concluso: si riprenderà dal prossimo
      exitCampaignSaving();
    });
  }
}

// ── IL VOTO DEL POPOLO ─────────────────────────────────────────────────────
// Finito il mandato, la Contrada giudica il suo Capitano: se il bilancio fra
// Palii vinti e Purghe subite è in attivo (più di uno), il popolo lo riconferma e
// il mandato riparte da capo; altrimenti lo manda a casa. Il risultato si mostra
// come una votazione vera, con la percentuale che sale.
function votoDelPopolo(cmp) {
  const x = (cmp.wins || 0) - (cmp.purghe || 0);
  const riconfermato = x > 1;
  // La percentuale racconta il bilancio: sopra il 60% è la riconferma. Non è
  // casuale, si ricava da com'è andato il mandato — così il numero ha un senso.
  let pct;
  if (riconfermato) pct = Math.min(94, 62 + x * 7);
  else pct = Math.max(18, 58 - Math.max(0, -x) * 9 - (cmp.purghe || 0) * 4);
  return { riconfermato, pct: Math.round(pct), x };
}

function showCampaignFinal() {
  const cmp = state.campaign;
  const voto = votoDelPopolo(cmp);
  // Prima di tutto il POPOLO VOTA — e lo si vede in ogni caso, che ti tengano o
  // che ti mandino via. Se ti riconfermano comincia un nuovo mandato con la
  // stessa Contrada (denari compresi: quelli sono dell'account e non si azzerano);
  // se ti bocciano, dal voto si passa al resoconto qui sotto.
  if (!cmp.votoMostrato) { cmp.votoMostrato = true; showVotoPopolo(cmp, voto, voto.riconfermato); return; }
  cmp.votoMostrato = false;
  clearCampaignSave();   // mandato concluso: niente più "riprendi"
  if (cmp && !cmp.finalRecorded) { cmp.finalRecorded = true; saveCampaignToAlbo(cmp); }   // iscrivi il mandato all'Albo dei Capitani
  try { stopPalioSounds(); playPalioSound("finale.m4a", { volume: 0.6 }); } catch (e) { /* niente */ }   // premiazione del mandato
  let verdetto, colore;
  if (cmp.wins >= 1 && cmp.purghe === 0) { verdetto = "TRIONFO! Gloria alla Contrada e nemmeno una Purga. Un mandato da ricordare."; colore = "#f0cb35"; }
  else if (cmp.wins >= 1) { verdetto = "Mandato positivo: hai vinto il Palio, ma la rivale ti ha purgato. Ci sarà rivincita."; colore = "#e8c86f"; }
  else if (cmp.purghe === 0) { verdetto = "Nessuna vittoria, ma almeno nessuna Purga. Mandato grigio."; colore = "#c9bfa8"; }
  else { verdetto = "Mandato amaro: nessuna vittoria e la rivale ha gioito. La Contrada non dimentica."; colore = "#e8896f"; }
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker"; k.textContent = `Capitano ${cmp.captain} · Contrada ${cmp.contrada.name}`;
    const t = document.createElement("div"); t.className = "cmp-title"; t.textContent = "Fine del Mandato";
    const stats = document.createElement("div"); stats.className = "cmp-stats";
    const s1 = document.createElement("div"); s1.className = "cmp-stat"; s1.innerHTML = `<b>${cmp.wins}</b><small>Vittorie</small>`;
    const s2 = document.createElement("div"); s2.className = "cmp-stat"; s2.innerHTML = `<b style="color:#e8896f">${cmp.purghe}</b><small>Purghe (rivale)</small>`;
    stats.append(s1, s2);
    const v = document.createElement("div"); v.className = "cmp-text"; v.style.color = colore; v.style.fontWeight = "700"; v.style.marginTop = "4px"; v.textContent = verdetto;
    const b = document.createElement("button"); b.className = "cmp-btn"; b.textContent = "Torna al menu";
    b.addEventListener("click", () => { closeCampaignOverlay(); resetCampaign(); openMenuScreen(); });
    panel.append(k, t, stats, v, b);
  });
}

// Schermata del voto: la percentuale sale da 0 al risultato in un paio di secondi,
// poi compare il verdetto. `prosegue` = riconfermato, quindi si riparte.
function showVotoPopolo(cmp, voto, prosegue) {
  try { stopPalioSounds(); playPalioSound("finale.m4a", { volume: 0.6 }); } catch (e) { /* niente */ }
  campaignOverlay((panel) => {
    const k = document.createElement("p"); k.className = "cmp-kicker";
    k.textContent = `Capitano ${cmp.captain} · Contrada ${cmp.contrada.name}`;
    const t = document.createElement("div"); t.className = "cmp-title";
    t.textContent = "Il popolo vota";
    const sub = document.createElement("div"); sub.className = "cmp-text";
    sub.textContent = "L'assemblea della Contrada si riunisce e giudica il mandato.";

    const num = document.createElement("div");
    num.style.cssText = "font-size:clamp(38px,9vw,64px);font-weight:900;letter-spacing:.02em;margin:10px 0 2px";
    num.textContent = "0%";
    const barra = document.createElement("div");
    barra.style.cssText = "height:14px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;margin:6px 0 4px";
    const dentro = document.createElement("div");
    dentro.style.cssText = "height:100%;width:0%;transition:width 1.8s ease-out;background:#e8896f";
    barra.appendChild(dentro);
    const soglia = document.createElement("div"); soglia.className = "cmp-text";
    soglia.style.opacity = ".7"; soglia.textContent = "Serve il 60% per la riconferma";

    const esito = document.createElement("div"); esito.className = "cmp-text";
    esito.style.cssText = "font-weight:800;margin-top:10px;min-height:44px";
    const b = document.createElement("button"); b.className = "cmp-btn";
    b.style.visibility = "hidden";

    panel.append(k, t, sub, num, barra, soglia, esito, b);

    // il conteggio dei voti
    const col = voto.riconfermato ? "#7fd98c" : "#e8896f";
    requestAnimationFrame(() => { dentro.style.width = voto.pct + "%"; dentro.style.background = col; });
    const t0 = performance.now();
    const tick = () => {
      const q = Math.min(1, (performance.now() - t0) / 1800);
      num.textContent = Math.round(voto.pct * q) + "%";
      num.style.color = q >= 1 ? col : "#f3e7cf";
      if (q < 1) { requestAnimationFrame(tick); return; }
      esito.style.color = col;
      esito.textContent = voto.riconfermato
        ? "RICONFERMATO. Il popolo ti vuole ancora Capitano: comincia un nuovo mandato."
        : "SFIDUCIATO. La Contrada ti ringrazia e saluta: il mandato finisce qui.";
      b.textContent = prosegue ? "Nuovo mandato →" : "Il resoconto del mandato →";
      b.style.visibility = "visible";
    };
    requestAnimationFrame(tick);

    b.addEventListener("click", () => {
      closeCampaignOverlay();
      if (prosegue) { nuovoMandato(cmp); return; }
      showCampaignFinal();   // bocciato: ora il resoconto del mandato
    });
  });
}

// Riconfermato: si riparte con la stessa Contrada e lo stesso Capitano. Azzera
// solo il conto del mandato — i denari sono dell'account e non si toccano.
function nuovoMandato(cmp) {
  cmp.palioIndex = 0;
  cmp.wins = 0;
  cmp.purghe = 0;
  cmp.mandati = (cmp.mandati || 1) + 1;
  cmp.log = [];
  cmp.recorded = false;
  cmp.finalRecorded = false;
  cmp.schedule = buildCampaignSchedule();
  cmp.circuit = { luglio: [], agosto: [] };
  saveCampaignProgress();
  campaignMandate();
}

// ══ LA TRATTA — sorteggio dei cavalli alle Contrade (step prima del tondino) ══
// Ricostruzione del sorteggio storico nel cortile del Palazzo Pubblico: due urne
// (una coi NUMERI D'ORECCHIO dei 10 cavalli, una coi NOMI delle 10 Contrade); un
// bambino estrae contemporaneamente un numero e una Contrada, ufficializzando
// l'accoppiamento. Qui: si creano i 10 entranti, si genera un cavallo (numero +
// nome + qualità/stamina) per ciascuno e li si abbina in ordine casuale, con
// cerimonia a schermo. Il cavallo sorteggiato porta la sua qualità in gara.
// Nomi VERI di barberi del Palio (vincitori del '900 da ilpalio.org + classici):
// dal ronzino al campione, tutti cavalli realmente corsi in Piazza.
// ROSTER FISSO dei barberi: ogni cavallo ha SEMPRE la sua fascia e la sua stamina
// (quelle date dall'utente; le altre inventate nei range di fascia — brenna 70-84,
// bono 81-90, bombolone 92-100). Indoli speciali: nervous = molto agitata,
// aggressive = scalcia/va addosso ai canapi, turns = si gira ai canapi.
// potenza 1-5 = MOLTIPLICATORE di quanto sposti le altre Contrade andandogli addosso
// ai canapi. calma 1-5 = 1 molto agitato (scalcia ai canapi), 5 fermo piantato.
// scossoStamina = stamina che il cavallo guadagna/perde quando resta SCOSSO.
// terzoGiroStamina = stamina extra nell'ultimo giro.
// ── I DUE PALII: STORICO e MODERNO ──────────────────────────────────────────
// Ogni barbero appartiene a un'epoca. "storico" = i cavalli dei Palii fino agli
// anni Novanta, quelli montati dai fantini di Aceto e della sua generazione;
// "moderno" = dal Duemila in poi, da Trecciolino in avanti. La scelta si fa dalla
// rotellina in home e riempie HORSE_ROSTER/TRATTA_HORSE_NAMES con la sola epoca
// attiva, cosi' Tratta, voto dei Capitani e accoppiate restano dentro l'epoca.
const ROSTER_CAVALLI = {
  "Panezio":            { epoca: "storico", tier: "bono",      stamina: 90,  potenza: 4, calma: 5, turns: 5 },
  "Topolone":           { epoca: "storico", tier: "bombolone", stamina: 92,  potenza: 4, calma: 2, turns: 3 },
  "Volpino":            { epoca: "storico", tier: "brenna",    stamina: 74,  potenza: 2, calma: 3, turns: 3 },
  "Trattu de Zamaglia": { epoca: "storico", tier: "brenna",    stamina: 71,  potenza: 1, calma: 5, turns: 5, scossoStamina: 16 },
  "Uberta de Mores":    { epoca: "storico", tier: "brenna",    stamina: 78,  potenza: 2, calma: 2, turns: 2 },
  "Gaudenzia":          { epoca: "storico", tier: "bono",      stamina: 85,  potenza: 3, calma: 3, turns: 4 },
  "Mirabella":          { epoca: "storico", tier: "bono",      stamina: 86,  potenza: 4, calma: 2, turns: 3, scossoStamina: -15 },
  "Fedora Saura":       { epoca: "storico", tier: "bombolone", stamina: 80,  potenza: 3, calma: 3, turns: 3 },
  "Pytheos":            { epoca: "storico", tier: "bono",      stamina: 80,  potenza: 3, calma: 3, turns: 4, scossoStamina: -15 },
  "Quebel":             { epoca: "storico", tier: "bono",      stamina: 80,  potenza: 3, calma: 4, turns: 4 },
  "Rimini":             { epoca: "storico", tier: "bombolone", stamina: 97,  potenza: 2, calma: 2, turns: 2 },
  "Arestetulesu":       { epoca: "moderno", tier: "bono",      stamina: 87,  potenza: 1, calma: 2, turns: 4 },
  "Urbino de Ozieri":   { epoca: "storico", tier: "brenna",    stamina: 72,  potenza: 1, calma: 1, turns: 2 },
  "Tale e Quale":       { epoca: "moderno", tier: "bombolone", stamina: 95,  potenza: 4, calma: 3, turns: 3, scossoStamina: -15 },
  "Quarnero":           { epoca: "storico", tier: "brenna",    stamina: 75,  potenza: 4, calma: 5, turns: 5 },
  "Comancio":           { epoca: "moderno", tier: "bono",      stamina: 88,  potenza: 3, calma: 5, turns: 5 },
  "Selvaggia":          { epoca: "storico", tier: "brenna",    stamina: 74,  potenza: 2, calma: 3, turns: 3 },
  "Uberto":             { epoca: "storico", tier: "brenna",    stamina: 76,  potenza: 3, calma: 4, turns: 4 },
  "Vipera":             { epoca: "moderno", tier: "bombolone", stamina: 94,  potenza: 5, calma: 1, turns: 1, scossoStamina: 13 },
  "Oppio":              { epoca: "moderno", tier: "bombolone", stamina: 96,  potenza: 3, calma: 1, turns: 1, scossoStamina: -10 },
  "Benitos":            { epoca: "storico", tier: "bombolone", stamina: 89,  potenza: 5, calma: 1, turns: 1 },
  "Diodoro":            { epoca: "moderno", tier: "bombolone", stamina: 98,  potenza: 5, calma: 2, turns: 3 },
  "Ungaros":            { epoca: "moderno", tier: "bono",      stamina: 82,  potenza: 2, calma: 2, turns: 2 },
  "Zenis":              { epoca: "moderno", tier: "brenna",    stamina: 79,  potenza: 4, calma: 2, turns: 2 },
  "Figaro":             { epoca: "storico", tier: "brenna",    stamina: 76,  potenza: 2, calma: 2, turns: 3 },
  "Oriolu de Zamaglia": { epoca: "storico", tier: "brenna",    stamina: 70,  potenza: 1, calma: 1, turns: 2 },
  "Re Artù":            { epoca: "storico", tier: "brenna",    stamina: 73,  potenza: 2, calma: 3, turns: 4 },
  "Zodiach":            { epoca: "moderno", tier: "bombolone", stamina: 90,  potenza: 4, calma: 3, turns: 2 },
  "Remorex":            { epoca: "moderno", tier: "bombolone", stamina: 97,  potenza: 4, calma: 2, turns: 3, scossoStamina: 10 },
  "Urbino":             { epoca: "storico", tier: "bono",      stamina: 85,  potenza: 3, calma: 4, turns: 5 },
  "Zio Frac":           { epoca: "moderno", tier: "bombolone", stamina: 95,  potenza: 1, calma: 4, turns: 3, scossoStamina: -15 },
  "Preziosa Penelope":  { epoca: "moderno", tier: "bombolone", stamina: 95,  potenza: 4, calma: 3, turns: 4 },
  "Galleggiante":       { epoca: "moderno", tier: "bono",      stamina: 83,  potenza: 2, calma: 2, turns: 3 },
  "Anda e Bola":        { epoca: "moderno", tier: "bono",      stamina: 84,  potenza: 3, calma: 5, turns: 5 },
  "Reo Confesso":       { epoca: "moderno", tier: "bono",      stamina: 84,  potenza: 2, calma: 3, turns: 4 },
  "Viso d'Angelo":      { epoca: "moderno", tier: "bono",      stamina: 86,  potenza: 1, calma: 4, turns: 5 },
  "Violenta da Clodia": { epoca: "moderno", tier: "bombolone", stamina: 100, potenza: 2, calma: 3, turns: 2, terzoGiroStamina: 2, scossoStamina: -10 },
  "Indianos":           { epoca: "moderno", tier: "bono",      stamina: 88,  potenza: 1, calma: 5, turns: 1 },
  "Berio":              { epoca: "moderno", tier: "bono",      stamina: 85,  potenza: 5, calma: 4, turns: 4 },
  "Brivido Sardo":      { epoca: "moderno", tier: "brenna",    stamina: 77,  potenza: 5, calma: 5, turns: 5 },
  "Mocambo":            { epoca: "moderno", tier: "brenna",    stamina: 80,  potenza: 5, calma: 5, turns: 2 },
};
// Riempiti da applicaEpoca(): contengono SOLO i cavalli dell'epoca scelta. Restano
// gli stessi oggetti (mai riassegnati) perche' il resto del gioco ci tiene dei
// riferimenti — e perche' i cavalli proposti dai giocatori ci vengono aggiunti.
const HORSE_ROSTER = {};
const TRATTA_HORSE_NAMES = [];

// ── IMPOSTAZIONI (rotellina in home) ────────────────────────────────────────
const MOSSA_MINUTI_SCELTE = [5, 10, 20, 30];
let propostiCavalli = null, propostiFantini = null;   // accettati dall'admin, validi in ogni epoca
const IMPOSTAZIONI_KEY = "palio.impostazioni";
function leggiImpostazioni() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(IMPOSTAZIONI_KEY)) || {}; } catch (e) { s = {}; }
  return {
    epoca: s.epoca === "storico" ? "storico" : "moderno",
    mossaMinuti: MOSSA_MINUTI_SCELTE.indexOf(s.mossaMinuti) >= 0 ? s.mossaMinuti : 5,
  };
}
function salvaImpostazioni(s) {
  try { localStorage.setItem(IMPOSTAZIONI_KEY, JSON.stringify(s)); } catch (e) { /* niente */ }
}
// Riempie i roster ATTIVI con la sola epoca scelta. Gli oggetti non vengono mai
// riassegnati (svuotati e riempiti): altrove nel codice ci sono riferimenti, e i
// cavalli/fantini proposti dai giocatori vengono aggiunti a questi stessi.
function applicaEpoca(epoca) {
  const storica = epoca === "storico";
  Object.keys(HORSE_ROSTER).forEach((k) => { delete HORSE_ROSTER[k]; });
  Object.keys(ROSTER_CAVALLI).forEach((nome) => {
    const c = ROSTER_CAVALLI[nome];
    if ((c.epoca === "storico") === storica) HORSE_ROSTER[nome] = c;
  });
  TRATTA_HORSE_NAMES.length = 0;
  TRATTA_HORSE_NAMES.push(...Object.keys(HORSE_ROSTER));
  JOCKEYS.length = 0;
  JOCKEYS.push(...(storica ? JOCKEYS_STORICI : JOCKEYS_MODERNI));
  // I cavalli e i fantini PROPOSTI DAI GIOCATORI e accettati non appartengono a
  // un'epoca: restano in tutt'e due, altrimenti sparirebbero al primo cambio.
  if (propostiCavalli) applyAcceptedHorses(propostiCavalli);
  if (propostiFantini) applyAcceptedJockeys(propostiFantini);
}
function applicaImpostazioni() {
  const s = leggiImpostazioni();
  applicaEpoca(s.epoca);
  MOSSA_MAX_DURATION = s.mossaMinuti * 60;
  return s;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Fasce di qualità del cavallo, dal peggiore al migliore (gergo senese):
//   Brenna = ronzino scarso · Bono = cavallo discreto · Bombolone = cavallone top.
const TRATTA_TIERS = {
  brenna:    { label: "Brenna",    order: 0, stars: 1, bg: "rgba(176,106,74,.22)", fg: "#d79c81" },
  bono:      { label: "Bono",      order: 1, stars: 3, bg: "rgba(224,184,74,.18)", fg: "#f0cb35" },
  bombolone: { label: "Bombolone", order: 2, stars: 5, bg: "rgba(91,191,106,.20)", fg: "#7fd98c" },
};

// Sorteggia 10 barberi DAL ROSTER FISSO: ogni cavallo porta la SUA fascia, la SUA
// stamina e le SUE indoli (nervous/aggressive/turns). La composizione del lotto
// (quante brenne/boni/bomboloni) dipende dal sorteggio, non è più fissa 3/4/3.
// La differenza vera fra fasce è il MOLTIPLICATORE DI VELOCITÀ (TIER_SPEED), non la
// stamina (range che si sovrappongono).
function generateTrattaHorses() {
  const numbers = [];
  while (numbers.length < 10) {
    const n = randomInteger(10, 90);
    if (!numbers.includes(n)) numbers.push(n);
  }
  const names = shuffleInPlace([...TRATTA_HORSE_NAMES]).slice(0, 10);
  return numbers.map((num, i) => {
    const name = names[i] || ("Barbero " + num);
    const r = HORSE_ROSTER[name] || { tier: "bono", stamina: 85 };
    return { earNumber: num, horseName: name, tier: r.tier, stamina: r.stamina, turns: r.turns || 3, potenza: r.potenza || 3, calma: r.calma || 3, scossoStamina: r.scossoStamina || 0, terzoGiroStamina: r.terzoGiroStamina || 0 };
  });
}

// Costruisce i 10 barberi della Tratta a partire da una lista di NOMI già scelti
// (usata dalla scelta-cavalli in Campagna: i 10 più votati). Stesso formato di
// generateTrattaHorses: numero d'orecchio casuale + fascia/stamina/indoli dal roster.
function trattaHorsesFromNames(names) {
  const numbers = [];
  while (numbers.length < names.length) {
    const n = randomInteger(10, 90);
    if (!numbers.includes(n)) numbers.push(n);
  }
  return names.map((name, i) => {
    const r = HORSE_ROSTER[name] || { tier: "bono", stamina: 85 };
    return { earNumber: numbers[i], horseName: name, tier: r.tier, stamina: r.stamina, turns: r.turns || 3, potenza: r.potenza || 3, calma: r.calma || 3, scossoStamina: r.scossoStamina || 0, terzoGiroStamina: r.terzoGiroStamina || 0 };
  });
}

// QUOTE DI FASCIA per Palio, fra i 10 barberi in gara:
//   · MAX 4 bomboloni e MAX 4 brenne (gli esuberi diventano BONI);
//   · MIN 2 BRENNE: in ogni Palio devono correre almeno due ronzini. Se il
//     sorteggio ne pesca meno, si sostituisce un BONO (e solo se non ce ne sono,
//     un bombolone) con una brenna libera del roster.
// Il numero d'orecchio resta sempre quello di partenza, così il campo resta di 10.
// Vale per paliata veloce E Campagna.
function enforceTierCaps(drawn) {
  const MAXB = 4, MAXR = 4, MINR = 2;
  const used = new Set(drawn.map((d) => d.horseName));
  const liberi = (tier) => shuffleInPlace(TRATTA_HORSE_NAMES.filter(
    (n) => !used.has(n) && ((HORSE_ROSTER[n] || {}).tier === tier)));
  const spare = { bono: liberi("bono"), brenna: liberi("brenna") };
  // Sostituisce il barbero in posizione idx con uno libero della fascia chiesta,
  // conservando il numero d'orecchio. Ritorna true se ha davvero sostituito.
  const swapTo = (idx, tier) => {
    const name = spare[tier] && spare[tier].shift();
    if (!name) return false;                 // nessuno libero di quella fascia
    const r = HORSE_ROSTER[name];
    drawn[idx] = { earNumber: drawn[idx].earNumber, horseName: name, tier: r.tier, stamina: r.stamina,
      turns: r.turns || 3,
      potenza: r.potenza || 3, calma: r.calma || 3, scossoStamina: r.scossoStamina || 0, terzoGiroStamina: r.terzoGiroStamina || 0 };
    used.add(name);
    return true;
  };

  // 1) TETTI massimi.
  let nB = 0, nR = 0;
  for (let i = 0; i < drawn.length; i += 1) {
    if (drawn[i].tier === "bombolone" && ++nB > MAXB) { if (swapTo(i, "bono")) nB -= 1; }
    else if (drawn[i].tier === "brenna" && ++nR > MAXR) { if (swapTo(i, "bono")) nR -= 1; }
  }

  // 2) MINIMO di brenne. Si tolgono prima i BONI (i bomboloni solo se non
  //    bastano): togliere un bombolone svuoterebbe il palio dei cavalli forti.
  const contaBrenne = () => drawn.filter((d) => d.tier === "brenna").length;
  for (const tierDaCedere of ["bono", "bombolone"]) {
    for (let i = 0; i < drawn.length && contaBrenne() < MINR; i += 1) {
      if (drawn[i].tier === tierDaCedere) swapTo(i, "brenna");
    }
  }
  return drawn;
}

// ══ CAMPAGNA — LA SCELTA DEI CAVALLI (voto dei Capitani, prima della Tratta) ══
// SOLO in Campagna: dopo l'estrazione delle Contrade e PRIMA della Tratta, i
// Capitani votano i barberi. Davanti hanno tutti gli aspiranti (nome + SOLO la
// fascia: brenna/bono/bombolone). Ogni Capitano vota fino a 12 cavalli; i 10 più
// votati corrono il Palio e vengono poi sorteggiati alle Contrade alla Tratta.
const HORSE_VOTE_POOL = 20;   // aspiranti mostrati
const HORSE_VOTE_MAX = 12;    // voti per Capitano
const HORSE_VOTE_RUN = 10;    // cavalli che corrono
function beginSceltaCavalli() {
  const cmp = state.campaign;
  const pool = shuffleInPlace([...TRATTA_HORSE_NAMES]).slice(0, HORSE_VOTE_POOL).map((name) => ({
    name, tier: (HORSE_ROSTER[name] || { tier: "bono" }).tier,
  }));
  // Voti dei 9 (circa) Capitani AI PRE-calcolati: si mostreranno LIVE, uno alla volta,
  // mentre voti (pesano la fascia con un po' di casualità).
  const aiCaptains = Math.max(1, (cmp.currentDraw || []).filter((c) => c.id !== cmp.contrada.id).length);
  const perCaptain = [];
  for (let k = 0; k < aiCaptains; k += 1) {
    // Ogni capitano ha un GUSTO diverso: ~40% sono "brennaioli" (fedeli/economi) che
    // votano volentieri anche le brenne → così qualche BRENNA finisce fra i 10 che
    // corrono, come nel Palio vero (non solo bomboloni). Casualità più alta = mix.
    const brennaLover = Math.random() < 0.5;
    const w = brennaLover ? { bombolone: 1.8, bono: 2.2, brenna: 2.8 } : { bombolone: 3, bono: 2, brenna: 1 };
    perCaptain.push(pool.map((h) => ({ name: h.name, s: (w[h.tier] || 2) + Math.random() * 2.9 }))
      .sort((a, b) => b.s - a.s).slice(0, HORSE_VOTE_MAX).map((x) => x.name));
  }
  cmp.horseVote = { pool, votes: new Set(), selected: null, aiCaptains, perCaptain, revealed: 0 };
  // La camera resta sul Palazzo (l'estrazione ha già tolto la timeline → statica).
  showScreen(null);
  setHudVisible(false);
  buildSceltaCavalliUI();
  startAICaptainReveal();
}

// I voti dei Capitani AI già RIVELATI per un cavallo (0..aiCaptains) — usato live.
function aiVotesRevealed(hv, name) {
  let c = 0;
  for (let k = 0; k < hv.revealed; k += 1) if (hv.perCaptain[k].indexOf(name) >= 0) c += 1;
  return c;
}
// Rivela i Capitani uno alla volta (~340ms) → i badge dei voti salgono in diretta.
function startAICaptainReveal() {
  const hv = state.campaign && state.campaign.horseVote;
  if (!hv) return;
  const step = () => {
    const cur = state.campaign && state.campaign.horseVote;
    if (!cur || cur !== hv || !document.getElementById("hvOverlay")) return;   // schermata chiusa
    if (hv.revealed >= hv.aiCaptains) { refreshHorseVoteUI(); return; }
    hv.revealed += 1;
    refreshHorseVoteUI(true);
    setTimeout(step, 520);
  };
  setTimeout(step, 600);
}

function ensureVotoCavalliStyle() {
  if (document.getElementById("hv-style")) return;
  const s = document.createElement("style");
  s.id = "hv-style";
  s.textContent = `
#hvOverlay{position:fixed;inset:0;z-index:62;display:flex;flex-direction:column;align-items:center;
  justify-content:safe center;gap:2px;
  background:radial-gradient(1200px 800px at 50% -5%,#5c4426 0%,#3a2c19 55%,#241a10 100%);
  color:#f3e7cf;font-family:inherit;padding:20px;overflow:auto}
#hvOverlay h2{margin:6px 0 2px;font-size:clamp(18px,3vw,30px);letter-spacing:.12em;color:#f0cb35;text-transform:uppercase;padding:0 130px}
#hvOverlay .hv-sub{opacity:.9;font-size:14px;margin-bottom:12px;text-align:center;max-width:640px;padding:0 8px}
#hvCount{font-weight:800;color:#f0cb35}
#hvGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;width:min(1050px,97vw)}
.hv-card{position:relative;text-align:left;background:rgba(255,246,225,.1);border:1px solid rgba(240,203,53,.4);
  border-radius:12px;padding:10px 12px;cursor:pointer;transition:transform .1s ease,border-color .12s,box-shadow .12s}
.hv-card:hover{transform:translateY(-2px);border-color:#f0cb35}
.hv-card.voted{border-color:#7fd98c;box-shadow:0 0 0 2px rgba(127,217,140,.55);background:rgba(127,217,140,.12)}
.hv-card.full{opacity:.5}
/* i nomi VANNO A CAPO (niente più "…" tronco): così si leggono interi a ogni misura */
.hv-name{font-size:14px;font-weight:800;color:#f5ecd8;line-height:1.12;white-space:normal;word-break:break-word;padding-right:14px}
.hv-tier{display:inline-block;margin-top:5px;font-size:11px;font-weight:800;border-radius:5px;padding:2px 9px;letter-spacing:.04em}
.hv-check{position:absolute;top:7px;right:8px;font-size:14px;color:#7fd98c;opacity:0;transition:opacity .12s}
.hv-card.voted .hv-check{opacity:1}
/* Badge dei voti dei Capitani (in diretta), in basso a destra della card. */
.hv-votes{position:absolute;bottom:6px;right:7px;font-size:12px;font-weight:800;color:#a8c2ff;
  background:rgba(90,120,200,.14);border:1px solid rgba(140,170,255,.35);border-radius:9px;padding:1px 7px;
  opacity:.5;transition:opacity .15s,transform .18s,color .15s,background .15s}
.hv-votes::before{content:"🏇";margin-right:3px;font-size:10px}
.hv-votes.hot{opacity:1;color:#ffd977;background:rgba(240,203,53,.16);border-color:rgba(240,203,53,.5)}
.hv-votes.bump{transform:scale(1.28)}
/* Cavalli attualmente nei 10 che correrebbero (per voti): bordo oro. */
.hv-card.inrun{border-color:#f0cb35;box-shadow:0 0 0 1px rgba(240,203,53,.45)}
.hv-card.voted.inrun{box-shadow:0 0 0 2px rgba(127,217,140,.55)}
#hvConfirmBtn{margin-top:14px;font:inherit;cursor:pointer;border-radius:10px;padding:12px 32px;border:none;background:#f0cb35;color:#1a1206;font-weight:800}
#hvConfirmBtn:disabled{opacity:.5;cursor:not-allowed}
#hvConfirmBtn:hover:not(:disabled){filter:brightness(1.08)}
/* Telefono/tablet (poca altezza O poca larghezza): compatta tutto così i 20 barberi
   + testata + bottone entrano nello schermo. Soglia ampia = scatta su più device. */
@media (max-height:620px), (max-width:1024px){
  #hvOverlay{padding:6px 10px}
  #hvOverlay h2{font-size:15px;margin:0;letter-spacing:.06em;padding:0 118px}
  #hvOverlay .hv-sub{font-size:11px;margin:2px 0 5px;max-width:none;line-height:1.22;padding:0 118px}
  #hvGrid{grid-template-columns:repeat(5,1fr);gap:5px;width:min(1200px,99vw)}
  .hv-card{padding:5px 8px;border-radius:8px}
  .hv-name{font-size:12px;padding-right:12px}
  .hv-tier{font-size:9px;margin-top:2px;padding:1px 6px}
  .hv-check{top:4px;right:5px;font-size:11px}
  #hvConfirmBtn{margin-top:7px;padding:7px 22px;font-size:13.5px}
}
/* Molto stretto (telefono in verticale): meno colonne, testata senza il gran padding. */
@media (max-width:560px){
  #hvOverlay h2{padding:0 6px;font-size:15px}
  #hvOverlay .hv-sub{padding:0 6px}
  #hvGrid{grid-template-columns:repeat(3,1fr)}
}`;
  document.head.appendChild(s);
}

function buildSceltaCavalliUI() {
  ensureVotoCavalliStyle();
  const cmp = state.campaign;
  const old = document.getElementById("hvOverlay"); if (old) old.remove();
  const ov = document.createElement("div"); ov.id = "hvOverlay";
  ov.innerHTML = '<h2>La scelta dei cavalli</h2>'
    + '<div class="hv-sub">I Capitani votano i barberi aspiranti (solo la fascia è nota). '
    + 'Puoi votarne fino a <b>' + HORSE_VOTE_MAX + '</b>: i <b>' + HORSE_VOTE_RUN + '</b> più votati correranno il Palio '
    + 'e alla Tratta saranno sorteggiati alle Contrade. Il badge 🏇 mostra <b>in diretta</b> i voti degli altri Capitani. '
    + '&nbsp;Voti: <span id="hvCount">0/' + HORSE_VOTE_MAX + '</span></div>'
    + '<div id="hvGrid"></div>'
    + '<button type="button" id="hvConfirmBtn">Conferma i voti →</button>';
  document.body.appendChild(ov);
  const grid = ov.querySelector("#hvGrid");
  cmp.horseVote.pool.forEach((h) => {
    const meta = TRATTA_TIERS[h.tier] || TRATTA_TIERS.bono;
    const card = document.createElement("button");
    card.type = "button"; card.className = "hv-card"; card.dataset.name = h.name;
    card.innerHTML = '<span class="hv-check">✓</span><div class="hv-name">' + escapeHtml(h.name) + '</div>'
      + '<span class="hv-tier" style="color:' + meta.fg + ';background:' + meta.bg + '">' + meta.label + '</span>'
      + '<span class="hv-votes">0</span>';
    card.addEventListener("click", () => toggleHorseVote(h.name));
    grid.appendChild(card);
  });
  ov.querySelector("#hvConfirmBtn").addEventListener("click", confirmSceltaCavalli);
  refreshHorseVoteUI();
}

function toggleHorseVote(name) {
  const v = state.campaign.horseVote.votes;
  if (v.has(name)) v.delete(name);
  else if (v.size < HORSE_VOTE_MAX) v.add(name);
  refreshHorseVoteUI();
}

function refreshHorseVoteUI(animate) {
  const hv = state.campaign.horseVote;
  const v = hv.votes;
  const count = document.getElementById("hvCount");
  if (count) count.textContent = v.size + "/" + HORSE_VOTE_MAX;
  const full = v.size >= HORSE_VOTE_MAX;
  // Totale per cavallo (Capitani rivelati + tuo voto) → quali sarebbero nei 10 ORA.
  const totals = hv.pool.map((h) => ({ name: h.name, n: aiVotesRevealed(hv, h.name) + (v.has(h.name) ? 1 : 0) }))
    .sort((a, b) => b.n - a.n);
  const inRun = new Set(totals.slice(0, HORSE_VOTE_RUN).map((x) => x.name));
  document.querySelectorAll("#hvGrid .hv-card").forEach((card) => {
    const name = card.dataset.name;
    const voted = v.has(name);
    card.classList.toggle("voted", voted);
    card.classList.toggle("full", full && !voted);   // i non votati si smorzano quando sei a 12
    card.classList.toggle("inrun", inRun.has(name));  // nei 10 che correrebbero ora (per voti)
    const badge = card.querySelector(".hv-votes");
    if (badge) {
      const total = aiVotesRevealed(hv, name) + (voted ? 1 : 0);   // Capitani AI + il TUO voto (flag del giocatore)
      const prev = badge.textContent;
      badge.textContent = total;
      badge.classList.toggle("hot", total > 0);
      if (animate && String(total) !== prev) {            // piccolo "pop" quando arriva un voto
        badge.classList.add("bump");
        setTimeout(() => badge.classList.remove("bump"), 200);
      }
    }
  });
  const btn = document.getElementById("hvConfirmBtn");
  if (btn) btn.disabled = v.size === 0;   // vota almeno un cavallo
}

// Somma i voti del giocatore + degli altri Capitani (le Contrade che corrono,
// escluso il giocatore). Gli AI votano pesando la fascia (bombolone > bono >
// brenna) con un po' di casualità. I HORSE_VOTE_RUN più votati corrono.
// I 10 che corrono = giocatore + i voti PRE-calcolati dei Capitani (gli stessi
// mostrati live in schermata, così il risultato coincide con quello che hai visto).
function tallyHorseVotes(cmp) {
  const hv = cmp.horseVote;
  const counts = new Map(hv.pool.map((h) => [h.name, 0]));
  hv.votes.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));                 // giocatore
  hv.perCaptain.forEach((picks) => picks.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1)));  // Capitani AI
  return hv.pool.map((h) => ({ name: h.name, votes: counts.get(h.name) || 0, r: Math.random() }))
    .sort((a, b) => (b.votes - a.votes) || (b.r - a.r))
    .slice(0, HORSE_VOTE_RUN)
    .map((x) => x.name);
}

function confirmSceltaCavalli() {
  const cmp = state.campaign;
  cmp.horseVote.revealed = cmp.horseVote.aiCaptains;   // rivela tutti (conteggi mostrati = finali)
  cmp.horseVote.selected = tallyHorseVotes(cmp);   // i 10 che corrono → li userà la Tratta
  const ov = document.getElementById("hvOverlay"); if (ov) ov.remove();
  beginTratta();
}

// La cerimonia si svolge SOTTO IL PALAZZO COMUNALE (centro del rettilineo di
// corsa, come nella realtà): cavalli in fila lungo la pista davanti alla
// facciata, tavolo con le urne al centro, camera dal Campo che inquadra la
// fila col Palazzo alle spalle.
const TRATTA_ROW_LANE = -(TRACK_HALF_WIDTH - 3.4);  // fila sul lato del Palazzo

// FRENI PROVVISORI sulle fasce: forza certe Contrade (se in gara e col freno attivo)
// a ricevere solo certe fasce, scambiando i cavalli già assegnati con quelli di
// un'altra Contrada, senza violare gli altri vincoli.
function enforceTierFreni(assign) {
  const constraints = {};
  if (frenoAttivo("tartucaOcaTorre")) ["tartuca", "oca", "torre"].forEach((id) => { constraints[id] = ["brenna", "bono"]; });
  if (frenoAttivo("giraffa")) constraints.giraffa = ["bono"];
  if (frenoAttivo("boniQuattro")) ["tartuca", "lupa", "bruco", "selva"].forEach((id) => { constraints[id] = ["bono"]; });
  if (frenoAttivo("istriceBomboloni")) constraints.istrice = ["bombolone"];
  if (frenoAttivo("torreBrenna")) constraints.torre = ["brenna"];
  // Chiocciola + Giraffa: prima SOLO BRENNE (504→524), poi SOLO BONI (524→700).
  if (frenoRange(504, 524)) ["chiocciola", "giraffa"].forEach((id) => { constraints[id] = ["brenna"]; });
  else if (frenoRange(524, 700)) ["chiocciola", "giraffa"].forEach((id) => { constraints[id] = ["bono"]; });
  if (!Object.keys(constraints).length) return;
  const entries = [...assign.entries()];   // [entrant, drawn]
  for (const [entrant, drawn] of entries) {
    const allowed = constraints[entrant.id];
    if (!allowed || allowed.indexOf(drawn.tier) >= 0) continue;   // già ok
    for (const [other, otherDrawn] of entries) {
      if (other === entrant) continue;
      if (allowed.indexOf(otherDrawn.tier) < 0) continue;         // il suo cavallo deve andarmi bene
      const otherAllowed = constraints[other.id];
      if (otherAllowed && otherAllowed.indexOf(drawn.tier) < 0) continue;   // il mio non deve violarlo
      assign.set(entrant, otherDrawn);
      assign.set(other, drawn);
      break;
    }
  }
}

// Avvio della TRATTA: crea gli entranti, sorteggia gli abbinamenti, poi la
// cerimonia 3D in Piazza (fila dei cavalli, due urne, bambino che estrae).
function beginTratta() {
  ensureAudio();
  if (state.audio.ctx && state.audio.ctx.state === "suspended") state.audio.ctx.resume();
  clearConfetti();
  createEntrants();                       // i 10 cavalli/Contrade in gara (giocatore incluso)
  // In Campagna i 10 cavalli sono quelli VOTATI dai Capitani (scelta-cavalli);
  // altrimenti (paliata veloce) sorteggio casuale dal roster. Fasce SEMPRE in
  // ordine sparso: mai "prima tutti i bomboloni e poi gli altri".
  const cmp = state.campaign;
  const voted = cmp && cmp.horseVote && cmp.horseVote.selected;
  const drawnHorses = enforceTierCaps(shuffleInPlace(
    (voted && voted.length === HORSE_VOTE_RUN) ? trattaHorsesFromNames(voted) : generateTrattaHorses()
  ));
  if (cmp && cmp.horseVote) cmp.horseVote.selected = null;   // consumati: non riusare al prossimo palio
  // ── L'ALBO CONDIZIONA LA TRATTA (fra le 10 in gara) — UNICA regola rimasta:
  //   · OGNI 4 PALII la Contrada che ha vinto PIÙ Palii riceve SICURAMENTE una
  //     brenna. Negli altri 3 palii su 4 nessun trattamento speciale: tutte
  //     pescano a caso dal lotto (nessun freno di velocità, nessun bombolone al
  //     digiuno, nessuna brenna al 50% più vittorioso — tutto rimosso).
  // L'ordine di RIVELAZIONE resta casuale.
  const alboC = loadVictoryAlbo().contrada || {};
  const running = state.horses.slice();
  const brennaPool = shuffleInPlace(drawnHorses.filter((h) => h.tier === "brenna"));
  const restPool = shuffleInPlace(drawnHorses.filter((h) => h.tier === "bono"));
  const bombPool = shuffleInPlace(drawnHorses.filter((h) => h.tier === "bombolone"));
  const assign = new Map();
  // Contatore persistente dei palii: ogni 4° palio scatta la brenna garantita.
  let trattaCnt = 0;
  try { trattaCnt = (parseInt(localStorage.getItem("palio.reginaBrennaCnt") || "0", 10) || 0) + 1; } catch (e) { trattaCnt = 1; }
  try { localStorage.setItem("palio.reginaBrennaCnt", String(trattaCnt)); } catch (e) { /* niente */ }
  if (trattaCnt % 4 === 0) {
    // la più vittoriosa in assoluto fra le 10 in gara (a parità: una a caso)
    const regina = shuffleInPlace(running.slice()).sort((a, b) => (alboC[b.id] || 0) - (alboC[a.id] || 0))[0];
    if (regina && brennaPool.length) assign.set(regina, brennaPool.shift());
  }
  // FINESTRA 40 palii: all'ISTRICE va un BOMBOLONE vero, preso dal pool estratto.
  if (istriceBomboloneActive()) {
    const istr = running.find((h) => h.id === "istrice");
    if (istr && !assign.has(istr) && bombPool.length) assign.set(istr, bombPool.shift());
  }
  // Tutte le altre (e la regina negli altri 3 palii su 4): pescano a caso.
  const leftovers = shuffleInPlace([...restPool, ...brennaPool, ...bombPool]);
  running.forEach((entrant) => { if (!assign.has(entrant)) assign.set(entrant, leftovers.shift()); });
  enforceTierFreni(assign);   // freni provvisori: Tartuca/Oca/Torre (no bomboloni), Giraffa (solo boni)
  // Abbinamento fatto; l'ORDINE di estrazione (rivelazione) è casuale.
  const pairings = shuffleInPlace(state.horses.slice()).map((entrant) => {
    const drawn = assign.get(entrant);
    entrant.earNumber = drawn.earNumber;
    entrant.horseName = drawn.horseName;
    applyMantoFisso(entrant);             // manto fisso per certi barberi (bianco/nero/grigio)
    entrant.horseTier = drawn.tier;       // fascia (brenna/bono/bombolone)
    // FINESTRA 1800 palii: bombolone SOLO a chi ha una rivale → le altre lo corrono da bono.
    if (bomboloneRivalsOnlyActive() && entrant.horseTier === "bombolone" && !topRivalId(entrant.id)) {
      entrant.horseTier = "bono";
    }
    entrant.staminaMax = drawn.stamina;   // la qualità del cavallo sorteggiato conta in gara
    entrant.stamina = drawn.stamina;
    // FINESTRA 40 palii: l'ISTRICE corre comunque da bombolone (se il pool era vuoto,
    // promuove il cavallo pescato e gli dà fiato da cavallone). Solo su entrant.
    if (entrant.id === "istrice" && istriceBomboloneActive()) {
      entrant.horseTier = "bombolone";
      if (entrant.staminaMax < 92) { entrant.staminaMax = 92 + Math.floor(Math.random() * 9); entrant.stamina = entrant.staminaMax; }
    }
    // Statistiche FISSE del barbero (dal roster).
    entrant.nervousnessBase = undefined;  // ricattura la base sotto (dalla calma)
    entrant.turnsStat = drawn.turns || 3;             // 1 = si gira subito · 5 = regge
    entrant.potenza = drawn.potenza || 3;             // spinta ai canapi
    entrant.calma = drawn.calma || 3;                 // 1 scalcia · 5 fermo piantato
    entrant.scossoStamina = drawn.scossoStamina || 0; // stamina ±X da scosso
    entrant.terzoGiroStamina = drawn.terzoGiroStamina || 0;   // stamina extra ultimo giro
    return { entrant, ...drawn };
  });
  // MAX 3 CAVALLI BIANCHI per palio: i bianchi eccedenti diventano grigi.
  let bianchi = 0;
  pairings.forEach((p) => {
    if (p.entrant.mantoGlb === MANTO_BIANCO) {
      bianchi += 1;
      if (bianchi > 3) applyMantoColor(p.entrant, MANTO_GRIGIO);
    }
  });
  state.tratta = { pairings };
  // Da qui in poi i barberi sono "in attesa di assegnazione": niente spennacchiera
  // finche' il mossiere non chiama la Contrada. Vale sia per i cavalli gia' in
  // scena (gliela nascondo adesso) sia per i GLB che si attaccano piu' tardi.
  state.horses.forEach((h) => {
    h.spennRivelata = false;
    h.attendeSpenn = true;
    const s = h.group && h.group.userData && h.group.userData.spennObj;
    if (s) nascondiSpennacchiera(s);
  });
  state.mode = "tratta";
  setAllestimento("tufo");   // alla Tratta il tufo e' steso ma i palchi non ci sono ancora
  showScreen(null);
  setHudVisible(false);
  startTrattaCeremony3D(pairings);
}

// Costruisce (una volta) gli oggetti 3D della cerimonia: tavolo, due urne e il
// bambino che estrae. Posizionati sul tufo davanti alla fila, rivolti alla camera.
function ensureTrattaObjects() {
  if (state.trattaObjects) return state.trattaObjects;
  const terra = new THREE.MeshStandardMaterial({ color: 0xb2623c, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6b58c, roughness: 0.85 });
  const grp = new THREE.Group();

  // IL PALCO DEI CAPITANI (o "delle trifore"): la cerimonia non si fa per terra,
  // si fa su una pedana di legno davanti al Palazzo, dove stanno il Sindaco, i
  // Capitani delle dieci Contrade e i segretari con le urne.
  // Il palco sta in un SOTTOGRUPPO: cosi' si sposta tutto insieme con una riga.
  // Va a DESTRA della fila dei cavalli, che arriva a x +12.15 — nelle foto le due
  // cose sono affiancate, non sovrapposte.
  const palco = new THREE.Group();
  palco.position.x = 13.2;
  grp.add(palco);
  const PALCO_H = 0.86;                     // quota del piano di calpestio
  const PALCO_L = 8.4, PALCO_P = 3.6;
  // Assito sottile poggiato su MONTANTI che scendono fino al tufo: prima era un
  // blocco pieno appoggiato a quota zero e, siccome davanti al Palazzo il tufo e'
  // piu' basso, restava sospeso per aria.
  const assito = new THREE.Mesh(new THREE.BoxGeometry(PALCO_L, 0.18, PALCO_P), materials.wood);
  assito.position.set(0, PALCO_H, 0.1);
  assito.castShadow = true; assito.receiveShadow = true;
  palco.add(assito);
  const montante = new THREE.MeshStandardMaterial({ color: 0x6b4530, roughness: 0.9 });
  for (let mx = -PALCO_L / 2 + 0.35; mx <= PALCO_L / 2 - 0.34; mx += (PALCO_L - 0.7) / 4) {
    [-1.45, 1.55].forEach((mz) => {
      const g4 = new THREE.Mesh(new THREE.BoxGeometry(0.2, PALCO_H, 0.2), montante);
      g4.position.set(mx, PALCO_H / 2, mz);
      g4.castShadow = true;
      palco.add(g4);
    });
  }
  // Telo chiaro che fascia il palco sul davanti, come nelle foto.
  const telo = new THREE.Mesh(new THREE.BoxGeometry(PALCO_L + 0.1, PALCO_H - 0.1, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.95 }));
  telo.position.set(0, (PALCO_H - 0.1) / 2, 1.94);
  palco.add(telo);
  // Tavolo delle urne, sopra il palco.
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 1.3), materials.wood);
  top.position.y = PALCO_H + 1.0; palco.add(top);
  [[-1.5, -0.5], [1.5, -0.5], [-1.5, 0.5], [1.5, 0.5]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), materials.wood);
    leg.position.set(x, PALCO_H + 0.5, z); palco.add(leg);
  });
  // Le AUTORITA' sul palco, ai lati del tavolo: il Sindaco che convalida e i
  // Capitani in giacca scura. Figure semplici, si vedono di spalle e di fianco.
  const abitoScuro = new THREE.MeshStandardMaterial({ color: 0x23242b, roughness: 0.92 });
  const carnagione = new THREE.MeshStandardMaterial({ color: 0xd7a781, roughness: 0.9 });
  [-3.4, -2.7, -2.0, 2.0, 2.7, 3.4, 3.9].forEach((x, i) => {
    const busto = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.62, 3, 7), abitoScuro);
    busto.position.set(x, PALCO_H + 0.72, -0.25 + (i % 2) * 0.35);
    busto.castShadow = true;
    const testa = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), carnagione);
    testa.position.set(busto.position.x, PALCO_H + 1.24, busto.position.z);
    palco.add(busto, testa);
  });

  // Due urne in terracotta sul tavolo.
  const makeUrn = (x) => {
    const urn = new THREE.Group();
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.12, 14), terra); foot.position.y = 0.06;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), terra); body.scale.set(1, 1.15, 1); body.position.y = 0.5;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.28, 14), terra); neck.position.y = 0.95;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 16), terra); rim.rotation.x = Math.PI / 2; rim.position.y = 1.08;
    urn.add(foot, body, neck, rim);
    urn.position.set(x, PALCO_H + 1.08, 0);
    return urn;
  };
  const urnL = makeUrn(-1.05), urnR = makeUrn(1.05);
  palco.add(urnL, urnR);

  // Bambino che estrae (dietro il tavolo, verso i cavalli, rivolto alla camera).
  const child = new THREE.Group();
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x9c3b34, roughness: 0.9 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.9 });
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.5, 8), legMat); legs.position.y = 0.25;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 10), clothMat); torso.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), skin); head.position.y = 1.12;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), materials.gold); cap.position.y = 1.16;
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 8), skin); armL.position.set(-0.26, 0.92, 0.14); armL.rotation.set(-1.0, 0, 0.3);
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 8), skin); armR.position.set(0.26, 0.92, 0.14); armR.rotation.set(-1.0, 0, -0.3);
  child.add(legs, torso, head, cap, armL, armR);
  child.position.set(0, PALCO_H, -0.95);
  child.scale.setScalar(0.95);
  palco.add(child);

  // ── I BOX DEI BARBERI ─────────────────────────────────────────────────────
  // Nelle foto della Tratta i cavalli non stanno sciolti: sono allineati sotto il
  // Palazzo dentro box aperti, divisi da paratie scure, legati a una transenna di
  // legno, ognuno col suo NUMERO e col barbaresco che lo tiene. La fila dei
  // cavalli la schiera startTrattaCeremony3D: qui si costruisce quello che li
  // contiene, alle stesse coordinate (X = lungo la facciata, Z = verso il Campo).
  {
    const N = 10, PASSO = 2.7, X0 = -12.15;      // gli stessi di startTrattaCeremony3D
    const Z_CAV = TRATTA_ROW_LANE + 1.5;         // i cavalli, in coordinate del gruppo
    const paratia = new THREE.MeshStandardMaterial({ color: 0x3b3a38, roughness: 0.94 });
    const numeroTex = (n) => {
      const c = document.createElement("canvas"); c.width = 128; c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#f2ede0"; x.fillRect(0, 0, 128, 128);
      x.fillStyle = "#1a1206"; x.font = "bold 86px system-ui, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(n), 64, 70);
      return new THREE.CanvasTexture(c);
    };
    for (let i = 0; i < N; i += 1) {
      const x = X0 + i * PASSO;
      // Paratia che divide un barbero dall'altro (una in più per chiudere in fondo).
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 2.3), paratia);
      p.position.set(x - PASSO / 2, 0.68, Z_CAV - 0.2);
      p.castShadow = true; p.receiveShadow = true;
      grp.add(p);
      if (i === N - 1) {
        const ult = p.clone(); ult.position.x = x + PASSO / 2; grp.add(ult);
      }
      // Il NUMERO del barbero, sul montante davanti al suo box.
      const targa = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44),
        new THREE.MeshBasicMaterial({ map: numeroTex(i + 1), side: THREE.DoubleSide }));
      targa.position.set(x, 1.16, Z_CAV + 1.36);   // appesa alla transenna
      grp.add(targa);
      // IL BARBARESCO: sta davanti al suo cavallo e lo tiene alla capezza.
      const camicia = new THREE.MeshStandardMaterial({ color: [0xdedad0, 0x9fb3c8, 0xc9a89a, 0xb9c4a8][i % 4], roughness: 0.93 });
      const busto = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.6, 3, 7), camicia);
      busto.position.set(x - 0.55, 0.7, Z_CAV + 0.7);   // fra il suo barbero e la transenna
      busto.castShadow = true;
      const testa = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xd7a781, roughness: 0.9 }));
      testa.position.set(busto.position.x, 1.2, busto.position.z);
      grp.add(busto, testa);
    }
    // La TRANSENNA davanti alla fila: due correnti di legno su montanti, la
    // barriera oltre la quale sta la folla.
    const LUNG = (N - 1) * PASSO + PASSO;
    [1.02, 0.62].forEach((h) => {
      const corr = new THREE.Mesh(new THREE.BoxGeometry(LUNG, 0.09, 0.09), materials.wood);
      corr.position.set(X0 + (N - 1) * PASSO / 2, h, Z_CAV + 1.4);
      corr.castShadow = true;
      grp.add(corr);
    });
    for (let x = X0 - PASSO / 2; x <= X0 + (N - 1) * PASSO + PASSO / 2 + 0.01; x += PASSO) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), materials.wood);
      m.position.set(x, 0.55, Z_CAV + 1.4);
      m.castShadow = true;
      grp.add(m);
    }
  }

  // Colloca il tavolo al CENTRO DEL RETTILINEO, sotto il Palazzo, girato verso
  // il Campo (la camera): il bambino resta dietro il tavolo, spalle al Palazzo.
  const s = sampleAt(getStraightCenterP());
  const inner = s.normal.clone().normalize();
  grp.position.copy(s.point).addScaledVector(inner, -1.5);
  // Davanti al Palazzo la pista e' ABBASSATA (e' il fondo della conchiglia): senza
  // questa riga tutta la scena della Tratta galleggiava sopra il tufo.
  grp.position.y = trackHeightAt(positiveMod(getStraightCenterP(), track.length));
  grp.rotation.y = Math.atan2(inner.x, inner.z);
  grp.visible = false;
  scene.add(grp);
  state.trattaObjects = { grp, urnL, urnR, child, childY: child.position.y, popTimer: 0 };
  return state.trattaObjects;
}

// Avvia la cerimonia 3D: schiera i cavalli SOTTO IL PALAZZO, punta la camera,
// prepara la timeline. Il Palazzo (con le bandiere dell'estrazione) fa da sfondo.
function startTrattaCeremony3D(pairings) {
  const objs = ensureTrattaObjects();
  objs.grp.visible = true;
  objs.popTimer = 0;
  const pal = ensurePalazzoObjects();
  pal.grp.visible = true;
  const P0 = getStraightCenterP();
  // Fila dei 10 cavalli LUNGO la pista, davanti alla facciata del Palazzo,
  // muso verso il Campo (la camera), fermi (idle).
  state.horses.forEach((h, i) => {
    const prog = P0 - 12.15 + i * 2.7;
    const s = sampleAt(prog);
    h.progress = prog;
    h.prevProgress = prog;
    h.lane = TRATTA_ROW_LANE;
    h.laneVelocity = 0;
    h.speedLevel = 0.5;                    // animazione "idle" (fermo)
    h.targetSpeedLevel = 0.5;
    // Muso verso il Campo: rotazione dal senso di marcia alla direzione interna.
    h.trattaTurn = angleDiff(Math.atan2(s.normal.x, s.normal.z), s.yaw);
    h.heading = undefined;
    h.revealPulse = 0;
    // Alla TRATTA il cavallo è SENZA FANTINO (non ancora assegnato/montato).
    if (h.group.userData.jockey) h.group.userData.jockey.visible = false;
    placeHorse(h, 0);
  });
  // Camera iniziale dal Campo verso il Palazzo (poi ondeggia in updateTratta).
  const s0 = sampleAt(P0);
  const inner0 = s0.normal.clone().normalize();
  state.cameraPosition.copy(s0.point).addScaledVector(inner0, TRACK_HALF_WIDTH + 2.5).add(new THREE.Vector3(0, 4.8, 0));
  state.cameraLook.copy(s0.point).addScaledVector(inner0, -9).add(new THREE.Vector3(0, 3.0, 0));
  // Chiarine d'apertura: solo quando finiscono comincia la chiamata dei cavalli.
  playTrombetti("chiarine");
  // Timeline: PRESENTA (lista dei 10 cavalli in gara, mentre suonano le chiarine)
  // → poi per ogni cavallo, DUE TEMPI: prima il CAVALLO (nome+fascia), pausa, poi
  // la CONTRADA a cui tocca.
  state.tratta.timeline = { idx: 0, phase: "presenta", timer: 5.5, labels: [], done: false };
  buildTrattaHud();
  buildTrattaPresentation(pairings);
}

// Pannello di presentazione: la LISTA dei 10 cavalli che corrono (solo i nomi,
// niente numero), mostrata all'inizio mentre suonano le chiarine.
function buildTrattaPresentation(pairings) {
  const old = document.getElementById("trattaPresenta"); if (old) old.remove();
  const el = document.createElement("div");
  el.id = "trattaPresenta";
  el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:58;"
    + "background:rgba(18,13,8,.9);border:1px solid rgba(240,203,53,.5);border-radius:16px;"
    + "padding:clamp(10px,2.4vh,22px) clamp(16px,4vw,30px);max-width:94vw;max-height:92vh;overflow:auto;"
    + "text-align:center;font-family:inherit;color:#f3e7cf;box-shadow:0 10px 40px rgba(0,0,0,.6)";
  const h = document.createElement("div");
  h.style.cssText = "font-size:clamp(12px,1.8vh,15px);letter-spacing:.14em;text-transform:uppercase;color:#f0cb35;margin-bottom:clamp(6px,1.4vh,12px)";
  h.textContent = "I dieci cavalli che corrono il Palio";
  el.appendChild(h);
  const ul = document.createElement("div");
  ul.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:clamp(3px,0.8vh,6px) 26px;font-size:clamp(13px,1.9vh,17px);font-weight:600;text-align:left";
  // nomi dei cavalli in gara (ordine dei cavalli, non degli abbinamenti), senza numero
  const nomi = pairings.map((p) => p.horseName).sort((a, b) => a.localeCompare(b, "it"));
  nomi.forEach((nome, i) => {
    const li = document.createElement("div");
    li.textContent = "•  " + nome;
    li.style.opacity = "0";
    li.style.transition = "opacity .35s ease";
    setTimeout(() => { li.style.opacity = "1"; }, 200 + i * 180);   // compaiono a cascata
    ul.appendChild(li);
  });
  el.appendChild(ul);
  document.body.appendChild(el);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Cartello 3D (sprite da canvas) sopra al cavallo. Due versioni:
//   withContrada=false → solo numero d'orecchio, nome del CAVALLO e fascia
//     (Brenna/Bono/Bombolone): è la prima chiamata del banditore.
//   withContrada=true  → completo di Contrada, colori e "LA TUA CONTRADA":
//     è l'ufficializzazione dell'accoppiata, dopo la pausa.
function createTrattaLabel(p, withContrada = true) {
  const W = 512, H = 256;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const meta = TRATTA_TIERS[p.tier] || TRATTA_TIERS.bono;
  roundRectPath(ctx, 8, 8, W - 16, H - 16, 28);
  ctx.fillStyle = "rgba(18,13,8,0.92)"; ctx.fill();
  const isPlayerFull = withContrada && p.entrant.player;
  ctx.lineWidth = isPlayerFull ? 9 : 3;
  ctx.strokeStyle = isPlayerFull ? "#f0cb35" : "rgba(240,203,53,0.55)"; ctx.stroke();
  // NOME DEL CAVALLO protagonista (niente numero d'orecchio).
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f5ecd8"; ctx.font = "bold 52px sans-serif";
  ctx.fillText(p.horseName, 40, withContrada ? 88 : 118);
  if (withContrada) {
    ctx.fillStyle = "#cfc3aa"; ctx.font = "32px sans-serif"; ctx.fillText(p.entrant.name, 40, 138);
    // bandierine dei colori della contrada
    (p.entrant.colors || []).forEach((col, i) => {
      ctx.fillStyle = col; ctx.fillRect(40 + i * 30, 162, 26, 34);
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.strokeRect(40 + i * 30, 162, 26, 34);
    });
    if (p.entrant.player) {
      ctx.fillStyle = "#f0cb35"; ctx.font = "bold 22px sans-serif";
      ctx.fillText("LA TUA CONTRADA", 150, 186);
    }
  } else {
    // In attesa dell'abbinamento: puntini di suspense al posto della contrada.
    ctx.fillStyle = "rgba(207,195,170,.55)"; ctx.font = "32px sans-serif";
    ctx.fillText("a chi tocca…", 40, 158);
  }
  // pill della fascia (sempre visibile: la qualità si rivela col cavallo)
  const pw = 176, ph = 54, px = W - pw - 26, py = H - ph - 26;
  roundRectPath(ctx, px, py, pw, ph, 27);
  ctx.globalAlpha = 0.2; ctx.fillStyle = meta.fg; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 3; ctx.strokeStyle = meta.fg; ctx.stroke();
  ctx.fillStyle = meta.fg; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(meta.label, px + pw / 2, py + ph / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(5.0, 2.5, 1);
  spr.renderOrder = 999;
  return spr;
}

function disposeTrattaLabel(l) {
  scene.remove(l.spr);
  if (l.spr.material.map) l.spr.material.map.dispose();
  l.spr.material.dispose();
}

// PRIMA chiamata del banditore: solo il CAVALLO (numero, nome, fascia). Il
// cartello appare sull'urna/tavolo (l'abbinamento non è ancora noto) e la voce
// pronuncia il nome. La contrada arriva dopo una pausa (announceTrattaContrada).
function announceTrattaHorse(p) {
  const T = state.tratta.timeline;
  // i cartelli precedenti (non del giocatore) sfumano
  T.labels.forEach((l) => { if (!l.entrant || !l.entrant.player) l.fading = true; });
  const spr = createTrattaLabel(p, false);
  // sopra il tavolo delle urne (il cavallo non si indica ancora)
  const t = state.trattaObjects ? state.trattaObjects.grp.position : p.entrant.group.position;
  spr.position.set(t.x, t.y + 4.6, t.z);
  scene.add(spr);
  T.labels.push({ spr, entrant: null, anchor: "table", alpha: 1, fading: false, partial: true });
  if (state.trattaObjects) state.trattaObjects.popTimer = 0.4;
  // Il canto della Contrada assegnata prima sfuma quando si chiama il cavallo dopo.
  if (state.tratta && state.tratta.lastJingle) { fadePalioSound(state.tratta.lastJingle, 0.5); state.tratta.lastJingle = null; }
  playNitrito(0.55);                             // il barbero nitrisce alla chiamata
  speakContrada(p.horseName);                    // voce del mossiere: il cavallo
  const line = document.getElementById("trattaLine");
  if (line) {
    const meta = TRATTA_TIERS[p.tier] || TRATTA_TIERS.bono;
    line.textContent = `${p.horseName} · ${meta.label}…`;
    line.style.color = meta.fg;
  }
}

// SECONDA chiamata: la CONTRADA. Il cartello parziale sparisce, quello completo
// si aggancia al cavallo assegnato; voce, saltello del cavallo e riga del
// pannello a destra che si compila.
function announceTrattaContrada(p) {
  const T = state.tratta.timeline;
  T.labels = T.labels.filter((l) => { if (l.partial) { disposeTrattaLabel(l); return false; } return true; });
  const spr = createTrattaLabel(p, true);
  const base = p.entrant.group.position;
  spr.position.set(base.x, base.y + 3.6, base.z);
  scene.add(spr);
  T.labels.push({ spr, entrant: p.entrant, alpha: 1, fading: false });
  p.entrant.revealPulse = 1;
  // Adesso il barbero ha una Contrada: la spennacchiera compare sulla sua fronte.
  p.entrant.spennRivelata = true;
  p.entrant.attendeSpenn = false;
  mostraSpennacchiera(p.entrant.group.userData && p.entrant.group.userData.spennObj);
  if (state.trattaObjects) state.trattaObjects.popTimer = 0.4;
  speakContrada(p.entrant.name);                 // voce del mossiere: la contrada
  // Canto/grido della Contrada appena assegnata (sfuma alla chiamata successiva).
  if (p.entrant && p.entrant.id) { state.tratta.lastJingle = p.entrant.id + ".m4a"; try { playPalioSound(state.tratta.lastJingle, { volume: 0.62 }); } catch (e) { /* niente */ } }
  // REAZIONE DEL POPOLO in base al cavallo toccato: bombolone → esultanza
  // piena; bono → applauso contenuto e attesa; brenna → freddezza e delusione.
  const you = p.entrant.player;
  if (p.tier === "bombolone") {
    triggerCrowdReaction("cheer", you ? `${p.horseName}: un bombolone! La tua Contrada esulta` : `${p.entrant.name}: gran cavallo! Il popolo esulta`);
  } else if (p.tier === "bono") {
    triggerCrowdReaction("mild", `${p.entrant.name}: cavallo discreto, applausi e attesa`);
  } else {
    triggerCrowdReaction("cold", you ? `${p.horseName}: una brenna… gelo nella tua Contrada` : `${p.entrant.name}: brenna, freddezza e delusione`);
  }
  fillTrattaPanelRow(p);
  const line = document.getElementById("trattaLine");
  if (line) {
    const meta = TRATTA_TIERS[p.tier] || TRATTA_TIERS.bono;
    line.textContent = `${p.horseName}  →  ${p.entrant.name}${p.entrant.player ? "  (la tua!)" : ""}  ·  ${meta.label}`;
    line.style.color = meta.fg;
  }
}

function trattaAllRevealed() {
  if (state.tratta.timeline) state.tratta.timeline.done = true;
  // Rete di sicurezza: a cerimonia finita tutti hanno la loro spennacchiera,
  // anche i barberi la cui chiamata fosse stata saltata.
  (state.horses || []).forEach((h) => {
    h.spennRivelata = true;
    h.attendeSpenn = false;
    mostraSpennacchiera(h.group.userData && h.group.userData.spennObj, true);
  });
  const skip = document.getElementById("trattaSkipBtn");
  const go = document.getElementById("trattaGoBtn");
  if (skip) skip.style.display = "none";
  if (go) go.style.display = "";
}

function trattaSkip() {
  const T = state.tratta.timeline;
  if (!T) return;
  const pres = document.getElementById("trattaPresenta"); if (pres) pres.remove();
  // Cartelli in corso via (compreso l'eventuale parziale), pannello completato.
  T.labels.forEach(disposeTrattaLabel);
  T.labels = [];
  state.tratta.pairings.forEach((p, k) => {
    fillTrattaPanelRow(p);
    // resta a schermo solo il cartello completo della TUA contrada
    if (p.entrant.player) {
      const spr = createTrattaLabel(p, true);
      const b = p.entrant.group.position;
      spr.position.set(b.x, b.y + 3.6, b.z);
      scene.add(spr);
      T.labels.push({ spr, entrant: p.entrant, alpha: 1, fading: false });
    }
  });
  T.idx = state.tratta.pairings.length;
  T.phase = "done";
  trattaAllRevealed();
}

// Chiude la cerimonia: rimuove cartelli/HUD, nasconde gli oggetti, avvia la mossa.
// PALIATA VELOCE: attiva un'economia "usa e getta" (budget + rivale) così ANCHE
// qui si fanno accordi e corruzione, riusando il flusso campagna ma senza carriera
// (quick:true → niente ingaggio a pagamento, niente progressione, niente esperto
// forzato). Il fantino resta a scelta libera; il budget serve per accordi/corruzione.
// Viene chiamata PRIMA della scelta cavalli (subito dopo l'estrazione), quindi gli
// entranti possono non esistere ancora: in quel caso la Contrada del giocatore si
// prende da state.selectedContrada e la rivale dalla mappa RIVALS.
function setupQuickEconomy() {
  const player = getPlayer();
  const contrada = (player && CONTRADE.find((c) => c.id === player.id)) || state.selectedContrada;
  if (!contrada) return;
  const rid = (player && topRunningRivalId(player.id))
    || (RIVALS[contrada.id] ? Object.keys(RIVALS[contrada.id])[0] : null);
  const rival = CONTRADE.find((c) => c.id === rid) || CONTRADE.find((c) => c.id !== contrada.id) || contrada;
  // Tesoro PERSISTENTE: ognuna riparte da dove era rimasta (5000 alla primissima
  // partita di questo account), mai da capo.
  const budgets = loadPersistentBudgets();
  // Le 10 estratte: servono al voto dei cavalli (quanti Capitani AI votano).
  const draw = (state.estrazione && (state.estrazione.participants || state.estrazione.drawn)) || [];
  state.campaign = {
    active: true, quick: true, contrada, rival, budgets, budget: budgets[contrada.id],
    accordi: [], corrupted: {}, incomingAccordi: null,
    currentDraw: draw.slice(),
    currentMode: "play", wins: 0, purghe: 0, log: [], palioIndex: 0, recorded: false,
  };
}

function endTratta() {
  const pres = document.getElementById("trattaPresenta"); if (pres) pres.remove();
  const T = state.tratta && state.tratta.timeline;
  if (T) {
    T.labels.forEach((l) => {
      scene.remove(l.spr);
      if (l.spr.material.map) l.spr.material.map.dispose();
      l.spr.material.dispose();
    });
    T.labels = [];
  }
  if (state.trattaObjects) state.trattaObjects.grp.visible = false;
  const hud = document.getElementById("trattaHud"); if (hud) hud.remove();
  // Paliata veloce (o non-campagna): l'economia one-off è già stata creata prima
  // della scelta cavalli; qui si crea SOLO se manca (percorsi che saltano l'estrazione),
  // altrimenti si azzererebbero budget/accordi appena impostati.
  if (!state.campaign || !state.campaign.active) setupQuickEconomy();
  beginSceltaFantino();
}

// ══ SCELTA DEL FANTINO ═══════════════════════════════════════════════════════
// Dopo la Tratta ogni Contrada sceglie il fantino. Parametri (1..5):
//   Mossa   — quanto è bravo alla partenza (posizionamento, scatto pulito);
//   Difesa  — quanto tiene la posizione / marca / non si fa passare;
//   Terzo giro — quanto rende nel finale (tenuta nell'ultimo giro).
// Fantini reali (dal più forte al più scarso) + tre fittizi.
const JOCKEYS_MODERNI = [
  // fedelta 1-5 = lealtà alla contrada che lo ingaggia (bassa = corruttibile); ingaggio = costo.
  // curva 1-5 = tenuta in curva: alta = cade di rado su un urto (5 ≈ 10%), bassa = cade spesso (1 ≈ 90%).
  { epoca: "moderno", nome: "Giovanni Atzeni", nick: "Tittìa", mossa: 5, difesa: 1, terzo: 3, fedelta: 3, curva: 3, ingaggio: 130 },
  { epoca: "moderno", nome: "Jonatan Bartoletti", nick: "Scompiglio", mossa: 4, difesa: 3, terzo: 4, fedelta: 2, curva: 4, ingaggio: 105 },
  { epoca: "moderno", nome: "Andrea Mari", nick: "Brio", mossa: 4, difesa: 4, terzo: 3, fedelta: 5, curva: 4, ingaggio: 90 },
  { epoca: "moderno", nome: "Giuseppe Zedde", nick: "Gingillo", mossa: 3, difesa: 4, terzo: 5, fedelta: 3, curva: 4, ingaggio: 95 },
  { epoca: "moderno", nome: "Andrea Coghe", nick: "Tempesta", mossa: 3, difesa: 3, terzo: 3, fedelta: 2, curva: 3, ingaggio: 80 },
  { epoca: "moderno", nome: "Carlo Sanna", nick: "Brigante", mossa: 3, difesa: 3, terzo: 3, fedelta: 2, curva: 3, ingaggio: 50 },
  { epoca: "moderno", nome: "Sebastiano Murtas", nick: "Grandine", mossa: 3, difesa: 3, terzo: 2, fedelta: 2, curva: 2, ingaggio: 45 },
  { epoca: "moderno", nome: "Federico Guglielmi", nick: "Tamurè", mossa: 2, difesa: 3, terzo: 2, fedelta: 4, curva: 3, ingaggio: 28 },
  { epoca: "moderno", nome: "Battista Corda", nick: "Grido", mossa: 3, difesa: 5, terzo: 5, fedelta: 2, curva: 1, ingaggio: 80, fittizio: true },
  { epoca: "moderno", nome: "Efisio Melis", nick: "Veleno", mossa: 2, difesa: 5, terzo: 1, fedelta: 4, curva: 2, ingaggio: 40, fittizio: true },
  { epoca: "moderno", nome: "Enrico Bruschelli", nick: "Bellocchio", mossa: 2, difesa: 3, terzo: 3, fedelta: 3, curva: 3, ingaggio: 42, fittizio: true },
  { epoca: "moderno", nome: "Salvatore Loi", nick: "Peto", mossa: 1, difesa: 4, terzo: 4, fedelta: 1, curva: 1, ingaggio: 8, fittizio: true },
  { epoca: "moderno", nome: "Diego Minucci", nick: "Fastidio", mossa: 1, difesa: 2, terzo: 4, fedelta: 4, curva: 5, ingaggio: 32, fittizio: true },
  // Il "fedelissimo": incorruttibile (fedeltà 5) ma scarso in tutto e GRATIS.
  { epoca: "moderno", nome: "Michele Serra", nick: "Fedele", mossa: 1, difesa: 1, terzo: 1, fedelta: 5, curva: 1, ingaggio: 0, fittizio: true },
];

// ── I FANTINI DEL PALIO STORICO (fino ad Aceto) ─────────────────────────────
// La generazione che ha corso dagli anni Cinquanta alla meta' dei Novanta. In
// testa Andrea Degortes detto Aceto, quattordici Palii: nel gioco e' il piu'
// forte in assoluto, come lo era in Piazza. Come per i moderni, accanto ai
// fantini veri ci sono alcuni nomi di fantasia (fittizio: true) che servono a
// riempire il lotto: le statistiche inventate non vanno messe in bocca a
// persone realmente esistite.
const JOCKEYS_STORICI = [
  { epoca: "storico", nome: "Andrea Degortes", nick: "Aceto", mossa: 5, difesa: 5, terzo: 4, fedelta: 3, curva: 4, ingaggio: 140 },
  { epoca: "storico", nome: "Silvano Vigni", nick: "Bazzino", mossa: 4, difesa: 4, terzo: 4, fedelta: 3, curva: 4, ingaggio: 100 },
  { epoca: "storico", nome: "Giuseppe Gentili", nick: "Ciancone", mossa: 4, difesa: 4, terzo: 3, fedelta: 4, curva: 3, ingaggio: 95 },
  { epoca: "storico", nome: "Sebastiano Deledda", nick: "Bastiano", mossa: 3, difesa: 4, terzo: 4, fedelta: 3, curva: 4, ingaggio: 90 },
  { epoca: "storico", nome: "Salvatore Ladu", nick: "Il Pesse", mossa: 4, difesa: 3, terzo: 3, fedelta: 2, curva: 3, ingaggio: 85 },
  { epoca: "storico", nome: "Leonardo Viti", nick: "Legno", mossa: 3, difesa: 3, terzo: 4, fedelta: 4, curva: 3, ingaggio: 70 },
  { epoca: "storico", nome: "Massimo Coghe", nick: "Falchino", mossa: 3, difesa: 3, terzo: 3, fedelta: 3, curva: 3, ingaggio: 60 },
  { epoca: "storico", nome: "Vittorio Pisani", nick: "Vittorino", mossa: 3, difesa: 2, terzo: 3, fedelta: 3, curva: 3, ingaggio: 48 },
  { epoca: "storico", nome: "Ottavio Bertini", nick: "Ganascia", mossa: 4, difesa: 2, terzo: 2, fedelta: 1, curva: 2, ingaggio: 55, fittizio: true },
  { epoca: "storico", nome: "Nello Vanni", nick: "Tramonto", mossa: 2, difesa: 4, terzo: 4, fedelta: 3, curva: 3, ingaggio: 44, fittizio: true },
  { epoca: "storico", nome: "Pietro Serra", nick: "Zurlino", mossa: 2, difesa: 3, terzo: 3, fedelta: 2, curva: 4, ingaggio: 35, fittizio: true },
  { epoca: "storico", nome: "Bruno Cinelli", nick: "Nespola", mossa: 3, difesa: 2, terzo: 2, fedelta: 2, curva: 2, ingaggio: 26, fittizio: true },
  { epoca: "storico", nome: "Antonio Marras", nick: "Sbigo", mossa: 1, difesa: 4, terzo: 3, fedelta: 1, curva: 1, ingaggio: 14, fittizio: true },
  // Il "fedelissimo" dell'epoca: incorruttibile ma scarso, e gratis.
  { epoca: "storico", nome: "Renzo Bindi", nick: "Il Sordo", mossa: 1, difesa: 1, terzo: 1, fedelta: 5, curva: 1, ingaggio: 0, fittizio: true },
];

// Riempito da applicaEpoca(): i fantini della sola epoca scelta. Resta lo stesso
// array (mai riassegnato) perche' i fantini proposti dai giocatori ci finiscono
// dentro con push.
const JOCKEYS = [];


// "Forza" complessiva del fantino (per far scegliere le AI dai più bravi).
function jockeyStrength(j) { return j.mossa + j.difesa + j.terzo; }

// Moltiplicatore di velocità del TERZO GIRO: attivo solo nell'ultimo giro, in
// base al parametro "terzo giro" del fantino (3 = neutro; 5 ≈ +5%; 1 ≈ −5%).
function jkTerzoMult(horse) {
  if ((horse.progress || 0) < track.length * (FINISH_LAPS - 1)) return 1;
  return 1 + ((horse.jkTerzo ?? 3) - 3) * 0.025;
}

// Moltiplicatore di VELOCITÀ per fascia del cavallo: è QUI la grossa differenza
// fra le fasce (più della stamina). Bombolone ×1.1, bono ×1, brenna ×0.9. In gara
// veloce (senza Tratta) il cavallo non ha fascia → ×1 per tutti.
const TIER_SPEED = { brenna: 0.95, bono: 1.0, bombolone: 1.04 };
function tierSpeedMult(horse) { return TIER_SPEED[horse.horseTier] || 1; }
// Handicap del GIOCATORE nel TERZO (ultimo) giro: bono −0,03 · bombolone −0,02.
// Frazione di palii in cui il giocatore è "favorito" (handicap tolti). Regola il
// win rate MEDIO verso ~4%: alzala per farlo vincere più spesso, abbassala per meno.
// (È la manopola da tarare sui dati reali del win rate in admin.)
// OBIETTIVO DICHIARATO: su 10.000 palii corsi dai giocatori, 200-250 vinti da
// loro (2,0%-2,5%). Non c'è più una costante che lo impone: quel numero deve
// USCIRE dagli ostacoli in pista (handicap di posizione, del terzo giro, freno
// del leader, aggressività delle AI, limite dei sorpassi). Si misura sul database
// — campi `palii` e `vinti` degli account — e si tara agendo su quegli ostacoli.
// Alla rimozione del gate il dato reale era 333 vittorie su 7.857 palii = 4,24%.
function playerThirdLapHandicap(horse) {
  if (!horse.player) return 1;
  // Handicap giocatore SEMPRE: −0,02 di velocità (oltre al deficit-stamina già impostato).
  let h = 0.02;
  // Ultimo giro: extra per fascia — bono −0,03, bombolone −0,02 (in aggiunta).
  if ((horse.progress || 0) >= track.length * (FINISH_LAPS - 1)) {
    if (horse.horseTier === "bono") h += 0.03;
    else if (horse.horseTier === "bombolone") h += 0.02;
    // Handicap per ANDATURA all'ultimo giro: velocità 4 → −0,02 · velocità 5 → −0,03.
    // Alleggerito (era −0,05 e −0,08): puniva proprio il gesto di provare a vincere,
    // e la volata finale — il modo naturale di giocarsi il palio — era la scelta
    // più penalizzata di tutte.
    const sp = Math.round(horse.speedSetting || 0);
    if (sp >= 5) h += 0.03;
    else if (sp === 4) h += 0.02;
  }
  return 1 - h;
}

// ── RUBBER-BAND: freno alle prime DUE Contrade ───────────────────────────────
// A livello di emozione non è bello quando la testa scappa e il Palio è già deciso.
// Frenano sia il 1° sia il 2°, ciascuno in proporzione al VANTAGGIO su chi lo segue
// (il 1° sul 2°, il 2° sul 3°): sotto SOFT nessun freno (un margine piccolo resta),
// poi la velocità scende fino a FLOOR avvicinandosi a GAP_MAX. GAP_MAX (=30) è nelle
// STESSE unità del "+Nm" mostrato nel leaderboard.
// Il tetto rigido dei 30 (1°–2°) è garantito a parte, dal clamp in updateRace.
// Molla delle ultime due: comincia a 9 di distacco dal primo e arriva al massimo
// a 30. Tarata sui punti voluti: a 18 di distacco +3%, a 24 +5%, a 30 +7%.
// Prima saliva fino a +20% e da sola richiudeva il gruppo: con 30 di distacco
// l'ultimo correva un quinto più veloce del primo.
const LEADER_GAP_SOFT = 9;
const LEADER_GAP_MAX = 30;
// HANDICAP DI POSIZIONE del GIOCATORE: 1°=−0,04 · 2°=−0,05 · 3°=−0,04 · 4°=−0,02.
// Dal 5° in giù: nessuna penalità. Posizione = quanti cavalli hanno più progress
// (distanza cumulativa). Silenzioso.
function playerPositionHandicap(player) {
  if (!player || state.mode !== "race") return 1;
  let ahead = 0;
  for (const h of state.horses) {
    if (h === player || h.isRincorsa) continue;
    if ((h.progress || 0) > (player.progress || 0)) ahead += 1;
  }
  const pos = ahead + 1;   // 1 = primo
  if (pos === 1) return 0.96;   // −0,04
  if (pos === 2) return 0.95;   // −0,05
  if (pos === 3) return 0.96;   // −0,04
  if (pos === 4) return 0.98;   // −0,02
  return 1;
}
// −0,01 al GIOCATORE per TUTTO il primo giro di Piazza, a prescindere (zavorra dichiarata).
function playerFirstLapMult(player) {
  if (!player || state.mode !== "race") return 1;
  return (Math.floor(Math.max(0, player.progress) / track.length) === 0) ? 0.99 : 1;
}
// +0,01 di velocità alle ULTIME TRE in classifica, sempre (giocatore compreso).
// È una spinta fissa e minima, indipendente dal distacco: serve a non far sfilacciare
// la coda, senza la molla proporzionale di lastBoostMult.
function ultime3Mult(horse) {
  if (!horse || !state.ultime3Ids || state.ultime3Ids.indexOf(horse.id) < 0) return 1;
  return horse.finishTime ? 1 : 1.01;
}
function leaderBrakeMult(horse) {
  // RALLENTATORE DEL PRIMO (giocatore o AI, stesse regole): scaglioni sul distacco
  // dal TERZO in classifica. Nessuna molla, nessun richiamo elastico: solo un filo
  //   gap >= 6 → −0,01 · >= 10 → −0,02 · >= 15 → −0,03 · >= 19 → −0,04
  if (!horse || horse.id !== state.leaderBrakeId) return 1;   // solo chi è PRIMO
  const terzo = state.secondBrakeThirdProg;                   // posta del 3°
  if (terzo == null) return 1;
  const gap = horse.progress - terzo;
  if (gap >= 19) return 0.96;
  if (gap >= 15) return 0.97;
  if (gap >= 10) return 0.98;
  if (gap >= 6) return 0.99;
  return 1;
}

// ── RUBBER-BAND, l'altra metà: SPINTA alle ultime DUE Contrade ────────────────
// Simmetrico al freno del leader: le due Contrade in fondo alla classifica
// accelerano in proporzione al distacco DAL PRIMO, così restano in scia e la coda
// non si sfilaccia. Sotto SOFT nessuna spinta; poi la velocità sale fino a CEIL
// avvicinandosi a GAP_MAX (stesse unità del "+Nm" a schermo). CEIL 1.4 = +40%,
// speculare al pavimento 0.6 del freno.
const LAST_BOOST_CEIL = 1.07;  // +7% al massimo (era 1.2, e prima ancora 1.4)
function lastBoostMult(horse) {
  if (!horse || !state.lastBoostIds || state.lastBoostIds.indexOf(horse.id) < 0) return 1;
  if (horse.finishTime) return 1;
  const leaderProg = state.leaderBrakeLeaderProg;
  if (leaderProg == null) return 1;
  const gap = leaderProg - horse.progress;      // quanto è indietro rispetto al primo
  if (gap <= LEADER_GAP_SOFT) return 1;
  const t = clamp((gap - LEADER_GAP_SOFT) / (LEADER_GAP_MAX - LEADER_GAP_SOFT), 0, 1);
  return lerp(1, LAST_BOOST_CEIL, t);
}

// TIP NASCOSTA (silenziosa, tutti i palii): ogni contrada ha un mini-acceleratore
// proporzionale al NUMERO DI ACCORDI stretti (con contrade e con fantini). Lineare:
// 5 accordi = spinta 5× di chi ne ha 1. Non segnalato ai giocatori.
// K=0.6% per accordo, TETTO +3%: sempre SOTTO un gradino di fascia (bono→bombolone
// +4%, brenna→bono +5.3%), così la fascia resta più decisiva degli accordi. Il tetto
// scatta a 5 accordi → 1→5 resta lineare (5 accordi = 5× di 1), poi si stabilizza.
const ACCORDI_SPEED_K = 0.006;
const ACCORDI_SPEED_CAP = 0.03;
function accordiCount(cmp, id) {
  if (!cmp || !id) return 0;
  let n = 0;
  (cmp.accordi || []).forEach((a) => { if (a.helper === id || a.beneficiary === id || a.sponsor === id) n += 1; });
  const cor = cmp.corrupted || {};
  Object.keys(cor).forEach((hid) => { if (cor[hid] === id) n += 1; });   // fantini corrotti pagati da lei
  return n;
}
function accordiSpeedMult(horse) {
  const cmp = state.campaign;
  if (!cmp || !cmp.active || !horse || horse.isRincorsa) return 1;
  return 1 + Math.min(ACCORDI_SPEED_CAP, ACCORDI_SPEED_K * accordiCount(cmp, horse.id));
}

function beginSceltaFantino() {
  state.mode = "scelta";
  const player = getPlayer();
  state.scelta = {
    taken: {},            // nick → contrada.id
    rifiuti: {},          // nick → true se ti ha detto di no (deciso una volta per palio)
    assigned: {},         // contrada.id → jockey
    playerPicked: false,
    aiHorses: state.horses.filter((h) => !h.player),
    done: false,
    // Il fantino si PAGA sempre, anche in paliata veloce: lì l'economia one-off
    // esiste già (budget per accordi e corruzione), quindi mostrare costo e
    // FEDELTÀ ha senso — la fedeltà decide costo di accordi/corruzione e chi le AI
    // provano a comprare. Prima era attivo solo in Campagna e nella veloce la
    // scheda del fantino nascondeva sia il prezzo sia la fedeltà.
    ingaggio: !!(state.campaign && state.campaign.active),
  };
  buildSceltaFantinoUI();
  // Marcia del Palio (coi tamburi) in SOTTOFONDO per tutta la preparazione: da qui
  // — scelta/ingaggio del fantino → accordi → corruzione — in loop, finché non
  // suona il Sunto alla mossa (startMossa fa stopPalioSounds e la interrompe).
  try { playPalioSound("MARCIADELPALIOCONTAMBURI.mp3", { volume: 0.42, loop: true }); } catch (e) { /* niente */ }
  // Countdown 45s: puoi scegliere e CAMBIARE il fantino finché non scade (o finché
  // non premi Conferma). Allo scadere si chiude con la scelta corrente (vedi
  // finalizeScelta, che assegna d'ufficio se non hai scelto).
  let left = 45;
  const cd = document.getElementById("sfCountdown");
  if (cd) cd.textContent = left + "s";
  state.scelta.countdown = setInterval(() => {
    left -= 1;
    if (cd) cd.textContent = Math.max(0, left) + "s";
    if (left <= 0) finalizeScelta();
  }, 1000);
  // Le AI scelgono nell'arco di 40s, scaglionate (chi prima chi dopo).
  const order = shuffleInPlace(state.scelta.aiHorses.slice());
  order.forEach((h, i) => {
    const when = 2500 + i * (34000 / order.length) + Math.random() * 1500; // ~2.5s → ~40s
    const t = setTimeout(() => aiPickJockey(h), when);
    (state.scelta.aiTimers = state.scelta.aiTimers || []).push(t);
  });
}

// ── I FANTINI POSSONO DIRTI DI NO ──────────────────────────────────────────
// Con una brenna sotto la sella i più forti non ti montano: hanno una carriera da
// difendere e il Palio si vince col cavallo. Più il fantino è bravo e più il
// barbero è scarso, più è probabile il rifiuto. Con un bombolone non rifiuta
// nessuno: quel cavallo lo vogliono tutti.
// La decisione si prende UNA VOLTA per palio e resta: se riclicchi, il no è
// sempre quello — non si tenta la fortuna cliccando dieci volte.
function fantinoRifiuta(j) {
  const p = getPlayer();
  if (!p || !j) return false;
  state.scelta.rifiuti = state.scelta.rifiuti || {};
  if (state.scelta.rifiuti[j.nick] !== undefined) return state.scelta.rifiuti[j.nick];
  const tier = p.horseTier || "bono";
  // forza del fantino, 0..1 (le stat vanno da 3 a 15 sommate)
  const forza = clamp((jockeyStrength(j) - 3) / 12, 0, 1);
  let prob = 0;
  if (tier === "brenna") prob = 0.15 + forza * 0.55;   // dal 15% al 70% per i migliori
  else if (tier === "bono") prob = forza * 0.18;       // fino al 18% solo per i top
  // il fedelissimo (ingaggio 0) non rifiuta mai: è quello che monta sempre
  if ((j.ingaggio || 0) === 0) prob = 0;
  const esito = Math.random() < prob;
  state.scelta.rifiuti[j.nick] = esito;
  return esito;
}

function availableJockeys() {
  return JOCKEYS.filter((j) => !state.scelta.taken[j.nick] && !fantinoSqualificato(j.nick));
}

// BLOCCO FANTINO AVVERSARIO (campagna): un fantino che ha montato per TE non può
// montare per la RIVALE nei 3 palii successivi, e viceversa.
function fantinoBloccatoLato(nick, latoRichiesto) {
  const cmp = state.campaign;
  if (!cmp || !cmp.jkLock) return false;
  const l = cmp.jkLock[nick];
  if (!l) return false;
  const altro = latoRichiesto === "player" ? "rival" : "player";   // bloccato se montò di recente per l'ALTRO lato
  if (l.side !== altro) return false;
  const d = (cmp.palioIndex || 0) - (l.palio || 0);
  return d >= 1 && d <= 3;   // i 3 palii successivi
}
function fantinoBloccatoPerGiocatore(nick) { return fantinoBloccatoLato(nick, "player"); }

// Assegna un fantino a una contrada, applica i parametri al cavallo, aggiorna UI.
function assignJockey(horse, jockey, isPlayer) {
  if (!horse || state.scelta.taken[jockey.nick]) return;
  state.scelta.taken[jockey.nick] = horse.id;
  state.scelta.assigned[horse.id] = jockey;
  horse.jockey = jockey;
  // Registra il "lato" (te o rivale) per il blocco dei 3 palii successivi.
  const cmpJ = state.campaign;
  if (cmpJ && cmpJ.jkLock) {
    if (cmpJ.contrada && horse.id === cmpJ.contrada.id) cmpJ.jkLock[jockey.nick] = { side: "player", palio: cmpJ.palioIndex };
    else if (cmpJ.rival && horse.id === cmpJ.rival.id) cmpJ.jkLock[jockey.nick] = { side: "rival", palio: cmpJ.palioIndex };
  }
  horse.jkMossa = jockey.mossa; horse.jkDifesa = jockey.difesa; horse.jkTerzo = jockey.terzo;
  // I parametri incidono sull'indole alla mossa (reattività/stabilità) e sono
  // usati in corsa da collisioni/marcatura (difesa) e finale (terzo giro).
  horse.reactivity = clamp(0.3 + (jockey.mossa - 1) * 0.16, 0.2, 0.98);
  horse.stability = clamp(0.28 + (jockey.mossa - 1) * 0.16, 0.2, 0.98);
  if (state.scelta.ingaggio) spendBudget(horse.id, jockey.ingaggio || 0);   // paga l'ingaggio
  if (isPlayer) {
    state.scelta.playerPicked = true;
    refreshSfBudget();
    const cb = document.getElementById("sfConfirmBtn"); if (cb) cb.style.display = "";   // ora puoi confermare
  }
  const card = document.querySelector('.sf-card[data-nick="' + cssEscape(jockey.nick) + '"]');
  if (card) {
    card.classList.add(isPlayer ? "mine" : "taken");   // la TUA card resta chiara ed evidenziata
    const tag = card.querySelector(".sf-taken");
    if (tag) tag.textContent = isPlayer ? "LA TUA SCELTA" : horse.name;
  }
  // NIENTE fine anticipata: la scelta si chiude solo a tempo scaduto o con Conferma
  // (così puoi cambiare fantino finché non scade il tempo).
}

function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "_"); }

function aiPickJockey(horse) {
  if (!state.scelta || state.scelta.assigned[horse.id]) return;
  let avail = availableJockeys();
  if (!avail.length) return;
  // La RIVALE non può ingaggiare un fantino che ha montato per TE negli ultimi 3 palii.
  const cmpA = state.campaign;
  if (cmpA && cmpA.rival && horse.id === cmpA.rival.id) {
    const filt = avail.filter((j) => !fantinoBloccatoLato(j.nick, "rival"));
    if (filt.length) avail = filt;
  }
  // In campagna la contrada AI può ingaggiare solo ciò che il suo budget copre
  // (se non arriva a niente, prende il più economico rimasto — es. Peto a 10).
  if (state.scelta.ingaggio) {
    const b = contradaBudget(horse.id);
    const aff = avail.filter((j) => (j.ingaggio || 0) <= b);
    avail = aff.length ? aff : avail.slice().sort((a, c) => (a.ingaggio || 0) - (c.ingaggio || 0)).slice(0, 1);
  }
  // Le AI tendono a preferire i fantini più forti: scelta pesata sulla forza,
  // con un pizzico di casualità (non sempre il migliore va alla prima).
  avail.sort((a, b) => jockeyStrength(b) - jockeyStrength(a));
  const pick = avail[Math.min(avail.length - 1, Math.floor(Math.random() * Math.random() * 3))];
  assignJockey(horse, pick, false);
}

// Scelta/CAMBIO del fantino del giocatore. Si può cambiare finché non scade il
// tempo (o finché non si preme Conferma): cambiare RIMBORSA il precedente, paga il
// nuovo e libera il vecchio per le altre Contrade.
function pickPlayerJockey(jockey) {
  const player = getPlayer();
  if (!player || !state.scelta || state.scelta.done) return;
  const prev = state.scelta.assigned[player.id];
  if (prev && prev.nick === jockey.nick) return;          // è già il tuo
  if (state.scelta.taken[jockey.nick]) return;            // preso da un'altra Contrada
  const cost = state.scelta.ingaggio ? (jockey.ingaggio || 0) : 0;
  const refund = prev && state.scelta.ingaggio ? (prev.ingaggio || 0) : 0;
  if (state.scelta.ingaggio && cost > contradaBudget(player.id) + refund) {
    showMessage("Budget insufficiente per " + jockey.nick, 1.5, "danger");
    return;
  }
  if (prev) {   // libera + rimborsa il precedente
    delete state.scelta.taken[prev.nick];
    delete state.scelta.assigned[player.id];
    if (state.scelta.ingaggio) earnBudget(player.id, refund);
    const oldCard = document.querySelector('.sf-card[data-nick="' + cssEscape(prev.nick) + '"]');
    if (oldCard) { oldCard.classList.remove("mine"); const t = oldCard.querySelector(".sf-taken"); if (t) t.textContent = ""; }
  }
  assignJockey(player, jockey, true);
}

// Aggiorna il budget mostrato e ricalcola le card "no fondi" (tenendo conto del
// rimborso del fantino attualmente scelto, che potresti cambiare).
function refreshSfBudget() {
  if (!state.scelta) return;
  const player = getPlayer(); if (!player) return;
  const b = contradaBudget(player.id);
  const bEl = document.getElementById("sfBudget");
  if (bEl && state.campaign) bEl.textContent = b + " denari";
  if (!state.scelta.ingaggio) return;
  const cur = state.scelta.assigned[player.id];
  const refund = cur ? (cur.ingaggio || 0) : 0;
  document.querySelectorAll("#sfGrid .sf-card").forEach((card) => {
    if (card.classList.contains("taken") || card.classList.contains("mine")) { card.classList.remove("nofunds"); return; }
    const j = JOCKEYS.find((x) => x.nick === card.dataset.nick); if (!j) return;
    card.classList.toggle("nofunds", (j.ingaggio || 0) > b + refund);
  });
}

// Chiude la scelta (a tempo scaduto o con "Conferma"): se non hai scelto assegna il
// più economico che puoi permetterti, forza l'ingaggio delle AI rimaste, blocca e
// va alle accoppiate.
function finalizeScelta() {
  if (!state.scelta || state.scelta.done) return;
  state.scelta.done = true;
  clearInterval(state.scelta.countdown);
  const player = getPlayer();
  if (player && !state.scelta.assigned[player.id]) {
    let free = availableJockeys()[0] || JOCKEYS[0];
    if (state.scelta.ingaggio) {
      const b = contradaBudget(player.id);
      const byCost = availableJockeys().slice().sort((a, c) => (a.ingaggio || 0) - (c.ingaggio || 0));
      free = byCost.filter((j) => (j.ingaggio || 0) <= b)[0] || byCost[0] || free;
    }
    assignJockey(player, free, true);
  }
  (state.scelta.aiTimers || []).forEach(clearTimeout);
  state.horses.filter((h) => !h.player && !state.scelta.assigned[h.id]).forEach((h) => aiPickJockey(h));
  const grid = document.getElementById("sfGrid"); if (grid) grid.classList.add("locked");
  const cb = document.getElementById("sfConfirmBtn"); if (cb) cb.style.display = "none";
  setTimeout(showAccoppiateFinali, 500);
}

function ensureSceltaStyle() {
  if (document.getElementById("sf-style")) return;
  const s = document.createElement("style");
  s.id = "sf-style";
  s.textContent = `
#sfOverlay{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;
  background:radial-gradient(1200px 800px at 50% -5%,#5c4426 0%,#3a2c19 55%,#241a10 100%);
  color:#f3e7cf;font-family:inherit;padding:20px;overflow:auto}
#sfOverlay h2{margin:6px 0 2px;font-size:clamp(20px,3.4vw,32px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase}
#sfOverlay .sf-sub{opacity:.85;font-size:14px;margin-bottom:4px}
#sfCountdown{font-size:26px;font-weight:800;color:#f0cb35;margin-bottom:12px}
#sfGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;width:min(1050px,96vw)}
#sfGrid.locked .sf-card{pointer-events:none}
.sf-card.rifiutato{opacity:.72;border-color:rgba(232,137,111,.65)}
.sf-card.rifiutato:hover{transform:none}
.sf-rifiuto{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%) rotate(-7deg);
  text-align:center;font-size:15px;font-weight:900;letter-spacing:.08em;color:#e8896f;
  background:rgba(26,18,6,.82);padding:5px 0;border-top:1px solid rgba(232,137,111,.5);
  border-bottom:1px solid rgba(232,137,111,.5);pointer-events:none}
#sfGrid.locked .sf-card.taken{pointer-events:none}
.sf-card{position:relative;text-align:left;background:rgba(255,246,225,.12);border:1px solid rgba(240,203,53,.5);
  border-radius:14px;padding:12px 14px;cursor:pointer;transition:transform .1s ease,border-color .12s ease,opacity .2s}
.sf-card:hover{transform:translateY(-3px);border-color:#f0cb35}
.sf-card.taken{opacity:.82;cursor:default;border-color:rgba(255,255,255,.2)}
.sf-card.taken:hover{transform:none}
.sf-card.mine{opacity:1;border-color:#f0cb35;box-shadow:0 0 0 2px rgba(240,203,53,.6)}
.sf-card.taken .sf-price,.sf-card.mine .sf-price{display:none}   /* niente prezzo se già preso/scelto */
.sf-nick{font-size:19px;font-weight:800;color:#f5ecd8;margin-bottom:8px}
.sf-stat{display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0}
.sf-stat span{flex:0 0 78px;opacity:.85}
.sf-pips{display:flex;gap:3px}
.sf-pip{width:13px;height:8px;border-radius:2px;background:rgba(255,255,255,.16)}
.sf-pip.on{background:#f0cb35}
.sf-taken{position:absolute;top:9px;right:10px;font-size:10.5px;font-weight:700;color:#e9dcae;background:rgba(0,0,0,.5);border:1px solid rgba(240,203,53,.35);border-radius:5px;padding:2px 7px;max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-card.mine .sf-taken{color:#1a1206;background:#f0cb35;border-color:#f0cb35}
.sf-price{float:right;font-size:13px;font-weight:700;color:#f0cb35;background:rgba(240,203,53,.14);border-radius:6px;padding:1px 8px}
.sf-card.nofunds{opacity:.55;cursor:not-allowed}
.sf-card.nofunds:hover{transform:none;border-color:rgba(240,203,53,.35)}
/* Fantino bloccato (ha montato per la rivale negli ultimi 3 palii): croce rossa sopra. */
.sf-card.locked{opacity:.5;cursor:not-allowed;border-color:rgba(232,90,70,.6)}
.sf-card.locked:hover{transform:none}
.sf-cross{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;
  font-size:52px;font-weight:900;color:rgba(220,60,45,.9);text-shadow:0 2px 8px rgba(0,0,0,.6);pointer-events:none}
#sfOverlay.accoppiate .sf-acc{width:min(560px,94vw);display:flex;flex-direction:column;gap:6px;margin-top:8px}
.sf-arow{display:flex;align-items:center;gap:10px;background:rgba(18,13,8,.7);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 12px;font-size:14px}
.sf-arow.player{border-color:#f0cb35;box-shadow:0 0 0 1px rgba(240,203,53,.4)}
.sf-sw{display:flex;width:12px;height:17px;border-radius:2px;overflow:hidden;flex:0 0 auto;border:1px solid rgba(0,0,0,.4)}
.sf-sw span{flex:1}
.sf-arow .c{flex:0 0 96px;font-weight:700}
.sf-arow .h{flex:1;opacity:.85}
.sf-arow .j{flex:0 0 auto;color:#f0cb35;font-weight:700}
#sfGoBtn{margin-top:14px;font:inherit;cursor:pointer;border-radius:10px;padding:12px 30px;border:none;background:#f0cb35;color:#1a1206;font-weight:800}
#sfConfirmBtn{margin-top:16px;font:inherit;cursor:pointer;border-radius:10px;padding:11px 30px;border:none;background:#f0cb35;color:#1a1206;font-weight:800}
#sfConfirmBtn:hover{filter:brightness(1.08)}`;
  document.head.appendChild(s);
}

function statPips(n) {
  let h = '<div class="sf-pips">';
  for (let i = 1; i <= 5; i += 1) h += '<div class="sf-pip' + (i <= n ? ' on' : '') + '"></div>';
  return h + '</div>';
}

function buildSceltaFantinoUI() {
  ensureSceltaStyle();
  const old = document.getElementById("sfOverlay"); if (old) old.remove();
  const ing = !!state.scelta.ingaggio;
  const budget = ing && state.campaign ? state.campaign.budget : 0;
  const ov = document.createElement("div"); ov.id = "sfOverlay";
  ov.innerHTML = (ing ? '<h2>Ingaggia il fantino</h2>' : '<h2>Scegli il fantino</h2>')
    + '<div class="sf-sub">' + (ing
        ? '<b id="sfCountdown">45s</b> · puoi cambiare fantino finché non scade il tempo · <span id="sfBudget" style="display:none">' + budget + '</span>budget in alto a destra ↗'
        : '<b id="sfCountdown">45s</b> · clicca una card, puoi cambiare finché non scade il tempo.')
    + '</div><div id="sfGrid"></div>'
    + '<button type="button" id="sfConfirmBtn" style="display:none">Conferma il fantino →</button>';
  document.body.appendChild(ov);
  const confirmBtn = document.getElementById("sfConfirmBtn");
  if (confirmBtn) confirmBtn.addEventListener("click", finalizeScelta);
  const grid = document.getElementById("sfGrid");
  const player = getPlayer();
  JOCKEYS.forEach((j) => {
    const card = document.createElement("button");
    card.type = "button"; card.className = "sf-card"; card.dataset.nick = j.nick;
    if (ing && (j.ingaggio || 0) > budget) card.classList.add("nofunds");
    // Bloccato: ha montato per la RIVALE negli ultimi 3 palii → non può montare da te.
    // Squalificato: ha accumulato tre avvertimenti e salta questo Palio.
    const squal = fantinoSqualificato(j.nick);
    const locked = fantinoBloccatoPerGiocatore(j.nick) || squal;
    if (locked) card.classList.add("locked");
    card.innerHTML =
      (squal ? '<div class="sf-cross" title="Squalificato: tre avvertimenti, salta questo Palio">✕</div>'
        : locked ? '<div class="sf-cross" title="Ha montato per la rivale: non disponibile per 3 palii">✕</div>' : '')
      + '<div class="sf-nick">' + nickUp(j.nick) + (ing ? '<span class="sf-price">' + j.ingaggio + '</span>' : '') + '</div>'
      // TUTTE le statistiche, sempre: prima Curva non compariva affatto (e chi
      // sceglieva non sapeva quanto rischiava di cadere) e la Fedeltà solo in
      // modalità ingaggio.
      + '<div class="sf-stat"><span>Mossa</span>' + statPips(j.mossa) + '</div>'
      + '<div class="sf-stat"><span>Difesa</span>' + statPips(j.difesa) + '</div>'
      + '<div class="sf-stat"><span>Terzo giro</span>' + statPips(j.terzo) + '</div>'
      + '<div class="sf-stat"><span>Curva</span>' + statPips(j.curva || 3) + '</div>'
      + '<div class="sf-stat"><span>Fedeltà</span>' + statPips(j.fedelta || 3) + '</div>'
      + '<div class="sf-taken"></div>';
    card.addEventListener("click", () => {
      if (fantinoSqualificato(j.nick)) { toastMsg("Questo fantino è squalificato: tre avvertimenti, salta questo Palio."); return; }
      if (fantinoBloccatoPerGiocatore(j.nick)) { toastMsg("Questo fantino ha montato per la rivale: non è disponibile per 3 palii."); return; }
      if (card.classList.contains("rifiutato")) { toastMsg("Questo fantino ti ha già detto di no."); return; }
      // Col cavallo scarso può rifiutare: lo scopri solo quando lo chiami.
      if (fantinoRifiuta(j)) {
        card.classList.add("rifiutato");
        const cr = document.createElement("div");
        cr.className = "sf-cross";
        cr.title = "Ha rifiutato: non monta il tuo cavallo";
        cr.textContent = "✕";
        card.appendChild(cr);
        const av = document.createElement("div");
        av.className = "sf-rifiuto";
        av.textContent = "HA RIFIUTATO";
        card.appendChild(av);
        return;
      }
      pickPlayerJockey(j);
    });
    grid.appendChild(card);
  });
}

// Accoppiate finali: Contrada — Cavallo — Fantino, poi "Vai alla Mossa".
function showAccoppiateFinali() {
  const ov = document.getElementById("sfOverlay");
  if (!ov) { startMossa(true); return; }
  ov.classList.add("accoppiate");
  ov.innerHTML = '<h2>Le accoppiate</h2><div class="sf-sub">Contrada · Cavallo (fascia) · Fantino</div><div class="sf-acc"></div>'
    + '<button type="button" id="sfGoBtn">Vai alla Mossa →</button>';
  const box = ov.querySelector(".sf-acc");
  state.horses.slice().sort((a, b) => a.name.localeCompare(b.name, "it")).forEach((h) => {
    const j = state.scelta.assigned[h.id];
    const row = document.createElement("div");
    row.className = "sf-arow" + (h.player ? " player" : "");
    const sw = '<div class="sf-sw">' + (h.colors || []).slice(0, 3).map((c) => '<span style="background:' + c + '"></span>').join("") + '</div>';
    const tm = TRATTA_TIERS[h.horseTier];
    const tierBadge = tm ? ' <span style="font-size:10.5px;font-weight:700;color:' + tm.fg + ';background:' + tm.bg + ';border-radius:5px;padding:1px 7px;margin-left:6px">' + tm.label + '</span>' : '';
    row.innerHTML = sw + '<div class="c">' + h.name + '</div><div class="h">' + (h.horseName || "") + tierBadge + '</div><div class="j">' + (j ? j.nick : "—") + '</div>';
    box.appendChild(row);
  });
  document.getElementById("sfGoBtn").addEventListener("click", endSceltaFantino);
}

function endSceltaFantino() {
  if (state.scelta) {
    clearInterval(state.scelta.countdown);
    (state.scelta.aiTimers || []).forEach(clearTimeout);
  }
  const ov = document.getElementById("sfOverlay"); if (ov) ov.remove();
  if (state.campaign && state.campaign.active) campaignAccordiScreen(false);   // in campagna: accordi → corruzione → mossa
  else startMossa(true);
}

function updateTratta(dt, time) {
  const T = state.tratta && state.tratta.timeline;
  if (!T) return;
  // Estrazione in DUE TEMPI: wait → CAVALLO (nome+fascia) → pausa → CONTRADA.
  if (T.phase !== "done") {
    T.timer -= dt;
    if (T.timer <= 0) {
      const pairings = state.tratta.pairings;
      if (T.phase === "presenta") {
        // Finite le chiarine e la presentazione: comincia la chiamata.
        const pres = document.getElementById("trattaPresenta"); if (pres) pres.remove();
        T.phase = "wait"; T.timer = 0.6;
      } else if (T.phase === "wait") {
        if (T.idx >= pairings.length) { T.phase = "done"; trattaAllRevealed(); }
        else { announceTrattaHorse(pairings[T.idx]); T.phase = "horse"; T.timer = 2.6; }
      } else if (T.phase === "horse") {
        announceTrattaContrada(pairings[T.idx]);
        T.phase = "contrada"; T.timer = 2.4;
      } else if (T.phase === "contrada") {
        T.idx += 1; T.phase = "wait"; T.timer = 0.5;
      }
    }
  }
  // Nitriti d'ambiente: ogni tanto un barbero della fila nitrisce.
  T.nitritoTimer = (T.nitritoTimer ?? (3 + Math.random() * 4)) - dt;
  if (T.nitritoTimer <= 0) { playNitrito(0.3); T.nitritoTimer = 5 + Math.random() * 6; }
  // Cavalli fermi in fila (idle) + saltello di chi è appena stato estratto.
  state.horses.forEach((h) => {
    if (h.revealPulse > 0) h.revealPulse = Math.max(0, h.revealPulse - dt * 1.6);
    placeHorse(h, time);
    if (h.revealPulse > 0) h.group.position.y += Math.sin((1 - h.revealPulse) * Math.PI) * 0.22;
  });
  // I cartelli seguono il cavallo (o restano sul tavolo); i "fading" svaniscono.
  T.labels = T.labels.filter((l) => {
    if (l.fading) {
      l.alpha = Math.max(0, l.alpha - dt / 0.6);
      l.spr.material.opacity = l.alpha;
      if (l.alpha <= 0) { disposeTrattaLabel(l); return false; }
    }
    if (l.entrant) {
      const b = l.entrant.group.position;
      l.spr.position.set(b.x, b.y + 3.6 + Math.sin(time * 2 + l.entrant.phase) * 0.06, b.z);
    } else if (l.anchor === "table" && state.trattaObjects) {
      const t = state.trattaObjects.grp.position;
      l.spr.position.set(t.x, t.y + 4.6 + Math.sin(time * 2) * 0.05, t.z);
    }
    return true;
  });
  // Urne che "scattano" e bambino che si solleva all'estrazione.
  const objs = state.trattaObjects;
  if (objs) {
    objs.popTimer = Math.max(0, (objs.popTimer || 0) - dt);
    const pop = objs.popTimer > 0 ? Math.sin(objs.popTimer / 0.4 * Math.PI) * 0.16 : 0;
    objs.urnL.scale.setScalar(1 + pop);
    objs.urnR.scale.setScalar(1 + pop);
    if (objs.child) objs.child.position.y = objs.childY + pop * 0.5;
  }
  // Camera: dal Campo verso il Palazzo, con la fila dei cavalli sotto la
  // facciata; lento ondeggiamento laterale lungo il rettilineo.
  const P0cam = getStraightCenterP();
  const camS = sampleAt(P0cam);
  const innerCam = camS.normal.clone().normalize();
  const sway = Math.sin(time * 0.25) * 1.8;
  const camPos = camS.point.clone()
    .addScaledVector(innerCam, TRACK_HALF_WIDTH + 2.5)
    .addScaledVector(camS.tangent, sway)
    .add(new THREE.Vector3(0, 4.8 + Math.sin(time * 0.33) * 0.25, 0));
  const lookPos = camS.point.clone().addScaledVector(innerCam, -9).add(new THREE.Vector3(0, 3.0, 0));
  state.cameraPosition.lerp(camPos, clamp(dt * 2.2, 0, 1));
  state.cameraLook.lerp(lookPos, clamp(dt * 2.2, 0, 1));
  camera.position.copy(state.cameraPosition);
  camera.lookAt(state.cameraLook);
  state.cameraFov += (60 - state.cameraFov) * clamp(dt * 3, 0, 1);
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
}

// HUD minimale (titolo in alto, riga + tasti in basso) sopra la scena 3D.
function ensureTrattaHudStyle() {
  if (document.getElementById("tratta-hud-style")) return;
  const s = document.createElement("style");
  s.id = "tratta-hud-style";
  s.textContent = `
#trattaHud{position:fixed;inset:0;z-index:55;pointer-events:none;font-family:inherit;color:#f3e7cf}
#trattaHud .tt-title{position:absolute;top:26px;left:0;right:0;text-align:center}
#trattaHud .tt-title h2{margin:0;font-size:clamp(20px,3.4vw,34px);letter-spacing:.16em;color:#f0cb35;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.7)}
#trattaHud .tt-title p{margin:5px 0 0;font-size:13px;opacity:.9;text-shadow:0 1px 8px rgba(0,0,0,.8)}
#trattaHud .tt-bottom{position:absolute;bottom:30px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:12px}
#trattaLine{font-size:17px;font-weight:600;min-height:22px;text-shadow:0 1px 10px rgba(0,0,0,.9)}
#trattaHud .tt-btns{display:flex;gap:12px;pointer-events:auto}
#trattaHud .tt-btns button{font:inherit;cursor:pointer;border-radius:10px;padding:12px 26px;border:1px solid rgba(240,203,53,.5);background:rgba(20,14,8,.72);color:#f3e7cf}
#trattaHud .tt-btns button:hover{filter:brightness(1.15)}
#trattaHud .tt-btns .go{background:#f0cb35;color:#1a1206;border-color:#f0cb35;font-weight:700}
#trattaPanel{position:absolute;right:14px;top:86px;width:262px;display:flex;flex-direction:column;gap:5px}
#trattaPanel .tp-head{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;text-align:right;padding-right:4px;text-shadow:0 1px 8px rgba(0,0,0,.8)}
.tp-row{display:flex;align-items:center;gap:8px;background:rgba(18,13,8,.74);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:6px 9px;font-size:12.5px}
.tp-row.player{border-color:#f0cb35;box-shadow:0 0 0 1px rgba(240,203,53,.45)}
.tp-sw{display:flex;width:12px;height:17px;border-radius:2px;overflow:hidden;flex:0 0 auto;border:1px solid rgba(0,0,0,.4)}
.tp-sw span{flex:1}
.tp-name{font-weight:700;flex:0 0 86px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-horse{flex:1;text-align:right;opacity:.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-row.filled .tp-horse{opacity:1}
.tp-row.flash{animation:tpFlash .9s ease}
@keyframes tpFlash{0%{background:rgba(240,203,53,.4)}100%{background:rgba(18,13,8,.74)}}
@media (max-width:820px){#trattaPanel{display:none}}`;
  document.head.appendChild(s);
}

function buildTrattaHud() {
  ensureTrattaHudStyle();
  const old = document.getElementById("trattaHud"); if (old) old.remove();
  const hud = document.createElement("div"); hud.id = "trattaHud";
  hud.innerHTML =
    '<div class="tt-title"><h2>La Tratta</h2><p>Il sorteggio dei cavalli alle Contrade — cortile del Palazzo Pubblico</p></div>' +
    '<div id="trattaPanel"><div class="tp-head">Accoppiate</div></div>' +
    '<div class="tt-bottom"><div id="trattaLine"></div><div class="tt-btns">' +
    '<button type="button" id="trattaSkipBtn">Salta il sorteggio</button>' +
    '<button type="button" id="trattaGoBtn" class="go" style="display:none">Vai al tondino →</button>' +
    '</div></div>';
  document.body.appendChild(hud);
  document.getElementById("trattaSkipBtn").addEventListener("click", trattaSkip);
  document.getElementById("trattaGoBtn").addEventListener("click", endTratta);
  // Pannello con le 10 Contrade in gara (ordine alfabetico): le accoppiate si
  // compilano man mano che il sorteggio le ufficializza.
  const panel = document.getElementById("trattaPanel");
  const inGara = state.tratta.pairings.map((p) => p.entrant)
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
  inGara.forEach((e) => {
    const row = document.createElement("div");
    row.className = "tp-row" + (e.player ? " player" : "");
    row.id = "tp-" + e.id;
    const sw = document.createElement("div"); sw.className = "tp-sw";
    (e.colors || []).slice(0, 3).forEach((col) => { const s = document.createElement("span"); s.style.background = col; sw.appendChild(s); });
    const name = document.createElement("div"); name.className = "tp-name"; name.textContent = e.name;
    const horse = document.createElement("div"); horse.className = "tp-horse"; horse.textContent = "—";
    row.append(sw, name, horse);
    panel.appendChild(row);
  });
}

// Compila la riga del pannello quando l'accoppiata è ufficiale.
function fillTrattaPanelRow(p) {
  const row = document.getElementById("tp-" + p.entrant.id);
  if (!row) return;
  const meta = TRATTA_TIERS[p.tier] || TRATTA_TIERS.bono;
  const horse = row.querySelector(".tp-horse");
  horse.textContent = "";
  const n = document.createElement("span"); n.textContent = p.horseName + " ";
  const tier = document.createElement("em"); tier.style.cssText = "font-style:normal;font-weight:700;color:" + meta.fg;
  tier.textContent = meta.label;
  horse.append(n, tier);
  row.classList.add("filled");
  row.classList.remove("flash"); void row.offsetWidth;  // riavvia l'animazione
  row.classList.add("flash");
}

function startMossa(fromTratta = false) {
  ensureAudio();
  if (state.audio.ctx && state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume();
  }
  clearConfetti();
  // Se veniamo dalla TRATTA gli entranti (e l'abbinamento cavallo↔Contrada) sono
  // già stati creati e sorteggiati: NON ricrearli. Altrimenti crea i 10 in gara.
  if (!fromTratta) createEntrants();
  // Alla mossa i fantini SONO in sella (dopo la tratta erano nascosti).
  clearFallenRiders();   // via eventuali fantini caduti del palio precedente
  state.horses.forEach((h) => {
    if (h.group.userData.jockey) h.group.userData.jockey.visible = true;   // fantino di nuovo in sella
    h.scosso = false; h.fallCd = 0;                                        // azzera lo stato "scosso" del palio prima
    h.caduto = false; h.cadutoRoll = 0; h.cadutoMult = 1; h.cadutoTimer = 0;   // …e il "cavallo a terra"
    if (h.player) h.autopilot = false;                                     // riprendi il controllo (lo spectate lo ri-attiva dopo)
  });
  // Inizio del palio: prima l'INGRESSO in Piazza, poi il SUNTO (il campanone
  // della Torre) sopra la coda dell'ingresso.
  stopPalioSounds();
  playPalioSound("ingresso.m4a", { volume: 0.62 });
  state.suntoTimer = setTimeout(() => {
    state.suntoTimer = null;
    try { playPalioSound("SUNTO-NOTIFICASMS.mp3", { volume: 0.6 }); } catch (e) { /* niente */ }
  }, INGRESSO_PRIMA_DEL_SUNTO * 1000);
  state.mode = "mossa";
  setAllestimento("palio");   // il giorno del Palio: palchi montati e Piazza gremita
  // La visuale scelta col tasto C RESTA anche nei palii successivi: prima ogni
  // mossa la riportava d'ufficio sul cavallo del giocatore, e chi preferiva la
  // laterale doveva riselezionarla ogni volta.
  if (!state.cameraMode) state.cameraMode = "follow";
  state.mossaTimer = 0;
  state.cartelloMossaFatto = false;   // il cartello della mossa comprata torna a ogni palio
  state.mossaDuration = 13.2 + Math.random() * 1.4;
  state.canapiDrop = 0;
  if (state.canapi) {
    state.canapi.visible = true;
    state.canapi.position.set(0, 0, 0);
    state.canapi.rotation.set(0, 0, 0);
  }
  // Canapo posteriore (verrocchino) visibile e opaco all'inizio della mossa.
  if (state.canapiPosteriore) {
    state.canapiPosteriore.visible = true;
    state.canapiPosteriore.traverse((child) => {
      if (child.material) child.material.opacity = 1;
    });
  }
  state.canapiDropTimer = 0;
  state.mossaPhase = "positioning";
  state.mossaSubTimer = 0;
  state.raceClock = 0;
  state.lastLapAnnounced = false;
  state.currentLeader = null;
  state.rankings = [];
  state.ui.lastPlayerRank = null;
  state.ui.lastRankKey = "";
  state.ui.leaderboardTimer = 0;
  const sharedRaceStamina = randomInteger(STAMINA_MIN_ROLL, STAMINA_MAX_ROLL);
  // Estrazione a sorte delle poste al canapo (come nel Palio): permutazione
  // casuale fra tutte le contrade, giocatore compreso. Poste 0..8 = allineate
  // al canapo (dalla più interna alla più esterna); l'ultima posta = di
  // rincorsa, che parte da dietro.
  const postOrder = [...Array(state.horses.length).keys()];
  for (let i = postOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [postOrder[i], postOrder[j]] = [postOrder[j], postOrder[i]];
  }
  // Corsie delle poste al canapo, da interno (destra, +) a esterno (-). La posta
  // estratta decide se ti tocca l'interno (vantaggioso) o l'esterno.
  // Poste ancorate al bordo INTERNO e DISTRIBUITE sulla larghezza della pista.
  // Spaziatura 1.90 contro un corpo largo 0.92: restano vicini (mezzo cavallo di
  // stacco) e al primo scarto laterale si toccano, ma la fila COPRE il canape
  // invece di ammucchiarsi. A 1.40 stavano tutti stretti nella metà interna e
  // rimaneva mezza pista vuota; a 2.35 (ancora prima) non si sfioravano mai.
  const lineLanes = [9.9, 8.0, 6.1, 4.2, 2.3, 0.4, -1.5, -3.4, -5.3];
  const rincorsaPost = state.horses.length - 1;
  // ── COPERTURA DELLE POSTE (shuffle bag): in ogni blocco di 20 palii corsi dal
  // giocatore gli capitano TUTTE e 10 le posizioni al canapo almeno una volta (la
  // rincorsa inclusa). La posta del giocatore è pescata dal sacchetto; le altre
  // restano casuali. In "assisti" (autopilot) NON si tocca: tutto casuale.
  const playerIdx = state.horses.findIndex((h) => h.player && !h.autopilot);
  if (playerIdx >= 0) {
    const target = nextPlayerPost(state.horses.length);
    const holder = postOrder.indexOf(target);
    if (holder >= 0 && holder !== playerIdx) {
      const mia = postOrder[playerIdx];
      postOrder[playerIdx] = target;
      postOrder[holder] = mia;
    }
  }
  let playerPost = 0;
  let playerRincorsa = false;
  state.horses.forEach((horse, index) => {
    const post = postOrder[index];
    horse.isRincorsa = post === rincorsaPost;
    horse.postIndex = post;   // 0 = posta più interna ... 8 = più esterna
    horse.behaviorTimer = 1 + Math.random() * 2;
    horse.behaviorState = "idle";
    if (horse.isRincorsa) {
      horse.mossaLane = RINCORSA_LANE;
      horse.mossaProgress = RINCORSA_START_PROGRESS;
    } else {
      horse.mossaLane = lineLanes[post] + (Math.random() - 0.5) * 0.4;
      horse.mossaProgress = -2.8 - (post % 3) * 0.55 - Math.random() * 0.45;
    }
    // Corsia della posta estratta: i cavalli devono rispettarla al canapo.
    horse.postLane = horse.mossaLane;
    if (horse.player) {
      playerPost = post;
      playerRincorsa = horse.isRincorsa;
    }
    horse.progress = horse.mossaProgress - 0.35;
    horse.lane = horse.mossaLane + (Math.random() - 0.5) * 0.4;
    horse.speedLevel = 0;
    horse.targetSpeedLevel = 0;
    horse.travelSpeed = 0;
    // Dalla TRATTA ogni Contrada ha già la stamina del cavallo sorteggiato: la si
    // rispetta (è la fortuna del sorteggio). Altrimenti: giocatore = stamina base,
    // ciascuna delle 9 AI ±5 attorno alla base.
    if (!fromTratta) {
      horse.staminaMax = horse.player ? sharedRaceStamina : sharedRaceStamina + randomInteger(-5, 5);
      horse.staminaBase = horse.staminaMax;      // base fresca (senza Tratta)
    } else if (horse.staminaBase === undefined) {
      horse.staminaBase = horse.staminaMax;      // base = stamina sorteggiata alla Tratta
    }
    horse.stamina = horse.staminaMax;
    horse.effectiveSpeedLevel = horse.player ? getPlayerEffectiveSpeed(horse) : horse.speedLevel;
    horse.staminaLimited = false;
    horse.wasStaminaLimited = false;
    horse.speedPulse = 0;
    horse.brakePulse = 0;
    horse.surgeTimer = 0;
    horse.surgeCooldown = 1.2 + Math.random() * 3.4;
    horse.surgeTarget = 0;
    horse.finishTime = null;
    horse.mossaJitterTimer = 0;
    horse.mossaLaneGoal = horse.mossaLane;
    horse.mossaTurn = 0;
    horse.raceTurn = 0;
    // Tenuta "pesante" della posta ai canapi, con varianza per-cavallo ∈ [-2,+2]:
    //  +2 = macigno (non lo smuovi), -2 = esce dietro e poi ritrova la posizione.
    horse.terzoGiroDone = false;   // bonus stamina ultimo giro non ancora applicato
    // CALMA (1-5) → tenuta ai canapi: 5 = macigno piantato, 1 = leggero/scalpita.
    horse.holdWeight = clamp((horse.calma || 3) - 3 + (Math.random() - 0.5) * 0.6, -2, 2);
    horse.holdPhase = Math.random() * TAU;
    horse.heading = undefined;
    // Reset dei campi mossa introdotti dal rifacimento. Il nervosismo di BASE va
    // ripristinato: mosse false / "tutti fuori" lo alzano, e senza ripristino i
    // restart dalla Mossa lo accumulerebbero fino a saturare (mossa sempre più caos).
    // La CALMA dà il nervosismo di PARTENZA (tabella dell'utente). Non più una
    // formula lineare: i valori sono ravvicinati di proposito, così anche un
    // calma-5 parte già "sveglio" e la differenza fra le indoli si gioca sul
    // RECUPERO, non sul punto di partenza.
    // Da qui in poi il valore non è più ancorato: sale con le botte e scende da solo.
    if (horse.nervousnessBase === undefined) horse.nervousnessBase = NERV_BASE_BY_CALMA[horse.calma] ?? 0.50;
    // FRENO PROVVISORIO: nei prossimi 50 palii il cavallo di GRIDO è +50% nervoso.
    if (horse.jockey && horse.jockey.nick === "Grido" && frenoAttivo("gridoNervoso")) {
      horse.nervousnessBase = clamp(horse.nervousnessBase * 1.5, 0, 1);
    }
    horse.nervousness = horse.nervousnessBase;
    horse.nervousnessCurrent = horse.nervousness;
    horse.rincorsaSpeed = 0;
    horse.rincorsaThinkTimer = 0;
    horse.wantsToEnter = false;
    // "Fantino comprato": azzerato a ogni mossa, lo riattiva la corruzione sotto.
    horse.soldTo = null; horse.soldTargetId = null; horse.soldBurst = 0; horse.soldNext = 0;
    // Agitazione da nervosismo: stato pulito a ogni mossa.
    horse.nervBackState = null; horse.lastHitAt = -99; horse.lastTouchAt = -99; horse.hitStreak = null;
    horse.launching = false;
    horse.launchDelayTimer = 0;
    horse.launchHeadingDev = 0;
    horse.startQuality = "clean";
    // Campi della CORSA-VENDETTA (pianificata sotto, dopo il loop).
    horse.vendettaQueue = null;      // coda bersagli (corrotto: 1ª poi 2ª favorita)
    horse.vendettaPending = false;
    horse.vendettaState = null;
    horse.vendettaTargetId = null;
    horse.allyHelp = false;                       // aiuto da accordo (impostato dopo il loop)
    horse.allyBeneficiaryId = null;
    horse.allyTargetId = null;
    horse.objCanapi = true;                        // finalità accordo: spazio ai canapi + mossa (default: sì)
    horse.objPassa = true;                         // finalità accordo: farmi passare in corsa (default: sì)
    horse.objSpingi = false;                       // finalità: spingi forte ai canapi
    horse.objMossa = false;                        // finalità: se di rincorsa, la mossa al beneficiario
    horse.objLetWin = false;                       // finalità: lascia vincere il beneficiario
    horse.corruptPerdi = false;                    // corruzione "non provare a vincere": rallenta nel finale
    horse.friendlyToPlayer = false;               // alleato/corrotto: non dà fastidio al giocatore
    horse.paraInRace = null;                       // (assisti) va davanti a questa Contrada per pararla in corsa
    horse.noMossaTarget = null;                    // fantino corrotto: a chi NON deve dare la mossa se va di rincorsa
    horse.corruptDelay = 0;                        // ritardo extra al via (rivale corrotta in assisti)
    horse.vendettaAt = 4 + Math.random() * 24;   // quando scatta (secondi di tensione)
    horse.vendettaLife = 0;
    horse.vendettaTimer = 0;
    horse.chaosActor = false;                    // caos ai canapi: attore scelto dopo il loop
    horse.chaosOffset = Math.random() * 21;      // sfasamento del ciclo dx/sx/centro
    horse.mossaSubState = horse.isRincorsa ? "runup" : "wait";
    if (horse.isRincorsa) {
      horse.lane = RINCORSA_LANE;
      horse.progress = RINCORSA_START_PROGRESS;
    }
    // Posto definitivo al canapo (dove il cavallo si schiererà una volta chiamato).
    horse.slotProgress = horse.mossaProgress;
    horse.slotLane = horse.mossaLane;
    placeHorse(horse, 0);
  });

  // ── CAOS AI CANAPI: in 2 palii su 3, 4-5 Contrade (AI) si addossano dx/sx/centro,
  // anche andando dietro (gran trambusto), nei primi ~20s dall'annuncio della
  // rincorsa; dopo il 25° secondo di tensione si allineano come sempre.
  state.canapiChaos = Math.random() < (2 / 3);
  if (state.canapiChaos) {
    const pool = state.horses.filter((h) => !h.isRincorsa && !h.player);
    for (let i = pool.length - 1; i > 0; i -= 1) { const jj = Math.floor(Math.random() * (i + 1)); const tmp = pool[i]; pool[i] = pool[jj]; pool[jj] = tmp; }
    const nAttori = 4 + Math.floor(Math.random() * 2);   // 4 o 5 Contrade
    pool.slice(0, nAttori).forEach((h, idx) => { h.chaosActor = true; h.chaosOffset = (idx * 5.3) % 21; });
  }

  // (La vecchia garanzia rincorsa 1-su-10 è stata sostituita dallo shuffle bag delle
  // poste sopra: la rincorsa è una delle 10 posizioni coperte in ogni 20 palii.)

  // ── BILANCIAMENTO DIFFICOLTÀ sulla stamina del giocatore (dopo tratta e
  // variazioni casuali): principiante = vantaggio medio reale (+8, si sente
  // soprattutto nel finale del 3° giro); intermedio = alla pari; esperto =
  // svantaggio medio (−6) ma vincibile. Le AI restano com'erano.
  {
    const pl = getPlayer();
    if (pl) {
      let diffOff = state.difficulty === "easy" ? 8 : state.difficulty === "hard" ? -6 : 0;
      // La CAMPAGNA (non la veloce) è un filo più dura dell'esperto: malus extra.
      if (state.campaign && state.campaign.active && !state.campaign.quick) diffOff -= 3;
      // Applica il bonus/malus alla stamina di BASE, non al valore già corretto:
      // altrimenti ogni "Riparti dalla Mossa" lo somma di nuovo e la stamina deriva.
      if (pl.staminaBase === undefined) pl.staminaBase = pl.staminaMax;
      pl.staminaMax = clamp(pl.staminaBase + diffOff, 55, 110);
      pl.stamina = pl.staminaMax;
    }
  }

  // ── Pianifica le CORSE-VENDETTA: per ogni rivalità presente in gara, la Contrada
  // PIÙ DEBOLE (fantino meno forte) ha 2/3 di probabilità di andare — almeno una
  // volta durante la mossa — ad affrontare la rivale anche se lontana nei canapi,
  // passando DIETRO le altre. Il giocatore non viene mai comandato (solo AI).
  {
    const rstr = (h) => ((h.jkMossa || 3) + (h.jkDifesa || 3) + (h.jkTerzo || 3)) * 100 + (h.staminaMax || 70);
    state.horses.forEach((h) => {
      if (h.player) return;                       // il giocatore lo comandi tu
      const rivalMap = RIVALS[h.id] || {};
      let target = null, tk = -1;
      Object.keys(rivalMap).forEach((rid) => {
        const r = state.horses.find((o) => o.id === rid);
        if (!r) return;
        const iAmWeaker = rstr(h) < rstr(r) || (rstr(h) === rstr(r) && h.id < r.id);
        if (iAmWeaker && rivalMap[rid] > tk) { target = r; tk = rivalMap[rid]; }
      });
      if (target && Math.random() < 2 / 3) {
        h.vendettaPending = true;
        h.vendettaTargetId = target.id;
      }
    });
  }

  // ── ACCORDI e CORRUZIONE in gara ────────────────────────────────────────────
  // Alleato/corrotto DAL GIOCATORE: non gli dà fastidio, gli fa spazio ai canapi e
  // va a "parare" la FAVORITA (se corri tu) o la RIVALE (se assisti). Corrompere la
  // rivale = non ti dà fastidio (se corri) o parte in ritardo (se assisti).
  if (state.campaign && state.campaign.active) {
    const cmp = state.campaign;
    const byId = {}; state.horses.forEach((h) => { byId[h.id] = h; });
    const playerId = cmp.contrada && cmp.contrada.id;
    const rivalId = cmp.rival && cmp.rival.id;
    const playing = cmp.currentMode === "play";
    const favId = favoriteRunningId(playerId);   // la favorita (non tu/non chi la subisce) da parare
    let allyVend = 0;                             // cap: max 2 vendette-alleate
    const setVendetta = (helper, targetId) => {
      if (targetId && byId[targetId] && targetId !== helper.id && !helper.isRincorsa
          && !helper.vendettaPending && helper.vendettaState !== "fatto" && allyVend < 2) {
        helper.vendettaPending = true; helper.vendettaTargetId = targetId; allyVend += 1;
      }
    };
    (cmp.accordi || []).forEach((a) => {
      const helper = byId[a.helper]; if (!helper || helper.player) return;
      // PAROLA DATA, NON SEMPRE MANTENUTA: la Contrada onora l'accordo nel 68% dei
      // casi. Nell'altro terzo ha preso i denari e in Piazza fa di testa sua, e il
      // giocatore non lo sa finché non lo vede in corsa. Comprare adesso è facile,
      // fidarsi no. Deciso UNA volta per palio (questo codice gira all'inizio della
      // mossa), non a ogni frame.
      if (Math.random() >= 0.68) return;
      if (a.beneficiary === playerId) {          // il GIOCATORE corre: l'alleato aiuta te
        helper.friendlyToPlayer = true;
        if (!a.obiettivi) {                      // accordo classico (senza finalità): aiuto pieno
          helper.allyBeneficiaryId = playerId;
          helper.allyTargetId = favId;
          helper.allyHelp = true;
          helper.objCanapi = true; helper.objPassa = true;
          setVendetta(helper, favId);
        } else {                                 // accordo "per cosa": solo le finalità scelte
          const O = a.obiettivi;
          const wantCanapi = O.indexOf("canapi") >= 0;
          const wantSpingi = O.indexOf("spingi") >= 0;   // spingi forte ai canapi = aiuto forte alla mossa
          const wantPassa = O.indexOf("passa") >= 0;
          const wantPara = O.indexOf("para") >= 0;
          const wantMossa = O.indexOf("mossa") >= 0;      // se va di rincorsa, la mossa a me
          const wantVinci = O.indexOf("vinci") >= 0;      // lasciami vincere
          const wantInterno = O.indexOf("interno") >= 0;  // para gli altri interno + se dietro fammi passare
          helper.objCanapi = wantCanapi || wantSpingi;
          helper.objSpingi = wantSpingi;
          helper.objPassa = wantPassa || wantInterno;     // "interno" include il farmi passare
          helper.objMossa = wantMossa;
          helper.objLetWin = wantVinci;
          if (wantCanapi || wantSpingi || wantPassa || wantMossa || wantVinci || wantInterno) { helper.allyBeneficiaryId = playerId; helper.allyHelp = true; }
          // ── NUOVE finalità anti-rivale (riuso paraInRace = le va davanti a bloccarla,
          // setVendetta = la va a disturbare/nerbare/addosso). Flag leggeri in più per
          // le due varianti nuove (curva / rallenta).
          const wantNerbaRiv = O.indexOf("nerbaRiv") >= 0;
          const wantParaInterno = O.indexOf("paraInterno") >= 0;
          const wantCurva = O.indexOf("curvaAddosso") >= 0;
          const wantRallenta = O.indexOf("paraRallenta") >= 0;
          const wantParaCanapi = O.indexOf("paraCanapi") >= 0;
          if (wantParaInterno) helper.objPassa = true;   // "interno" include il farmi passare
          const anyAntiRivale = wantPara || wantNerbaRiv || wantParaInterno || wantCurva || wantRallenta || wantParaCanapi;
          if (anyAntiRivale && rivalId) {
            helper.allyTargetId = rivalId;
            helper.allyHelp = true;
            // Le va DAVANTI a bloccarla (para/interno/rallenta/canapi/curva); "nerba" da sola no.
            if (wantPara || wantParaInterno || wantCurva || wantRallenta || wantParaCanapi) helper.paraInRace = rivalId;
            setVendetta(helper, rivalId);                // la insegue e la disturba
            if (wantCurva) helper.curvaRam = rivalId;        // extra: si butta addosso in curva
            if (wantRallenta) helper.paraRallenta = rivalId; // extra: rallenta stando davanti a lei
          }
        }
      } else if (a.para && a.sponsor === playerId) {   // ASSISTI: l'alleato para la RIVALE
        const O = a.obiettivi || null;
        helper.allyBeneficiaryId = null;
        helper.allyTargetId = a.para;
        helper.friendlyToPlayer = true;
        helper.allyHelp = true;
        // Senza finalità (accordo vecchio stile) le va comunque davanti a bloccarla;
        // con le finalità scelte, solo "nerba" da sola non implica il pararla.
        const soloNerba = O && O.length === 1 && O[0] === "nerbaRiv";
        if (!soloNerba) helper.paraInRace = a.para;
        setVendetta(helper, a.para);
        if (O && O.indexOf("paraInterno") >= 0) helper.objPassa = true;
        if (O && O.indexOf("curvaAddosso") >= 0) helper.curvaRam = a.para;      // le si butta addosso in curva
        if (O && O.indexOf("paraRallenta") >= 0) helper.paraRallenta = a.para;  // le rallenta davanti
      } else {                                   // accordo fra AI: comportamento storico
        const benId = a.beneficiary || null;
        const targetId = a.para || (benId ? topRunningRivalId(benId) : null);
        helper.allyBeneficiaryId = benId;
        helper.allyTargetId = targetId;
        helper.allyHelp = !!(benId || targetId);
        setVendetta(helper, targetId);
      }
    });
    const cor = cmp.corrupted || {};
    Object.keys(cor).forEach((hid) => {
      if (cor[hid] !== playerId) return;         // solo i fantini corrotti DA TE
      // Il fantino comprato è meno affidabile della Contrada: onora nel 60% dei
      // casi, negli altri intasca e corre come gli pare. Prima la corruzione era
      // una certezza — pagavi ed eri sicuro del risultato.
      if (Math.random() >= 0.60) return;
      // Salta SOLO la tua Contrada. NON usare h.player: in ASSISTI il flag .player
      // ce l'ha la RIVALE (è il cavallo-focus in autopilot), e così il ritardo da
      // corruzione non le veniva mai applicato.
      const h = byId[hid]; if (!h || h.id === playerId) return;
      if (hid === rivalId) {
        // RIVALE corrotta: il suo fantino "si vende" → aspetta 1,8s alla mossa (non di
        // più) e poi parte (in corsa non ti dà comunque fastidio). Vale sia se corri
        // tu sia in assisti.
        h.corruptDelay = 1.8;
        h.friendlyToPlayer = true;
      } else if (playing) {
        h.friendlyToPlayer = true;               // altro fantino corrotto: non ti dà fastidio
        const orders = (cmp.corruptOrders && cmp.corruptOrders[hid]) || null;
        if (orders && orders.length) {
          // FINALITÀ scelte: resta ai canapi · nerba/buttati sulla mia rivale · non vincere.
          if (orders.indexOf("resta") >= 0) h.corruptDelay = Math.max(h.corruptDelay || 0, 1.2);
          if (orders.indexOf("perdi") >= 0) h.corruptPerdi = true;
          if (orders.indexOf("interno") >= 0) { h.objPassa = true; h.allyBeneficiaryId = playerId; h.allyHelp = true; }  // para gli altri interno + fammi passare
          if (orders.indexOf("noMossa") >= 0 && rivalId) h.noMossaTarget = rivalId;   // di rincorsa: non dà la mossa alla mia rivale
          const aggr = (orders.indexOf("nerba") >= 0 || orders.indexOf("buttati") >= 0) && rivalId && byId[rivalId] && rivalId !== h.id;
          if (aggr) { h.allyTargetId = rivalId; h.allyHelp = true; h.paraInRace = rivalId; setVendetta(h, rivalId); }
        } else {
          // Nessun ordine: comportamento storico — addosso alle PRIME DUE favorite.
          const favs = topFavouritesRunning([playerId, h.id], 2);
          h.allyTargetId = favs[0] || favId; h.allyHelp = true;
          setVendetta(h, h.allyTargetId);
          h.vendettaQueue = favs.slice(1);         // la seconda favorita, in coda
        }
      }
    });
    // ── IL TUO FANTINO COMPRATO da un'altra Contrada ──────────────────────────
    // Se un'AI ha corrotto il TUO fantino, lui si vende: durante la MOSSA, a
    // raffiche di 10s, smette di risponderti e va a parare la rivale di chi l'ha
    // pagato (oppure si gira ai canapi). In CORSA il controllo resta sempre tuo.
    // All'inizio di ogni raffica compare l'avviso "Forse il tuo fantino è corrotto…".
    const boughtBy = cor[playerId];
    const me = byId[playerId];
    if (playing && me && boughtBy && boughtBy !== playerId) {
      me.soldTo = boughtBy;
      const tgt = topRunningRivalId(boughtBy) || (RIVALS[boughtBy] ? Object.keys(RIVALS[boughtBy])[0] : null);
      me.soldTargetId = (tgt && byId[tgt] && tgt !== playerId) ? tgt : null;
      me.soldSpin = false;                       // forzatura a girarsi: la accende la raffica
      me.soldBurst = 0;
      me.soldNext = 12 + Math.random() * 18;     // prima raffica dopo 12-30s di tensione
    }
    // ── FINESTRA AGGRO (prossimi 100 palii): AI più cattive verso il GIOCATORE che corre.
    if (playing && playerId && aggroVsPlayerActive()) {
      // 1) La/le rivale/i del giocatore lo NERBANO e gli vengono ADDOSSO (vendetta
      //    diretta, oltre il cap dei 2 alleati).
      state.horses.forEach((h) => {
        if (h.id === playerId || h.isRincorsa || h.friendlyToPlayer) return;
        if (rivalIntensity(playerId, h.id) > 0 && !h.vendettaPending && h.vendettaState !== "fatto") {
          h.vendettaPending = true; h.vendettaTargetId = playerId; h.allyTargetId = playerId; h.allyHelp = true;
        }
      });
      // 2) MOLTE PIÙ contrade PARANO il giocatore per non farlo vincere: fino a 3 in
      //    più, fra quelle SENZA incarico, gli vanno DAVANTI a bloccarlo.
      let extraPara = 0;
      state.horses.forEach((h) => {
        if (extraPara >= 3 || h.id === playerId || h.isRincorsa || h.friendlyToPlayer) return;
        if (h.paraInRace || h.allyTargetId || h.allyBeneficiaryId) return;   // già con un incarico
        h.paraInRace = playerId; h.allyTargetId = playerId; h.allyHelp = true; extraPara += 1;
      });
    }
  }

  // ── Estrazione/chiamata ai canapi: TUTTE le 9 Contrade (GIOCATORE COMPRESO)
  // fanno il TONDINO e vengono chiamate UNA ALLA VOLTA, in ordine di posta
  // (interno → esterno = ordine di estrazione), entrando fra i canapi passando
  // dal VARCO della rincorsa. La rincorsa (10ª) NON viene chiamata: resta fuori.
  const callOrder = state.horses
    .filter((h) => !h.isRincorsa)                 // include il giocatore
    .sort((a, b) => (a.postIndex ?? 0) - (b.postIndex ?? 0));
  state.callOrder = callOrder;
  state.falseStartCount = 0;                       // conteggio mosse false
  state.chiamataA5 = false;                         // mossa a chiamata del giocatore-acquirente
  state.tuttiFuoriCount = 0;
  state.rincorsaWait = 0;                          // attesa cumulativa della rincorsa
  state.canapiCaos = Math.random() < 0.67;         // ~2/3 dei palii: VERO casino ai canapi nei primi 25s
  state.caosSide = Math.random() < 0.7 ? 1 : -1;   // stringono da un lato: di solito interno (+1)
  state.caosPushers = [];
  state.caosFront = [];                            // ALMENO 6 restano ADDOSSO ai canapi durante il trambusto (non tutti dietro)                          // 2 contrade dal CENTRO che si sfilano dietro e spingono forte (elette pigramente nel casino)
  // Quante volte QUESTO Mossiere è disposto a chiamare "tutti fuori" (TETTO, non
  // obiettivo: se non c'è casino non li chiama affatto). 2 palii su 5 ne concede
  // UNO SOLO → dopo quella prima uscita la rincorsa fianca senza altre chiamate.
  const rTF = Math.random();
  state.tuttiFuoriMax = rTF < 0.4 ? 1 : (rTF < 0.75 ? 2 : 3);
  state.forcedStartWindow = 0;                     // finestra forzata dei 5 minuti
  state.chaosTimer = 0;
  state.recallCount = 0;                            // richiami singoli (2° → tutti fuori)
  state.recallCd = 0;
  state.pressedTimer = 0;
  state.forcedCanapeCd = 0;
  state.canapiSettledSince = null;                 // da quando il campo è schierato ai canapi
  state.asta = null;                               // asta della rincorsa: si apre alla 1ª uscita
  const oldAsta = document.getElementById("astaPanel"); if (oldAsta) oldAsta.remove();
  state.falseStartRunning = false;                 // falso avvio (galoppo → mortaretto → tondino)
  state.falseStartTimer = 0;
  state.falseStartMortarettoDone = false;
  state.callIndex = 0;
  state.sinceCall = 0;
  state.mossiereAnnounced = false;                 // "Il mossiere sta chiamando"
  // Prima attesa lunga = fase di TONDINO: i cavalli arrivano alla mossa e girano
  // nei pressi dei canapi finché il mossiere "ha l'ordine" e inizia a chiamare.
  // 13 = 10 + i 3 secondi in più chiesti: si lascia respirare l'ingresso.
  // (la busta NON parte qui: entra quando il mossiere inizia a chiamare, sotto)
  state.callPause = 13.0;
  // Anche la RINCORSA fa il tondino con le altre e NON è pre-piazzata: si scopre
  // solo alla fine (è la 10ª, l'unica che non viene chiamata). Tutte e 10 sul
  // ring, fasi equidistanti.
  const rincorsaHorse = state.horses.find((h) => h.isRincorsa);
  const ring = rincorsaHorse ? [...callOrder, rincorsaHorse] : [...callOrder];
  // ORDINE DEL TONDINO = casuale e DIVERSO dalla chiamata: i cavalli girano
  // mescolati sull'ovale, così guardando il tondino NON si anticipa nulla
  // dell'estrazione (né la posta del giocatore né chi è di rincorsa).
  for (let i = ring.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ring[i], ring[j]] = [ring[j], ring[i]];
  }
  state.tondinoBase = 0; // reset dell'angolo base comune dell'anello
  ring.forEach((h, k) => {
    h.called = false;
    h.entering = false;
    h.enterTimer = 0;
    if (h.isRincorsa) { h.revealed = false; } else { h.callRank = callOrder.indexOf(h); }
    // OFFSET FISSO equidistante sull'anello; la posizione la dà l'angolo base + offset.
    h.tondinoOffset = (k / ring.length) * TAU;
    const p = TONDINO_CP + Math.cos(h.tondinoOffset) * TONDINO_RP;
    const l = TONDINO_CL + Math.sin(h.tondinoOffset) * TONDINO_RL;
    h.mossaProgress = p;
    h.progress = p;
    h.mossaLane = l;
    h.lane = l;
    placeHorse(h, 0);
  });

  // La rincorsa giocatore parte "in tenuta" (andatura 2): deve premere M per
  // caricare lo slancio, Spazio per arretrare e riprendere la rincorsa.
  const playerHorse = getPlayer();
  // Alla mossa il giocatore parte a velocità 2 (fermo): da lì può muoversi
  // dentro i canapi (M avanti, Spazio indietro) o, se di rincorsa, caricare.
  if (playerHorse) playerHorse.speedSetting = 2;
  showScreen(null);
  setHudVisible(true);
  // NON si anticipa NULLA dell'estrazione: né la posta del giocatore né chi è di
  // rincorsa. Tutti girano mescolati nel tondino finché il mossiere non chiama.
  showMessage("Al tondino: i cavalli girano in attesa della chiamata…", 3.0);
}

// Boost/malus TEMPORANEO di velocità legato alla mossa (asta): +9% per chi si
// aggiudica la mossa pagando (4s), −6% per la rivale bloccata (3s). Il timer viene
// scalato in updateRace; il moltiplicatore entra nelle righe di velocità.
function mossaSpeedMod(horse) {
  return (horse && horse.mossaModTimer > 0) ? (horse.mossaModMult || 1) : 1;
}
// Prepara TUTTI i cavalli allo scatto: andatura, velocita' di crociera, heading,
// ritardo di reazione, rampa di accelerazione, corsia di partenza. La usano sia
// il via buono sia la MOSSA FALSA, che deve partire esattamente come una
// partenza vera — e solo dopo essere interrotta.
function preparaPartenza() {
state.horses.forEach((horse) => {
    if (isHuman(horse)) {
      const effectiveAndatura = getPlayerEffectiveSpeed(horse); // 1..5
      horse.effectiveSpeedLevel = effectiveAndatura;
      const intensity = effectiveAndatura * 2; // intensità interna (animazione)
      // Una partenza "lenta" (fermo al via) parte a intensità/velocità ridotte.
      const slowStart = horse.startQuality === "slow";
      horse.speedLevel = slowStart ? intensity * 0.4 : intensity;
      horse.targetSpeedLevel = intensity;
      const cruise = andaturaToSpeed(effectiveAndatura);
      horse.travelSpeed = slowStart ? cruise * 0.4 : cruise;
      // Heading iniziale = direzione della pista + eventuale deviazione del muso.
      // NIENTE raddrizzamento automatico: se alla mossa eri girato/inclinato,
      // parti così come sei e sei tu a doverti raddrizzare con lo sterzo.
      horse.heading = sampleAt(horse.progress).yaw + (horse.mossaTurn || 0) + horse.launchHeadingDev;
    } else {
      // Velocità massima al via = obiettivo AI; la rincorsa eredita lo slancio.
      const baseTarget = horse.isRincorsa
        ? clamp(horse.rincorsaSpeed || 4, 3, 8)
        : BASE_SPEED_LEVEL;
      const qualityFactor = horse.startQuality === "slow" ? 0.35
        : horse.startQuality === "closed" ? 0.5
        : horse.startQuality === "dirty" ? 0.72
        : horse.startQuality === "wide" ? 0.85
        : 0.92;
      const startSpeed = clamp(baseTarget * qualityFactor, 1, baseTarget);
      horse.speedLevel = startSpeed;
      horse.targetSpeedLevel = Math.max(baseTarget, startSpeed);
      horse.effectiveSpeedLevel = startSpeed;
      horse.surgeTimer = 0.4 + Math.random() * 0.6;
      horse.surgeCooldown = 2.2 + Math.random() * 2.6;
      horse.surgeTarget = baseTarget;
      horse.boosting = false;
      horse.heading = undefined;
    }
    // Se il cavallo era inclinato alla mossa PARTE inclinato (per le AI si
    // raddrizza da solo galoppando, per gradi; il giocatore ha già l'heading).
    horse.raceTurn = isHuman(horse) ? 0 : (horse.mossaTurn || 0);
    // Ritardo di reazione individuale: chi è più reattivo scatta prima. La
    // rincorsa è già lanciata, quindi non subisce ritardo.
    horse.launchDelay = (1 - horse.reactivity) * LAUNCH_MAX_DELAY + (horse.corruptDelay || 0);   // rivale corrotta = +2,5s
    horse.launchDelayTimer = horse.isRincorsa ? 0 : horse.launchDelay;
    horse.launching = horse.launchDelayTimer > 0;
    // Nessuno "scoppio" alla partenza: l'avanzamento riparte da ZERO e raggiunge
    // la velocità piena GRADUALMENTE in 4 secondi (launchRamp 0→1 lineare).
    horse.launchRamp = 0;
    // Corsia di partenza: ogni cavallo va dritto dalla propria posizione di mossa
    // per qualche secondo prima di cercare la traiettoria ideale.
    horse.startLane = horse.lane;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// IL VIA DAI CANAPI — uno solo, per la mossa buona E per la mossa falsa.
// Qui c'e' tutto quello che fa PARTIRE i cavalli: qualita' dello scatto, handicap
// della rivale, effetti dell'asta, andature, heading, ritardi di reazione. La
// mossa falsa NON e' una simulazione a parte: parte da qui identica alla vera, e
// l'unica differenza e' che dopo quattro secondi il mortaretto la annulla.
// ══════════════════════════════════════════════════════════════════════════════
function viaDaiCanapi() {
  // Qualità di partenza per tutti (prima di impostare gli heading).
  state.horses.forEach((horse) => computeStartQuality(horse));
  // REGOLA: quando una contrada è di RINCORSA, la sua RIVALE non parte fra le prime
  // 4 → le forziamo lo start "slow" (0,4× di slancio), così scatta male e resta
  // indietro al via. Vale anche se la rivale è il giocatore (handicap silenzioso).
  {
    const rin = state.horses.find((h) => h.isRincorsa);
    const rMap = rin ? (RIVALS[rin.id] || null) : null;
    if (rMap) state.horses.forEach((h) => { if (h !== rin && rMap[h.id]) h.startQuality = "slow"; });
  }
  // ASTA: chi si è AGGIUDICATO la mossa pagando → boost di accelerazione al via
  // (+9% per 4s). Chi ha pagato il BLOCCO anti-rivale ONORATO → la rivale bloccata
  // parte "slow" (mai nelle prime 2) e con malus di velocità (−6% per 3s).
  {
    const A = state.asta;
    if (A) {
      const byId = (id) => state.horses.find((h) => h.id === id);
      const rinH = state.horses.find((h) => h.isRincorsa);
      if (A.bestBidder && ((A.paid && A.paid[A.bestBidder]) || A.bestBidder === A.prepaidHolder)) {
        const w = byId(A.bestBidder);
        if (w) {
          w.mossaModMult = 1.09; w.mossaModTimer = 4;   // +9% per 4s a chi si aggiudica la mossa pagando
          // Se il GIOCATORE è di rincorsa e ha incassato → chi ha pagato parte fra le prime 2 (start pulito + boost).
          if (rinH && isHuman(rinH)) w.startQuality = "clean";
        }
      }
      Object.keys(A.blocco || {}).forEach((id) => {
        const b = A.blocco[id];
        if (b && A.bestBidder !== b.target) {   // blocco ONORATO: la rivale non ha spuntato l'asta
          const r = byId(b.target);
          if (r) { r.startQuality = "slow"; r.mossaModMult = 0.94; r.mossaModTimer = 3; }
        }
      });
    }
  }

  preparaPartenza();

  // Nessun freno/spinta in base alle vittorie (rimosso su richiesta): balanceMult = 1.
  state.horses.forEach((h) => { h.balanceMult = 1; });
  // PRIMO GIRO DI PIAZZA: tutti max andatura 4; DUE AI a caso "contenute" a 3.
  // Dal secondo giro il tetto sparisce (3-4-5 liberi). Riassegnato a ogni partenza.
  state.horses.forEach((h) => { h.firstLapCap = 4; });
  shuffleInPlace(state.horses.filter((h) => !h.player)).slice(0, 2).forEach((h) => { h.firstLapCap = 3; });
}

function releaseRace() {
  { const tl = document.querySelector(".hud-top-left"); if (tl) tl.style.display = ""; const tr = document.querySelector(".hud-top-right"); if (tr) tr.style.display = ""; }   // #C: ripristina i box Posizione e Giro al Via
  // ── PARTENZA FUORI POSIZIONE ────────────────────────────────────────────
  // Chi al momento del via è molto arretrato o di traverso rispetto al canape si
  // becca un avvertimento: è la stessa cosa che in Piazza fa arrabbiare il
  // Mossiere. Il giocatore non è esentato — le regole valgono per tutti.
  (state.callOrder || []).forEach((h) => {
    if (!h || h.isRincorsa) return;
    const arretrato = (h.mossaProgress ?? h.progress ?? 0) < MOSSA_FRONT_LIMIT - 4.5;
    const traverso = Math.abs(h.mossaTurn || 0) > 0.9;
    if (arretrato || traverso) daiAvvertimento(h, arretrato ? "partenza fuori posizione" : "girata al canape");
  });
  // Le squalifiche pendenti erano per QUESTO palio: da qui in poi sono scontate.
  scontaSqualifiche();
  chiudiAstaRincorsa();                                    // aggiudica l'asta e rimborsa i blocchi non onorati
  const oldAsta = document.getElementById("astaPanel"); if (oldAsta) oldAsta.remove();
  recordPalioRun();                                        // +1 al totale palii corsi (globale)
  // NIENTE "gate di favore". Prima, in una piccola frazione dei palii, al giocatore
  // venivano tolti tutti gli handicap: la percentuale di vittorie usciva da quel
  // sorteggio, non dalla corsa. Ora gli ostacoli valgono SEMPRE e allo stesso modo,
  // e la percentuale è quella che ne risulta davvero in pista.
  state.mode = "race";
  // ── TRAIETTORIE ───────────────────────────────────────────────────────────
  // Si registra la linea SOLO quando a guidare è davvero Mario Rossi (non in
  // autopilot): è il suo modo di correre che vogliamo far imparare alle AI.
  {
    const p = getPlayer();
    const registro = !!(p && !p.autopilot && isMarioRossi(getAccount()));
    state.tracciaCorsa = registro ? new Array(tracciaSlotTotali()).fill(null) : null;
    assegnaTracceAlleAI();
  }
  if (state.chiamataA5) { const p = getPlayer(); if (p) p.chiamataNoStaminaT = 2; state.chiamataA5 = false; }   // partenza a chiamata: 0 stamina per 2s
  state.raceClock = 0;
  state.replay = { frames: [], acc: 0 };   // nuovo nastro per il replay
  state.raceRunout = 0;                     // niente runout ereditato dalla gara prima
  state.victoryShown = false;               // la vittoria si mostrerà a questo arrivo
  state.mortarettoFired = false;            // i 3 scoppi ripartono a 14 unità dall'arrivo
  const staleReplayHud = document.getElementById("replayHud");
  if (staleReplayHud) staleReplayHud.remove();  // difensivo: mai HUD replay in una gara nuova
  state.canapiDrop = 0.001;
  state.canapiDropTimer = 5.0; // il canapo posteriore svanisce dopo 5s
  state.announce = { prevRank: null, lastLap: false, finishNear: false, headToHead: false };

  // Nascondi l'HUD della rincorsa: la mossa è finita.
  const rincorsaHud = document.getElementById("rincorsaHud");
  if (rincorsaHud) rincorsaHud.classList.remove("visible");

  // FANTINO COMPRATO: il tradimento vale SOLO ai canapi. Se una raffica è ancora
  // in corso al momento del via, la chiudo: in CORSA il controllo torna al giocatore.
  state.horses.forEach((h) => {
    if (!h.soldTo || !(h.soldBurst > 0)) return;
    h.soldBurst = 0;
    h.autopilot = !!h.soldPrevAutopilot;
    h.vendettaPending = false; h.vendettaState = null; h.vendettaTargetId = null;
    h.soldSpin = false;
  });

  viaDaiCanapi();


  // ── INCIDENTE DI SAN MARTINO (1 palio su 6) ────────────────────────────────
  // Sorteggiato QUI, alla partenza: se esce, al primo passaggio a San Martino le
  // tre AI di testa si stringono in curva e battono — maxi-caduta che si porta
  // dietro le attaccate (giocatore compreso, se è lì in mezzo). Il trigger vero
  // sta in updateRace.
  state.sanMartinoIncident = Math.random() < 1 / 6;
  state.sanMartinoIncidentDone = false;
  state.tempestaFellDone = false;   // guardia per la caduta provvisoria di Tempesta a San Martino
  state.gridoFellDone = false;      // idem per Grido
  state.tartucaFellDone = false;    // idem per la Tartuca (AI, San Martino)
  state.giraffaFellDone = false;    // idem per la Giraffa (AI, Casato)


  state.cameraShake = 0.05;
  showMessage("Via!", 0.85);
  try { fadeBusta(0.8); } catch (e) { /* niente */ }       // il tondino è finito: via la busta
  try { playStartMossa(); } catch (e) { /* niente */ }     // fortissimo 2s, poi volume normale
  try { startCrowdBed(0.3); } catch (e) { /* niente */ }   // il pubblico (corsa.m4a) SOTTO tutta la corsa
  try { startGaloppo(0.34); } catch (e) { /* niente */ }   // …e lo zoccolio del gruppo, in loop
}

// ── TONDINO: vita alla mossa prima della chiamata ───────────────────────────
// I cavalli girano e scalpitano nella zona della mossa (dietro i canapi), non
// ancora schierati. Comportamento differenziato per indole del cavallo
// (nervosismo) e del fantino (aggressività/controllo): cerchi, mezze curve,
// scarti, avvicinamenti e allontanamenti dai canapi. Niente caos arcade.
function tondinoBehavior(horse, dt, time) {
  const prevLane = horse.lane;
  const prevProg = horse.mossaProgress;
  // ── TONDINO: TUTTI girano insieme attorno a UN UNICO ovale, senso antiorario.
  // Un ANGOLO BASE comune (avanza una volta per frame in updateMossa) fa ruotare
  // l'anello; ogni cavallo tiene il suo OFFSET FISSO → restano SEMPRE equidistanti,
  // niente ammucchiamenti né accelerazioni impazzite. Solo una lieve oscillazione
  // nervosa attorno alla propria posizione (fissa: il nervosismo non c'entra più).
  const wobble = Math.sin(time * 1.1 + horse.phase) * 0.025;
  const angle = (state.tondinoBase || 0) + (horse.tondinoOffset || 0) + wobble;
  const goalP = TONDINO_CP + Math.cos(angle) * TONDINO_RP;
  const goalL = TONDINO_CL + Math.sin(angle) * TONDINO_RL;
  const ease = clamp(dt * 2.2, 0, 1);
  horse.mossaProgress += (goalP - horse.mossaProgress) * ease;
  horse.mossaLane += (goalL - horse.mossaLane) * ease;
  horse.mossaProgress = clamp(horse.mossaProgress, TONDINO_CP - TONDINO_RP - 2, MOSSA_BACK_LIMIT - 0.5);
  horse.mossaLane = clamp(horse.mossaLane, -TONDINO_LANE_MAX, TONDINO_LANE_MAX);
  horse.progress = horse.mossaProgress;
  horse.lane = horse.mossaLane;
  horse.laneVelocity = (horse.lane - prevLane) / Math.max(dt, 0.001);
  // Muso nella direzione del giro (così si vede che girano davvero in tondo).
  const dAlong  = horse.mossaProgress - prevProg;
  const dAcross = horse.mossaLane - prevLane;
  if (Math.abs(dAlong) + Math.abs(dAcross) > 0.0006) {
    const s = sampleAt(horse.progress);
    const wx = dAlong * s.tangent.x + dAcross * s.normal.x;
    const wz = dAlong * s.tangent.z + dAcross * s.normal.z;
    horse.mossaTurn = lerp(horse.mossaTurn || 0, angleDiff(Math.atan2(wx, wz), s.yaw), clamp(dt * 3, 0, 1));
  }
  horse.speedLevel = 1.0; // passo/trotto calmo, mai galoppo (fisso: il nervosismo non c'entra più nel tondino)
}

// Ritorno al tondino dopo una CHIAMATA FUORI (mossa falsa / tutti fuori): la
// Contrada torna DIRITTA e spedita al suo slot sull'ovale. Serve perché
// tondinoBehavior, appena de-chiamato, clampava il progress a MOSSA_BACK_LIMIT-0.5
// e poi faceva un lerp asintotico verso l'ovale: i cavalli si incastravano/
// "laggavano" contro il canapo posteriore prima di disperdersi. Qui invece si
// cammina a velocità costante in linea retta, attraversando pulito il canapo.
function returnToTondinoStep(horse, dt, time) {
  const prevLane = horse.lane, prevProg = horse.mossaProgress;
  const wobble = Math.sin(time * 1.1 + horse.phase) * 0.025;
  const angle = (state.tondinoBase || 0) + (horse.tondinoOffset || 0) + wobble;
  const goalP = TONDINO_CP + Math.cos(angle) * TONDINO_RP;
  const goalL = TONDINO_CL + Math.sin(angle) * TONDINO_RL;
  const dl = goalL - horse.mossaLane, dp = goalP - horse.mossaProgress;
  const dist = Math.hypot(dl, dp) || 1;
  const walkV = 6.0;                                   // u/sec: torna spedito, in linea retta
  const step = Math.min(walkV * dt, dist);
  horse.mossaLane += (dl / dist) * step;
  horse.mossaProgress += (dp / dist) * step;           // NIENTE clamp: passa pulito dietro il canapo
  horse.progress = horse.mossaProgress;
  horse.lane = horse.mossaLane;
  horse.laneVelocity = (horse.lane - prevLane) / Math.max(dt, 0.001);
  const dAlong = horse.mossaProgress - prevProg, dAcross = horse.mossaLane - prevLane;
  if (Math.abs(dAlong) + Math.abs(dAcross) > 0.0006) {
    const s = sampleAt(horse.progress);
    const wx = dAlong * s.tangent.x + dAcross * s.normal.x;
    const wz = dAlong * s.tangent.z + dAcross * s.normal.z;
    horse.mossaTurn = lerp(horse.mossaTurn || 0, angleDiff(Math.atan2(wx, wz), s.yaw), clamp(dt * 4, 0, 1));
  }
  horse.speedLevel = step > 0.001 ? 2.8 : 1.0;         // trotto deciso mentre rientra
  if (dist < 0.6) horse.returningToTondino = false;    // arrivato all'ovale: riprende il giro normale
}

// Allineamento della mossa: le 9 Contrade devono essere TUTTE entrate, vicine al
// fronte e poco sparpagliate. Se non lo sono quando la rincorsa entra → mossa falsa.
// Quanto può arretrare DA SOLO un cavallo alla posta (ciclo "esce dietro" +
// scarto imbizzarrito). DEVE restare sotto MOSSA_ALIGN_GAP, altrimenti il
// comportamento normale della fila basta a rendere ogni mossa falsa.
const MOSSA_BACK_MAX = 1.9;
// Oltre quanto una Contrada è "proprio dietro" al gruppo → fila non allineata.
const MOSSA_ALIGN_GAP = 2.6;

function isMossaAligned() {
  // Il GIOCATORE non conta per la validità: se la rincorsa parte mentre TU sei
  // fuori posizione è comunque mossa VALIDA (parti male, ma non è falsa). Conta
  // l'allineamento delle AI schierate.
  const line = (state.callOrder || []).filter((h) => !isHuman(h));
  if (!line.length) return true;
  if (line.some((h) => !h.called || h.entering)) return false; // qualcuno non ancora dentro
  // Conta SOLO la posizione longitudinale (l'ORIENTAMENTO non conta: una girata ma
  // sulla linea è valida, poi son cazzi suoi a raddrizzarsi). La fila è buona se il
  // gruppo è compatto e avanti; se UNA è PROPRIO DIETRO la dispersione sfora la
  // soglia → non allineata → mossa falsa. Tollerante allo scalpitìo, boccia lo stacco.
  // La più indietro NON deve essere PROPRIO staccata dal grosso: si guarda quanto
  // è dietro rispetto alla MEDIANA (robusta allo scalpitìo), non la dispersione
  // totale. Se una è oltre ~2.6 dietro il gruppo → è "proprio dietro" → mossa falsa.
  const progs = line.map((h) => h.mossaProgress).sort((a, b) => a - b);
  const median = progs[Math.floor(progs.length / 2)];
  const backGap = median - progs[0];        // quanto la più indietro stacca dal gruppo
  return median > MOSSA_FRONT_LIMIT - 3.2 && backGap < MOSSA_ALIGN_GAP;
}

// Tutte e 9 le Contrade CHIAMATE e AL CANAPO (per il timeout dei 5 minuti): tutte
// devono essere state chiamate (non parte se una manca) e le AI schierate.
function allNineCalledAndAtCanape() {
  const nonRin = state.horses.filter((h) => !h.isRincorsa);
  if (!nonRin.length) return false;
  if (nonRin.some((h) => !h.called)) return false;   // qualcuna non ancora chiamata → si aspetta
  return isMossaAligned();                             // le 9 (AI) schierate al canapo
}

// Nome della Contrada con l'ARTICOLO giusto ("l'Aquila", "il Bruco", "la Torre"):
// serve per i messaggi tipo "Mossa falsa: l'Aquila era dietro".
const CONTRADE_MASCHILI = new Set(["bruco", "drago", "leocorno", "nicchio", "valdimontone", "istrice"]);
function nomeConArticolo(h) {
  if (!h || !h.name) return "una Contrada";
  if ("aeiou".includes(h.name[0].toLowerCase())) return "l'" + h.name;
  return (CONTRADE_MASCHILI.has(h.id) ? "il " : "la ") + h.name;
}

// PERCHÉ la mossa è falsa: specchia i controlli di isMossaAligned e indica il
// colpevole. Chiamata NEL MOMENTO del trigger (dopo, le posizioni sono già
// cambiate dal galoppo del falso avvio).
function motivoMossaFalsa() {
  const line = (state.callOrder || []).filter((h) => !isHuman(h));
  if (!line.length) return "la fila non era pronta";
  const fuori = line.find((h) => !h.called || h.entering);
  if (fuori) return `${nomeConArticolo(fuori)} non era ancora al canapo`;
  const progs = line.map((h) => h.mossaProgress).sort((a, b) => a - b);
  const median = progs[Math.floor(progs.length / 2)];
  if (median <= MOSSA_FRONT_LIMIT - 3.2) return "il gruppo non era schierato al canapo";
  let peggiore = line[0];
  line.forEach((h) => { if (h.mossaProgress < peggiore.mossaProgress) peggiore = h; });
  return `${nomeConArticolo(peggiore)} era dietro`;
}

// Mossa falsa: NON si annulla di colpo. Come nella realtà si ABBASSA il canape e i
// cavalli PARTONO davvero; dopo 2s scoppia il mortaretto (falso!) e al 4° secondo i
// fantini li rimettono nel tondino. La sequenza la fa updateFalseStartRunout().
// `motivo` (opzionale) finisce nel messaggio del mortaretto: se manca, lo si
// deduce ORA da motivoMossaFalsa() — non al momento del mortaretto, quando i
// cavalli sono già lanciati in galoppo e il "dietro" non si legge più.
// ══════════════════════════════════════════════════════════════════════════
// AVVERTIMENTI E SQUALIFICHE
// ──────────────────────────────────────────────────────────────────────────
// Chi combina guai alla mossa se lo porta dietro: tre richiami dal Mossiere
// nello stesso palio, o una partenza fuori posizione, valgono un AVVERTIMENTO.
// Gli avvertimenti si sommano di palio in palio: al terzo, Contrada e fantino
// saltano il Palio successivo. Il conto sta con l'account, come i denari.
const AVVISI_KEY = "palio.avvertimenti.v1";
const AVVISI_PER_SQUALIFICA = 3;
const RICHIAMI_PER_AVVISO = 3;
function caricaAvvisi() {
  try { return JSON.parse(localStorage.getItem(AVVISI_KEY)) || { contrade: {}, fantini: {}, squalificati: {} }; }
  catch (e) { return { contrade: {}, fantini: {}, squalificati: {} }; }
}
function salvaAvvisi(a) {
  try { localStorage.setItem(AVVISI_KEY, JSON.stringify(a)); } catch (e) { /* niente */ }
}
// Un avvertimento a una Contrada e al suo fantino. Al terzo scatta la squalifica
// per il palio successivo.
function daiAvvertimento(horse, motivo) {
  if (!horse || horse.avvisoDato) return;      // uno solo per palio a testa
  horse.avvisoDato = true;
  const a = caricaAvvisi();
  const cid = horse.id;
  const nick = horse.jockey && horse.jockey.nick;
  a.contrade[cid] = (a.contrade[cid] || 0) + 1;
  if (nick) a.fantini[nick] = (a.fantini[nick] || 0) + 1;
  const nC = a.contrade[cid];
  const nF = nick ? a.fantini[nick] : 0;
  let testo = `AVVERTIMENTO a ${horse.name}: ${motivo} (${nC}/${AVVISI_PER_SQUALIFICA})`;
  if (nC >= AVVISI_PER_SQUALIFICA) {
    a.squalificati["c:" + cid] = true;
    a.contrade[cid] = 0;
    testo = `${horse.name} SQUALIFICATA per un Palio: tre avvertimenti`;
  }
  if (nick && nF >= AVVISI_PER_SQUALIFICA) {
    a.squalificati["f:" + nick] = true;
    a.fantini[nick] = 0;
    testo += ` · anche ${nickUp(nick)} salta il prossimo Palio`;
  }
  salvaAvvisi(a);
  showMessage(testo, 3.2, "danger");
}
// Chi salta il prossimo Palio (letto quando si formano le partecipanti).
function contradaSqualificata(id) { return !!caricaAvvisi().squalificati["c:" + id]; }
function fantinoSqualificato(nick) { return !!caricaAvvisi().squalificati["f:" + nick]; }
// Scontata la squalifica: si riparte puliti.
function scontaSqualifiche() {
  const a = caricaAvvisi();
  a.squalificati = {};
  salvaAvvisi(a);
}

function triggerMossaFalsa(motivo) {
  if (state.falseStartRunning || state.mode !== "mossa") return;   // una alla volta
  state.falseStartCount = (state.falseStartCount || 0) + 1;
  state.falseStartRunning = true;
  state.falseStartTimer = 0;
  state.falseStartMortarettoDone = false;
  state.falsaMotivo = motivo || motivoMossaFalsa();

  // ── E' UNA PARTENZA VERA. PUNTO. ───────────────────────────────────────────
  // Il Mossiere ha abbassato il canape e le Contrade sono partite: per i quattro
  // secondi che seguono non c'e' NIENTE di diverso da un Palio cominciato. Si
  // entra in modalita' CORSA come al via buono — ed e' questo che prima mancava:
  // restando in "mossa" meta' dei sistemi erano spenti (il tuo cavallo non veniva
  // nemmeno orientato secondo il tuo heading, la telecamera non ti seguiva, le AI
  // correvano in un mondo che non era quello della corsa) e infatti i movimenti
  // sembravano sbagliati. Adesso e' la corsa vera, che dopo 4 secondi si annulla.
  state.canapiDrop = 0.001;                               // il canapo frontale si abbassa
  state.canapiDropTimer = 5.0;                            // il posteriore svanisce, come al via
  state.horses.forEach((h) => { h.canapeStop = false; });
  viaDaiCanapi();                                         // <-- lo STESSO via della mossa buona
  state.raceClock = 0;                                    // la corsa comincia adesso
  state.raceRunout = 0;
  state.announce = { prevRank: null, lastLap: false, finishNear: false, headToHead: false };
  // Il nastro del replay e le traiettorie insegnate alle AI restano quelli veri:
  // una partenza annullata non deve finire nel replay ne' insegnare niente.
  state.falsaBackupReplay = state.replay;
  state.falsaBackupTraccia = state.tracciaCorsa;
  state.replay = { frames: [], acc: 0 };
  state.tracciaCorsa = null;
  state.mode = "race";                                    // <-- la chiave: si CORRE
  showMessage("Partiti!", 1.4, "good");
  try { fadeBusta(0.6); } catch (e) { /* niente */ }      // la busta del tondino sfuma
  try { playStartMossa(); } catch (e) { /* niente */ }
  try { startCrowdBed(0.3); } catch (e) { /* niente */ }  // il pubblico esplode come al via
  try { startGaloppo(0.34); } catch (e) { /* niente */ }  // e lo zoccolio del gruppo
}

// Avanzamento del FALSO AVVIO (4s): galoppo → 2s mortaretto → 4s ritorno al tondino.
function updateFalseStartRunout(dt, time) {
  state.falseStartTimer += dt;
  // Gira updateRace: LA corsa, la stessa identica funzione del Palio vero. Non
  // una simulazione parallela — quella era l'errore di prima.
  updateRace(dt, time);
  if (!state.falseStartMortarettoDone && state.falseStartTimer >= 2) {
    state.falseStartMortarettoDone = true;
    playMortaretto(1.4);                                  // COLPO FORTE: si deve sentire sopra tutto
    playCrowd("cold");                                    // brusio deluso della Piazza
    showMessage(`Mossa falsa: ${state.falsaMotivo || "la fila non era buona"}`, 3.0, "danger");
    state.cameraShake = Math.max(state.cameraShake, 0.45);
  }
  if (state.falseStartTimer >= 4) {
    state.falseStartRunning = false;
    state.mode = "mossa";                                 // si smette di correre: si torna alla mossa
    state.canapiDrop = 0;                                 // il canapo torna su
    // Il canapo posteriore stava gia' dissolvendo (updateRace lo sfuma in 5s):
    // rimettilo pieno e visibile, ai canapi ci si torna.
    state.canapiDropTimer = 0;
    const post = state.canapiPosteriore;
    if (post) {
      post.visible = true;
      post.traverse((obj) => { if (obj.material && obj.material.transparent) obj.material.opacity = 1; });
    }
    // Replay e traiettorie tornano quelli veri: la partenza annullata non lascia traccia.
    state.replay = state.falsaBackupReplay || null;
    state.tracciaCorsa = state.falsaBackupTraccia || null;
    state.falsaBackupReplay = null; state.falsaBackupTraccia = null;
    resetMossaAfterFalsa();
  }
}

// Rimette il campo nel tondino dopo il falso avvio: STESSO ordine di richiamo,
// STESSA rincorsa; la mossa riparte e sale il nervosismo.
function resetMossaAfterFalsa() {
  (state.callOrder || []).forEach((h) => {
    h.called = false;
    h.entering = false; h.enterPhase = undefined; h.mossaTurn = 0; h.behaviorState = "idle";
    h.nervBackState = null; h.nervBackTimer = 0;   // si riparte dal tondino: nessuno resta "agitato"
    h.blockingRincorsa = false;
    // Si torna ai canapi: si spegne quello che il falso avvio aveva acceso.
    h.launching = false; h.launchRamp = 0; h.travelSpeed = 0; h.speedLevel = 0;
    h.heading = undefined; h.raceTurn = 0;
    // Sono stati quattro secondi di corsa vera: puo' esserci chi e' caduto o e'
    // rimasto scosso. Ai canapi si torna tutti interi.
    h.caduto = false; h.cadutoTimer = 0; h.cadutoRoll = 0; h.cadutoMult = 1; h.cadutoSlide = 0;
    h.scosso = false; h.finishTime = null; h.boosting = false;
    h.mossaModMult = 1; h.mossaModTimer = 0;
    h.returningToTondino = true;
    // TAGLIO: dopo la mossa FALSA si riparte DIRETTAMENTE dal tondino (snap immediato),
    // non col rientro lento a piedi. dt enorme → il passo copre tutta la distanza in 1 frame.
    try { returnToTondinoStep(h, 999, 0); } catch (e) { /* niente */ }
  });
  state.callIndex = 0;
  state.sinceCall = 0;
  state.callPause = 8.2;   // +5s: tornati al tondino c'è il tempo di trattare la mossa
  try { startBusta(0.4); } catch (e) { /* niente */ }   // si torna al tondino: rientra il sottofondo
  state.mossaPhase = "positioning";
  state.tensionTimer = 0;                 // la mossa RIPARTE: attesa/tensione da capo
  state.recallCount = 0; state.recallCd = 0; state.pressedTimer = 0;
  state.canapiSettledSince = null; state.chaosTimer = 0;
  const rincorsa = state.horses.find((h) => h.isRincorsa);
  if (rincorsa) {
    rincorsa.progress = RINCORSA_START_PROGRESS;
    rincorsa.mossaProgress = RINCORSA_START_PROGRESS;
    rincorsa.prevProgress = RINCORSA_START_PROGRESS;
    rincorsa.wantsToEnter = false;
    rincorsa.rincorsaSpeed = 0;
    rincorsa.mossaSubState = "runup";
    rincorsa.travelSpeed = 0; rincorsa.speedLevel = 0;
  }
  state.mossaFalsaCooldown = 3.0;                         // la rincorsa aspetta prima di riprovare
  openAstaRincorsa();                                     // scoperta la rincorsa: si tratta
  // Ogni mossa falsa alza la tensione: cavalli più nervosi, fantini più agitati.
  state.horses.forEach((h) => nervEvento(h, 0.07));
}

// ── "TUTTI FUORI": quando dentro i canapi c'è troppo caos, il Mossiere fa
// uscire tutte le Contrade; poi le richiama NELLO STESSO ORDINE (callOrder
// invariato) e la rincorsa resta la stessa. La tensione sale.
function triggerTuttiFuori() {
  state.tuttiFuoriCount = (state.tuttiFuoriCount || 0) + 1;
  showMessage("Il Mossiere chiama TUTTI FUORI!", 2.6, "danger");
  playTrombetti("squillo");
  playCrowd("cold");   // il pubblico rumoreggia
  state.cameraShake = Math.max(state.cameraShake, 0.3);
  (state.callOrder || []).forEach((h) => {
    h.called = false;                    // torna al tondino (stesso ordine di richiamo)
    h.entering = false;
    h.enterPhase = undefined;
    h.mossaTurn = 0;
    h.behaviorState = "idle";
    h.blockingRincorsa = false;
    h.nervBackState = null; h.nervBackTimer = 0;   // tutti fuori: si azzera anche l'agitazione
    h.returningToTondino = true;   // torna DIRETTO all'ovale, senza incastrarsi sul canapo posteriore
    nervEvento(h, 0.08);
  });
  state.callIndex = 0;                   // richiama dalla prima, ORDINE IDENTICO
  state.sinceCall = 0;
  state.callPause = 9.0;   // +5s: dopo il "tutti fuori" c'è il tempo di trattare la mossa
  try { startBusta(0.4); } catch (e) { /* niente */ }   // tutti al tondino: rientra il sottofondo
  state.mossaPhase = "positioning";
  state.tensionTimer = 0;
  state.chaosTimer = 0;
  state.recallCount = 0;                 // il conteggio richiami riparte da zero
  state.recallCd = 0;
  state.pressedTimer = 0;
  state.canapiSettledSince = null;       // il campo esce: la permanenza di 30s riparte al rientro
  openAstaRincorsa();                    // ora tutti sanno chi è di rincorsa: si tratta
}

// Un cavallo è "umano" (comandi da tastiera nella mossa) solo se è il giocatore
// E NON è in autopilot. In ASSISTI il cavallo-focus è player ma autopilot: va
// trattato come un'AI in tutta la mossa. In gara normale nessuno è autopilot,
// quindi isHuman ≡ player (comportamento invariato).
function isHuman(horse) { return !!(horse && horse.player && !horse.autopilot); }

function updateMossa(dt, time) {
  state.mossaTimer += dt;
  state.mossaSubTimer += dt;
  state.forcedCanapeCd = Math.max(0, (state.forcedCanapeCd || 0) - dt);   // cooldown "forza il canape"
  // FALSO AVVIO in corso: galoppo breve → mortaretto → ritorno al tondino. Blocca
  // ogni altra logica di mossa finché la sequenza dei 4s non è finita.
  // (la mossa falsa non passa piu' di qui: gira in modalita' corsa, vedi il dispatch)
  // Angolo BASE del tondino: avanza UNA VOLTA per frame (non per cavallo), così
  // l'intero anello ruota insieme a passo costante e calmo.
  state.tondinoBase = (state.tondinoBase || 0) + TONDINO_SPIN * 0.5 * dt;
  // Cooldown dopo una mossa falsa: la rincorsa resta fuori e non può innescare il via.
  if ((state.mossaFalsaCooldown || 0) > 0) {
    state.mossaFalsaCooldown -= dt;
    const r = state.horses.find((h) => h.isRincorsa);
    if (r && r.progress > MOSSA_BACK_LIMIT - 0.5) { r.progress = MOSSA_BACK_LIMIT - 0.5; r.mossaProgress = r.progress; }
  }

  // Chiamata UNO ALLA VOLTA: il prossimo cavallo viene chiamato solo quando il
  // precedente è ENTRATO ai canapi. Ogni chiamato parte dalla zona della
  // rincorsa (dietro) ed entra fino alla sua posta.
  const order = state.callOrder;
  if (order && order.length) {
    const someoneEntering = order.some((h) => h.entering);
    state.sinceCall = (state.sinceCall || 0) + dt;   // tempo trascorso dall'ultima chiamata
    // Prima della PRIMA chiamata: annuncio "Il mossiere sta chiamando".
    if (state.callIndex === 0 && !someoneEntering && !state.mossiereAnnounced && state.callPause <= 3.2) {
      state.mossiereAnnounced = true;
      showMessage("Il mossiere sta chiamando", 3.0, "good");
      // Da qui parte la chiamata: l'ingresso in Piazza sfuma e sotto entra la
      // busta. Non partono insieme perché ingresso.m4a dura 27s e si accavallerebbe
      // a tutto il tondino.
      try { fadePalioSound("ingresso.m4a", 2.0); } catch (e) { /* niente */ }
      try { startBusta(0.4); } catch (e) { /* niente */ }
    }
    if (state.callIndex < order.length) {
      state.callPause -= dt;
      const first = state.callIndex === 0;
      // La PRIMA rispetta il ritardo iniziale (chiarine); le SUCCESSIVE si chiamano
      // appena la precedente è entrata (pausa breve) e comunque MAX 3s dopo, così
      // non si aspetta mai troppo fra una chiamata e l'altra.
      const ready = first
        ? state.callPause <= 0
        : (!someoneEntering && state.callPause <= 0) || state.sinceCall >= 3.0;
      if (ready) {
        const next = order[state.callIndex];
        next.called = true;
        next.entering = true;
        next.returningToTondino = false;   // ri-chiamata: annulla l'eventuale rientro all'ovale
        next.enterTimer = 0;
        state.callIndex += 1;
        state.sinceCall = 0;
        state.callPause = 0.7;   // pausa breve minima dopo l'ingresso del precedente
        // Scritta a schermo (una alla volta) + CANTO della Contrada chiamata.
        announceCall(next.name, next.id);
      }
    }
  }

  // Fase globale: si passa alla tensione solo quando TUTTI sono stati chiamati
  // ed entrati (fine dell'estrazione), poi sale il nervosismo.
  const allReady = !order || (state.callIndex >= order.length && !order.some((h) => h.entering));
  if (state.mossaPhase === "positioning" && allReady && state.mossaTimer > 1.0) {
    state.mossaPhase = "tension";
    state.mossaSubTimer = 0;
    state.tensionTimer = 0; // da qui parte il conteggio della tensione ai canapi
    // SCOPERTA della rincorsa: le 9 sono schierate, l'unica rimasta nel tondino
    // è la rincorsa. Ora si rivela e va a prendere la sua posizione.
    const rin = state.horses.find((h) => h.isRincorsa);
    if (rin && !rin.revealed) {
      rin.revealed = true;
      // Niente scivolata automatica: il GIOCATORE guida da subito (0), l'AI cammina
      // fin lì da sola (fino a 8s di margine, si azzera appena arrivata).
      rin.revealTimer = isHuman(rin) ? 0 : 8;
      showMessage(isHuman(rin) ? "Sei tu la RINCORSA!" : `Rincorsa: ${rin.name}!`, 2.4, "good");
    }
  }
  if (state.mossaPhase === "tension") state.tensionTimer = (state.tensionTimer || 0) + dt;
  // Orologio PROPRIO della rincorsa: cumula il tempo passato col campo ai canapi e
  // NON viene azzerato dai "tutti fuori" del Mossiere (lei aspetta là fuori comunque).
  // È questo che tiene SLEGATE le sue decisioni da quelle del Mossiere.
  if (state.mossaPhase === "tension") state.rincorsaWait = (state.rincorsaWait || 0) + dt;

  updateAstaAI(dt);    // le AI ancora nel tondino trattano con la rincorsa
  refreshAstaUI();     // pannello di trattativa del giocatore (solo dal tondino)

  // ── FANTINO COMPRATO: raffiche di 10s in cui NON ti risponde ────────────────
  // Passa in mano all'AI (autopilot) e o va a parare la rivale di chi l'ha pagato,
  // o si gira ai canapi. Solo nella MOSSA: in corsa il controllo torna sempre tuo.
  const sold = getPlayer();
  if (sold && sold.soldTo) {
    if ((sold.soldBurst || 0) > 0) {
      sold.soldBurst -= dt;
      if (sold.soldBurst <= 0) {                       // fine raffica: torna a obbedirti
        sold.soldBurst = 0;
        sold.autopilot = !!sold.soldPrevAutopilot;
        sold.vendettaPending = false; sold.vendettaState = null; sold.vendettaTargetId = null;
        sold.soldSpin = false;
        sold.soldNext = 15 + Math.random() * 20;       // prossimo tradimento fra 15-35s
      }
    } else if (state.mossaPhase === "tension") {
      sold.soldNext = (sold.soldNext || 0) - dt;
      if (sold.soldNext <= 0) {                        // parte la raffica
        sold.soldBurst = 10;
        sold.soldPrevAutopilot = !!sold.autopilot;
        sold.autopilot = true;                          // → lo guida l'AI, non tu
        showMessage("Forse il tuo fantino è corrotto…", 2.6, "danger");   // si sfila ai canapi e prende il controllo
        if (sold.soldTargetId && Math.random() < 0.6) {
          sold.vendettaPending = true;                  // va a parare la rivale del corruttore
          sold.vendettaTargetId = sold.soldTargetId;
          sold.vendettaAt = 0;
        } else {
          sold.soldSpin = true;                         // oppure si gira ai canapi (TURNS forzato)
        }
      }
    }
  }
  const tensionMult = state.mossaPhase === "tension" ? 1.0 : 0.5;

  // ── IL MOSSIERE osserva i canapi. Regole:
  //  · una Contrada FUORI POSIZIONE (arretrata o girata forte) viene RICHIAMATA per
  //    nome; 20 SECONDI fra un richiamo e l'altro. Al 2° richiamo perde la pazienza
  //    → TUTTI FUORI dal canape.
  //  · oltre i 2 MINUTI di mossa, se i cavalli sono TROPPO PRESSATI → TUTTI FUORI.
  //  Il giocatore non viene mai richiamato (la sua posizione la gestisci tu).
  // TUTTI FUORI: è un TETTO, non un obiettivo — se non c'è casino il Mossiere non
  // li chiama affatto e la mossa è corta. Il tetto (tuttiFuoriMax) è sorteggiato a
  // inizio mossa: 2 palii su 5 ne concede UNO SOLO, gli altri 2 o 3 al massimo.
  //  · 1ª volta: dopo ~10s ai canapi, se fanno casino (classico: entrano, fanno
  //    caos, escono a rifare il tondino e ognuno improvvisa la sua strategia);
  //  · dalla 2ª: devono stare DENTRO almeno 30s e ci vuole DAVVERO casino.
  // NB: la rincorsa NON dipende da tutto questo — ha il suo orologio (rincorsaWait)
  // che non si azzera ai "tutti fuori": entra quando vuole lei.
  if (state.mossaPhase === "tension" && (state.tuttiFuoriCount || 0) < (state.tuttiFuoriMax || 3)) {
    const schierati = (state.callOrder || []).filter((h) => h.called && !h.entering);
    if (schierati.length >= 7) {
      if (state.canapiSettledSince == null) state.canapiSettledSince = state.mossaTimer;
      const timeInside = state.mossaTimer - state.canapiSettledSince;
      // CASINO = qualcuno fuori posizione (arretrato o girato forte) oppure gruppo
      // troppo pressato (poca larghezza). Un timer di persistenza distingue il caos VERO.
      const fuoriPosto = schierati.some((h) => !isHuman(h)
        && (h.mossaProgress < MOSSA_FRONT_LIMIT - 4.2 || Math.abs(h.mossaTurn || 0) > 0.6));
      let pressato = false;
      if (schierati.length >= 8) {
        const lanes = schierati.map((h) => h.lane).sort((a, b) => a - b);
        pressato = (lanes[lanes.length - 1] - lanes[0]) < 11;
      }
      const casinoNow = fuoriPosto || pressato;
      state.chaosTimer = casinoNow ? (state.chaosTimer || 0) + dt : Math.max(0, (state.chaosTimer || 0) - dt * 2);
      const first = (state.tuttiFuoriCount || 0) === 0;
      const minDwell = first ? 10 : 30;                 // 1ª: 10s ai canapi · poi: 30s dentro
      const chaosNeed = first ? 1.2 : 3.5;              // dalla 2ª serve caos DAVVERO persistente
      if (timeInside >= minDwell && state.chaosTimer >= chaosNeed && state.messageTimer <= 0
          && (state.rincorsaWait || 0) >= 25) {   // il Mossiere aspetta ≥25s dalla scoperta della rincorsa
        triggerTuttiFuori();
      } else {
        // Avviso morbido fra una chiamata e l'altra: richiama per nome chi è fuori
        // posto (NON conta come "tutti fuori").
        state.recallCd = Math.max(0, (state.recallCd || 0) - dt);
        if (fuoriPosto && timeInside > 4 && state.recallCd <= 0 && state.messageTimer <= 0) {
          const fuori = schierati.find((h) => !isHuman(h) && (h.recallTimer || 0) <= 0
            && (h.mossaProgress < MOSSA_FRONT_LIMIT - 4.2 || Math.abs(h.mossaTurn || 0) > 0.6));
          if (fuori) {
            showMessage(`Il Mossiere richiama ${fuori.name}`, 1.6); fuori.recallTimer = 3.0; state.recallCd = 12.0;
            // Il Mossiere tiene il conto: al terzo richiamo scatta l'avvertimento.
            fuori.richiami = (fuori.richiami || 0) + 1;
            if (fuori.richiami >= RICHIAMI_PER_AVVISO) daiAvvertimento(fuori, "tre richiami del Mossiere");
          }
        }
      }
    } else {
      state.canapiSettledSince = null;                  // non abbastanza schierati: azzera permanenza+caos
      state.chaosTimer = 0;
    }
  }

  const controls = getControls();
  state.horses.forEach((horse) => {
    horse.prevProgress = horse.progress;
  });

  // ── Il nervosismo SI CONSUMA da solo ───────────────────────────────────
  // Prima qui il valore veniva RIANCORATO ogni frame al livello base della calma:
  // per questo non si accumulava mai e andare addosso a un cavallo non serviva a
  // niente. Ora il nervosismo è una vera riserva: sale con le botte (vedi
  // resolveMossaCrowd) e cala da sé quando il cavallo viene lasciato in pace.
  // La FREDDEZZA del fantino aiuta a calmarlo più in fretta.
  state.horses.forEach((horse) => {
    // La RINCORSA rientra: anche lei gira nel tondino in attesa, e non c'è motivo
    // per cui debba essere l'unica a non rifiatare. (Prima era esclusa in blocco.)
    const quiete = (state.nervClock || 0) - (horse.lastHitAt ?? -99);
    if (quiete >= NERV_CALM_AFTER_HIT) {
      // NEL TONDINO il cavallo si scarica DAVVERO: gira largo, lontano dalla calca,
      // e si tranquillizza fino in fondo. AI CANAPI invece non scende sotto la
      // propria indole: lì la tensione c'è comunque, e un calma-1 non diventa mai
      // sereno come un calma-5.
      // Scende fino a ZERO. Niente "pavimento": prima ce n'era uno legato all'indole,
      // attivo appena la Contrada veniva chiamata — ma essendo dentro un clamp non
      // fermava la discesa, ALZAVA il valore. Chi arrivava a 0 nel tondino si vedeva
      // schizzare il nervosismo nell'istante della chiamata, senza che nessuno lo
      // avesse toccato. L'indole ora conta solo su quanto in fretta ci si calma.
      // TONDINO = non ancora chiamato ai canapi: lì ci si scarica per davvero
      // (×NERV_DECAY_TONDINO). Il commento qui sopra lo diceva già da un pezzo, ma
      // il codice usava lo STESSO rate dei canapi in entrambi i casi.
      const base = NERV_DECAY_BY_CALMA[horse.calma] || NERV_DECAY;   // calma 5 → 0.03/s, 4 → 0.02/s, 1-2-3 → 0.01/s
      // Ai canapi l'andatura bassa accelera anche il calmarsi (specchio della
      // salita). Nel tondino conta solo l'indole (andatura non pertinente lì).
      const andaMult = horse.called ? (NERV_DECAY_BY_ANDATURA[andaturaAlCanapo(horse)] ?? 1) : 1;
      const rate = (horse.called ? base : base * NERV_DECAY_TONDINO) * andaMult;
      horse.nervousnessCurrent = clamp(horse.nervousnessCurrent - rate * dt, 0, 1);
    }
    // Valore SMORZATO: è questo che guida il comportamento e l'HUD. Il grezzo sale
    // e scende a scatti (botte e decadimento veloce); così invece si muove piano e
    // il cavallo non passa da calmo ad agitato in mezzo secondo.
    horse.nervSmooth = lerp(horse.nervSmooth ?? horse.nervousnessCurrent, horse.nervousnessCurrent, clamp(dt * 0.7, 0, 1));
  });

  // ── I 9 cavalli al canapo (+ la rincorsa che gira nel tondino) ──────────
  state.horses.forEach((horse, index) => {
    if (horse.isRincorsa) {
      // Finché non è scoperta, la rincorsa gira nel tondino come le altre.
      if (!horse.revealed) tondinoBehavior(horse, dt, time);
      return; // una volta scoperta la gestisce updateRincorsa
    }

    // Non ancora chiamata: TONDINO — gira e scalpita nella zona della mossa,
    // differenziato per indole (vedi tondinoBehavior). Se è appena stata chiamata
    // FUORI, prima torna DIRITTA all'ovale (returnToTondinoStep) senza incastrarsi.
    if (!horse.called) {
      if (horse.returningToTondino) returnToTondinoStep(horse, dt, time);
      else tondinoBehavior(horse, dt, time);
      return;
    }
    // Appena chiamata: ENTRA dal tondino fino alla sua posta. L'ingresso NON è
    // pulito e meccanico: i reattivi entrano decisi e dritti, i restio/poco
    // stabili più lenti, un po' storti, a volte con un'impuntata iniziale.
    if (horse.entering) {
      horse.enterTimer = (horse.enterTimer || 0) + dt;
      const react = clamp(horse.reactivity ?? 0.6, 0, 1);
      // Punto d'ingresso = VERROCCHINO (là dove entra la rincorsa), esterno/dietro.
      const varcoLane = (RINCORSA_LANE + VERROCCHINO_LANE) / 2;
      const varcoProg = MOSSA_BACK_LIMIT + 0.2;
      if (horse.enterPhase === undefined) horse.enterPhase = 0;
      // FASE 0: appena chiamata, la Contrada CAMMINA fino al VERROCCHINO (passo
      // costante, niente snap/teletrasporto).
      if (horse.enterPhase === 0) {
        const walkV = 3.6 + react * 1.6;                 // u/sec: entra verso il verrocchino più svelta
        const dl = varcoLane - horse.mossaLane, dp = varcoProg - horse.mossaProgress;
        const dist = Math.hypot(dl, dp) || 1;
        const step = Math.min(walkV * dt, dist);
        horse.mossaLane += (dl / dist) * step;
        horse.mossaProgress += (dp / dist) * step;
        horse.progress = horse.mossaProgress;            // il corpo cammina con la posta
        horse.lane = horse.mossaLane;
        horse.mossaTurn = lerp(horse.mossaTurn || 0, 0, clamp(dt * 3, 0, 1));
        horse.speedLevel = 3.6;                           // trotto più deciso mentre entra
        if (dist < 0.5) {
          horse.enterPhase = 1; horse.enterTimer = 0;
          if (isHuman(horse)) showMessage("Entra nei canapi e piazzati!  A/L gira · Q/P lato · M avanti", 3.2, "good");
        }
        return;
      }
      // FASE 1: dal verrocchino ci si piazza. L'AI CAMMINA fino alla sua posta a
      // passo costante (NON si teletrasporta); il giocatore la guida a mano.
      if (!isHuman(horse)) {
        const slotP = horse.slotProgress ?? (MOSSA_FRONT_LIMIT - 1.6);
        const slotL = horse.slotLane ?? horse.postLane ?? horse.mossaLane;
        const walkV = 2.8 + react * 1.2;                 // u/sec: si piazza alla posta più svelta
        const dl = slotL - horse.mossaLane, dp = slotP - horse.mossaProgress;
        const dist = Math.hypot(dl, dp) || 1;
        const step = Math.min(walkV * dt, dist);
        horse.mossaLane += (dl / dist) * step;
        horse.mossaProgress += (dp / dist) * step;
        horse.progress = horse.mossaProgress;
        horse.lane = horse.mossaLane;
        const crook = (1 - clamp(horse.stability ?? 0.6, 0, 1)) * 0.5 * (1 - clamp(horse.enterTimer / 3, 0, 1));
        horse.mossaTurn = lerp(horse.mossaTurn || 0, Math.sin(horse.phase * 2.3) * crook, clamp(dt * 2, 0, 1));
        horse.speedLevel = step > 0.001 ? 2.9 : 0.5;      // cammina finché si sposta, poi si placa
        if (dist < 0.35 || horse.enterTimer > 12.0) { horse.entering = false; horse.enterPhase = undefined; horse.mossaTurn = 0; }
        return;
      }
      // GIOCATORE: NON esce dalla funzione → cade nel blocco di controllo libero
      // qui sotto e guida l'ingresso. "Piazzato" quando ha oltrepassato il
      // verrocchino ed è avanzato nei canapi (o dopo un timeout generoso).
      if (horse.mossaProgress > MOSSA_BACK_LIMIT + 2.4 || horse.enterTimer > 18.0) {
        horse.entering = false; horse.enterPhase = undefined;
      }
    }

    if (isHuman(horse)) {
      // MOVIMENTO LIBERO dentro i canapi: A/L girano il cavallo (heading) e la
      // VELOCITÀ (andatura) lo fa muovere nella direzione in cui è girato —
      // 1 = indietro, 2 = fermo, 3..5 = avanti. Così ci si va addosso e si scula
      // per farsi spazio. Niente scambi di posto (la calca sotto lo impedisce).
      const turnInput = (controls.left ? 1 : 0) - (controls.right ? 1 : 0);
      // ROTAZIONE LIBERA A 360°: ci si gira come si vuole (nessun limite ±90°, nessuna
      // restrizione dai vicini). Wrap in [-π, π] così l'angolo non cresce all'infinito.
      let desiredTurn = (horse.mossaTurn || 0) + turnInput * dt * 2.6;
      desiredTurn = Math.atan2(Math.sin(desiredTurn), Math.cos(desiredTurn));
      horse.mossaTurn = desiredTurn;
      const andatura = clamp(Math.round(horse.speedSetting || 2), PLAYER_SPEED_MIN, ANDATURA_MAX);
      const vel = (andatura - 2) * MOSSA_MOVE_SPEED; // 1→indietro, 2→0, 3..5→avanti
      const s = sampleAt(horse.progress);
      const heading = s.yaw + (horse.mossaTurn || 0);
      const mvX = Math.sin(heading) * vel * dt;
      const mvZ = Math.cos(heading) * vel * dt;
      const along = mvX * s.tangent.x + mvZ * s.tangent.z;   // componente sulla pista
      const across = mvX * s.normal.x + mvZ * s.normal.z;    // componente laterale
      horse.mossaProgress = clamp(horse.mossaProgress + along, MOSSA_BACK_LIMIT, MOSSA_FRONT_LIMIT);
      horse.mossaLane = clamp(horse.mossaLane + across, -AI_LANE_LIMIT, AI_LANE_LIMIT);
      // ── ADDOSSO AL CANAPE: spingi in avanti (andatura ≥3) contro il canapo
      // frontale. A 3-4 ti FERMI (niente sgambettìo sul posto); a 5 lo FORZI →
      // "…ha forzato il canape" e le Contrade partono con MOSSA FALSA.
      horse.canapeStop = false;
      if (horse.mossaProgress > MOSSA_FRONT_LIMIT - 1.5 && andatura >= 3) {
        // MOSSA COMPRATA ALL'ASTA: qui il 5 NON è forzare il canape, è la partenza
        // a chiamata. Gliel'abbiamo appena promesso col cartello ("parti a 5 quando
        // vuoi") e prima di questa riga quella promessa era una trappola: partiva a
        // 5 e si beccava la mossa falsa per averlo fatto. Adesso la rincorsa gli dà
        // la mossa e parte INSIEME a lui. Se la rincorsa non è ancora pronta il
        // giocatore si limita a stare addosso al canape, senza penalità.
        if (giocatoreHaLaMossa()) {
          const rin = state.horses.find((h) => h.isRincorsa);
          if (andatura >= ANDATURA_MAX && rin && rincorsaPronta()) {
            state.chiamataA5 = true;      // 0 stamina per i primi 2s (partenza a chiamata)
            rin.wantsToEnter = true;      // la rincorsa entra: la mossa è VALIDA
          } else {
            horse.canapeStop = true;      // aspetta che la rincorsa sia pronta
          }
        } else if (andatura >= ANDATURA_MAX) {
          if ((state.mossaFalsaCooldown || 0) <= 0 && (state.forcedCanapeCd || 0) <= 0) {
            state.forcedCanapeCd = 6;
            showMessage(`${horse.name} ha forzato il canape`, 2.6, "danger");
            triggerMossaFalsa(`${nomeConArticolo(horse)} ha forzato il canape`);
            return;
          }
        } else {
          horse.canapeStop = true;   // fermo contro il canape (animazione placata sotto)
        }
      }
      // Spostamento LATERALE puro (Q = sinistra, P = destra): ci si fa largo
      // SPINGENDO i vicini di lato, senza doversi girare.
      // Spostamento laterale del giocatore con Q/P: 1.9 u/s. Abbastanza deciso da
      // FARSI LARGO spingendo i vicini (la contesa pesata su mossa×difesa×potenza
      // decide chi cede), senza lo "scatto" di lato del vecchio 2.6.
      const lateral = (controls.latRight ? 1 : 0) - (controls.latLeft ? 1 : 0);
      if (lateral) horse.mossaLane = clamp(horse.mossaLane + lateral * dt * 1.9, -AI_LANE_LIMIT, AI_LANE_LIMIT);
    } else {
      // ── Comportamento per POSTA (0 = più interna … 8 = più esterna) ───────
      // Corsia: + = verso l'interno (centro campo), − = verso l'esterno (muro).
      const post = horse.postIndex ?? 4;
      const postLane = horse.postLane ?? horse.mossaLane;
      const tension = state.mossaPhase === "tension";
      // La mossa NON si congela mai (niente "cavalli che dormono in piedi"): si
      // COMPONE e si ROMPE a ondate. Col tempo le fasi composte diventano più
      // frequenti, ma resta sempre nervosismo residuo (settle max 0.72) e ogni
      // ~9s un'onda comune di rottura rianima tutta la fila. La rincorsa trova
      // comunque finestre allineate durante i picchi di composizione.
      const tt = state.tensionTimer || 0;
      const composed = clamp((tt - 5) / 14, 0, 1);
      const breakWave = Math.sin(tt * 0.7 + horse.phase * 0.2) * 0.5 + 0.5;   // 0..1
      const settle = clamp(composed * (0.32 + 0.55 * breakWave), 0, 0.72);

      // ── TENUTA "PESANTE" della posta, con varianza per-cavallo holdWeight ∈
      // [-2,+2]: ogni cavallo cerca di TENERE la sua posta in maniera pesante.
      //   +2 = macigno, non lo smuovi dalla posta;
      //    0 = tiene con qualche scarto nervoso;
      //   -2 = "esce dietro" (arretra) e poi cerca di RITROVARE la posizione.
      const hw = horse.holdWeight ?? 0;                 // -2..+2
      const heavy = clamp((hw + 2) / 4, 0, 1);          // 0 (molle) .. 1 (macigno)
      const life = (1 - heavy) * (tension ? 1 : 0.4);   // vita nervosa (svanisce coi pesanti)
      const frontLine = MOSSA_FRONT_LIMIT - 1.2;        // linea del canapo (fronte)
      const agg = clamp(horse.aggression ?? 0.5, 0, 1);

      // Corsia: tiene la propria posta ma con scalpitìo laterale SEMPRE presente
      // (anche i "pesanti" non stanno mai del tutto immobili), più l'oscillazione
      // nervosa dei "molli" che si vanno addosso al vicino (la calca li risepara).
      // Ampiezze e frequenze DIMEZZATE rispetto a prima: ai canapi i cavalli si
      // muovono, ma non ballano. Prima l'oscillazione laterale arrivava a ~1.2 di
      // corsia a testa e la fila sembrava in perenne agitazione.
      // Frequenze DIMEZZATE (0.55/1.0 al posto di 1.0/1.9): stessa ampiezza di
      // movimento, ma i cavalli ci arrivano LENTI — dondolio, non ballo.
      // NIENTE nervosismo qui dentro: il nervosismo non "condisce" più ogni
      // movimento: vale SOLO per TURNS e per l'uscita dietro a 0.78. Questo
      // dondolio resta costante e uguale per tutti.
      let laneGoal = postLane
        + Math.sin(time * 0.55 + horse.phase * 1.3) * 0.5 * life
        + Math.sin(time * 1.0 + horse.phase * 2.3) * 0.12   // scalpitìo minimo costante
        + agg * 0.5 * life;

      // Longitudinale: i pesanti restano incollati al fronte; i negativi ARRETRANO
      // dietro con un ciclo lento e poi rientrano a ritrovare la posta.
      // L'arretramento è LIMITATO a MOSSA_BACK_MAX (< soglia di allineamento): un
      // cavallo "esce dietro", ma non tanto da rendere la fila mai valida. Senza
      // questo tetto, con più cavalli di calma bassa fuori fase, la mediana aveva
      // sempre qualcuno oltre 2.6 dietro → nessuna finestra allineata e mosse false
      // a raffica. Il vero disallineamento deve venire dalle SPINTE, non dal ciclo.
      let progGoal;
      if (hw < 0) {
        horse.holdPhase = (horse.holdPhase || 0) + dt * 0.45;   // ritmo fisso, non più legato al nervosismo
        const back = (-hw) * (0.5 + 0.5 * Math.sin(horse.holdPhase)) * 1.5; // fino a ~3 dietro
        progGoal = frontLine - Math.min(back, MOSSA_BACK_MAX);
      } else {
        progGoal = frontLine;
      }

      // ── "ESCE DIETRO" VERO: episodio RARO e BREVE in cui un cavallo di calma bassa
      // si sfila davvero dalla fila (oltre la soglia) e poi rientra. È questo — non
      // lo scalpitìo continuo — a produrre le mosse false: capitano ogni tanto,
      // non a ogni tentativo. Sotto calma 3, un episodio ogni ~25-40s, ~2.5s l'uno.
      if (hw < 0 && tension) {
        horse.escitaTimer = (horse.escitaTimer ?? (12 + Math.random() * 20)) - dt;
        if (horse.escitaTimer <= 0) {
          if (horse.escita) { horse.escita = false; horse.escitaTimer = 25 + Math.random() * 15; }
          else { horse.escita = true; horse.escitaTimer = 1.8 + Math.random() * 1.4; }
        }
        if (horse.escita) progGoal = frontLine - (MOSSA_ALIGN_GAP + 0.7);
      } else {
        horse.escita = false;
      }

      // Micro-scalpitìo del muso, SEMPRE uguale e minimo: serve solo a non farli
      // sembrare statue. Non dipende più dal nervosismo — girarsi è ROBA DI TURNS.
      // (Lo "scarto imbizzarrito" casuale, che faceva girare tutti a caso su un
      // timer indipendente dal nervosismo, è stato rimosso: l'unica cosa che gira
      // un cavallo ora è TURNS, applicato più sotto sia alle AI sia al giocatore.)
      let turnGoal = Math.sin(time * 1.4 + horse.phase * 1.7) * 0.06;

      // ── TATTICA PER POSTA (0..8): ogni posizione al canape ha una logica
      // diversa — la mossa è una lotta di posizione, non una griglia ordinata.
      const ord = state.callOrder || [];
      if (post <= 1) {
        // 1ª-2ª: spingono verso l'alto (il canapo), si fanno spazio e comprimono.
        progGoal = Math.min(progGoal + 0.5, frontLine);
        laneGoal += Math.sin(time * 0.9 + horse.phase) * 0.45 * (tension ? 1 : 0.4);
      } else if (post === 2) {
        // 3ª: la più stabile — mantiene la posizione, reagisce ma non crea caos.
        laneGoal = lerp(laneGoal, postLane, 0.75);
      } else if (post === 3) {
        // 4ª: stringe verso l'INTERNO con pressione laterale (come premere P).
        laneGoal += 1.7 * (0.5 + 0.5 * Math.sin(time * 0.5 + horse.phase)) * (tension ? 1 : 0.5);
      } else if (post === 4 || post === 5) {
        // 5ª-6ª: si danno noia fra loro — marcatura, contatti, centro caotico.
        const other = ord[post === 4 ? 5 : 4];
        if (other && other.called && !other.entering) {
          laneGoal = lerp(laneGoal, other.lane, 0.45);
          turnGoal += Math.sin(time * 1.6 + horse.phase) * 0.18;
        }
      } else if (post === 6) {
        // 7ª: prova a CHIUDERE la sesta (le limita lo spazio, aggressiva).
        const sesta = ord[5];
        if (sesta && sesta.called && !sesta.entering) {
          laneGoal = lerp(laneGoal, sesta.lane + 0.7, 0.55);
        }
      } else if (post === 7) {
        // 8ª: esterna, cerca una partenza pulita senza entrare negli scontri.
        laneGoal = lerp(laneGoal, postLane, 0.8);
      } else if (post === 8) {
        // 9ª: esterna; OGNI TANTO arretra apposta a occupare il CORRIDOIO della
        // rincorsa (tattica per ritardare/disturbare l'ingresso).
        horse.blockTimer = (horse.blockTimer ?? (6 + Math.random() * 10)) - dt;
        if (horse.blockTimer <= 0) {
          horse.blockingRincorsa = !horse.blockingRincorsa;
          horse.blockTimer = horse.blockingRincorsa ? 3.5 + Math.random() * 3.5 : 9 + Math.random() * 12;
        }
        if (horse.blockingRincorsa && tension) {
          progGoal = MOSSA_BACK_LIMIT + 0.6;                    // arretra
          laneGoal = (RINCORSA_LANE + VERROCCHINO_LANE) / 2;    // sul corridoio
        }
      }

      // ── RIVALITÀ nei canapi: la rivale si CERCA — marcatura stretta, pressione
      // laterale, contatti. L'INTENSITÀ della rivalità scala tutto: quelle molto
      // forti (Oca-Torre, Aquila-Pantera…) arrivano a sacrificare la partenza.
      const rivalMap = RIVALS[horse.id] || {};
      const rival = state.horses.find((o) => o !== horse && o.called && !o.entering && rivalMap[o.id] && !(horse.friendlyToPlayer && o.player));
      if (rival && tension) {
        const k = rivalMap[rival.id];
        // Rivali PIÙ AGGRESSIVE: marcatura più stretta (offset ridotto), pressione
        // laterale più alta, spinta al fronte e più contatti/annunci.
        const press = clamp((0.5 + agg * 0.65) * k, 0, 0.95);
        laneGoal = lerp(laneGoal, rival.lane + Math.sign(horse.lane - rival.lane || 1) * 0.35, press);
        turnGoal += Math.sin(time * 1.3 + horse.phase) * 0.18 * k;
        progGoal = Math.max(progGoal, frontLine - 0.3);   // le sta addosso al fronte
        if (Math.random() < dt * 0.08 * k && state.messageTimer <= 0) {
          showMessage(k >= 0.9 ? `${horse.name} prova a chiudere ${rival.name}` : `${horse.name} marca stretta ${rival.name}`, 1.1);
        }
      }

      // ── CONTATTO → SI INCAZZA: l'AI colpita NON trema e NON indietreggia. Spinge
      // DECISO verso chi l'ha urtata (contactSide) per farsi spazio, tiene il fronte
      // e preme col corpo. Più aggressiva → spinge più forte. Svanisce col timer.
      if ((horse.contactTimer || 0) > 0) {
        horse.contactTimer -= dt;
        const rec = clamp(horse.contactTimer / 0.8, 0, 1);   // 1 appena urtato .. 0
        const grinta = 0.7 + (horse.aggression ?? 0.5) * 1.0;
        laneGoal += -(horse.contactSide || 0) * 1.5 * rec * grinta;  // spinge verso l'avversario
        progGoal = Math.max(progGoal, frontLine - 0.4);              // non farti buttare indietro
        turnGoal += -(horse.contactSide || 0) * 0.2 * rec;          // corpo/muso verso di lui
      }

      // ── SPINTA LATERALE ATTIVA (come i tasti Q/P del giocatore): anche le AI
      // DECIDONO di spingere DECISE di lato — verso il vicino per schiacciarlo e
      // farsi spazio, o verso il centro se sono ai bordi. La calca (resolveMossaCrowd)
      // trasmette la spinta ai cavalli accanto, esattamente come col Q/P del player.
      // La spinta si alterna con brevi pause e sfuma quando la fila si compone.
      // CHI spinge davvero, e contro chi. Prima spingevano TUTTE contro il primo
      // vicino capitato: ne usciva una calca isterica in cui ogni Contrada dava
      // noia a tutti. Nel Palio vero è mirato:
      //  · chi ha la RIVALE in gara va a romperle le scatole, e sul serio;
      //  · chi ha un INCARICO (accordo, para, vendetta, fantino comprato) esegue;
      //  · tutte le altre NON spingono: al massimo tengono la posta e parano.
      const rivalMapSh = RIVALS[horse.id] || {};
      const miaRivale = state.horses.find((o) => o !== horse && o.called && !o.entering
        && !o.isRincorsa && rivalMapSh[o.id]);
      // ACCORDO: chi ha RICEVUTO i soldi (allyBeneficiaryId = chi lo paga se vince)
      // spinge SEMPRE dal lato OPPOSTO al beneficiario. Direzione dalla POSTA fissa
      // (non dalla corsia viva) così non s'inverte mai durante la mossa.
      const benefic = (horse.allyBeneficiaryId && horse.objCanapi)
        ? state.horses.find((o) => o.id === horse.allyBeneficiaryId && o.called && !o.entering && !o.isRincorsa)
        : null;
      let benSide = 0;
      if (benefic) {
        const myL = horse.postLane ?? horse.slotLane ?? horse.mossaLane ?? 0;
        const benL = benefic.postLane ?? benefic.slotLane ?? benefic.mossaLane ?? 0;
        benSide = Math.sign(myL - benL) || 1;   // +1/−1: lato OPPOSTO al beneficiario
      }
      const haIncarico = !!(horse.allyHelp || horse.paraInRace || horse.vendettaPending || horse.soldTo
        || (horse.vendettaState && horse.vendettaState !== "fatto"));
      horse.shoveTimer = (horse.shoveTimer ?? (1 + Math.random() * 3)) - dt;
      if (horse.shoveTimer <= 0) {
        if (horse.shoveDir) {
          horse.shoveDir = 0;   // fine spinta → pausa (più corta se aggressivo/in tensione)
          horse.shoveTimer = (tension ? 0.7 : 2.0) + Math.random() * (tension ? 2.4 : 4.5) * (1.1 - agg * 0.6);
        } else if (benSide) {
          horse.shoveDir = benSide;                             // SEMPRE dal lato opposto a chi paga
          horse.shoveTimer = 0.5 + Math.random() * 0.7;
        } else if (miaRivale) {
          // Ce l'ha con LEI: spinge nella sua direzione, non a caso.
          horse.shoveDir = Math.sign((miaRivale.mossaLane ?? 0) - horse.mossaLane) || 1;
          horse.shoveTimer = 0.5 + Math.random() * 0.7;        // insiste più a lungo
        } else if (haIncarico) {
          const near = state.horses.find((o) => o !== horse && o.called && !o.entering && !o.isRincorsa
            && Math.abs((o.mossaProgress ?? 0) - (horse.mossaProgress ?? 0)) < 2.4
            && Math.abs((o.mossaLane ?? 0) - (horse.mossaLane ?? 0)) < 2.6);
          horse.shoveDir = near ? (Math.sign((near.mossaLane ?? 0) - horse.mossaLane) || 1)
                                : (horse.mossaLane > 0 ? -1 : 1);
          horse.shoveTimer = 0.35 + Math.random() * 0.55;
        } else {
          horse.shoveDir = 0;                                   // nessuna rivale, nessun incarico: para e basta
          horse.shoveTimer = 1.6 + Math.random() * 2.2;
        }
      }
      if (horse.shoveDir && tension) {
        // Contro la propria rivale la spinta è nettamente più deciso.
        const controRivale = !!(miaRivale
          && Math.sign((miaRivale.mossaLane ?? 0) - horse.mossaLane) === horse.shoveDir);
        const force = (controRivale ? 2.5 + agg * 1.2 : 1.7 + agg * 1.1) * (1 - settle * 0.7);
        laneGoal += horse.shoveDir * force;
        progGoal = Math.max(progGoal, frontLine - 0.5);         // tiene il fronte mentre spinge
        turnGoal += horse.shoveDir * 0.12;                      // muso un filo verso la spinta
      }

      // RICHIAMATO dal Mossiere: obbedisce — torna alla posta, dritto, al fronte.
      if ((horse.recallTimer || 0) > 0) {
        horse.recallTimer -= dt;
        laneGoal = postLane;
        progGoal = frontLine;
        turnGoal = 0;
        horse.blockingRincorsa = false;
      }

      if (settle > 0) {
        // Dopo ~20s tutti i cavalli smettono di fare caos e si riallineano:
        // lateralmente verso la propria posta, longitudinalmente verso il fronte.
        laneGoal = lerp(laneGoal, postLane, settle * 0.8);
        progGoal = lerp(progGoal, MOSSA_FRONT_LIMIT - 1.0, settle);
        if (settle > 0.35) horse.behaviorState = "idle";
      }

      // ── VERO CASINO ai canapi (in ~2/3 dei palii): nei primi 25s dalla scoperta
      // della rincorsa TUTTE stringono da un lato (di solito interno), si vanno
      // addosso, ARRETRANO e si GIRANO completamente. Dopo i 25s il settle qui sopra
      // (già cresciuto) le riallinea come sempre. Domina su posta/rivalità/spinte.
      if (state.canapiCaos && tension && (state.rincorsaWait || 0) < 25
          && (state.tuttiFuoriCount || 0) === 0 && (state.falseStartCount || 0) === 0) {   // solo PRIMA del 1° "tutti fuori"/mossa falsa
        const side = state.caosSide || 1;
        // ELEZIONE PIGRA: le prime 2 AI vicine al CENTRO diventano le "spingitrici";
        // le 6 successive restano ADDOSSO ai canapi (il canape non si svuota mai).
        if (!state.caosPushers) state.caosPushers = [];
        if (!state.caosFront) state.caosFront = [];
        const pl = horse.postLane ?? horse.slotLane ?? horse.mossaLane ?? 0;
        const giaFront = state.caosFront.indexOf(horse.id) !== -1;
        if (!giaFront && state.caosPushers.length < 2 && Math.abs(pl) < AI_LANE_LIMIT * 0.5
            && state.caosPushers.indexOf(horse.id) === -1) {
          state.caosPushers.push(horse.id);
        }
        if (!giaFront && state.caosPushers.indexOf(horse.id) === -1 && state.caosFront.length < 6) {
          state.caosFront.push(horse.id);
        }
        if (state.caosPushers.indexOf(horse.id) !== -1) {
          // DUE CONTRADE DAL CENTRO: si spostano DECISE sul lato, si SFILANO DIETRO
          // e SPINGONO FORTE (shove laterale marcato) contro chi trovano.
          const back = (Math.sin(time * 0.45 + horse.phase * 1.3) * 0.5 + 0.5) * (MOSSA_BACK_MAX + 1.4);
          progGoal = frontLine - back - 0.7;                               // si sfilano dietro, più delle altre
          laneGoal = clamp(side * (AI_LANE_LIMIT - 0.3) + side * (2.8 + agg * 1.2), -AI_LANE_LIMIT - 3, AI_LANE_LIMIT + 3); // spinta forte verso il lato
          turnGoal = side * 0.45 + Math.sin(time * 0.6 + horse.phase) * 0.4;  // muso verso il lato (non girate su sé stesse)
        } else if (state.caosFront.indexOf(horse.id) !== -1) {
          // LE 6 ADDOSSO AI CANAPI: stringono da un lato e si accavallano fra loro,
          // ma NON arretrano — restano al fronte, così il canape resta pieno.
          laneGoal = clamp(side * (AI_LANE_LIMIT - 1.2) + Math.sin(time * 0.9 + horse.phase * 2) * 0.7, -AI_LANE_LIMIT, AI_LANE_LIMIT);
          progGoal = frontLine - Math.abs(Math.sin(time * 0.7 + horse.phase * 1.5)) * 0.5;   // appena uno scarto, restano sotto il canape
          turnGoal = Math.sin(time * 0.6 + horse.phase * 2.3) * 0.9;     // muso storto, ma non girate del tutto
        } else {
          laneGoal = clamp(side * (AI_LANE_LIMIT - 1.2) + Math.sin(time * 0.9 + horse.phase * 2) * 0.7, -AI_LANE_LIMIT, AI_LANE_LIMIT);
          const back = (Math.sin(time * 0.5 + horse.phase * 1.7) * 0.5 + 0.5) * (MOSSA_BACK_MAX + 0.8);
          progGoal = frontLine - back;                                   // vanno anche dietro
          turnGoal = Math.sin(time * 0.6 + horse.phase * 2.3) * 1.9;     // si girano (anche completamente)
        }
      }

      // ── NERVOSISMO OLTRE SOGLIA: è QUESTO l'effetto vero dell'agitazione.
      // Sopra NERV_BACK_THRESHOLD (0.78) la Contrada non regge più la posta: molla la
      // fila, VA DIETRO e ci resta ALMENO NERV_BACK_WAIT secondi prima di tornare a
      // cercare la posizione. Il richiamo del Mossiere ha la precedenza.
      //
      // (La macchina a stati dell'AGITAZIONE non sta più qui: è nella zona
      // COMUNE accanto a TURNS, così gira anche per il giocatore. Qui — ramo
      // solo-AI — non la vedrebbe mai.)

      // ── CORSA-VENDETTA: la rivale più DEBOLE (se pianificata) a un certo punto
      // LASCIA la fila, PASSA DIETRO tutte le altre contrade e va ad affrontare la
      // rivale più forte anche se lontana: ARRETRA dietro tutti → TRAVERSA fino alla
      // sua corsia → le va ADDOSSO e la disturba. Ha la precedenza sul resto (ma un
      // richiamo del mossiere o la fila che si compone la fanno rientrare).
      // CODA DI BERSAGLI (fantino corrotto): finita la 1ª favorita passa alla 2ª.
      if (horse.vendettaState === "fatto" && horse.vendettaQueue && horse.vendettaQueue.length && tension) {
        const next = horse.vendettaQueue.shift();
        if (next && next !== horse.id) {
          horse.vendettaPending = true; horse.vendettaTargetId = next; horse.vendettaState = null;
          horse.vendettaAt = (state.tensionTimer || 0) + 2;   // riparte poco dopo
        }
      }
      if (horse.vendettaPending && !horse.vendettaState && tension
          && (state.tensionTimer || 0) >= (horse.vendettaAt || 6)) {
        horse.vendettaState = "arretra"; horse.vendettaPending = false; horse.vendettaLife = 12;
      }
      if (horse.vendettaState && horse.vendettaState !== "fatto") {
        const bersaglio = state.horses.find((o) => o.id === horse.vendettaTargetId && o.called && !o.entering && !o.isRincorsa);
        horse.vendettaLife = (horse.vendettaLife || 0) - dt;
        if (!bersaglio || (horse.recallTimer || 0) > 0 || horse.vendettaLife <= 0 || settle > 0.45) {
          horse.vendettaState = "fatto";   // annullata/finita → torna alla normalità
        } else {
          const dietro = MOSSA_BACK_LIMIT + 0.8;
          const bl = bersaglio.mossaLane ?? 0, bp = bersaglio.mossaProgress ?? frontLine;
          if (horse.vendettaState === "arretra") {
            progGoal = dietro; laneGoal = horse.mossaLane;                 // arretra dietro tutti
            turnGoal = clamp(Math.sign(bl - horse.lane) * 0.5, -1.2, 1.2);
            if (horse.progress < MOSSA_BACK_LIMIT + 1.8) horse.vendettaState = "traversa";
          } else if (horse.vendettaState === "traversa") {
            progGoal = dietro; laneGoal = bl;                             // scivola DIETRO verso la sua corsia
            turnGoal = clamp(Math.sign(bl - horse.lane) * 0.5, -1.2, 1.2);
            // arrivata sotto la sua corsia (o dopo un po' che traversa) → risale
            if (Math.abs(horse.lane - bl) < 1.8 || horse.vendettaLife < 6) {
              horse.vendettaState = "affronta"; horse.vendettaTimer = 2.6;
              if (state.messageTimer <= 0) showMessage(`${horse.name} sfila dietro le altre per andare a cercare ${bersaglio.name}!`, 1.6, "danger");
            }
          } else if (horse.vendettaState === "affronta") {
            progGoal = bp; laneGoal = bl; turnGoal = 0;                   // risale e le va ADDOSSO
            horse.vendettaTimer = (horse.vendettaTimer || 0) - dt;
            if (Math.abs(horse.progress - bp) < 1.6 && Math.abs(horse.lane - bl) < 1.6) {
              // Andarle addosso di proposito vale DOPPIO rispetto a un urto normale,
              // ma resta una botta ogni cooldown: non più +0.5 al secondo.
              // Andarle addosso di proposito conta come pressione insistente.
              nervPress(bersaglio, horse.id);
            }
            if (horse.vendettaTimer <= 0) horse.vendettaState = "fatto";
          }
        }
      }

      // ── ACCORDO: l'alleato FA SPAZIO al beneficiario e SPINGE VIA gli altri.
      // Non si limita a scostarsi: tiene una SPINTA LATERALE SOSTENUTA nella
      // direzione OPPOSTA al beneficiario (come il giocatore che pigia Q/P). La
      // calca (resolveMossaCrowd) la trasmette ai vicini, quindi tutta la fila si
      // comprime dall'altra parte e al beneficiario si apre il varco.
      // Es.: tu 3ª posta, lui 5ª → tu sei alla sua "destra" → lui spinge a sinistra.
      if (horse.allyBeneficiaryId && horse.objCanapi && (!horse.vendettaState || horse.vendettaState === "fatto")) {
        const ben = state.horses.find((o) => o.id === horse.allyBeneficiaryId && o.called && !o.entering && !o.isRincorsa);
        if (ben) {
          const away = Math.sign(horse.lane - ben.lane) || 1;   // lato opposto al beneficiario
          horse.shoveDir = away;        // spinta sostenuta: la applica il blocco SPINTA LATERALE
          horse.shoveTimer = 1.0;       // rinnovata ogni frame → non si spegne mai finché aiuta
          progGoal = Math.min(progGoal, frontLine - 0.2);       // e non gli sta davanti
        }
      }

      // (L'override "agitato" non sta più qui: è nel blocco COMUNE più sotto,
      // che vale per AI e giocatore e sovrascrive comunque questi goal.)

      // Rincorsa dell'obiettivo RALLENTATA (1.6→0.9 e 2.0→1.1): il cavallo si
      // sposta e si gira con calma. NON toccare invece followRate più sotto:
      // quella è la velocità di RECUPERO della posta dopo una spinta.
      horse.mossaLane += (clamp(laneGoal, -AI_LANE_LIMIT, AI_LANE_LIMIT) - horse.mossaLane) * clamp(dt * 0.9, 0, 1);
      // (La nerbata non arretra più: la spinta laterale è nel blocco NERBATO comune sotto.)
      horse.mossaProgress = clamp(progGoal, MOSSA_BACK_LIMIT, MOSSA_FRONT_LIMIT);
      horse.mossaTurn += (turnGoal - horse.mossaTurn) * clamp(dt * 1.1, 0, 1);
      // Anche le AI dentro i canapi: massimo 60°, mai girate del tutto di traverso.
      horse.mossaTurn = clamp(horse.mossaTurn, -1.57, 1.57);
    }

    // ══ TURNS ══════════════════════════════════════════════════════════════════
    // Sopra la soglia data dalla sua statistica TURNS, il cavallo TIENE la
    // posizione ma si gira a destra e a sinistra da solo: 5 secondi fuori
    // controllo, 5 di pausa, e finché il nervosismo resta sopra soglia riparte.
    // Sta QUI, fuori dal ramo AI/giocatore, perché deve valere per ENTRAMBI: è il
    // punto in cui il cavallo non ascolta più né l'AI né i comandi.
    // Chi è già "agitato" (uscito dietro a 0.78) non gira: quello stato vince.
    const spinPrima = !!horse.turnsSpin;
    if (!horse.isRincorsa && horse.called && !horse.entering && !horse.nervBackState) {
      const soglia = TURNS_SOGLIA[clamp(Math.round(horse.turnsStat ?? 3), 1, 5)];
      if ((horse.nervousnessCurrent || 0) >= soglia) {
        horse.turnsTimer = (horse.turnsTimer ?? 0) - dt;
        if (horse.turnsTimer <= 0) {
          horse.turnsSpin = !horse.turnsSpin;              // alterna giravolte / pausa
          horse.turnsTimer = TURNS_DURATA;
        }
      } else { horse.turnsSpin = false; horse.turnsTimer = 0; }
      // Fantino COMPRATO in raffica: si gira per contratto, non per nervosismo.
      if (horse.soldSpin) horse.turnsSpin = true;
    } else { horse.turnsSpin = false; horse.turnsTimer = 0; }

    // All'INIZIO di ogni giravolta: sceglie il LATO, ALTERNANDO (una volta a destra,
    // una a sinistra) e cattura la posizione da tenere.
    if (horse.turnsSpin && !spinPrima) {
      horse.turnsSide = (horse.turnsSideLast === 1) ? -1 : 1;   // +1 destra, -1 sinistra
      horse.turnsSideLast = horse.turnsSide;
      horse.turnsHoldProg = horse.mossaProgress;
    }

    if (horse.turnsSpin) {
      // Girato FISSO da un lato (non più oscillazione) e PREME verso quel lato per 5s:
      // si spinge sul vicino di quel lato (shoveDir), come tenere premuto P/Q. Vale
      // per AI e giocatore (scavalca i comandi). Poi 5s di pausa, poi il lato opposto.
      const sd = horse.turnsSide || 1;
      horse.mossaTurn = sd * TURNS_ANGOLO;                        // muso girato fisso
      horse.mossaProgress = horse.turnsHoldProg ?? horse.mossaProgress;   // non avanza né arretra
      horse.mossaLane = clamp(horse.mossaLane + sd * dt * 1.7, -AI_LANE_LIMIT, AI_LANE_LIMIT); // preme di lato
      horse.shoveDir = sd;                                        // spinge il vicino da quel lato
      horse.canapeStop = false;
      horse.behaviorState = "turns";
    }

    // ── AGITAZIONE, macchina a stati COMUNE (AI e GIOCATORE) ─────────────────
    // Sta QUI, fuori dai due rami: dentro il ramo AI il giocatore non la
    // eseguiva mai (verificato dal vivo: 0.85 di nervosismo e nessuno scatto).
    if (!horse.isRincorsa && horse.called && !horse.entering && (horse.recallTimer || 0) <= 0) {
      const nervOra = horse.nervousnessCurrent || 0;
      if (!horse.nervBackState && nervOra >= NERV_BACK_THRESHOLD) {
        horse.nervBackState = "agitato";
        horse.nervBackTimer = NERV_BACK_WAIT;
        if (state.messageTimer <= 0) showMessage(`${horse.name} si agita e perde la posta`, 1.8, "danger");
      }
      if (horse.nervBackState) {
        horse.nervBackTimer = (horse.nervBackTimer || 0) - dt;
        // Minimo NERV_BACK_WAIT dietro, e comunque finché non torna sotto EXIT.
        if (horse.nervBackTimer <= 0 && nervOra < NERV_CALM_EXIT) horse.nervBackState = null;
      }
    }

    // ── AGITATO, override COMUNE (AI e GIOCATORE): sopra 0.78 il cavallo non
    // ascolta più nessuno — nemmeno te. Molla la fila, va dietro e ci resta
    // almeno NERV_BACK_WAIT secondi. Scavalca i comandi: sta DOPO i due rami,
    // come TURNS, così sovrascrive qualsiasi goal scritto prima.
    if (horse.nervBackState && !horse.isRincorsa && horse.called && !horse.entering) {
      const backP = MOSSA_FRONT_LIMIT - 4.6;               // dietro, fuori dalla fila
      horse.mossaProgress += (backP - horse.mossaProgress) * clamp(dt * 1.4, 0, 1);
      horse.mossaLane += ((horse.postLane ?? horse.mossaLane) - horse.mossaLane) * clamp(dt * 1.2, 0, 1);
      horse.mossaTurn += (0 - horse.mossaTurn) * clamp(dt * 2.0, 0, 1);
      horse.shoveDir = 0;
      horse.canapeStop = false;
      horse.behaviorState = "agitato";
    }

    // ── NERBATO (nerbLock): per 4s SPINGE DI LATO verso il lato del colpo — come
    // tenere premuto P/Q. Override COMUNE (AI e giocatore), sta DOPO gli altri così
    // vince durante i 4 secondi. NON arretra più (accumulava tutti i cavalli dietro).
    if ((horse.nerbLock || 0) > 0 && !horse.isRincorsa && horse.called && !horse.entering) {
      const nsd = horse.nerbSide || 1;
      horse.mossaLane = clamp(horse.mossaLane + nsd * dt * 1.7, -AI_LANE_LIMIT, AI_LANE_LIMIT); // preme di lato
      horse.mossaTurn += (nsd * 0.4 - horse.mossaTurn) * clamp(dt * 3, 0, 1);    // muso un filo verso la spinta
      horse.shoveDir = nsd;                                                       // spinge il vicino da quel lato
      horse.canapeStop = false;
    }

    // ── CAOS AI CANAPI (2 palii su 3): l'attore si addossa a rotazione — destra,
    // sinistra, centro — anche arretrando (trambusto), per ~20s dall'annuncio della
    // rincorsa (tensionTimer). Dopo il 25° secondo il blocco si spegne e si allinea.
    // Sta DOPO gli altri override (TURNS/agitato/nerbato): se uno di quelli è attivo
    // lascia fare a loro, altrimenti guida lui il trambusto.
    if (state.canapiChaos && horse.chaosActor && !horse.isRincorsa && horse.called && !horse.entering
        && !horse.nervBackState && (horse.nerbLock || 0) <= 0 && !horse.turnsSpin) {
      const tt = state.tensionTimer || 0;
      if (tt < 22) {
        const off = horse.chaosOffset || 0;
        const seg = Math.floor(((tt + off) % 21) / 7);      // 0=destra · 1=sinistra · 2=centro
        if (seg === 0 || seg === 1) {
          const sd = seg === 0 ? 1 : -1;
          horse.mossaLane = clamp(horse.mossaLane + sd * dt * 2.3, -AI_LANE_LIMIT, AI_LANE_LIMIT);
          horse.mossaTurn += (sd * 0.5 - horse.mossaTurn) * clamp(dt * 3, 0, 1);
          horse.shoveDir = sd;
        } else {
          horse.mossaLane += ((horse.postLane ?? 0) - horse.mossaLane) * clamp(dt * 1.6, 0, 1);
          const backP = clamp(MOSSA_FRONT_LIMIT - (2.4 + Math.sin((tt + off) * 1.7) * 1.6), MOSSA_BACK_LIMIT, MOSSA_FRONT_LIMIT);
          horse.mossaProgress += (backP - horse.mossaProgress) * clamp(dt * 1.3, 0, 1);
          horse.mossaTurn += (0 - horse.mossaTurn) * clamp(dt * 2, 0, 1);
          horse.shoveDir = 0;
        }
        horse.canapeStop = false;
        horse.behaviorState = "caos";
      }
    }

    // Goal di posizione: per le AI viene dal comportamento di posta (sopra), per
    // il giocatore dai suoi comandi. L'avanzamento è morbido verso il goal.
    const targetProgress = horse.mossaProgress;
    const targetLane = horse.mossaLane;
    const previousLane = horse.lane;
    // NON abbassare questo per "calmare" la mossa: è la velocità con cui un cavallo
    // RITROVA la sua posta dopo essere stato spinto. Se è bassa non si ricompongono
    // mai, la fila resta sfilacciata e la mossa non parte più. Il movimento si calma
    // riducendo l'OSCILLAZIONE dell'obiettivo, non la capacità di raggiungerlo.
    const followRate = isHuman(horse) ? 7.5 : 2.2;
    horse.progress += (targetProgress - horse.progress) * clamp(dt * followRate, 0, 1);
    horse.progress = clamp(horse.progress, MOSSA_BACK_LIMIT, MOSSA_FRONT_LIMIT);
    horse.lane += (targetLane - horse.lane) * clamp(dt * (isHuman(horse) ? 7.5 : 2.4), 0, 1);
    horse.laneVelocity = (horse.lane - previousLane) / Math.max(dt, 0.001);
    // Animazione tenuta bassa: passo/trotto leggero, mai galoppo al canapo. Se sei
    // FERMO contro il canape (andatura 3-4) → idle vero: niente sgambettìo sul posto.
    // L'animazione segue il MOVIMENTO reale, non più il nervosismo: un cavallo
    // teso ma fermo non deve sgambettare sul posto. Chi sta girando (TURNS) muove
    // le gambe un po' di più, perché di fatto si sta rigirando.
    horse.speedLevel = horse.canapeStop ? 0 : clamp(
      0.5 + Math.abs(horse.laneVelocity) * 0.08 + (horse.turnsSpin ? 0.5 : 0) * tensionMult,
      0, 2.4
    );
  });

  // ── Rincorsa: gestita da updateRincorsa SOLO dopo essere stata scoperta ──
  // (prima gira nel tondino con le altre, nel loop qui sopra).
  const rincorsa = state.horses.find((h) => h.isRincorsa);
  if (rincorsa && rincorsa.revealed) updateRincorsa(rincorsa, dt);

  // ── Calca al canapo (esclude la rincorsa) ──────────────────────────────
  resolveMossaCrowd(dt);

  // HUD della rincorsa (Varco / Slancio) e messaggi situazionali.
  updateRincorsaHud(rincorsa);
  updateRincorsaWatcher(rincorsa);
  updateMossaMessages(dt, time, rincorsa);

  state.horses.forEach((horse) => placeHorse(horse, time));

  // ── Trigger spaziale: la rincorsa supera il canapo posteriore ───────────
  // La partenza è VALIDA solo se le 9 sono allineate; altrimenti è MOSSA FALSA
  // e si ricomincia. Dopo 3 mosse false si parte comunque (come nella realtà,
  // prima o poi la si dà buona).
  if (rincorsa &&
      (state.mossaFalsaCooldown || 0) <= 0 &&
      rincorsa.prevProgress <= MOSSA_BACK_LIMIT &&
      rincorsa.progress > MOSSA_BACK_LIMIT) {
    // La rincorsa ha VARCATO. Vale SOLO se le 9 sono allineate al canapo (nessuna
    // proprio dietro). Se ha varcato durante l'"Aspetta" / con una rimasta indietro
    // → MOSSA FALSA. Girata ma sulla linea = valida. Dopo 3 false si dà comunque buona.
    if (isMossaAligned() || (state.falseStartCount || 0) >= 3 || (state.forcedStartWindow || 0) > 0) {
      releaseRace();
    } else {
      triggerMossaFalsa();
    }
    return;
  }

  // ── TIMEOUT DEI 5 MINUTI ─────────────────────────────────────────────────
  // Scaduti i 5 minuti si parte alla PRIMA occasione in cui TUTTE E 9 le Contrade
  // sono state CHIAMATE e sono AL CANAPO (non prima: se una non è ancora chiamata
  // si aspetta). Da lì la RINCORSA ha 10 secondi per entrare, per forza: SOLO in
  // questo caso la mossa è comunque VALIDA (niente mossa falsa).
  if (state.mossaTimer >= MOSSA_MAX_DURATION && !(state.forcedStartWindow > 0) && allNineCalledAndAtCanape()) {
    state.forcedStartWindow = 10;
    if (state.messageTimer <= 0) showMessage("5 minuti scaduti: la rincorsa parte — mossa valida!", 2.2, "good");
  }
  if (state.forcedStartWindow > 0) {
    state.forcedStartWindow -= dt;
    if (rincorsa) rincorsa.wantsToEnter = true;   // spingi la rincorsa a lanciarsi
    if (state.forcedStartWindow <= 0) {           // 10s scaduti: entra a forza e VIA (valida)
    if (rincorsa) {
      // NON si sposta di forza chi sta gia' arrivando: qui la rincorsa veniva
      // teletrasportata al canapo proprio nell'istante del via, e per il
      // giocatore era uno scatto in piena corsa. Adesso si porta avanti solo chi e'
      // rimasto indietro, e la linea che si e' scelto non gliela tocca nessuno.
      rincorsa.progress = Math.max(rincorsa.progress, MOSSA_BACK_LIMIT + 0.15);
      rincorsa.prevProgress = rincorsa.progress - 0.01;
    }
      releaseRace();
      return;
    }
  }
}

// Movimento della rincorsa durante la mossa. Giocatore: lo slancio è guidato
// dall'andatura scelta (M/Spazio) — alta = carica, bassa = trattieni/arretra.
// AI: valuta il varco e l'ordine del campo, poi sceglie quando lanciarsi.
// CORRIDOIO della rincorsa: la striscia esterna (fra steccato e verrocchino)
// da cui la rincorsa entra. Se una Contrada chiamata lo occupa (es. la 9ª che
// arretra apposta), la rincorsa NON può entrare: non fianca, non si infila.
function rincorsaCorridorBlocked() {
  // Il corridoio è OLTRE il paletto del verrocchino (lato steccato): la 9ª
  // posta regolare (-7.5) NON lo occupa; lo occupa chi arretra apposta lì.
  return state.horses.some((h) => !h.isRincorsa && h.called && !h.entering
    && h.lane < VERROCCHINO_LANE - 0.5
    && h.progress > MOSSA_BACK_LIMIT - 1.5 && h.progress < MOSSA_FRONT_LIMIT);
}

function updateRincorsa(rincorsa, dt) {
  // Appena scoperta: transizione morbida dalla posizione nel tondino alla zona
  // di rincorsa (dietro il verrocchino), senza scatti. Poi comportamento normale.
  if ((rincorsa.revealTimer || 0) > 0) {
    rincorsa.revealTimer -= dt;
    if (isHuman(rincorsa)) { rincorsa.revealTimer = 0; }   // il giocatore ci va da sé: controllo pieno subito
    else {
      // AI: RAGGIUNGE il verrocchino camminando a passo costante (niente lerp che
      // la faceva "scivolare" là in un attimo, come un teletrasporto).
      const dP = RINCORSA_START_PROGRESS - rincorsa.progress;
      const dL = RINCORSA_LANE - rincorsa.lane;
      const dist = Math.hypot(dP, dL) || 1;
      const step = Math.min(6.0 * dt, dist);                // ~6 unità/s: trotto
      rincorsa.progress += (dP / dist) * step;
      rincorsa.lane += (dL / dist) * step;
      rincorsa.mossaProgress = rincorsa.progress;
      rincorsa.mossaLane = rincorsa.lane;
      rincorsa.mossaTurn = lerp(rincorsa.mossaTurn || 0, 0, clamp(dt * 2, 0, 1));
      rincorsa.rincorsaSpeed = 0;
      rincorsa.wantsToEnter = false;
      rincorsa.speedLevel = 2.6;
      if (dist < 0.4) rincorsa.revealTimer = 0;             // arrivata: comportamento normale
      return;
    }
  }
  if (isHuman(rincorsa)) {
    // La rincorsa è guidata dalla VELOCITÀ (andatura 1..5): 1 = INDIETRO, 2 =
    // ferma, 3..5 = carica in avanti sempre più forte. M alza, Spazio/S abbassa.
    // ── MOVIMENTO LIBERO 360° (come cavolo si vuole): A/L girano il MUSO senza
    // limiti, l'ANDATURA muove nella direzione in cui è girato (1=indietro, 2=fermo,
    // 3..5=avanti), Q/P danno uno strafe laterale puro. Così ci si prende la rincorsa
    // da dove si vuole dietro il canape.
    const andatura = clamp(Math.round(rincorsa.speedSetting || 2), PLAYER_SPEED_MIN, ANDATURA_MAX);
    const c = getControls();
    const turnInput = (c.left ? 1 : 0) - (c.right ? 1 : 0);
    let hd = (rincorsa.mossaTurn || 0) + turnInput * dt * 2.6;
    hd = Math.atan2(Math.sin(hd), Math.cos(hd));   // wrap 360°
    rincorsa.mossaTurn = hd;
    const vel = (andatura - 2) * MOSSA_MOVE_SPEED * 1.5;
    const s = sampleAt(rincorsa.progress);
    const heading = s.yaw + hd;
    const mvX = Math.sin(heading) * vel * dt, mvZ = Math.cos(heading) * vel * dt;
    const along = mvX * s.tangent.x + mvZ * s.tangent.z;   // avanti/indietro sulla pista
    const across = mvX * s.normal.x + mvZ * s.normal.z;    // componente laterale del muso
    const strafe = (c.latRight ? 1 : 0) - (c.latLeft ? 1 : 0);
    const outer = -(mossaOuterEdge() - 0.8);
    rincorsa.rincorsaSpeed = along / Math.max(dt, 0.001);   // il progress lo avanza il codice comune sotto
    rincorsa.lane = clamp((rincorsa.lane ?? RINCORSA_LANE) + across + strafe * dt * 2.4, outer, AI_LANE_LIMIT);
    rincorsa.mossaLane = rincorsa.lane;
    rincorsa.mossaSubState = along > 0.02 ? "charging" : "runup";
    rincorsa.humanSteered = true;             // la corsia non viene più forzata (vedi sotto)
  } else {
    rincorsa.rincorsaThinkTimer += dt;
    if (rincorsa.rincorsaThinkTimer > 0.6) {
      rincorsa.rincorsaThinkTimer = 0;
      // Non si lancia durante il posizionamento: aspetta la fase di tensione.
      if (state.mossaPhase === "tension") {
        const score = evaluateRincorsaEntry(rincorsa, state.horses, state.mossaTimer);
        // Soglia esigente all'inizio, poi cala col tempo: il mossiere aspetta
        // una buona mossa ma via via si accontenta. L'aggressività anticipa.
        const tensionTime = Math.max(0, state.mossaTimer - 2.5);
        let threshold = clamp(0.6 - rincorsa.aggression * 0.12 - tensionTime * 0.045, 0.16, 0.6);
        // ── LA RINCORSA USA IL TEMPO CONTRO LA RIVALE ────────────────────────
        // Rivale ai canapi MESSA BENE (dritta, al fronte) → ASPETTA (mai farla
        // partire bene). Rivale girata male / arretrata / nervosa → ENTRA ORA.
        const rMap = RIVALS[rincorsa.id] || {};
        const rival = state.horses.find((o) => o.called && !o.entering && rMap[o.id]);
        let rivalIsMale = false;
        let rivalIsBene = false;
        if (rival) {
          const k = rMap[rival.id];
          const rivalBene = Math.abs(rival.mossaTurn || 0) < 0.22
            && rival.mossaProgress > MOSSA_FRONT_LIMIT - 2.6
            && (rival.nervousnessCurrent || 0) < 0.7;
          const rivalMale = Math.abs(rival.mossaTurn || 0) > 0.38
            || rival.mossaProgress < MOSSA_FRONT_LIMIT - 3.4
            || (rival.nervousnessCurrent || 0) > 0.78;
          rivalIsMale = rivalMale;
          rivalIsBene = rivalBene;
          if (rivalBene) {
            threshold = clamp(threshold + 0.28 * k, 0.16, 0.95);
            if (Math.random() < 0.06 && state.messageTimer <= 0) {
              showMessage("La rincorsa attende: la rivale è troppo messa bene", 1.2);
            }
          } else if (rivalMale) {
            threshold = clamp(threshold - 0.3 * k, 0.08, 0.95);
          }
        }
        // ── RINCORSA ALLEATA (accordo/corruzione del giocatore): tempo del VIA.
        const isTurned = (o) => o && Math.abs(o.mossaTurn || 0) > 0.3;
        const findRun = (id) => id && state.horses.find((o) => o.id === id && o.called && !o.entering);
        const cmpR = state.campaign;
        if (rincorsa.allyBeneficiaryId && (rincorsa.objCanapi || rincorsa.objMossa)) {
          // TU corri: la rincorsa parte quando SEI dritto/pronto, la FAVORITA è girata
          // e la RIVALE è girata (mossa storta per loro, buona per te).
          const you = findRun(rincorsa.allyBeneficiaryId);
          const fav = findRun(rincorsa.allyTargetId);
          const riv = cmpR && cmpR.rival ? findRun(cmpR.rival.id) : null;
          if (you) {
            const youReady = Math.abs(you.mossaTurn || 0) < 0.22 && you.mossaProgress > MOSSA_FRONT_LIMIT - 2.6 && (you.nervousnessCurrent || 0) < 0.7;
            if (youReady && (!fav || isTurned(fav)) && (!riv || isTurned(riv))) {
              threshold = clamp(threshold - 0.4, 0.08, 0.95);
              if (Math.random() < 0.06 && state.messageTimer <= 0) showMessage(`${rincorsa.name} dà il via a tuo favore`, 1.2, "good");
            } else {
              threshold = clamp(threshold + 0.2, 0.16, 0.95);   // aspetta il momento giusto
            }
          }
        } else if (rincorsa.paraInRace) {
          // ASSISTI: la rincorsa alleata parte quando la RIVALE è GIRATA (mossa storta per lei).
          const riv = findRun(rincorsa.allyTargetId);
          if (isTurned(riv)) {
            threshold = clamp(threshold - 0.4, 0.08, 0.95);
            if (Math.random() < 0.06 && state.messageTimer <= 0) showMessage(`${rincorsa.name} parte: la rivale è girata`, 1.2, "good");
          } else {
            threshold = clamp(threshold + 0.2, 0.16, 0.95);
          }
        }
        // ENTRATA BUONA: solo dopo la durata minima e con i 9 allineati (o fallback
        // a mossa lunghissima). Aspetta il momento giusto.
        // La fila è SCHIERATA solo quando tutte e 9 sono chiamate e dentro (non in
        // ri-chiamata dopo una falsa). La rincorsa tenta SOLO da fila schierata: così
        // una mossa falsa non innesca un loop di false a ripetizione durante il rientro.
        const fieldAssembled = campoSchierato();
        const goodEntry = fieldAssembled &&
          (state.mossaFalsaCooldown || 0) <= 0 &&
          state.mossaTimer >= MOSSA_MIN_DURATION &&
          (state.rincorsaWait || 0) >= RINCORSA_MIN_TENSION && (
            (score > threshold && isMossaAligned()) ||
            state.mossaTimer > MOSSA_MAX_DURATION * 0.6 // fallback: mossa lunghissima
          )
          // ONORA L'ASTA: se qualcuno si è comprato la mossa, la rincorsa aspetta
          // il momento buono PER LUI. Dopo 2 minuti molla il vincolo, altrimenti
          // una condizione così stretta terrebbe la mossa aperta all'infinito.
          && (state.mossaTimer > 120 || astaFavorevoleAlVincitore());
        // ENTRATA PER SBAGLIO: ogni tanto (RARO) la rincorsa fraintende il momento ed
        // entra durante l'"Aspetta", a fila schierata → sarà MOSSA FALSA. Più probabile
        // se nervosa; niente durante il cooldown; max 1-2 volte per palio.
        let mistake = false;
        if (fieldAssembled && (state.mossaFalsaCooldown || 0) <= 0 && (state.tensionTimer || 0) > 6 && (state.falseStartCount || 0) < 2) {
          // `??` e non `||`: con `||` un nervosismo di ZERO (falsy) ricadeva sul
          // default 0.4, cioè la rincorsa PERFETTAMENTE calma aveva la stessa
          // probabilità di sbagliare di una mediamente nervosa — e più di una
          // appena agitata. Latente finché non scendeva mai a zero; ora che cala
          // davvero, andava sistemato.
          const nerv = rincorsa.nervousnessCurrent ?? 0.4;
          mistake = Math.random() < (0.0009 + nerv * 0.002);   // max 1-2 partenze anticipate per palio
          if (mistake && state.messageTimer <= 0) showMessage("La rincorsa parte in anticipo!", 1.2, "danger");
        }
        // ── FIANCATA: se la RIVALE è messa MALE, la rincorsa CI PROVA a fiancare
        // anche senza allineamento perfetto (scommette di fregarla). Al varco decide
        // il controllo: allineati = mossa valida; qualcuno troppo indietro = MOSSA
        // FALSA (mortaretto + si riparte). Non a ogni frame, e non oltre 2 false.
        let fiancata = false;
        if (rivalIsMale && fieldAssembled && (state.mossaFalsaCooldown || 0) <= 0
            && state.mossaTimer >= MOSSA_MIN_DURATION && (state.rincorsaWait || 0) >= 15
            && (state.falseStartCount || 0) < 2) {
          // ~30% per DECISIONE (la rincorsa decide ogni ~0.6s): quando la rivale è
          // messa male ci prova a fiancare entro un paio di secondi.
          fiancata = Math.random() < 0.3;
          if (fiancata && state.messageTimer <= 0) showMessage(`${rincorsa.name} prova a fiancare la rivale!`, 1.5, "good");
        }
        // Una volta decisa (buona / per sbaglio / fiancata) si impegna: carica e va.
        // REGOLA: la rincorsa non dà MAI la mossa alla rivale se questa è messa BENE
        // → blocca il lancio VOLONTARIO (buona entrata / fiancata) finché la rivale è
        // ben piazzata. La mossa falsa per sbaglio resta (non è una mossa valida). Il
        // blocco cede solo oltre la durata massima assoluta, per non tenere aperta la
        // mossa all'infinito se la rivale resta sempre pronta.
        // FANTINO COMPRATO: gli è stato pagato di NON dare la mossa a una Contrada
        // precisa → finché quella è messa bene, non si lancia.
        let noMossaBene = false;
        if (rincorsa.noMossaTarget) {
          const t = state.horses.find((o) => o.id === rincorsa.noMossaTarget && o.called && !o.entering);
          if (t) {
            noMossaBene = Math.abs(t.mossaTurn || 0) < 0.22
              && t.mossaProgress > MOSSA_FRONT_LIMIT - 2.6
              && (t.nervousnessCurrent || 0) < 0.7;
          }
        }
        const rivalBloccaVia = (rivalIsBene || noMossaBene) && state.mossaTimer < MOSSA_MAX_DURATION;
        // ── MOSSA A CHIAMATA: se il GIOCATORE si è comprato la mossa, è schierato ai
        // canapi e la rincorsa è in posizione per fiancare, quando porta l'andatura a 5
        // la rincorsa gli dà la mossa → parte LUI (senza forzare il canape, se allineato).
        let chiamataA5 = false;
        const meAsta = getPlayer();
        const ownsMossa = giocatoreHaLaMossa();
        const rinReady = rincorsaPronta();
        if (ownsMossa && !state.cartelloMossaFatto) {
          state.cartelloMossaFatto = true;       // una volta per palio, non a ogni frame
          mostraCartello("Parti a 5 quando vuoi, la rincorsa ti darà la mossa", 2);
        }
        if (ownsMossa && rinReady) {
          if (Math.round(meAsta.speedSetting || 1) >= ANDATURA_MAX && isMossaAligned()) {
            chiamataA5 = true; state.chiamataA5 = true;                       // parte a chiamata
          } else if (state.messageTimer <= 0) {
            showMessage("Parti a 5 · ti do la mossa!", 1.0, "good");          // spingi a 5 per partire
          }
        }
        rincorsa.wantsToEnter = rincorsa.wantsToEnter || ((goodEntry || fiancata) && !rivalBloccaVia) || mistake || chiamataA5;
      }
    }
    // CORRIDOIO OCCUPATO: la rincorsa trattiene la carica (il blocco fisico è
    // più sotto). La decisione resta: entrerà appena il varco si libera.
    if (rincorsa.wantsToEnter && rincorsaCorridorBlocked()) {
      rincorsa.rincorsaSpeed = Math.min(rincorsa.rincorsaSpeed, 0.5);
    }
    state.corridorMsgCd = Math.max(0, (state.corridorMsgCd ?? 0) - dt);
    if (rincorsa.wantsToEnter) {
      rincorsa.rincorsaSpeed = clamp(rincorsa.rincorsaSpeed + dt * 6.0, 0, 7.8);
      rincorsa.mossaSubState = "charging";
    } else {
      // Si posiziona indietro per prendere la rincorsa.
      const idealRunup = RINCORSA_START_PROGRESS - 1.5 - rincorsa.aggression * 1.6;
      if (rincorsa.progress > idealRunup + 0.4) {
        rincorsa.rincorsaSpeed = clamp(rincorsa.rincorsaSpeed - dt * 3.0, -1.8, 0);
      } else {
        rincorsa.rincorsaSpeed *= (1 - clamp(dt * 2.0, 0, 1));
      }
      rincorsa.mossaSubState = "runup";
    }
  }
  rincorsa.progress += rincorsa.rincorsaSpeed * dt;
  // Il limite arretra fin DENTRO il tondino (centro a MOSSA_BACK_LIMIT-10): appena
  // scoperta, la rincorsa parte da dov'è e va al verrocchino da sé, senza essere
  // risucchiata in avanti da un clamp troppo stretto.
  rincorsa.progress = Math.max(RINCORSA_START_PROGRESS - 18.0, rincorsa.progress);   // +5 unità di margine indietro
  // ── VINCOLO VERROCCHINO: la rincorsa entra SOLO a SINISTRA del verrocchino (lato
  // esterno, dove c'è il varco), MAI a destra. Se col muso libero il giocatore prova
  // a varcare il canapo stando sul lato INTERNO del paletto (lane > VERROCCHINO_LANE),
  // il paletto+canapo lo fermano: resta dietro finché non torna nel varco a sinistra.
  // Il paletto SCANSA, non inchioda. Prima qui c'era un muro secco: chi arrivava
  // al canapo anche solo un po' interno si vedeva riportare indietro il progress
  // di forza e azzerare lo slancio, un frame dopo l'altro — il cavallo restava
  // incollato al canapo e il movimento andava a scatti. Adesso, avvicinandosi al
  // canapo con la linea sbagliata, il cavallo viene scivolato verso il varco: la
  // regola resta (si entra a sinistra del verrocchino) ma la corsa non si ferma
  // mai e il progress non viene MAI toccato.
  {
    const DA = MOSSA_BACK_LIMIT - 2.8;
    if (rincorsa.progress > DA && rincorsa.lane > VERROCCHINO_LANE + 0.2) {
      const vicino = clamp((rincorsa.progress - DA) / 2.4, 0, 1);
      rincorsa.lane = lerp(rincorsa.lane, VERROCCHINO_LANE - 0.4, clamp(dt * 4.5 * vicino, 0, 1));
      rincorsa.mossaLane = rincorsa.lane;
      if (state.messageTimer <= 0 && (state.verroMsgCd ?? 0) <= 0) {
        showMessage("La rincorsa entra a SINISTRA del verrocchino", 1.4, "danger");
        state.verroMsgCd = 3.0;
      }
    }
  }
  state.verroMsgCd = Math.max(0, (state.verroMsgCd ?? 0) - dt);
  // NIENTE blocco a tempo: la rincorsa PUÒ varcare il canapo in qualsiasi momento —
  // anche "per sbaglio" durante l'"Aspetta". Se al varco le 9 non sono allineate
  // (una è proprio dietro) sarà MOSSA FALSA: la validità la decide isMossaAligned.
  // CORRIDOIO OCCUPATO: è un AVVERTIMENTO, non un muro. La rincorsa PUÒ entrare lo
  // stesso (per sbaglio) — ma con una Contrada proprio dietro nel varco sarà mossa
  // falsa. L'unica resistenza è il rallentamento soft più sopra.
  if (rincorsaCorridorBlocked() && rincorsa.progress > MOSSA_BACK_LIMIT - 1.1) {
    state.corridorMsgCd = state.corridorMsgCd ?? 0;
    if (state.corridorMsgCd <= 0 && state.messageTimer <= 0) {
      showMessage("Il varco è occupato: entrare ora sarebbe mossa falsa", 1.4, "danger");
      state.corridorMsgCd = 3.0;
    }
  }
  // Corsia FISSA solo per la rincorsa AI; quella umana la muove liberamente (Q/P, A/L).
  if (!rincorsa.humanSteered) rincorsa.lane = RINCORSA_LANE;
  rincorsa.laneVelocity = 0;
  rincorsa.speedLevel = clamp(Math.abs(rincorsa.rincorsaSpeed), 0, 9);
}

// Punteggio 0–1 che indica quanto è "buona" la mossa per lanciarsi ORA. Il
// momento giusto è quando i 9 sono PREMUTI in avanti verso il canapo e ben
// ALLINEATI fra loro (poca dispersione): è la "buona mossa" che il mossiere
// aspetta. Lo slancio già accumulato aggiunge un piccolo bonus.
function evaluateRincorsaEntry(rincorsa, horses, mossaTimer) {
  const lineup = horses.filter((h) => !h.isRincorsa && !h.finishTime);
  if (lineup.length === 0) return 1.0;
  const progs = lineup.map((h) => h.progress);
  const avg = progs.reduce((s, v) => s + v, 0) / progs.length;
  const spread = Math.max(...progs) - Math.min(...progs);
  const range = Math.max(0.1, MOSSA_FRONT_LIMIT - MOSSA_BACK_LIMIT);
  const frontScore = clamp((avg - MOSSA_BACK_LIMIT) / range, 0, 1);
  const alignScore = clamp(1 - spread / 1.7, 0, 1);
  const straggler = avg - Math.min(...progs);
  const noStraggler = straggler <= 1.2 ? 1 : clamp(1 - (straggler - 1.2) / 0.9, 0, 1);
  // Dopo 2 minuti il mossiere ignora il ritardatario e lancia comunque.
  const stragglerWeight = clamp(1 - (mossaTimer - MOSSA_MAX_DURATION) / 5, 0, 1);
  const effectiveNoStraggler = lerp(1, noStraggler, stragglerWeight);
  const slancioScore = clamp((rincorsa.rincorsaSpeed - 0.5) / 4.0, 0, 1);
  return (frontScore * 0.42 + alignScore * 0.43 + slancioScore * 0.15) * effectiveNoStraggler;
}

// Determina la qualità della partenza di un cavallo e la deviazione del muso al
// via, in base a stabilità, eventuale blocco davanti e posizione laterale.
function computeStartQuality(horse) {
  const sample = sampleAt(horse.progress);
  const tangentYaw = sample.yaw;
  // L'inclinazione tenuta alla mossa conta: chi parte storto parte peggio.
  const heading = horse.heading !== undefined ? horse.heading : tangentYaw + (horse.mossaTurn || 0);
  const dev = Math.abs(angleDiff(heading, tangentYaw));
  horse.launchHeadingDev = (Math.random() - 0.5) * (1 - horse.stability) * 0.16;

  if (horse.isRincorsa) {
    horse.startQuality = "clean";
    return;
  }

  // Cavallo direttamente davanti entro un corpo (chiuso)?
  const blocked = state.horses.some((other) =>
    other !== horse &&
    other.progress > horse.progress &&
    other.progress - horse.progress < HORSE_BLOCK_LENGTH * 1.1 &&
    Math.abs(other.lane - horse.lane) < HORSE_BLOCK_WIDTH * 0.9
  );
  // Posizione laterale: >0 = verso l'interno (vantaggio), <0 = largo.
  const outwardSign = Math.sign(sample.normal.dot(campoOutward(sample.point)) || 1);
  const laneQuality = -outwardSign * horse.lane / AI_LANE_LIMIT;

  if (blocked) {
    horse.startQuality = "closed";
    horse.launchHeadingDev += (Math.random() - 0.5) * 0.26;
  } else if (dev > 0.4 || horse.stability < 0.3) {
    horse.startQuality = "dirty";
    horse.launchHeadingDev += (Math.random() > 0.5 ? 1 : -1) * Math.max(dev, 0.2) * 0.5;
  } else if (laneQuality < -0.55) {
    horse.startQuality = "wide";
  } else if (horse.speedLevel < 0.5) {
    horse.startQuality = "slow";
  } else {
    horse.startQuality = "clean";
  }
}

// Aggiorna il testo nella barra inferiore della mini-cam rincorsa.
// La visibilità del div è gestita da renderRincorsaMiniCam().
function updateRincorsaWatcher(rincorsa) {
  // Niente mini-cam finché la rincorsa non è scoperta (altrimenti si svelerebbe).
  if (!rincorsa || isHuman(rincorsa) || state.mode !== "mossa" || !rincorsa.revealed) return;

  const score = evaluateRincorsaEntry(rincorsa, state.horses, state.mossaTimer);
  const tensionTime = Math.max(0, state.mossaTimer - 2.5);
  const threshold = clamp(0.6 - (rincorsa.aggression || 0.5) * 0.12 - tensionTime * 0.045, 0.16, 0.6);

  const nameEl   = document.getElementById("rwName");
  const statusEl = document.getElementById("rwStatus");
  const timerEl  = document.getElementById("rwTimer");

  if (nameEl) nameEl.textContent = rincorsa.name || "";

  // NIENTE annunci sull'ingresso ("si lancia", "pronto a entrare"): l'ingresso
  // si VEDE dalla mini-cam. Compare solo il caso speciale del corridoio bloccato.
  let statusText, statusCls;
  if (rincorsaCorridorBlocked()) {
    statusText = "Rincorsa non può entrare"; statusCls = "alert";
  } else if (state.mossaPhase !== "tension") {
    statusText = "Aspetta…";         statusCls = "";
  } else if (giocatoreHaLaMossa()) {
    // Comprata la mossa: qui non serve dire "osserva", serve dirgli COSA FARE.
    statusText = "Parti a 5 quando vuoi, la rincorsa ti darà la mossa"; statusCls = "good";
  } else {
    statusText = "Osserva la mossa"; statusCls = "";
  }
  if (statusEl) { statusEl.textContent = statusText; statusEl.className = `rw-status ${statusCls}`.trim(); }

  if (timerEl) {
    const t = Math.floor(state.mossaTimer);
    timerEl.textContent = `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")} / 5:00`;
  }
}

// Il giocatore si è aggiudicato la mossa all'asta ed è fermo ai canapi: la
// rincorsa gliela darà appena spinge a 5. Serve alla logica della rincorsa e alle
// due scritte che glielo dicono (la riga della mini-cam e il cartello centrale).
// Tutte le Contrade chiamate sono entrate e sono ferme ai canapi.
function campoSchierato() {
  return (state.callOrder || []).length > 0
    && state.callOrder.every((h) => h.called && !h.entering);
}
// La rincorsa è pronta a dare la mossa: campo schierato, tempo minimo passato e
// la rincorsa ha aspettato abbastanza.
function rincorsaPronta() {
  return campoSchierato() && state.mossaTimer >= MOSSA_MIN_DURATION
    && (state.rincorsaWait || 0) >= 15;
}
function giocatoreHaLaMossa() {
  const me = getPlayer();
  return !!(state.asta && me && !me.isRincorsa && me.called && !me.entering
    && state.asta.bestBidder === me.id);
}

// CARTELLO al centro dello schermo, un paio di secondi: si usa per l'avviso della
// mossa comprata, quando il giocatore arriva ai canapi.
function mostraCartello(testo, secondi = 2) {
  const vecchio = document.getElementById("cartelloMossa");
  if (vecchio) vecchio.remove();
  const el = document.createElement("div");
  el.id = "cartelloMossa";
  el.textContent = testo;
  el.style.cssText = "position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:70;"
    + "background:rgba(18,13,8,.92);border:2px solid #f0cb35;border-radius:14px;"
    + "padding:16px 26px;max-width:min(560px,88vw);text-align:center;font-family:inherit;"
    + "font-size:clamp(15px,2.6vw,22px);font-weight:800;color:#f7edd6;line-height:1.35;"
    + "box-shadow:0 10px 40px rgba(0,0,0,.6);opacity:0;transition:opacity .18s ease";
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; });
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
  }, secondi * 1000);
}

// HUD della rincorsa (solo se il giocatore è di rincorsa): barre Varco e Slancio.
function updateRincorsaHud(rincorsa) {
  const el = document.getElementById("rincorsaHud");
  if (!el) return;
  const active = !!(rincorsa && isHuman(rincorsa) && state.mode === "mossa" && rincorsa.revealed);
  el.classList.toggle("visible", active);
  if (!active) return;
  const score = evaluateRincorsaEntry(rincorsa, state.horses, state.mossaTimer);
  const canEnter = state.mossaPhase === "tension"
    && state.mossaTimer >= MOSSA_MIN_DURATION
    && (state.rincorsaWait || 0) >= RINCORSA_MIN_TENSION  // attesa cumulativa della rincorsa
    && score >= 0.38;
  const statusEl = document.getElementById("rincorsaStatus");
  if (statusEl) {
    statusEl.textContent = canEnter ? "PUÒ ENTRARE" : "ASPETTA";
    statusEl.className = "rincorsa-status " + (canEnter ? "entrare" : "aspetta");
  }
}

// Messaggi situazionali durante la mossa, uno alla volta (solo se nessun altro
// messaggio è attivo). NIENTE annunci sull'INGRESSO della rincorsa: si VEDE
// (mini-cam), non si scrive. L'unico messaggio speciale sulla rincorsa è
// "Rincorsa non può entrare" (corridoio bloccato), gestito in updateRincorsa.
function updateMossaMessages(dt, time, rincorsa) {
  if (state.messageTimer > 0) return;
  if (state.mossaPhase === "tension" && state.mossaTimer > 7 && Math.random() < dt * 0.25) {
    const phrases = ["Tutto dipende dalla rincorsa…"];   // tolte "la folla trattiene il respiro" e "i cavalli sono al limite"
    showMessage(phrases[Math.floor(Math.random() * phrases.length)], 1.1);
  }
}

// Calca al canapo: impedisce lo "scavallamento" (i cavalli non si attraversano
// e non si superano longitudinalmente) ma consente di spingere tutto il gruppo
// in avanti verso la linea e di aprirsi spazio di lato. Rilassamento iterativo.
// Ingombro EFFETTIVO del cavallo ai canapi, tenendo conto di quanto è girato.
// È l'AABB del corpo ruotato: se il cavallo si mette di traverso, l'ingombro
// LUNGO la pista si accorcia e quello DI LATO si allunga (arriva a ~la lunghezza
// del corpo). Senza questo, un cavallo girato attraversava i vicini.
// UNICA porta d'ingresso del nervosismo. Prima diversi punti (vendetta, cavallo che
// si gira, urti) scrivevano DIRETTAMENTE a ogni frame con incrementi tipo dt*0.5,
// cioè +0.5 al secondo: bastava un contatto di un secondo per passare da 0 a 0.56,
// e il filtro delle "botte" non c'entrava nulla. Ora tutto passa di qui, con lo
// stesso cooldown: una botta contata ogni NERV_HIT_COOLDOWN, punto.
// UNA PRESSIONE di qualcuno che ti sta addosso. Non alza subito il nervosismo:
// viene contata, e solo al raggiungimento di NERV_HIT_STREAK pressioni di fila
// dallo STESSO avversario scatta la BOTTA (+NERV_HIT_GAIN). Mollare la presa più
// di NERV_HIT_WINDOW azzera il conteggio: chi vuole innervosirti deve insistere.
// SCATTO DI TENSIONE DA EVENTO (mossa falsa, tutti fuori): non è una botta di un
// avversario, è la piazza che si scalda. Alza ANCHE la base del frame, così il
// tetto di salita non lo vede come una salita e non se lo mangia — prima questi
// +0.07 / +0.08 arrivavano al cavallo ridotti a 0.0005.
function nervEvento(h, quanto) {
  h.nervousness = clamp((h.nervousness || 0.4) + quanto, 0, 1);
  h.nervousnessCurrent = clamp((h.nervousnessCurrent || 0.4) + quanto, 0, 1);
  if (h.nervPrevFrame != null) h.nervPrevFrame = h.nervousnessCurrent;
}

// Quanto sale il nervosismo in base all'ANDATURA al canapo: 4 = pieno (come
// prima); 3 = 30% più lento; 2 = 50% più lento. (5 = pieno; 1 = calmo come 2.)
// STESSA regola per giocatore E AI.
const NERV_RISE_BY_ANDATURA = { 1: 0.5, 2: 0.5, 3: 0.7, 4: 1.0, 5: 1.0 };
// Effetto specchiato sulla DISCESA: se al canapo tieni l'andatura bassa, il
// barbero non solo si agita meno (tabella sopra) ma si CALMA anche più in fretta;
// se lo spingi forte, si scarica al ritmo normale. Stessa regola per tutti (il
// moltiplicatore usa andaturaAlCanapo, valida sia per il giocatore che per l'AI).
const NERV_DECAY_BY_ANDATURA = { 1: 1.6, 2: 1.6, 3: 1.25, 4: 1.0, 5: 1.0 };
// Andatura EFFETTIVA al canapo, uguale in spirito per tutti: il giocatore la
// SCEGLIE (speedSetting); l'AI non ha un tasto, quindi la deriva dal temperamento
// — un cavallo calmo spinge piano contro il canapo (andatura bassa, si agita meno),
// uno agitato lo combatte (andatura alta, si agita di più). calma 5→2, calma 1→5.
function andaturaAlCanapo(horse) {
  if (isHuman(horse)) return clamp(Math.round(horse.speedSetting || 2), 1, 5);
  return clamp(6 - (horse.calma || 3), 1, 5);
}
function nervPress(vittima, aggId, peso) {
  if (!vittima || vittima.nervBackState) return;
  // Orologio che avanza SEMPRE (mossa e gara): mossaTimer si ferma alla partenza,
  // e usandolo il cooldown smetteva di funzionare durante la corsa.
  const now = state.nervClock || 0;
  if (now - (vittima.lastTouchAt ?? -99) < NERV_HIT_COOLDOWN) return;
  vittima.lastTouchAt = now;
  vittima.lastHitAt = now;   // finché ti stanno addosso non ti calmi
  const s = vittima.hitStreak;
  if (s && s.by === aggId && now - s.at <= NERV_HIT_WINDOW) { s.n += 1; s.at = now; }
  else vittima.hitStreak = { by: aggId, n: 1, at: now };
  if (vittima.hitStreak.n >= NERV_HIT_STREAK) {
    vittima.hitStreak.n = 0;   // botta assestata: il conteggio riparte
    // La salita dipende dall'andatura al canapo — STESSA regola per tutti (più
    // spingi, più il barbero si agita; fermo/calmo a 2, sale la metà).
    const andaMult = NERV_RISE_BY_ANDATURA[andaturaAlCanapo(vittima)] ?? 1;
    vittima.nervousnessCurrent = clamp((vittima.nervousnessCurrent || 0) + NERV_HIT_GAIN * (peso ?? 1) * andaMult, 0, 1);
  }
}

// ── NERBATA ────────────────────────────────────────────────────────────────
// Un cavallo non può nerbare se il fantino è caduto o è scosso (senza fantino).
function puoNerbare(h) {
  return h && !h.caduto && !h.scosso;
}
// Ricarica e cooldown delle nerbate: un tick per cavallo, ogni frame, in ogni fase.
function tickNerbate(dt) {
  [...state.horses, state.horses.find((h) => h.isRincorsa)].forEach((h) => {
    if (!h) return;
    if (h.nerbate === undefined) h.nerbate = NERBATE_MAX;
    h.nerbataCd = Math.max(0, (h.nerbataCd || 0) - dt);
    h.nerbataSwing = Math.max(0, (h.nerbataSwing || 0) - dt);
    h.nerbSlowT = Math.max(0, (h.nerbSlowT || 0) - dt);
    // Blocco "andatura a 1" da nerbata ai canapi (solo AI): scade dopo 4s → riprende.
    if ((h.nerbLock || 0) > 0) h.nerbLock = Math.max(0, h.nerbLock - dt);
    if (h.nerbate < NERBATE_MAX) {
      h.nerbataRechargeT = (h.nerbataRechargeT || 0) + dt;
      if (h.nerbataRechargeT >= NERBATA_RECHARGE) {
        h.nerbataRechargeT -= NERBATA_RECHARGE;
        h.nerbate = Math.min(NERBATE_MAX, h.nerbate + 1);
      }
    } else {
      h.nerbataRechargeT = 0;
    }
  });
}
// Bersaglio sul LATO indicato (side: -1 sinistra, +1 destra). +lane = destra (come Q/P).
function vicinoDiLato(h, side, phase) {
  const lenLimit = phase === "mossa" ? HORSE_BLOCK_LENGTH * 0.95 : HORSE_BLOCK_LENGTH;
  const wLimit = phase === "mossa" ? MOSSA_POST_GAP : HORSE_PASS_CLEARANCE;
  let best = null, bestD = Infinity;
  state.horses.forEach((o) => {
    if (o === h || o.caduto) return;
    if (phase === "mossa" && (o.isRincorsa || !o.called || o.entering)) return;
    if (Math.abs((o.progress ?? 0) - (h.progress ?? 0)) > lenLimit) return;
    const dl = o.lane - h.lane;
    if (Math.sign(dl) !== side) return;
    const ad = Math.abs(dl);
    if (ad > wLimit || ad >= bestD) return;
    bestD = ad; best = o;
  });
  return best;
}
// La "sfavorita" fra due cavalli = tier più basso; a parità, meno vittorie nell'albo.
function sfavoritaTra(a, b) {
  const ra = TIER_RANK[a.tier] ?? 1, rb = TIER_RANK[b.tier] ?? 1;
  if (ra !== rb) return ra < rb ? a : b;
  const albo = (globalAlbo && globalAlbo.contrada) || {};
  const wa = albo[a.id] || 0, wb = albo[b.id] || 0;
  if (wa !== wb) return wa < wb ? a : b;
  return a;   // pari e pari: a nerba
}
// NERBATA DA TELEFONO: il giocatore tocca il tasto NERBO → colpisce verso il
// rivale più vicino (sceglie il lato da solo, così basta un tasto). Se non c'è
// nessuno accanto, colpisce verso il lato in cui sta sterzando (default destra).
function playerTouchNerbata() {
  const pl = state.horses.find((h) => isHuman(h));
  if (!pl || pl.scosso || pl.caduto) return;
  if (state.mode !== "race" && state.mode !== "mossa") return;
  const phase = state.mode === "mossa" ? "mossa" : "race";
  // DA TELEFONO: mira AUTOMATICAMENTE alla contrada più vicina (nessuna scelta di
  // lato) — così basta toccare NERBO. Raggio generoso: quasi sempre trova qualcuno.
  let target = null, best = Infinity;
  state.horses.forEach((o) => {
    if (o === pl || o.isRincorsa || o.scosso || o.caduto) return;
    const dProg = Math.abs((o.progress || 0) - (pl.progress || 0));
    const dLane = Math.abs((o.lane || 0) - (pl.lane || 0));
    const d = dProg + dLane * 0.6;
    if (dProg < 12 && d < best) { best = d; target = o; }   // raggio ampio: la più vicina
  });
  if (target) {
    const side = Math.sign((target.lane || 0) - (pl.lane || 0)) || 1;
    tiraNerbata(pl, side, phase, target);   // colpisce DIRETTAMENTE la più vicina
  } else {
    const c = getControls();
    tiraNerbata(pl, c.right ? 1 : (c.left ? -1 : 1), phase);   // nessuno vicino: colpo verso lo sterzo
  }
}

// Esegue una nerbata dall'attaccante verso il lato indicato. Consuma SEMPRE un
// colpo (anche a vuoto, come una pistola). phase: "mossa" | "race".
// forcedTarget (opzionale): bersaglio già scelto (usato dal tasto touch, che mira
// automaticamente alla contrada più vicina) → salta la ricerca per lato.
function tiraNerbata(attacker, side, phase, forcedTarget = null) {
  if (!puoNerbare(attacker)) return false;
  if ((attacker.nerbataCd || 0) > 0) return false;
  if ((attacker.nerbate ?? NERBATE_MAX) <= 0) return false;
  attacker.nerbate -= 1;                 // si consuma sempre
  attacker.nerbataCd = NERBATA_COOLDOWN;
  attacker.nerbataSwing = 0.32;          // frusta in animazione
  attacker.nerbataSide = side;
  const target = forcedTarget || vicinoDiLato(attacker, side, phase);
  if (!target) return false;             // colpo a vuoto: nerbata sprecata
  if (phase === "mossa") {
    target.nervousnessCurrent = clamp((target.nervousnessCurrent || 0) + NERBATA_NERV, 0, 1);
    // EFFETTO (rifatto): la nerbata NON manda più indietro (arretravano tutti e la
    // mossa diventava ingiocabile). Ora per 4s il cavallo colpito SPINGE DI LATO —
    // come tenere premuto P/Q verso il lato del colpo — sia AI che giocatore.
    target.nerbLock = 4.0;
    target.nerbSide = (side >= 0) ? 1 : -1;      // lato verso cui spinge per 4s
  } else {
    target.nerbSlowT = NERBATA_SLOW_DUR;
    // Il GIOCATORE che nerba NON deve rallentare: il colpo azzera ogni rallentamento
    // che stava subendo (es. la rivale che lo frusta di rimando) — rallenta SOLO il colpito.
    if (isHuman(attacker)) attacker.nerbSlowT = 0;
  }
  target.collisionFlash = Math.max(target.collisionFlash || 0, 0.7);
  // (rimossa la scritta "X nerba Y": troppo ripetitiva a schermo)
  return true;
}
// Moltiplicatore di velocità per chi è stato nerbato in gara.
function nerbSlowMult(h) { return (h.nerbSlowT || 0) > 0 ? (1 - NERBATA_SLOW) : 1; }

// AI CANAPI: se il GIOCATORE tiene andatura 5, avvisa che rischia di forzare il
// canape (mossa falsa). Throttle: non più di una volta ogni 4s.
function maybeCanapiForceWarning(dt) {
  if (state.mode !== "mossa") { state.canapiWarnCd = 0; return; }
  const pl = getPlayer();
  if (!pl || pl.finishTime || pl.scosso || pl.caduto) return;
  state.canapiWarnCd = Math.max(0, (state.canapiWarnCd || 0) - dt);
  const spd = clamp(Math.round(pl.speedSetting || 1), 1, 5);
  if (spd >= 5 && state.canapiWarnCd <= 0 && state.messageTimer <= 0) {
    showMessage("Se vai troppo forte forzi il canape!", 1.6, "danger");
    state.canapiWarnCd = 4;
  }
}

// Distanza fra due poste consecutive ai canapi (lineLanes): 1.90. Il tetto deve
// restare SOTTO questo valore, altrimenti due vicini fermi alle proprie poste
// risultano già compenetrati e il risolutore non trova mai pace.
const MOSSA_POST_GAP = 1.80;
// Larghezza LATERALE del cavallo ai canapi: TENUTA STRETTA (≈ larghezza vera del
// corpo, non 1.02) così i vicini si avvicinano davvero fino a TOCCARSI prima che
// il risolutore li separi. Con 1.02 restavano staccati di un palmo e premere Q/P
// non li faceva mai entrare in contatto → nessuna spinta.
const MOSSA_HORSE_WIDTH = 0.66;

function mossaFootprint(h) {
  const t = Math.abs(h.mossaTurn || 0);
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  return {
    prog: HORSE_BLOCK_LENGTH * c + HORSE_BLOCK_WIDTH * s,
    // L'ingombro LATERALE è tappato alla distanza fra due poste. Senza questo tetto
    // un cavallo girato ne reclamava fino a 3.6, cioè più dei 2.1 che esistono: due
    // vicini risultavano SEMPRE compenetrati e il risolutore continuava a spingerli
    // senza mai trovare pace. Era questo — non il nervosismo — a rendere impossibile
    // stare fermi al canape. La larghezza a riposo è MOSSA_HORSE_WIDTH (stretta).
    lane: Math.min(HORSE_BLOCK_LENGTH * s + MOSSA_HORSE_WIDTH * c, MOSSA_POST_GAP),
  };
}

function resolveMossaCrowd(dt) {
  // Solo i cavalli già chiamati e schierati: chi è in coda o sta entrando non
  // partecipa ancora alla calca.
  const horses = state.horses.filter((h) => !h.isRincorsa && h.called && !h.entering);
  // (l'ingombro non è più fisso: lo calcola mossaFootprint in base alla rotazione)

  // 1. MURO DEL CANAPO: limite RIGIDO, non una spinta. Prima era una repulsione
  //    proporzionale applicata ogni frame con buffer 1.3, mentre la posta punta a
  //    1.2 dal canapo: la condizione era SEMPRE vera, quindi ogni cavallo veniva
  //    respinto in continuazione mentre il suo goal lo riportava avanti → tremolìo
  //    perenne di tutta la fila. Ora è un tetto: ci si appoggia e si sta fermi.
  const CANAPI_BUFFER = 1.0;
  const muro = MOSSA_FRONT_LIMIT - CANAPI_BUFFER;
  horses.forEach((horse) => {
    if (horse.progress > muro) horse.progress = muro;
    if (horse.mossaProgress > muro) horse.mossaProgress = muro;
  });

  // 2. COLLISIONI — CORPI SOLIDI. Due correzioni rispetto a prima:
  //  · la sagoma tiene conto di QUANTO IL CAVALLO È GIRATO: un cavallo di traverso
  //    occupa molta più corsia e meno lunghezza. Prima la sagoma era fissa lungo
  //    l'asse pista, così un cavallo girato attraversava i vicini come se niente fosse;
  //  · la separazione era limitata a ~0.008 unità per frame: troppo lenta per
  //    respingere cavalli che si spingono addosso, quindi i corpi affondavano
  //    l'uno nell'altro. Ora i cap sono alzati e le iterazioni aumentate: si
  //    URTANO e si respingono, ma non si compenetrano.
  for (let iter = 0; iter < 5; iter += 1) {
    for (let a = 0; a < horses.length; a += 1) {
      for (let b = a + 1; b < horses.length; b += 1) {
        const A = horses[a];
        const B = horses[b];
        // La CORSA-VENDETTA passa DIETRO le altre: mentre ARRETRA/TRAVERSA non viene
        // fermata dalla calca (plana dietro i cavalli, li "sfila"); torna solida in
        // "affronta", quando risale ADDOSSO alla rivale.
        const aTrav = A.vendettaState === "arretra" || A.vendettaState === "traversa";
        const bTrav = B.vendettaState === "arretra" || B.vendettaState === "traversa";
        if (aTrav || bTrav) continue;
        // Ingombro EFFETTIVO di ciascuno in base all'angolo (AABB del corpo ruotato).
        const fpA = mossaFootprint(A), fpB = mossaFootprint(B);
        const minLanePair = (fpA.lane + fpB.lane) * 0.5;
        const minProgPair = (fpA.prog + fpB.prog) * 0.5;
        const laneGap = Math.abs(A.lane - B.lane);
        if (laneGap >= minLanePair) continue;
        const progGap = B.progress - A.progress;
        if (Math.abs(progGap) >= minProgPair) continue;
        const front = progGap >= 0 ? B : A;
        const back  = progGap >= 0 ? A : B;
        // ── SI SEPARA SULL'ASSE DOVE SI ENTRA DI MENO ────────────────────────
        // Due sagome che si sovrappongono si possono staccare di lato OPPURE
        // avanti/indietro: si sceglie SEMPRE la via più corta. Prima si arretrava
        // e basta, e questo era il difetto grave: due cavalli AFFIANCATI alla
        // stessa altezza hanno una compenetrazione laterale di pochi centimetri
        // ma una longitudinale grande quanto tutto il corpo (3.30), perché sono
        // alla stessa progressione. Il risolutore leggeva quel 3.30 e sparava
        // indietro il vicino di una lunghezza intera di cavallo: bastava
        // sfiorare qualcuno di fianco per mandarlo in fondo alla fila. È questo
        // — non il nervosismo — a riempire la mossa di Contrade rimaste dietro.
        const penLane = minLanePair - laneGap;                 // quanto entrano di fianco
        const penProg = minProgPair - Math.abs(progGap);       // quanto entrano di muso/coda
        const side = Math.sign(back.lane - front.lane) || (back.lane <= 0 ? -1 : 1);
        let lPush = 0;
        if (penProg < penLane) {
          // Sono davvero uno DIETRO l'altro: si stacca in lunghezza (correzione
          // piccola, perché è l'asse di minima penetrazione).
          const contatto = Math.max(MOSSA_BACK_LIMIT, front.progress - minProgPair);
          back.progress = Math.min(back.progress, contatto);
          back.mossaProgress = Math.min(back.mossaProgress, contatto);
        } else {
          // Sono AFFIANCATI: ci si fa spazio DI LATO e nessuno arretra.
          lPush = penLane * 0.5;
        }
        // ── CONTESA AI CANAPI: chi ha MOSSA × DIFESA più alto TIENE la posizione e
        // SPOSTA l'altro. La separazione totale (2×lPush) è la stessa, ma distribuita
        // INVERSA alla forza: il più forte quasi non si muove, il più debole viene
        // spinto via. A parità di forza torna simmetrica (lPush ciascuno).
        // POTENZA del cavallo = moltiplicatore di quanto SPOSTI le altre andandogli
        // addosso ai canapi: entra dritta nella forza di contesa, come la mossa×difesa
        // del fantino. Cavallo potente = tiene la posta e scaccia il vicino.
        // Chi sta PREMENDO deliberatamente verso il vicino (giocatore con Q/P o A/L,
        // AI con shoveDir). Va calcolato PRIMA della separazione: chi spinge di
        // proposito TIENE la posta e scaccia l'altro (bonus di forza ×3), così la
        // spinta si sente davvero invece di dividersi 50/50 e non spostare nessuno.
        const premeBack = isHuman(back) ? (controlsLateral() || controlsTurn() || 0) : (back.shoveDir || 0);
        const premeFront = isHuman(front) ? (controlsLateral() || controlsTurn() || 0) : (front.shoveDir || 0);
        const backSpinge = premeBack && Math.sign(premeBack) === Math.sign(front.lane - back.lane);
        const frontSpinge = premeFront && Math.sign(premeFront) === Math.sign(back.lane - front.lane);
        const sBack = (back.jkMossa || 3) * (back.jkDifesa || 3) * (back.potenza || 3) * (backSpinge ? 3 : 1);
        const sFront = (front.jkMossa || 3) * (front.jkDifesa || 3) * (front.potenza || 3) * (frontSpinge ? 3 : 1);
        const tot = 2 * lPush;
        back.lane  = clamp(back.lane  + side * tot * (sFront / (sBack + sFront)), -AI_LANE_LIMIT, AI_LANE_LIMIT);
        front.lane = clamp(front.lane - side * tot * (sBack / (sBack + sFront)), -AI_LANE_LIMIT, AI_LANE_LIMIT);
        // Chi viene spinto NON rientra subito alla sua posta: marcalo così il ritorno
        // (§3) lo salta finché è in contatto → la spinta RESTA.
        if (backSpinge) { front.spintoTimer = 0.6; nervPress(front, back.id); }
        if (frontSpinge) { back.spintoTimer = 0.6; nervPress(back, front.id); }
        // Il GOAL si appoggia sulla posizione risolta, non ci si avvicina a rate.
        // Prima era un lerp parziale (0.22/0.25): il goal restava dentro il vicino
        // e continuava a tirare, mentre la separazione ributtava fuori → rimbalzo.
        // Così invece si sta appoggiati; chi PREME (Q/P, o la spinta dell'AI) muove
        // comunque il proprio goal il frame dopo, quindi la pressione resta possibile:
        // semplicemente non si penetra più.
        back.mossaLane = back.lane;
        front.mossaLane = front.lane;
        // ── REAZIONE ATTIVA AL CONTATTO (§5): chi viene urtato NON resta passivo.
        // Impulso di contatto (letto dall'AI per contrastare/raddrizzarsi/recuperare
        // posizione) col lato da cui è stato spinto; il contatto alza il nervosismo,
        // e FRA RIVALI lo alza molto di più (marcatura paliesca).
        const rk = rivalIntensity(A.id, B.id);
        // CONTATTO: chi viene urtato si INCAZZA e spinge a sua volta con decisione
        // (contro-spinta per farsi spazio) — NON trema, NON diventa impotente.
        // contactSide = lato da cui arriva la spinta → preme verso lì.
        back.contactTimer = 0.8;  back.contactSide = side;   back.angry = 1;
        front.contactTimer = 0.8; front.contactSide = -side; front.angry = 1;
        // Anche gli urti IN GARA passano dalla porta unica, con lo stesso tetto di
        // una botta ogni NERV_HIT_COOLDOWN. Prima qui si sommava `rk * 0.06` NON
        // moltiplicato per dt: fra rivali erano +0.06 a FRAME, cioè +3.6 al secondo,
        // e la barra saltava da 20% a 60% in tre secondi.
        nervPress(back, front.id);
        nervPress(front, back.id);
        // ── NERBATE AI CANAPI: TUTTI possono nerbare, ma di solito solo le RIVALI si
        // picchiano quando sono accanto. Il giocatore lo fa a mano (K/S); qui le AI:
        //  · se A e B sono RIVALI → la SFAVORITA (tier più basso; a parità meno
        //    vittorie) nerba SEMPRE l'altra, e la FAVORITA si difende per aggressività;
        //  · se NON sono rivali → capita di rado (piccola probabilità per aggressività).
        if (rk > 0) {
          const sfav = sfavoritaTra(A, B);
          const fav = sfav === A ? B : A;
          tiraNerbata(sfav, Math.sign(fav.lane - sfav.lane) || 1, "mossa");   // la sfavorita: sempre
          if (!isHuman(fav) && Math.random() < dt * (0.5 + (fav.aggression || 0.5) * 1.2)) {
            tiraNerbata(fav, Math.sign(sfav.lane - fav.lane) || 1, "mossa");   // il favorito AI: si difende
          }
        } else {
          // Non rivali: raramente qualche AI aggressiva molla comunque una nerbata.
          [[A, B], [B, A]].forEach(([att, vic]) => {
            if (!isHuman(att) && Math.random() < dt * (att.aggression || 0.5) * 0.25) {
              tiraNerbata(att, Math.sign(vic.lane - att.lane) || 1, "mossa");
            }
          });
        }
        A.collisionFlash = Math.max(A.collisionFlash || 0, 0.6);
        B.collisionFlash = Math.max(B.collisionFlash || 0, 0.6);
        if (rk > 0 && state.messageTimer <= 0 && Math.random() < dt * 0.4) {
          showMessage(`Contatto tra ${A.name} e ${B.name}`, 1.0, "danger");
        }
      }
    }
  }

  // 3. RITORNO ALLA POSTA: forza debole che riporta ogni cavallo AI alla sua
  //    corsia dopo essere stato spostato dalla calca. TENUTA BASSA apposta: se
  //    è troppo forte, una AI spinta via con Q/P rientra subito e la spinta
  //    "non resta". Così invece chi lo scaccia gli guadagna spazio davvero.
  const spring = clamp(dt * 0.3, 0, 0.05);
  horses.filter((h) => !isHuman(h)).forEach((horse) => {
    // Se è stato appena SPINTO di proposito, non rientra: lascia che lo spostamento
    // resti finché il timer non scade (così la spinta con Q/P si vede davvero).
    if (horse.spintoTimer > 0) { horse.spintoTimer -= dt; return; }
    const postLane = horse.postLane ?? horse.mossaLane;
    horse.mossaLane = lerp(horse.mossaLane, postLane, spring);
    horse.lane      = lerp(horse.lane, horse.mossaLane, spring * 0.5);
  });
}

// ── Registrazione delle traiettorie del giocatore ─────────────────────────
// Per ogni "fetta" del tracciato memorizziamo la corsia (lane) tenuta dal
// giocatore: diventa la LINEA IDEALE che le AI seguono come miglior benchmark
// (invece di andare troppo larghe). Persistita in localStorage fra le partite.
const IDEAL_LINE_BUCKETS = 120;
// v2: azzerate le traiettorie registrate prima delle nuove fisiche di sterzata.
// La registrazione riparte da zero da ora (le vecchie v1 vengono ignorate e rimosse).
const IDEAL_LINE_KEY = "palioIdealLine_v3";      // v3: azzerato, si riparte da zero
const IDEAL_LINE_LEGACY_KEYS = ["palioIdealLine_v1", "palioIdealLine_v2", "palioIdealAndatura_v1", "palioIdealSpeed_v1"];
// 2 log della velocità del giocatore, per posizione-pista (come la linea):
//   andatura effettiva (1..5) e velocità di percorrenza (u/sec).
const IDEAL_ANDATURA_KEY = "palioIdealAndatura_v2"; // v2: azzerato
const IDEAL_SPEED_KEY = "palioIdealSpeed_v2";       // v2: azzerato

function idealLineBucket(progress) {
  const b = Math.floor(positiveMod(progress, track.length) / track.length * IDEAL_LINE_BUCKETS);
  return ((b % IDEAL_LINE_BUCKETS) + IDEAL_LINE_BUCKETS) % IDEAL_LINE_BUCKETS;
}

function loadBuckets(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length === IDEAL_LINE_BUCKETS) {
      return arr.map((v) => (v == null ? null : Number(v)));
    }
  } catch (e) { /* niente registrazione salvata */ }
  return new Array(IDEAL_LINE_BUCKETS).fill(null);
}

function loadIdealLine() {
  // Rimuove le vecchie traiettorie registrate (versioni precedenti): si riparte da zero.
  try { IDEAL_LINE_LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignora */ }
  state.idealLine = loadBuckets(IDEAL_LINE_KEY);
  state.idealAndatura = loadBuckets(IDEAL_ANDATURA_KEY); // log andatura (1..5)
  state.idealSpeed = loadBuckets(IDEAL_SPEED_KEY);       // log velocità (u/sec)
}

function saveIdealLine() {
  try {
    localStorage.setItem(IDEAL_LINE_KEY, JSON.stringify(state.idealLine));
    localStorage.setItem(IDEAL_ANDATURA_KEY, JSON.stringify(state.idealAndatura));
    localStorage.setItem(IDEAL_SPEED_KEY, JSON.stringify(state.idealSpeed));
  } catch (e) { /* ignora */ }
}

// Log CONGELATI: le medie mobili di traiettoria/velocità salvate sono definitive
// e non vengono più modificate dalla guida. (Metti a false per ri-registrare.)
const IDEAL_LINE_FROZEN = true;

function recordPlayerLine(player) {
  if (IDEAL_LINE_FROZEN) return;                  // log congelati: non cambiano più
  if (!state.idealLine || player.sliding) return; // niente registrazione se sbanda
  const bk = idealLineBucket(player.progress);
  // media mobile sui giri: converge sui valori che tieni di solito.
  const ema = (prev, val) => (prev == null ? val : prev + (val - prev) * 0.25);
  state.idealLine[bk] = ema(state.idealLine[bk], player.lane);
  // 2 log delle velocità, stessa posizione-pista della linea.
  state.idealAndatura[bk] = ema(state.idealAndatura[bk], player.effectiveSpeedLevel || 0);
  state.idealSpeed[bk] = ema(state.idealSpeed[bk], player.travelSpeed || 0);
}

function updatePlayer(dt, time) {
  const player = getPlayer();
  if (!player) return;
  if (player.autopilot) return;   // ASSISTI (campagna): il cavallo-focus lo guida updateAiHorse
  if (player.finishTime) {
    // Ha già tagliato: durante il runout PROSEGUE oltre la linea (niente stop
    // sul traguardo), così il replay lo mostra in volata e non congelato.
    if ((state.raceRunout || 0) > 0) {
      const f = frenataArrivo(player);
      player.progress += (player.travelSpeed || 0) * RACE_SPEED_MULT * f * dt;
      // SI RIMETTE DRITTO. Finita la corsa il giocatore non guida più, ma il muso
      // restava puntato dove l'aveva lasciato l'ultimo comando: sulla curva dopo
      // il traguardo il cavallo proseguiva di traverso. Qui l'orientamento torna
      // dolcemente su quello della pista.
      const sArr = sampleAt(player.progress);
      if (player.heading !== undefined) {
        player.heading += angleDiff(sArr.yaw, player.heading) * clamp(dt * 2.2, 0, 1);
      }
      // AL GALOPPO fino alla fine: l'andatura scende con la velocità vera, ma non
      // va sotto il piccolo galoppo finché il cavallo si muove ancora. Prima le
      // gambe si spegnevano e il cavallo scivolava avanti da fermo.
      player.speedLevel = Math.max(f > 0.02 ? 3.2 : 0, (player.travelSpeed || 0) * f * 0.9);
      placeHorse(player, time);
    }
    return;
  }
  if (player.launching) return; // ritardo di reazione al via: ancora fermo

  const controls = getControls();
  const left = controls.left;
  const right = controls.right;
  const steeringInput = left || right;
  const steer = (right ? PLAYER_RIGHT_STEER_MULTIPLIER : 0) - (left ? PLAYER_LEFT_STEER_MULTIPLIER : 0);
  const sample = sampleAt(player.progress);
  const curve = sample.curve;
  const chosenSpeed = firstLapCapAndatura(player, clamp(Math.round(player.speedSetting || 1), PLAYER_SPEED_MIN, ANDATURA_MAX));
  let staminaRate = getStaminaRateForHorse(player, chosenSpeed);
  if (player.chiamataNoStaminaT > 0) { player.chiamataNoStaminaT -= dt; staminaRate = 0; }   // partenza a chiamata: 0 stamina per i primi 2s
  player.stamina = clamp(player.stamina - staminaRate * dt, 0, player.staminaMax || STAMINA_MIN_ROLL);
  const effectiveSpeed = getPlayerEffectiveSpeed(player); // andatura 1..5
  player.effectiveSpeedLevel = effectiveSpeed;
  player.staminaLimited = effectiveSpeed < chosenSpeed;
  if (player.staminaLimited && !player.wasStaminaLimited && state.messageTimer <= 0) {
    showMessage("Stanco: scala marcia o perdi rendimento", 0.9, "danger");
  } else if (!player.staminaLimited && player.wasStaminaLimited && player.stamina > (player.staminaMax || STAMINA_MIN_ROLL) * 0.55 && state.messageTimer <= 0) {
    showMessage("Respira: rendimento recuperato", 0.7, "good");
  }
  player.wasStaminaLimited = player.staminaLimited;
  // Intensità interna = andatura * 2 (andatura 5 -> intensità 10 -> 17 u/sec).
  player.targetSpeedLevel = effectiveSpeed * 2;
  player.speedPulse = Math.max(0, player.speedPulse - dt);
  player.brakePulse = Math.max(0, player.brakePulse - dt);
  player.boosting = player.speedPulse > 0 || (state.mode === "race" && chosenSpeed >= ANDATURA_MAX && !player.staminaLimited);
  player.braking = player.brakePulse > 0;

  player.speedLevel += (player.targetSpeedLevel - player.speedLevel) * clamp(dt * 2.25, 0, 1);
  // Velocità di movimento: scelta dall'andatura, con transizione morbida verso
  // la nuova velocità di crociera (nessuno scatto al cambio).
  const targetTravel = andaturaToSpeed(effectiveSpeed);
  if (!player.travelSpeed) player.travelSpeed = targetTravel;
  player.travelSpeed += (targetTravel - player.travelSpeed) * clamp(dt * 2.25, 0, 1);
  const speedPressure = clamp((player.speedLevel - 5.5) / 4.5, 0, 1);

  // --- Sterzo manuale: heading in spazio-mondo ----------------------------
  // Il cavallo NON segue più la pista in automatico. Ruota solo se il giocatore
  // preme A (sinistra) o L (destra): è lui a disegnare la traiettoria. Se in
  // curva non sterza, prosegue dritto e va largo fino alla barriera.
  const tangentYaw = Math.atan2(sample.tangent.x, sample.tangent.z);
  if (player.heading === undefined) player.heading = tangentYaw;
  const steerDir = (left ? 1 : 0) - (right ? 1 : 0); // L = destra, A = sinistra
  // Sterzo dipende da curva E velocità:
  // Sensibilità di sterzata (tabella condivisa con le AI): rettilineo 0.80; in
  // curva dipende dall'andatura — più si va forte, più si va larghi.
  // Sterzo SEMPRE UGUALE. Prima in curva rispondeva meno — fino a un terzo ad
  // andatura piena — quindi proprio dove serviva girare il volante si induriva e
  // il cavallo sembrava trascinato. Adesso la risposta è la stessa ovunque: giri
  // tu, quanto vuoi, e la pista è solo una forma da seguire.
  const turnMult = STRAIGHT_STEER;
  const turnRate = PLAYER_STEER_TURN_RATE * turnMult;
  player.heading += steerDir * turnRate * dt;
  // NIENTE CURVA AUTOMATICA. Qui c'era un limite (±60°) misurato SULLA TANGENTE
  // della pista: sembrava solo un anti-testacoda, ma in curva la tangente ruota e
  // chi era al limite veniva TRASCINATO dalla pista — cioè girava da solo senza
  // toccare i comandi. Ora il muso va dove lo punti e basta: in curva si sterza
  // perché si sa che c'è la curva, e chi non sterza va largo e trova lo steccato.
  // headingDev resta calcolato perché serve a rischio e sbandata: più sei di
  // traverso, più scivoli — ma non corregge più niente.
  const headingDev = angleDiff(player.heading, tangentYaw);

  player.risk = clamp(curve * (0.3 + speedPressure * 1.0) + Math.abs(headingDev) * 0.62 + (player.boosting ? 0.12 : 0), 0, 1);
  player.sliding = Math.abs(headingDev) > 0.42 && player.speedLevel > 5.2;

  const slidePenalty = player.sliding ? 0.965 : 1;
  // NIENTE PENALITÀ DI CURVA. Qui la curvatura toglieva fino al 34% di velocità
  // ad andatura alta: al Casato, che è la curva più stretta, era la fetta più
  // grossa del "risucchio" ed è l'ultima rimasta. La forma della pista non deve
  // frenare nessuno: se giri male vai largo e trovi lo steccato, che è la
  // conseguenza giusta. Resta solo la penalità da SBANDATA (slidePenalty), che
  // dipende da come sei messo tu, non da dove passa la pista.
  const curvePenalty = slidePenalty;

  // NESSUN EFFETTO DELLA CORSIA SULLA VELOCITÀ. Né rallentamento né spinta: la
  // corsia decide dove passi, non quanto avanzi. Ci abbiamo provato in tutti i
  // modi — con un fattore basso sembrava un risucchio, con quello geometricamente
  // esatto diventava una scorciatoia — e la risposta giusta è che quel
  // moltiplicatore non ci deve essere. Un metro percorso vale un metro, dovunque
  // tu sia sulla pista. Il vantaggio della corda resta quello vero: fai meno
  // strada perché la curva è più corta, non perché il gioco ti regala qualcosa.
  // Il cavallo si muove nella direzione dell'heading; il moto viene proiettato
  // sulla pista in avanzamento (progress) e spostamento laterale (lane).
  // Accelerazione graduale alla partenza: 0 → piena in 4 secondi (no "scoppio").
  player.launchRamp = Math.min(1, (player.launchRamp ?? 1) + dt / 4 * (player.sprint || 1));
  const travel = player.travelSpeed * curvePenalty * dt * RACE_SPEED_MULT * player.launchRamp;
  const fwdX = Math.sin(player.heading);
  const fwdZ = Math.cos(player.heading);
  const alongTrack = fwdX * sample.tangent.x + fwdZ * sample.tangent.z; // cos(dev)
  const acrossTrack = fwdX * sample.normal.x + fwdZ * sample.normal.z;  // sin(dev)
  const prevLane = player.lane;
  player.progress += travel * alongTrack * jkTerzoMult(player) * tierSpeedMult(player) * (player.balanceMult || 1) * (player.scosso ? SCOSSO_MULT : 1) * (player.cadutoMult ?? 1) * nerbSlowMult(player) * leaderBrakeMult(player) * lastBoostMult(player) * accordiSpeedMult(player) * playerThirdLapHandicap(player) * playerPositionHandicap(player) * mossaSpeedMod(player) * playerFirstLapMult(player) * ultime3Mult(player);
  player.lane += travel * acrossTrack;
  player.laneVelocity = (player.lane - prevLane) / Math.max(dt, 0.001);

  // Il muro ESTERNO (lane negativa = palchi/materassi) segue il profilo di
  // larghezza: negli imbuti ti viene incontro. L'interno (colonnini) è fisso.
  // 10,9 come le AI: era rimasto a 10,85 quando abbiamo alzato il loro.
  const edge = TRACK_HALF_WIDTH - 0.6;
  const edgeOut = edge - trackNarrowAt(positiveMod(player.progress, track.length || 1));
  if (player.lane > edge || player.lane < -edgeOut) {
    // Urto sullo steccato (interno o materassi): se ci arrivi di traverso forte,
    // rischi la caduta (impatto dalla velocità laterale al momento del contatto).
    riskFall(player, fallImpactFromLaneVel(player.laneVelocity), "steccato");
    player.lane = clamp(player.lane, -edgeOut, edge);
    registraPuntoTraccia(player);   // la linea che tiene finisce nella traccia di questo palio
    // NIENTE RADDRIZZAMENTO. Qui il gioco riportava il muso sulla tangente della
    // pista ogni volta che sfioravi lo steccato: è il "colonnino che ti tira verso
    // di sé". Appena lo toccavi in curva restavi incollato — ogni tentativo di
    // staccarti veniva annullato nel frame successivo, perché il muso tornava
    // parallelo al muro. Adesso resti dove ti porta il tuo sterzo: se vuoi
    // staccarti dal colonnino, giri e ti stacchi.
    // NIENTE ATTRITO. Quel "filo di velocità" era 0.995 applicato a OGNI
    // FOTOGRAMMA: a 60 al secondo diventa −26% dopo un secondo di sfregamento e
    // −45% dopo due. Tenere la corda contro il colonnino spegneva il cavallo, ed
    // era l'ultimo rallentamento nascosto legato all'andare interni. Rimosso: la
    // corsia non tocca la velocità, né in un senso né nell'altro.
    if (Math.random() < dt * 4) emitDust(player);
  }

  if (curve > 0.45 && speedPressure > 0.5 && Math.random() < dt * 9) {
    emitDust(player);
  }
  if ((player.braking || player.staminaLimited) && Math.random() < dt * 7) {
    emitDust(player);
  }
  if (player.staminaLimited && state.messageTimer <= 0 && Math.random() < dt * 1.2) {
    showMessage("Stanco: rendimento ridotto", 0.7, "danger");
  }
  if (state.messageTimer <= 0 && Math.abs(headingDev) > 0.7 && curve > 0.3 && Math.random() < dt * 2.2) {
    showMessage("Stai andando largo: sterza in curva", 0.55, "danger");
  }
  recordPlayerLine(player); // memorizza la tua traiettoria per le AI
  placeHorse(player, time);

  if (player.progress >= track.length * FINISH_LAPS && !player.finishTime) {
    player.finishTime = state.raceClock;   // l'arrivo è gestito centralmente in updateRace
  }
}

// Bravura di TRAIETTORIA delle AI in base alla difficoltà (0..1). È l'unica
// cosa che cambia fra Principiante/Normale/Esperto: più è alta, più le AI
// tagliano stretto sull'apice delle curve e sbagliano di meno la linea.
function aiLineSkill() {
  return state.difficulty === "easy" ? 0.28 : state.difficulty === "hard" ? 1.0 : 0.6;
}

// Finalità accordo "Lasciami vincere": l'alleato (AI) che è DAVANTI al beneficiario
// nell'ultimo giro rallenta un filo per farsi superare e lasciarlo vincere.
function letWinMult(horse) {
  const lastLap = (horse.progress || 0) >= track.length * (FINISH_LAPS - 1);
  // Corruzione "Non provare a vincere": nell'ultimo giro rallenta (non deve vincere).
  if (horse.corruptPerdi && lastLap) return 0.9;
  if (!horse.objLetWin || !horse.allyBeneficiaryId) return 1;
  if (!lastLap) return 1;                                                     // solo ultimo giro
  const ben = state.horses.find((o) => o.id === horse.allyBeneficiaryId);
  if (!ben || ben.scosso || ben.caduto || ben.finishTime) return 1;
  if ((horse.progress || 0) <= (ben.progress || 0) + 1.5) return 1;          // già dietro: corri normale
  return 0.9;                                                                // davanti: rallenta per farti superare
}
function updateAiHorse(horse, dt, time) {
  // In gara il cavallo del giocatore lo guida updatePlayer. MA a palio FINITO
  // (mode "finished") lo lasciamo correre in autopilota così non si ferma sul
  // posto: prosegue galoppando fino in fondo, anche sullo sfondo dei risultati.
  if (horse.player && !horse.autopilot && state.mode !== "finished") return;   // autopilot (ASSISTI): guidato come un'AI
  if (horse.launching) return; // ritardo di reazione individuale al via
  // Partito storto: si raddrizza per gradi galoppando (~1.5s), non di scatto.
  if (horse.raceTurn) horse.raceTurn *= Math.max(0, 1 - dt * 1.1);
  const player = getPlayer();
  // ── AI: NERBATA IN GARA. Con munizioni e cadenza pronta, ogni tanto (in base
  // all'AGGRESSIVITÀ del fantino) frusta un cavallo accanto per rallentarlo —
  // molto più spesso se è un RIVALE. Stessa arma/regole del giocatore.
  if (state.mode === "race" && puoNerbare(horse) && (horse.nerbate ?? 0) > 0 && (horse.nerbataCd || 0) <= 0) {
    // ── MOLESTATORE (fino a palio 9000): quando è ACCANTO al GIOCATORE parte una
    // RAFFICA di 3-4 nerbate di fila (una a ogni ricarica), soprattutto la RIVALE.
    horse.harassCd = Math.max(0, (horse.harassCd || 0) - dt);
    const plAccanto = player && !player.finishTime && horse !== player && !player.scosso && !player.caduto
      && Math.abs((player.progress || 0) - (horse.progress || 0)) < 3.2
      && Math.abs((player.lane || 0) - (horse.lane || 0)) < 3.4;
    if (plAccanto && aggroVsPlayerActive() && (horse.harassLeft || 0) <= 0 && (horse.harassCd || 0) <= 0 && !horse.friendlyToPlayer) {
      const vsRiv = rivalIntensity(horse.id, player.id) > 0 || rivalIntensity(player.id, horse.id) > 0;
      if (Math.random() < dt * (vsRiv ? 0.55 : 0.12)) horse.harassLeft = 3 + (Math.random() < 0.5 ? 1 : 0);   // 3-4 colpi
    }
    if ((horse.harassLeft || 0) > 0 && plAccanto) {
      horse.harassLeft -= 1;
      if (horse.harassLeft <= 0) horse.harassCd = 12;   // pausa prima di un'altra raffica
      tiraNerbata(horse, Math.sign((player.lane || 0) - (horse.lane || 0)) || 1, "race", player);
    } else {
      if ((horse.harassLeft || 0) > 0 && !plAccanto) horse.harassLeft = 0;   // giocatore sfilato: raffica finita
      const dx = vicinoDiLato(horse, 1, "race");
      const sx = vicinoDiLato(horse, -1, "race");
      if (dx || sx) {
        const bestCand = dx && sx
          ? (rivalIntensity(horse.id, dx.id) >= rivalIntensity(horse.id, sx.id) ? dx : sx)
          : (dx || sx);
        const rivalBonus = rivalIntensity(horse.id, bestCand.id) > 0 ? 2.4 : 1;
        if (Math.random() < dt * (0.10 + (horse.aggression || 0.5) * 0.35) * rivalBonus) {
          tiraNerbata(horse, bestCand === dx ? 1 : -1, "race");
        }
      }
    }
  }
  const sample = sampleAt(horse.progress);
  const ls = aiLineSkill();
  // Andatura effettiva dell'AI in questo punto pista: copia la TUA andatura
  // registrata (log idealAndatura), limitata dalla stamina della singola AI.
  // Usata sia per la velocità sia per la larghezza dell'apice in curva.
  const bkV = idealLineBucket(horse.progress);
  const aiMaxByStamina = getMaxAllowedSpeedByStamina(horse.stamina, horse.staminaMax); // 1..5
  const recA = state.idealAndatura ? state.idealAndatura[bkV] : null;
  const aiAndatura = firstLapCapAndatura(horse, recA != null ? clamp(Math.round(recA), 1, aiMaxByStamina) : aiMaxByStamina);
  // Fase nella curva: la curvatura che CRESCE = ENTRATA (stringi all'interno),
  // che CALA = USCITA (allarga). cornerPhase: +1 entrata … −1 uscita … 0 fuori curva.
  const curveRate = (sample.curve - (horse.cornerCurvePrev ?? sample.curve)) / Math.max(dt, 0.001);
  horse.cornerCurvePrev = sample.curve;
  horse.cornerPhase = lerp(horse.cornerPhase ?? 0, clamp(curveRate * 1.2, -1, 1), clamp(dt * 6, 0, 1));
  // USCITA LARGA ESTESA: superato l'apice (curva alta che cala), il cavallo "corre
  // largo" verso lo steccato esterno e ci resta ~1.6s anche sul rettilineo che
  // segue, poi rientra sulla linea. È così che l'uscita risulta MOLTO larga.
  if (sample.curve > 0.42 && curveRate < -0.04) horse.exitWide = 1.0;
  horse.exitWide = Math.max(0, (horse.exitWide || 0) - dt / 1.6);
  horse.mistakeCooldown -= dt;
  horse.mistakeTimer = Math.max(0, horse.mistakeTimer - dt);

  // ── TRAIETTORIA (qui si gioca la difficoltà) ──────────────────────────────
  // Errori di linea in curva: tanto più rari e piccoli quanto più alta è la
  // difficoltà. A livello Esperto le AI quasi non sbagliano la traiettoria.
  if (horse.mistakeCooldown <= 0 && sample.curve > 0.42 && Math.random() < 0.34 * (1 - ls * 0.9)) {
    horse.mistakeTimer = 0.4 + Math.random() * 0.7;
    horse.mistakeCooldown = 3.2 + Math.random() * 4;
    horse.targetLane += (Math.random() - 0.5) * 2.4 * (1 - ls * 0.6);
  }

  // ── LINEA DI CORSA ────────────────────────────────────────────────────────
  // Ovunque le AI COPIANO la tua linea registrata (idealLine): guidando gliela
  // insegni. Il cap duro di velocità (più sotto) impedisce solo di girare più
  // stretto di quanto l'andatura consenta. Se non c'è ancora registrazione, in
  // curva usano un default: interno in entrata, MOLTO largo in uscita.
  {
    const innerSign = -Math.sign(sample.normal.dot(campoOutward(sample.point)) || 1);
    const inCurve = sample.curve > 0.18;
    const rec = state.idealLine ? state.idealLine[idealLineBucket(horse.progress)] : null;
    let lineGoal;
    if (rec != null) {
      // Copia la TUA linea (anche in curva) con una PICCOLA variazione personale:
      // offset fisso del cavallo + un lieve ondeggio, così non sono tutti uguali.
      const lineVar = horse.lineBias * 0.9 + Math.sin(time * 0.55 + horse.phase) * 0.3;
      lineGoal = rec + lineVar;
    } else if (inCurve) {
      // Default senza registrazione: apice largo in base alla velocità, e in
      // USCITA (curva che cala) si allarga fin quasi allo steccato esterno.
      const apexSteer = steerMultForCurve(sample.curve, aiAndatura); // 0.27 veloce/largo .. 0.80 piano/stretto
      const maxInner = clamp(lerp(-0.05, 0.82, (apexSteer - 0.27) / 0.53), -0.10, 0.82);
      const cp = horse.cornerPhase ?? 0;           // +1 entrata, −1 uscita
      const inner = cp >= 0 ? maxInner : lerp(maxInner, -0.95, (-cp) * 0.98); // uscita MOLTO larga
      lineGoal = innerSign * TRACK_HALF_WIDTH * inner;
    } else {
      lineGoal = innerSign * AI_LANE_LIMIT * 0.5;  // rettilineo senza registrazione: mezza pista
    }
    // ENTRATA PIÙ LARGA (San Martino e Casato): in AVVICINAMENTO alla curva il
    // cavallo si tiene ~2 corpi più esterno della linea attuale — ingresso più
    // naturale. Il bias svanisce all'apice; l'USCITA resta invariata.
    const aheadCurve = sampleAt(horse.progress + 14).curve || 0;
    if (aheadCurve > 0.42 && (horse.cornerPhase ?? 0) >= -0.1) {
      const entryBlend = clamp((aheadCurve - 0.42) / 0.15, 0, 1) * clamp(1 - sample.curve / 0.5, 0, 1);
      lineGoal += -innerSign * 3.1 * entryBlend;
    }
    // DOPO SAN MARTINO → CASATO: le contrade "casatoWide" (≥6/10) restano ESTERNE
    // (verso −innerSign, cioè sinistra) lungo il rettilineo del Palazzo, così poi
    // possono CHIUDERE STRETTO il Casato (l'apice interno lo fa il resto del sistema,
    // o la linea registrata di Mario Rossi). Rilascia poco prima del Casato.
    if (horse.casatoWide && NARROW_READY && horse.progress > SM_OUT + 3 && horse.progress < CAS_IN - 2) {
      const zin = clamp((horse.progress - (SM_OUT + 3)) / 8, 0, 1);
      const zout = clamp((CAS_IN - 2 - horse.progress) / 8, 0, 1);
      const esterno = -innerSign * TRACK_HALF_WIDTH * 0.72;
      lineGoal = lerp(lineGoal, esterno, 0.75 * zin * zout);
    }
    // USCITA LARGA ESTESA: finché exitWide dura (dopo l'apice, anche sul dritto
    // che segue), tira il bersaglio verso lo steccato esterno.
    const ew = horse.exitWide || 0;
    if (ew > 0.01) {
      const outer = innerSign * TRACK_HALF_WIDTH * -0.85;
      lineGoal = lerp(lineGoal, outer, ew * 0.9);
    }
    // In curva (o mentre corre largo in uscita) imposta il bersaglio diretto, così
    // la linea larga viene raggiunta subito; sul dritto normale insegue morbido.
    if (inCurve || ew > 0.01) horse.targetLane = clamp(lineGoal, -AI_LANE_LIMIT, AI_LANE_LIMIT);
    else horse.targetLane = lerp(horse.targetLane, clamp(lineGoal, -AI_LANE_LIMIT, AI_LANE_LIMIT), clamp(dt * 1.2, 0, 1));
  }

  // ── SORPASSO: cerca la corsia più LIBERA davanti (miglior traiettoria) ──────
  // In mezzo al gruppo il cavallo NON si incolla a chi ha davanti né agli altri:
  // scansiona TUTTA la larghezza della pista e punta alla corsia con più spazio
  // libero davanti, con una leggera preferenza per l'interno (linea più corta) e
  // penalità al cambio (niente zigzag). Così i cavalli si aprono a ventaglio per
  // sorpassare invece di impilarsi/incollarsi. Attivo solo se c'è traffico avanti.
  {
    const ahead = state.horses.filter((o) => o !== horse && !o.launching
      && o.progress > horse.progress - HORSE_BLOCK_LENGTH * 0.4
      && o.progress < horse.progress + HORSE_BLOCK_LENGTH * 5.0);
    if (ahead.length) {
      const innerSign = -Math.sign(sample.normal.dot(campoOutward(sample.point)) || 1);
      const maxAhead = HORSE_BLOCK_LENGTH * 5.0;
      let bestLane = horse.lane, bestScore = -Infinity;
      for (let cand = -AI_LANE_LIMIT; cand <= AI_LANE_LIMIT + 0.01; cand += HORSE_PASS_CLEARANCE * 0.85) {
        // spazio libero davanti in questa corsia
        let clearAhead = maxAhead;
        for (const o of ahead) {
          if (Math.abs(o.lane - cand) < HORSE_PASS_CLEARANCE) {
            const gap = o.progress - horse.progress;
            if (gap > -HORSE_BLOCK_LENGTH * 0.4 && gap < clearAhead) clearAhead = gap;
          }
        }
        const innerBonus = (innerSign * cand / TRACK_HALF_WIDTH) * 1.4; // interno = meglio
        const switchCost = Math.abs(cand - horse.lane) * 0.22;         // non zigzagare
        const score = clearAhead + innerBonus - switchCost;
        if (score > bestScore) { bestScore = score; bestLane = cand; }
      }
      // Va deciso verso la corsia migliore (più svelto se è davvero libera).
      horse.targetLane = lerp(horse.targetLane, clamp(bestLane, -AI_LANE_LIMIT, AI_LANE_LIMIT), clamp(dt * 2.4, 0, 1));
    }
  }

  // ── ANTI-ACCALCAMENTO: in corsa il gruppo NON deve diventare un blocco unico.
  // Ogni cavallo viene spinto di LATO lontano dai vicini stretti (separazione
  // stile boids): la spinta cresce quanto più il vicino è vicino e sparte già
  // prima del contatto, così il pacchetto si apre a ventaglio invece di impilarsi.
  // Attenuata nelle curve strette (dove la traiettoria/linea conta di più).
  {
    let push = 0;
    for (const o of state.horses) {
      if (o === horse || o.launching) continue;
      if (Math.abs(o.progress - horse.progress) > HORSE_BLOCK_LENGTH * 1.7) continue;
      const dl = horse.lane - o.lane;                        // >0 = io più interno del vicino
      const adl = Math.abs(dl);
      const reach = HORSE_PASS_CLEARANCE * 1.5;              // raggio d'azione laterale
      if (adl > reach) continue;
      const closeness = 1 - adl / reach;                    // 0 lontano .. 1 addosso
      push += (dl >= 0 ? 1 : -1) * closeness * closeness;    // via dal vicino (quadratico)
    }
    if (push !== 0) {
      // Se sono schiacciato contro un bordo, scarto verso l'altro lato.
      let dir = Math.sign(push);
      const room = dir > 0 ? AI_LANE_LIMIT - horse.lane : horse.lane + AI_LANE_LIMIT;
      if (room < HORSE_PASS_CLEARANCE) dir = -dir;
      const curveDamp = 1 - clamp(sample.curve / 0.5, 0, 1) * 0.6;   // meno separazione in curva
      horse.targetLane = clamp(
        horse.targetLane + dir * clamp(Math.abs(push), 0, 1.8) * dt * 3.4 * curveDamp,
        -AI_LANE_LIMIT, AI_LANE_LIMIT
      );
    }
  }

  // ── RIVALITÀ IN CORSA (§7): se la rivale è vicina e sta correndo bene
  // (affiancata o appena davanti), la MARCO chiudendole la traiettoria — con
  // intensità alta danneggiarla vale quanto la mia corsa. Solo su rettilineo/
  // curva dolce (in curva stretta comanda la linea), e mai in modo suicida.
  {
    const rMap = RIVALS[horse.id];
    if (rMap && sample.curve < 0.4) {
      let rival = null, rk = 0;
      for (const o of state.horses) {
        const k = rMap[o.id]; if (!k) continue;
        if (horse.friendlyToPlayer && o.player) continue;   // alleato/corrotto: NON marca TE
        const dp = o.progress - horse.progress;         // >0 = rivale davanti
        if (dp > -HORSE_BLOCK_LENGTH * 0.6 && dp < HORSE_BLOCK_LENGTH * 3.2) { rival = o; rk = k; break; }
      }
      if (rival) {
        // scivola sulla corsia della rivale per tagliarle la linea (marcatura)
        horse.targetLane = lerp(horse.targetLane, rival.lane, clamp(dt * 1.5 * rk, 0, 0.5));
        if (rk >= 0.9 && state.messageTimer <= 0 && Math.random() < dt * 0.06) {
          showMessage(`${horse.name} marca ${rival.name}`, 0.9);
        }
      }
    }
  }
  // ── PARA IN CORSA (assisti): l'alleato va DAVANTI alla RIVALE e la frena —
  // accelera per portarsi davanti, poi rallenta per chiuderle la strada (al costo
  // della propria corsa, come da richiesta).
  if (horse.paraInRace && sample.curve < 0.5) {
    const target = state.horses.find((o) => o.id === horse.paraInRace);
    if (target) {
      const dp = target.progress - horse.progress;   // >0 = rivale davanti
      if (dp > -HORSE_BLOCK_LENGTH * 0.4 && dp < HORSE_BLOCK_LENGTH * 4.5) {
        horse.targetLane = lerp(horse.targetLane, target.lane, clamp(dt * 2.2, 0, 0.6));   // sulla sua linea
        if (dp > 0.2) horse.travelSpeed = clamp((horse.travelSpeed || 12) * (1 + dt * 0.9), 0, 18);   // accelera per superarla
        else horse.travelSpeed = clamp((horse.travelSpeed || 12) * Math.pow(0.5, dt), 3, 18);          // già davanti: frena
      }
    }
  }
  // ── ACCORDO IN CORSA: chi ha ricevuto i soldi (allyBeneficiaryId = chi lo paga)…
  //  · se il BENEFICIARIO gli passa accanto → gli FA STRADA: va ESTERNO di ~2 unità;
  //  · se un'ALTRA contrada gli passa accanto → la PARA all'INTERNO (le chiude la
  //    linea interna e non la fa passare).
  //  (+lane = interno/Campo · −lane = esterno/steccato.)
  if (horse.allyBeneficiaryId && horse.objPassa && !horse.scosso && !horse.caduto && sample.curve < 0.55) {
    const passing = state.horses.find((o) => o !== horse && !o.isRincorsa && !o.scosso && !o.caduto
      && Math.abs((o.progress || 0) - (horse.progress || 0)) < HORSE_BLOCK_LENGTH * 1.8
      && Math.abs((o.lane || 0) - (horse.lane || 0)) < 3.5);
    if (passing) {
      if (passing.id === horse.allyBeneficiaryId) {
        // il beneficiario passa → mi sposto ESTERNO (2 unità oltre di lui) per farlo passare
        horse.targetLane = clamp((passing.lane || 0) - 2.0, -AI_LANE_LIMIT, AI_LANE_LIMIT);
      } else {
        // un altro passa → lo PARO all'INTERNO: scivolo sulla sua linea, un filo verso il Campo
        horse.targetLane = lerp(horse.targetLane, (passing.lane || 0) + 0.6, clamp(dt * 2.6, 0, 0.6));
      }
    }
  }

  // ── VELOCITÀ: le AI COPIANO la TUA andatura/velocità registrata ────────────
  // aiAndatura (calcolata in cima) = la tua andatura nel log, limitata dalla
  // stamina della singola AI. La velocità di crociera segue il tuo log di
  // velocità (idealSpeed), senza superare quanto la stamina dell'AI consente.
  // Così rallentano dove rallenti tu e spingono dove spingi tu, ma ognuna cala
  // secondo la propria stamina (±5).
  const staminaRate = getStaminaRateForHorse(horse, aiAndatura);
  horse.stamina = clamp(horse.stamina - staminaRate * dt, 0, horse.staminaMax || STAMINA_MIN_ROLL);
  horse.effectiveSpeedLevel = aiAndatura;
  horse.staminaLimited = aiMaxByStamina < ANDATURA_MAX; // limitata davvero dalla stamina
  const recS = state.idealSpeed ? state.idealSpeed[bkV] : null;
  const staminaCeil = andaturaToSpeed(aiMaxByStamina);
  // Velocità copiata con PICCOLA variazione personale (±4.5%), limitata comunque
  // dalla stamina: chi va un filo più forte, chi un filo più piano.
  const aiCruiseBase = recS != null ? recS : andaturaToSpeed(aiAndatura);
  let aiCruise = clamp(aiCruiseBase * (horse.speedVar || 1), 0, staminaCeil * 1.07);
  // PRIMO GIRO: la crociera segue il tuo log, che NON è per-giro; qui va limitata
  // esplicitamente al tetto del 1° giro (4, o 3 per le due AI contenute).
  if (Math.floor(Math.max(0, horse.progress) / track.length) === 0) {
    aiCruise = Math.min(aiCruise, andaturaToSpeed(horse.firstLapCap || 4));
  }
  if (!horse.travelSpeed) horse.travelSpeed = aiCruise;
  horse.travelSpeed += (aiCruise - horse.travelSpeed) * clamp(dt * 2.25, 0, 1);
  horse.speedLevel += (aiAndatura * 2 - horse.speedLevel) * clamp(dt * 2.25, 0, 1);
  horse.boosting = false;

  // Micro-deviazioni di corsia (nervosismo + pressione in curva), attenuate se
  // la difficoltà è alta (le AI brave restano più ferme sulla linea).
  const curveSide = Math.sign(sample.signedCurve || 0);
  const aiPressure = clamp((horse.speedLevel - 5.2) / 3.6, 0, 1);
  horse.targetLane += curveSide * sample.curve * aiPressure * horse.nerves * dt * 0.42 * (1 - ls * 0.7);
  horse.targetLane += Math.sin(time * (0.55 + horse.skill * 0.35) + horse.phase) * horse.nerves * dt * (0.05 + sample.curve * 0.12) * (1 - ls * 0.6);

  // Partenza: nei primi ~3s ogni cavallo va dritto dalla propria corsia di mossa,
  // senza convergere subito sulla traiettoria ideale (evita il pestone di massa).
  if (horse.startLane !== undefined && horse.launchRamp < 1) {
    const startHold = clamp(1 - horse.launchRamp * 1.3, 0, 1);
    horse.targetLane = lerp(horse.targetLane, horse.startLane, startHold);
  }

  // ── LA LINEA IMPARATA DA UN UMANO ─────────────────────────────────────────
  // Se a questa AI è stata assegnata una corsa di Mario Rossi, la sua corsia
  // viene TIRATA verso quella che teneva lui in questo punto di pista. Non la
  // sostituisce: si mescola a quello che l'AI ha già deciso (marcature, sorpassi,
  // linea di curva), così resta viva ma corre come corre una persona.
  {
    const umana = laneDaTraccia(horse);
    if (umana != null && state.mode === "race") {
      horse.targetLane = lerp(horse.targetLane, umana, clamp(horse.tracciaPeso || 0, 0, 0.95));
      // TETTO DI SCOSTAMENTO. Le decisioni prese qui sopra (sorpasso, marcatura,
      // parata) restano, ma non possono portare l'AI lontano dalla linea che
      // l'umano teneva in questo punto: si sposta per passare o per chiudere, poi
      // rientra. Senza questo tetto, una singola manovra la mandava larga e la
      // traccia non si vedeva più.
      horse.targetLane = clamp(horse.targetLane, umana - TRACCIA_SCOSTO, umana + TRACCIA_SCOSTO);
    }
  }

  // Il limite ESTERNO segue gli imbuti (San Martino/cappella/Casato): dove i
  // palchi entrano, le AI vengono strizzate verso l'interno come il giocatore.
  const aiOuterLim = outerLimitAt(horse.progress);
  horse.targetLane = clamp(horse.targetLane, -aiOuterLim, AI_LANE_LIMIT);
  const previousLane = horse.lane;
  // In curva e durante l'uscita larga insegue la corsia più in fretta.
  const laneFollow = (sample.curve > 0.18 || (horse.exitWide || 0) > 0.01) ? 4.2 : 2.6;
  horse.lane += (horse.targetLane - horse.lane) * clamp(dt * laneFollow, 0, 1);
  horse.lane = clamp(horse.lane, -aiOuterLim, AI_LANE_LIMIT);
  // ── CAP DURO sull'interno in curva, in base alla velocità ──────────────────
  // Garanzia: l'AI non può MAI essere più interna di quanto la sua andatura
  // consenta (stessa tabella di sterzata del giocatore). A tutta andatura, in
  // curva, è costretta larga come te. Risolve il "ritardo" del doppio lerp.
  if (sample.curve > 0.2) {
    const apexSteer = steerMultForCurve(sample.curve, aiAndatura);
    const maxInner = clamp(lerp(-0.05, 0.82, (apexSteer - 0.27) / 0.53), -0.10, 0.82);
    const iSign = -Math.sign(sample.normal.dot(campoOutward(sample.point)) || 1);
    let maxLane = iSign * TRACK_HALF_WIDTH * maxInner;
    // LA TRAIETTORIA UMANA BATTE IL LIMITE TEORICO. Questo tetto teneva le AI
    // larghe in curva in base all'andatura, e annullava qualunque linea interna
    // arrivasse dalle corse registrate: per quanto stretto passasse Mario Rossi,
    // loro venivano riportate fuori. Se in questo punto un umano c'è passato
    // davvero, quella linea è possibile e l'AI può tenerla.
    const umanaCap = laneDaTraccia(horse);
    if (umanaCap != null) {
      maxLane = iSign > 0 ? Math.max(maxLane, umanaCap) : Math.min(maxLane, umanaCap);
    }
    if (iSign > 0 ? horse.lane > maxLane : horse.lane < maxLane) {
      horse.lane += (maxLane - horse.lane) * clamp(dt * 7, 0, 1); // esce in fretta, senza scatto
      horse.lane = clamp(horse.lane, -aiOuterLim, AI_LANE_LIMIT);
    }
  }
  horse.laneVelocity = clamp((horse.lane - previousLane) / Math.max(dt, 0.001), -PLAYER_LANE_VELOCITY_LIMIT, PLAYER_LANE_VELOCITY_LIMIT);
  // Urto sullo steccato/materassi anche per le AI: schiacciata al limite di corsia
  // e arrivata forte di lato (di solito per una spinta/tamponamento) → rischio
  // caduta. Il muro esterno è quello EFFETTIVO degli imbuti: è proprio lì
  // (San Martino coi materassi) che si picchia di più.
  if ((horse.lane >= AI_LANE_LIMIT - 0.06 || horse.lane <= -(aiOuterLim - 0.06)) && Math.abs(horse.laneVelocity) > RAIL_HIT_MIN) {
    riskFall(horse, fallImpactFromLaneVel(horse.laneVelocity), "steccato");
  }

  const curvePenalty = clamp(1 - sample.curve * Math.max(0, horse.speedLevel - 6) * 0.036, 0.7, 1);
  // Accelerazione graduale alla partenza: 0 → piena in 4 secondi (no "scoppio").
  horse.launchRamp = Math.min(1, (horse.launchRamp ?? 1) + dt / 4 * (horse.sprint || 1));
  horse.progress += horse.travelSpeed * curvePenalty * RACE_SPEED_MULT * horse.launchRamp * frenataArrivo(horse) * dt * jkTerzoMult(horse) * tierSpeedMult(horse) * (horse.balanceMult || 1) * (horse.scosso ? SCOSSO_MULT : 1) * (horse.cadutoMult ?? 1) * nerbSlowMult(horse) * leaderBrakeMult(horse) * lastBoostMult(horse) * accordiSpeedMult(horse) * letWinMult(horse) * mossaSpeedMod(horse) * ultime3Mult(horse);
  if ((horse.speedLevel > 5.55 || horse.staminaLimited) && Math.random() < dt * 0.52) {
    emitDust(horse);
  }
  if (!horse.finishTime && horse.progress >= track.length * FINISH_LAPS) {
    horse.finishTime = state.raceClock;
  }
  // Dopo il traguardo l'andatura segue la velocità VERA: scala insieme a lei e
  // resta di galoppo finché il cavallo corre ancora.
  if (horse.finishTime) {
    const fA = frenataArrivo(horse);
    horse.speedLevel = Math.max(fA > 0.02 ? 3.6 : 0, (horse.speedLevel || 0) * fA);
  }
  placeHorse(horse, time);
}

// (Le collisioni di gara sono in resolveHorsePair/resolveRaceCollisions.)

function updateRace(dt, time) {
  state.raceClock += dt;
  recordReplayFrame(dt);   // registra le posizioni per il replay dell'ultimo giro
  // RUNOUT: dopo l'arrivo il campo prosegue oltre la linea per ~1.7s (frame in
  // più per il replay), poi si chiude la gara e si mostra la vincitrice.
  if ((state.raceRunout || 0) > 0) {
    state.raceRunout -= dt;
    if (state.raceRunout <= 0) { finishRace(); return; }
  }
  state.horses.forEach((horse) => {
    horse.prevProgress = horse.progress;
    if (horse.fallCd > 0) horse.fallCd -= dt;   // cooldown fra due "tiri" di caduta
    // ── CAVALLO A TERRA: frena a zero in ~0.3s, resta giù, poi si rialza e
    // riparte (scosso) riprendendo velocità con calma. cadutoRoll = coricamento
    // visivo sul fianco, applicato in placeHorse sopra il roll normale.
    if (horse.caduto) {
      horse.cadutoTimer -= dt;
      // SCIVOLATA: mentre va giù vola in AVANTI e verso l'ESTERNO (sinistra),
      // decelerando in ~1.2s. Il moto normale è azzerato (cadutoMult 0): a
      // muoverlo è solo lo slancio della caduta, non le gambe.
      horse.cadutoSlide = Math.max(0, (horse.cadutoSlide ?? 0) - dt * 8);
      if (horse.cadutoSlide > 0) {
        horse.progress += horse.cadutoSlide * dt;
        const limScivolo = outerLimitAt(horse.progress);
        horse.lane = clamp(horse.lane - horse.cadutoSlide * dt * 0.55, -limScivolo, AI_LANE_LIMIT);
        horse.targetLane = horse.lane;
      }
      horse.cadutoMult = 0;
      horse.cadutoRoll = lerp(horse.cadutoRoll || 0, 1.25 * (horse.cadutoDir || 1), clamp(dt * 5, 0, 1));
      horse.speedLevel = 0;                      // gambe ferme: è per terra
      if (horse.cadutoTimer <= 0) horse.caduto = false;   // si rialza
    } else if (horse.cadutoRoll) {
      horse.cadutoRoll = lerp(horse.cadutoRoll, 0, clamp(dt * 2.5, 0, 1));
      if (Math.abs(horse.cadutoRoll) < 0.03) horse.cadutoRoll = 0;
      horse.cadutoMult = Math.min(1, (horse.cadutoMult ?? 1) + dt * 0.8);
    } else if ((horse.cadutoMult ?? 1) < 1) {
      horse.cadutoMult = Math.min(1, horse.cadutoMult + dt * 0.8);
    }
    // TERZO GIRO: bonus/malus di stamina UNA VOLTA all'ingresso nell'ultimo giro
    // (es. Violenta da Clodia +2). Rincara il fiato per l'ultima tornata.
    // FRENO provvisorio: se corre Brio, +10 di stamina al 3° giro (silenzioso).
    let tgBonus = horse.terzoGiroStamina || 0;
    if (horse.jockey && horse.jockey.nick === "Brio" && frenoAttivo("brioStamina")) tgBonus += 10;
    if (horse.id === "istrice" && !isHuman(horse) && frenoAttivo("istriceStamina")) tgBonus += 10;   // Istrice AI
    if (tgBonus && !horse.terzoGiroDone
        && (horse.progress || 0) >= track.length * (FINISH_LAPS - 1)) {
      horse.terzoGiroDone = true;
      horse.staminaMax = Math.max(5, (horse.staminaMax || 0) + tgBonus);
      horse.stamina = Math.max(5, (horse.stamina || 0) + tgBonus);
    }
  });

  // ── Ritardo di reazione al via ─────────────────────────────────────────
  // Chi ha launchDelay resta quasi fermo (decelera) per la sua frazione di
  // secondo, poi scatta. Viene saltato dall'update normale finché "launching".
  state.horses.forEach((horse) => {
    if (!horse.launching) return;
    horse.launchDelayTimer -= dt;
    horse.speedLevel *= (1 - clamp(dt * 4.0, 0, 1));
    if (horse.launchDelayTimer <= 0) {
      horse.launching = false;
    } else {
      placeHorse(horse, time);
    }
  });

  // ── Dissolvenza del canapo posteriore (verrocchino) dopo 5s ────────────
  if (state.canapiDropTimer > 0) {
    state.canapiDropTimer -= dt;
    const group = state.canapiPosteriore;
    if (group && group.visible) {
      if (state.canapiDropTimer <= 0.8) {
        const fade = clamp(state.canapiDropTimer / 0.8, 0, 1);
        group.traverse((obj) => {
          if (obj.material && obj.material.transparent) obj.material.opacity = fade;
        });
      }
      if (state.canapiDropTimer <= 0) group.visible = false;
    }
  }

  state.horses.forEach((h) => { if (h.mossaModTimer > 0) h.mossaModTimer -= dt; });   // asta: scala i boost/malus temporanei della mossa
  const preRanking = getRanking();
  state.currentLeader = preRanking[0] || null;
  state.currentLast = preRanking[preRanking.length - 1] || null;
  // RUBBER-BAND: fotografo a INIZIO frame chi è 1°, la posta del 2° e le due Contrade
  // in coda (posizioni stabili, indipendenti dall'ordine di aggiornamento) →
  // leaderBrakeMult frena il primo, lastBoostMult spinge le ultime due.
  state.leaderBrakeId = preRanking[0] ? preRanking[0].id : null;
  state.leaderBrakeSecondProg = preRanking[1] ? preRanking[1].progress : null;
  state.secondBrakeId = preRanking[1] ? preRanking[1].id : null;         // freno anche il 2°…
  state.secondBrakeThirdProg = preRanking[2] ? preRanking[2].progress : null;  // …sul distacco dal 3°
  state.leaderBrakeLeaderProg = preRanking[0] ? preRanking[0].progress : null;
  const nP = preRanking.length;
  state.lastBoostIds = nP >= 2 ? [preRanking[nP - 1].id, preRanking[nP - 2].id] : [];
  state.ultime3Ids = preRanking.slice(Math.max(0, nP - 3)).map((h) => h.id);   // +0,01 fisso alle ultime tre
  updatePlayer(dt, time);
  state.horses.forEach((horse) => updateAiHorse(horse, dt, time));
  resolveRaceCollisions(dt);
  // ── MOLLE RIMOSSE (richiesta utente): niente più richiami elastici del primo
  // (muro 1°–2° a 30 e muro 1°–3° ≤9). Si vedevano come inchiodate. Al loro posto
  // c'è SOLO il rallentatore graduale di leaderBrakeMult, basato sul gap dal 3°.

  // ── LIMITE SORPASSI: vale SOLO PER IL GIOCATORE ───────────────────────────
  // Max 3 sorpassi fatti e 3 subìti per giro, e solo lui: fra AI la corsa è
  // libera. Applicandolo a tutti si formavano trenini di Contrade incollate a
  // trenta centimetri l'una dall'altra e il gruppo non si allungava mai.
  // A ogni inizio giro si fotografa la posizione in classifica; chi ha già
  // guadagnato/perso 3 posizioni nel giro non passa (né si fa passare) oltre:
  // resta "in scia" al vicino (progress limitato appena dietro), niente inchiodata.
  // ECCEZIONE: dentro San Martino (SM_IN..SM_OUT) e Casato (CAS_IN..CAS_OUT) nessun
  // limite — lì fra cadute e sorpassi interni si passa/viene passati liberamente.
  if ((state.raceClock || 0) > 8) {
    const rk = getRanking();
    const MARGINE = 0.30;   // spazio in scia: alzato da 0.15 → trenini meno rigidi sui rettilinei
    const startIdx = {};
    const lapRef = Math.floor(Math.max(0, (rk[0] && rk[0].progress) || 0) / (track.length || 1));
    rk.forEach((h, i) => {
      if (!h) return;
      if (h._lapOvertake !== lapRef) { h._lapOvertake = lapRef; h._rankLapStart = i; }  // foto UNICA per tutti
      startIdx[h.id] = h._rankLapStart ?? i;
    });
    const inCurvaLibera = (prog) => {
      if (!NARROW_READY) return false;
      const p = positiveMod(prog, track.length || 1);
      // RISTRETTA: libera solo il CUORE centrale di ogni curva (~50%), non tutto lo
      // span. 25% di margine per lato → entrata e uscita tornano sotto il limite.
      const smI = (SM_OUT - SM_IN) * 0.25;
      const casI = (CAS_OUT - CAS_IN) * 0.25;
      return (p >= SM_IN + smI && p <= SM_OUT - smI) || (p >= CAS_IN + casI && p <= CAS_OUT - casI);
    };
    const bloccabile = (h) => h && !h.finishTime && !h.caduto && !h.scosso && !h.isRincorsa && !inCurvaLibera(h.progress);
    for (let i = 0; i < rk.length - 1; i += 1) {
      const A = rk[i], B = rk[i + 1];                 // A davanti, B dietro
      if (!bloccabile(A) || !bloccabile(B)) continue;
      // Il limite riguarda SOLO il giocatore: o è lui che sta per passare, o è lui
      // che sta per essere passato. Fra due AI non si blocca niente.
      if (!isHuman(A) && !isHuman(B)) continue;
      const bGained = startIdx[B.id] - (i + 1);       // posizioni guadagnate da B nel giro
      const aLost = i - startIdx[A.id];               // posizioni perse da A nel giro
      // Si conta solo quello che riguarda lui: i suoi sorpassi se è dietro, quelli
      // che subisce se è davanti.
      const troppiFatti  = isHuman(B) && bGained >= 3;
      const troppiSubiti = isHuman(A) && aLost >= 3;
      if (troppiFatti || troppiSubiti) {
        const cap = A.progress - MARGINE;             // B resta in scia ad A, non lo passa
        if (B.progress > cap) {
          // rientro GRADUALE (non uno stop secco): si recupera una frazione
          // dell'eccesso per frame, così non si vede nessuna frenata innaturale.
          B.progress -= (B.progress - cap) * clamp(dt * 3.0, 0, 0.5);
          placeHorse(B, time);
        }
      }
    }
  }

  // ── INCIDENTE DI SAN MARTINO (se sorteggiato alla partenza) ────────────────
  // Al PRIMO passaggio in curva: delle tre AI di testa, la più ESTERNA stringe
  // e le fa battere → maxi-caduta con catena sulle attaccate. La finestra di
  // progress (SM_IN..SM_OUT senza modulo) esiste solo al 1° giro.
  // FRENO SILENZIOSO su BRUCO (AI): va dritto a San Martino e CADE. Per ~1000 palii,
  // nessun avviso a schermo. Solo se Bruco non è il giocatore e non è già a terra.
  if (brucoFallActive() && NARROW_READY) {
    const bru = state.horses.find((h) => h.id === "bruco" && !isHuman(h) && !h.isRincorsa
      && !h.scosso && !h.caduto && h.progress > SM_IN + 2 && h.progress < SM_OUT + 2);
    if (bru) {
      bru.lane = Math.min(bru.lane, -(AI_LANE_LIMIT * 0.6));   // va largo/dritto verso l'esterno (non taglia la curva)
      bru.targetLane = bru.lane;
      triggerHorseFall(bru);                                   // e cade — silenzioso, niente showMessage
    }
  }
  if (state.sanMartinoIncident && !state.sanMartinoIncidentDone && NARROW_READY) {
    const inCurva = state.horses.filter((h) => !h.scosso && !h.caduto && !h.isRincorsa
      && h.progress > SM_IN + 2 && h.progress < SM_OUT + 4);
    const ai = inCurva.filter((h) => !isHuman(h)).sort((a, b) => b.progress - a.progress);
    if (ai.length >= 3) {
      state.sanMartinoIncidentDone = true;
      const tre = ai.slice(0, 3);
      const esterna = tre.reduce((m, h) => (h.lane < m.lane ? h : m), tre[0]);
      const altre = tre.filter((h) => h !== esterna);
      showMessage(`San Martino: ${esterna.name} stringe la curva — INCIDENTE!`, 3.2, "danger");
      maxiCaduta(esterna, altre[0]);                       // catena sulle attaccate, giocatore incluso
      if (altre[1] && !altre[1].caduto) triggerHorseFall(altre[1]);
      state.cameraShake = Math.max(state.cameraShake || 0, 0.8);
    }
  }

  // FRENO PROVVISORIO: nei prossimi 10 palii il fantino TEMPESTA cade a San Martino
  // (se è in gara). Una volta per palio (guardia tempestaFellDone).
  if (frenoAttivo("tempestaFall") && !state.tempestaFellDone && NARROW_READY) {
    const t = state.horses.find((h) => !h.isRincorsa && !h.scosso && !h.caduto
      && h.jockey && h.jockey.nick === "Tempesta"
      && h.progress > SM_IN + 2 && h.progress < SM_OUT + 4);
    if (t) {
      state.tempestaFellDone = true;
      // Nessun messaggio dedicato: dev'essere indistinguibile da una caduta normale
      // (triggerHorseFall mostra già gli effetti di una caduta qualsiasi).
      triggerHorseFall(t);
      state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
    }
  }
  // FRENO PROVVISORIO: nei prossimi 70 palii anche GRIDO cade a San Martino (silenzioso).
  if (frenoAttivo("gridoFall") && !state.gridoFellDone && NARROW_READY) {
    const g = state.horses.find((h) => !h.isRincorsa && !h.scosso && !h.caduto
      && h.jockey && h.jockey.nick === "Grido"
      && h.progress > SM_IN + 2 && h.progress < SM_OUT + 4);
    if (g) {
      state.gridoFellDone = true;
      triggerHorseFall(g);
      state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
    }
  }
  // FRENO: la TARTUCA, quando è guidata da un'AI (non il giocatore), cade battendo a
  // San Martino ogni palio, fino al palio 630 (silenzioso).
  if (frenoAttivo("tartucaFall") && !state.tartucaFellDone && NARROW_READY) {
    const tt = state.horses.find((h) => h.id === "tartuca" && !h.isRincorsa && !h.scosso && !h.caduto
      && !isHuman(h) && h.progress > SM_IN + 2 && h.progress < SM_OUT + 4);
    if (tt) {
      state.tartucaFellDone = true;
      triggerHorseFall(tt);
      state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
    }
  }
  // FRENO: la GIRAFFA, quando è guidata da un'AI, cade battendo al CASATO ogni palio,
  // fino al palio 880 (silenzioso).
  if (frenoAttivo("giraffaFall") && !state.giraffaFellDone && NARROW_READY) {
    const gf = state.horses.find((h) => h.id === "giraffa" && !h.isRincorsa && !h.scosso && !h.caduto
      && !isHuman(h) && h.progress > CAS_IN + 2 && h.progress < CAS_OUT + 4);
    if (gf) {
      state.giraffaFellDone = true;
      triggerHorseFall(gf);
      state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
    }
  }
  // FRENO: DRAGO e SELVA, quando guidate da un'AI, cadono a San Martino, fino al palio
  // 1396 (silenzioso). Niente guardia: triggerHorseFall le rende caduto → non rientrano.
  if (frenoAttivo("dragoSelvaFall") && NARROW_READY) {
    state.horses.forEach((h) => {
      if ((h.id === "drago" || h.id === "selva") && !h.isRincorsa && !h.scosso && !h.caduto && !isHuman(h)
          && h.progress > SM_IN + 2 && h.progress < SM_OUT + 4) {
        triggerHorseFall(h);
        state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
      }
    });
  }

  // MORTARETTO ANTICIPATO: i 3 scoppi (fine.m4a) devono esplodere quando la contrada
  // in testa è a 3 unità dall'arrivo, NON al taglio (arrivavano in ritardo). Parte una
  // volta sola (guardia mortarettoFired); presentVictory poi non lo rispara.
  if (!state.mortarettoFired) {
    // Un secondo pieno prima: a velocità di gara sono ~11 unità, quindi 14 invece
    // di 3. Lo scoppio deve arrivare mentre il vincitore sta ancora spingendo, non
    // quando ha già tagliato.
    const sogliaScoppio = track.length * FINISH_LAPS - 14;
    if (state.horses.some((h) => !h.isRincorsa && (h.progress || 0) >= sogliaScoppio)) {
      state.mortarettoFired = true;
      try { playPalioSound("fine.m4a", { volume: 0.7, cap: 0.7 }); } catch (e) { /* niente */ }
    }
  }

  // Il VINCITORE ha tagliato per primo → premiazione (il "Passo a Vittoria"). Il runout
  // tiene viva la registrazione per il replay e lascia il campo proseguire oltre la
  // linea (nessuno si blocca sul traguardo).
  if (!state.victoryShown && state.horses.some((horse) => horse.finishTime)) {
    state.raceRunout = 5.0;   // chi prosegue fino a 60 unita' ci mette di piu' a scalare
    presentVictory();
  }

  updateRaceAnnouncements(dt);
}

// Annunci drammatici dinamici. Ogni trigger ha un debounce (flag/stato) e si
// azzera a inizio gara in releaseRace.
function updateRaceAnnouncements(dt) {
  const player = getPlayer();
  if (!player || player.finishTime) return;
  const ann = state.announce;
  const ranking = getRanking();
  const playerRank = ranking.indexOf(player) + 1;

  if (ann.prevRank === 2 && playerRank === 1) {
    showMessage("🏆 IN TESTA!", 1.2, "good");
  } else if (ann.prevRank === 1 && playerRank === 2) {
    showMessage("Superato! Recupera!", 1.0, "danger");
  }
  ann.prevRank = playerRank;

  const inLastLap = player.progress > track.length * 2;
  if (!ann.lastLap && inLastLap) {
    ann.lastLap = true;
    state.cameraShake = Math.max(state.cameraShake, 0.25);
    showMessage("⚡ ULTIMO GIRO — dai tutto!", 1.6, "good");
  }

  if (!ann.finishNear && player.progress >= track.length * FINISH_LAPS - 15) {
    ann.finishNear = true;
    showMessage("Il traguardo è vicino!", 1.0, "good");
  }

  // Testa a testa nell'ultimo giro: si riarma quando il distacco torna ampio.
  if (inLastLap && ranking.length > 1) {
    const second = ranking[0] === player ? ranking[1] : ranking[0];
    const gap = Math.abs(player.progress - second.progress);
    if (gap < 2.5 && !ann.headToHead && state.messageTimer <= 0) {
      ann.headToHead = true;
      showMessage("Testa a testa!", 0.8, "good");
    } else if (gap > 3.5) {
      ann.headToHead = false;
    }
  }
}

// ── CADUTE ───────────────────────────────────────────────────────────────────
// Durante la corsa un URTO FORTE — sullo steccato (batte interno o sui materassi)
// o un tamponamento troppo violento sulla Contrada davanti — può disarcionare il
// fantino. Probabilità = base(CURVA del fantino) × entità dell'impatto (0..1):
// curva 5 → base 10%, curva 1 → 90%. Poi il cavallo prosegue SCOSSO, più lento.
const SCOSSO_MULT = 0.97;         // velocità del cavallo scosso vs col fantino
const RAIL_HIT_MIN = 2.6;         // velocità laterale minima perché sia un "urto"
const RAIL_HIT_RANGE = 4.2;       // oltre MIN+RANGE l'impatto è massimo (1)
function fallImpactFromLaneVel(v) { return clamp((Math.abs(v) - RAIL_HIT_MIN) / RAIL_HIT_RANGE, 0, 1); }
function riskFall(horse, impact, cause, other) {
  if (!horse || horse.scosso || state.mode !== "race") return;   // solo IN CORSA, non già scossi
  if ((state.raceClock || 0) < 3) return;                         // NON nei primi 3 secondi
  if ((horse.fallCd || 0) > 0) return;                            // un tiro di dado per volta
  if ((sampleAt(horse.progress).curve || 0) < 0.2) return;        // si cade SOLO in curva
  const imp = clamp(impact, 0, 1);
  if (imp < 0.12) return;                                         // urto troppo lieve: niente rischio
  horse.fallCd = 1.6;
  const curva = (horse.jockey && horse.jockey.curva) || 3;
  const base = clamp(0.9 - (curva - 1) * 0.2, 0.1, 0.9);          // curva 1→.9 · 3→.5 · 5→.1
  if (Math.random() < base * imp) {
    // IMPATTO GRANDE in curva: può andare giù ANCHE IL CAVALLO, non solo il
    // fantino. E se è DAVVERO grande, coinvolge due Contrade e siamo alla PRIMA
    // curva (metà del 1° giro; qui siamo già in curva per il check sopra) →
    // MAXI-CADUTA: si porta a terra anche le attaccate all'esterno.
    const primaCurva = (horse.progress || 0) < track.length * 0.5;
    if (imp >= PILEUP_IMPACT && other && !other.scosso && primaCurva) maxiCaduta(horse, other);
    else if (imp >= HORSE_DOWN_IMPACT && Math.random() < HORSE_DOWN_CHANCE) triggerHorseFall(horse);
    else triggerFall(horse, { other });   // lato di caduta: opposto al cavallo che ha urtato
  }
}

// ── CADUTA ROVINOSA: VA GIÙ ANCHE IL CAVALLO ────────────────────────────────
// Oltre HORSE_DOWN_IMPACT il cavallo può finire A TERRA col fantino: si ferma,
// resta giù qualche secondo, poi si rialza e prosegue SCOSSO. Con un impatto
// PILEUP (davvero grande) fra due Contrade alla prima curva scatta la maxi-caduta.
const HORSE_DOWN_IMPACT = 0.62;   // da qui in su il cavallo rischia di cadere
const HORSE_DOWN_CHANCE = 0.5;    // …con questa probabilità (il fantino cade comunque)
const PILEUP_IMPACT = 0.85;       // impatto "davvero grande" → maxi-caduta a catena
const HORSE_DOWN_TIME = 4.6;      // secondi a terra prima di rialzarsi

// GARANZIA anti-ecatombe: per quanto grossa sia una caduta a catena, almeno
// MIN_A_CAVALLO fantini restano SEMPRE in sella (prima capitava che cadessero
// tutti e 10). Un fantino "a cavallo" = né scosso (disarcionato) né a terra.
const MIN_A_CAVALLO = 4;
function fantiniACavallo() {
  return state.horses.filter((h) => !h.scosso && !h.caduto).length;
}

function triggerHorseFall(horse) {
  if (!horse || horse.caduto) return;
  if (horse.id === "istrice" && !isHuman(horse) && frenoAttivo("istriceNoFall")) return;  // Istrice AI immune
  if (fantiniACavallo() <= MIN_A_CAVALLO && !horse.scosso) return;   // tieni almeno MIN_A_CAVALLO in sella
  triggerFall(horse);                          // il fantino è già per terra (no-op se scosso)
  horse.caduto = true;
  horse.cadutoTimer = HORSE_DOWN_TIME + Math.random() * 1.6;
  horse.cadutoDir = Math.random() < 0.5 ? -1 : 1;
  // SCIVOLATA: il cavallo non si inchioda sul posto — VOLA in avanti e verso
  // l'ESTERNO (sinistra) con lo slancio che aveva, e si ferma strisciando.
  // La velocità la si stima dal moto dell'ultimo frame (≈60fps); se non c'è
  // (primo frame), si assume un galoppo pieno.
  const vStim = (horse.progress - (horse.prevProgress ?? horse.progress)) * 60;
  horse.cadutoSlide = clamp(vStim > 0.5 ? vStim : 9, 3, 15);
  state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
  try { playColpoPalchi(0.85); } catch (e) { /* niente */ }   // batte e cade: tonfo sui palchi, non nitrito
  if (state.messageTimer <= 0) showMessage(`${horse.name}: a terra anche il cavallo!`, 2.0, "danger");
}

// MAXI-CADUTA alla prima curva: le due Contrade dell'impatto vanno giù cavallo e
// fantino, e la caduta si propaga alle ATTACCATE ALL'ESTERNO (corsia più esterna,
// stessa altezza): le 2 più vicine cadono con TUTTO il cavallo, le successive
// (fino a 3) perdono SOLO il fantino. Es. Drago+Lupa giù → Selva e Istrice a
// terra con i cavalli, Pantera scossa.
function maxiCaduta(a, b) {
  triggerHorseFall(a);
  triggerHorseFall(b);
  showMessage(`MAXI CADUTA in curva: ${a.name} e ${b.name} a terra!`, 3.0, "danger");
  state.cameraShake = Math.max(state.cameraShake || 0, 0.7);
  const extLane = Math.min(a.lane, b.lane);            // il bordo esterno della coppia
  const prog = (a.progress + b.progress) / 2;
  const attaccate = state.horses.filter((h) => h !== a && h !== b && !h.caduto
    && h.lane < extLane + 0.3 && h.lane > extLane - 7.5          // all'esterno, non lontane
    && Math.abs(h.progress - prog) < HORSE_BLOCK_LENGTH * 1.8)   // alla stessa altezza
    .sort((h1, h2) => Math.abs(h1.lane - extLane) - Math.abs(h2.lane - extLane));
  attaccate.forEach((h, i) => {
    if (i < 2) triggerHorseFall(h);                    // le prime due: giù col cavallo
    else if (i < 5) triggerFall(h);                    // le altre (max 3): solo il fantino
  });
}
function triggerFall(horse, ctx) {
  if (!horse || horse.scosso) return;
  if (horse.id === "istrice" && !isHuman(horse) && frenoAttivo("istriceNoFall")) return;  // Istrice AI immune
  if (fantiniACavallo() <= MIN_A_CAVALLO) return;   // tieni almeno MIN_A_CAVALLO fantini in sella
  horse.scosso = true;
  horse.fallCd = 3;
  // Bonus/malus di stamina da SCOSSO (per-cavallo dal roster: es. Remorex +10,
  // Trattu +16, Zio Frac −15…). Il cavallo scosso corre con più/meno fiato.
  const sc = horse.scossoStamina || 0;
  if (sc) { horse.staminaMax = Math.max(5, (horse.staminaMax || 0) + sc); horse.stamina = Math.max(5, (horse.stamina || 0) + sc); }
  const rider = horse.group && horse.group.userData && horse.group.userData.jockey;
  if (rider && rider.visible) {
    rider.visible = false;                   // il cavallo perde il fantino → SCOSSO
    startJockeyFall(horse, rider, ctx);      // caduta FISICA: distacco → parabola → impatto → scivolata
  }
  if (horse.player) horse.autopilot = true;  // il TUO cavallo scosso corre da solo (perdi il controllo)
  // NB: NIENTE camera shake al distacco — lo shake va SOLO all'impatto col tufo
  // (gestito in updateFallenRiders). Il cavallo resta scosso e prosegue in corsa.
  try { playColpoPalchi(0.45); } catch (e) { /* niente */ }   // colpo/strappo del disarcionamento
  if (state.messageTimer <= 0) showMessage(`${horse.name}: caduta! Cavallo scosso`, 1.7, "danger");
}

// ══ CADUTA DEL FANTINO — fisica a fasi ════════════════════════════════════════
// Distacco (posa/posizione ESATTE) → parabola in aria (eredita l'inerzia in avanti
// del cavallo + impulso laterale secondo la causa) → impatto col tufo (stop verticale,
// piccolo rimbalzo, shake+polvere SOLO qui) → rotolamento/scivolata con attrito →
// posa finale sul fianco → dissolvenza. Il cavallo resta SCOSSO e continua a correre.
//
// TARATURA (per una caduta più/meno violenta):
//   FWD_FRAC ↑ = più inerzia in avanti · LAT ↑ = sbalzo laterale più ampio ·
//   UP ↑ = vola più in alto (aria più lunga) · ROLL/PITCH/YAW = quantità di giro
//   (tenerle basse: niente elica) · BOUNCE ↑ = rimbalzo più marcato ·
//   SLIDE_FRICTION ↑ = scivolata più corta · REST_AGE = quanto resta a terra.
const FALL = {
  GRAV: 9.81,            // m/s² (scalata in unità-scena a runtime)
  FWD_FRAC: 0.82,        // 75–90%: % della velocità in avanti del cavallo ereditata
  LAT: [1.6, 3.0],       // impulso laterale (m/s)
  UP: [0.7, 1.15],       // impulso verticale (m/s)
  ROLL: [3.0, 4.4],      // rad/s rollio laterale (attorno all'asse AVANTI)
  PITCH: [1.2, 2.2],     // rad/s beccheggio in avanti (attorno all'asse LATERALE)
  YAW: [0.6, 1.4],       // rad/s piccola imbardata
  BOUNCE: 0.16,          // rimbalzo verticale all'impatto (molto piccolo)
  ANG_IMPACT: 0.22,      // riduzione della velocità angolare all'impatto
  SLIDE_FRICTION: 5.0,   // 1/s attrito dello scivolamento a terra
  REST_AGE: 8.5,         // s a terra prima di dissolversi
  FADE: 1.3,             // s di dissolvenza (niente sparizione secca)
  MAX_DT: 1 / 30,        // clamp del passo fisico (niente esplosioni a frame bassi)
};
// Sbuffo di polvere a una posizione mondo qualsiasi (riusa il sistema di state.dust).
function dustPuffAt(x, z, n) {
  for (let k = 0; k < (n || 6); k += 1) {
    const color = new THREE.Color().lerpColors(DUST_COLOR_A, DUST_COLOR_B, Math.random());
    const dust = new THREE.Mesh(shared.dustPlaneGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    dust.position.set(x + (Math.random() - 0.5) * 1.0, 0.16 + Math.random() * 0.22, z + (Math.random() - 0.5) * 1.0);
    dust.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    dust.rotation.z = Math.random() * TAU;
    dust.userData.life = 0.9; dust.userData.maxLife = 0.9;
    state.dust.push(dust); scene.add(dust);
  }
  while (state.dust.length > 140) { const d = state.dust.shift(); if (d) scene.remove(d); }
}
// Avvia la caduta di UN fantino. causeContext (facoltativo): { other } = altro cavallo
// coinvolto → si cade dal lato OPPOSTO a lui; altrimenti dal verso dello scivolamento
// laterale o verso l'esterno curva; casuale solo se non c'è una causa chiara.
function startJockeyFall(horse, rider, ctx) {
  try {
    if (!state.fallenRiders) state.fallenRiders = [];
    // 1) DISTACCO — clone che parte dalla posa/posizione/scala MONDIALI esatte del
    //    fantino in sella (nessuno scatto/teletrasporto). Riggato → SkeletonUtils.
    let rigged = false; rider.traverse((o) => { if (o.isSkinnedMesh) rigged = true; });
    const fallen = rigged ? SkeletonUtils.clone(rider) : rider.clone(true);
    rider.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    rider.matrixWorld.decompose(pos, quat, scl);
    fallen.position.copy(pos); fallen.quaternion.copy(quat); fallen.scale.copy(scl);
    fallen.visible = true;
    // materiali UNICI sul clone: così la dissolvenza NON intacca il fantino vivo
    fallen.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
    });
    scene.add(fallen);
    // scala scena↔metri dall'altezza reale del clone (~1.75 m) → gravità/impulsi coerenti
    const bb = new THREE.Box3().setFromObject(fallen);
    const standH = Math.max(0.5, bb.max.y - bb.min.y);
    const u = standH / 1.75;                 // unità-scena per metro
    const restY = Math.max(0.12, standH * 0.16); // altezza dell'origine da coricato

    // 2) LATO della caduta (vettore orizzontale mondo)
    const yaw = (horse.group && horse.group.rotation.y) || 0;
    const F = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));    // avanti
    const L = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));   // sinistra del cavallo
    let sideSign = 0;
    const other = ctx && ctx.other;
    if (other && other.group) {                                     // via dal cavallo che ti ha colpito
      const op = new THREE.Vector3(); other.group.getWorldPosition(op);
      sideSign = Math.sign(new THREE.Vector3().subVectors(pos, op).dot(L));
    } else if (Math.abs(horse.laneVelocity || 0) > 2.5) {           // nel verso dello scivolamento
      sideSign = Math.sign(horse.laneVelocity);
    } else {
      const sc = (sampleAt(horse.progress).signedCurve) || 0;       // verso l'esterno curva
      sideSign = Math.abs(sc) > 0.02 ? Math.sign(sc) : (Math.random() < 0.5 ? 1 : -1);  // casuale se non chiaro
    }
    if (!sideSign) sideSign = Math.random() < 0.5 ? 1 : -1;
    const side = L.clone().multiplyScalar(sideSign);

    // 3) VELOCITÀ ereditata dal MOVIMENTO REALE del cavallo (delta di progress = spazio
    //    mondo percorso nell'ultimo frame): robusta ai cambi di formula. Fallback = galoppo.
    let spd = (horse.progress - (horse.prevProgress ?? horse.progress)) * 60;
    spd = clamp(spd, 0, 22); if (spd < 3) spd = 10 * u;
    const rnd = (a) => a[0] + Math.random() * (a[1] - a[0]);
    const vel = new THREE.Vector3()
      .addScaledVector(F, spd * FALL.FWD_FRAC)
      .addScaledVector(side, rnd(FALL.LAT) * u)
      .addScaledVector(new THREE.Vector3(0, 1, 0), rnd(FALL.UP) * u);

    // 4) VELOCITÀ ANGOLARE multi-asse: rollio verso il lato, beccheggio avanti,
    //    piccola imbardata. Ampiezze tali da fare ≤ ~mezzo/uno giro prima dell'impatto.
    const angVel = { roll: rnd(FALL.ROLL) * sideSign, pitch: rnd(FALL.PITCH), yaw: rnd(FALL.YAW) * (Math.random() < 0.5 ? 1 : -1) };
    // posa finale a terra: coricato sul FIANCO della caduta (non piatto come una tavola)
    const restQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, yaw, sideSign * 1.28, "YXZ"));

    state.fallenRiders.push({
      obj: fallen, pos, vel, quat, angVel, restQuat,
      F: F.clone(), L: L.clone(), sideSign,
      age: 0, grounded: false, impactDone: false, restY, u,
    });
  } catch (e) { /* niente */ }
}
// Compat: chiamata dalla ripetizione dell'ultimo giro (causa non nota → lato casuale).
function spawnFallenRider(horse, rider) { startJockeyFall(horse, rider, null); }

// Integrazione fisica per frame di tutti i fantini caduti. dt limitato (MAX_DT).
function updateFallenRiders(dt) {
  const arr = state.fallenRiders;
  if (!arr || !arr.length) return;
  const step = Math.min(dt, FALL.MAX_DT);
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const f = arr[i];
    try {
    f.age += dt;
    if (!f.grounded) {
      // ── FASE IN ARIA: parabola fisica ──────────────────────────────────────
      f.vel.y -= FALL.GRAV * f.u * step;
      f.pos.addScaledVector(f.vel, step);
      // rotazione via quaternion attorno ad assi MONDO (premultiply = spazio mondo)
      const dq = new THREE.Quaternion();
      dq.setFromAxisAngle(f.F, f.angVel.roll * step); f.quat.premultiply(dq);
      dq.setFromAxisAngle(f.L, f.angVel.pitch * step); f.quat.premultiply(dq);
      dq.setFromAxisAngle(UP_AXIS, f.angVel.yaw * step); f.quat.premultiply(dq);
      // ── IMPATTO COL TUFO (pista a y=0): l'origine scende sotto restY ──────────
      if (f.pos.y <= f.restY && f.vel.y < 0) {
        const firstHit = !f.impactDone;
        f.pos.y = f.restY;
        f.vel.y = -f.vel.y * FALL.BOUNCE;                 // rimbalzo minimo
        f.vel.x *= 0.55; f.vel.z *= 0.55;                 // attrito d'urto (taglia lo slancio)
        f.angVel.roll *= FALL.ANG_IMPACT; f.angVel.pitch *= FALL.ANG_IMPACT; f.angVel.yaw *= FALL.ANG_IMPACT;
        f.impactDone = true;
        if (f.vel.y < 0.4 * f.u) { f.grounded = true; f.vel.y = 0; }   // rimbalzo esaurito → a terra
        if (firstHit) {                                   // effetti SOLO al primo contatto
          state.cameraShake = Math.max(state.cameraShake || 0, 0.3);
          try { dustPuffAt(f.pos.x, f.pos.z, 7); playColpoPalchi(0.5); } catch (e) { /* niente */ }
        }
      }
    } else {
      // ── A TERRA: rotolamento breve + scivolata con attrito, poi arresto ───────
      const fr = Math.exp(-FALL.SLIDE_FRICTION * step);
      f.vel.x *= fr; f.vel.z *= fr;
      f.pos.addScaledVector(f.vel, step);
      f.pos.y = f.restY;
      f.quat.slerp(f.restQuat, clamp(step * 6, 0, 1));    // si adagia sul fianco
    }
    f.obj.position.copy(f.pos);
    f.obj.quaternion.copy(f.quat);
    // ── DISSOLVENZA finale poi rimozione (niente sparizione improvvisa) ─────────
    if (f.age >= FALL.REST_AGE) {
      const k = clamp((f.age - FALL.REST_AGE) / FALL.FADE, 0, 1);
      f.obj.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.transparent = true; m.opacity = 1 - k; });
        }
      });
      if (k >= 1) { scene.remove(f.obj); arr.splice(i, 1); }
    }
    } catch (e) { try { scene.remove(f.obj); } catch (e2) { /* niente */ } arr.splice(i, 1); }
  }
}
function clearFallenRiders() {
  (state.fallenRiders || []).forEach((f) => { try { scene.remove(f.obj); } catch (e) { /* niente */ } });
  state.fallenRiders = [];
}

// Collisioni tra cavalli in gara: contatto se vicini sia in avanzamento sia in
// corsia. Il cavallo dietro viene scartato di lato, rallenta e alza polvere; il
// davanti rallenta appena. Se è coinvolto il giocatore, scossa camera e avviso.
// Risolve una singola coppia di cavalli: separazione laterale rispettosa dei
// bordi + blocco longitudinale anti-attraversamento. Restituisce true se la
// coppia era a contatto (per il feedback).
function resolveHorsePair(A, B, dt, feedback) {
  const signedGap = B.progress - A.progress;
  const gap = Math.abs(signedGap);
  const laneGap = Math.abs(A.lane - B.lane);
  // ── CAVALLO A TERRA: NON è un muro, ci si passa SOPRA ──────────────────────
  // Chi lo tocca però perde il FANTINO (il suo cavallo prosegue scosso,
  // scavalcando il corpo). Niente blocco né spinte: prima tre caduti di fila
  // formavano una diga e chi arrivava restava inchiodato ad aspettare che si
  // rialzassero. triggerFall è un no-op sugli scossi: un cavallo già senza
  // fantino ci passa sopra e basta.
  if (A.caduto || B.caduto) {
    const giu = A.caduto ? A : B;
    const su = giu === A ? B : A;
    if (!su.caduto && gap < HORSE_BLOCK_LENGTH * 0.8 && laneGap < HORSE_BLOCK_WIDTH) {
      const eraInSella = !su.scosso;
      triggerFall(su, { other: giu });   // calpestando il caduto: cade dal lato opposto a lui
      if (eraInSella && feedback && state.messageTimer <= 0) {
        showMessage(`${su.name} calpesta ${giu.name}: fantino a terra!`, 1.6, "danger");
      }
    }
    return false;
  }
  // SWEPT (anti-tunneling): se i due hanno invertito l'ordine in progress in
  // questo frame restando affiancati, si sono attraversati -> trattali come urto.
  const prevSignedGap = (B.prevProgress ?? B.progress) - (A.prevProgress ?? A.progress);
  const crossed = prevSignedGap * signedGap < 0 && laneGap < HORSE_PASS_CLEARANCE;
  // "Affiancati": entro la lunghezza del corpo e a meno del VARCO DI SORPASSO di
  // lato (più largo del corpo). Finché è così, il dietro non può passare: per
  // sorpassare deve spostarsi attivamente su una corsia libera, non sfondare.
  const engaged = (gap < HORSE_BLOCK_LENGTH && laneGap < HORSE_PASS_CLEARANCE) || crossed;
  if (!engaged) return false;

  // Chi è davvero davanti: se hanno tunnelato, conta l'ordine PRECEDENTE.
  let behind;
  let front;
  if (crossed && Math.abs(prevSignedGap) > 0.001) {
    behind = prevSignedGap > 0 ? A : B;
    front = behind === A ? B : A;
  } else {
    behind = A.progress <= B.progress ? A : B;
    front = behind === A ? B : A;
  }

  // PRECEDENZA A CHI È DAVANTI: chi arriva da dietro CI BATTE CONTRO e scarta
  // LUI; chi è davanti tiene la sua linea (cede solo un residuo anti-incastro,
  // 8%). Il dietro scarta verso il lato dove ha spazio: se è schiacciato contro
  // il bordo aggira dall'altra parte — non trascina mai via il davanti.
  const curLaneGap = Math.abs(behind.lane - front.lane);
  const laneOverlap = HORSE_BLOCK_WIDTH - curLaneGap;
  if (laneOverlap > 0) {
    // Negli imbuti il muro esterno è più vicino: lo spazio per scartare "fuori"
    // si calcola sul limite EFFETTIVO, non su quello pieno — è così che la
    // strettoia compatta il gruppo e le spinte diventano pericolose.
    const outLim = outerLimitAt(behind.progress);
    let side = Math.sign(behind.lane - front.lane) || (front.lane >= 0 ? -1 : 1);
    const roomToward = side > 0 ? AI_LANE_LIMIT - behind.lane : behind.lane + outLim;
    if (roomToward < laneOverlap * 1.2) side = -side;  // lato chiuso: scarta dall'altra parte
    const bounce = behind.player ? 0.5 : 1.0;          // al giocatore non si strappa il controllo
    behind.lane = clamp(behind.lane + side * laneOverlap * bounce, -outLim, AI_LANE_LIMIT);
    // POTENZA = moltiplicatore di quanto SPOSTI le altre andandogli addosso: se
    // chi arriva da dietro ha più potenza di chi è davanti, lo scaccia di lato
    // (bounded ~½ corpo per non stravolgere la precedenza a chi è davanti).
    const shove = clamp(((behind.potenza || 3) - (front.potenza || 3)) * 0.16, 0, 0.5);
    if (shove > 0 && !front.player) {
      front.lane = clamp(front.lane - side * laneOverlap * shove, -outerLimitAt(front.progress), AI_LANE_LIMIT);
    }
  }

  // Blocco LONGITUDINALE: senza un varco laterale sufficiente, il cavallo dietro
  // NON attraversa quello davanti — resta inchiodato in scia a distanza minima.
  // Tracciando il davanti viaggia di fatto alla sua stessa velocità (parata):
  // perde il suo vantaggio finché non trova lo spazio per affiancarsi.
  const newLaneGap = Math.abs(behind.lane - front.lane);
  let held = false;
  if (newLaneGap < HORSE_PASS_CLEARANCE) {
    // DIFESA del fantino davanti: più è alta, più tiene la posizione — il varco
    // richiesto per superarlo si stringe (più difficile passarlo di lato).
    const dif = (front.jkDifesa ?? 3) - 3;                          // -2..+2
    const passFloor = clamp(0.62 - dif * 0.05, 0.5, 0.78);
    const minGap = HORSE_BLOCK_LENGTH * lerp(0.98, passFloor, clamp(newLaneGap / HORSE_PASS_CLEARANCE, 0, 1));
    if (behind.progress > front.progress - minGap) {
      // TAMPONAMENTO: quanto più forte il dietro stava arrivando addosso al davanti
      // (velocità di avvicinamento, PRIMA del blocco) → tanto più rischia la caduta.
      if (feedback) {
        const behindV = (behind.progress - (behind.prevProgress ?? behind.progress)) / Math.max(dt, 0.001);
        const frontV = (front.progress - (front.prevProgress ?? front.progress)) / Math.max(dt, 0.001);
        const closing = behindV - frontV;
        // Il davanti è la seconda Contrada coinvolta: serve alla maxi-caduta.
        if (closing > 2.5) riskFall(behind, clamp((closing - 2.5) / 5, 0, 1), "tamponamento", front);
      }
      behind.progress = front.progress - minGap;
      held = true;
    }
    behind.speedLevel *= 0.985; // solo assestamento visivo: il blocco lo fa il clamp
    // Anche il GIOCATORE dietro sbatte e perde slancio (non spinge il muro).
    if (held && behind.player) behind.travelSpeed = (behind.travelSpeed || 0) * Math.pow(0.35, dt);
  }

  if (feedback) {
    behind.collisionFlash = Math.max(behind.collisionFlash, 0.85);
    front.collisionFlash = Math.max(front.collisionFlash, 0.55);
    if (held && Math.random() < dt * 3) emitDust(behind);
    if (held && (behind.player || front.player) && state.messageTimer <= 0) {
      showMessage(behind.player ? "Bloccato in scia: cerca il varco" : "Sorpasso parato", 0.6, behind.player ? "danger" : "good");
    }
  }
  return true;
}

function resolveRaceCollisions(dt) {
  const horses = state.horses;
  // Più passate per frame: scioglie le catene (3+ cavalli ammucchiati) e non
  // lascia compenetrazioni residue. Il feedback (urto/polvere/messaggio) solo
  // alla prima passata.
  const ITERATIONS = 3;
  for (let it = 0; it < ITERATIONS; it += 1) {
    for (let i = 0; i < horses.length; i += 1) {
      for (let j = i + 1; j < horses.length; j += 1) {
        resolveHorsePair(horses[i], horses[j], dt, it === 0);
      }
    }
  }
}

function updateDemo(dt, time) {
  state.demoHorses.forEach((horse) => {
    horse.progress += speedToTravel(horse.speedLevel) * dt;
    horse.lane += Math.sin(time * 0.7 + horse.phase) * dt * 0.18;
    placeHorse(horse, time);
  });
}

function emitDust(horse) {
  const sample = sampleAt(horse.progress);
  const pos = horse.group.position.clone().addScaledVector(sample.tangent, -0.9);
  // Quattro sbuffi di polvere per chiamata, colore caldo casuale tra due
  // tonalità. Blending normale (niente additivo): polvere opaca e terrosa, non
  // più scintille luminose.
  for (let k = 0; k < 4; k += 1) {
    const color = new THREE.Color().lerpColors(DUST_COLOR_A, DUST_COLOR_B, Math.random());
    const dust = new THREE.Mesh(
      shared.dustPlaneGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      })
    );
    dust.position.set(
      pos.x + (Math.random() - 0.5) * 0.8,
      0.18 + Math.random() * 0.18,
      pos.z + (Math.random() - 0.5) * 0.8
    );
    dust.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    dust.rotation.z = Math.random() * TAU;
    dust.userData.life = 0.85;
    dust.userData.maxLife = 0.85;
    state.dust.push(dust);
    scene.add(dust);
  }
  while (state.dust.length > 130) {
    const stale = state.dust.shift();
    scene.remove(stale);
    stale.material.dispose();
  }
}

function updateDust(dt) {
  for (let i = state.dust.length - 1; i >= 0; i -= 1) {
    const dust = state.dust[i];
    dust.userData.life -= dt;
    const p = clamp(1 - dust.userData.life / dust.userData.maxLife, 0, 1);
    dust.scale.setScalar(lerp(1, 2.2, p));
    dust.material.opacity = lerp(0.55, 0, p);
    dust.position.y += 0.6 * dt;
    dust.position.x += (Math.random() - 0.5) * 0.4 * dt;
    dust.position.z += (Math.random() - 0.5) * 0.4 * dt;
    if (dust.userData.life <= 0) {
      scene.remove(dust);
      dust.material.dispose();
      state.dust.splice(i, 1);
    }
  }
}

// Coriandoli di vittoria: InstancedMesh (count 55 > 30). Ogni istanza ha la sua
// fisica (gravità, rotazione, vita); la dissolvenza è resa rimpicciolendo
// l'istanza, dato che l'opacità per-istanza non è disponibile senza shader.
let confetti = null;
function launchConfetti() {
  clearConfetti();
  const count = 55;
  const geo = new THREE.BoxGeometry(0.09, 0.20, 0.022);
  const mat = new THREE.MeshBasicMaterial({ fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const finish = sampleAt(0).point;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const contrade = state.horses.length ? state.horses : [{ colors: ["#d8a93a"] }];
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    color.set(contrade[i % contrade.length].colors[0]);
    mesh.setColorAt(i, color);
    const life = 3.2 + Math.random() * 1.2;
    parts.push({
      x: finish.x + (Math.random() - 0.5) * 16,
      y: 8,
      z: finish.z + (Math.random() - 0.5) * 16,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3,
      vz: (Math.random() - 0.5) * 4,
      rot: Math.random() * TAU,
      rotSpeed: Math.random() * 6,
      life,
      maxLife: life
    });
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  confetti = { mesh, parts, dummy };
}

function updateConfetti(dt) {
  if (!confetti) return;
  const { mesh, parts, dummy } = confetti;
  let alive = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.life <= 0) {
      dummy.position.set(0, -1000, 0);
      dummy.scale.setScalar(0.0001);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      continue;
    }
    p.life -= dt;
    p.vy -= 9 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.rot += p.rotSpeed * dt;
    const fade = p.life < 0.8 ? clamp(p.life / 0.8, 0, 1) : 1;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rot, p.rot * 0.7, p.rot * 1.3);
    dummy.scale.setScalar(Math.max(0.0001, fade));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (p.life > 0) alive += 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (alive === 0) clearConfetti();
}

function clearConfetti() {
  if (!confetti) return;
  scene.remove(confetti.mesh);
  confetti.mesh.geometry.dispose();
  confetti.mesh.material.dispose();
  confetti.mesh.dispose();
  confetti = null;
}

function updateAtmosphere(dt, time) {

  // Reazione del popolo (esultanza/gelo) sopra al leggero ondeggiamento di base.
  const cr = state.crowdReaction;
  let excite = 0, freeze = 0;
  if (cr) {
    cr.t += dt;
    const k = clamp(1 - cr.t / cr.dur, 0, 1);
    if (cr.kind === "cheer") excite = k;
    else if (cr.kind === "cold") freeze = k;
    else excite = k * 0.4;              // "mild": applauso contenuto
    if (cr.t >= cr.dur) state.crowdReaction = null;
  }
  // FOLLA ANIMATA: si riscrivono le matrici solo quando qualcosa si MUOVE davvero.
  // Col gelo (freeze) la folla sta ferma: in quel caso si salta tutto, e appena
  // torna immobile si fa un ultimo passaggio per rimetterla giù.
  {
    const F = state.folla;
    if (F && F.mesh) {
      const inMovimento = excite > 0.01 || freeze <= 0.01;
      if (inMovimento || F.sporca) {
        const dm = F.dummy;
        for (let i = 0; i < F.dati.length; i += 1) {
          const p = F.dati[i];
          let y = p.baseY;
          if (excite > 0.01) {
            // Salti di gioia: onda veloce e ampia, sfasata per persona.
            y += Math.abs(Math.sin(time * 9 + p.phase)) * 0.4 * excite;
          } else if (freeze <= 0.01 && i % 4 === 0) {
            y += Math.sin(time * 5.2 + p.phase) * 0.045;   // ondeggiamento normale
          }
          dm.position.set(p.x, y, p.z);
          dm.scale.setScalar(p.scala);
          dm.updateMatrix();
          F.mesh.setMatrixAt(i, dm.matrix);
        }
        F.mesh.instanceMatrix.needsUpdate = true;
        if (F.mesh.instanceColor) F.mesh.instanceColor.needsUpdate = true;
        F.sporca = inMovimento;   // fermi: un ultimo giro e poi si smette
      }
    }
  }

  // Le nuvole orbitano lente attorno all'asse Y.
  if (state.clouds.length) {
    const c = Math.cos(0.004);
    const s = Math.sin(0.004);
    state.clouds.forEach((cloud) => {
      const x = cloud.position.x;
      const z = cloud.position.z;
      cloud.position.x = x * c - z * s;
      cloud.position.z = x * s + z * c;
    });
  }

  if (state.canapi) {
    if (state.mode === "race" || state.mode === "finished" || state.falseStartRunning) {
      // durante il falso avvio canapiDrop è già avanzato da updateFalseStartRunout;
      // in gara/finished lo avanza qui. In entrambi i casi il canapo si abbassa.
      if (!state.falseStartRunning) state.canapiDrop += dt;
      const fall = clamp(state.canapiDrop / 0.34, 0, 1);
      state.canapi.position.y = -0.58 * fall;
      state.canapi.rotation.z = Math.sin(time * 18) * 0.08 * (1 - fall);
      state.canapi.visible = fall < 0.98;
    } else {
      state.canapi.visible = true;
      state.canapi.position.y = 0;   // fermo all'altezza corretta
      state.canapi.rotation.z = 0;   // nessuna oscillazione
    }
  }

  updateSpeedLines(dt);
}

function updateAudio(dt) {
  if (!state.audio.ctx) return;
  const player = getPlayer();
  const mode = state.mode;

  // ── Zoccoli che scalpitano alla mossa: i cavalli pestano nervosi al canape ─
  if (mode === "mossa") {
    state.audio.stampTimer = (state.audio.stampTimer || 0) - dt;
    if (state.audio.stampTimer <= 0) {
      state.audio.stampTimer = 0.16 + Math.random() * 0.5;
      playStamp();
    }
    return;
  }

  if (mode !== "race" || !player) return;

  // ── Galoppo in gara ───────────────────────────────────────────────────────
  state.audio.hoofTimer -= dt;
  const interval = clamp(0.42 - player.speedLevel * 0.025, 0.16, 0.34);
  if (state.audio.hoofTimer <= 0) {
    state.audio.hoofTimer = interval;
    playHoof(clamp(player.speedLevel / 10, 0, 1));
  }

  if (player.boosting && !state.audio.lastNerbo) playNerbo();
  if (player.braking && !state.audio.lastBrake) playBrake();
  state.audio.lastNerbo = player.boosting;
  state.audio.lastBrake = player.braking;
}

function updateSpeedLines(dt) {
  const player = getPlayer();
  // Speed-line a schermo disattivate: niente scie/luci gialle in velocità, per
  // un aspetto più realistico. La velocità si percepisce da galoppo, polvere e
  // campo visivo.
  const active = false;
  if (!active) {
    state.speedLines.forEach((line) => {
      line.visible = false;
      line.material.opacity = 0;
    });
    return;
  }

  const sample = sampleAt(player.progress);
  const forward = sample.tangent.clone().normalize();
  const right = sample.normal.clone().normalize();
  state.speedLines.forEach((line, index) => {
    const side = ((index % 5) - 2) * 0.9;
    const back = 5 + index * 1.1 + Math.random() * 0.1;
    const pos = player.group.position
      .clone()
      .addScaledVector(forward, -back)
      .addScaledVector(right, side)
      .add(new THREE.Vector3(0, 1.15 + (index % 3) * 0.45, 0));
    line.visible = true;
    line.position.copy(pos);
    line.rotation.y = sample.yaw;
    line.rotation.x = -0.2;
    line.scale.set(0.82 + index * 0.025, 1.0 + player.speedLevel * 0.12, 1);
    const targetOpacity = (player.boosting ? 0.16 : 0.07) * (1 - (index % 6) * 0.08);
    line.material.opacity += (targetOpacity - line.material.opacity) * clamp(dt * 9, 0, 1);
  });
}

function getRanking() {
  return [...state.horses].sort((a, b) => {
    if (a.finishTime != null && b.finishTime != null) return a.finishTime - b.finishTime;
    if (a.finishTime != null) return -1;
    if (b.finishTime != null) return 1;
    return b.progress - a.progress;
  });
}

function updateHud(dt) {
  const player = getPlayer();
  if (!player || (state.mode !== "mossa" && state.mode !== "race")) return;
  ui.hud.classList.toggle("mode-mossa", state.mode === "mossa");
  const ranking = getRanking();
  const rank = ranking.findIndex((horse) => horse === player) + 1;
  const lap = player.finishTime ? FINISH_LAPS : clamp(Math.floor(Math.max(0, player.progress) / track.length) + 1, 1, FINISH_LAPS);
  // I cambi di posizione 1<->2 sono annunciati da updateRaceAnnouncements.
  state.ui.lastPlayerRank = rank;
  ui.rank.textContent = `${rank}/10`;
  ui.lap.textContent = `${lap}/${FINISH_LAPS}`;
  const chosenSpeed = clamp(Math.round(player.speedSetting || 1), PLAYER_SPEED_MIN, ANDATURA_MAX);
  const effectiveSpeed = clamp(Math.round(player.effectiveSpeedLevel || chosenSpeed), PLAYER_SPEED_MIN, ANDATURA_MAX);
  // Mostra chosen→effective ogni volta che l'andatura reale è sotto quella scelta
  // (per stamina O per il tetto del 1° giro), così il "4 al primo giro" è leggibile.
  ui.speed.textContent = effectiveSpeed < chosenSpeed ? `${chosenSpeed}->${effectiveSpeed}/5` : `${chosenSpeed}/5`;
  const staminaMax = player.staminaMax || STAMINA_MIN_ROLL;
  ui.staminaText.textContent = player.staminaLimited
    ? `${Math.round(player.stamina)}/${staminaMax} STANCO`
    : `${Math.round(player.stamina)}/${staminaMax}`;
  ui.staminaFill.style.transform = `scaleX(${clamp(player.stamina / staminaMax, 0, 1)})`;
  ui.staminaFill.classList.toggle("low", player.stamina <= staminaMax * 0.25);
  ui.staminaFill.classList.toggle("limited", player.staminaLimited);
  // NERVOSISMO del TUO cavallo (al posto del vecchio indicatore di rischio): è il
  // valore che decide se scarta indietro ai canapi (soglia NERV_BACK_THRESHOLD).
  const nervNow = clamp(player.nervSmooth ?? player.nervousnessCurrent ?? 0, 0, 1);
  ui.riskFill.style.transform = `scaleX(${nervNow})`;
  ui.riskFill.classList.toggle("low", nervNow > NERV_BACK_THRESHOLD);   // oltre soglia = allarme
  const nervLabel = nervNow > NERV_BACK_THRESHOLD ? "AGITATO"
    : nervNow > 0.5 ? "TESO"
    : nervNow > 0.32 ? "ATTENTO" : "CALMO";
  const nervTxt = `${nervLabel} ${Math.round(nervNow * 100)}%`;
  if (nervTxt !== state.ui.lastRiskLabel) {
    state.ui.lastRiskLabel = nervTxt;
    ui.riskText.textContent = nervTxt;
  }
  // NERBATE del giocatore: 5 pip come i colpi in canna. Pieno = disponibile,
  // il primo "spento" lampeggia mentre ricarica.
  if (ui.nerbatePips) {
    const n = clamp(player.nerbate ?? NERBATE_MAX, 0, NERBATE_MAX);
    const ricaricando = n < NERBATE_MAX;
    const pips = ui.nerbatePips.children;
    for (let i = 0; i < pips.length; i += 1) {
      const disponibile = i < n;
      const inRicarica = ricaricando && i === n;   // il prossimo che si ricarica
      pips[i].classList.toggle("spent", !disponibile && !inRicarica);
      pips[i].classList.toggle("recharging", inRicarica);
    }
    if (ui.nerbateText) ui.nerbateText.textContent = `${n}/${NERBATE_MAX}`;
  }
  // Niente vignettatura gialla in accelerazione: look più realistico. Resta
  // solo il leggero alone rosso in frenata.
  ui.speedVignette.classList.remove("boosting");
  ui.speedVignette.classList.toggle("braking", player.braking && state.mode === "race");

  // La CLASSIFICA delle Contrade si vede solo in CORSA, non durante la mossa.
  ui.leaderboard.style.display = (state.mode === "race" || state.mode === "finished") ? "" : "none";
  if (state.mode !== "race" && state.mode !== "finished") return;
  state.ui.leaderboardTimer -= dt;
  const rankKey = ranking.slice(0, 6).map((horse) => `${horse.id}:${Math.floor(horse.progress)}`).join("|");
  if (state.ui.leaderboardTimer > 0 && rankKey === state.ui.lastRankKey) return;
  state.ui.leaderboardTimer = 0.18;
  state.ui.lastRankKey = rankKey;
  ui.leaderboard.textContent = "";
  ranking.slice(0, 6).forEach((horse, index) => {
    const row = document.createElement("div");
    row.className = `leader-row${horse.player ? " player" : ""}`;
    const pos = document.createElement("span");
    pos.textContent = String(index + 1);
    const swatch = document.createElement("span");
    swatch.className = "leader-swatch";
    swatch.style.background = `linear-gradient(135deg, ${horse.colors[0]}, ${horse.colors[1]})`;
    const name = document.createElement("span");
    name.textContent = horse.name;
    const gap = document.createElement("span");
    gap.textContent = index === 0 ? "testa" : `+${Math.max(0, Math.round(ranking[0].progress - horse.progress))}m`;
    row.append(pos, swatch, name, gap);
    ui.leaderboard.append(row);
  });
}

// ARRIVO: appena il VINCITORE taglia, si mostra SUBITO — MORTARETTO ×3 sfalsato,
// poi il "Passo alla Vittoria" col boato, e la Contrada vittoriosa. Parte una sola
// volta (guardia victoryShown). Il replay resta un pulsante, per "dopo".
function presentVictory() {
  if (state.victoryShown) return;
  state.victoryShown = true;
  state.rankings = getRanking();
  const winner = state.rankings && state.rankings[0];
  recordVictoryToAlbo(winner);   // Albo delle Vittorie (contrada/cavallo/fantino), campagna E veloce
  // +1 ai palii VINTI dell'account SE ha vinto il giocatore reale (non assisti/AI).
  try {
    const acc = getAccount();
    if (acc && acc.email && winner && isHuman(winner)) {
      fetch(ACCOUNT_API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "win", email: acc.email, contrada: winner.id }),
      }).then((r) => (r.ok ? r.json() : null)).then((srv) => {
        if (srv && srv.ok && typeof srv.vinti === "number") { acc.vinti = srv.vinti; setAccount(acc); }
      }).catch(() => { /* offline */ });
    }
  } catch (e) { /* niente */ }
  campaignRecordResult();   // in campagna: registra vittoria/purga di questo palio
  state.cameraShake = 0.35;
  saveIdealLine(); // salva la traiettoria registrata in questa gara
  setHudVisible(false);
  launchConfetti();
  renderFinalRanking();
  // NON fermo tutto: il pubblico (corsa.m4a in loop) resta a suonare SOTTO.
  // ARRIVO: nell'ISTANTE del taglio parte fine.m4a FORTISSIMO (è il momento), e
  // quando si esaurisce entra finale.m4a sulla premiazione.
  // NIENTE mortaretti sintetizzati qui: fine.m4a CONTIENE GIÀ lo scoppio. I tre
  // playMortaretto() che c'erano si sovrapponevano a quello vero e sporcavano il
  // momento dell'arrivo. Il mortaretto sintetico resta solo per la MOSSA FALSA.
  // NIENTE canto di Contrada: quello (<id>.m4a) è il RICHIAMO che usa il Mossiere
  // ai canapi, non il suono della vittoria — sentirlo qui faceva sembrare che la
  // stesse chiamando.
  // I 3 SCOPPI: già sparati a 3 unità dall'arrivo (mortarettoFired, in updateRace).
  // Qui solo FALLBACK, se per qualche motivo non fossero partiti. Volume 0.7 = unico
  // momento sopra il tetto globale (0.6).
  if (!state.mortarettoFired) {
    state.mortarettoFired = true;
    try { playPalioSound("fine.m4a", { volume: 0.7, cap: 0.7 }); } catch (e) { /* niente */ }
  }
  if (state.finaleTimer) clearTimeout(state.finaleTimer);
  state.finaleTimer = setTimeout(() => {
    state.finaleTimer = null;
    try { playPalioSound("finale.m4a", { volume: 0.6 }); } catch (e) { /* niente */ }
  }, FINE_PRIMA_DEL_FINALE * 1000);
  // Passo alla Vittoria sotto; sfuma dopo 45s per non restare acceso sui risultati.
  try { playPalioSound("PASSOAVITTORIA.mp3", { volume: 0.85, stopAfter: 45 }); } catch (e) { /* niente */ }
  setTimeout(() => { try { fadeCrowdBed(2.2); } catch (e) {} }, 2600);   // il brusio della corsa sfuma sotto
  setTimeout(() => { try { fadeGaloppo(2.2); } catch (e) {} }, 2600);    // …e lo zoccolio con lui
  showScreen("results");
  maybeAskFeedbackAfter3();   // dopo 3 palii corsi → popup feedback (una tantum)
}

// Chiusura definitiva quando il runout si esaurisce: ferma la simulazione. La
// vittoria è già stata mostrata all'arrivo del vincitore (presentVictory).
// ══════════════════════════════════════════════════════════════════════════
// LE TRAIETTORIE DI MARIO ROSSI — le AI imparano da come corre un umano
// ──────────────────────────────────────────────────────────────────────────
// A ogni palio corso da Mario Rossi si registra la LINEA che ha tenuto: per
// ogni tratto di pista, la corsia. Si conservano le ultime 30 corse; a inizio
// palio ogni AI ne riceve una e la segue "a modo suo" — mescolata con la sua
// logica e con uno scarto personale, così non diventano dieci copie identiche.
// È il modo per farle sembrare guidate invece che calcolate.
const TRACCE_KEY = "palio.tracce.v1";
const TRACCE_MAX = 30;              // quante corse si tengono
const TRACCIA_PASSO = 4;            // un campione ogni 4 unità di pista
// Quanto l'AI aderisce alla linea umana: 0.88 = ci sta praticamente incollata.
const TRACCIA_PESO = 0.88;
// E di quanto può staccarsene per fare la sua corsa (sorpassi, marcature, parate).
// 3,8 unità: quasi quattro corpi di cavallo, spazio vero per una manovra —
// infilarsi in un varco, chiudere la porta a chi arriva — restando comunque
// legata alla linea che l'umano teneva in quel punto.
const TRACCIA_SCOSTO = 3.8;

function tracciaSlot(progress) {
  const L = track.length || 1;
  return Math.floor(positiveMod(progress, L) / TRACCIA_PASSO);
}
function tracciaSlotTotali() {
  return Math.max(1, Math.ceil((track.length || 1) / TRACCIA_PASSO));
}
function caricaTracce() {
  try {
    const a = JSON.parse(localStorage.getItem(TRACCE_KEY));
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function salvaTraccia(traccia) {
  if (!traccia || !traccia.length) return;
  const tutte = caricaTracce();
  tutte.push(traccia);
  while (tutte.length > TRACCE_MAX) tutte.shift();   // si tengono le ultime 30
  try { localStorage.setItem(TRACCE_KEY, JSON.stringify(tutte)); } catch (e) { /* niente */ }
}
// Registra la corsia del giocatore nel punto di pista in cui si trova. Chiamata
// a ogni frame durante la corsa: scrive un solo numero per tratto, l'ultimo.
function registraPuntoTraccia(player) {
  if (!state.tracciaCorsa || !player) return;
  const s = tracciaSlot(player.progress);
  if (s >= 0 && s < state.tracciaCorsa.length) {
    state.tracciaCorsa[s] = Math.round(player.lane * 10) / 10;   // un decimale basta
  }
}
// A ogni AI si assegna una corsa fra quelle registrate, con uno scarto suo: due
// AI sulla stessa traccia non si sovrappongono.
function assegnaTracceAlleAI() {
  const tutte = caricaTracce();
  state.tracceDisponibili = tutte;
  if (!tutte.length) return;
  state.horses.forEach((h) => {
    if (h.player && !h.autopilot) return;            // non a chi guida davvero
    h.traccia = tutte[Math.floor(Math.random() * tutte.length)];
    // Ognuna tiene la SUA linea, parallela a quella umana. Lo scarto è passato da
    // ±1.6 a ±2.6 perché con dieci cavalli incollati alla stessa traiettoria si
    // ammassavano tutti sulla corda: il giocatore che andava interno li trovava
    // davanti e restava imbottigliato, e sembrava di nuovo un risucchio.
    h.tracciaScarto = (Math.random() * 2 - 1) * 2.6;
    h.tracciaPeso = TRACCIA_PESO * (0.9 + Math.random() * 0.15);   // tutte molto aderenti
  });
}
// La corsia suggerita dalla traccia in questo punto, o null se non c'è.
function laneDaTraccia(horse) {
  const t = horse && horse.traccia;
  if (!t) return null;
  const v = t[tracciaSlot(horse.progress)];
  if (v == null) return null;
  return v + (horse.tracciaScarto || 0);
}

function finishRace() {
  state.raceRunout = 0;
  // La corsa è finita: la linea tenuta da Mario Rossi entra nell'archivio delle
  // ultime 30, da cui le AI pescheranno nei palii successivi.
  if (state.tracciaCorsa) {
    const piena = state.tracciaCorsa.filter((v) => v != null).length;
    // Solo se ha davvero corso: una traccia con quattro punti non insegna niente.
    if (piena >= tracciaSlotTotali() * 0.5) salvaTraccia(state.tracciaCorsa);
    state.tracciaCorsa = null;
  }
  state.mode = "finished";
  presentVictory(); // fallback difensivo: no-op se già mostrata
}

// ── REPLAY DELL'ULTIMO GIRO ──────────────────────────────────────────────────
// Durante la gara si registrano le posizioni di tutti (20 Hz). All'arrivo si
// rivede l'ULTIMO GIRO con la camera sul VINCITORE: dove prende il vantaggio,
// come entra nelle curve, la volata verso il drappellone.
function recordReplayFrame(dt) {
  const R = state.replay || (state.replay = { frames: [], acc: 0 });
  R.acc += dt;
  if (R.acc < 0.05) return;
  R.acc = 0;
  // Registra anche lo stato SCOSSO per-frame (3° valore): così nel replay il
  // fantino cade nel momento in cui è caduto DAVVERO, non da inizio replay.
  R.frames.push(state.horses.map((h) => [h.progress, h.lane, h.scosso ? 1 : 0]));
}

// Replay AL RALLENTATORE in due segmenti: (1) i PRIMI 8 SECONDI della mossa
// (da quando fianca la rincorsa e parte il Palio) e (2) l'ULTIMO GIRO. Segue il
// vincitore e lo lascia PROSEGUIRE oltre la linea (niente stop sul traguardo).
function startWinnerReplay() {
  const R = state.replay;
  const winner = state.rankings && state.rankings[0];
  if (!R || R.frames.length < 40 || !winner) { showScreen("results"); return; }
  const wIdx = state.horses.indexOf(winner);
  // Primi 10.5s di gara registrata (erano 8): al rallentatore 0.5× il segmento
  // dura 21s a schermo — 3.5 di inseguimento alla mossa e ~17.5 di inquadratura
  // aerea su San Martino (5 secondi in più di prima).
  const seg1To = Math.min(R.frames.length - 1, Math.round(10.5 / 0.05));
  const lastLapStart = track.length * (FINISH_LAPS - 1);
  let seg2From = R.frames.findIndex((fr) => fr[wIdx][0] >= lastLapStart);
  if (seg2From < 0) seg2From = Math.max(seg1To + 1, R.frames.length - 200);
  state.replayPlay = {
    segments: [
      { from: 0, to: seg1To, label: "la Mossa — fianca la rincorsa" },
      { from: seg2From, to: R.frames.length - 1, label: "l'ultimo giro" },
    ],
    seg: 0, frac: 0, wIdx, speed: 0.5, segTime: 0,   // 0.5 = rallentatore; segTime = secondi nel segmento
  };
  state.replayPlay.i = state.replayPlay.segments[0].from;
  // Replay VERO: si riparte con TUTTI i fantini in sella; cadono poi al frame
  // giusto (vedi updateReplayWin). Pulisci i cloni caduti della gara appena finita.
  clearFallenRiders();
  state.horses.forEach((h) => {
    const rider = h.group && h.group.userData && h.group.userData.jockey;
    if (rider) rider.visible = true;
  });
  showScreen(null);
  state.mode = "replayWin";
  buildReplayHud(winner, state.replayPlay.segments[0].label);
}

function updateReplayWin(dt) {
  const R = state.replay, P = state.replayPlay;
  if (!R || !P) { endWinnerReplay(); return; }
  let seg = P.segments[P.seg];
  P.frac += (dt * P.speed) / 0.05;
  while (P.frac >= 1 && P.i < seg.to) { P.i += 1; P.frac -= 1; }
  // Fine del segmento → passa al prossimo, o chiudi il replay.
  if (P.i >= seg.to && P.frac >= 1) {
    if (P.seg < P.segments.length - 1) {
      P.seg += 1; seg = P.segments[P.seg]; P.i = seg.from; P.frac = 0; P.segTime = 0;
      const lab = document.getElementById("replayLabel");
      if (lab) lab.textContent = "Replay al rallentatore — " + seg.label;
    } else { endWinnerReplay(); return; }
  }
  const a = R.frames[P.i];
  const b = R.frames[Math.min(P.i + 1, R.frames.length - 1)];
  const f = clamp(P.frac, 0, 1);
  const time = clock.elapsedTime;
  state.horses.forEach((h, k) => {
    h.prevProgress = h.progress;
    h.progress = lerp(a[k][0], b[k][0], f);
    h.lane = lerp(a[k][1], b[k][1], f);
    h.laneVelocity = 0;
    h.heading = undefined;
    h.speedLevel = clamp((b[k][0] - a[k][0]) / 0.05 / 2.1, 0, 9);  // animazione dal moto reale
    placeHorse(h, time);
    // SCOSSO nel replay: mostra il fantino cadere nel frame in cui è caduto DAVVERO.
    const rider = h.group && h.group.userData && h.group.userData.jockey;
    if (rider) {
      const scossoNow = a[k][2] === 1;
      if (scossoNow && rider.visible) {
        rider.visible = false;
        // Se è caduto proprio ADESSO dentro questo segmento (frame prima era in
        // sella) → animazione della caduta; se era già scosso a inizio segmento
        // (caduto fuori dall'inquadratura) → resta scosso senza rianimare.
        const prev = R.frames[P.i - 1];
        if (P.i > seg.from && prev && prev[k] && prev[k][2] !== 1) spawnFallenRider(h, rider);
      } else if (!scossoNow && !rider.visible) {
        rider.visible = true;
      }
    }
  });
  // Se il giocatore ha scelto la camera "sui primi 3 dall'alto" (tasto C), vale
  // anche nel replay: sovrascrive la regia scriptata e insegue le prime tre.
  if (state.cameraMode === "top3" && computeTop3Camera(dt)) return;
  // Camera sul vincitore: da dietro, guardando la pista che arriva.
  const w = state.horses[P.wIdx];
  // ── PRIMA PARTE (la Mossa), regia in due tempi ────────────────────────────
  // Primi 3.5 SECONDI: inseguimento classico da dietro — si VEDE la mossa, il
  // canapo che cala, lo scatto. POI stacco sull'inquadratura aerea fissa sopra
  // San Martino, che guarda indietro verso la partenza: piazza gremita e gruppo
  // che arriva verso la curva. Il punto di vista è fermo; a muoversi è solo lo
  // sguardo, che segue il vincitore.
  P.segTime = (P.segTime || 0) + dt;
  if (P.seg === 0 && NARROW_READY && P.segTime >= 3.5) {
    const apex = sampleAt((SM_IN + SM_OUT) / 2);
    const fuori = campoOutward(apex.point);
    const camA = apex.point.clone().addScaledVector(fuori, 14).add(new THREE.Vector3(0, 38, 0));
    const lookA = w.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    state.cameraPosition.lerp(camA, clamp(dt * 2.2, 0, 1));
    state.cameraLook.lerp(lookA, clamp(dt * 3.0, 0, 1));
    camera.position.copy(state.cameraPosition);
    camera.lookAt(state.cameraLook);
    state.cameraFov += (52 - state.cameraFov) * clamp(dt * 3, 0, 1);
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
    return;
  }
  // ── INQUADRATURA LATERALE nel replay: da bordo pista (lato interno della piazza),
  // rialzata e teleobiettivo, così i SORPASSI si vedono di PROFILO. La camera scorre
  // di fianco al vincitore.
  const s = sampleAt(w.progress);
  const inward = campoOutward(s.point).clone().normalize().multiplyScalar(-1); // verso il centro
  const bob = Math.sin(clock.elapsedTime * 1.8) * 0.06;
  const camPos = w.group.position.clone()
    .addScaledVector(inward, 15)
    .addScaledVector(s.tangent, -2.0)
    .add(new THREE.Vector3(0, 7.6 + bob, 0));
  const look = w.group.position.clone()
    .addScaledVector(s.tangent, 2.4)
    .add(new THREE.Vector3(0, 1.2, 0));
  state.cameraPosition.lerp(camPos, clamp(dt * 3.2, 0, 1));
  state.cameraLook.lerp(look, clamp(dt * 3.6, 0, 1));
  camera.position.copy(state.cameraPosition);
  camera.lookAt(state.cameraLook);
  state.cameraFov += (44 - state.cameraFov) * clamp(dt * 3, 0, 1);   // teleobiettivo
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
}

function endWinnerReplay() {
  const hud = document.getElementById("replayHud");
  if (hud) hud.remove();
  state.replayPlay = null;
  state.mode = "finished";
  setHudVisible(false);
  showScreen("results");   // torna alla schermata della vincitrice
}

function buildReplayHud(winner, segLabel) {
  const old = document.getElementById("replayHud");
  if (old) old.remove();
  const hud = document.createElement("div");
  hud.id = "replayHud";
  hud.style.cssText = "position:fixed;inset:0;z-index:55;pointer-events:none;font-family:inherit;color:#f3e7cf";
  const label = document.createElement("div");
  label.id = "replayLabel";
  label.style.cssText = "position:absolute;top:26px;left:0;right:0;text-align:center;font-size:clamp(16px,2.6vw,26px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.75)";
  label.textContent = "Replay al rallentatore — " + (segLabel || "");
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Salta il replay";
  skip.style.cssText = "position:absolute;bottom:30px;left:50%;transform:translateX(-50%);pointer-events:auto;font:inherit;cursor:pointer;border-radius:10px;padding:10px 24px;border:1px solid rgba(240,203,53,.5);background:rgba(20,14,8,.72);color:#f3e7cf";
  skip.addEventListener("click", endWinnerReplay);
  hud.append(label, skip);
  document.body.appendChild(hud);
}

function renderFinalRanking() {
  // ARRIVO SEMPLIFICATO: al Palio conta solo CHI VINCE. Niente classifica
  // completa, niente piazzamenti: solo la Contrada vittoriosa, con la sua
  // BANDIERA VERA accanto al nome, e un messaggio scenico.
  ui.finalRanking.textContent = "";
  ui.finalRanking.style.display = "none";
  const heading = document.querySelector("#screenResults h2");
  if (heading) heading.style.display = "none";
  const winner = state.rankings[0];
  const banner = document.getElementById("winnerBanner");
  const flag = document.getElementById("winnerFlag");
  const wname = document.getElementById("winnerName");
  // In campagna "la tua Contrada" è quella del Capitano (nell'ASSISTI il cavallo-
  // focus è la RIVALE: se vince è una PURGA, non una vittoria tua).
  const cmp = state.campaign;
  const isMine = winner && (cmp && cmp.active ? winner.id === cmp.contrada.id : !!winner.player);
  const isRival = winner && cmp && cmp.active && cmp.rival && winner.id === cmp.rival.id;
  if (winner && banner && flag && wname) {
    // Bandiera ufficiale della contrada vincitrice (immagine vera).
    flag.style.background = `url("${BANDIERE[winner.id]}") center / cover no-repeat`;
    flag.style.backgroundColor = winner.colors[0];
    // "Vince la Contrada dell'Oca con Tittìa e Rocco Nice" — contrada, fantino e cavallo.
    const conChi = [winner.jockey && nickUp(winner.jockey.nick), winner.horseName].filter(Boolean).join(" e ");
    wname.textContent = `Vince la Contrada ${articoloContrada(winner.name)}${conChi ? ` con ${conChi}` : ""}`;
    banner.classList.toggle("player-win", isMine);
  }
  if (ui.resultSummary) {
    ui.resultSummary.textContent = isMine
      ? `La tua Contrada conquista il Palio! (${formatTime(winner.finishTime || state.raceClock)})`
      : isRival ? `PURGA! La rivale ${winner.name} conquista il drappellone.`
      : winner ? `${winner.name} conquista il drappellone.` : "";
  }
  // Tasto per rivedere il REPLAY al rallentatore (mossa + ultimo giro).
  if (ui.replayButton && ui.replayButton.parentElement && !document.getElementById("watchReplayButton")) {
    const btn = document.createElement("button");
    btn.id = "watchReplayButton";
    btn.className = "btn btn-ghost";
    btn.type = "button";
    btn.textContent = "▶ Rivedi al rallentatore";
    ui.replayButton.parentElement.insertBefore(btn, ui.replayButton.parentElement.firstChild);
    btn.addEventListener("click", startWinnerReplay);
  }
  // Tasto "Torna al menu principale" (openMenuScreen toglie l'audio). Nascosto in
  // campagna: lì, palio per palio, c'è "Continua la carriera".
  if (ui.replayButton && ui.replayButton.parentElement && !document.getElementById("tornaMenuButton")) {
    const mb = document.createElement("button");
    mb.id = "tornaMenuButton"; mb.className = "btn btn-ghost"; mb.type = "button";
    mb.textContent = "↩ Torna al menu principale";
    ui.replayButton.parentElement.appendChild(mb);
    mb.addEventListener("click", openMenuScreen);
  }
  const tmb = document.getElementById("tornaMenuButton");
  if (tmb) tmb.style.display = (state.campaign && state.campaign.active && !state.campaign.quick) ? "none" : "";
  campaignContinueButton();   // in campagna: nasconde i tasti singoli e mostra "Continua la carriera"
}

// "Vince la Contrada dell'Onda / della Torre / del Nicchio / dell'Aquila…"
function articoloContrada(nome) {
  const vocale = /^[aeiou]/i.test(nome);
  const femminili = ["Aquila", "Chiocciola", "Civetta", "Giraffa", "Lupa", "Oca", "Onda", "Pantera", "Selva", "Tartuca", "Torre"];
  if (femminili.includes(nome)) return vocale ? `dell'${nome}` : `della ${nome}`;
  return vocale ? `dell'${nome}` : `del ${nome}`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

// LA VISUALE NON CAMBIA MAI DA SOLA. Prima, cadendo, la camera passava
// automaticamente sulla testa della corsa e le tre inquadrature si alternavano a
// tempo: comodo in teoria, in pratica ti spostava l'occhio mentre stavi ancora
// giocando. Adesso la vista la decide SOLO il tasto C. Se cadi e vuoi guardare i
// primi, premi C: "laterale" e "aerea" passano da sole al cavallo in testa
// quando il tuo è fuori gioco.
const VISTE_CADUTA = ["alto", "laterale", "aerea"];   // (restano per il ciclo del tasto C)

// Chi sta davanti a tutti: le inquadrature da regia lo seguono quando il
// giocatore è a terra.
function primoInCorsa() {
  return state.horses.filter((h) => !h.isRincorsa && h.group)
    .sort((a, b) => (b.progress || 0) - (a.progress || 0))[0] || null;
}

// LE INQUADRATURE. Sono le stesse del replay del vincitore e valgono su
// QUALUNQUE soggetto: il tuo cavallo mentre corri, chi è in testa se sei a terra.
// Torna true se la vista ha preso il comando della camera.
function applicaVista(vista, primo, dt) {
  if (!primo || !primo.group) return false;

  if (vista === "alto") return computeTop3Camera(dt);   // dall'alto sulle prime tre

  if (vista === "aerea" && NARROW_READY) {
    // Aerea ferma sopra San Martino: il punto di vista non si muove, si muove solo
    // lo sguardo che insegue chi comanda.
    const apex = sampleAt((SM_IN + SM_OUT) / 2);
    const camA = apex.point.clone()
      .addScaledVector(campoOutward(apex.point), 14).add(new THREE.Vector3(0, 38, 0));
    state.cameraPosition.lerp(camA, clamp(dt * 2.2, 0, 1));
    state.cameraLook.lerp(primo.group.position.clone().add(new THREE.Vector3(0, 1, 0)), clamp(dt * 3, 0, 1));
    camera.position.copy(state.cameraPosition);
    camera.lookAt(state.cameraLook);
    state.cameraFov += (52 - state.cameraFov) * clamp(dt * 3, 0, 1);
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
    return true;
  }

  // Laterale da bordo pista, rialzata e col teleobiettivo: i sorpassi di profilo.
  const s = sampleAt(primo.progress);
  const dentro = campoOutward(s.point).clone().normalize().multiplyScalar(-1);
  const camPos = primo.group.position.clone()
    .addScaledVector(dentro, 15).addScaledVector(s.tangent, -2.0)
    .add(new THREE.Vector3(0, 7.6 + Math.sin(clock.elapsedTime * 1.8) * 0.06, 0));
  const look = primo.group.position.clone()
    .addScaledVector(s.tangent, 2.4).add(new THREE.Vector3(0, 1.2, 0));
  state.cameraPosition.lerp(camPos, clamp(dt * 3.2, 0, 1));
  state.cameraLook.lerp(look, clamp(dt * 3.6, 0, 1));
  camera.position.copy(state.cameraPosition);
  camera.lookAt(state.cameraLook);
  state.cameraFov += (44 - state.cameraFov) * clamp(dt * 3, 0, 1);
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
  return true;
}


function updateCamera(dt) {
  const player = getPlayer() || state.demoHorses[0];
  if (!player) return;
  const sample = sampleAt(player.progress);
  const playerFollowView = player.player && (state.mode === "mossa" || state.mode === "race" || state.mode === "finished");
  const inGameplay = state.mode === "mossa" || state.mode === "race" || state.mode === "finished";

  // Modalità camera (tasto C). In prima persona si nasconde il fantino.
  const fpActive = state.cameraMode === "firstperson" && player.player && inGameplay;
  if (player.group?.userData?.firstPersonHidden) {
    // Se sei CADUTO (cavallo scosso) il fantino resta a terra: NON va rimostrato
    // qui, altrimenti in vista follow/overhead ricomparirebbe ogni frame e il tuo
    // cavallo non si vedrebbe scosso come le altre contrade.
    const show = !fpActive && !player.scosso;
    player.group.userData.firstPersonHidden.forEach((part) => {
      part.visible = show;
    });
  }

  // ALLA MOSSA si guarda il PROPRIO cavallo. Al tondino e ai canapi le viste da
  // regia (laterale, aerea, sui primi tre, tutta la Piazza) non hanno senso —
  // inquadrano la testa di una corsa che non è ancora partita — quindi qui si
  // ricade sull'inseguimento. La scelta fatta col tasto C NON viene persa: torna
  // valida appena parte la corsa. La prima persona resta, perché è comunque una
  // vista sul proprio cavallo.
  // Alla mossa nessuna vista "da regia" si attiva: si scende fino
  // all'inseguimento classico, che è il comportamento di sempre al tondino.
  const inCorsa = state.mode !== "mossa";

  // Laterale e aerea scelte a mano col tasto C: inquadrano TE mentre corri, e chi
  // è in testa se il tuo cavallo è fuori gioco (a terra o scosso).
  if (inCorsa && inGameplay && (state.cameraMode === "laterale" || state.cameraMode === "aerea")) {
    const sogg = (player.caduto || player.scosso) ? primoInCorsa() : player;
    if (applicaVista(state.cameraMode, sogg, dt)) return;
  }

  // Camera sui primi 3 dall'alto (funziona anche in "assisti" e se il giocatore
  // è scosso: inquadra sempre le prime tre della classifica).
  if (inCorsa && inGameplay && state.cameraMode === "top3") {
    if (computeTop3Camera(dt)) return;
  }

  if (inCorsa && player.player && inGameplay && state.cameraMode === "overhead") {
    // Vista dall'alto sul centro reale del tracciato (in Z ~ -14), abbastanza in
    // quota da inquadrare tutto il semicerchio. Lenta rotazione attorno all'asse Y.
    const centerZ = -14;
    state.overheadAngle += 0.008 * dt;
    camera.position.set(0, 100, centerZ);
    camera.up.set(Math.sin(state.overheadAngle), 0, Math.cos(state.overheadAngle));
    camera.lookAt(0, 0, centerZ);
    camera.up.set(0, 1, 0);
    state.cameraFov += (62 - state.cameraFov) * clamp(dt * 4, 0, 1);
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
    return;
  }

  if (fpActive) {
    // Camera nello spazio locale del gruppo cavallo (occhi del fantino).
    const camPos = new THREE.Vector3(0, 2.55, 0.4);
    player.group.localToWorld(camPos);
    const heading = player.heading !== undefined
      ? player.heading
      : Math.atan2(sample.tangent.x, sample.tangent.z);
    const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const lookTarget = camPos.clone().addScaledVector(fwd, 12).add(new THREE.Vector3(0, -0.35, 0));
    state.cameraPosition.lerp(camPos, clamp(dt * 8, 0, 1));
    state.cameraLook.lerp(lookTarget, clamp(dt * 8, 0, 1));
    camera.position.copy(state.cameraPosition);
    camera.lookAt(state.cameraLook);
    state.cameraFov += (74 - state.cameraFov) * clamp(dt * 4, 0, 1);
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
    return;
  }
  if (state.mode === "mossa" && !player.player) {
    const start = sampleAt(-2.2);
    const canapo = sampleAt(0.25);
    const forward = start.tangent.clone().normalize();
    const right = start.normal.clone().normalize();
    const desiredPos = start.point
      .clone()
      .addScaledVector(forward, -8.2)
      .addScaledVector(right, -2.1)
      .add(new THREE.Vector3(0, 3.45, 0));
    const desiredLook = canapo.point.clone().addScaledVector(canapo.normal, 0.2).add(new THREE.Vector3(0, 1.15, 0));
    state.cameraPosition.lerp(desiredPos, clamp(dt * 3.2, 0, 1));
    state.cameraLook.lerp(desiredLook, clamp(dt * 3.4, 0, 1));
    camera.position.copy(state.cameraPosition);
    camera.lookAt(state.cameraLook);
    state.cameraFov += (72 - state.cameraFov) * clamp(dt * 4, 0, 1);
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
    return;
  }

  const playerPos = player.group.position.clone();
  const forward = sample.tangent.clone().normalize();
  const right = sample.normal.clone().normalize();
  const speedZoom = clamp(player.speedLevel / 10, 0, 1);

  let desiredPos;
  let desiredLook;
  let smooth;
  let targetFov;

  if (playerFollowView) {
    const lookDistance = state.mode === "mossa" ? 8.2 : 11.5 + player.speedLevel * 1.05;
    const aheadSample = sampleAt(player.progress + lookDistance);
    const gallopPhase = clock.elapsedTime * (6.5 + player.speedLevel * 1.15) + player.phase;
    const bobStrength = state.mode === "race" ? clamp(player.speedLevel / 10, 0.28, 1) : 0.22;
    const droneBob = Math.sin(gallopPhase) * 0.055 * bobStrength;
    const brakeTuck = player.braking ? 1.1 : 0;
    // In gara la camera segue l'heading manuale del cavallo (sta dietro al muso
    // e guarda dove punta), così il giocatore vede l'effetto del proprio sterzo.
    // Alla mossa resta agganciata alla direzione della pista.
    const useHeadingCam = player.player && player.heading !== undefined && state.mode === "race";
    const camForward = useHeadingCam
      ? new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading))
      : forward;
    desiredPos = playerPos
      .clone()
      .addScaledVector(camForward, -9.2 - speedZoom * 1.55 + brakeTuck)
      .add(new THREE.Vector3(0, 5.85 + speedZoom * 0.52 + droneBob, 0));
    if (useHeadingCam) {
      // mira un po' avanti lungo l'heading, miscelando con la pista che arriva
      // per anticipare la curva.
      desiredLook = playerPos
        .clone()
        .addScaledVector(camForward, lookDistance * 0.7)
        .lerp(aheadSample.point.clone(), 0.35)
        .add(new THREE.Vector3(0, 1.05 + speedZoom * 0.12, 0));
    } else {
      desiredLook = aheadSample.point
        .clone()
        .addScaledVector(aheadSample.normal, player.lane * 0.55 + player.laneVelocity * 0.06)
        .add(new THREE.Vector3(0, 1.05 + speedZoom * 0.12, 0));
    }
    smooth = clamp(dt * (state.mode === "mossa" ? 3.2 : player.sliding ? 3.8 : 4.55), 0, 1);
    targetFov = state.mode === "mossa"
      ? 59
      : 61 + speedZoom * 4.5 + (player.boosting ? 1.5 : 0) - (player.braking ? 1.2 : 0);
  } else {
    const aheadSample = sampleAt(player.progress + 7.5 + player.speedLevel * 1.05);
    const brakeTuck = player.braking ? 0.8 : 0;
    desiredPos = playerPos
      .clone()
      .addScaledVector(forward, -4.1 - speedZoom * 0.58 + brakeTuck * 0.52)
      .addScaledVector(right, -player.lane * 0.12)
      .add(new THREE.Vector3(0, 2.42 + speedZoom * 0.22, 0));
    desiredLook = aheadSample.point.clone().addScaledVector(aheadSample.normal, player.lane * 0.18).add(new THREE.Vector3(0, 1.56, 0));
    smooth = clamp(dt * (player.sliding ? 3.4 : 4.7), 0, 1);
    targetFov = 67 + speedZoom * 14 + (player.boosting ? 6 : 0) - (player.braking ? 4 : 0);
  }

  state.cameraPosition.lerp(desiredPos, smooth);
  state.cameraLook.lerp(desiredLook, smooth);

  const gallopShake = state.mode === "race" ? clamp((player.speedLevel - 5.8) / 4.2, 0, 1) * 0.032 : 0;
  // Tetto allo shake totale: niente tremolio violento anche con più urti.
  const shake = Math.min(state.cameraShake + gallopShake, 0.4);
  state.cameraShake = Math.max(0, state.cameraShake - dt * 1.6);
  tmpVec.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.55, 0);
  camera.position.copy(state.cameraPosition).add(tmpVec);
  tmpLook.copy(state.cameraLook);
  camera.lookAt(tmpLook);

  state.cameraFov += (targetFov - state.cameraFov) * clamp(dt * 4.2, 0, 1);
  camera.fov = state.cameraFov;
  camera.updateProjectionMatrix();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function bindEvents() {
  ui.playButton.addEventListener("click", () => {
    try { playPalioSound("intro.m4a", { volume: 0.5 }); } catch (e) { /* niente */ }   // musica dei titoli, si ferma all'estrazione
    openModeChooser();
  });
  const alboBtn = document.getElementById("alboButton");
  if (alboBtn) alboBtn.addEventListener("click", () => {
    openAlboVittorie();                       // apre subito con i dati che ho
    // e intanto riscarico l'albo GLOBALE: se cambia, ridisegno l'overlay aperto.
    fetchGlobalAlbo().then((a) => { if (a && document.getElementById("alboOverlay")) openAlboVittorie(); });
  });
  const suggestBtn = document.getElementById("suggestBtn");
  if (suggestBtn) suggestBtn.addEventListener("click", openSuggestOverlay);
  ui.backToMenuButton.addEventListener("click", openMenuScreen);
  { const sb = document.getElementById("settingsBtn"); if (sb) sb.addEventListener("click", openSettingsScreen); }
  // "Vai alla Mossa" / "Corri di nuovo": prima si sceglie il Palio (luglio /
  // agosto / straordinario) → ESTRAZIONE delle Contrade (bandiere al Palazzo)
  // → TRATTA (sorteggio dei cavalli) → mossa/tondino.
  ui.startMossaButton.addEventListener("click", () => {
    if (state.campaign && state.campaign.setup) campaignConfirmContrada();  // → diventa Capitano
    else openPalioChooser();                                               // paliata veloce
  });
  ui.replayButton.addEventListener("click", openPalioChooser);
  // "Riparti dalla Mossa": rigioca SUBITO con gli stessi cavalli/accoppiate
  // della Tratta appena corsa, senza rifare estrazione e sorteggio.
  const restartMossaButton = document.createElement("button");
  restartMossaButton.id = "restartMossaButton";
  restartMossaButton.className = "btn btn-ghost";
  restartMossaButton.type = "button";
  restartMossaButton.textContent = "Riparti dalla Mossa";
  ui.replayButton.parentElement.insertBefore(restartMossaButton, ui.replayButton);
  restartMossaButton.addEventListener("click", () => startMossa(true));
  ui.changeContradaButton.addEventListener("click", openSelectScreen);
  if (ui.camButton) {
    ui.camButton.addEventListener("click", cycleCameraMode);
  }
  document.querySelectorAll(".diff-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.difficulty = button.dataset.d;
      document.querySelectorAll(".diff-btn").forEach((other) => {
        other.classList.toggle("selected", other === button);
      });
    });
  });

  window.addEventListener("keydown", (event) => {
    // Se stai scrivendo in un campo (nome capitano, password): la tastiera DEVE
    // scrivere ogni lettera — il gioco non intercetta nulla (fix: prima "mangiava"
    // S/A/L/M/W/Q/P perché sono comandi di gara).
    if (uiIsTyping(event)) return;
    // INVIO fuori dai campi: avanza / salta / conferma la fase corrente.
    if (event.key === "Enter") { event.preventDefault(); uiActivate(); return; }
    // Frecce: scorrono i pulsanti dei menu (comodo anche senza gamepad).
    if (!isRaceMode() && (event.key === "ArrowLeft" || event.key === "ArrowUp")) { event.preventDefault(); uiMoveFocus(-1); return; }
    if (!isRaceMode() && (event.key === "ArrowRight" || event.key === "ArrowDown")) { event.preventDefault(); uiMoveFocus(1); return; }
    const code = event.code;
    if (!["KeyA", "KeyL", "KeyW", "KeyS", "KeyM", "KeyK", "Space", "KeyC", "Tab", "KeyQ", "KeyP"].includes(code)) return;
    event.preventDefault();
    if (code === "KeyC") {
      if (event.repeat) return;
      cycleCameraMode();
      return;
    }
    if (!event.repeat) {
      ensureAudio();
      if (state.audio.ctx && state.audio.ctx.state === "suspended") {
        state.audio.ctx.resume();
      }
      // La VELOCITÀ (andatura) si regola con M/W (su) e SPAZIO (giù), sia in gara
      // sia alla mossa. NB: S NON è più il freno (Spazio lo è) → S = nerbata sinistra.
      const speedDial = state.mode === "race" || state.mode === "mossa";
      if ((code === "KeyM" || code === "KeyW") && speedDial) {
        adjustPlayerSpeed(1);
      } else if (code === "Space" && speedDial) {
        adjustPlayerSpeed(-1);
      } else if ((code === "KeyK" || code === "KeyS") && (state.mode === "race" || state.mode === "mossa")) {
        // NERBATA deliberata del giocatore: K = DESTRA (+1), S = SINISTRA (−1). Vale
        // sia in gara sia ai canapi. (side +1 = destra = lane maggiore, coerente con
        // vicinoDiLato e con l'animazione della frusta.)
        const pl = state.horses.find((h) => isHuman(h));
        if (pl) tiraNerbata(pl, code === "KeyK" ? 1 : -1, state.mode === "mossa" ? "mossa" : "race");
      }
    }
    // Tasti TENUTI: A/L (sterzo in gara, gira il cavallo alla mossa) e Q/P
    // (spinta laterale dentro i canapi: Q=sinistra, P=destra). getControls li
    // legge da state.keys, quindi vanno registrati alla pressione e tolti al
    // rilascio (keyup fa già delete di qualsiasi code).
    if (code === "KeyA" || code === "KeyL" || code === "KeyQ" || code === "KeyP") {
      state.keys.add(code);
    }
  });
  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.code);
  });
  // Freccette laterali (basso a destra): spinta di lato ai canapi (Q/P).
  ui.touchControls.querySelectorAll("[data-touch]").forEach((button) => {
    const key = button.dataset.touch;
    // NERBO: colpo SINGOLO alla pressione (non uno stato tenuto come le frecce).
    if (key === "nerb") {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        playerTouchNerbata();
      });
      return;
    }
    // Tastini ANDATURA (sinistra): un colpo per pressione, come X/O del controller.
    if (key === "gaitUp" || key === "gaitDown") {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        adjustPlayerSpeed(key === "gaitUp" ? 1 : -1);
      });
      return;
    }
    const set = (value) => { state.touch[key] = value; };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    });
    button.addEventListener("pointerup", () => set(false));
    button.addEventListener("pointercancel", () => set(false));
    button.addEventListener("pointerleave", () => set(false));
  });
  bindTouchStick();   // (compat: no-op se il vecchio joystick non c'è più)
  // MOBILE: sterzo con le FRECCE a schermo (l'inclinazione non era affidabile → tolta).
  if (IS_TOUCH_DEVICE) {
    // Blocco orizzontale best-effort (dove il browser lo consente; su iOS Safari
    // no → ci pensa l'avviso "ruota il dispositivo").
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {}); } catch (e) { /* niente */ }
  }
  window.addEventListener("blur", () => {
    state.keys.clear();
    Object.keys(state.touch).forEach((key) => {
      state.touch[key] = false;
    });
  });
  window.addEventListener("resize", resize);
  // Controller PlayStation: X marcia su, O marcia giù, levetta sinistra sterza.
  window.addEventListener("gamepadconnected", () => {
    showMessage("Controller collegato — X: marcia su · O: marcia giù · levetta sx: sterza", 3.0, "good");
  });
}

function update(dt, time) {
  state.nervClock = (state.nervClock || 0) + dt;   // orologio unico del nervosismo
  if (state.horses && state.horses.length) tickNerbate(dt);   // ricarica/cooldown nerbate
  updateHorseGlb(dt);   // PRIMA dei rami: il galoppo GLB anima anche nel replay
  pollGamepad();
  updateMessage(dt);
  updateDust(dt);
  updateConfetti(dt);
  updateAtmosphere(dt, time);
  refreshCampaignMoney();   // soldi del giocatore sempre in alto a dx fino alla corsa
  refreshMenuHomeBtn();     // "‹ Menu" in alto a sx in ogni fase tranne il menu
  refreshSpectateSkipBtn(); // "Salta all'avvio" solo mentre assisti alla mossa della rivale
  if (ui.touchControls) ui.touchControls.classList.toggle("race-mode", state.mode === "race");   // in corsa: via lo scorrimento laterale
  updateFallenRiders(dt);   // fantini caduti a terra (animazione + sparizione a 15s)
  maybeCanapiForceWarning(dt);   // avviso "forzi il canape" se tieni andatura 5 alla mossa
  if (state.mode === "estrazione") {
    updateEstrazione(dt, time);   // gestisce anche la propria camera
    updateAudio(dt);
    updateHud(dt);
    return;
  }
  if (state.mode === "tratta") {
    updateTratta(dt, time);   // gestisce anche la propria camera
    updateAudio(dt);
    updateHud(dt);
    return;
  }
  if (state.mode === "scelta") {
    // Scelta del fantino: UI DOM guidata da timer; i cavalli restano fermi in
    // fila (come alla Tratta) e la camera tiene l'inquadratura sul Palazzo.
    state.horses.forEach((h) => placeHorse(h, time));
    return;
  }
  if (state.mode === "replayWin") {
    updateReplayWin(dt);      // gestisce anche la propria camera
    updateHud(dt);
    return;
  }
  // Fotografia del nervosismo PRIMA che mossa/gara lo tocchino.
  state.horses.forEach((h) => { h.nervPrevFrame = h.nervousnessCurrent || 0; });

  if (state.mode === "menu" || state.mode === "select") {
    updateDemo(dt, time);
  } else if (state.mode === "mossa") {
    updateMossa(dt, time);
  } else if (state.mode === "race") {
    // La mossa falsa E' modalita' corsa: passa dal runout, che chiama updateRace
    // e dopo 4 secondi la interrompe col mortaretto.
    if (state.falseStartRunning) updateFalseStartRunout(dt, time);
    else updateRace(dt, time);
  } else if (state.mode === "finished") {
    state.horses.forEach((horse) => updateAiHorse(horse, dt * 0.45, time));
  }

  // TETTO DURO alla SALITA del nervosismo: qualunque cosa abbia scritto qui sopra,
  // e da quante Contrade il cavallo sia stato colpito nello stesso istante, non può
  // salire più di NERV_MAX_RISE al secondo. La discesa non è limitata.
  //
  // A CREDITO, non a clamp per frame. Prima era `prima + NERV_MAX_RISE * dt`, cioè
  // un tetto di 0.0005 per frame a 60fps: siccome la BOTTA è un gradino istantaneo
  // di +0.01, ne passava un ventesimo. Sotto pressione ininterrotta il nervosismo
  // arrivava all'1.7% dopo un MINUTO — la botta era di fatto disattivata.
  // Il credito si ricarica di NERV_MAX_RISE al secondo e vale al massimo UNA botta:
  // così una botta singola passa INTERA (e la cadenza resta quella del cooldown,
  // 0.01 ogni 1.8s = 0.0056/s), mentre più sorgenti nello stesso istante trovano
  // il credito già speso e vengono tagliate.
  state.horses.forEach((h) => {
    let credito = Math.min(NERV_HIT_GAIN, (h.nervRiseCredit ?? NERV_HIT_GAIN) + NERV_MAX_RISE * dt);
    const salita = (h.nervousnessCurrent || 0) - (h.nervPrevFrame ?? 0);
    if (salita > 0) {
      const concesso = Math.min(salita, credito);
      h.nervousnessCurrent = (h.nervPrevFrame ?? 0) + concesso;
      credito -= concesso;
    }
    h.nervRiseCredit = credito;
  });

  updateAudio(dt);
  updateCamera(dt);
  updateHud(dt);
}

function renderRincorsaMiniCam() {
  const el = document.getElementById("rincorsaWatcher");
  const rincorsa = state.horses.find((h) => h.isRincorsa);
  const active = !!(rincorsa && !rincorsa.player && state.mode === "mossa" && rincorsa.group && rincorsa.revealed);
  if (el) el.classList.toggle("visible", active);
  if (!active || !el) return;

  // Camera VICINA alla rincorsa e alta, allineata alla corsia ESTERNA: il gruppo
  // (più interno) resta di lato e non la copre. 13m avanti, 10.5m d'altezza →
  // sguardo ravvicinato e inclinato verso il basso, sopra le teste del gruppo.
  const rLane = rincorsa.mossaLane ?? RINCORSA_LANE;   // corsia esterna della rincorsa
  // Camera più vicina e bassa → zoom maggiore su rincorsa + verrocchino (anche da PC).
  // SEGUE la rincorsa (posizione avanti a lei, sguardo sul cavallo) e zooma sul
  // cavallo — ancora di più su telefono (near/high più stretti + FOV più chiuso).
  const near = IS_TOUCH_DEVICE ? 6.2 : 8.5;
  const high = IS_TOUCH_DEVICE ? 5.0 : 7.0;
  const fov = IS_TOUCH_DEVICE ? 46 : 62;   // più stretto = più zoom sul cavallo (era 78)
  if (Math.abs((rincorsaMiniCam.fov || 0) - fov) > 0.01) { rincorsaMiniCam.fov = fov; rincorsaMiniCam.updateProjectionMatrix(); }
  const camProgress = rincorsa.mossaProgress + near;
  const cs = sampleAt(camProgress);
  rincorsaMiniCam.position.copy(cs.point)
    .addScaledVector(cs.normal, rLane * 0.85)          // sull'esterno, in linea con la rincorsa
    .add(new THREE.Vector3(0, high, 0));
  rincorsaMiniCam.lookAt(
    rincorsa.group.position.clone().add(new THREE.Vector3(0, 0.5, 0))
  );

  // Riquadro REALE dal DOM: così il render combacia SEMPRE col bordo (desktop e
  // mobile), qualunque sia posizione/dimensione della .rincorsa-watcher in CSS.
  const r = el.getBoundingClientRect();
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  const glY = window.innerHeight - r.top - h;   // Y dal basso (coordinate CSS)
  const asp = w / h;
  if (Math.abs((rincorsaMiniCam.aspect || 0) - asp) > 0.001) { rincorsaMiniCam.aspect = asp; rincorsaMiniCam.updateProjectionMatrix(); }
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, glY, w, h);
  renderer.setViewport(r.left, glY, w, h);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, rincorsaMiniCam);
  renderer.autoClear = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.033);
  const time = clock.elapsedTime;
  update(dt, time);
  renderer.render(scene, camera);
  renderRincorsaMiniCam();
  if (state.horses.length && (state.mode === "race" || state.mode === "mossa" || state.mode === "finished")) {
    drawMinimap();
  }
  requestAnimationFrame(frame);
}

function markGameReady() {
  boot.ready = true;
  boot.showSelect = openSelectScreen;
  boot.showMenu = openMenuScreen;
  boot.startMossa = startMossa;
  boot.error = "";
  window.dispatchEvent(new CustomEvent("palio-ready"));
}

function reportBootError(error) {
  boot.ready = false;
  boot.error = error?.message || "Errore sconosciuto";
  window.dispatchEvent(new CustomEvent("palio-error", {
    detail: "Errore grafica 3D: ricarica la pagina"
  }));
}

// ══ PASSWORD DEL GIOCO ═══════════════════════════════════════════════════════
// Gate leggero per tenere fuori i curiosi: NON è vera sicurezza (chi apre il
// codice la vede). Per cambiarla, modifica SOLO questa riga:
// La password cambia il 18 agosto 2026 alle 18:00: da "vincitore" a "vittorioso".
// Da quel momento, chi era già entrato deve reinserirla (l'unlock vecchio non vale
// più) e vede il messaggio "la password è cambiata".
const PW_CUTOVER = new Date(2026, 7, 18, 18, 0, 0).getTime();   // 18 ago 2026, 18:00 (mese 7 = agosto)
const PW_CHANGED = Date.now() >= PW_CUTOVER;
const GAME_PASSWORD = PW_CHANGED ? "vittorioso" : "vincitore";
const PW_UNLOCK_TOKEN = PW_CHANGED ? "v2" : "1";   // valore salvato quando si sblocca (per era password)
// MANUTENZIONE: quando true, TUTTI i giocatori (tranne Mario Rossi) vengono bloccati
// all'ingresso con una schermata "stiamo aggiornando", al posto della password.
const MAINTENANCE = true;
// Id votante stabile per-dispositivo (il sondaggio è prima del login): un voto per device.
function getVoterId() {
  let v = null;
  try { v = localStorage.getItem("palio.voterId"); } catch (e) { /* niente */ }
  if (!v) {
    v = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem("palio.voterId", v); } catch (e) { /* niente */ }
  }
  return v;
}
// ── CAVALLI PROPOSTI DAI GIOCATORI E ACCETTATI DALL'ADMIN ────────────────────
// Un cavallo accettato entra nel roster con stat sintetizzate DETERMINISTICAMENTE
// dal nome (stabili tra un caricamento e l'altro), nei range della sua fascia.
function horseSeedFromName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) { h ^= name.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h >>> 0;
}
function statsForAcceptedHorse(tier, name) {
  const s = horseSeedFromName(name);
  const frac = (salt) => (((s >> salt) & 0xffff) % 1000) / 1000;   // 0..1 deterministico
  let stamina;
  if (tier === "brenna") stamina = Math.round(70 + frac(1) * 14);      // 70-84
  else if (tier === "bombolone") stamina = Math.round(92 + frac(1) * 8); // 92-100
  else stamina = Math.round(81 + frac(1) * 9);                          // bono 81-90
  // shift SENZA segno (>>>): con >> alcuni nomi davano modulo NEGATIVO (calma/turns < 1).
  return { tier, stamina, potenza: 1 + (s % 5), calma: 1 + ((s >>> 4) % 5), turns: 1 + ((s >>> 8) % 5) };
}
function applyAcceptedHorses(map) {
  if (!map) return;
  propostiCavalli = map;   // da rimettere dopo un cambio d'epoca
  Object.keys(map).forEach((name) => {
    const nm = String(name || "").trim();
    if (!nm) return;
    const tier = String(map[name] || "bono").toLowerCase();
    if (!HORSE_ROSTER[nm]) HORSE_ROSTER[nm] = statsForAcceptedHorse(tier, nm);
    else HORSE_ROSTER[nm].tier = tier;   // se l'admin cambia il tier, aggiornalo
    if (TRATTA_HORSE_NAMES.indexOf(nm) < 0) TRATTA_HORSE_NAMES.push(nm);
  });
}
// ── CACHE elenchi che cambiano di RADO (cavalli/fantini accettati, override stat):
// stanno uguali finché l'admin non tocca qualcosa, ma prima venivano riletti dal
// server a OGNI caricamento pagina (~8-10 comandi a load). Ora si leggono al più
// una volta ogni ACCEPTED_TTL_MS; per il resto si applicano dalla cache locale.
const ACCEPTED_TTL_MS = 10 * 60 * 1000;   // 10 minuti
function bustAcceptedCache() {   // l'admin ha cambiato qualcosa → forza riletture fresche
  ["palio.cache.horses", "palio.cache.jockeys", "palio.cache.overrides"].forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) { /* niente */ }
  });
}
function cachedAccepted(key, action, extra, applyFn, pick, always, cb) {
  const done = () => { if (always) always(); if (cb) cb(); };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && (Date.now() - (c.t || 0)) < ACCEPTED_TTL_MS) { if (c.d) applyFn(c.d); done(); return; }
    }
  } catch (e) { /* cache illeggibile: si rilegge dal server */ }
  fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ action }, extra || {})) })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok) {
        const payload = pick(d);
        try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: payload })); } catch (e) { /* niente */ }
        applyFn(payload);
      }
      done();
    })
    .catch(() => { done(); });
}
function fetchAcceptedHorses(cb) {
  cachedAccepted("palio.cache.horses", "acceptedHorses", null,
    (p) => applyAcceptedHorses(p || {}), (d) => d.horses || {}, null, cb);
}
// Fantini proposti e accettati → aggiunti a JOCKEYS con stat deterministiche dal nome.
// Statistiche FISSE per alcuni fantini accettati (impostate a mano). {m,d,t,f,c,ing}.
const JOCKEY_STATS_OVERRIDE = {
  trecciolino: { m: 4, d: 4, t: 3, f: 5, c: 5, ing: 116 },
  aceto: { m: 4, d: 4, t: 5, f: 2, c: 5, ing: 150 },
  Spago: { m: 2, d: 3, t: 4, f: 5, c: 2, ing: 60 },
  "Michel putzu": { m: 1, d: 1, t: 1, f: 1, c: 1, ing: 44 },
  "Dè": { m: 3, d: 2, t: 3, f: 2, c: 3, ing: 86 },
};
// Nome completo (Nome Cognome) per soprannome — dati REALI da ilpalio.org.
// (Bruschelli non è un soprannome reale ma un cognome → nome plausibile.)
const JOCKEY_NAMES = {
  trecciolino: "Luigi Bruschelli", aceto: "Andrea Degortes",
  Spago: "Michel Putzu", "Michel putzu": "Michel Putzu", "Dè": "Luca Minisini",
  Carburo: "Giosuè Carboni", cianchino: "Salvatore Ladu", Ragno: "Silvano Bietolini",
  Bruschelli: "Carlo Bruschelli", Salasso: "Alberto Ricceri", Velluto: "Dino Pes",
  Cittino: "Vieri Luschi", "Andrea sanna": "Andrea Sanna", Virgola: "Andrea Sanna", turbine: "Elias Mannucci",
};
function statsForAcceptedJockey(name) {
  const s = horseSeedFromName(name);
  const st = (salt) => 1 + ((s >>> salt) % 5);   // 1..5 (>>> senza segno: niente valori negativi)
  const ov = JOCKEY_STATS_OVERRIDE[name];
  const mossa = ov ? ov.m : st(0), difesa = ov ? ov.d : st(3), terzo = ov ? ov.t : st(6),
    fedelta = ov ? ov.f : st(9), curva = ov ? ov.c : st(12);
  const ingaggio = ov ? ov.ing : 20 + (mossa + difesa + terzo + curva) * 6;
  return { nome: JOCKEY_NAMES[name] || "—", nick: name, mossa, difesa, terzo, fedelta, curva, ingaggio, fittizio: true };
}
// DOPPIONI da fondere: "Michel putzu" È il soprannome Spago · "Andrea sanna" È Virgola
// · "Bruschelli" È Trecciolino (Gigi/Luigi Bruschelli). Si scartano: resta un solo
// fantino per persona (si tiene Spago, Virgola, trecciolino).
const JOCKEY_DUP_SKIP = new Set(["Michel putzu", "Andrea sanna", "Bruschelli"]);
function applyAcceptedJockeys(map) {
  if (!map) return;
  propostiFantini = map;   // idem
  Object.keys(map).forEach((name) => {
    const nm = String(name || "").trim().slice(0, 24);
    if (!nm || JOCKEY_DUP_SKIP.has(nm)) return;
    if (!JOCKEYS.some((j) => j.nick === nm)) JOCKEYS.push(statsForAcceptedJockey(nm));
  });
}
function fetchAcceptedJockeys(cb) {
  cachedAccepted("palio.cache.jockeys", "accepted", { kind: "jockey" },
    (p) => applyAcceptedJockeys(p || {}), (d) => d.items || {}, null, cb);
}
// OVERRIDE STAT decisi dall'admin (approva/cambia i voti): li applica a roster/fantini.
const HORSE_STAT_MAP = { potenza: "potenza", turn: "turns", turns: "turns", stamina: "stamina", calma: "calma" };
function applyStatOverrides(data) {
  if (!data) return;
  Object.keys(data.horse || {}).forEach((f) => {
    const i = f.lastIndexOf("|"); if (i < 0) return;
    const name = f.slice(0, i), stat = HORSE_STAT_MAP[f.slice(i + 1)];
    const v = Number(data.horse[f]);
    if (name && stat && HORSE_ROSTER[name] && v >= 1) HORSE_ROSTER[name][stat] = v;
  });
  Object.keys(data.jockey || {}).forEach((f) => {
    const i = f.lastIndexOf("|"); if (i < 0) return;
    const nick = f.slice(0, i), stat = f.slice(i + 1);
    const v = Number(data.jockey[f]);
    const jk = JOCKEYS.find((j) => j.nick === nick);
    if (jk && ["mossa", "difesa", "terzo", "fedelta", "curva", "ingaggio"].indexOf(stat) >= 0 && v >= 0) jk[stat] = v;
  });
}
// CORREZIONI FINALI (istruzioni dirette dell'utente): vincono su TUTTO — generato,
// JOCKEY_STATS_OVERRIDE e override admin (Redis). Si applicano sempre, per ultime.
const STAT_FINAL_JOCKEY = {
  Velluto: { mossa: 3, terzo: 2 },
  Brio: { mossa: 3, curva: 3 },
  Virgola: { mossa: 1 },
  // "Bruschelli" = Trecciolino (Gigi/Luigi Bruschelli), come indicato dall'utente.
  trecciolino: { mossa: 4, terzo: 4, curva: 3, difesa: 2 },
  cianchino: { curva: 2, fedelta: 2, terzo: 4 },
  aceto: { mossa: 3 },   // −1 sulla mossa (era 4)
  Grido: { terzo: 4 },              // era 5
  "Tittìa": { mossa: 5, terzo: 4 }, // mossa 5, terzo 4
};
const STAT_FINAL_HORSE = {};
function applyFinalCorrections() {
  Object.keys(STAT_FINAL_JOCKEY).forEach((nick) => {
    const jk = JOCKEYS.find((j) => j.nick === nick);
    if (jk) Object.assign(jk, STAT_FINAL_JOCKEY[nick]);
  });
  Object.keys(STAT_FINAL_HORSE).forEach((name) => {
    if (HORSE_ROSTER[name]) Object.assign(HORSE_ROSTER[name], STAT_FINAL_HORSE[name]);
  });
}
function fetchStatOverrides(cb) {
  cachedAccepted("palio.cache.overrides", "statOverrides", null,
    (p) => applyStatOverrides(p || {}),
    (d) => ({ horse: d.horse || {}, jockey: d.jockey || {} }),
    applyFinalCorrections, cb);
}

// Novità fatte GRAZIE ALLE RICHIESTE dei giocatori (solo migliorie vere e visibili;
// niente modifiche interne/di bilanciamento riservate).
const CHANGELOG_NOVITA = [
  ["🎉", "Abbiamo introdotto nuovi cavalli e fantini come richiesto!!!!", "Grazie alle vostre proposte: nuovi barberi e nuovi fantini sono già in gioco."],
  ["📱", "Gioco ottimizzato da telefono e iPad", "Frecce a schermo: ◀▶ curva a destra (sterzo, anche in corsa), ▲▼ andatura e ◀▶ scorrimento a sinistra, tasto NERBO, schermo bloccato in orizzontale."],
  ["🎓", "Tutorial iniziale per i nuovi", "Istruzioni per PC, controller e telefono appena crei l'account."],
  ["🏛️", "Piazza del Campo rifatta", "Torre del Mangia, Palazzo Pubblico e Cappella di Piazza, pavimentazione a spicchi col bordo in travertino."],
  ["👤", "Il tuo profilo", "Tieni traccia dei tuoi palii corsi e vinti."],
  ["🏆", "Albo delle Vittorie", "Condiviso con tutta Siena, e tutto il mondo!"],
  ["⚖️", "Corsa più equilibrata", "Chi resta troppo indietro viene riavvicinato: più testa a testa fino al bandierino."],
  ["🤝", "Accordi e corruzioni fra contrade", "In Campagna puoi trattare la mossa, parare la rivale e comprare fantini altrui."],
  ["🏇", "Modalità Campagna da Capitano", "Stagione di palii, budget, aste della rincorsa e fantini che non tradiscono subito."],
  ["🗳️", "La vostra voce sui cavalli e fantini", "Sondaggio sui cavalli, proposta di nuovi cavalli e nuovi fantini: decidete voi."],
  ["💬", "Feedback e consigli", "Ci dite come migliorare il gioco e noi lo facciamo."],
];
// STEP 1: le NOVITÀ fatte grazie ai giocatori, con il tasto Skip → apre il sondaggio.
function showMaintenanceIntro() {
  if (document.getElementById("maintIntro") || document.getElementById("maintGate") || document.getElementById("pwGate")) return;
  const ov = document.createElement("div");
  ov.id = "maintIntro";
  ov.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;"
    + "background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:22px 16px;text-align:center;overflow-y:auto";
  const items = CHANGELOG_NOVITA.map(([ic, t, d]) =>
    '<div style="display:flex;gap:12px;align-items:flex-start;text-align:left;background:rgba(255,246,225,.04);border:1px solid rgba(240,203,53,.16);border-radius:12px;padding:11px 14px">'
    + `<div style="font-size:22px;line-height:1">${ic}</div>`
    + `<div><div style="font-weight:800;font-size:15px;color:#f6e6bd">${t}</div>`
    + `<div style="opacity:.75;font-size:13px;margin-top:2px">${d}</div></div></div>`).join("");
  ov.innerHTML =
    '<div style="max-width:min(640px,94vw);width:100%;display:flex;flex-direction:column;align-items:center;gap:14px">'
    + '<div style="font-size:clamp(18px,3.2vw,30px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;font-weight:800;margin-top:8px">Palio Game</div>'
    + '<div style="font-size:clamp(22px,5vw,38px);line-height:1.15;font-weight:800;max-width:min(640px,92vw)">Le novità fatte grazie alle vostre richieste</div>'
    + '<div style="opacity:.8;font-size:clamp(13px,2.4vw,16px);max-width:min(520px,90vw)">Grazie a chi gioca e ci scrive: ecco cosa è cambiato.</div>'
    + `<div style="width:100%;display:flex;flex-direction:column;gap:8px;margin-top:4px">${items}</div>`
    + '<button type="button" id="maintSkip" style="font:inherit;font-size:17px;font-weight:800;padding:12px 44px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer;margin:10px 0 20px">Continua ›</button>'
    + '</div>';
  document.body.appendChild(ov);
  // Skip → password gate. RIMOSSO il sondaggio "vota le statistiche cavalli/fantini"
  // (showMaintenanceGate): non si passa più da lì.
  ov.querySelector("#maintSkip").addEventListener("click", () => { ov.remove(); showPasswordPrompt(); });
}
// STEP 2: sondaggio STATISTICHE — i giocatori votano Potenza e Turn (1..5) di ogni
// cavallo. Cavalli in classifica per fascia: Brenna → Bono → Bombolone.
function showMaintenanceGate() {
  if (document.getElementById("maintGate")) return;
  const voter = getVoterId();
  const TORD = { brenna: 0, bono: 1, bombolone: 2 };
  const TLAB = { brenna: "Brenna", bono: "Bono", bombolone: "Bombolone" };
  const TCOL = { brenna: "#d79c81", bono: "#e7d18a", bombolone: "#9fe3a6" };
  const STATS = [{ id: "potenza", label: "Potenza" }, { id: "turn", label: "Turn" }];
  const ov = document.createElement("div");
  ov.id = "maintGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;"
    + "background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:20px 16px;text-align:center;overflow-y:auto";
  const enc = encodeURIComponent;
  // La lista si costruisce DOPO aver caricato i cavalli accettati; è in CLASSIFICA
  // per fascia (Brenna → Bono → Bombolone), con un'intestazione per gruppo.
  const buildRows = () => {
    const list = ov.querySelector("#mgList");
    if (!list) return;
    const names = Object.keys(HORSE_ROSTER).sort((a, b) => {
      const ta = TORD[(HORSE_ROSTER[a] || {}).tier] ?? 1, tb = TORD[(HORSE_ROSTER[b] || {}).tier] ?? 1;
      return ta - tb || a.localeCompare(b);
    });
    let rows = "", lastTier = null;
    names.forEach((name) => {
      const tier = (HORSE_ROSTER[name] || {}).tier || "bono";
      if (tier !== lastTier) {
        lastTier = tier;
        rows += `<div style="text-align:left;font-weight:800;font-size:13px;color:${TCOL[tier]};text-transform:uppercase;letter-spacing:.09em;padding:14px 8px 4px">${TLAB[tier]}</div>`;
      }
      let statsHtml = "";
      STATS.forEach((s) => {
        let btns = "";
        for (let v = 1; v <= 5; v += 1) {
          btns += `<button type="button" class="mg-sv" data-horse="${enc(name)}" data-stat="${s.id}" data-val="${v}" `
            + `style="font:inherit;font-size:13px;font-weight:800;width:30px;height:30px;border-radius:7px;cursor:pointer;`
            + `border:1px solid rgba(240,203,53,.35);background:transparent;color:#f3e7cf">${v}</button>`;
        }
        statsHtml += `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">`
          + `<span style="width:62px;font-size:12px;opacity:.85;text-align:left">${s.label}</span>`
          + `<div style="display:flex;gap:4px">${btns}</div>`
          + `<span class="mg-avg" data-horse="${enc(name)}" data-stat="${s.id}" style="font-size:11px;opacity:.6">—</span></div>`;
      });
      rows += `<div class="mg-row" style="text-align:left;padding:9px 10px;border-bottom:1px solid rgba(240,203,53,.12)">`
        + `<div style="font-weight:700;font-size:14px">${name}</div>${statsHtml}</div>`;
    });
    list.innerHTML = rows;
  };
  ov.innerHTML =
    '<div style="max-width:min(680px,94vw);width:100%;display:flex;flex-direction:column;align-items:center;gap:12px">'
    + '<div style="font-size:clamp(18px,3.2vw,30px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;font-weight:800;margin-top:8px">Palio Game</div>'
    + '<div style="font-size:clamp(22px,5vw,38px);line-height:1.15;font-weight:800;max-width:min(680px,92vw)">Vota le statistiche dei cavalli</div>'
    // ── SPIEGAZIONE (prima di votare) ──────────────────────────────────────────
    + '<div style="width:100%;max-width:min(600px,92vw);text-align:left;background:rgba(255,246,225,.05);border:1px solid rgba(240,203,53,.22);border-radius:14px;padding:14px 16px;font-size:13.5px;line-height:1.5">'
    + '<div style="margin-bottom:8px">Aiutaci a tarare i cavalli: dai un voto da <b>1 a 5</b> a ognuno.</div>'
    + '<div style="margin-bottom:6px"><b style="color:#f0cb35">Potenza</b> = quanto il cavallo, andando addosso agli altri <b>ai canapi</b>, li <b>SPOSTA</b> (la spinta alla mossa). <b>5</b> = spintone che apre il varco · <b>1</b> = non sposta nessuno.</div>'
    + '<div><b style="color:#f0cb35">Turn</b> = quanto il cavallo <b>REGGE</b> ai canapi senza girarsi/imbizzarrirsi. <b>5</b> = fermo e tranquillo (si gira poco, è un pregio) · <b>1</b> = si gira e si imbizzarrisce subito.</div>'
    + '</div>'
    + `<div id="mgList" style="width:100%;max-width:min(680px,94vw);background:rgba(255,246,225,.04);border:1px solid rgba(240,203,53,.18);border-radius:14px;padding:4px 8px"><div style="opacity:.6;font-size:13px;padding:14px">Caricamento cavalli…</div></div>`
    // ── VOTO FANTINI ───────────────────────────────────────────────────────────
    + '<div style="font-size:clamp(20px,4.4vw,32px);line-height:1.15;font-weight:800;margin-top:12px">Aiutaci a tarare i fantini</div>'
    + '<div style="width:100%;max-width:min(600px,92vw);text-align:left;background:rgba(255,246,225,.05);border:1px solid rgba(240,203,53,.22);border-radius:14px;padding:12px 16px;font-size:12.5px;line-height:1.45">'
    + 'Vota da <b>1 a 5</b> ogni caratteristica: <b>Mossa</b> (partenza ai canapi) · <b>Difesa</b> (tiene la posizione/para) · <b>3° giro</b> (tenuta finale) · <b>Fedeltà</b> (resiste alla corruzione) · <b>Curva</b> (San Martino/Casato).'
    + '</div>'
    + `<div id="mgJkList" style="width:100%;max-width:min(680px,94vw);background:rgba(255,246,225,.04);border:1px solid rgba(231,209,138,.2);border-radius:14px;padding:4px 8px"><div style="opacity:.6;font-size:13px;padding:14px">Caricamento fantini…</div></div>`
    + '<div id="mgStatus" style="opacity:.6;font-size:12px;min-height:16px">Caricamento voti…</div>'
    + '<button type="button" id="mgContinua" style="font:inherit;font-size:16px;font-weight:800;padding:11px 36px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer;margin-bottom:18px">Continua ›</button>'
    + '</div>';
  document.body.appendChild(ov);
  ov.querySelector("#mgContinua").addEventListener("click", () => { ov.remove(); showPasswordPrompt(); });

  let curRes = {};
  const paint = () => {
    ov.querySelectorAll(".mg-sv").forEach((btn) => {
      const h = decodeURIComponent(btn.getAttribute("data-horse"));
      const s = btn.getAttribute("data-stat");
      const v = Number(btn.getAttribute("data-val"));
      const mine = curRes[h] && curRes[h][s] ? curRes[h][s].mine : null;
      const sel = mine === v;
      btn.style.background = sel ? "rgba(240,203,53,.9)" : "transparent";
      btn.style.color = sel ? "#1a1206" : "#f3e7cf";
      btn.style.borderColor = sel ? "#f0cb35" : "rgba(240,203,53,.35)";
    });
    ov.querySelectorAll(".mg-avg").forEach((el) => {
      const h = decodeURIComponent(el.getAttribute("data-horse"));
      const s = el.getAttribute("data-stat");
      const r = curRes[h] && curRes[h][s];
      el.textContent = (r && r.n) ? `media ${r.avg} · ${r.n} ${r.n === 1 ? "voto" : "voti"}` : "—";
    });
  };
  const load = () => {
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "statResults", voter }) })
      .then((r) => r.json())
      .then((d) => { if (d && d.ok) { curRes = d.results || {}; paint(); }
        const st = ov.querySelector("#mgStatus"); if (st) st.textContent = "Il tuo voto si salva da solo."; })
      .catch(() => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = "Voti offline: riprova più tardi."; });
  };
  ov.addEventListener("click", (e) => {
    const btn = e.target.closest(".mg-sv");
    if (!btn) return;
    const horse = decodeURIComponent(btn.getAttribute("data-horse"));
    const stat = btn.getAttribute("data-stat");
    const val = Number(btn.getAttribute("data-val"));
    if (!curRes[horse]) curRes[horse] = { potenza: { avg: 0, n: 0, mine: null }, turn: { avg: 0, n: 0, mine: null } };
    curRes[horse][stat].mine = val;   // evidenzia subito
    paint();
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "statVote", voter, horse, stat, value: val }) })
      .then((r) => r.json())
      .then((d) => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = (d && d.ok) ? "Voto salvato ✓" : "Errore nel salvare il voto."; if (d && d.ok) load(); })
      .catch(() => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = "Voto non salvato (offline)."; });
  });
  // ── FANTINI: voto delle 5 metriche ─────────────────────────────────────────
  const JKM = [{ id: "mossa", label: "Mossa" }, { id: "difesa", label: "Difesa" }, { id: "terzo", label: "3° giro" }, { id: "fedelta", label: "Fedeltà" }, { id: "curva", label: "Curva" }];
  let curJk = {};
  const buildJkRows = () => {
    const list = ov.querySelector("#mgJkList");
    if (!list) return;
    const jks = JOCKEYS.slice().sort((a, b) => (b.ingaggio || 0) - (a.ingaggio || 0));
    let rows = "";
    jks.forEach((jk) => {
      const nick = jk.nick;
      let statsHtml = "";
      JKM.forEach((s) => {
        let btns = "";
        for (let v = 1; v <= 5; v += 1) {
          btns += `<button type="button" class="mg-jkv" data-jk="${enc(nick)}" data-stat="${s.id}" data-val="${v}" `
            + `style="font:inherit;font-size:12px;font-weight:800;width:26px;height:26px;border-radius:6px;cursor:pointer;`
            + `border:1px solid rgba(231,209,138,.35);background:transparent;color:#f3e7cf">${v}</button>`;
        }
        statsHtml += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">`
          + `<span style="width:58px;font-size:11.5px;opacity:.85;text-align:left">${s.label}</span>`
          + `<div style="display:flex;gap:3px">${btns}</div>`
          + `<span class="mg-jkavg" data-jk="${enc(nick)}" data-stat="${s.id}" style="font-size:11px;opacity:.6">—</span></div>`;
      });
      // Riga PREZZO: campo numerico 0-150 (il giocatore vota quanto dovrebbe costare).
      const priceHtml = `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;border-top:1px solid rgba(231,209,138,.14);padding-top:5px">`
        + `<span style="width:58px;font-size:11.5px;opacity:.85;text-align:left">Prezzo</span>`
        + `<input type="number" min="0" max="150" inputmode="numeric" placeholder="0-150" class="mg-jkprice" data-jk="${enc(nick)}" style="width:62px;font:inherit;font-size:13px;padding:4px 6px;border-radius:7px;border:1px solid rgba(231,209,138,.4);background:#17110a;color:#f3e7cf">`
        + `<span class="mg-jkpavg" data-jk="${enc(nick)}" style="font-size:11px;opacity:.6">—</span></div>`;
      rows += `<div style="text-align:left;padding:9px 10px;border-bottom:1px solid rgba(231,209,138,.14)">`
        + `<div style="font-weight:700;font-size:14px">${nick}${jk.nome && jk.nome !== "—" ? `<span style="opacity:.5;font-weight:400;font-size:12px;margin-left:7px">${jk.nome}</span>` : ""}</div>${statsHtml}${priceHtml}</div>`;
    });
    list.innerHTML = rows;
  };
  const paintJk = () => {
    ov.querySelectorAll(".mg-jkv").forEach((btn) => {
      const j = decodeURIComponent(btn.getAttribute("data-jk")), s = btn.getAttribute("data-stat"), v = Number(btn.getAttribute("data-val"));
      const mine = curJk[j] && curJk[j][s] ? curJk[j][s].mine : null;
      const sel = mine === v;
      btn.style.background = sel ? "rgba(231,209,138,.9)" : "transparent";
      btn.style.color = sel ? "#2b2410" : "#f3e7cf";
      btn.style.borderColor = sel ? "#e7d18a" : "rgba(231,209,138,.35)";
    });
    ov.querySelectorAll(".mg-jkavg").forEach((el) => {
      const j = decodeURIComponent(el.getAttribute("data-jk")), s = el.getAttribute("data-stat");
      const r = curJk[j] && curJk[j][s];
      el.textContent = (r && r.n) ? `media ${r.avg} · ${r.n}` : "—";
    });
    // PREZZO: media votata + prefill del proprio voto (senza sovrascrivere se sto scrivendo).
    ov.querySelectorAll(".mg-jkpavg").forEach((el) => {
      const j = decodeURIComponent(el.getAttribute("data-jk"));
      const r = curJk[j] && curJk[j].ingaggio;
      el.textContent = (r && r.n) ? `media ${r.avg} · ${r.n} ${r.n === 1 ? "voto" : "voti"}` : "—";
    });
    ov.querySelectorAll(".mg-jkprice").forEach((inp) => {
      const j = decodeURIComponent(inp.getAttribute("data-jk"));
      const r = curJk[j] && curJk[j].ingaggio;
      if (document.activeElement !== inp && r && r.mine != null && inp.value === "") inp.value = r.mine;
    });
  };
  const loadJk = () => {
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "jkStatResults", voter }) })
      .then((r) => r.json()).then((d) => { if (d && d.ok) { curJk = d.results || {}; paintJk(); } }).catch(() => {});
  };
  ov.addEventListener("click", (e) => {
    const btn = e.target.closest(".mg-jkv");
    if (!btn) return;
    const jk = decodeURIComponent(btn.getAttribute("data-jk")), stat = btn.getAttribute("data-stat"), val = Number(btn.getAttribute("data-val"));
    if (!curJk[jk]) curJk[jk] = {};
    if (!curJk[jk][stat]) curJk[jk][stat] = { avg: 0, n: 0, mine: null };
    curJk[jk][stat].mine = val; paintJk();
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "jkStatVote", voter, jockey: jk, stat, value: val }) })
      .then((r) => r.json()).then((d) => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = (d && d.ok) ? "Voto salvato ✓" : "Errore."; if (d && d.ok) loadJk(); })
      .catch(() => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = "Voto non salvato (offline)."; });
  });
  // Voto PREZZO fantino: al cambio del campo numerico (0-150) invia il voto.
  ov.addEventListener("change", (e) => {
    const inp = e.target.closest(".mg-jkprice");
    if (!inp) return;
    const jk = decodeURIComponent(inp.getAttribute("data-jk"));
    let val = Math.round(Number(inp.value));
    if (!Number.isFinite(val)) return;
    val = clamp(val, 0, 150); inp.value = val;
    if (!curJk[jk]) curJk[jk] = {};
    if (!curJk[jk].ingaggio) curJk[jk].ingaggio = { avg: 0, n: 0, mine: null };
    curJk[jk].ingaggio.mine = val;
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "jkStatVote", voter, jockey: jk, stat: "ingaggio", value: val }) })
      .then((r) => r.json()).then((d) => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = (d && d.ok) ? "Prezzo votato ✓" : "Errore."; if (d && d.ok) loadJk(); })
      .catch(() => { const st = ov.querySelector("#mgStatus"); if (st) st.textContent = "Voto non salvato (offline)."; });
  });
  // i tasti nei campi prezzo non devono arrivare ai gestori di gioco.
  ov.addEventListener("keydown", (e) => { if (e.target.closest(".mg-jkprice")) e.stopPropagation(); }, true);
  // Prima i cavalli+fantini accettati (così ci sono TUTTI), poi si costruisce e carica.
  fetchAcceptedHorses(() => { buildRows(); load(); });
  fetchAcceptedJockeys(() => { buildJkRows(); loadJk(); });
}
// CICLO apertura/chiusura del gioco:
//   • fino a RELAUNCH_AT (20 ago 21:00) → countdown "torna online"
//   • RELAUNCH_AT → CYCLE_ANCHOR (21 ago 21:00) = 24h ONLINE (finestra iniziale)
//   • da CYCLE_ANCHOR in poi: blocchi da 48h che ALTERNANO chiuso/aperto, partendo da CHIUSO:
//        21→23 chiuso · 23→25 aperto · 25→27 chiuso · 27→29 aperto · … (con countdown ad ogni chiusura)
//   Per far restare il gioco aperto per sempre da una certa data, basta togliere/rimandare il ciclo.
const RELAUNCH_AT = new Date(2026, 7, 20, 21, 0, 0).getTime();    // 20 ago 21:00 → apre
const CYCLE_ANCHOR = new Date(2026, 7, 21, 21, 0, 0).getTime();   // 21 ago 21:00 → inizio ciclo (prima chiusura)
const CYCLE_MS = 48 * 3600 * 1000;                               // durata di ogni blocco: 48h
// Dalle 21:00 del 21 ago 2026 il gioco entra in DEMO: chiuso a tutti tranne gli
// sviluppatori (Mario Rossi), SENZA timer/countdown.
const DEMO_CLOSE_AT = new Date(2026, 7, 21, 21, 0, 0).getTime();
const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function fmtDataIt(ts) { const d = new Date(ts); return d.getDate() + " " + MESI_IT[d.getMonth()] + " alle " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
// Il pannello ADMIN non è MAI bloccato dalla DEMO (ci si entra con ?admin o #admin).
function isAdminUrl() {
  try { return /[?&]admin\b/.test(location.search) || location.hash.toLowerCase() === "#admin"; }
  catch (e) { return false; }
}
// Blocco DEMO: vale solo per un account REGISTRATO che non sia Mario Rossi.
// Prima di avere un account si passa liberamente da login/registrazione.
// Chi puo' GIOCARE durante la DEMO, oltre allo sviluppatore: elenco di email.
// Login e registrazione restano aperti a tutti — chiunque puo' crearsi l'account —
// ma chi non e' in questa lista si ferma alla schermata "gioco in aggiornamento".
// Per abilitare qualcuno basta aggiungere qui la sua email, in minuscolo.
const GIOCATORI_ABILITATI = new Set([
  "papeusleonardus10@gmail.com",   // Leonardo Papei
  "fili.toscano5@gmail.com",       // Filippo Toscano
]);
function accountAbilitato(acc) {
  if (isMarioRossi(acc)) return true;                       // lo sviluppatore
  const mail = ((acc && acc.email) || "").trim().toLowerCase();
  return !!mail && GIOCATORI_ABILITATI.has(mail);
}
function demoBloccaQuesto() {
  if (isAdminUrl()) return false;                  // admin: sempre libero
  if (Date.now() < DEMO_CLOSE_AT) return false;    // demo non ancora iniziata
  const acc = getAccount();
  if (!acc) return false;                          // non ancora registrato: lascialo entrare a registrarsi
  return !accountAbilitato(acc);                   // registrato ma non abilitato → blocco
}
function ensurePasswordGate() {
  // Dalle 21 del 21 ago: albo vittorie momentaneamente RIMOSSO per tutti (anche Mario Rossi).
  if (Date.now() >= DEMO_CLOSE_AT && !isAdminUrl()) { const ab = document.getElementById("alboButton"); if (ab) ab.style.display = "none"; }
  if (demoBloccaQuesto()) { showDemoClosedGate(); return; }
  ensureAccountGate();   // admin, sviluppatore, o utente ancora da registrare
}
// Schermata DEMO (niente countdown): il gioco è chiuso salvo gli sviluppatori.
function showDemoClosedGate() {
  if (document.getElementById("demoGate")) return;
  const ov = document.createElement("div");
  ov.id = "demoGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:18px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:28px;text-align:center";
  ov.innerHTML =
    '<div style="font-size:clamp(20px,4vw,38px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;font-weight:800">Palio Game</div>'
    + '<div style="font-size:clamp(16px,3vw,22px);font-weight:700;max-width:min(580px,90vw);line-height:1.55">Questo gioco è gratuito e senza scopo di lucro, attualmente è in fase <b style="color:#f0cb35">DEMO</b>, solo gli sviluppatori possono accedere.</div>';
  document.body.appendChild(ov);
  // Accesso SVILUPPATORE discreto: 5 tap sul titolo → login (per entrare come
  // Mario Rossi su un dispositivo dove non è già loggato).
  let taps = 0;
  ov.firstChild.addEventListener("click", () => {
    taps += 1;
    if (taps >= 5) { ov.remove(); ensureAccountGate(); }
  });
}
function showCountdownGate(targetTs, subtitleHtml) {
  if (Date.now() >= targetTs) { ensurePasswordGate(); return; }
  if (document.getElementById("cdGate")) return;
  const ov = document.createElement("div");
  ov.id = "cdGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:18px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:24px;text-align:center";
  ov.innerHTML =
    '<div style="font-size:clamp(20px,4vw,38px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;font-weight:800">Palio Game</div>'
    + '<div style="font-size:clamp(18px,3.4vw,26px);font-weight:700;max-width:min(560px,90vw)">Gioco di nuovo online fra</div>'
    + '<div id="cdTimer" style="font-size:clamp(34px,10vw,70px);font-weight:800;letter-spacing:.06em;color:#f6e6bd;font-variant-numeric:tabular-nums">—</div>'
    + '<div style="opacity:.82;font-size:clamp(13px,2.6vw,16px);max-width:min(470px,88vw)">' + (subtitleHtml || "") + '</div>';
  document.body.appendChild(ov);
  const timerEl = ov.querySelector("#cdTimer");
  const pad = (n) => String(n).padStart(2, "0");
  let iv = null;
  const tick = () => {
    const ms = targetTs - Date.now();
    if (ms <= 0) {
      if (iv) clearInterval(iv);
      ov.remove();
      ensurePasswordGate();   // rivaluta: ora è la finestra online (o la fase successiva)
      return;
    }
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    timerEl.textContent = (d > 0 ? d + "g " : "") + pad(h) + ":" + pad(m) + ":" + pad(sec);
  };
  tick();
  iv = setInterval(tick, 1000);
}
function showPasswordPrompt() {
  if (document.getElementById("pwGate")) return;
  let stored = null;
  try { stored = localStorage.getItem("palioUnlocked"); } catch (e) { ensureAccountGate(); return; }
  // Sbloccato se il token corrisponde all'era corrente (prima del cambio vale anche il vecchio "1").
  const unlocked = PW_CHANGED ? (stored === "v2") : (stored === "1");
  if (unlocked) { ensureAccountGate(); return; }
  // Chi aveva l'unlock vecchio ("1") DOPO il cambio → messaggio "password cambiata".
  const passwordCambiata = PW_CHANGED && stored === "1";
  const sottotitolo = passwordCambiata
    ? "La password del gioco è cambiata: digita la nuova password"
    : "Inserisci la password per entrare";
  const ov = document.createElement("div");
  ov.id = "pwGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:16px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:24px;text-align:center";
  ov.innerHTML =
    '<div style="font-size:clamp(22px,4vw,40px);letter-spacing:.14em;color:#f0cb35;text-transform:uppercase;font-weight:800">Palio Game</div>'
    + `<div style="opacity:.85;font-size:15px;max-width:min(420px,86vw)${passwordCambiata ? ";color:#f0cb35;font-weight:700" : ""}">${sottotitolo}</div>`
    + '<input id="pwInput" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="go" spellcheck="false" '
    + 'style="font:inherit;font-size:18px;padding:12px 16px;border-radius:10px;border:1px solid rgba(240,203,53,.5);'
    + 'background:rgba(255,246,225,.1);color:#f3e7cf;text-align:center;width:min(280px,80vw)" />'
    + '<button id="pwBtn" type="button" style="font:inherit;font-size:17px;font-weight:800;padding:11px 34px;border-radius:10px;'
    + 'border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Entra</button>'
    + '<div id="pwErr" style="color:#e8896f;font-size:14px;min-height:18px"></div>';
  document.body.appendChild(ov);
  const input = ov.querySelector("#pwInput");
  const err = ov.querySelector("#pwErr");
  const tryUnlock = () => {
    if ((input.value || "").trim().toLowerCase() === GAME_PASSWORD) {
      try { localStorage.setItem("palioUnlocked", PW_UNLOCK_TOKEN); } catch (e) { /* no storage */ }
      ov.remove();
      ensureAccountGate();   // sbloccata la password: ora l'account (login/registrazione)
    } else { err.textContent = "Password errata"; input.value = ""; input.focus(); }
  };
  ov.querySelector("#pwBtn").addEventListener("click", tryUnlock);
  // stopPropagation: i tasti digitati nel campo password NON devono MAI arrivare ai
  // gestori di gioco (che altrimenti potrebbero "mangiarli"). Doppia sicurezza oltre
  // a uiIsTyping. Su keydown/keyup/keypress per coprire ogni caso.
  ["keydown", "keyup", "keypress"].forEach((ev) => input.addEventListener(ev, (e) => e.stopPropagation()));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  // Focus robusto: al primo tap/click sull'overlay o sul campo (utile su mobile,
  // dove il focus programmatico può essere bloccato senza un gesto dell'utente).
  ov.addEventListener("click", () => { try { input.focus(); } catch (e) { /* niente */ } });
  setTimeout(() => { try { input.focus(); } catch (e) { /* niente */ } }, 60);
}

// ════ ACCOUNT UTENTI (login/registrazione) + SEZIONE ADMIN ═══════════════════
// Dopo la password condivisa, ogni utente entra nel PROPRIO account (email+password,
// verificata da /api/account). Serve per attribuire i palii corsi e mostrarli
// nell'admin. L'account loggato è salvato in localStorage (login persistente sul
// dispositivo). Solo l'owner, con la password admin, vede l'elenco di tutti.
const ACCOUNT_API = "/api/account";
const ACCOUNT_KEY = "palioAccount";
// ISCRIZIONI: APERTE. C'era una chiusura a tempo fissata al 23 agosto 2026, ma il
// 24 Simone ha chiesto l'opposto — «consenti ancora alle persone di registrarsi ma
// non di giocare» — e quel blocco, piu' vecchio, era rimasto lì a chiudere il form
// mentre il gate della DEMO faceva il suo lavoro a valle: chi arrivava non poteva
// nemmeno iscriversi. Chi non e' fra gli abilitati si registra e si ferma alla
// schermata "stiamo aggiornando" (vedi demoBloccaQuesto), che e' quello che serve.
const SIGNUP_BLOCKED = false;
const SIGNUP_BLOCK_MSG = "Al momento non è possibile iscriversi al Palio.";
// Max 3 account creati dallo STESSO DISPOSITIVO in 30 giorni: al 3° si aspetta.
const DEVICE_MAX_ACCOUNTS = 3;
const DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;   // 30 giorni
function creazioniRecenti() {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem("palio.acctCreations") || "[]"); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const cutoff = Date.now() - DEVICE_WINDOW_MS;
  return arr.filter((t) => typeof t === "number" && t > cutoff);
}
function deviceSignupAttesaMs() {
  const recenti = creazioniRecenti().sort((a, b) => a - b);
  if (recenti.length < DEVICE_MAX_ACCOUNTS) return 0;
  const piuVecchia = recenti[recenti.length - DEVICE_MAX_ACCOUNTS];   // la 3ª più recente
  const wait = (piuVecchia + DEVICE_WINDOW_MS) - Date.now();
  return wait > 0 ? wait : 0;
}
function registraCreazioneAccount() {
  const arr = creazioniRecenti();
  arr.push(Date.now());
  try { localStorage.setItem("palio.acctCreations", JSON.stringify(arr)); } catch (e) { /* niente */ }
}
function getAccount() {
  try { const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); return (a && a.email) ? a : null; } catch (e) { return null; }
}
function setAccount(a) { try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); } catch (e) { /* niente */ } }
function clearAccount() { try { localStorage.removeItem(ACCOUNT_KEY); } catch (e) { /* niente */ } }

// Overlay di login/registrazione. Resta finché non si entra in un account.
function ensureAccountGate() {
  if (document.getElementById("pwGate")) return;      // prima la password condivisa
  if (getAccount()) { updateAccountChip(); maybeShowGameTips(); return; }   // già loggato → mostra i consigli (una tantum per TIPS_VERSION)
  if (document.getElementById("accountGate")) return;  // già aperto

  const ov = document.createElement("div");
  ov.id = "accountGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:14px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:24px;text-align:center;overflow:auto";

  const opts = CONTRADE.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  const inCss = "font:inherit;font-size:16px;padding:10px 13px;border-radius:9px;border:1px solid rgba(240,203,53,.45);"
    + "background:rgba(255,246,225,.1);color:#f3e7cf;width:min(300px,84vw);box-sizing:border-box";
  const btnCss = "font:inherit;font-size:16px;font-weight:800;padding:11px 30px;border-radius:10px;border:none;"
    + "background:#f0cb35;color:#1a1206;cursor:pointer;width:min(300px,84vw)";
  const tabCss = "font:inherit;font-size:15px;font-weight:700;padding:8px 18px;border-radius:9px;border:1px solid rgba(240,203,53,.4);"
    + "background:transparent;color:#f3e7cf;cursor:pointer";

  ov.innerHTML =
    '<div style="font-size:clamp(20px,3.6vw,34px);letter-spacing:.12em;color:#f0cb35;text-transform:uppercase;font-weight:800">Palio Game</div>'
    + '<div style="display:flex;gap:8px;margin-top:2px">'
    + `<button type="button" id="tabLogin" style="${tabCss};background:#f0cb35;color:#1a1206">Entra</button>`
    + `<button type="button" id="tabSignup" style="${tabCss}">Registrati</button>`
    + '</div>'
    // ── LOGIN
    + '<div id="paneLogin" style="display:flex;flex-direction:column;align-items:center;gap:10px">'
    + `<input id="loginEmail" type="email" placeholder="Email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" style="${inCss}" />`
    + `<input id="loginPw" type="password" placeholder="Password" autocomplete="current-password" style="${inCss}" />`
    + `<button type="button" id="loginBtn" style="${btnCss}">Entra</button>`
    + '</div>'
    // ── SIGNUP
    + '<div id="paneSignup" style="display:none;flex-direction:column;align-items:center;gap:10px">'
    + `<div id="suBlockMsg" style="display:none;font-size:15px;line-height:1.4;color:#f0cb35;font-weight:700;max-width:min(360px,86vw);border:1px solid rgba(240,203,53,.5);background:rgba(240,203,53,.08);border-radius:12px;padding:16px 18px">${SIGNUP_BLOCK_MSG}</div>`
    + '<div id="suForm" class="acc-campi" style="display:flex;flex-direction:column;align-items:center;gap:10px">'
    + `<input id="suNome" type="text" placeholder="Nome" autocapitalize="words" style="${inCss}" />`
    + `<input id="suCognome" type="text" placeholder="Cognome" autocapitalize="words" style="${inCss}" />`
    + `<input id="suEmail" type="email" placeholder="Email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" style="${inCss}" />`
    + `<input id="suPw" type="password" placeholder="Password (min 6 caratteri)" autocomplete="new-password" style="${inCss}" />`
    + `<input id="suEta" type="number" min="4" max="120" inputmode="numeric" placeholder="Età" style="${inCss}" />`
    + `<select id="suSesso" style="${inCss}"><option value="">— Sesso —</option><option value="M">Maschio</option><option value="F">Femmina</option><option value="A">Altro / preferisco non dirlo</option></select>`
    + '<div style="font-size:13.5px;opacity:.82;width:min(300px,84vw);text-align:left">Appartieni a una contrada?</div>'
    + `<select id="suContrada" style="${inCss}"><option value="">— Nessuna / preferisco non dirlo —</option>${opts}</select>`
    + `<button type="button" id="signupBtn" style="${btnCss}">Crea account</button>`
    + '</div>'
    + '</div>'
    + '<div id="accErr" style="color:#e8896f;font-size:14px;min-height:18px;max-width:84vw"></div>';

  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  const err = $("accErr");
  // I tasti digitati nei campi NON devono arrivare al gioco.
  ov.querySelectorAll("input,select").forEach((el) => {
    ["keydown", "keyup", "keypress"].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));
  });

  const showPane = (which) => {
    const login = which === "login";
    $("paneLogin").style.display = login ? "flex" : "none";
    $("paneSignup").style.display = login ? "none" : "flex";
    $("tabLogin").style.background = login ? "#f0cb35" : "transparent";
    $("tabLogin").style.color = login ? "#1a1206" : "#f3e7cf";
    $("tabSignup").style.background = login ? "transparent" : "#f0cb35";
    $("tabSignup").style.color = login ? "#f3e7cf" : "#1a1206";
    err.textContent = "";
    // Iscrizioni chiuse: sul tab Registrati mostra solo il messaggio, niente form.
    if (!login) {
      const bm = $("suBlockMsg"), sf = $("suForm");
      if (bm) bm.style.display = SIGNUP_BLOCKED ? "block" : "none";
      if (sf) sf.style.display = SIGNUP_BLOCKED ? "none" : "flex";
    }
  };
  $("tabLogin").addEventListener("click", () => showPane("login"));
  $("tabSignup").addEventListener("click", () => showPane("signup"));

  const finish = (account, isNew) => {
    // I NUOVI account non ricevono il broadcast feedback (hanno già il tutorial):
    // segno il flag come "visto" prima di updateAccountChip.
    if (isNew) { try { localStorage.setItem("palio.fbBroadcast", FEEDBACK_BROADCAST); } catch (e) { /* niente */ } }
    setAccount(account); ov.remove(); updateAccountChip();
    // DEMO: appena registrato/entrato, se non sei lo sviluppatore il gioco si blocca qui.
    if (demoBloccaQuesto()) { showDemoClosedGate(); return; }
    if (isNew) openWelcomeTutorial();   // UNA TANTUM: solo appena creato l'account
    maybeShowGameTips();                // 3 consigli skippabili, una tantum per dispositivo (dietro il tutorial per i nuovi)
  };
  const errMsg = (code) => ({
    "nome-cognome": "Inserisci nome e cognome.",
    "email": "Email non valida.",
    "password-corta": "La password deve avere almeno 6 caratteri.",
    "eta": "Inserisci un'età valida (4–120).",
    "email-esiste": "Esiste già un account con questa email. Entra.",
    "no-account": "Nessun account con questa email. Registrati.",
    "credenziali": "Email o password errata.",
    "no-store": "Servizio account non disponibile. Riprova più tardi.",
    "iscrizioni-chiuse": SIGNUP_BLOCK_MSG,
  }[code] || "Errore. Riprova.");

  const doLogin = () => {
    const email = ($("loginEmail").value || "").trim();
    const password = $("loginPw").value || "";
    if (!email || !password) { err.textContent = "Inserisci email e password."; return; }
    err.textContent = "Attendi…";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (ok && j.ok) finish(j.account); else err.textContent = errMsg(j.error); })
      .catch(() => { err.textContent = "Connessione assente. Riprova."; });
  };
  const doSignup = () => {
    if (SIGNUP_BLOCKED) { err.textContent = SIGNUP_BLOCK_MSG; return; }   // iscrizioni chiuse
    const dw = deviceSignupAttesaMs();   // max 3 account per dispositivo in 30 giorni
    if (dw > 0) {
      const gg = Math.max(1, Math.ceil(dw / (24 * 60 * 60 * 1000)));
      err.textContent = `Da questo dispositivo si possono creare al massimo 3 account: riprova fra ${gg} giorni.`;
      return;
    }
    const nome = ($("suNome").value || "").trim();
    const cognome = ($("suCognome").value || "").trim();
    const email = ($("suEmail").value || "").trim();
    const password = $("suPw").value || "";
    const contrada = $("suContrada").value || "";
    const eta = parseInt($("suEta").value, 10) || 0;
    const sesso = $("suSesso").value || "";
    if (!nome || !cognome) { err.textContent = "Inserisci nome e cognome."; return; }
    if (!email) { err.textContent = "Inserisci l'email."; return; }
    if (password.length < 6) { err.textContent = "Password troppo corta (min 6)."; return; }
    if (!eta || eta < 4 || eta > 120) { err.textContent = "Inserisci un'età valida (4–120)."; return; }
    if (!sesso) { err.textContent = "Seleziona il sesso."; return; }
    err.textContent = "Attendi…";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", nome, cognome, email, password, contrada, eta, sesso }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (ok && j.ok) { registraCreazioneAccount(); finish(j.account, true); } else err.textContent = errMsg(j.error); })   // true = nuovo → tutorial
      .catch(() => { err.textContent = "Connessione assente. Riprova."; });
  };
  $("loginBtn").addEventListener("click", doLogin);
  $("signupBtn").addEventListener("click", doSignup);
  $("loginPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("suPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doSignup(); });
  setTimeout(() => { try { $("loginEmail").focus(); } catch (e) { /* niente */ } }, 60);
}

// Chip in alto col nome dell'utente loggato + "Esci" (nel menu principale).
function updateAccountChip() {
  const acc = getAccount();
  let chip = document.getElementById("accountChip");
  if (!acc) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = document.createElement("div");
    chip.id = "accountChip";
    chip.style.cssText = "position:fixed;top:10px;right:calc(env(safe-area-inset-right,0px) + 12px);z-index:120;display:flex;align-items:center;gap:10px;"
      + "background:rgba(20,14,8,.72);border:1px solid rgba(240,203,53,.35);border-radius:999px;padding:6px 8px 6px 14px;"
      + "color:#f3e7cf;font-family:inherit;font-size:13.5px;backdrop-filter:blur(4px)";
    document.body.appendChild(chip);
  }
  const cName = (CONTRADE.find((c) => c.id === acc.contrada) || {}).name;
  chip.innerHTML = `<button type="button" id="accountManageBtn" title="Modifica o elimina l'account" style="font:inherit;font-size:13.5px;color:#f3e7cf;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:0">👤&nbsp;<b>${escapeHtml(acc.nome || "")}</b>${cName ? ` · <span style="opacity:.8">${escapeHtml(cName)}</span>` : ""}&nbsp;<span style="opacity:.55;font-size:11px">✎</span></button>`
    + '<button type="button" id="logoutBtn" style="font:inherit;font-size:12.5px;font-weight:700;border:none;border-radius:999px;'
    + 'padding:5px 12px;background:rgba(232,137,111,.9);color:#1a1206;cursor:pointer">Esci</button>';
  const lb = chip.querySelector("#logoutBtn");
  if (lb) lb.addEventListener("click", () => { clearAccount(); chip.remove(); ensureAccountGate(); });
  const mb = chip.querySelector("#accountManageBtn");
  if (mb) mb.addEventListener("click", openAccountManage);
  // Visibile solo in home: se non siamo sul menu, nascondilo subito.
  const onMenu = !!(ui.screens && ui.screens.menu && ui.screens.menu.classList.contains("active"));
  chip.style.display = onMenu ? "flex" : "none";
  maybeShowFeedbackBroadcast();   // popup "lascia un feedback" una tantum, alla prossima apertura
}

// BENVENUTO — UNA TANTUM appena creato l'account: prima la scritta "gioco privato,
// non a scopo di lucro", poi un tutorial info-grafico dei comandi (PC / controller /
// telefono). Compare solo dopo il signup, mai al login.
// ── CONSIGLI iniziali (popup skippabili, una tantum per dispositivo) ──────────
const TIPS_VERSION = "3";   // bumpa per rimostrarli a tutti
const GAME_TIPS = [
  ["🫁", "Attenzione alla stamina dei cavalli!", "Il fiato del cavallo ti deve bastare 3 giri: non sparare tutto subito."],
  ["🌀", "Attenzione alle curve!", "Se le prendi a 3-4-5 il cavallo non gira, a meno che non ti allarghi molto."],
  ["🤝", "Non saltare gli accordi.", "Come pensi di vincere il Palio se salti gli accordi con le altre contrade?"],
  ["⚡", "Comprati la rincorsa!", "Se ti sei comprato la rincorsa puoi partire a 5 come il Tittìa!!!! Tanto ti danno la mossa."],
];
function showGameTips(onDone) {
  if (document.getElementById("gameTips")) { if (onDone) onDone(); return; }
  let i = 0;
  // Su TELEFONO, come primo consiglio: gioca da PC (lo schermo del telefono sacrifica la grafica).
  const tips = IS_TOUCH_DEVICE
    ? [["💻", "Meglio da PC!", "Vi consigliamo di giocare da PC — ancora meglio con un controller collegato. Lo schermo del telefono sacrifica la grafica."]].concat(GAME_TIPS)
    : GAME_TIPS;
  const ov = document.createElement("div");
  ov.id = "gameTips";
  ov.style.cssText = "position:fixed;inset:0;z-index:9997;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:16px;padding:20px;text-align:center;color:#f3e7cf;font-family:inherit;overflow-y:auto;"
    + "background:radial-gradient(1100px 700px at 50% -8%,#3a2a17 0%,#17110a 60%,#0d0906 100%)";
  document.body.appendChild(ov);
  const close = () => { ov.remove(); if (onDone) onDone(); };
  const render = () => {
    const [ic, t, d] = tips[i];
    ov.innerHTML =
      `<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#f0cb35;opacity:.9">Consiglio ${i + 1}/${tips.length}</div>`
      + `<div style="font-size:clamp(46px,12vw,74px);line-height:1">${ic}</div>`
      + `<div style="font-size:clamp(20px,4.4vw,32px);font-weight:800;color:#f7edd6;max-width:min(560px,92vw)">${t}</div>`
      + `<div style="font-size:clamp(14px,2.8vw,18px);opacity:.85;max-width:min(480px,88vw);line-height:1.5">${d}</div>`
      + `<button type="button" id="gtNext" style="margin-top:6px;font:inherit;font-size:16px;font-weight:800;padding:12px 40px;border-radius:11px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">${i < tips.length - 1 ? "Avanti ›" : "Ho capito!"}</button>`
      + `<button type="button" id="gtSkip" style="font:inherit;font-size:13px;background:none;border:none;color:#f3e7cf;opacity:.6;cursor:pointer;text-decoration:underline">Salta</button>`;
    ov.querySelector("#gtNext").addEventListener("click", () => { i += 1; if (i >= tips.length) close(); else render(); });
    ov.querySelector("#gtSkip").addEventListener("click", close);
  };
  render();
}
function maybeShowGameTips() {
  let seen = null;
  try { seen = localStorage.getItem("palio.tipsSeen"); } catch (e) { /* niente */ }
  if (seen === TIPS_VERSION) return;
  try { localStorage.setItem("palio.tipsSeen", TIPS_VERSION); } catch (e) { /* niente */ }
  showGameTips();
}
function openWelcomeTutorial() {
  if (document.getElementById("welcomeTut")) return;
  const ov = document.createElement("div");
  ov.id = "welcomeTut";
  ov.style.cssText = "position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:flex-start;gap:14px;overflow:auto;padding:26px 18px;text-align:center;color:#f3e7cf;font-family:inherit;"
    + "background:radial-gradient(1100px 700px at 50% -8%,#3a2a17 0%,#17110a 60%,#0d0906 100%)";
  const kbd = (t) => `<span style="display:inline-block;min-width:16px;padding:2px 6px;border-radius:5px;background:rgba(255,246,225,.12);border:1px solid rgba(240,203,53,.4);font-weight:700;font-size:12px;margin:0 1px;white-space:nowrap">${t}</span>`;
  const row = (label, body) => `<div style="margin:7px 0 0"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#f0cb35;opacity:.9;margin-bottom:3px">${label}</div><div style="font-size:12.5px;line-height:1.7">${body}</div></div>`;
  const card = (icon, title, inner) => `<div style="flex:1 1 240px;min-width:230px;max-width:340px;background:rgba(255,246,225,.06);border:1px solid rgba(240,203,53,.3);border-radius:14px;padding:14px 16px;text-align:left">`
    + `<div style="font-size:16px;font-weight:800;color:#f7edd6;margin-bottom:2px">${icon} ${title}</div>${inner}</div>`;

  const pc = card("💻", "PC — Tastiera",
    row("Mossa (ai canapi)", `${kbd("A")}${kbd("L")} gira · ${kbd("M")}/${kbd("Spazio")} andatura · ${kbd("Q")}${kbd("P")} spingi di lato · ${kbd("K")}${kbd("S")} nerbata (dx/sx)`)
    + row("Gara", `${kbd("M")} accelera · ${kbd("Spazio")} rallenta · ${kbd("A")}${kbd("L")} sterza · ${kbd("K")}${kbd("S")} nerbata · ${kbd("C")} cambia camera`)
    + row("Menu", `${kbd("Invio")} conferma · ${kbd("↑")}${kbd("↓")} scegli`));
  const ctrl = card("🎮", "Controller",
    row("Guida", `Levetta <b>sinistra</b> = guida`)
    + row("Andatura", `${kbd("X")} marcia su / conferma · ${kbd("O")} marcia giù`)
    + row("Ai canapi", `Levetta <b>destra</b> = spostati di lato`));
  const tel = card("📱", "Telefono / iPad (in orizzontale)",
    row("Sterzo / curva", `${kbd("◀")}${kbd("▶")} a <b>destra</b> = curva (anche in corsa)`)
    + row("Andatura", `${kbd("▲")}${kbd("▼")} a sinistra = accelera / rallenta`)
    + row("Ai canapi", `${kbd("◀")}${kbd("▶")} a sinistra = scorri di lato (spariscono in corsa)`)
    + row("Gara", `${kbd("NERBO")} = nerbata verso il rivale più vicino`));

  ov.innerHTML =
    // scritta PRIMA DI TUTTO
    '<div style="border:1px solid rgba(240,203,53,.55);background:rgba(240,203,53,.08);border-radius:14px;padding:14px 20px;max-width:640px">'
    + '<div style="font-size:clamp(15px,2.6vw,20px);font-weight:800;color:#f0cb35;letter-spacing:.06em;text-transform:uppercase">Questo gioco è privato, non a scopo di lucro</div>'
    + '<div style="font-size:14px;opacity:.9;margin-top:4px">Per favore aiutaci a migliorarlo 🙏</div></div>'
    + '<div style="font-size:clamp(18px,3vw,26px);font-weight:800;color:#f7edd6;margin-top:4px">Come si gioca</div>'
    + '<div style="font-size:12px;opacity:.75;margin-top:-6px">Andatura: <b>1</b> indietro · <b>2</b> fermo · <b>3–5</b> avanti</div>'
    + `<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:1080px;margin-top:6px">${pc}${ctrl}${tel}</div>`
    + '<button type="button" id="welcomeGo" style="margin-top:8px;font:inherit;font-size:16px;font-weight:800;padding:12px 34px;border-radius:11px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Ho capito — gioca! →</button>';
  document.body.appendChild(ov);
  const go = ov.querySelector("#welcomeGo");
  if (go) go.addEventListener("click", () => ov.remove());
}

// Pannello "Il mio account": modifica nome/cognome/contrada/password oppure elimina
// l'account. Ogni operazione richiede la PASSWORD ATTUALE (autenticazione lato server).
function openAccountManage() {
  const acc = getAccount();
  if (!acc) { ensureAccountGate(); return; }
  if (document.getElementById("accountManage")) return;
  const ov = document.createElement("div");
  ov.id = "accountManage";
  ov.style.cssText = "position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:11px;background:radial-gradient(1100px 700px at 50% -10%,#3a2a17 0%,#17110a 62%,#0d0906 100%);"
    + "color:#f3e7cf;font-family:inherit;padding:20px;text-align:center;overflow:auto";
  const opts = CONTRADE.map((c) => `<option value="${c.id}"${c.id === acc.contrada ? " selected" : ""}>${c.name}</option>`).join("");
  const inCss = "font:inherit;font-size:16px;padding:10px 13px;border-radius:9px;border:1px solid rgba(240,203,53,.45);"
    + "background:rgba(255,246,225,.1);color:#f3e7cf;width:min(300px,84vw);box-sizing:border-box";
  ov.innerHTML =
    '<div style="font-size:clamp(19px,3.2vw,28px);font-weight:800;color:#f0cb35">Il mio account</div>'
    + `<div style="opacity:.75;font-size:13px;margin-bottom:2px">${escapeHtml(acc.email || "")} · ${acc.palii || 0} palii corsi</div>`
    + `<input id="amNome" type="text" placeholder="Nome" value="${escapeHtml(acc.nome || "")}" style="${inCss}" />`
    + `<input id="amCognome" type="text" placeholder="Cognome" value="${escapeHtml(acc.cognome || "")}" style="${inCss}" />`
    + `<select id="amContrada" style="${inCss}"><option value="">— Nessuna —</option>${opts}</select>`
    + `<input id="amNewPw" type="password" placeholder="Nuova password (lascia vuoto per non cambiarla)" autocomplete="new-password" style="${inCss}" />`
    + '<div style="height:1px;background:rgba(240,203,53,.2);width:min(300px,84vw);margin:4px 0"></div>'
    + `<input id="amPw" type="password" placeholder="Password attuale (per confermare)" autocomplete="current-password" style="${inCss}" />`
    + '<div style="display:flex;gap:9px;margin-top:2px">'
    + '<button type="button" id="amSave" style="font:inherit;font-size:15px;font-weight:800;padding:10px 22px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Salva</button>'
    + '<button type="button" id="amClose" style="font:inherit;font-size:15px;font-weight:700;padding:10px 18px;border-radius:10px;border:1px solid rgba(240,203,53,.4);background:transparent;color:#f3e7cf;cursor:pointer">Chiudi</button>'
    + '</div>'
    + '<button type="button" id="amDelete" style="font:inherit;font-size:13px;font-weight:700;padding:8px 16px;border-radius:9px;border:1px solid rgba(232,137,111,.5);background:transparent;color:#e8896f;cursor:pointer;margin-top:6px">Elimina account</button>'
    + '<div id="amMsg" style="min-height:18px;font-size:14px;color:#e8896f;max-width:84vw"></div>';
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  ov.querySelectorAll("input,select").forEach((el) => {
    ["keydown", "keyup", "keypress"].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));
  });
  const msg = $("amMsg");
  const errMsg = (code) => ({
    "credenziali": "Password attuale errata.", "nome-cognome": "Inserisci nome e cognome.",
    "password-corta": "La nuova password deve avere almeno 6 caratteri.",
    "no-account": "Account non trovato.", "no-store": "Servizio non disponibile.",
  }[code] || "Errore. Riprova.");
  $("amClose").addEventListener("click", () => ov.remove());

  $("amSave").addEventListener("click", () => {
    const password = $("amPw").value || "";
    if (!password) { msg.style.color = "#e8896f"; msg.textContent = "Inserisci la password attuale per salvare."; return; }
    const nome = ($("amNome").value || "").trim();
    const cognome = ($("amCognome").value || "").trim();
    const contrada = $("amContrada").value || "";
    const newPassword = $("amNewPw").value || "";
    if (!nome || !cognome) { msg.style.color = "#e8896f"; msg.textContent = "Inserisci nome e cognome."; return; }
    msg.style.color = "#f3e7cf"; msg.textContent = "Salvo…";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", email: acc.email, password, nome, cognome, contrada, newPassword }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.ok) { setAccount(j.account); updateAccountChip(); msg.style.color = "#7fd98c"; msg.textContent = "Salvato!"; setTimeout(() => ov.remove(), 900); }
        else { msg.style.color = "#e8896f"; msg.textContent = errMsg(j.error); }
      })
      .catch(() => { msg.style.color = "#e8896f"; msg.textContent = "Connessione assente."; });
  });

  let confirmDel = false;
  $("amDelete").addEventListener("click", () => {
    const password = $("amPw").value || "";
    if (!password) { msg.style.color = "#e8896f"; msg.textContent = "Inserisci la password attuale per eliminare."; return; }
    if (!confirmDel) {
      confirmDel = true;
      $("amDelete").textContent = "Sei sicuro? Tocca di nuovo per eliminare";
      msg.style.color = "#e8896f"; msg.textContent = "L'eliminazione è definitiva.";
      return;
    }
    msg.style.color = "#f3e7cf"; msg.textContent = "Elimino…";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", email: acc.email, password }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.ok) { clearAccount(); ov.remove(); const chip = document.getElementById("accountChip"); if (chip) chip.remove(); ensureAccountGate(); }
        else { confirmDel = false; $("amDelete").textContent = "Elimina account"; msg.style.color = "#e8896f"; msg.textContent = errMsg(j.error); }
      })
      .catch(() => { msg.style.color = "#e8896f"; msg.textContent = "Connessione assente."; });
  });
  setTimeout(() => { try { $("amNome").focus(); } catch (e) { /* niente */ } }, 60);
}

// ── SOSTEGNO AL GIOCO: il bottone "Dacci un consiglio" in home ───────────────

// Overlay per inviare un consiglio (finisce nella sezione admin via /api/account).
// Popup FEEDBACK una tantum: dopo che il giocatore ha corso 3 palii, gli si chiede
// un feedback sincero. Mostrato una volta sola (flag in localStorage).
function maybeAskFeedbackAfter3() {
  try {
    if (!getAccount()) return;
    if (localStorage.getItem("palio.feedbackAsked3") === "1") return;
    const runs = parseInt(localStorage.getItem("palio.playerRuns") || "0", 10) || 0;
    if (runs < 3) return;
    localStorage.setItem("palio.feedbackAsked3", "1");
    setTimeout(() => openSuggestOverlay({
      title: "🙏 Dacci un feedback sincero",
      sub: "Hai corso 3 palii! Per migliorare il gioco per tutta Siena, raccontaci sinceramente cosa cambieresti o miglioreresti.",
    }), 1500);
  } catch (e) { /* niente */ }
}

// BROADCAST feedback: alla PROSSIMA apertura, ogni giocatore loggato vede una volta
// il popup "lascia un feedback". Per rilanciarlo in futuro basta cambiare la versione.
const FEEDBACK_BROADCAST = "fb1";
function maybeShowFeedbackBroadcast() {
  try {
    if (!getAccount()) return;
    if (localStorage.getItem("palio.fbBroadcast") === FEEDBACK_BROADCAST) return;
    localStorage.setItem("palio.fbBroadcast", FEEDBACK_BROADCAST);
    setTimeout(() => openSuggestOverlay({
      title: "💬 Lascia un feedback",
      sub: "Per favore aiutaci a migliorare il gioco per tutta Siena: lasciaci un feedback sincero.",
    }), 1200);
  } catch (e) { /* niente */ }
}

function openSuggestOverlay(opts) {
  if (document.getElementById("suggestOverlay")) return;
  const title = (opts && opts.title) || "💡 Dacci un consiglio";
  const sub = (opts && opts.sub) || "Cosa miglioreresti nel gioco? Ogni idea ci aiuta.";
  const acc = getAccount();
  const ov = document.createElement("div");
  ov.id = "suggestOverlay";
  ov.style.cssText = "position:fixed;inset:0;z-index:9997;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:center;gap:14px;background:rgba(10,7,4,.86);color:#f3e7cf;font-family:inherit;padding:24px;text-align:center";
  ov.innerHTML =
    `<div style="font-size:clamp(19px,3.2vw,28px);font-weight:800;color:#f0cb35">${title}</div>`
    + `<div style="opacity:.85;font-size:14px;max-width:520px">${sub}</div>`
    + '<textarea id="suggestText" rows="5" maxlength="1000" placeholder="Scrivi qui il tuo consiglio…" '
    + 'style="font:inherit;font-size:15px;padding:12px 14px;border-radius:10px;border:1px solid rgba(240,203,53,.45);'
    + 'background:rgba(255,246,225,.1);color:#f3e7cf;width:min(520px,88vw);box-sizing:border-box;resize:vertical"></textarea>'
    + '<div style="display:flex;gap:10px">'
    + '<button type="button" id="suggestSend" style="font:inherit;font-size:16px;font-weight:800;padding:11px 26px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Invia</button>'
    + '<button type="button" id="suggestCancel" style="font:inherit;font-size:16px;font-weight:700;padding:11px 22px;border-radius:10px;border:1px solid rgba(240,203,53,.4);background:transparent;color:#f3e7cf;cursor:pointer">Annulla</button>'
    + '</div>'
    + '<div id="suggestMsg" style="min-height:18px;font-size:14px;color:#7fd98c"></div>';
  document.body.appendChild(ov);
  const ta = ov.querySelector("#suggestText");
  ["keydown", "keyup", "keypress"].forEach((ev) => ta.addEventListener(ev, (e) => e.stopPropagation()));
  const close = () => ov.remove();
  ov.querySelector("#suggestCancel").addEventListener("click", close);
  const msg = ov.querySelector("#suggestMsg");
  ov.querySelector("#suggestSend").addEventListener("click", () => {
    const text = (ta.value || "").trim();
    if (!text) { msg.style.color = "#e8896f"; msg.textContent = "Scrivi qualcosa prima di inviare."; return; }
    msg.style.color = "#f3e7cf"; msg.textContent = "Invio…";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "feedback", text, email: acc && acc.email }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.ok) { msg.style.color = "#7fd98c"; msg.textContent = "Grazie! Consiglio inviato."; setTimeout(close, 1200); }
        else { msg.style.color = "#e8896f"; msg.textContent = "Errore nell'invio. Riprova."; }
      })
      .catch(() => { msg.style.color = "#e8896f"; msg.textContent = "Connessione assente. Riprova."; });
  });
  setTimeout(() => { try { ta.focus(); } catch (e) { /* niente */ } }, 60);
}

// ── SEZIONE ADMIN (solo owner): elenco account + palii corsi ──────────────────
// Si apre con l'URL fianca-la-mossa.vercel.app/?admin (o #admin) e la password admin
// (variabile PALIO_ADMIN_KEY su Vercel). L'elenco è protetto lato server.
function maybeOpenAdmin() {
  const isAdmin = /[?&]admin\b/.test(location.search) || location.hash.toLowerCase() === "#admin";
  if (!isAdmin) return;
  const ov = document.createElement("div");
  ov.id = "adminGate";
  ov.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;"
    + "justify-content:flex-start;gap:14px;background:#0d0906;color:#f3e7cf;font-family:inherit;padding:26px 18px;overflow:auto;text-align:center";
  const inCss = "font:inherit;font-size:16px;padding:10px 13px;border-radius:9px;border:1px solid rgba(240,203,53,.45);"
    + "background:rgba(255,246,225,.1);color:#f3e7cf;width:min(320px,84vw);box-sizing:border-box";
  ov.innerHTML =
    '<div style="font-size:22px;font-weight:800;color:#f0cb35;letter-spacing:.08em;text-transform:uppercase;margin-top:6px">Sezione Admin</div>'
    + '<div style="opacity:.85;font-size:14px">Password amministratore</div>'
    + `<input id="adminPw" type="password" placeholder="Password admin" autocomplete="off" style="${inCss}" />`
    + '<button type="button" id="adminBtn" style="font:inherit;font-size:16px;font-weight:800;padding:11px 30px;border-radius:10px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Entra</button>'
    + '<button type="button" id="adminClose" style="font:inherit;font-size:13px;border:none;background:transparent;color:#e8896f;cursor:pointer;text-decoration:underline">Chiudi</button>'
    + '<div id="adminErr" style="color:#e8896f;font-size:14px;min-height:18px"></div>'
    + '<div id="adminOut" style="width:min(880px,96vw);margin-top:6px"></div>';
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  let adminKey = "";   // memorizzata dopo il login: serve a refresh e dettaglio contrade
  ["keydown", "keyup", "keypress"].forEach((ev) => $("adminPw").addEventListener(ev, (e) => e.stopPropagation()));
  $("adminClose").addEventListener("click", () => ov.remove());

  const load = () => {
    const key = $("adminPw").value || adminKey || "";
    if (!key) { $("adminErr").textContent = "Inserisci la password."; return; }
    $("adminErr").textContent = "Attendi…";
    fetch(ACCOUNT_API + "?admin=" + encodeURIComponent(key))
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) {
          $("adminErr").textContent = j && j.error === "admin-non-configurato"
            ? "Admin non configurato sul server (manca PALIO_ADMIN_KEY)."
            : "Password admin errata.";
          return;
        }
        adminKey = key;
        $("adminErr").textContent = "";
        renderAdmin(j.accounts || [], j.feedback || []);
      })
      .catch(() => { $("adminErr").textContent = "Connessione assente."; });
  };

  // Dettaglio: in quali contrade un giocatore ha vinto (aperto cliccando la riga).
  const showPlayerWins = (email, nome) => {
    if (document.getElementById("adminWinsDetail")) document.getElementById("adminWinsDetail").remove();
    const d = document.createElement("div");
    d.id = "adminWinsDetail";
    d.style.cssText = "position:fixed;inset:0;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;"
      + "gap:12px;background:rgba(8,6,4,.9);color:#f3e7cf;font-family:inherit;padding:24px;text-align:center";
    d.innerHTML = `<div style="font-size:19px;font-weight:800;color:#f0cb35">Vittorie di ${escapeHtml(nome || email)}</div>`
      + '<div id="awdBody" style="font-size:14px;opacity:.9">Attendo…</div>'
      + '<button type="button" id="awdClose" style="font:inherit;font-size:15px;font-weight:700;padding:9px 24px;border-radius:9px;border:1px solid rgba(240,203,53,.4);background:transparent;color:#f3e7cf;cursor:pointer">Chiudi</button>';
    document.body.appendChild(d);
    d.querySelector("#awdClose").addEventListener("click", () => d.remove());
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "playerWins", adminKey, email }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        const body = d.querySelector("#awdBody"); if (!body) return;
        if (!ok || !j.ok) { body.textContent = "Errore nel caricamento."; return; }
        const entries = Object.entries(j.byContrada || {})
          .map(([id, n]) => ({ name: (CONTRADE.find((c) => c.id === id) || {}).name || id, n }))
          .sort((a, b) => b.n - a.n);
        if (!entries.length) { body.innerHTML = '<span style="opacity:.7">Nessuna vittoria registrata per contrada.</span>'; return; }
        body.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;min-width:220px;text-align:left">'
          + entries.map((e) => `<div style="display:flex;justify-content:space-between;background:rgba(240,203,53,.07);border:1px solid rgba(240,203,53,.16);border-radius:8px;padding:6px 12px"><span>${escapeHtml(e.name)}</span><b style="color:#f0cb35">${e.n}</b></div>`).join("")
          + '</div>';
      })
      .catch(() => { const body = d.querySelector("#awdBody"); if (body) body.textContent = "Connessione assente."; });
  };
  const renderAdmin = (accounts, feedback) => {
    const totPalii = accounts.reduce((s, a) => s + (a.palii || 0), 0);
    const totVinti = accounts.reduce((s, a) => s + (a.vinti || 0), 0);
    // ── METRICHE per l'analisi (tutte calcolate dagli account, nessuna chiamata extra) ──
    const nowMs = Date.now();
    const attivi = accounts.filter((a) => (a.palii || 0) > 0).length;
    const vincitori = accounts.filter((a) => (a.vinti || 0) > 0).length;
    const winRate = totPalii ? (totVinti / totPalii * 100) : 0;              // % vittorie sui palii corsi (target ~0,3%)
    const mediaPalii = accounts.length ? (totPalii / accounts.length) : 0;
    const nuovi24h = accounts.filter((a) => a.created && nowMs - a.created < 864e5).length;
    const nuovi7g = accounts.filter((a) => a.created && nowMs - a.created < 7 * 864e5).length;
    const perContrada = {};
    accounts.forEach((a) => { if (a.contrada) perContrada[a.contrada] = (perContrada[a.contrada] || 0) + 1; });
    const topContradaId = Object.keys(perContrada).sort((x, y) => perContrada[y] - perContrada[x])[0];
    const topContradaTxt = topContradaId ? (((CONTRADE.find((c) => c.id === topContradaId) || {}).name || "—") + " · " + perContrada[topContradaId]) : "—";
    const topCorsi = accounts.slice().sort((a, b) => (b.palii || 0) - (a.palii || 0))[0];
    const topVinti = accounts.slice().sort((a, b) => (b.vinti || 0) - (a.vinti || 0))[0];
    const conEta = accounts.filter((a) => (a.eta || 0) > 0);
    const etaMedia = conEta.length ? (conEta.reduce((s, a) => s + a.eta, 0) / conEta.length) : 0;
    const nM = accounts.filter((a) => a.sesso === "M").length;
    const nF = accounts.filter((a) => a.sesso === "F").length;
    const nA = accounts.filter((a) => a.sesso === "A").length;
    const mCard = (label, val, color) => '<div style="flex:1 1 128px;min-width:118px;background:rgba(255,246,225,.05);border:1px solid rgba(240,203,53,.16);border-radius:10px;padding:8px 11px;text-align:left">'
      + '<div style="font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;opacity:.6">' + label + '</div>'
      + '<div style="font-size:18px;font-weight:800;color:' + (color || "#f3e7cf") + ';margin-top:2px">' + val + '</div></div>';
    const metrics = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 2px 14px">'
      + mCard("Iscritti", accounts.length, "#f0cb35")
      + mCard("Attivi (≥1 palio)", attivi + " / " + accounts.length, "#7fd98c")
      + mCard("Palii corsi", totPalii, "#7fd98c")
      + mCard("Palii vinti", totVinti, "#f0cb35")
      + mCard("Win rate", winRate.toFixed(2) + "%", winRate <= 1 ? "#7fd98c" : "#e8b06f")
      + mCard("Media palii / gioc.", mediaPalii.toFixed(1))
      + mCard("Hanno vinto ≥1", vincitori + " / " + accounts.length)
      + mCard("Nuovi 24h", nuovi24h, "#8fd3ff")
      + mCard("Nuovi 7gg", nuovi7g, "#8fd3ff")
      + mCard("Età media", etaMedia ? etaMedia.toFixed(0) : "—")
      + mCard("Sesso M / F / Altro", nM + " / " + nF + " / " + nA)
      + mCard("Contrada + scelta", escapeHtml(topContradaTxt))
      + mCard("Top palii corsi", topCorsi ? escapeHtml((topCorsi.nome || "—") + " · " + (topCorsi.palii || 0)) : "—")
      + mCard("Top vittorie", topVinti ? escapeHtml((topVinti.nome || "—") + " · " + (topVinti.vinti || 0)) : "—")
      + '</div>';
    const admTabCss = "font:inherit;font-size:13.5px;font-weight:700;padding:8px 16px;border-radius:9px;border:1px solid rgba(240,203,53,.4);background:rgba(240,203,53,.12);color:#f3e7cf;cursor:pointer";
    const rows = accounts.map((a, i) => {
      const cName = (CONTRADE.find((c) => c.id === a.contrada) || {}).name || "—";
      const d = a.created ? new Date(a.created).toLocaleDateString("it-IT") : "—";
      return `<tr class="adminRow" data-email="${escapeHtml(a.email)}" data-nome="${escapeHtml((a.nome || "") + " " + (a.cognome || ""))}" title="Clicca: in quali contrade ha vinto" style="border-top:1px solid rgba(240,203,53,.14);cursor:pointer">`
        + `<td style="padding:7px 8px;text-align:right;opacity:.6">${i + 1}</td>`
        + `<td style="padding:7px 8px;text-align:left"><b>${escapeHtml(a.nome)} ${escapeHtml(a.cognome)}</b></td>`
        + `<td style="padding:7px 8px;text-align:left;opacity:.85">${escapeHtml(a.email)}</td>`
        + `<td style="padding:7px 8px;text-align:left">${escapeHtml(cName)}</td>`
        + `<td style="padding:7px 8px;text-align:right;color:#7fd98c;font-weight:800">${a.palii || 0}</td>`
        + `<td style="padding:7px 8px;text-align:right;color:#f0cb35;font-weight:800">${a.vinti || 0}</td>`
        + `<td style="padding:7px 8px;text-align:right;opacity:.6">${d}</td></tr>`;
    }).join("");
    $("adminOut").innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:4px 2px 8px;opacity:.95">`
      + `<span>Account: <b style="color:#f0cb35">${accounts.length}</b></span>`
      + `<span>Palii corsi (somma): <b style="color:#7fd98c">${totPalii}</b></span>`
      + `<span>Palii vinti (somma): <b style="color:#f0cb35">${totVinti}</b></span>`
      + `<button type="button" id="adminRefresh" style="font:inherit;font-size:13px;font-weight:700;padding:6px 16px;border-radius:8px;border:1px solid rgba(240,203,53,.5);background:rgba(240,203,53,.12);color:#f3e7cf;cursor:pointer">🔄 Aggiorna</button></div>`
      + metrics
      // ── TAB IN CIMA (non scalano mai sotto la classifica) ────────────────────
      + '<div id="adminTabs" style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 2px 12px">'
      + '<button type="button" class="admTab" data-sec="secAccounts" style="' + admTabCss + ';background:rgba(240,203,53,.34)">📋 Account (' + accounts.length + ')</button>'
      + '<button type="button" class="admTab" data-sec="secFeedback" style="' + admTabCss + '">💡 Consigli <span style="opacity:.7">(' + (feedback || []).length + ')</span></button>'
      + '<button type="button" class="admTab" data-sec="secHorses" style="' + admTabCss + '">🐎 Cavalli</button>'
      + '<button type="button" class="admTab" data-sec="secJockeys" style="' + admTabCss + '">🏇 Fantini</button>'
      + '<button type="button" class="admTab" data-sec="secDeals" style="' + admTabCss + '">🤝 Accordi</button>'
      + '</div>'
      // Classifica account (sezione DEFAULT aperta)
      + '<div id="secAccounts" class="admSec">'
      + '<div style="font-size:12px;opacity:.6;margin:0 2px 8px">Tocca una riga per vedere in quali contrade ha vinto.</div>'
      + '<div style="overflow:auto;border:1px solid rgba(240,203,53,.18);border-radius:10px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:13.5px">'
      + '<thead><tr style="background:rgba(240,203,53,.1)">'
      + '<th style="padding:8px;text-align:right">#</th><th style="padding:8px;text-align:left">Nome</th>'
      + '<th style="padding:8px;text-align:left">Email</th><th style="padding:8px;text-align:left">Contrada</th>'
      + '<th style="padding:8px;text-align:right">Corsi</th><th style="padding:8px;text-align:right">Vinti</th><th style="padding:8px;text-align:right">Iscritto</th>'
      + '</tr></thead><tbody>' + (rows || '<tr><td colspan="7" style="padding:16px;opacity:.6">Nessun account.</td></tr>') + '</tbody></table></div>'
      + '</div>'
      // Consigli dei giocatori
      + '<div id="secFeedback" class="admSec" style="display:none">'
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + ((feedback && feedback.length)
        ? feedback.map((f) => {
            const d = f.created ? new Date(f.created).toLocaleString("it-IT") : "";
            const who = f.email ? escapeHtml(f.email) : "anonimo";
            return '<div style="text-align:left;background:rgba(240,203,53,.06);border:1px solid rgba(240,203,53,.16);border-radius:9px;padding:9px 12px">'
              + `<div style="font-size:12px;opacity:.6;margin-bottom:3px">${who} · ${d}</div>`
              + `<div style="font-size:14px;white-space:pre-wrap">${escapeHtml(f.text || "")}</div></div>`;
          }).join("")
        : '<div style="opacity:.6;font-size:14px">Ancora nessun consiglio.</div>')
      + '</div></div>'
      // Gestione cavalli (voti stat Potenza/Turn)
      + '<div id="secHorses" class="admSec" style="display:none">'
      + '<div style="font-size:12px;opacity:.6;margin:0 2px 8px">Media dei giocatori (Potenza · Turn). Scrivi un valore e premi Salva per applicare (vuoto = togli l\'override).</div>'
      + '<div id="adminHorseStats" style="font-size:13px;opacity:.7">Caricamento voti…</div>'
      + '</div>'
      // Gestione fantini (voti stat)
      + '<div id="secJockeys" class="admSec" style="display:none">'
      + '<div style="font-size:12px;opacity:.6;margin:0 2px 8px">Media dei giocatori per Mossa/Difesa/3°/Fedeltà/Curva. Salva per applicare.</div>'
      + '<div id="adminJockeyStats" style="font-size:13px;opacity:.7">Caricamento voti…</div>'
      + '</div>'
      // Proposte accordi
      + '<div id="secDeals" class="admSec" style="display:none">'
      + '<div id="adminDealProps" style="font-size:13px;opacity:.7">Caricamento proposte…</div>'
      + '</div>';
    // wiring dopo l'innerHTML: refresh + click sulle righe (dettaglio contrade)
    const refBtn = $("adminRefresh");
    if (refBtn) refBtn.addEventListener("click", load);
    $("adminOut").querySelectorAll(".adminRow").forEach((tr) => {
      tr.addEventListener("click", () => showPlayerWins(tr.getAttribute("data-email"), tr.getAttribute("data-nome")));
    });
    // Tab a fisarmonica: un click apre la sezione (e chiude le altre); ri-cliccando si chiude.
    $("adminOut").querySelectorAll(".admTab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = ov.querySelector("#" + btn.getAttribute("data-sec"));
        const apri = sec && sec.style.display === "none";
        $("adminOut").querySelectorAll(".admSec").forEach((s) => { s.style.display = "none"; });
        $("adminOut").querySelectorAll(".admTab").forEach((b) => { b.style.background = "rgba(240,203,53,.12)"; });
        if (apri && sec) { sec.style.display = ""; btn.style.background = "rgba(240,203,53,.34)"; }
      });
    });
    loadHorseStats();
    loadJockeyStats();
    loadProposals("deal", "adminDealProps");
  };

  // Accetta/rifiuta una proposta di un dato kind (cavallo → col tier).
  const decideProposal = (kind, boxId, name, decision, tier) => {
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "proposalDecide", kind, adminKey, name, decision, tier }) })
      .then((r) => r.json())
      .then((d) => { if (d && d.ok) { bustAcceptedCache(); loadProposals(kind, boxId); } })
      .catch(() => { /* niente */ });
  };
  const loadProposals = (kind, boxId) => {
    const box = $(boxId);
    if (!box) return;
    const isHorse = kind === "horse";
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "proposalsList", kind, adminKey }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) { box.textContent = "Errore nel caricamento delle proposte."; return; }
        const props = j.proposals || [];
        box.style.opacity = "1";
        if (!props.length) { box.innerHTML = '<div style="opacity:.6;font-size:14px">Nessuna proposta.</div>'; return; }
        const STAT = { pending: { t: "In attesa", c: "#e7d18a" }, accepted: { t: "Accettato ✓", c: "#9fe3a6" }, rejected: { t: "Rifiutato", c: "#e8896f" } };
        box.innerHTML = props.map((p) => {
          const st = STAT[p.status] || STAT.pending;
          const when = p.created ? new Date(p.created).toLocaleDateString("it-IT") : "";
          const sel = isHorse
            ? `<select class="prop-tier" data-name="${escapeHtml(p.name)}" style="font:inherit;font-size:12px;padding:4px 6px;border-radius:7px;border:1px solid rgba(159,227,166,.4);background:#17110a;color:#f3e7cf">`
              + ["bono", "brenna", "bombolone"].map((t) => `<option value="${t}"${p.tier === t ? " selected" : ""}>${t}</option>`).join("") + "</select>"
            : "";
          return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;text-align:left;background:rgba(159,227,166,.05);border:1px solid rgba(159,227,166,.16);border-radius:9px;padding:8px 12px;margin-bottom:6px">'
            + `<div style="flex:1;min-width:140px"><b style="font-size:14px">${escapeHtml(p.name)}</b>`
            + `<div style="font-size:11px;opacity:.6">${escapeHtml(p.by || "anonimo")} · ${when} · <span style="color:${st.c}">${st.t}</span></div></div>`
            + sel
            + `<button type="button" class="prop-acc" data-name="${escapeHtml(p.name)}" style="font:inherit;font-size:12px;font-weight:800;padding:6px 12px;border-radius:8px;border:none;background:#9fe3a6;color:#0d2914;cursor:pointer">Accetta</button>`
            + `<button type="button" class="prop-rej" data-name="${escapeHtml(p.name)}" style="font:inherit;font-size:12px;font-weight:700;padding:6px 12px;border-radius:8px;border:1px solid rgba(232,137,111,.5);background:transparent;color:#e8896f;cursor:pointer">Rifiuta</button>`
            + "</div>";
        }).join("");
        box.querySelectorAll(".prop-acc").forEach((b) => b.addEventListener("click", () => {
          const name = b.getAttribute("data-name");
          const selEl = isHorse ? box.querySelector(`.prop-tier[data-name="${CSS.escape(name)}"]`) : null;
          decideProposal(kind, boxId, name, "accept", selEl ? selEl.value : undefined);
        }));
        box.querySelectorAll(".prop-rej").forEach((b) => b.addEventListener("click", () => decideProposal(kind, boxId, b.getAttribute("data-name"), "reject")));
      })
      .catch(() => { box.textContent = "Connessione assente."; });
  };

  // Salva (o rimuove) un override stat: applica il valore al cavallo/fantino nel gioco.
  const saveOverride = (kind, name, stat, value, msgEl) => {
    if (msgEl) { msgEl.style.color = "#f3e7cf"; msgEl.textContent = "…"; }
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setStatOverride", adminKey, kind, name, stat, value }) })
      .then((r) => r.json())
      .then((d) => { if (d && d.ok) bustAcceptedCache(); if (msgEl) { msgEl.style.color = d && d.ok ? "#9fe3a6" : "#e8896f"; msgEl.textContent = d && d.ok ? "✓" : "errore"; } })
      .catch(() => { if (msgEl) { msgEl.style.color = "#e8896f"; msgEl.textContent = "offline"; } });
  };
  // Riga input+salva per una stat (riusata cavalli/fantini). Mostra il NOSTRO valore
  // + la media votata + lo scostamento Δ (verde=vicino · giallo=medio · rosso=lontano).
  const statInput = (kind, name, stat, label, avg, n, cur) => {
    const def = n ? Math.round(avg) : (cur != null ? cur : 3);
    const delta = (n && cur != null) ? Math.round((avg - cur) * 10) / 10 : null;
    const dcol = delta == null ? "#8a8378" : (Math.abs(delta) < 0.5 ? "#9fe3a6" : Math.abs(delta) < 1.5 ? "#e7d18a" : "#e8896f");
    return `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="font-size:11px;opacity:.75;width:52px">${label}</span>`
      + `<span style="font-size:11px;opacity:.85;width:56px">nostro <b>${cur != null ? cur : "?"}</b></span>`
      + `<span style="font-size:11px;opacity:.65;width:58px">media ${n ? avg : "—"}<span style="opacity:.6"> (${n})</span></span>`
      + `<span style="font-size:11px;font-weight:700;color:${dcol};width:44px">${delta == null ? "—" : "Δ " + (delta > 0 ? "+" : "") + delta}</span>`
      + `<input type="number" min="1" max="5" value="${def}" class="ov-in" data-k="${kind}" data-name="${escapeHtml(name)}" data-stat="${stat}" style="width:44px;font:inherit;font-size:12px;padding:3px 5px;border-radius:6px;border:1px solid rgba(240,203,53,.4);background:#17110a;color:#f3e7cf">`
      + `<button type="button" class="ov-save" data-k="${kind}" data-name="${escapeHtml(name)}" data-stat="${stat}" style="font:inherit;font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Salva</button>`
      + `<span class="ov-msg" data-k="${kind}" data-name="${escapeHtml(name)}" data-stat="${stat}" style="font-size:11px"></span></div>`;
  };
  const wireOverrideSaves = (box) => {
    box.querySelectorAll(".ov-save").forEach((b) => b.addEventListener("click", () => {
      const kind = b.getAttribute("data-k"), name = b.getAttribute("data-name"), stat = b.getAttribute("data-stat");
      const sel = `[data-k="${kind}"][data-name="${CSS.escape(name)}"][data-stat="${stat}"]`;
      const inp = box.querySelector("input.ov-in" + sel), msg = box.querySelector("span.ov-msg" + sel);
      saveOverride(kind, name, stat, inp ? inp.value : "", msg);
    }));
  };
  // Voti stat CAVALLI (Potenza/Turn) con approva/cambia.
  const loadHorseStats = () => {
    const box = $("adminHorseStats"); if (!box) return;
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "statResults" }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) { box.textContent = "Errore nel caricamento."; return; }
        const res = j.results || {};
        box.style.opacity = "1";
        box.innerHTML = Object.keys(HORSE_ROSTER).map((name) => {
          const r = res[name] || {}; const p = r.potenza || { avg: 0, n: 0 }, t = r.turn || { avg: 0, n: 0 };
          const cur = HORSE_ROSTER[name] || {};
          return `<div style="text-align:left;background:rgba(240,203,53,.05);border:1px solid rgba(240,203,53,.14);border-radius:9px;padding:8px 12px;margin-bottom:6px"><b style="font-size:13px">${escapeHtml(name)}</b>`
            + `<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px">${statInput("horse", name, "potenza", "Potenza", p.avg, p.n, cur.potenza)}${statInput("horse", name, "turn", "Turn", t.avg, t.n, cur.turns)}</div></div>`;
        }).join("");
        wireOverrideSaves(box);
      })
      .catch(() => { box.textContent = "Connessione assente."; });
  };
  // Voti stat FANTINI (5 metriche) con approva/cambia.
  const loadJockeyStats = () => {
    const box = $("adminJockeyStats"); if (!box) return;
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "jkStatResults" }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) { box.textContent = "Errore nel caricamento."; return; }
        const res = j.results || {};
        const M = [["mossa", "Mossa"], ["difesa", "Difesa"], ["terzo", "3° giro"], ["fedelta", "Fedeltà"], ["curva", "Curva"]];
        box.style.opacity = "1";
        box.innerHTML = JOCKEYS.slice().sort((a, b) => (b.ingaggio || 0) - (a.ingaggio || 0)).map((jk) => {
          const r = res[jk.nick] || {};
          const rows = M.map(([id, lab]) => { const s = r[id] || { avg: 0, n: 0 }; return statInput("jockey", jk.nick, id, lab, s.avg, s.n, jk[id]); }).join("");
          const nm = escapeHtml(jk.nick);
          const pv = r.ingaggio || { avg: 0, n: 0 };
          const price = `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:5px;border-top:1px solid rgba(231,209,138,.15);padding-top:5px">`
            + `<span style="font-size:11px;opacity:.75;width:52px">Prezzo</span>`
            + `<span style="font-size:11px;opacity:.85">nostro <b>${jk.ingaggio != null ? jk.ingaggio : "?"}</b></span>`
            + `<span style="font-size:11px;opacity:.65">media ${pv.n ? pv.avg : "—"}<span style="opacity:.6"> (${pv.n})</span> · max 150</span>`
            + `<input type="number" min="0" max="150" value="${jk.ingaggio != null ? jk.ingaggio : 0}" class="ov-in" data-k="jockey" data-name="${nm}" data-stat="ingaggio" style="width:56px;font:inherit;font-size:12px;padding:3px 5px;border-radius:6px;border:1px solid rgba(240,203,53,.4);background:#17110a;color:#f3e7cf">`
            + `<button type="button" class="ov-save" data-k="jockey" data-name="${nm}" data-stat="ingaggio" style="font:inherit;font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Salva</button>`
            + `<span class="ov-msg" data-k="jockey" data-name="${nm}" data-stat="ingaggio" style="font-size:11px"></span></div>`;
          return `<div style="text-align:left;background:rgba(231,209,138,.05);border:1px solid rgba(231,209,138,.16);border-radius:9px;padding:8px 12px;margin-bottom:6px"><b style="font-size:13px">${nm}</b>`
            + `<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px">${rows}${price}</div></div>`;
        }).join("");
        wireOverrideSaves(box);
      })
      .catch(() => { box.textContent = "Connessione assente."; });
  };

  // (deprecato — non più chiamato) Risultati del sondaggio TIER cavalli.
  const loadPoll = () => {
    const box = $("adminPoll");
    if (!box) return;
    fetchAcceptedHorses(() => {   // assicura che i cavalli accettati siano nel roster
    fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pollResults" }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) { box.textContent = "Errore nel caricamento dei voti."; return; }
        const res = j.results || {};
        const TCOL = { brenna: "#d79c81", bono: "#e7d18a", bombolone: "#9fe3a6" };
        const TLAB = { brenna: "Brenna", bono: "Bono", bombolone: "Bombolone" };
        const names = Object.keys(HORSE_ROSTER);
        const rows = names.map((name) => {
          const c = res[name] || { brenna: 0, bono: 0, bombolone: 0 };
          const tot = (c.brenna || 0) + (c.bono || 0) + (c.bombolone || 0);
          const attuale = (HORSE_ROSTER[name] && HORSE_ROSTER[name].tier) || "";
          // tier più votato (in caso di parità: bombolone > bono > brenna non forzato,
          // resta il primo per conteggio; segnaliamo solo se ci sono voti)
          let top = "", topN = -1;
          ["brenna", "bono", "bombolone"].forEach((t) => { if ((c[t] || 0) > topN) { topN = c[t] || 0; top = t; } });
          const bars = ["brenna", "bono", "bombolone"].map((t) => {
            const n = c[t] || 0;
            const pct = tot ? Math.round((n / tot) * 100) : 0;
            return `<div style="flex:1;min-width:70px"><div style="font-size:11px;color:${TCOL[t]};display:flex;justify-content:space-between"><span>${TLAB[t]}</span><b>${n}</b></div>`
              + `<div style="height:6px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:${pct}%;background:${TCOL[t]}"></div></div></div>`;
          }).join("");
          const cambia = tot && top && top !== attuale
            ? `<span style="color:#f0cb35;font-weight:800">→ ${TLAB[top]}</span>` : "";
          const defTier = (tot && top) ? top : attuale;   // default del selettore = più votato
          const sel = `<select class="pollTier" data-name="${escapeHtml(name)}" style="font:inherit;font-size:12px;padding:4px 6px;border-radius:7px;border:1px solid rgba(240,203,53,.35);background:#17110a;color:#f3e7cf">`
            + ["brenna", "bono", "bombolone"].map((t) => `<option value="${t}"${defTier === t ? " selected" : ""}>${TLAB[t]}</option>`).join("") + "</select>";
          return `<div style="text-align:left;background:rgba(240,203,53,.05);border:1px solid rgba(240,203,53,.14);border-radius:9px;padding:8px 12px;margin-bottom:6px">`
            + `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:5px">`
            + `<b style="font-size:14px">${escapeHtml(name)}</b>`
            + `<span style="font-size:11px;opacity:.7">oggi: <span style="color:${TCOL[attuale] || "#f3e7cf"};text-transform:capitalize">${attuale}</span> · ${tot} voti ${cambia}</span></div>`
            + `<div style="display:flex;gap:10px;align-items:flex-end">${bars}</div>`
            + `<div style="display:flex;gap:8px;align-items:center;margin-top:7px">${sel}`
            + `<button type="button" class="pollApply" data-name="${escapeHtml(name)}" style="font:inherit;font-size:12px;font-weight:800;padding:5px 12px;border-radius:8px;border:none;background:#f0cb35;color:#1a1206;cursor:pointer">Applica classe</button>`
            + `<span class="pollApplyMsg" data-name="${escapeHtml(name)}" style="font-size:11px;opacity:.8"></span></div></div>`;
        }).join("");
        const totVoti = names.reduce((s, n) => { const c = res[n] || {}; return s + (c.brenna || 0) + (c.bono || 0) + (c.bombolone || 0); }, 0);
        box.style.opacity = "1";
        box.innerHTML = `<div style="font-size:12px;opacity:.65;margin-bottom:8px">Totale voti espressi: <b style="color:#f0cb35">${totVoti}</b>. La freccia gialla segnala i cavalli dove il tier più votato è diverso da quello attuale. "Applica classe" cambia davvero il cavallo (subito nelle prossime corse).</div>` + rows;
        box.querySelectorAll(".pollApply").forEach((b) => b.addEventListener("click", () => {
          const name = b.getAttribute("data-name");
          const selEl = box.querySelector(`.pollTier[data-name="${CSS.escape(name)}"]`);
          const msgEl = box.querySelector(`.pollApplyMsg[data-name="${CSS.escape(name)}"]`);
          const tier = selEl ? selEl.value : "bono";
          if (msgEl) { msgEl.style.color = "#f3e7cf"; msgEl.textContent = "…"; }
          fetch(ACCOUNT_API, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setHorseTier", adminKey, name, tier }) })
            .then((r) => r.json())
            .then((d) => { if (d && d.ok) bustAcceptedCache(); if (msgEl) { msgEl.style.color = d && d.ok ? "#9fe3a6" : "#e8896f"; msgEl.textContent = d && d.ok ? "Applicato ✓" : "Errore"; } })
            .catch(() => { if (msgEl) { msgEl.style.color = "#e8896f"; msgEl.textContent = "Offline"; } });
        }));
      })
      .catch(() => { box.textContent = "Connessione assente."; });
    });
  };
  $("adminBtn").addEventListener("click", load);
  $("adminPw").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  setTimeout(() => { try { $("adminPw").focus(); } catch (e) { /* niente */ } }, 60);
}

// A PROVA DI CACHE: index.html e style.css possono restare in cache vecchia sul
// telefono (salvati prima degli header must-revalidate). game-3d.js è invece SEMPRE
// fresco (?v= cache-bust). Da qui garantiamo il tasto NERBO e le posizioni corrette
// dei controlli touch, così arrivano sul telefono anche senza svuotare la cache.
function ensureMobileControlsFresh() {
  // 0) classe touch-device: fa comparire i controlli touch su telefono E iPad
  //    (a prescindere dalla larghezza schermo), e li nasconde su desktop.
  document.body.classList.toggle("touch-device", !!IS_TOUCH_DEVICE);
  // 1) posizioni/aspetto dei controlli touch + tastini andatura + avviso "ruota" —
  //    iniettati DOPO style.css nel <head>, quindi vincono sul CSS vecchio in cache.
  if (!document.getElementById("touch-fresh-style")) {
    const st = document.createElement("style");
    st.id = "touch-fresh-style";
    st.textContent = `
body:not(.touch-device) .touch-controls{display:none !important}
.touch-controls{display:block}
.touch-stick{display:none !important}
.touch-gait,.touch-lat,.touch-steer{pointer-events:auto !important;position:absolute !important;width:54px !important;height:54px !important;border-radius:13px !important;border:1px solid rgba(216,169,58,.5) !important;background:rgba(30,22,12,.82) !important;color:#f3e7cf !important;font-size:22px !important;font-weight:800 !important;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;display:flex !important;align-items:center;justify-content:center}
.touch-gait:active,.touch-lat:active,.touch-steer:active{background:rgba(216,169,58,.85) !important;color:#1a1206 !important;transform:scale(.96)}
.touch-gait-up{left:calc(env(safe-area-inset-left,0px) + 66px) !important;right:auto !important;bottom:calc(env(safe-area-inset-bottom,0px) + 130px) !important}
.touch-gait-down{left:calc(env(safe-area-inset-left,0px) + 66px) !important;right:auto !important;bottom:calc(env(safe-area-inset-bottom,0px) + 16px) !important}
.touch-lat-left{left:calc(env(safe-area-inset-left,0px) + 10px) !important;right:auto !important;bottom:calc(env(safe-area-inset-bottom,0px) + 73px) !important}
.touch-lat-right{left:calc(env(safe-area-inset-left,0px) + 122px) !important;right:auto !important;bottom:calc(env(safe-area-inset-bottom,0px) + 73px) !important}
.touch-steer-left{left:auto !important;right:calc(env(safe-area-inset-right,0px) + 84px) !important;bottom:calc(env(safe-area-inset-bottom,0px) + 30px) !important}
.touch-steer-right{left:auto !important;right:calc(env(safe-area-inset-right,0px) + 22px) !important;bottom:calc(env(safe-area-inset-bottom,0px) + 30px) !important}
.touch-controls.race-mode .touch-lat{display:none !important}
body.touch-device .hud-bottom-left{top:calc(env(safe-area-inset-top,0px) + 30px) !important;bottom:auto !important;left:calc(env(safe-area-inset-left,0px) + 10px) !important;transform:scale(.82) !important;transform-origin:top left !important}
.touch-nerb{width:112px !important;height:44px !important;left:auto !important;right:calc(env(safe-area-inset-right,0px) + 22px) !important;bottom:calc(env(safe-area-inset-bottom,0px) + 96px) !important;border-radius:12px !important;font-size:14px !important;font-weight:800 !important;letter-spacing:.1em !important;background:rgba(160,42,32,.86) !important;border-color:rgba(245,160,130,.6) !important;color:#fff5ec !important}
.touch-nerb:active{background:rgba(200,60,46,.95) !important;transform:scale(.96)}
body.touch-device .rincorsa-watcher{left:50% !important;right:auto !important;transform:translateX(-50%) !important;top:calc(env(safe-area-inset-top,0px) + 30px) !important;width:188px !important;height:116px !important}
#rotateNotice{display:none}
@media (orientation:portrait){body.touch-device #rotateNotice{display:flex}}`;
    document.head.appendChild(st);
  }
  // 2) bottoni: crea quelli mancanti (index.html vecchio in cache) e togli il joystick.
  const tc = document.getElementById("touchControls");
  if (tc) {
    const old = tc.querySelector("#touchStick"); if (old) old.remove();   // via il vecchio joystick
    const mk = (cls, dt, label, txt) => {
      if (tc.querySelector("." + cls.split(" ").pop())) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "touch-btn " + cls;
      b.setAttribute("data-touch", dt); b.setAttribute("aria-label", label); b.textContent = txt;
      tc.appendChild(b);
    };
    mk("touch-nerb", "nerb", "Nerbata", "NERBO");
    // D-PAD SINISTRA: ▲▼ andatura · ◀▶ scorrimento laterale (spariscono in corsa)
    mk("touch-gait touch-gait-up", "gaitUp", "Aumenta andatura", "▲");
    mk("touch-gait touch-gait-down", "gaitDown", "Riduci andatura", "▼");
    mk("touch-lat touch-lat-left", "latLeft", "Scorri a sinistra", "◀");
    mk("touch-lat touch-lat-right", "latRight", "Scorri a destra", "▶");
    // DESTRA: ◀▶ CURVA (sterzo) — usabili anche in corsa
    mk("touch-steer touch-steer-left", "left", "Curva a sinistra", "◀");
    mk("touch-steer touch-steer-right", "right", "Curva a destra", "▶");
  }
  // 3) avviso "ruota in orizzontale" (solo touch; visibile in portrait via CSS sopra).
  if (IS_TOUCH_DEVICE && !document.getElementById("rotateNotice")) {
    const r = document.createElement("div");
    r.id = "rotateNotice";
    r.style.cssText = "position:fixed;inset:0;z-index:99999;flex-direction:column;align-items:center;"
      + "justify-content:center;text-align:center;padding:28px;background:#0d0906;color:#f3e7cf;font-family:inherit";
    r.innerHTML = '<div style="font-size:54px">🔄</div>'
      + '<div style="font-size:22px;font-weight:800;margin-top:14px">Ruota il dispositivo in orizzontale</div>'
      + '<div style="opacity:.7;font-size:15px;margin-top:6px">Il Palio si gioca solo in modalità panoramica</div>';
    document.body.appendChild(r);
  }
}

function init() {
  applicaImpostazioni();  // epoca (cavalli+fantini) e durata massima della mossa
  maybeOpenAdmin();       // ?admin → pannello amministratore (sopra tutto)
  ensurePasswordGate();   // gate password: copre tutto finché non entri
  // WATCHDOG DEMO: chi era GIÀ dentro quando scatta l'ora resterebbe a giocare col
  // codice vecchio in memoria. Ogni 15s ricontrolla: se la DEMO è iniziata, ricarica
  // la pagina → al reload trova la schermata DEMO. Esclusi gli account abilitati. Se il gate è
  // già a schermo NON ricarica (altrimenti sarebbe un loop di reload).
  setInterval(() => {
    try {
      if (!demoBloccaQuesto()) return;
      if (document.getElementById("demoGate")) return;
      location.reload();
    } catch (e) { /* niente */ }
  }, 15000);
  try {
    precomputeTrack();
    // Ora che la pista esiste, verrocchino e corsia della rincorsa si spostano sul
    // nuovo bordo esterno svasato: è lo spazio che libera le poste.
    VERROCCHINO_LANE = verrocchinoLane();
    RINCORSA_LANE = rincorsaLane();
    // …e si individuano le due curve per il profilo di larghezza variabile.
    // DEVE stare PRIMA di buildScene: i ribbon e le barriere leggono trackNarrowAt.
    computeTrackNarrows();
    loadIdealLine();
    fetchGlobalAlbo();   // carica l'albo GLOBALE condiviso (async, non blocca il boot)
    fetchAcceptedHorses(() => fetchStatOverrides());   // cavalli accettati, poi gli override stat admin
    fetchAcceptedJockeys(() => fetchStatOverrides());   // fantini accettati, poi override (dopo che esistono in JOCKEYS)
    createContradaGrid();
    ensureMobileControlsFresh();   // tasto NERBO + posizioni touch a prova di cache (PRIMA di bindEvents)
    bindEvents();
    resize();
    openMenuScreen();
    buildScene();
    createDemoHorses();
    frame();
    markGameReady();
  } catch (error) {
    console.error(error);
    reportBootError(error);
    showMessage("Errore grafica 3D: ricarica la pagina", 3, "danger");
  }
}

init();
caricaHorseGlb();   // async: quando arriva, veste i cavalli già in scena
caricaJockeyGlb();  // async: quando arriva, mette il fantino GLB in sella
// Precarico i file audio ~1.4s dopo il boot (quando i GLB critici sono già in
// corso), così a mossa/arrivo non c'è decodifica al primo play → niente scatti.
setTimeout(() => { try { preloadPalioSounds(); } catch (e) { /* niente */ } }, 1400);
