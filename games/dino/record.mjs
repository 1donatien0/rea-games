// Records the ORIGINAL Chrome Dino (originals/dino, BSD-3, unmodified) into replayable cases.
// The original runs in Chromium under a fake clock (driver.mjs); a seeded "player" decides the
// keys of every frame from the state it can see. Only the original's output is written as trace.
//   node games/dino/record.mjs              record every case, print the coverage
//   node games/dino/record.mjs --visual     record again with other visual-stream seeds, compare traces
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal, CLOCK0 } from "./driver.mjs";
import { firstDiff } from "../../lib/compare.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TREX_W = 44;
const NOMINAL = 1000 / 60;

// ---- frame times ---------------------------------------------------------------------------
function makeDt(kind, r) {
  switch (kind) {
    case "steady": return () => 16.667;
    case "mixed": return () => { const x = r(); return x < 0.9 ? 16.667 : x < 0.95 ? 17 : x < 0.98 ? 33.333 : 50; };
    case "jitter": return () => 15 + r() * 3.5; // 15..18.5 ms with ugly fractions
    case "slow30": return () => 33.333;
    case "fast120": return () => 8.333;
    case "laggy": return () => { const x = r(); return x < 0.97 ? 16.667 : x < 0.99 ? 33.333 : 83; };
    default: throw new Error("dt kind " + kind);
  }
}
const DT_AVG = { steady: 16.667, mixed: 17.5, jitter: 16.7, slow30: 33.333, fast120: 8.333, laggy: 17.3 };

// ---- the player ----------------------------------------------------------------------------
// Looks at the state of the previous frame, returns the keys of the next one.
function makeBot(p, r) {
  const b = {
    f: 0, jumpHeld: false, jumpHeldFor: 0, duckHeld: false, duckHeldFor: 0, crashFor: 0,
    lastTargetX: -1e9, plan: null, sd: null, started: false,
  };
  const closingOf = (speed) => Math.max(1, Math.floor((speed * 60 / 1000) * DT_AVG[p.dt]));
  return (s) => {
    const inp = {};
    const f = b.f++;
    const x = s.tRex;
    const nominalFrames = (frames) => frames * (NOMINAL / DT_AVG[p.dt]);

    // ---- before the first key
    if (!s.playing && !s.crashed && !s.activated) {
      if (p.preNoise) {
        if (f === 2) inp.duck = true;
        if (f === 3) inp.duckUp = true;
        if (f === 4) inp.enter = true;
        if (f === 5) inp.jumpUp = true;
      }
      if (f >= p.startDelay && p.play) {
        if (p.firstKey === "duck") { if (!b.firstDuck) { inp.duck = true; b.firstDuck = true; return inp; } }
        inp.jump = true;
        b.jumpHeld = true; b.jumpHeldFor = 0; b.started = true;
        b.plan = null;
      }
      return inp;
    }
    if (!p.play) return inp;

    // ---- crashed: wait, maybe mash keys, restart
    if (s.crashed) {
      b.crashFor++;
      b.jumpHeld = false; b.duckHeld = false; b.sd = null; b.plan = null;
      if (p.crashNoise && r() < p.crashNoise) {
        const k = Math.floor(r() * 4);
        if (k === 0) inp.jump = true; else if (k === 1) inp.duck = true; else if (k === 2) inp.duckUp = true; else inp.jumpUp = b.crashFor > 20 ? false : true;
        if (!inp.jumpUp) delete inp.jumpUp;
      }
      if (p.restart === "enter" && b.crashFor === p.restartDelay) inp.enter = true;
      else if (p.restart === "space" && b.crashFor === p.restartDelay) { inp.jump = true; }
      else if (p.restart === "space" && b.crashFor === p.restartDelay + 1) { inp.jumpUp = true; }
      else if (p.restart === "mash" && b.crashFor >= p.restartDelay) { inp.jumpUp = true; }
      else if (p.restart === "never") { /* stays crashed */ }
      return inp;
    }
    b.crashFor = 0;

    // ---- fuzz: random keys every frame
    if (p.fuzz) {
      if (r() < p.fuzz) inp.jump = true;
      if (r() < p.fuzz) inp.duck = true;
      if (r() < p.fuzz) inp.jumpUp = true;
      if (r() < p.fuzz) inp.duckUp = true;
      if (r() < p.fuzz / 8) inp.enter = true;
      return inp;
    }

    // ---- hold bots: never look at the obstacles
    if (p.mode === "bunny") { // space held down with auto repeat
      if (!b.jumpHeld) { inp.jump = true; b.jumpHeld = true; } else if (b.f % 2 === 0) inp.jump = true;
      return inp;
    }
    if (p.mode === "duckHold") { // jump once to start, then hold down
      if (b.jumpHeld && b.jumpHeldFor++ >= 2 && !x.jumping) { inp.jumpUp = true; b.jumpHeld = false; }
      if (!b.duckHeld && !x.jumping && !b.jumpHeld) { inp.duck = true; b.duckHeld = true; }
      return inp;
    }
    if (p.mode === "idle") { // press the jump key once, then nothing
      if (b.jumpHeld && b.jumpHeldFor++ >= 3) { inp.jumpUp = true; b.jumpHeld = false; }
      return inp;
    }

    // ---- jump key release policy
    if (b.jumpHeld) {
      b.jumpHeldFor++;
      if (p.repeat && b.jumpHeldFor % 2 === 0) inp.jump = true; // OS auto repeat while held
      const rel =
        p.hold === "full" ? !x.jumping && b.jumpHeldFor > 2 :
        p.hold === "early" ? x.reachedMinHeight :
        p.hold === "tap" ? b.jumpHeldFor >= 2 :
        p.hold === "mixed" ? (b.plan && b.plan.early ? x.reachedMinHeight : !x.jumping && b.jumpHeldFor > 2) :
        false;
      if (rel || b.jumpHeldFor > 120) { inp.jumpUp = true; b.jumpHeld = false; }
    }
    if (b.duckHeld) {
      b.duckHeldFor++;
      if (b.sd) { // speed drop / duck after it: let go some frames after landing
        if (!x.jumping && b.duckHeldFor > b.sd.holdFor) { inp.duckUp = true; b.duckHeld = false; b.sd = null; }
      }
    }

    // ---- look at the next obstacle
    const o = s.obstacles.find((q) => q.xPos + q.width > x.xPos + 2);
    if (!o) return inp;
    if (o.xPos > b.lastTargetX) { // a new obstacle became the target: decide what to do about it
      b.plan = {
        miss: r() < (o.type === "PTERODACTYL" && p.missPtero !== undefined ? p.missPtero : p.miss),
        alt: r() < 0.5,
        lead: p.lead + (r() * 2 - 1) * p.leadJitter,
        early: r() < 0.5,
        lead50: 2.5 + r() * 3,
        sd: r() < p.sdProb,
        sdHold: 2 + Math.floor(r() * 25),
        done: false,
      };
    }
    b.lastTargetX = o.xPos;
    const plan = b.plan;
    const speed = s.currentSpeed + (o.type === "PTERODACTYL" ? o.speedOffset : 0);
    const closing = closingOf(speed);
    const dist = o.xPos - (x.xPos + TREX_W);
    const onGround = !x.jumping;

    // speed drop in the air once the obstacle is behind us
    if (plan.sd && x.jumping && !x.speedDrop && x.jumpVelocity > 0 && dist < -4 && !b.duckHeld) {
      inp.duck = true; b.duckHeld = true; b.duckHeldFor = 0; b.sd = { holdFor: plan.sdHold };
    }
    if (plan.done || !onGround && !b.duckHeld) { /* nothing more to do for this obstacle */ }

    const doJump = () => {
      if (b.duckHeld && !b.sd) { inp.duckUp = true; b.duckHeld = false; return false; }
      if (x.ducking) { inp.duckUp = true; b.duckHeld = false; return false; }
      inp.jump = true; b.jumpHeld = true; b.jumpHeldFor = 0; plan.done = true; return true;
    };

    if (o.type === "PTERODACTYL" && o.yPos === 75) { // flies at head height: duck under it
      const startDuck = dist <= closing * nominalFrames(p.duckLead);
      const passed = o.xPos + o.width < x.xPos + 4;
      if (!plan.miss && onGround && !b.duckHeld && startDuck && !passed) { inp.duck = true; b.duckHeld = true; b.duckHeldFor = 0; b.sd = null; }
      else if (plan.miss && plan.alt && onGround && !plan.done && startDuck && dist > -TREX_W) doJump(); // wrong answer: jump into it
      else if (b.duckHeld && !b.sd && passed) { inp.duckUp = true; b.duckHeld = false; }
    } else if (o.type === "PTERODACTYL" && o.yPos === 50) { // flies over the running dino
      if (plan.miss && onGround && !plan.done && dist <= closing * nominalFrames(plan.lead50)) doJump(); // too late: meets it in the air
    } else if (o.type === "PTERODACTYL" && plan.miss && plan.alt) { // wrong answer for a low one: duck under it
      const startDuck = dist <= closing * nominalFrames(p.duckLead);
      const passed = o.xPos + o.width < x.xPos + 4;
      if (onGround && !b.duckHeld && startDuck && !passed) { inp.duck = true; b.duckHeld = true; b.duckHeldFor = 0; b.sd = null; }
      else if (b.duckHeld && !b.sd && passed) { inp.duckUp = true; b.duckHeld = false; }
    } else { // cactus or low pterodactyl: jump over it
      const trigger = dist <= closing * nominalFrames(plan.lead + (b.duckHeld ? 3 : 0));
      if (!plan.miss && onGround && !plan.done && trigger && dist > -TREX_W) doJump();
    }
    // a duck held for nothing: let go when the next obstacle is a cactus
    return inp;
  };
}

// ---- running one case on the original -------------------------------------------------------
export async function runCase(spec, { visualSeed } = {}) {
  const o = await openOriginal({ seed: spec.seed, visualSeed });
  try {
    const bot = makeBot(spec.bot, mulberry32(spec.seed * 31 + 7));
    const nextDt = makeDt(spec.bot.dt, mulberry32(spec.seed * 131 + 3));
    const trace = [await o.initial()];
    const inputs = [];
    let state = trace[0];
    let blinkChecked = false;
    for (let i = 0; i < spec.frames; i++) {
      const inp = spec.script ? spec.script(i, state) : bot(state);
      inp.dt = nextDt();
      const { applied, state: s } = await o.step(inp);
      if (!blinkChecked && applied.jump) {
        // the port assumes the "waiting" update loop is still alive at the first key
        if ((await o.blinkCount()) >= 3) throw new Error(`${spec.name}: the dino blinked 3 times before the first key; use another seed`);
        blinkChecked = true;
      }
      inputs.push(applied);
      trace.push(s);
      state = s;
    }
    if (o.errors.length) throw new Error(`${spec.name}: page error ${o.errors[0]}`);
    return { game: "dino", name: spec.name, seed: spec.seed, clock0: CLOCK0, bot: spec.bot, tape: await o.tape(), inputs, trace, _o: o };
  } finally {
    // the caller closes via o.close() after reading callers; close here when not asked to keep
    if (!spec.keepOpen) await o.close();
  }
}

// ---- the cases -----------------------------------------------------------------------------
const base = { play: true, startDelay: 5, dt: "steady", lead: 8, leadJitter: 1, duckLead: 11, miss: 0, hold: "full", repeat: false, sdProb: 0, restart: "enter", restartDelay: 10, crashNoise: 0 };
const B = (o) => ({ ...base, ...o });

export function buildSpecs() {
  const S = [];
  const add = (name, seed, frames, bot) => S.push({ name, seed, frames, bot: B(bot) });
  add("no-input", 1, 300, { play: false });
  add("idle-crash-1", 2, 500, { mode: "idle", restart: "never" });
  add("idle-crash-2", 3, 600, { mode: "idle", restart: "enter", restartDelay: 30, dt: "mixed" });
  add("duck-hold-crash", 4, 600, { mode: "duckHold", restart: "enter", restartDelay: 12 });
  add("bunny-hop-1", 5, 600, { mode: "bunny", restart: "space", restartDelay: 50 });
  add("bunny-hop-2", 6, 600, { mode: "bunny", restart: "enter", restartDelay: 3, dt: "jitter" });
  add("pre-noise-idle", 7, 500, { mode: "idle", preNoise: true, startDelay: 9, restart: "space", restartDelay: 60 });
  // good players of different styles: long runs that reach the speed cap
  add("bot-full-steady", 11, 5000, { hold: "full" });
  add("bot-early-steady", 12, 3000, { hold: "early", restart: "space", restartDelay: 46 });
  add("bot-mixed-dt", 13, 4200, { hold: "full", dt: "mixed", leadJitter: 1.5 });
  add("bot-jitter-dt", 14, 2600, { hold: "full", dt: "jitter", repeat: true });
  add("bot-slow30", 15, 2000, { hold: "full", dt: "slow30", lead: 5, leadJitter: 0.5, duckLead: 6 });
  add("bot-fast120", 16, 2600, { hold: "full", dt: "fast120", lead: 16, duckLead: 22 });
  add("bot-laggy", 18, 3900, { hold: "full", dt: "laggy", restart: "mash", restartDelay: 38 });
  // players that make mistakes and speed-drop
  add("bot-speeddrop", 21, 3000, { hold: "mixed", sdProb: 0.6, miss: 0.04, restart: "mash", restartDelay: 40, dt: "mixed" });
  add("bot-sloppy-1", 22, 2200, { hold: "mixed", miss: 0.12, leadJitter: 3, sdProb: 0.3, restart: "enter", restartDelay: 4 });
  add("bot-sloppy-2", 23, 2200, { hold: "early", miss: 0.2, leadJitter: 4, restart: "space", restartDelay: 44, crashNoise: 0.15, dt: "jitter" });
  add("bot-sloppy-3", 24, 2200, { hold: "full", miss: 0.1, leadJitter: 2, sdProb: 1, restart: "mash", restartDelay: 41, crashNoise: 0.1, dt: "laggy" });
  add("bot-late-jumper", 25, 1800, { hold: "full", lead: 3.5, leadJitter: 1, restart: "enter", restartDelay: 20 });
  add("bot-early-jumper", 26, 1800, { hold: "full", lead: 14, leadJitter: 2, restart: "space", restartDelay: 45 });
  add("bot-tap-jump", 27, 1200, { hold: "tap", restart: "enter", restartDelay: 8, dt: "mixed" });
  add("bot-first-duck", 28, 1200, { hold: "full", firstKey: "duck", sdProb: 0.5, restart: "space", restartDelay: 44 });
  // good with cacti, wrong about pterodactyls (they come after speed 8.5, so each restart climbs again)
  add("ptero-hunter-1", 41, 4200, { hold: "full", missPtero: 1, restart: "enter", restartDelay: 6 });
  add("ptero-hunter-2", 42, 4200, { hold: "full", missPtero: 1, dt: "mixed", restart: "space", restartDelay: 44 });
  add("ptero-hunter-3", 43, 4200, { hold: "full", missPtero: 1, sdProb: 0.5, dt: "jitter", restart: "mash", restartDelay: 39 });
  add("ptero-hunter-4", 44, 4200, { hold: "full", missPtero: 1, dt: "laggy", restart: "enter", restartDelay: 9 });
  // random keys
  add("fuzz-sparse", 31, 1200, { fuzz: 0.02, restart: "enter", dt: "mixed" });
  add("fuzz-dense", 32, 1200, { fuzz: 0.15, dt: "jitter" });
  add("fuzz-1", 33, 1200, { fuzz: 0.06, dt: "laggy" });
  return S;
}

export async function record() {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (f.endsWith(".json")) fs.rmSync(path.join(outDir, f));
  let frames = 0;
  const specs = buildSpecs();
  for (const spec of specs) {
    const c = await runCase(spec);
    delete c._o;
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify(c));
    frames += c.inputs.length;
  }
  return { cases: specs.length, inputs: frames };
}

// ---- coverage, read back from the written cases ----------------------------------------------
export function coverage(cases) {
  const cov = {
    cases: cases.length, frames: 0, spawned: {}, ptero: {}, crashes: 0, crashedInto: {}, crashPose: {}, restarts: 0,
    maxSpeed: 0, framesAtCap: 0, maxScore: 0, jumps: 0, jumpsShort: 0, jumpsFull: 0, speedDropFrames: 0, duckFrames: 0,
    speedDropCrashes: 0, casesOver1000: 0, casesWithPtero: 0, casesAtCap: 0, maxObstaclesOnScreen: 0, pteroFrames: 0,
  };
  for (const c of cases) {
    let ptero = false, cap = false, over = false;
    const t = c.trace;
    for (let i = 0; i < c.inputs.length; i++) {
      const a = t[i], b = t[i + 1], inp = c.inputs[i];
      cov.frames++;
      for (const o of b.obstacles) {
        const w = { CACTUS_SMALL: 17, CACTUS_LARGE: 25, PTERODACTYL: 46 }[o.type];
        if (o.xPos === 600 + w) {
          const k = o.type === "PTERODACTYL" ? "PTERODACTYL" : `${o.type}x${o.size}`;
          cov.spawned[k] = (cov.spawned[k] || 0) + 1;
          if (o.type === "PTERODACTYL") { cov.ptero[o.yPos] = (cov.ptero[o.yPos] || 0) + 1; ptero = true; }
        }
        if (o.type === "PTERODACTYL") cov.pteroFrames++;
      }
      cov.maxObstaclesOnScreen = Math.max(cov.maxObstaclesOnScreen, b.obstacles.length);
      if (!a.crashed && b.crashed) {
        cov.crashes++;
        const o = b.obstacles[0];
        const k = o.type === "PTERODACTYL" ? `PTERODACTYL@${o.yPos}` : `${o.type}x${o.size}`;
        cov.crashedInto[k] = (cov.crashedInto[k] || 0) + 1;
        const pose = b.tRex.ducking ? "ducking" : b.tRex.speedDrop ? "speed-drop" : b.tRex.jumping ? "jumping" : "running";
        cov.crashPose[pose] = (cov.crashPose[pose] || 0) + 1;
      }
      if (a.crashed && !b.crashed) cov.restarts++;
      if (!a.tRex.jumping && b.tRex.jumping) cov.jumps++;
      if (a.tRex.jumping && inp.jumpUp && a.tRex.reachedMinHeight) cov.jumpsShort++;
      if (a.tRex.jumping && !b.tRex.jumping && !a.tRex.speedDrop) cov.jumpsFull++;
      if (b.tRex.speedDrop) cov.speedDropFrames++;
      if (b.tRex.ducking) cov.duckFrames++;
      cov.maxSpeed = Math.max(cov.maxSpeed, b.currentSpeed);
      if (b.currentSpeed >= 13) { cov.framesAtCap++; cap = true; }
      cov.maxScore = Math.max(cov.maxScore, b.score);
      if (b.score > 1000) over = true;
    }
    if (ptero) cov.casesWithPtero++;
    if (cap) cov.casesAtCap++;
    if (over) cov.casesOver1000++;
  }
  return cov;
}

export function loadCases() {
  const dir = path.join(here, "cases");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// Same inputs, other visual-stream seeds (clouds, stars, ground bumps, blinks): the trace must not change.
export async function checkVisualIndependence(log = console.log) {
  let bad = 0;
  const cases = loadCases();
  for (const c of cases) {
    const spec = buildSpecs().find((s) => s.name === c.name);
    for (const vs of [1, 987654321]) {
      const o = await openOriginal({ seed: c.seed, visualSeed: vs });
      try {
        const trace = [await o.initial()];
        for (const inp of c.inputs) trace.push((await o.step({ ...inp, animEnd: inp.animEnd === true })).state);
        const tape = await o.tape();
        const d = firstDiff(c.trace, trace) || (firstDiff(c.tape, tape) && "tape differs");
        if (d) { bad++; log(`  DIFF ${c.name} visualSeed ${vs}: ${d}`); }
      } finally { await o.close(); }
    }
    log(`  visual-seed check ${c.name}: ${c.inputs.length} frames x 2 seeds`);
    void spec;
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--visual")) {
    const bad = await checkVisualIndependence();
    console.log(bad ? `${bad} traces changed with the visual seed` : "all traces identical with other visual seeds");
    process.exit(bad ? 1 : 0);
  }
  console.log(await record());
  console.log(JSON.stringify(coverage(loadCases()), null, 1));
}
