# Chrome Dino: behavior spec

Written from the original (`originals/dino/index.js`, BSD-3, the vendored copy of the t-rex runner, run
unmodified) and from what it did when recorded. The port in `ports/web/dino.mjs` is built from this file.
Every claim about numbers was checked by replaying 29 recorded cases (63,000 frames) through the port.

Files: `driver.mjs` (runs the original), `record.mjs` (players + coverage), `cases/*.json` (recordings),
`ports/web/dino.mjs` (rules), `run.mjs` (verify runner), `index.html` (playable, own art).

## 1. How the original is run (the harness)

The page is opened in Playwright Chromium (`file://` URL, 800x400 viewport so the canvas is 600 px wide;
the driver throws if it is not). Nothing in the page is edited. Before any page script runs, `driver.mjs` replaces:

| Replaced | By | Why |
|---|---|---|
| `performance.now`, `Date.now` | a fake clock that starts at **1000** ms (`clock0`) and moves only in `step()` | the game takes `deltaTime = now - this.time` |
| `requestAnimationFrame`, `cancelAnimationFrame` | a queue with ids; a frame runs the callbacks that were pending when it began; a cancel also stops a callback of the running frame that has not run yet | the page only moves when `step()` is called |
| `Math.random` | two seeded streams, see below | gameplay randomness has to be on a tape |
| `AudioContext` | a stub whose `decodeAudioData` does nothing | `soundFx` stays empty, `playSound` does nothing, nothing throws |
| CSS animations | `animation: none !important` (added after load) | see "intro" |

**One frame** (`step({dt, jump, duck, jumpUp, duckUp, enter, animEnd})`), in this order:

1. the clock moves: `now = now + dt` (a floating-point add, the port does the same add)
2. key events, in this order: keydown Space (`jump`), keydown Down (`duck`), keyup Space (`jumpUp`), keyup Down (`duckUp`), keyup Enter (`enter`)
3. the `webkitAnimationEnd` event of the container (`animEnd`)
4. the pending rAF callbacks run (all see the same `performance.now()`), then the state is read

A `jump` event is a keydown, so a held key with the OS auto-repeat is a `jump` every few frames.
Keys are sent as `KeyboardEvent` with `keyCode` 32 / 40 / 13. Mouse, touch, focus and blur events are not sent.

### Two random tapes

`Math.random` looks at `new Error().stack`. A call whose stack contains the text `Obstacle` is
**gameplay** (drawn from `mulberry32(seed)` and pushed on `tape`); any other call is **visual**
(`mulberry32(visualSeed)`, not recorded). The split was checked on a 2,600-frame run, counting the callers
(`driver.callers()`):

| stream | caller (innermost two frames) | calls |
|---|---|---|
| gameplay | `getRandomNum < Horizon.addNewObstacle` (the type; again after a rejected type) | 45 |
| gameplay | `getRandomNum < Obstacle` (constructor: size 1..3) | 34 |
| gameplay | `getRandomNum < Obstacle.getGap` | 34 |
| gameplay | `getRandomNum < Obstacle.init` (pterodactyl height) | 5 |
| gameplay | `Obstacle.init < Obstacle` (pterodactyl `speedOffset` sign) | 5 |
| visual | `NightMode.placeStars` (every frame while it is day) | 20,768 |
| visual | `Cloud`, `Cloud.init` (cloud gap, height), `Horizon.updateClouds` (cloud frequency) | 9, 9, 19 |
| visual | `HorizonLine.getRandomType` (flat or bumpy ground) | 34 |
| visual | `Trex.setBlinkDelay` | 1 |

123 numbers on the tape = 45 + 34 + 34 + 5 + 5. The proof that the visual stream does not matter is in section 9.

### The intro (CSS animation)

`Runner.playIntro` sets `style.webkitAnimation = 'intro .4s ease-out 1 both'` and waits for
`webkitAnimationEnd` to call `startGame`. Real CSS time would make the recording depend on the machine, so the
animation is switched off and the driver dispatches the end event itself: **at the start of the first frame whose
clock is at least 400 fake ms after the end of the frame in which `playingIntro` became true**. The frame is recorded
as `animEnd: true` in `inputs`; the port only reads that flag. 400 ms is the duration written in the original. (A real
browser also needs a frame to start the animation; this is not modelled, it is a choice of the harness and the same for
every case.)

## 2. State that is compared

Every frame (and the initial state) the trace holds, read from `Runner.instance_`:
`playing, crashed, activated, playingIntro, paused, currentSpeed, distanceRan, score` (=`distanceMeter.getActualDistance(ceil(distanceRan))`),
`highestScore, runningTime, playCount, time` (`Runner.time`), `running` (`!!raqId`),
`tRex {xPos, yPos, jumping, ducking, speedDrop, jumpVelocity, jumpCount, status, reachedMinHeight}`,
`obstacleHistory`, and for every obstacle `{type, xPos, yPos, size, width, gap, speedOffset, followed}`.
`rafPending` is the length of the fake rAF queue (harness state, but a plain consequence of the original, see "update chains").
The comparison is exact (`===` on every number, `lib/compare.mjs`); nothing is rounded or given a tolerance.

## 3. Constants

`Runner.config`: SPEED 6, ACCELERATION 0.001, MAX_SPEED 13, CLEAR_TIME 3000, GAMEOVER_CLEAR_TIME 750,
GAP_COEFFICIENT 0.6, MAX_OBSTACLE_DUPLICATION 2, BOTTOM_PAD 10. FPS 60, `msPerFrame = 1000/60`.
Canvas 600 x 150. `Trex.config`: GRAVITY 0.6, HEIGHT 47, WIDTH 44, INIITAL_JUMP_VELOCITY -10, DROP_VELOCITY -5,
MIN_JUMP_HEIGHT 30, MAX_JUMP_HEIGHT 30, SPEED_DROP_COEFFICIENT 3, START_X_POS 50, INTRO_DURATION 1500.
Ground y of the dino: `150 - 47 - 10 = 93`. `minJumpHeight = 93 - 30 = 63`.
Animation ms per frame (only used by the jump physics through the status): WAITING 1000/3, RUNNING 1000/12,
CRASHED 1000/60, JUMPING 1000/60, DUCKING 1000/8.

## 4. Time and the update chains (the part that is easy to get wrong)

`Runner.update()` is what a rAF callback calls:
`deltaTime = now - (this.time || now); this.time = now;` and at the end, when playing or (waiting and fewer than 3 blinks),
`tRex.update(deltaTime)` and `scheduleNextUpdate()`.

`scheduleNextUpdate` only checks `updatePending`, and `update()` clears `updatePending` first. Before the first key the
page already runs a "waiting for input" chain. The first keydown calls `update()` **directly**, which starts a second
chain. From then on **two `update()` calls run per frame**: the first with the frame's `deltaTime`, the second with `0`
(same `now`). Consequences, all visible in the recording:

* `currentSpeed` rises by 0.001 **twice per frame** (0.002/frame, plus one more in the frame of the first key). It takes
  about 3,500 frames, not 7,000, to get from 6 to 13.
* `rafPending` is 2 while playing.
* `stop()` (game over) cancels only `raqId`, the last id handed out. The other chain's callback is still pending; it
  runs once in the next frame (setting `this.time = now`, which is what the 750 ms restart check measures from) and ends.
* `restart()` calls `update()` directly, which starts a new chain. If the old chain's callback is still pending (restart
  in the frame right after a crash) there are again two chains.

The port keeps a queue of ids with the same cancel rule instead of simplifying this away.

Time arithmetic is done exactly as the original: the port holds `now` (starts at `clock0`, adds `dt` each frame) and
`time`, and computes `now - (time || now)`. `dt` such as 16.667 does not add up exactly in floating point, and the
recorded `time`, `runningTime` and `distanceRan` carry those errors; the port reproduces them bit for bit because it
performs the same operations in the same order. (If the recording is replayed with another start clock, the numbers
change in the last digits; `clock0` is part of each case.)

## 5. Order of one `update()` (playing)

1. `if (tRex.jumping) tRex.updateJump(deltaTime)`
2. `runningTime += deltaTime; hasObstacles = runningTime > 3000`
3. `if (tRex.jumpCount == 1 && !playingIntro) playIntro()` (see 7)
4. horizon: if `playingIntro`: `update(0, speed, hasObstacles)`. Otherwise `deltaTime = activated ? deltaTime : 0` and `update(deltaTime, ...)`.
   `Horizon.update` moves obstacles and spawns new ones only when `hasObstacles`.
5. `collision = hasObstacles && checkForCollision(obstacles[0], tRex)`
6. no collision: `distanceRan += currentSpeed * deltaTime / msPerFrame` and, if `currentSpeed < 13`, `currentSpeed += 0.001`.
   Collision: `gameOver()` (neither happens in that frame).
7. at the end of the function, `tRex.update(deltaTime)` and the next rAF.

Note that in step 4 the intro frames pass `0` to the horizon but step 6 still uses the real `deltaTime`, so the distance
grows during the intro while the world stands still. Before the first landing `activated` is false, so `deltaTime`
becomes 0 for the horizon **and** for the distance: the first jump does not count.

## 6. The dino

* **Keys.** Jump key down: if not crashed and not playing, `playing = true` and a direct `update()` (see 4); then, if neither jumping nor ducking, `startJump`.
  Duck key down: only when playing and not crashed; while jumping it is a **speed drop** (`speedDrop = true`, `jumpVelocity = 1`), otherwise `setDuck(true)`.
  Jump key up: if `raqId` is set, `endJump()`; else if crashed, restart when enough time has passed (see 8). Duck key up: `speedDrop = false; setDuck(false)`.
  Enter key up: restarts when crashed, otherwise nothing.
* **startJump(speed):** `update(0, JUMPING)`, `jumpVelocity = -10 - speed/10`, `jumping = true`, `reachedMinHeight = false`, `speedDrop = false`.
* **updateJump(dt):** `framesElapsed = dt / animMsPerFrame[status]`. `yPos += round(jumpVelocity * framesElapsed)` (times 3 while speed-dropping),
  then `jumpVelocity += 0.6 * framesElapsed`. `reachedMinHeight` is set when `yPos < 63` or speed-dropping. When `yPos < 30` or speed-dropping,
  `endJump()`. If `yPos > 93`: `reset()` and `jumpCount++`. Then `update(dt)`.
* **endJump:** only if `reachedMinHeight` and `jumpVelocity < -5`: `jumpVelocity = -5`. This is the whole difference between a held
  key (high jump, 91 px) and a key released after the dino passed y=63 (shorter jump). A release before y=63 does nothing.
* **`Trex.update(dt, status)`:** sets `status`; while `playingIntro` and `xPos < 50`, `xPos += round(50/1500 * dt)`; a **crashed, ducking** dino gets `xPos++`
  (the original draws the standing sprite and shifts it); if `speedDrop` and `yPos == 93`: `speedDrop = false; setDuck(true)`.
* **setDuck(true)** when status is not DUCKING: `update(0, DUCKING)`, `ducking = true`. **setDuck(anything)** when status is DUCKING: back to RUNNING, `ducking = false`.
* **reset():** `yPos = 93`, velocity 0, not jumping, not ducking, `update(0, RUNNING)`, `speedDrop = false`, `jumpCount = 0`.
  Because `update` runs before `speedDrop` is cleared, **landing from a speed drop leaves the dino ducking**.
* The dino's `xPos` starts at 0 and is not reset by a restart.

## 7. Intro

The first jump does nothing to the world (`deltaTime` 0 for the horizon, see 5). When it lands, `jumpCount == 1` and
`playIntro()` sets `playingIntro`, `activated`, `playing`. For the next 400 fake ms the dino slides right by
`round(0.0333 * dt)` per `Trex.update` call (about 1 px per frame, so it ends near x=24, not 50) and `runningTime`
keeps counting. On the end event `startGame()` sets `runningTime = 0`, `playingIntro = false`, `playCount++`.
`runningTime` has to pass 3000 before any obstacle exists, so the first obstacle appears 3 s after the intro ended.

## 8. Game over and restart

`gameOver()`: `stop()` (`playing = false`, `paused = true`, cancel `raqId`, `raqId = 0`), `crashed = true`, `tRex.update(100, CRASHED)`,
`highestScore = ceil(distanceRan)` if `distanceRan` is higher, `time = now`.
`restart()` runs only if `raqId == 0`: `playCount++`, `runningTime = 0`, `playing = true`, `crashed = false`, `distanceRan = 0`,
`currentSpeed = 6`, `time = now`, obstacles emptied (**`obstacleHistory` is kept**), `tRex.reset()`, direct `update()`.
Restart is reached by Enter key up at any time after the crash, or by jump key up when `now - time >= 750`.
`time` is set again by the leftover chain one frame after the crash, so in practice the check is "750 ms since the frame after the crash".
Recordings press the jump key up every frame from 38 frames on (`restart: "mash"`) to hit this boundary.
After the first restart `paused` stays true (only `play()` clears it) and `activated` stays true, so there is no second intro.

## 9. Obstacles

Created by `Horizon.addNewObstacle` (called when there is none, or when the last one is visible, has no follower yet and
`xPos + width + gap < 600`). Draw order of random numbers: type, then in the `Obstacle` constructor size, then (pterodactyl)
height, then (pterodactyl) the `speedOffset` sign, then the gap.

* **Type** `floor(r * 3)`: 0 small cactus, 1 large cactus, 2 pterodactyl. Rejected (and drawn again, recursively) if
  `currentSpeed < minSpeed` (pterodactyl 8.5) or if `duplicateObstacleCheck` says the previous two obstacles were that type.
  `obstacleHistory` has the last 2 types, newest first.
* **Size** `floor(r * 3) + 1`, forced to 1 if `currentSpeed < multipleSpeed` (small 4, large 7, pterodactyl 999).
* **Size / box table:** small 17x35 at y 105, large 25x50 at y 90, pterodactyl 46x40 at y in {100, 75, 50} (`floor(r*3)`).
  `width = typeWidth * size`. New obstacles start at `x = 600 + typeWidth` (not times size).
* **Gap:** `minGap = round(width * speed + typeMinGap * 0.6)` (typeMinGap 120 cacti, 150 pterodactyl),
  `maxGap = round(minGap * 1.5)`, `gap = floor(r * (maxGap - minGap + 1)) + minGap`.
* **Pterodactyl `speedOffset`:** `r > 0.5 ? 0.8 : -0.8`, added to the speed when it moves.
* **Move:** `xPos -= floor((speed * 60 / 1000) * deltaTime)`. A pixel is lost to `floor` every frame: it is `floor(speed)` px per 16.667 ms frame.
  Removed when `xPos + width <= 0` (removal happens on the next list update by `shift()` of the copy).
* **Collision boxes:** type tables below; groups widen the middle box and move the last one to the end.
  small `(0,7,5,27) (4,0,6,34) (10,4,7,14)`, large `(0,12,7,38) (8,0,7,49) (13,10,10,38)`,
  pterodactyl `(15,15,16,5) (18,21,24,6) (2,14,4,3) (6,10,4,7) (10,8,6,9)`.

## 10. Collision

Only `obstacles[0]` is tested, and only when `hasObstacles`. Outer boxes: dino `(xPos+1, yPos+1, 42, 45)`, obstacle
`(xPos+1, yPos+1, typeWidth*size-2, typeHeight-2)`. If they overlap (strict axis-aligned test), every dino box against every
obstacle box, each shifted by its outer box; any overlap is a crash. Dino boxes standing: `(22,0,17,16) (1,18,30,9) (10,35,14,8) (1,24,29,5) (5,30,21,4) (9,34,15,4)`;
ducking: one `(1,18,55,25)`.
The outer box does not widen when ducking. Consequences seen in the recording: a mid-height pterodactyl (y 75) is passed
only by ducking, a low one (y 100) only by jumping, a high one (y 50) passes over a running dino and can be hit by a jump that is
too late (crashed into in the recording).

## 11. Not modelled, and why that is safe

| Left out | Why it cannot change the trace |
|---|---|
| Rendering, sprites, canvas | nothing reads pixels; `draw()` calls only write |
| Clouds, ground bumps, moon, stars | use only the visual stream; no gameplay field reads them |
| Night mode (`invert`, `invertTimer`) | toggles a CSS class and a flag read by `NightMode`; the distance, speed and obstacles never depend on it |
| Tail blink (`blinkCount`) | visual stream; **one assumption**: the waiting loop is alive at the first key, i.e. fewer than 3 blinks happened. `record.mjs` checks `blinkCount < 3` at the first key and throws otherwise. The port assumes it. (A player who waits ~20 s before the first key could behave differently; not covered.) |
| Sound, vibration | stub / not a browser feature here |
| High score persistence | the original does not persist it; `highestScore` (in-session) is in the trace |
| Distance meter animation (flash at every 100) | draws only |
| Window resize (width below 600 px slows the game: `setSpeed`), arcade-mode scale, mobile (`yPosMobile`), HiDPI | the harness fixes the width at 600, no touch UA; **the port is only valid for a 600 px game** |
| Tab hidden, blur, focus (`onVisibilityChange`, `play()`) | events are never sent; the `paused && jump keyup` branch exists in the port but has no recording |
| Mouse and touch events as input | only key events are sent; touch restart (`TOUCHSTART` on the container) is not modelled |
| Animation frames (leg, wing, blink) | only change the sprite; `Trex.timer`, `currentFrame`, pterodactyl `currentFrame` are not part of the state |

**Proof for the visual stream** (`node games/dino/record.mjs --visual`): every recorded input list is run again on the original
with two other visual seeds (1 and 987654321; the recording used `seed * 7919 + 13`). The gameplay seed is unchanged, so the tape
is the same. Result: all 29 cases (63,000 frames each time), run with both visual seeds, gave a trace and a tape identical to the recording (exact comparison). The same replay also shows the recording is repeatable: a fresh browser per run, same inputs, same numbers.

## 12. What the cases cover

Counted from the written cases (`coverage()` in `record.mjs`; obstacle counts are obstacles created, crash counts are frames where `crashed` turned true):

| Measure | Value |
|---|---|
| cases / frames | 29 cases, 63,000 frames (63,029 recorded states), 39 MB of JSON |
| obstacles created | small cactus x1 112, x2 137, x3 117; large cactus x1 228, x2 62, x3 69; pterodactyl 77 (height 100: 22, height 75: 18, height 50: 37) |
| crashes / restarts | 44 / 43 |
| crashed into | small cactus x1 9, x2 8, x3 6; large cactus x1 8, x2 2, x3 4; pterodactyl at 100: 2, at 75: 1, at 50: 4 |
| dino pose when it crashed | running 14, jumping 14, speed-dropping 7, ducking 9 (ducking into a pterodactyl at 100: 1) |
| speed | highest 13.000999999997896 (the cap), 2,588 frames at the cap in 3 cases |
| score shown | highest 1312, above 1000 in 2 cases; pterodactyls appear in 11 cases |
| jumps | 786 (686 landed normally, 195 with the key released after the minimum height = short jump) |
| frames speed-dropping / ducking | 959 / 4,959 |
| most obstacles on screen | 3 |

Players (`bot` in each case file): no input, jump once then idle, press-and-hold-duck, held space with auto-repeat (bunny hop),
noise before the first key, six good players with different frame times (steady 16.667, mixed 16.667/17/33.333/50, jittered
15..18.5 ms, 30 Hz, 120 Hz, laggy with 83 ms stalls), three players that make mistakes and speed-drop, early/late/tap jumpers, a
player who starts with Down, four that are right about cacti and wrong about pterodactyls, three random-key fuzzers.
Restart by Enter, by Space (down+up) and by pressing the jump key up every frame from 38 frames after the crash.

## 13. Not matched / not covered (honest list)

* Every number matches bit for bit, with exact comparison. Nothing is loosened.
* Not covered by any recording: a crash into a pterodactyl while speed-dropping, any `paused`/focus/blur path, touch/mouse input,
  widths other than 600, a first key after 3 blinks (> ~20 s of waiting), a restart in the very next frame after a crash (the earliest recorded restart is 3 frames after).
* Obstacle types: all 3 types, sizes 1-3 for both cacti, all 3 pterodactyl heights were created; crashes into each cactus type and size,
  but **only 1 crash into a pterodactyl at y 75 and 4 at y 50, 2 at y 100**, the player had to be wrong on purpose.
* Speed cap reached in 3 cases (`maxSpeed 13.0009999...`); score above 1000 in 2 (the highest is 1312). The cap needs about 3,500 frames without crashing, so long runs are rare in the set.
* The 750 ms restart boundary is hit by the "mash" players, not tested at exact equality with a hand-built case.
* The playable page (`ports/web/index.html`) is not verified against the recording; it uses the verified `dino.mjs` and own drawn art, steps the
  rules at a fixed 60 Hz from the real frame times, and dispatches the intro end after 400 ms of game time. Its input is the keyboard or a pointer
  (jump on press, release on lift), plus an on-screen duck button on touch screens.
