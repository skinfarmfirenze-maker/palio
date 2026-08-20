# 🏇 Handoff per la chat "fantini" — creazione dei nuovi fantini del Palio

Questa chat è specializzata **solo nella creazione/aspetto dei fantini** del gioco 3D "Palio della Piazza". Qui trovi tutto il contesto per lavorarci senza ripartire da zero. **Tutto il codice del gioco è già su disco in questa cartella** (`~/Library/Mobile Documents/com~apple~CloudDocs/PALIO/`).

---

## 1. Il gioco in breve
- **Gioco**: corsa di cavalli 3D ispirata al Palio di Siena, Three.js r0.165 (ES module da jsdelivr CDN), **single-file** `game-3d.js` (~13k righe, vanilla JS, niente build/bundler).
- **Live**: https://fianca-la-mossa.vercel.app
- **Deploy** (regola utente: "deploy sempre subito"):
  ```bash
  cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/PALIO
  node --check game-3d.js && cp game-3d.js /tmp/gd_readable.js && bash /tmp/deploy_palio.sh
  ```
  Lo script fa: terser minify (`--module --compress --mangle`) → `vercel deploy --prod` → alias `fianca-la-mossa.vercel.app` (SENZA `--scope`) → ripristina il sorgente leggibile via trap. Aspetta la riga `ALIAS FATTO`.
  ⚠️ terser **mangla i nomi** di funzioni/const (grep=0), ma preserva le **stringhe** e i **nomi delle proprietà oggetto**.
- **Verifica visiva**: server statico locale + browser.
  ```bash
  cd ~/…/PALIO && python3 -m http.server 1212
  ```
  poi apri `http://localhost:1212/jockey-q-test.html` (banco di prova fantino) e fai screenshot.

## 2. Dove vivono i fantini nel codice (`game-3d.js`)
- **Fantino PROCEDURALE** (quello LIVE di default): costruito con primitive Three.js (corpo, braccia, zucchino, nerbo). Cerca le funzioni che costruiscono il gruppo `jockey` del cavallo.
- **Fantino GLB** (anteprima, dietro `?jockeyglb=1`, default OFF finché non approvato):
  - `const JOCKEY_GLB = { url: "assets/jockeys/jockey_master.glb", attivo: /[?&]jockeyglb=1/… , pose:{…}, … }`
  - `caricaJockeyGlb()` — carica e posa la sorgente una volta; `attaccaJockeyGlb(horse, bbHorse)` — clona (`SkeletonUtils.clone`) e aggancia a ogni cavallo, aggiunge **zucchino** (calotta) e **nerbo**.
  - Osso mano sinistra per il nerbo: il codice cerca **`Fist.L` o `FistL`** (rig Quaternius/KayKit hanno il punto).
- **Ricolore per Contrada** (FEDELE ai colori reali): array Contrade con `colors: [principale, secondario, liste]`. Cerca `{ id: "leocorno", … colors: [LIV.bianco, LIV.arancio, LIV.azzurro] … }`.
  - Convenzione: **principale = giubbetto + zucchino**, **secondario = maniche + pantaloni**, **liste = bordi/filettature/collo**. Alcune Contrade hanno anche `silkStripe`.
  - Le 17 terne colore sono già i dati fedeli: usa QUELLE, non inventare.
- **Stat fantini** (non estetica, ma utile saperlo): `JOCKEYS` (fittizi/base), `JOCKEY_STATS_OVERRIDE`, `JOCKEY_NAMES` (nomi reali da ilpalio.org), `JOCKEY_DUP_SKIP` (duplicati fusi), `STAT_FINAL_JOCKEY` (override finale per nick, vince su tutto).

## 3. Cosa è già stato provato (e perché scartato)
1. **KayKit "Rogue"** (`jockey_master.glb`): personaggio vestito ma con **testa enorme** quando si aggiunge lo zucchino ("come pianeti"). Accantonato dietro `?jockeyglb=1`.
2. **Quaternius "Universal Base Characters"** (CC0, in `assets/jockeys/quaternius/Superhero_Male_FullBody.gltf` + .bin + texture): scaricato e verificato. ⚠️ **È un CORPO NUDO in mutande** (muscoloso "Superhero"), **senza vestiti, senza animazioni**, scheletro stile **Unreal** (`pelvis, spine_01/02/03, neck_01, Head, thigh_l/r, calf_l/r, foot_l/r, clavicle/upperarm/lowerarm/hand_l/r`). Il pacchetto free ha SOLO il corpo "Superhero" (il "Teen" snello è nella versione a pagamento). Materiali: `MI_Superhero_Male, MI_Hair_1, MI_Eyes`. Modello **Z-up**.
3. **Vestizione via codice** (`jockey-q-test.html`, funzione `buildOutfit`): giubbetto/maniche/pantaloni/zucchino/nerbo costruiti come **gusci** (cilindri/sfere) sul corpo posato, ricolorati per Contrada. **Verdetto utente: "fa schifo sembra una lattina"** → l'approccio a gusci è scartato: dà effetto scatola rigida.

## 4. Cosa vuole l'utente (requisiti)
- Fantini **belli da vedere**, non "a tubi/lattina".
- **Fedeltà ai colori delle Contrade** (usa le terne `colors` già nel codice).
- **Stemma vero della Contrada sul dorso** (unicorno del Leocorno, aquila, oca, lupa…): sono **17 disegni araldici** → servono immagini/texture reali (l'ovale segnaposto attuale non basta). L'utente ha detto "sì, servono quelli veri".
- Dettagli autentici (da foto reali del fantino del **Leocorno** che l'utente ha inviato): giubbetto **due-toni** con bordi azzurri, **zucchino a spicchi**, stemma **fronte + retro**, pantaloni bicolore con risvolto alla caviglia, scarpe nere, **nerbo** chiaro, e **si corre "a pelo" — SENZA SELLA né staffe** (scartare quindi gli asset da ippica moderna).
- **Vincoli duri**: solo asset **CC0/licenza permissiva** (il deploy serve i file pubblicamente → un GLB nel browser è scaricabile = ridistribuzione). Niente modelli CGTrader/Sketchfab non-CC0 senza permesso scritto per WebGL. Blender **non è disponibile in autonomia** alla chat (headless).

## 5. Le tre strade sul tavolo (decisione dell'utente ancora aperta)
- **A) Personaggio CC0 GIÀ VESTITO e riggato** (es. Quaternius *Ultimate Animated Characters* / *RPG Characters*): ha i vestiti **già modellati** con materiali separati → si **ricolorano** per Contrada (stoffa vera, non tubi) + zucchino + stemma-immagine + nerbo. Fattibile senza Blender. **Raccomandata.**
- **B) Route Blender** (definitiva/autentica): modellare il giubbetto sul corpo. Qualità massima ma richiede modellazione in Blender (utente o terzi).
- **C) Migliorare il fantino PROCEDURALE** esistente (su misura, controllo totale, zero licenze/scheletri).

## 6. Banco di prova & come iterare
- `jockey-q-test.html` — carica il corpo Quaternius, posa seduta, `buildOutfit`. Parametri URL: `?nude=1` (solo corpo), `?raw=1` (bind pose), `?horse=1` (con cavallo), `?ang=NN` (angolo camera fisso), `?p=osso:x,y,z;…` (override posa).
- Flusso: modifica → `python3 -m http.server 1212` → screenshot browser da più angoli → itera → quando è buono, aggancia in `game-3d.js` dietro `?jockeyglb=1` → far approvare all'utente → poi default.
- Emblemi Contrada: da procurare CC0/ricreare come **texture/PNG** applicate sul dorso (17 file).

## 7. Stato attuale
- Live: fantino **procedurale** (default). GLB dietro `?jockeyglb=1`.
- `jockey-q-test.html` + `assets/jockeys/quaternius/` = WIP vestizione scartata ("lattina"), da NON mettere nel gioco così.
- Prossimo passo consigliato: chiedere all'utente A/B/C, poi se **A** procurare un personaggio CC0 vestito e ricolorarlo.

---
*Handoff creato dalla sessione "Palio" (che ha lavorato su gate/mossa/accordi/caduta/stat). Per il resto del gioco, il codice è tutto in `game-3d.js`. Buon lavoro sui fantini!*

---

## 8. STATO (agg. 2026-08-20, chat fantini)
La chat fantini ha scelto la **strada C potenziata**: fantino procedurale "lofted" nel nuovo modulo **`fantino-lab.js`** (superfici continue + livree su texture canvas + viso dipinto + mani con dita; niente asset esterni, zero licenze). Banchi di prova: **`fantino-test.html`** (4 viste, `?c=<id>`, `?viso=1`, `?mira=x,y,z`) e **`fantini-tutti.html`** (griglia 17). Decisioni utente: colori ok, viso approvato dopo rework, stemma dorso con **EMBLEMI VERI**: PNG in `assets/stemmi/{id}.png` (ritagli delle bandiere delle voci di Wikipedia italiana, ritagli in `ritagli.json`, originali in `bandiere-src/`, fonti in `CREDITS.md`). ⚠️ **LICENZA: NON liberi** — su itwiki stanno sotto eccezione marchi ('Copyrighted'); pubblicarli col deploy è una decisione dell'utente, non ancora presa esplicitamente. **FANTINI APPROVATI DALL'UTENTE (2026-08-20)** — dopo i giri finali: Istrice a righe VERTICALI bianco/rosso/blu/nero (campo `fasce`), zucchino beccheggiato all'indietro a coprire la nuca (theta 0.72π, rotation.x −0.16), bacino/sedere che chiude il busto e poggia sul dorso del cavallo. Il modello è PRONTO per l'integrazione in game-3d.js: `import { buildFantino, CONTRADE } from "./fantino-lab.js"` dietro flag (es. `?fantino2=1`), al posto del rider procedurale, rispettando i contratti `group.userData.jockey`, `rider.userData.rightArm` (nerbo/vittoria), `rider.userData.whip`, `firstPersonHidden` e la quota sella y≈1.78. NB: fantino-lab.js ha la SUA copia di CONTRADE (con `fasce` per l'Istrice): all'integrazione mappare gli id del gioco → buildFantino(contradaLab). Caduta/scosso: il fantino non è skinned, `clone(true)` basta. ACCORDO tra le chat: `fantino-lab.js` lo modifica SOLO la chat fantini, che notifica alla chat Palio ogni aggiornamento (regola di Simone); l'integrazione in game-3d.js è a carico della chat Palio. Handoff inviato via messaggio cross-session il 2026-08-20.

---

## 9. ✅ RISOLTA (chat fantini, 2026-08-20) — GAMBE non visibili
**Fix applicato in fantino-lab.js**: gambe ricalibrate sul cavallo GLB vero (ginocchio x ±0.222, caviglia ±0.234, scarpa y 1.446, unità modello pre-wrap) → visibili fuori dalla sagoma in tutte le viste; materiali tutti DoubleSide+opachi espliciti (il "trasparente" era anche retro-faccia dei tubi). fantino-test.html ora replica la catena esatta d'integrazione (GLB+scala+trim+wrap): è il riferimento visivo fedele al gioco. Notificato alla chat Palio per la re-integrazione.

### Testo originale della richiesta:
In gioco le **gambe del fantino non si vedono**: cadono lungo i fianchi ma finiscono **DENTRO la sagoma del cavallo** (che le copre) → l'utente lo percepisce come "fantino trasparente". Verificato: i materiali del CORPO sono opachi (solo `stemmaMat` ha `transparent:true`, corretto per il PNG). Quindi **non è trasparenza: è geometria delle gambe** che compenetra il cavallo.

Parametri ATTUALI dell'integrazione in game-3d.js (per tararci le gambe):
- Cavallo: `group.scale = 1.08*1.10 = 1.188` (uguale per tutti).
- Fantino: avvolto in un wrap con `scale = 1.8` (FANTINO_SCALE), ancorato a `y=1.78` (FANTINO_SEAT_Y) e spostato avanti `z=+0.20` (FANTINO_SEAT_Z).
- Cavallo GLB = `assets/horses/horse_master.glb`, scala HORSE_GLB.scala, trimY -0.75.

Cosa serve (nel modello, lato vostro): **allargare/abbassare le gambe** così stringono i fianchi ma restano VISIBILI fuori dalla sagoma del cavallo (o piegare il ginocchio più in fuori). Meglio se tarato sul nostro cavallo GLB reale (non solo sul `dorso` finto di fantino-test.html, che è più stretto: `dorso.scale.set(0.62,1,0.86)`), perché è lì che compenetra. Quando fatto, notificatemi e re-integro. Grazie!
