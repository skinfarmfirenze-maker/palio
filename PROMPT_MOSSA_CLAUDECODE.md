# Prompt per Claude Code — Rifacimento completo della Mossa

## Contesto

Stai lavorando su `game-3d.js` (≈2750 righe), un gioco Three.js del Palio di Siena.
Leggi l'intero file prima di iniziare. Non toccare:
- Le costanti fisiche dalla riga 1 fino a `TAU` (inclusa)
- La classe `SemicircleCampoCurve` e le funzioni `precomputeTrack`, `sampleAt`, `campoOutward`
- Tutto ciò che riguarda la fase di gara (`updateRace`, `updateAiHorse`, `updatePlayer`) a meno che non sia esplicitamente indicato sotto

---

## Come procedere (IMPORTANTE)

Esegui **un solo step alla volta**, nell'ordine. Non passare allo step successivo
finché quello in corso non è verificato. Dopo OGNI step:

1. Lancia `node --check game-3d.js` → deve dare **zero errori di sintassi**.
2. Apri il gioco e guarda la **console del browser**: nessun errore e nessun warning
   nuovo rispetto a prima dello step.
3. Verifica a video l'effetto descritto nel riquadro **✅ Verifica** in fondo allo step.
4. Solo se è tutto pulito, prosegui. Se qualcosa si rompe, **correggi prima** di andare avanti.

Gli step 1–10 e 12–13 toccano solo `game-3d.js`; lo **step 11** tocca anche
`index.html` e `style.css`. Se usi hook di debug temporanei (`window.__debug`),
**rimuovili** prima di considerare concluso lo step.

---

## STEP 1 — Nuove costanti (aggiungi subito dopo le costanti esistenti)

```js
const MOSSA_BACK_LIMIT = -9.5;          // bordo posteriore tra i due canapi
const MOSSA_MAX_DURATION = 30.0;        // timeout di sicurezza (secondi)
const RINCORSA_LANE = -(TRACK_HALF_WIDTH - 1.4); // corsia fissa rincorsa (esterno)
const LAUNCH_MAX_DELAY = 0.35;          // ritardo massimo di reazione al via (s)
```

> ✅ **Verifica:** `node --check game-3d.js` senza errori. Controlla che i 4 nomi non collidano con costanti già esistenti.

---

## STEP 2 — Nuovi parametri per cavallo in `createHorse()`

Dentro l'oggetto `horse = { ... }`, aggiungi questi campi dopo `nerves`:

```js
nervousness: 0.25 + Math.random() * 0.65,     // oscillazione spontanea (0–1)
nervousnessCurrent: 0,                          // valore dinamico con contagio
reactivity: 0.35 + Math.random() * 0.65,       // velocità di risposta al via (0–1)
stability: 0.3 + Math.random() * 0.7,          // tendenza a restare dritto (0–1)
launchDelay: 0,                                 // calcolato al via
launchHeadingDev: 0,                            // deviazione al momento del via
startQuality: 'clean',                          // 'clean'|'dirty'|'closed'|'wide'|'slow'
mossaSubState: 'positioning',                   // sub-stato interno mossa
```

Dopo aver creato `horse`, aggiungi:
```js
horse.nervousnessCurrent = horse.nervousness;
```

> ✅ **Verifica:** `node --check`. Avvia una mossa e in console esegui `console.log(state.horses[0])`: ogni cavallo deve avere i 7 nuovi campi.

---

## STEP 3 — Costruzione visiva del verrocchino (nuova funzione)

Aggiungi la funzione `buildVerrocchino()` subito dopo `buildStartLine()`.
Chiamala alla fine di `buildScene()`.

```js
function buildVerrocchino() {
  const s = sampleAt(0); // stessa sezione del canapo anteriore
  const backS = sampleAt(MOSSA_BACK_LIMIT); // posizione posteriore

  const group = new THREE.Group();
  group.name = 'canapoPosteriore';

  // Corda posteriore orizzontale (stessa larghezza del canapo anteriore)
  const a = backS.point.clone().addScaledVector(backS.normal, -TRACK_HALF_WIDTH)
                                .addScaledVector(backS.tangent, -0.5);
  const b = backS.point.clone().addScaledVector(backS.normal,  TRACK_HALF_WIDTH)
                                .addScaledVector(backS.tangent, -0.5);
  group.add(makeCylinderBetween(a.clone().setY(0.52), b.clone().setY(0.52),
            0.048, materials.rope));

  // Verrocchino: paletto di legno sul lato esterno (RINCORSA_LANE)
  const verrocchioPos = backS.point.clone()
    .addScaledVector(backS.normal, RINCORSA_LANE - 0.6)
    .addScaledVector(backS.tangent, -0.3);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 1.05, 8),
    materials.wood
  );
  post.position.set(verrocchioPos.x, 0.52, verrocchioPos.z);
  post.castShadow = true;
  group.add(post);

  // Corda laterale dal verrocchino al palo del canapo anteriore (lato esterno)
  const canapoAnteriorePosExt = s.point.clone()
    .addScaledVector(s.normal, -TRACK_HALF_WIDTH)
    .addScaledVector(s.tangent, -0.8);
  group.add(makeCylinderBetween(
    new THREE.Vector3(verrocchioPos.x, 0.50, verrocchioPos.z),
    canapoAnteriorePosExt.clone().setY(0.50),
    0.022, materials.rope
  ));

  group.visible = false; // nascosto finché non inizia la mossa
  scene.add(group);
  state.canapiPosteriore = group;
}
```

In `state` (oggetto iniziale), aggiungi:
```js
canapiPosteriore: null,
canapiDropTimer: 0,        // timer per sparizione canapo posteriore dopo il via
```

> ✅ **Verifica:** `node --check`. All'avvio della mossa il verrocchino (paletto + corda posteriore + corda laterale) compare dietro i cavalli, sul lato esterno. Console pulita.

---

## STEP 4 — Modifica `startMossa()`

Alla fine di `startMossa()`, dopo le righe che gestiscono `state.canapi`:

```js
// Rendi visibile il canapo posteriore
if (state.canapiPosteriore) {
  state.canapiPosteriore.visible = true;
  state.canapiPosteriore.traverse(child => {
    if (child.material) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 1.0;
    }
  });
}
state.canapiDropTimer = 0;
state.mossaSubState = 'positioning';
state.mossaSubTimer = 0;

// Inizializza la rincorsa sulla corsia esterna corretta
state.horses.forEach(horse => {
  if (horse.isRincorsa) {
    horse.lane = RINCORSA_LANE;
    horse.mossaLane = RINCORSA_LANE;
    horse.mossaProgress = MOSSA_BACK_LIMIT - 2.0; // parte già dietro al verrocchino
    horse.progress = horse.mossaProgress;
    horse.speedLevel = 0;
    horse.targetSpeedLevel = 0;
  }
});
```

Alla fine di `startMossa()`, **rimuovi o commenta** il messaggio sulla posta:
sostituiscilo con:
```js
const postLabel = playerRincorsa
  ? 'di rincorsa — scegli il momento di entrare'
  : `${playerPost + 1}ª posta al canapo`;
showMessage(`Estrazione: parti ${postLabel}`, 2.2);
```

> ✅ **Verifica:** `node --check`. La rincorsa parte sulla corsia esterna dietro al verrocchino; il messaggio della posta estratta è corretto. Console pulita.

---

## STEP 5 — Modifica `updateMossa()`

Sostituisci **l'intera funzione** `updateMossa(dt, time)` con questa:

```js
function updateMossa(dt, time) {
  state.mossaTimer += dt;
  state.mossaSubTimer = (state.mossaSubTimer || 0) + dt;

  // Aggiorna sub-stato
  if (state.mossaSubState === 'positioning' && state.mossaSubTimer > 2.5) {
    state.mossaSubState = 'tension';
  }

  const controls = getControls();

  // ── Contagio del nervosismo ──────────────────────────────────────────────
  state.horses.forEach(horse => {
    if (horse.isRincorsa) return;
    let neighborNervousness = 0;
    let count = 0;
    state.horses.forEach(other => {
      if (other === horse || other.isRincorsa) return;
      if (Math.abs(other.lane - horse.lane) < HORSE_BLOCK_WIDTH * 2.2 &&
          Math.abs(other.progress - horse.progress) < HORSE_BLOCK_LENGTH * 2) {
        neighborNervousness += other.nervousnessCurrent;
        count++;
      }
    });
    const avgNeighbor = count > 0 ? neighborNervousness / count : horse.nervousness;
    horse.nervousnessCurrent += (avgNeighbor * 0.15 + horse.nervousness * 0.85 - horse.nervousnessCurrent) * dt * 2.2;
    horse.nervousnessCurrent = clamp(horse.nervousnessCurrent, 0, 1);
  });

  // ── Aggiorna prevProgress per trigger rincorsa ───────────────────────────
  state.horses.forEach(horse => { horse.prevProgress = horse.progress; });

  // ── I 9 cavalli al canapo ────────────────────────────────────────────────
  state.horses.forEach((horse, index) => {
    if (horse.isRincorsa) return;

    const tensionMult = state.mossaSubState === 'tension' ? 1.0 : 0.45;

    if (horse.player) {
      // Micro-sterzo giocatore al canapo (effetto ridotto al 30%)
      const steer = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
      horse.mossaLane = clamp(
        horse.mossaLane + steer * dt * 5.5,
        -AI_LANE_LIMIT, AI_LANE_LIMIT
      );
    } else {
      // AI: cerca posizione interna con jitter
      horse.mossaJitterTimer -= dt;
      if (horse.mossaJitterTimer <= 0) {
        horse.mossaJitterTimer = 0.4 + Math.random() * 1.1;
        const innerPull = AI_LANE_LIMIT * (0.4 + horse.aggression * 0.45);
        const wander = (Math.random() - 0.5) * 2.8;
        horse.mossaLaneGoal = clamp(innerPull + wander, -AI_LANE_LIMIT, AI_LANE_LIMIT);
      }
      horse.mossaLane += (horse.mossaLaneGoal - horse.mossaLane) * clamp(dt * 1.4, 0, 1);
    }

    // Micro-movimenti: oscillazione heading da nervosismo
    const nervOsc = Math.sin(time * (1.8 + horse.nervousnessCurrent * 2.4) + horse.phase)
                    * horse.nervousnessCurrent * 0.038 * tensionMult;

    // Scarto occasionale per cavalli molto nervosi
    if (horse.nervousnessCurrent > 0.7 && Math.random() < dt * 0.6 * tensionMult) {
      horse.heading = (horse.heading || sampleAt(horse.progress).yaw)
                      + (Math.random() - 0.5) * 0.22;
    }

    // Impazienza: micro-avanzamenti verso il canapo
    const impatience = (0.5 + horse.aggression * 0.6) *
      (0.5 + Math.sin(time * (1.4 + index * 0.25) + horse.phase) * 0.5) * tensionMult;
    const bunching = Math.sin(time * 2.6 + horse.phase) * 0.18;

    const targetProgress = clamp(
      horse.mossaProgress + bunching + impatience * 0.6,
      MOSSA_BACK_LIMIT,        // ← limite posteriore (nuovo)
      MOSSA_FRONT_LIMIT
    );
    const targetLane = horse.mossaLane + Math.sin(time * 2.1 + index * 1.6) * 0.18;
    const previousLane = horse.lane;

    horse.progress += (targetProgress - horse.progress) * clamp(dt * 2.2, 0, 1);
    horse.progress = Math.max(MOSSA_BACK_LIMIT, horse.progress); // hard back limit
    horse.lane += (targetLane - horse.lane) * clamp(dt * 3.2, 0, 1);
    horse.laneVelocity = (horse.lane - previousLane) / Math.max(dt, 0.001);
    horse.speedLevel = 0.6 + Math.abs(horse.laneVelocity) * 0.1 + impatience * 0.3;
  });

  // ── Rincorsa ─────────────────────────────────────────────────────────────
  const rincorsa = state.horses.find(h => h.isRincorsa);
  if (rincorsa) {
    if (rincorsa.player) {
      // GIOCATORE DI RINCORSA
      // W = avanza, S = arretra (solo a velocità minima)
      const speedInput = (state.keys.has('KeyW') ? 1 : 0) - (state.keys.has('KeyS') ? 1 : 0);
      const touchSpeedUp = state.touch.speedUp || false;
      const touchSpeedDown = state.touch.speedDown || false;
      const effectiveInput = speedInput + (touchSpeedUp ? 1 : 0) - (touchSpeedDown ? 1 : 0);

      // Velocità di avvicinamento/allontanamento
      rincorsa.rincorsaSpeed = clamp(
        (rincorsa.rincorsaSpeed || 0) + effectiveInput * dt * 4.5,
        -2.0,   // può andare indietro lentamente
        8.0     // velocità massima di approccio
      );
      // Frizione naturale
      rincorsa.rincorsaSpeed *= (1 - dt * 1.8);

      rincorsa.progress += rincorsa.rincorsaSpeed * dt;
      rincorsa.lane = RINCORSA_LANE; // corsia fissa
      rincorsa.speedLevel = Math.max(0, rincorsa.rincorsaSpeed);

    } else {
      // AI RINCORSA: valuta e sceglie il momento
      rincorsa.rincorsaSpeed = rincorsa.rincorsaSpeed || 0;
      rincorsa.rincorsaThinkTimer = (rincorsa.rincorsaThinkTimer || 0) + dt;

      // Ogni 0.8s rivaluta la situazione
      if (rincorsa.rincorsaThinkTimer > 0.8) {
        rincorsa.rincorsaThinkTimer = 0;
        const score = evaluateRincorsaEntry(rincorsa, state.horses);
        rincorsa.wantsToEnter = score > 0.62 || state.mossaTimer > MOSSA_MAX_DURATION * 0.75;
      }

      if (rincorsa.wantsToEnter) {
        // Accelera verso il verrocchino
        rincorsa.rincorsaSpeed = clamp(rincorsa.rincorsaSpeed + dt * 6.0, 0, 7.5);
      } else {
        // Si posiziona indietro per prendere rincorsa
        const idealRunup = MOSSA_BACK_LIMIT - 3.5 - rincorsa.aggression * 2.0;
        if (rincorsa.progress > idealRunup + 0.5) {
          rincorsa.rincorsaSpeed = clamp(rincorsa.rincorsaSpeed - dt * 3.0, -1.8, 0);
        } else {
          rincorsa.rincorsaSpeed *= (1 - dt * 2.0);
        }
      }

      rincorsa.progress += rincorsa.rincorsaSpeed * dt;
      rincorsa.lane = RINCORSA_LANE;
      rincorsa.speedLevel = Math.max(0, rincorsa.rincorsaSpeed);
    }
    rincorsa.laneVelocity = 0;
  }

  // ── Risoluzione calca al canapo (solo i 9, non la rincorsa) ──────────────
  resolveMossaCrowd(dt);

  // ── Piazza tutti i cavalli ───────────────────────────────────────────────
  state.horses.forEach(horse => placeHorse(horse, time));

  // ── Trigger partenza: rincorsa supera il verrocchino ─────────────────────
  if (rincorsa &&
      rincorsa.prevProgress <= MOSSA_BACK_LIMIT &&
      rincorsa.progress > MOSSA_BACK_LIMIT) {
    releaseRace();
    return;
  }

  // Safety timeout
  if (state.mossaTimer >= MOSSA_MAX_DURATION) {
    // Forza ingresso rincorsa anche se le condizioni non sono ideali
    if (rincorsa) {
      rincorsa.progress = MOSSA_BACK_LIMIT + 0.1;
    }
    releaseRace();
    return;
  }

  // Messaggio tensione
  if (state.mossaSubState === 'tension' && state.mossaSubTimer < 0.5) {
    showMessage('Pronti al canapo…', 1.0);
  }
}
```

> ✅ **Verifica:** `node --check`. I 9 cavalli oscillano al canapo senza mai superare `MOSSA_BACK_LIMIT`; la rincorsa si muove avanti/indietro; quando supera il verrocchino parte la gara (trigger spaziale, non a timer). Console pulita.

---

## STEP 6 — Nuova funzione `evaluateRincorsaEntry()`

Aggiungi questa funzione prima di `updateMossa`:

```js
function evaluateRincorsaEntry(rincorsa, horses) {
  const lineup = horses.filter(h => !h.isRincorsa && !h.finishTime);
  if (lineup.length === 0) return 1.0;

  // 1. Varco esterno: l'ultimo cavallo (più esterno) deve lasciare spazio
  const outermost = lineup.reduce((prev, curr) =>
    curr.lane < prev.lane ? curr : prev
  );
  const gapToBarrier = Math.abs(outermost.lane - RINCORSA_LANE);
  const corridorScore = clamp((gapToBarrier - HORSE_BLOCK_WIDTH) / HORSE_BLOCK_WIDTH, 0, 1);

  // 2. Campo ordinato: deviazione media degli heading
  const sample = sampleAt(0);
  const avgDev = lineup.reduce((sum, h) => {
    const dev = Math.abs(angleDiff(h.heading || sample.yaw, sample.yaw));
    return sum + dev;
  }, 0) / lineup.length;
  const orderScore = clamp(1 - avgDev / 0.5, 0, 1);

  // 3. Slancio: la rincorsa deve avere velocità sufficiente
  const slanciScore = clamp((rincorsa.rincorsaSpeed - 3.0) / 4.0, 0, 1);

  // Punteggio combinato
  return corridorScore * 0.45 + orderScore * 0.30 + slanciScore * 0.25;
}
```

> ✅ **Verifica:** `node --check`. Logga temporaneamente il punteggio per la rincorsa AI: deve restare tra 0 e 1 e salire quando il varco esterno si apre.

---

## STEP 7 — Modifica `releaseRace()`

Sostituisci l'intera funzione `releaseRace()` con questa:

```js
function releaseRace() {
  state.mode = 'race';
  state.raceClock = 0;
  state.canapiDropTimer = 5.0; // il canapo posteriore sparisce dopo 5s

  // Calcola qualità di partenza per ogni cavallo
  state.horses.forEach(horse => {
    computeStartQuality(horse);
  });

  state.horses.forEach(horse => {
    if (horse.player) {
      const effectiveSpeed = getPlayerEffectiveSpeed(horse);
      horse.effectiveSpeedLevel = effectiveSpeed;
      horse.speedLevel = horse.startQuality === 'slow' ? effectiveSpeed * 0.4 : effectiveSpeed;
      horse.targetSpeedLevel = effectiveSpeed;
      horse.heading = sampleAt(horse.progress).yaw + horse.launchHeadingDev;
    } else {
      // L'AI parte alla velocità impostata, non di più
      const startSpeed = horse.isRincorsa
        ? clamp(horse.rincorsaSpeed || 4, 3, horse.targetSpeedLevel || 6)
        : clamp(
            (horse.targetSpeedLevel || BASE_SPEED_LEVEL) *
            (horse.startQuality === 'slow' ? 0.35 : horse.startQuality === 'dirty' ? 0.72 : 0.92),
            1, horse.targetSpeedLevel || BASE_SPEED_LEVEL
          );
      horse.speedLevel = startSpeed;
      horse.targetSpeedLevel = Math.max(horse.targetSpeedLevel || BASE_SPEED_LEVEL, startSpeed);
      horse.effectiveSpeedLevel = startSpeed;
      horse.surgeTimer = 0.5 + Math.random() * 0.6;
      horse.surgeCooldown = 2.2 + Math.random() * 2.5;
      horse.boosting = true;
    }

    // Ritardo di reazione individuale
    horse.launchDelay = (1 - horse.reactivity) * LAUNCH_MAX_DELAY;
    horse.launchDelayTimer = horse.launchDelay;
  });

  state.cameraShake = 0.2;
  showMessage('Via!', 0.75);

  // Canapo anteriore: animazione caduta (già esistente in forma base)
  if (state.canapi) {
    state.canapiDrop = 0.001;
  }
}
```

> ✅ **Verifica:** `node --check`. Al via **nessun AI** supera il proprio `targetSpeedLevel`; il giocatore parte alla sua andatura. Console pulita.

---

## STEP 8 — Nuova funzione `computeStartQuality()`

Aggiungi prima di `releaseRace`:

```js
function computeStartQuality(horse) {
  const sample = sampleAt(horse.progress);
  const tangentYaw = sample.yaw;

  // Heading deviation al momento del via
  const heading = horse.heading !== undefined ? horse.heading : tangentYaw;
  const dev = Math.abs(angleDiff(heading, tangentYaw));
  horse.launchHeadingDev = (Math.random() - 0.5) * (1 - horse.stability) * 0.18;

  // Cavallo direttamente davanti?
  const blocked = state.horses.some(other =>
    other !== horse &&
    other.progress > horse.progress &&
    other.progress - horse.progress < HORSE_BLOCK_LENGTH * 1.1 &&
    Math.abs(other.lane - horse.lane) < HORSE_BLOCK_WIDTH * 0.9
  );

  // Qualità posizione laterale (interno = positivo)
  const outwardSign = Math.sign(sample.normal.dot(campoOutward(sample.point)) || 1);
  const laneQuality = outwardSign * horse.lane / AI_LANE_LIMIT; // >0 = interno

  if (blocked) {
    horse.startQuality = 'closed';
    horse.launchHeadingDev += (Math.random() - 0.5) * 0.28;
  } else if (dev > 0.4 || (1 - horse.stability) > 0.7) {
    horse.startQuality = 'dirty';
    horse.launchHeadingDev += (Math.random() > 0.5 ? 1 : -1) * dev * 0.55;
  } else if (laneQuality < -0.55) {
    horse.startQuality = 'wide';
  } else if (horse.speedLevel < 0.5 && !horse.isRincorsa) {
    horse.startQuality = 'slow';
  } else {
    horse.startQuality = 'clean';
  }
}
```

> ✅ **Verifica:** `node --check`. Al via logga `horse.startQuality` per tutti: i valori devono stare in {clean, dirty, closed, wide, slow}.

---

## STEP 9 — Ritardo di lancio in `updateRace()` (o dove viene chiamato)

Trova il punto in cui viene chiamato `updateAiHorse` e `updatePlayer` durante la gara.
Aggiungi all'inizio del loop principale di aggiornamento gara, **prima** di chiamare quelle funzioni:

```js
// Ritardo di lancio individuale (primi istanti dopo il via)
state.horses.forEach(horse => {
  if (horse.launchDelayTimer > 0) {
    horse.launchDelayTimer -= dt;
    // Durante il ritardo: il cavallo si muove ma decelera leggermente
    horse.speedLevel = Math.max(0, horse.speedLevel - dt * 3.5);
    placeHorse(horse, time);
    // Non applicare ancora la fisica normale
    return; // salta updateAiHorse / updatePlayer per questo cavallo questo frame
  }
});
```

Nota: se la struttura non permette `return` facilmente, usa un flag `horse.launching = horse.launchDelayTimer > 0` e controlla all'inizio di `updateAiHorse` e `updatePlayer`:
```js
function updateAiHorse(horse, dt, time) {
  if (horse.player || horse.launching) return;
  // ... resto invariato
}
```

> ✅ **Verifica:** `node --check`. Nei primi istanti dopo il via i cavalli con bassa `reactivity` partono leggermente in ritardo, senza scatti bruschi. Console pulita.

---

## STEP 10 — Sparizione canapo posteriore dopo il via

In `updateRace()` (o nella funzione che gestisce il loop principale durante la gara),
aggiungi:

```js
// Sparizione canapo posteriore 5s dopo il via
if (state.canapiDropTimer > 0 && state.canapiPosteriore) {
  state.canapiDropTimer -= dt;
  if (state.canapiDropTimer <= 0.8) {
    // Fade out in 0.8s
    const fadeRatio = clamp(state.canapiDropTimer / 0.8, 0, 1);
    state.canapiPosteriore.traverse(child => {
      if (child.material && child.material.transparent) {
        child.material.opacity = fadeRatio;
      }
    });
  }
  if (state.canapiDropTimer <= 0) {
    state.canapiPosteriore.visible = false;
    state.canapiDropTimer = 0;
  }
}
```

> ✅ **Verifica:** `node --check`. La corda posteriore svanisce in dissolvenza ~5 s dopo il via e poi sparisce del tutto. Console pulita.

---

## STEP 11 — HUD per il giocatore di rincorsa

In `index.html`, dentro `<div id="hud" class="hud">`, aggiungi:

```html
<div id="rincorsaHud" class="rincorsa-hud">
  <div class="hud-label">Varco</div>
  <div class="bar bar-gap"><div class="bar-fill" id="gapFill"></div></div>
  <div class="hud-label hud-sub">Slancio</div>
  <div class="bar bar-slancio"><div class="bar-fill" id="slancioFill"></div></div>
</div>
```

In `style.css`:

```css
.rincorsa-hud {
  position: absolute;
  bottom: 18px;
  right: 18px;
  min-width: 160px;
  padding: 12px 16px;
  background: var(--panel);
  border: 1px solid rgba(216, 169, 58, 0.4);
  border-radius: 10px;
  backdrop-filter: blur(4px);
  display: none;
}
.rincorsa-hud.visible { display: block; }
.bar-gap .bar-fill { background: linear-gradient(90deg, #c93430, #f0c940, #4caf6e); }
.bar-slancio .bar-fill { background: linear-gradient(90deg, var(--gold), #fff4a0); }
```

In `game-3d.js`, aggiorna l'HUD rincorsa ogni frame in `updateMossa()`, subito prima
del trigger di partenza:

```js
const playerRincorsa = state.horses.find(h => h.isRincorsa && h.player);
const rincorsaHudEl = document.getElementById('rincorsaHud');
if (playerRincorsa && rincorsaHudEl) {
  rincorsaHudEl.classList.toggle('visible', state.mode === 'mossa');
  // Varco esterno
  const outermost = state.horses
    .filter(h => !h.isRincorsa)
    .reduce((p, c) => c.lane < p.lane ? c : p);
  const gap = clamp((Math.abs(outermost.lane - RINCORSA_LANE) - HORSE_BLOCK_WIDTH)
                    / HORSE_BLOCK_WIDTH, 0, 1);
  const gapFill = document.getElementById('gapFill');
  if (gapFill) gapFill.style.transform = `scaleX(${gap})`;
  // Slancio
  const slancio = clamp((playerRincorsa.rincorsaSpeed || 0) / 7.5, 0, 1);
  const slancioFill = document.getElementById('slancioFill');
  if (slancioFill) slancioFill.style.transform = `scaleX(${slancio})`;
} else if (rincorsaHudEl) {
  rincorsaHudEl.classList.remove('visible');
}
```

> ✅ **Verifica:** `node --check` su `game-3d.js` (e ricontrolla `index.html`/`style.css`). Giocando di rincorsa, in basso a destra appaiono le barre **Varco** e **Slancio** che si riempiono in tempo reale; non compaiono se non sei di rincorsa.

---

## STEP 12 — Aggiornare `resolveMossaCrowd()`

La funzione esistente già funziona. Aggiungi solo questo all'inizio, per escludere la rincorsa:

```js
function resolveMossaCrowd(dt) {
  const horses = state.horses.filter(h => !h.isRincorsa); // ← aggiunta
  // ... resto della funzione invariato (usa la variabile locale `horses`)
}
```

> ✅ **Verifica:** `node --check`. La rincorsa **non** viene più spinta o trascinata dalla calca dei 9 cavalli al canapo. Console pulita.

---

## STEP 13 — Messaggi dinamici durante la mossa

In `updateMossa()`, aggiungi un sistema di messaggi situazionali.
Inserisci questo blocco dopo il contagio del nervosismo:

```js
// Messaggi contestuali (uno alla volta, solo se nessun messaggio attivo)
if (state.messageTimer <= 0) {
  const rincorsa = state.horses.find(h => h.isRincorsa);
  const player = getPlayer();

  if (rincorsa && !rincorsa.player) {
    // Commenta la situazione della rincorsa AI
    if (rincorsa.wantsToEnter && rincorsa.progress < MOSSA_BACK_LIMIT - 1.5) {
      showMessage('La rincorsa prende la rincorsa…', 0.9);
    } else if (rincorsa.wantsToEnter && rincorsa.progress > MOSSA_BACK_LIMIT - 1.0) {
      showMessage('La rincorsa entra!', 0.5, 'danger');
    }
  }

  if (player && !player.isRincorsa) {
    // Feedback al giocatore al canapo
    const dev = player.heading !== undefined
      ? Math.abs(angleDiff(player.heading, sampleAt(player.progress).yaw))
      : 0;
    if (dev > 0.35 && Math.random() < dt * 1.5) {
      showMessage('Raddrizza il cavallo!', 0.55, 'danger');
    }
  }

  if (state.mossaSubState === 'tension' && state.mossaTimer > 8 && Math.random() < dt * 0.3) {
    const tensionPhrases = [
      'La folla trattiene il respiro…',
      'I cavalli sono al limite…',
      'Tutto dipende dalla rincorsa…',
    ];
    showMessage(tensionPhrases[Math.floor(Math.random() * tensionPhrases.length)], 1.1);
  }
}
```

> ✅ **Verifica:** `node --check`. Durante la mossa compaiono i messaggi situazionali, **uno alla volta**, senza sovrapporsi né lampeggiare. Console pulita.

---

## Riepilogo delle modifiche

| Cosa | Dove | Tipo |
|---|---|---|
| 4 nuove costanti | Cima file | Aggiunta |
| 7 nuovi parametri cavallo | `createHorse()` | Aggiunta |
| `buildVerrocchino()` | Nuova funzione | Aggiunta |
| `evaluateRincorsaEntry()` | Nuova funzione | Aggiunta |
| `computeStartQuality()` | Nuova funzione | Aggiunta |
| `updateMossa()` | Sostituzione completa | Modifica |
| `releaseRace()` | Sostituzione completa | Modifica |
| `resolveMossaCrowd()` | Una riga aggiunta | Modifica |
| Ritardo lancio | Loop gara | Aggiunta |
| Sparizione canapo posteriore | Loop gara | Aggiunta |
| HUD rincorsa | HTML + CSS + JS | Aggiunta |
| Messaggi mossa | `updateMossa()` | Aggiunta |

## Vincoli finali

- Nessuna dipendenza esterna aggiunta
- Non modificare `precomputeTrack`, `sampleAt`, `campoOutward`
- Non modificare le costanti fisiche dalla riga 1 a `TAU`
- `targetSpeedLevel` degli AI non viene mai superato al via
- Tutto il testo in italiano
- Verifica in console che non ci siano errori dopo ogni step prima di procedere al successivo
