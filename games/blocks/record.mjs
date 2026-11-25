// Records the ORIGINAL "blocks" page (originals/blocks, MIT) into replayable cases.
// The page runs unmodified in headless Chrome (driver.mjs). A case is the seeded random numbers it drew
// (tape), the inputs fed to it ({dt, keys} per rendered frame) and the state it was in (one object per
// frame, the first being the state right after load). Inputs come from scripted players and bots that look
// only at the previous frame's state, the way a person looks at the screen, so they react to the game.
// The bots keep their OWN copy of the piece shapes: if it were wrong they would only play badly; every
// number in a trace comes from the original.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal, T0 } from "./driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60; // 16.666666666666668
const DTS = [8, DT, 20, 33, 50, 100];
const W = 10, H = 20;

// ---- shapes, as the bots know them
const MASKS = {
  i: [0x0f00, 0x2222, 0x00f0, 0x4444], j: [0x44c0, 0x8e00, 0x6440, 0x0e20], l: [0x4460, 0x0e80, 0xc440, 0x2e00],
  o: [0xcc00, 0xcc00, 0xcc00, 0xcc00], s: [0x06c0, 0x8c40, 0x6c00, 0x4620], t: [0x0e40, 0x4c40, 0x4e00, 0x4640],
  z: [0x0c60, 0x4c80, 0xc600, 0x2640],
};
function cells(k, x, y, d) {
  const out = [];
  for (let i = 0; i < 16; i++) if (MASKS[k][d] & (0x8000 >> i)) out.push([x + (i & 3), y + (i >> 2)]);
  return out;
}
// 0 = fits, 1 = a wall or the floor is in the way, 2 = a block is in the way
function hit(grid, k, x, y, d) {
  let r = 0;
  for (const [cx, cy] of cells(k, x, y, d)) {
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) return 1;
    if (grid[cy][cx] !== ".") r = 2;
  }
  return r;
}

// ---- bots
const PRESETS = {
  // reward lines, punish holes, height and bumpiness (the usual hand-tuned weights)
  greedy: { lines: [0, 3, 5, 7, 9], height: -0.5, holes: -4, bump: -0.2, land: -0.1, well: 0 },
  doubles: { lines: [0, -1, 6, 3, 2], height: -0.4, holes: -4, bump: -0.2, land: -0.1, well: 0, panic: 11 },
  triples: { lines: [0, -2, 1, 8, 4], height: -0.4, holes: -4, bump: -0.15, land: -0.1, well: 0, panic: 12 },
  // keep the right-hand column empty until a vertical bar can fill it: four rows at once
  quads: { lines: [0, -3, -3, -2, 40], height: -0.4, holes: -4, bump: -0.15, land: -0.05, well: -6, panic: 12 },
};

function evaluate(grid, k, x, y, d, w) {
  const g = grid.map((row) => row.split("").map((c) => c !== "."));
  let inWell = 0;
  for (const [cx, cy] of cells(k, x, y, d)) { g[cy][cx] = true; if (cx === W - 1) inWell++; }
  let n = 0;
  const kept = [];
  for (let r = 0; r < H; r++) { if (r > 0 && g[r].every(Boolean)) n++; else kept.push(g[r]); }
  while (kept.length < H) kept.unshift(Array(W).fill(false));
  const heights = [];
  let holes = 0;
  for (let c = 0; c < W; c++) {
    let top = H;
    for (let r = 0; r < H; r++) if (kept[r][c]) { top = r; break; }
    heights.push(H - top);
    for (let r = top + 1; r < H; r++) if (!kept[r][c]) holes++;
  }
  const max = Math.max(...heights);
  let bump = 0;
  const upto = w.well ? W - 2 : W - 1;
  for (let c = 0; c < upto; c++) bump += Math.abs(heights[c] - heights[c + 1]);
  const agg = heights.reduce((a, b) => a + b, 0);
  let lines = w.lines[n];
  if (w.panic && max >= w.panic && n > 0) lines = 4 + 3 * n; // about to die: any clear is good
  const wellCost = n === 4 || (n > 0 && w.panic && max >= w.panic) ? 0 : w.well * inWell;
  return lines + w.height * agg + w.holes * holes + w.bump * bump + w.land * (H - y) + wellCost - (max > 16 ? 3 * (max - 16) : 0);
}

// the best way to lock the current piece, and the first key towards it (the page has no kicks, so a
// rotation next to a wall or a block simply does nothing; the search knows)
export function plan(obs, w) {
  const { type: k, x, y, dir } = obs.current;
  if (hit(obs.grid, k, x, y, dir)) return null;
  const key = (a, b, c) => ((a + 3) * 24 + b) * 4 + c;
  const seen = new Map([[key(x, y, dir), null]]);
  const queue = [[x, y, dir]];
  let best = null, bestScore = -Infinity;
  const moves = [["left", -1, 0, 0], ["right", 1, 0, 0], ["up", 0, 0, 1], ["down", 0, 1, 0]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [cx, cy, cd] = queue[qi];
    if (hit(obs.grid, k, cx, cy + 1, cd)) {
      const s = evaluate(obs.grid, k, cx, cy, cd, w);
      if (s > bestScore) { bestScore = s; best = [cx, cy, cd]; }
    }
    for (const [name, dx, dy, dd] of moves) {
      const nx = cx + dx, ny = cy + dy, nd = (cd + dd) & 3;
      if (hit(obs.grid, k, nx, ny, nd)) continue;
      const kk = key(nx, ny, nd);
      if (seen.has(kk)) continue;
      seen.set(kk, { from: [cx, cy, cd], name });
      queue.push([nx, ny, nd]);
    }
  }
  if (!best) return null;
  let cur = best, first = null;
  for (;;) {
    const p = seen.get(key(...cur));
    if (!p) break;
    first = p.name; cur = p.from;
  }
  return first; // null: the piece is already where it should lock
}

// ---- players. A player is (obs, i) -> {dt, keys} | null, with obs the state after the previous frame
// wraps a play style with "when the game is over: wait, then press Space (or the start link)"
function withRestarts(inner, { r, wait = [10, 40], link = 0, rounds = Infinity, stray = 0 }) {
  let w = -1, round = 0;
  return (obs, i) => {
    if (obs.playing) { w = -1; return inner(obs, i); }
    const a = inner(null, i);
    if (a === null) return null;
    if (w < 0) w = wait[0] + Math.floor(r() * (wait[1] - wait[0] + 1));
    if (w-- > 0) return { dt: a.dt, keys: stray && r() < stray ? [pick(r, ["left", "right", "up", "down", "esc"])] : [] };
    if (round >= rounds) return null;
    round++;
    return { dt: a.dt, keys: [link && r() < link ? "play" : "space"] };
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const dtOf = (r, dt, dtMix) => (dtMix ? pick(r, DTS) : dt);

function scripted({ r, frames, dt = DT, dtMix = false, keys, restart = null }) {
  const inner = (obs, i) => (i >= frames ? null : { dt: dtOf(r, dt, dtMix), keys: obs ? keys(i, obs, r) : [] });
  const p = restart ? withRestarts(inner, { r, ...restart }) : inner;
  return (obs, i) => (i === 0 && !restart ? { dt: dtOf(r, dt, dtMix), keys: ["space"] } : p(obs, i));
}

function bot({ r, frames, dt = DT, dtMix = false, preset = "greedy", miss = 0, noise = 0, esc = 0, restart = { wait: [8, 40] }, stopAt = null }) {
  const w = PRESETS[preset];
  const inner = (obs, i) => {
    if (i >= frames) return null;
    const d = dtOf(r, dt, dtMix);
    if (!obs) return { dt: d, keys: [] };
    if (stopAt && obs.rows >= stopAt) return null;
    let keys = [];
    if (esc && r() < esc) return { dt: d, keys: ["esc"] };
    if (obs.actions.length === 0) {
      const k = plan(obs, w);
      if (k && !(miss && r() < miss)) keys = [k];
    }
    if (noise && r() < noise) keys = [pick(r, ["left", "right", "up", "down"])];
    return { dt: d, keys };
  };
  const p = withRestarts(inner, { r, ...restart });
  return (obs, i) => (i === 0 ? { dt: dtOf(r, dt, dtMix), keys: ["space"] } : p(obs, i));
}

// ---- coverage read off a recorded trace (independent of any port)
export function analyze(trace, inputs) {
  const c = {
    frames: trace.length, starts: 0, restarts: 0, loses: 0, losesByEsc: 0, losesByStack: 0, locks: 0,
    clear1: 0, clear2: 0, clear3: 0, clear4: 0, maxRows: 0, maxScore: 0, minStep: 0.6, stepValues: 0,
    rotations: 0, rotBlockedWall: 0, rotBlockedStack: 0, rotMismatch: 0, kicksNeeded: 0,
    moves: 0, movesBlocked: 0, softDrops: 0, gravityDrops: 0, keysWhileStopped: 0, queueMax: 0, queueCleared: 0,
    doubleLockFrames: 0, vscoreCatchUp: 0, bagRefills: 0, locksByType: {}, rotByTypeDir: {},
  };
  const steps = new Set();
  const DIRN = ["up", "right", "down", "left"];
  for (let f = 1; f < trace.length; f++) {
    const p = trace[f - 1], s = trace[f], inp = inputs[f - 1];
    if (s.playing && !p.playing) { c.starts++; if (c.loses) c.restarts++; }
    if (!s.playing && p.playing) {
      c.loses++;
      if (inp.keys.includes("esc") && !p.actions.length) c.losesByEsc++; else c.losesByStack++;
    }
    c.maxRows = Math.max(c.maxRows, s.rows); c.maxScore = Math.max(c.maxScore, s.score);
    c.minStep = Math.min(c.minStep, s.step); steps.add(s.step);
    c.queueMax = Math.max(c.queueMax, s.actions.length);
    if (s.vscore < s.score && s.playing) c.vscoreCatchUp++;
    if (!p.playing && inp.keys.some((k) => k !== "space" && k !== "play")) c.keysWhileStopped++;
    if (s.bag.length > p.bag.length + 2) c.bagRefills++;
    if (!p.playing) continue;
    // the action handled in this frame: the head of the queue after this frame's key presses
    const pushed = s.playing || true ? inp.keys.filter((k) => ["left", "right", "up", "down"].includes(k)).map((k) => DIRN.indexOf(k)) : [];
    const queue = p.actions.concat(pushed);
    const head = inp.keys.includes("esc") ? undefined : queue[0];
    const locked = s.score !== p.score;
    const rows = s.rows - p.rows;
    if (rows > 0) c["clear" + rows]++;
    if (locked) {
      c.locks++;
      c.locksByType[p.current.type] = (c.locksByType[p.current.type] || 0) + 1;
      if (s.score - p.score >= 20 && rows === 0) c.doubleLockFrames++;
    }
    if (head !== undefined && !inp.keys.includes("esc")) {
      const q = p.current;
      if (head === 0) {
        c.rotations++;
        const nd = (q.dir + 1) & 3;
        const h = hit(p.grid, q.type, q.x, q.y, nd);
        if (h === 1) c.rotBlockedWall++; else if (h === 2) c.rotBlockedStack++;
        if (!locked && s.playing) {
          const turned = s.current.dir !== q.dir || (q.type === "o");
          if ((h === 0) !== turned && q.type !== "o") c.rotMismatch++;
        }
        if (h === 0) { const k = q.type + nd; c.rotByTypeDir[k] = (c.rotByTypeDir[k] || 0) + 1; }
        else if (q.type !== "o") {
          // would a kick (one column either way) have let it turn?
          if ([-1, 1, -2, 2].some((dx) => hit(p.grid, q.type, q.x + dx, q.y, nd) === 0)) c.kicksNeeded++;
        }
      } else if (head === 2) c.softDrops++;
      else {
        c.moves++;
        if (hit(p.grid, q.type, q.x + (head === 3 ? -1 : 1), q.y, q.dir)) c.movesBlocked++;
      }
    }
    if (p.actions.length && !s.actions.length && locked) c.queueCleared++;
    if (s.dt < p.dt && !locked && s.current.y === p.current.y + 1 && head !== 2) c.gravityDrops++;
  }
  c.stepValues = steps.size;
  return c;
}

export async function runCase({ seed, player }) {
  const g = await openOriginal({ seed });
  try {
    const trace = [g.initial];
    const inputs = [];
    for (let i = 0; ; i++) {
      const inp = player(trace[trace.length - 1], i);
      if (!inp) break;
      const st = await g.step(inp);
      inputs.push({ dt: inp.dt, keys: inp.keys });
      trace.push(st);
    }
    return { tape: await g.tape(), inputs, trace };
  } finally { await g.close(); }
}

export function buildCases() {
  const R = (s) => mulberry32(s * 7919 + 17);
  const cases = [];
  const add = (name, seed, make) => cases.push({ name, seed, make: () => make(R(seed)) });
  const arrows = ["left", "right", "up", "down"];
  // nothing pressed: the pieces fall and stack in place until the court is full, again and again
  add("idle-wait-16ms", 1, (r) => scripted({ r, frames: 1500, keys: () => [] }));
  add("idle-stack-lose-100ms", 2, (r) => scripted({ r, frames: 3500, dt: 100, keys: () => [], restart: { wait: [5, 30] } }));
  add("idle-stack-lose-50ms", 3, (r) => scripted({ r, frames: 3500, dt: 50, keys: () => [], restart: { wait: [5, 30], link: 0.5 } }));
  add("idle-stack-mixed-dt", 4, (r) => scripted({ r, frames: 4000, dtMix: true, keys: () => [], restart: { wait: [1, 20] } }));
  // keys with no game running, then a start: arrows, Escape and Space while stopped
  add("keys-while-stopped", 5, (r) => scripted({ r, frames: 600, dtMix: true, keys: () => [], restart: { wait: [40, 90], stray: 0.6 } }));
  add("space-and-link-while-playing", 6, (r) => scripted({ r, frames: 900, dtMix: true, keys: (i, o, rr) => (rr() < 0.05 ? [pick(rr, ["space", "play"])] : []), restart: { wait: [3, 15], link: 0.5 } }));
  // random keys
  add("random-keys-60fps", 7, (r) => scripted({ r, frames: 2500, keys: (i, o, rr) => (rr() < 0.4 ? [pick(rr, arrows)] : []), restart: { wait: [5, 30] } }));
  add("random-keys-8ms", 8, (r) => scripted({ r, frames: 2000, dt: 8, keys: (i, o, rr) => (rr() < 0.5 ? [pick(rr, arrows)] : []), restart: { wait: [5, 30] } }));
  add("random-keys-mixed-dt", 9, (r) => scripted({ r, frames: 3500, dtMix: true, keys: (i, o, rr) => (rr() < 0.5 ? [pick(rr, arrows)] : []), restart: { wait: [2, 20] } }));
  add("random-keys-100ms", 10, (r) => scripted({ r, frames: 2500, dt: 100, keys: (i, o, rr) => (rr() < 0.6 ? [pick(rr, arrows)] : []), restart: { wait: [2, 20] } }));
  add("several-keys-per-frame", 11, (r) => scripted({ r, frames: 1500, dtMix: true, keys: (i, o, rr) => { const n = Math.floor(rr() * 4); const k = []; for (let j = 0; j < n; j++) k.push(pick(rr, [...arrows, "esc"].slice(0, rr() < 0.97 ? 4 : 5))); return k; }, restart: { wait: [2, 15] } }));
  // soft drop spam and key mashing: the queue grows, and is emptied whenever a piece locks
  add("soft-drop-every-frame", 12, (r) => scripted({ r, frames: 2500, keys: () => ["down"], restart: { wait: [2, 10] } }));
  add("soft-drop-100ms", 13, (r) => scripted({ r, frames: 2000, dt: 100, keys: () => ["down"], restart: { wait: [2, 10] } }));
  add("soft-drop-twice-per-frame", 14, (r) => scripted({ r, frames: 1500, dt: 33, keys: () => ["down", "down"], restart: { wait: [2, 10] } }));
  add("mash-all-arrows", 15, (r) => scripted({ r, frames: 1800, dtMix: true, keys: () => ["left", "up", "right", "down"], restart: { wait: [2, 10] } }));
  // rotations against walls and stacks (no kicks in the original)
  add("rotate-at-left-wall", 16, (r) => scripted({ r, frames: 2000, dt: 33, keys: (i) => (i % 40 < 8 ? ["left"] : i % 40 < 30 ? ["up"] : ["down"]), restart: { wait: [2, 20] } }));
  add("rotate-at-right-wall", 17, (r) => scripted({ r, frames: 2000, dt: 33, keys: (i) => (i % 40 < 8 ? ["right"] : i % 40 < 30 ? ["up"] : ["down"]), restart: { wait: [2, 20] } }));
  add("rotate-spam-on-stack", 18, (r) => scripted({ r, frames: 2500, dt: 50, keys: (i, o, rr) => (o.actions.length < 2 && rr() < 0.7 ? [pick(rr, ["up", "up", "up", "left", "right"])] : []), restart: { wait: [2, 20] } }));
  // Escape: ends the game at once, then start again
  add("esc-at-random", 19, (r) => scripted({ r, frames: 1500, dtMix: true, keys: (i, o, rr) => (rr() < 0.02 ? ["esc"] : rr() < 0.3 ? [pick(rr, arrows)] : []), restart: { wait: [1, 10], link: 0.3 } }));
  // bots that clear lines
  add("bot-greedy-60fps", 21, (r) => bot({ r, frames: 3500 }));
  add("bot-greedy-60fps-b", 22, (r) => bot({ r, frames: 3500 }));
  add("bot-doubles", 23, (r) => bot({ r, frames: 3500, preset: "doubles" }));
  add("bot-triples", 24, (r) => bot({ r, frames: 3500, preset: "triples" }));
  add("bot-quads", 25, (r) => bot({ r, frames: 3500, preset: "quads" }));
  add("bot-quads-33ms", 26, (r) => bot({ r, frames: 3500, preset: "quads", dt: 33 }));
  add("bot-8ms", 27, (r) => bot({ r, frames: 2500, dt: 8 }));
  add("bot-20ms", 28, (r) => bot({ r, frames: 2500, dt: 20, preset: "doubles" }));
  add("bot-50ms", 29, (r) => bot({ r, frames: 2500, dt: 50, preset: "triples" }));
  add("bot-100ms", 30, (r) => bot({ r, frames: 2500, dt: 100 }));
  add("bot-mixed-dt", 31, (r) => bot({ r, frames: 3500, dtMix: true, preset: "quads" }));
  // bots with slips: wrong keys, skipped keys, Escape: they lose and start over
  add("bot-sloppy-1", 32, (r) => bot({ r, frames: 3500, miss: 0.15, noise: 0.15, restart: { wait: [3, 20] } }));
  add("bot-sloppy-2", 33, (r) => bot({ r, frames: 3500, miss: 0.3, noise: 0.1, dtMix: true, restart: { wait: [3, 20], link: 0.4 } }));
  add("bot-slow-reflexes", 34, (r) => bot({ r, frames: 3500, miss: 0.7, dt: 20, restart: { wait: [3, 20] } }));
  add("bot-with-escape", 35, (r) => bot({ r, frames: 3000, esc: 0.004, restart: { wait: [3, 20] } }));
  // long runs that reach a hundred rows: gravity gets to its fastest (step 0.6 - 0.005 * rows, at least 0.1)
  add("bot-marathon-a", 41, (r) => bot({ r, frames: 12000, preset: "doubles", dt: 33, stopAt: 130, restart: { wait: [3, 20] } }));
  add("bot-marathon-b", 42, (r) => bot({ r, frames: 12000, preset: "greedy", dtMix: true, stopAt: 130, restart: { wait: [3, 20] } }));
  return cases;
}

export async function record({ only, log = () => {} } = {}) {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  const cases = buildCases().filter((c) => !only || only.includes(c.name));
  let frames = 0, inputs = 0;
  const total = { locksByType: {}, rotByTypeDir: {} };
  for (const c of cases) {
    const { tape, inputs: inp, trace } = await runCase({ seed: c.seed, player: c.make() });
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify({ game: "blocks", name: c.name, seed: c.seed, clock0: T0, tape, inputs: inp, trace }));
    const a = analyze(trace, inp);
    for (const k of Object.keys(a)) {
      if (typeof a[k] === "object") for (const [kk, v] of Object.entries(a[k])) total[k][kk] = (total[k][kk] ?? 0) + v;
      else total[k] = (k === "minStep" ? Math.min(total[k] ?? 1, a[k]) : k === "maxRows" || k === "maxScore" || k === "queueMax" ? Math.max(total[k] ?? 0, a[k]) : (total[k] ?? 0) + a[k]);
    }
    frames += trace.length; inputs += inp.length;
    log(`${c.name.padEnd(30)} frames ${String(trace.length).padStart(5)} randoms ${String(tape.length).padStart(4)} rows ${String(a.maxRows).padStart(3)} clears ${a.clear1}/${a.clear2}/${a.clear3}/${a.clear4} loses ${a.loses} rotBlocked ${a.rotBlockedWall}+${a.rotBlockedStack} mism ${a.rotMismatch}`);
  }
  return { cases: cases.length, inputs, frames, coverage: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await record({ log: console.log })));
