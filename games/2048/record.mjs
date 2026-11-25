// Records the ORIGINAL 2048 (originals/2048/src, MIT) into replayable cases.
// The original is run unmodified inside a vm. Only its inputs are replaced:
// Math.random (a tape records every value it hands out), the input manager,
// the actuator and the storage, which are the browser parts of the game.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "../../originals/2048/src");
const load = (f) => fs.readFileSync(path.join(src, f), "utf8");

export function runOriginal({ seed, initial, inputs }) {
  const rand = mulberry32(seed);
  const tape = [];
  const handlers = {};
  let last = null;
  let best = 0;
  let saved = initial ?? null;

  const ctx = vm.createContext({});
  vm.runInContext("Math.random = __rand;", Object.assign(ctx, { __rand: () => { const v = rand(); tape.push(v); return v; } }));
  ctx.InputManager = function () { this.on = (e, cb) => { handlers[e] = cb; }; };
  ctx.Actuator = function () {
    this.actuate = (grid, meta) => {
      last = {
        grid: grid.cells.map((col) => col.map((t) => (t ? t.value : 0))),
        score: meta.score, over: meta.over, won: meta.won, terminated: meta.terminated, best: meta.bestScore,
      };
    };
    this.continueGame = () => {};
  };
  ctx.StorageManager = function () {
    this.getBestScore = () => best;
    this.setBestScore = (s) => { best = s; };
    this.getGameState = () => saved;
    this.setGameState = (s) => { saved = s; };
    this.clearGameState = () => { saved = null; };
  };
  for (const f of ["tile.js", "grid.js", "game_manager.js"]) vm.runInContext(load(f), ctx);
  const gm = vm.runInContext("new GameManager(4, InputManager, Actuator, StorageManager);", ctx);
  // keepPlaying() does not actuate, so "terminated" is read from the manager, as the page does
  const snap = () => ({ ...JSON.parse(JSON.stringify(last)), terminated: gm.isGameTerminated() });

  const trace = [snap()];
  for (const i of inputs) {
    if (i.t === "move") handlers.move(i.d);
    else if (i.t === "restart") handlers.restart();
    else if (i.t === "keep") handlers.keepPlaying();
    trace.push(snap());
  }
  return { tape, trace };
}

function makeInputs(kind, seed, n) {
  const r = mulberry32(seed * 7919 + 13);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (kind === "random") out.push({ t: "move", d: Math.floor(r() * 4) });
    else if (kind === "corner") {
      // left/down most of the time, sometimes right or up, as a human would
      const x = r();
      out.push({ t: "move", d: x < 0.45 ? 3 : x < 0.9 ? 2 : x < 0.97 ? 1 : 0 });
    } else if (kind === "restarts") {
      out.push(r() < 0.02 ? { t: "restart" } : { t: "move", d: Math.floor(r() * 4) });
    }
  }
  return out;
}

const winGrid = (rows) => ({
  grid: { size: 4, cells: rows.map((col, x) => col.map((v, y) => (v ? { position: { x, y }, value: v } : null))) },
  score: 20000, over: false, won: false, keepPlaying: false,
});

export function buildCases() {
  const cases = [];
  for (let s = 1; s <= 6; s++) cases.push({ name: `random-${s}`, seed: s, kind: "random", n: 600 });
  for (let s = 1; s <= 6; s++) cases.push({ name: `corner-${s}`, seed: 100 + s, kind: "corner", n: 3000 });
  for (let s = 1; s <= 2; s++) cases.push({ name: `restarts-${s}`, seed: 200 + s, kind: "restarts", n: 800 });
  // a saved game one merge from the win, to cover won / terminated / keepPlaying
  const near = winGrid([[1024, 1024, 0, 0], [2, 4, 8, 16], [32, 64, 128, 256], [0, 0, 0, 0]]);
  cases.push({
    name: "win-then-keep-playing", seed: 301, initial: near,
    inputs: [{ t: "move", d: 0 }, { t: "move", d: 1 }, { t: "move", d: 3 }, { t: "keep" }, { t: "move", d: 1 }, { t: "move", d: 2 }, { t: "move", d: 3 }, { t: "restart" }, { t: "move", d: 0 }],
  });
  // a saved game with no moves left: the game must end on the move that fills the board
  const full = winGrid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]]);
  // which seed ends it depends on the value the new tile gets, so take the first seed that does
  const fillInputs = [{ t: "move", d: 2 }, { t: "move", d: 0 }, { t: "move", d: 1 }, { t: "restart" }, { t: "move", d: 3 }];
  let fillSeed = 302;
  while (!runOriginal({ seed: fillSeed, initial: full, inputs: fillInputs }).trace.some((t) => t.over)) fillSeed++;
  cases.push({ name: "board-fills-then-over", seed: fillSeed, initial: full, inputs: fillInputs });
  // late-game boards: big tiles everywhere, random play, so merges of every size are covered
  const late = [
    [[512, 256, 128, 64], [32, 16, 8, 4], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[1024, 512, 0, 0], [256, 256, 0, 0], [128, 128, 64, 64], [2, 2, 4, 4]],
    [[2, 0, 0, 2], [0, 1024, 1024, 0], [0, 0, 0, 0], [4, 0, 0, 4]],
  ];
  late.forEach((rows, i) => cases.push({ name: `late-game-${i + 1}`, seed: 400 + i, kind: "random", n: i === 2 ? 30 : 400, initial: winGrid(rows) }));
  return cases;
}

export function record() {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const c of buildCases()) {
    const inputs = c.inputs ?? makeInputs(c.kind, c.seed, c.n);
    const { tape, trace } = runOriginal({ seed: c.seed, initial: c.initial, inputs });
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify({ game: "2048", name: c.name, initial: c.initial ?? null, tape, inputs, trace }));
    total += inputs.length;
  }
  return { cases: buildCases().length, inputs: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(record());
