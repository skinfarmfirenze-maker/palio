# Prompt per Claude Code — Palio 3D: miglioramento grafica e giocabilità

## Contesto del progetto

Gioco di simulazione equestre in Three.js (r0.165) ispirato al Palio di Siena. Il codice si trova in tre file: `index.html`, `style.css`, `game-3d.js` (≈ 2 750 righe). Usa WebGL con shadowmap PCFSoft, WebAudio API sintetizzata e nessuna dipendenza esterna oltre a Three.js.

**Flow di gioco attuale:**
1. Menu → Selezione contrada (17 contrade reali di Siena)
2. La Mossa: cavalli al canapo, il giocatore si posiziona lateralmente
3. Partenza: 3 giri del tracciato (loop ovale "Piazza del Campo")
4. Risultati con classifica finale

**Controlli:** `W/S` = velocità (1–10), `A` = sterza sinistra, `L` = sterza destra. Touch su mobile.

---

## Area 1 — GRAFICA

### 1a. Cielo e atmosfera

Sostituisci `scene.background = new THREE.Color(0x90b9d7)` e `scene.fog` con un sistema cielo più ricco:

- **Sky dome procedurale:** usa `THREE.Mesh` con `THREE.SphereGeometry` capovolta (backside) e un `ShaderMaterial` che interpola colori dall'orizzonte (arancio/oro siena `#e8a04a`) all'apice (`#5590c8`). L'angolo di elevazione del sole è fisso (tardo pomeriggio estivo, circa 25°).
- **Nuvole:** 6–8 piani `PlaneGeometry` rotanti lentamente a `y = 60–80`, con `MeshBasicMaterial` bianco semitrasparente (opacity 0.35–0.55), disposti casualmente in semicerchio sopra la piazza.
- **Nebbia esponenziale:** sostituisci `THREE.Fog` con `THREE.FogExp2(0xd4a06a, 0.0055)` per ammorbidire la linea dell'orizzonte.
- **Sole volumetrico (fake):** aggiungi uno `Sprite` giallo/bianco grande (~4 unità) in direzione `sun.position` con `SpriteMaterial` + `blending: THREE.AdditiveBlending`, opacità 0.6.

### 1b. Materiali e illuminazione

- **Tufo realistico:** sostituisci `materials.tufo` con un `MeshStandardMaterial` che ha una `CanvasTexture` 256×256 procedurale (campioni grain irregolari, colori in range `#c07030`–`#d09850`), più `roughness: 0.88, metalness: 0.01`. Applica anche una leggera `bumpMap` (stessa texture in grigio).
- **Prato piazza:** `materials.grass` attuale è solo colore piatto. Crea una texture Canvas 256×256 con strisce irregolari beige/ocra e una leggera griglia (le mattonelle del Campo), applica come `map` al materiale `ground`.
- **Luce ambiente migliore:** abbassa `HemisphereLight` a intensità 1.4 e aggiungi un secondo `DirectionalLight` molto tenue (intensità 0.35, colore `#c0d0ff`) dal lato opposto al sole per simulare rimbalzo del cielo.
- **Emissione finestre edifici la sera:** il materiale `#f2c87b` delle finestre cambialo in `MeshStandardMaterial` con `emissive: new THREE.Color(0xffa030)` ed `emissiveIntensity: 0.5` per dare l'impressione di finestre illuminate.

### 1c. Effetti particella e post-processing leggero

- **Polvere potenziata:** la funzione `emitDust` attuale crea sfere semplici. Aggiorna: usa `THREE.PlaneGeometry(0.35, 0.35)` con `MeshBasicMaterial` bicolore (beige + marrone chiaro), `depthWrite: false`, `blending: AdditiveBlending`. Ogni particella scala da 0→1.4 e si dissipa (opacity 0.5→0) in 0.9s. Emetti 3–5 particelle a impulso invece di una.
- **Coriandoli alla vittoria:** quando il giocatore taglia il traguardo, emetti 60 particelle (`BoxGeometry(0.08, 0.18, 0.02)`) con colori delle tre contrade in gara, fisica gravity semplice (y -= 2.5 × dt²), lifespan 3s, rotazione casuale. Rimuovile dopo.
- **Scia velocità (speed lines):** le `speedLines` esistenti usano già un boostGeometry/boost material. Migliorale: aggiungi `ShaderMaterial` con una semplice uniform `uOpacity` e fai pulsare l'opacità (`0.28 + sin(time*12)*0.12`) quando `speedLevel > 7`.
- **Motion blur leggero via vignette:** quando la velocità > 8, intensifica la vignettatura laterale (`box-shadow` inset) con un gradiente che sfuma i bordi sinistra/destra, non solo top/bottom.

### 1d. Scena e architettura

- **Torre del Mangia:** l'attuale `buildPalazzo` crea una tower semplice `2.4×13`. Espandila: aggiungi una cella campanaria in cima (`BoxGeometry(2.8, 1.8, 2.8)` + `MeshStandardMaterial` scuro), quattro bifore (`BoxGeometry(0.28, 0.65, 0.06)`) per lato ai livelli 4, 7, 10 della torre, e un cappello in laterizio (`ConeGeometry(1.6, 2.2, 4)` ruotato di 45°). La torre deve essere alta almeno 18 unità.
- **Palazzo Pubblico ampliato:** aggiungi al `buildPalazzo` una facciata con archi ogivali simulati: tre `BoxGeometry(0.95, 2.1, 0.08)` con la parte superiore tagliata con un `CapsuleGeometry(0.5, 0.5)` sovrapposto, materiale mattone scuro.
- **Stendardi delle contrade sulle tribune:** gli attuali 54 flag sui pali hanno un solo colore. Migliorali: per ogni flag crea un `PlaneGeometry(1.4, 0.85, 8, 4)` con una `CanvasTexture` 128×64 che disegna i colori della contrada in sezioni verticali (usa `colors[0]` e `colors[1]`), più il nome in font serif piccolo. Aggiorna la logica shader animazione ondeggiamento: modifica i vertici del flag via `BufferAttribute` ogni frame (es. `sin(time + vertex.x * 3) * 0.08` per l'asse Y).

---

## Area 2 — GIOCABILITÀ

### 2a. Sistema collisioni cavallo-cavallo

Attualmente le collisioni esistono solo alla Mossa (`resolveMossaCrowd`). In gara mancano completamente.

Implementa `resolveRaceCollisions(dt)` chiamata in `updateRace`:

```js
// Per ogni coppia (A, B):
// 1. Calcola distanza lungo pista (progressDiff) e laterale (laneDiff)
// 2. Se progressDiff < HORSE_BLOCK_LENGTH e laneDiff < HORSE_BLOCK_WIDTH:
//    - Il cavallo più lento/dietro riceve una spinta laterale (lane += side * 0.8 * dt)
//    - Entrambi perdono velocità (speedLevel *= 0.94)
//    - state.cameraShake += 0.12
//    - horse.collisionFlash = 0.9 (già usato per animazione stumble)
//    - emitDust(horse) su entrambi
// 3. Il giocatore, se colpisce, riceve il messaggio "Contatto! Rischio caduta" (danger)
```

### 2b. Interfaccia controlli e tutorial

La schermata menu mostra solo "Gioca" senza spiegare i tasti. Aggiungi:

- **Sezione controlli nel menu:** sotto il bottone "Gioca", aggiungi un `<div class="controls-hint">` con una mini-tabella tastiera:
  ```
  W / ↑    Aumenta velocità       S / ↓   Diminuisci velocità
  A         Sterza sinistra        L        Sterza destra
  ```
  Stile: font mono, bordo dorato leggero, opacità 0.75.
- **Overlay primo avvio:** alla prima gara (usa `localStorage.getItem('palioTutorialSeen')`), mostra per 4s un overlay semitrasparente al centro con i tasti principali evidenziati, poi dissolvilo.

### 2c. Sistema di difficoltà

Aggiungi un selettore difficoltà nella schermata selezione contrada:

```html
<div class="difficulty-selector">
  <button data-difficulty="easy">Principiante</button>
  <button data-difficulty="normal" class="selected">Normale</button>
  <button data-difficulty="hard">Esperto</button>
</div>
```

Effetti per difficoltà (aggiungili come moltiplicatori sui parametri AI esistenti):
- **Principiante:** `horse.skill *= 0.72`, `horse.aggression *= 0.6`, stamina AI drain `+30%`
- **Normale:** valori attuali
- **Esperto:** `horse.skill *= 1.18`, `horse.aggression *= 1.35`, AI surge più frequente (`surgeCooldown *= 0.72`)

### 2d. Nerbo interattivo

Il "nerbo" (frustino del fantino) è già animato visivamente e sonoro (`playNerbo`). Aggiungi un vero meccanismo gameplay:

- Quando si preme `W` per salire di velocità, oltre all'aumento di `speedSetting`, aggiungi un **burst momentaneo**: `player.speedLevel += 1.5` con decay rapido (in 0.6s torna al target normale). Effetto visivo: `cameraFov` scende da 64 a 58 in 0.2s poi risale.
- **Rischio nerbo:** se si usa il nerbo con `risk > 0.65`, c'è un 15% di probabilità (per frame, limitata a 1/s) che il cavallo perda aderenza: `player.sliding = true` per 0.8s, `player.speedLevel *= 0.88`, messaggio "Perdita di controllo!" (danger).

### 2e. Camera multi-angolo

Aggiungi un sistema di cambio camera con tasto `C` (o triplo tap su mobile):

```js
const CAMERA_MODES = ['follow', 'overhead', 'cinematic', 'firstperson'];
// follow: camera attuale dietro il cavallo
// overhead: y=55, guarda giù sulla piazza, ruota lentamente intorno al centro
// cinematic: alterna ogni 8s tra angolazioni fisse sui tratti più spettacolari
// firstperson: posizione in testa al fantino (già preparata con firstPersonHidden)
```

Per la prima persona: le mesh in `group.userData.firstPersonHidden` (il rider) già esistono. Nascondile quando mode è `firstperson`. La camera va a `(0, 2.55, 0.4)` nello spazio locale del gruppo cavallo.

### 2f. Annunci e drammaticità

- **Commento testuale dinamico:** crea un pool di frasi situazionali in italiano mostrate via `showMessage`:
  - Sorpasso: "Supera [NomeCavallo]!" (good)
  - Ultimo giro: "ULTIMO GIRO — dai tutto!" (good, con `font-size: 38px`)
  - A 200m dal traguardo: "Il traguardo è vicino!" (good)
  - Testa a testa (distanza < 3 dalla seconda): "Testa a testa!" (good)
  - Caduta rischio: "Attenzione alla curva!" (danger)
- **Animazione traguardo:** quando il giocatore finisce, anima la camera: `cameraFov` passa da 64 → 80 in 1.5s (sensazione di rallentamento), poi mostra i risultati dopo 3s invece di immediati.

### 2g. HUD migliorato

- **Mini-mappa:** aggiungi un canvas 2D fisso in basso a destra (`80×80px`, bordo dorato) che disegna il tracciato dall'alto come linea. Rappresenta ogni cavallo come un punto colorato con la propria `colors[0]`, il giocatore come punto bianco più grande. Aggiorna ogni frame.
- **Icona contrada giocatore:** nel pannello `hud-top-left`, sostituisci il testo "Posizione" con la name della contrada del giocatore in colore `colors[0]`, e mostra la posizione come numero grande centrato.
- **Stamina visiva critica:** quando stamina < 20%, fai pulsare l'intera barra con `animation: pulse 0.3s infinite` (già definita in CSS) e aggiungi un'icona ⚡ rossa lampeggiante accanto.

---

## Vincoli tecnici da rispettare

1. **Nessuna dipendenza nuova** oltre a Three.js già caricato via CDN.
2. **Compatibilità mobile:** tutti i nuovi elementi visivi devono verificare `renderer.capabilities.maxTextureSize` e scalare di conseguenza; le nuove texture non devono superare 256×256 su mobile (`window.innerWidth < 768`).
3. **Performance:** non superare 200 draw call totali; usa `instancedMesh` per coriandoli e particelle.
4. **Struttura file invariata:** tutto in `game-3d.js` e `style.css`, no nuovi file JS.
5. **Lingua UI:** tutto in italiano.
6. **Non toccare** la logica di pista (`SemicircleCampoCurve`, `precomputeTrack`, `sampleAt`) che è delicata e già calibrata.
7. **Non modificare** i valori delle costanti fisiche in cima al file (da `FINISH_LAPS` a `TAU`) senza commentare esplicitamente perché.

---

## Priorità suggerita

Implementa in questo ordine (dal più impattante al più fine):

1. Collisioni in gara (2a) — cambia il gameplay radicalmente
2. Cielo e atmosfera (1a) — prima impressione visiva
3. Polvere potenziata (1c) — feedback visivo immediato
4. Multi-camera con prima persona (2e) — aumenta immersione
5. HUD mini-mappa (2g) — leggibilità tattica
6. Torre del Mangia e Palazzo migliorati (1d) — identità storica
7. Sistema collisioni nerbo (2d) — rischio/ricompensa
8. Difficoltà (2c) e annunci dinamici (2f) — rigiocabilità
9. Coriandoli vittoria (1c) — momento emozionale
10. Tutorial primo avvio (2b) — onboarding
