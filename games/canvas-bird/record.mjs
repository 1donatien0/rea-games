// Records the ORIGINAL Canvas Bird (originals/canvas-bird, MIT) into replayable cases.
// The page runs unmodified in headless Chrome (driver.mjs); a case is its seeded random numbers
// (tape), the inputs fed to it ({dt, click} per rendered frame) and the trace it drew (one draw list per
// frame, the first one being the frame drawn at load). Inputs come from small scripted players (bots
// that look only at the draw list, the way a person looks at the screen), so they react to the game.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal } from "./driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60; // 16.666666666666668
const DTS = [8, DT, 20, 33, 50, 100];

// ---- reading a frame the way a player sees it
export function observe(frame) {
  const o = { playing: false, y: null, pipes: [], score: null };
  const up = [], down = [];
  for (const s of frame) {
    const p = s.split(":");
    if (p[0] === "s" && p[1] === "player") { o.playing = true; o.y = +p[7]; }
    else if (p[0] === "i" && p[1] === "enemy_up") up.push([+p[2], +p[3]]);
    else if (p[0] === "i" && p[1] === "enemy_down") down.push([+p[2], +p[3]]);
    else if (p[0] === "t" && p[1] === "fill" && p[2] !== "Click to start game") o.score = +p[2];
  }
  o.pipes = up.map((u, i) => ({ xu: u[0], yu: u[1], xd: down[i][0], yd: down[i][1] }));
  return o;
}

// ---- players
// A pipe checks the bird only while 70 < down.x < 94 (see GAME.md); the bot keeps its box in the gap then.
function simulate(y, v, tap, pipes, mTop, mBot, H = 130) {
  for (let k = 1; k <= H; k++) {
    if (k === 1 && tap) v = -6;
    if (v < 8) v += 0.15;
    y += v;
    if (y + 64 < 0 || y > 480) return k;
    for (const p of pipes) {
      const xd = p.xd - 3 * (k + 1);
      if (xd > 70 && xd < 94 && (y < p.yd + 316 + mTop || y + 64 > p.yu - mBot)) return k;
    }
  }
  return Infinity;
}

export function botPlayer({ r, dt = DT, bias = 0, margin = 4, miss = 0, extra = 0, restartWait = [6, 40], stopScore = Infinity, maxFrames, rounds = Infinity, dtMix = false }) {
  let prevY = null, vEnd = 2, tapped = false, wait = 0, frames = 0, round = 0, wasPlaying = false;
  return (obs) => {
    frames++;
    const stepDt = dtMix ? DTS[Math.floor(r() * DTS.length)] : dt;
    const stop = frames > maxFrames || (obs.score ?? 0) >= stopScore;
    if (stop) return null;
    if (!obs.playing) {
      prevY = null; wasPlaying = false;
      if (wait-- > 0) return { dt: stepDt, click: false };
      if (round >= rounds) return null;
      wait = restartWait[0] + Math.floor(r() * (restartWait[1] - restartWait[0]));
      round++;
      return { dt: stepDt, click: true };
    }
    if (!wasPlaying) { wasPlaying = true; vEnd = 2; tapped = false; prevY = obs.y; }
    else {
      vEnd = obs.y - prevY;
      prevY = obs.y;
    }
    // velocity after this frame's fall, given what the bot did in this frame
    const v = tapped ? -5.85 : vEnd + (vEnd < 8 ? 0.15 : 0);
    const yNext = obs.y + v;
    const pipes = obs.pipes.filter((p) => p.xd + 64 > 60).sort((a, b) => a.xd - b.xd).slice(0, 2);
    const mTop = Math.max(-80, margin - bias), mBot = Math.max(-80, margin + bias);
    // frames follow each other at 3 px per frame whatever dt is, so the bot plans in frames
    let tap = false;
    const noTap = simulate(yNext, v, false, pipes, mTop, mBot);
    if (noTap !== Infinity) tap = simulate(yNext, v, true, pipes, mTop, mBot) > noTap;
    else if (yNext + 64 > 470) tap = true;
    if (miss && r() < miss) tap = false;
    if (extra && r() < extra) tap = true;
    tapped = tap;
    return { dt: stepDt, click: tap };
  };
}

// plain scripted players: pick(frameIndex, obs, r) -> click boolean
export function scripted({ r, frames, dt = DT, dtMix = false, click, restart = true, restartWait = [5, 60] }) {
  let i = 0, wait = 0;
  return (obs) => {
    i++;
    const stepDt = dtMix ? DTS[Math.floor(r() * DTS.length)] : dt;
    if (i > frames) return null;
    if (!obs.playing && restart === "auto") {
      if (wait-- > 0) return { dt: stepDt, click: false };
      wait = restartWait[0] + Math.floor(r() * (restartWait[1] - restartWait[0]));
      return { dt: stepDt, click: true };
    }
    return { dt: stepDt, click: !!click(i, obs, r) };
  };
}

// ---- coverage read off a recorded trace (independent of any port)
export function analyze(trace, tape) {
  const c = { frames: trace.length, starts: 0, maxScore: 0, scoreUps: 0, recycles: 0, loses: 0, topPipe: 0, bottomPipe: 0, topExit: 0, bottomExit: 0, fellToSplash: 0, restarts: 0, splashFrames: 0, points: 0 };
  let prev = null, losing = false, sawLose = false;
  for (let f = 0; f < trace.length; f++) {
    const o = observe(trace[f]);
    if (!o.playing) c.splashFrames++;
    if (o.playing && (!prev || !prev.playing)) { c.starts++; if (sawLose) c.restarts++; }
    if (prev && prev.playing && !o.playing) c.fellToSplash++;
    if (o.score != null) { c.maxScore = Math.max(c.maxScore, o.score); if (prev && prev.score != null && o.score > prev.score) c.scoreUps++; }
    if (prev && prev.playing && o.playing) for (let i = 0; i < o.pipes.length; i++) if (o.pipes[i].xu > prev.pipes[i].xu) c.recycles++;
    c.points += trace[f].filter((s) => s === "a:point").length;
    if (trace[f].includes("a:lose")) {
      c.loses++; sawLose = true;
      const nx = f + 1 < trace.length ? observe(trace[f + 1]) : null;
      if (nx && nx.playing) {
        const yPost = nx.y;
        const hit = o.pipes.find((p) => { const xd = p.xd - 3; return xd + 40 < 134 && 134 < xd + 64; });
        if (hit && yPost < hit.yd + 316) c.topPipe++;
        else if (hit && yPost + 64 > hit.yu) c.bottomPipe++;
        else if (yPost + 64 < 0) c.topExit++;
        else if (yPost > 480) c.bottomExit++;
      }
    }
    prev = o;
  }
  return c;
}

export async function runCase({ seed, player, rSeed }) {
  const g = await openOriginal({ seed });
  try {
    const trace = [g.initial];
    const inputs = [];
    let obs = observe(g.initial);
    for (;;) {
      const inp = player(obs);
      if (!inp) break;
      const frame = await g.step(inp);
      inputs.push({ dt: inp.dt, click: !!inp.click });
      trace.push(frame);
      obs = observe(frame);
    }
    return { tape: await g.tape(), inputs, trace };
  } finally { await g.close(); }
}

export function buildCases() {
  const R = (s) => mulberry32(s * 7919 + 17);
  const cases = [];
  const add = (name, seed, make) => cases.push({ name, seed, make: () => make(R(seed)) });
  // splash screen: the text alpha fluctuates; the background scrolls
  add("splash-wait", 1, (r) => scripted({ r, frames: 700, click: () => false }));
  add("splash-wait-varied-dt", 2, (r) => scripted({ r, frames: 500, dtMix: true, click: () => false }));
  // start and fall without ever tapping (twice: crash, fall off the bottom, splash, start again)
  add("idle-fall-restart", 3, (r) => scripted({ r, frames: 600, restart: "auto", restartWait: [3, 30], click: () => false }));
  add("idle-fall-varied-dt", 4, (r) => scripted({ r, frames: 900, dtMix: true, restart: "auto", click: () => false }));
  // a click on the very first frames: the fall counter has not run 1000/30 ms yet
  add("click-at-load-60fps", 5, (r) => scripted({ r, frames: 120, click: (i) => i === 1 }));
  add("click-at-load-8ms", 6, (r) => scripted({ r, frames: 120, dt: 8, click: (i) => i === 1 }));
  add("click-at-load-then-flap", 7, (r) => scripted({ r, frames: 200, dt: 8, click: (i) => i === 1 || i === 3 || i === 9 }));
  // bots that pass many pipes (the pipes recycle, one random number per recycle)
  add("bot-60fps-a", 11, (r) => botPlayer({ r, stopScore: 36, maxFrames: 7000 }));
  add("bot-60fps-b", 12, (r) => botPlayer({ r, margin: 8, stopScore: 36, maxFrames: 7000 }));
  add("bot-mixed-dt", 13, (r) => botPlayer({ r, dtMix: true, stopScore: 36, maxFrames: 7000 }));
  add("bot-8ms", 14, (r) => botPlayer({ r, dt: 8, stopScore: 32, maxFrames: 7000 }));
  add("bot-20ms", 15, (r) => botPlayer({ r, dt: 20, stopScore: 32, maxFrames: 7000 }));
  add("bot-33ms", 16, (r) => botPlayer({ r, dt: 33, stopScore: 32, maxFrames: 7000 }));
  add("bot-50ms", 17, (r) => botPlayer({ r, dt: 50, stopScore: 32, maxFrames: 7000 }));
  add("bot-100ms", 18, (r) => botPlayer({ r, dt: 100, stopScore: 32, maxFrames: 7000 }));
  // bots that make mistakes: several rounds per case, every kind of loss
  add("bot-sloppy-1", 21, (r) => botPlayer({ r, miss: 0.04, extra: 0.03, maxFrames: 2500 }));
  add("bot-sloppy-2", 22, (r) => botPlayer({ r, miss: 0.08, extra: 0.02, dtMix: true, maxFrames: 2500 }));
  add("bot-aims-high", 23, (r) => botPlayer({ r, bias: 60, maxFrames: 2500 }));
  add("bot-aims-low", 24, (r) => botPlayer({ r, bias: -70, maxFrames: 2500 }));
  add("bot-aims-high-8ms", 25, (r) => botPlayer({ r, bias: 60, dt: 8, maxFrames: 2000 }));
  add("bot-aims-low-50ms", 26, (r) => botPlayer({ r, bias: -70, dt: 50, maxFrames: 2000 }));
  // early and late taps, frantic clicking, flying above the top
  add("early-taps", 31, (r) => scripted({ r, frames: 1200, restart: "auto", click: (i) => i % 7 === 0 }));
  add("late-taps", 32, (r) => scripted({ r, frames: 1500, restart: "auto", click: (i, o) => o.playing && o.y > 330 }));
  add("frantic-clicking", 33, (r) => scripted({ r, frames: 1500, dtMix: true, restart: "auto", click: (i, o, rr) => rr() < 0.7 }));
  add("frantic-every-frame", 34, (r) => scripted({ r, frames: 800, click: () => true }));
  add("fly-above-top", 35, (r) => scripted({ r, frames: 1500, restart: "auto", restartWait: [20, 80], click: (i, o) => o.playing && o.y > 40 }));
  add("hover-low-then-fall", 36, (r) => scripted({ r, frames: 1200, restart: "auto", click: (i, o) => o.playing && o.y > 395 }));
  add("restart-spam-while-falling", 37, (r) => scripted({ r, frames: 1000, dtMix: true, click: (i, o, rr) => !o.playing ? rr() < 0.1 : i % 40 === 0 }));
  add("random-clicks-mixed-dt", 38, (r) => scripted({ r, frames: 1500, dtMix: true, restart: "auto", click: (i, o, rr) => rr() < 0.08 }));
  // a long run with the best bot and mistakes now and then, to repeat the pipe cycle
  add("bot-marathon", 41, (r) => botPlayer({ r, miss: 0.002, maxFrames: 9000, stopScore: 60 }));
  return cases;
}

export async function record({ only, log = () => {} } = {}) {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  const cases = buildCases().filter((c) => !only || only.includes(c.name));
  let frames = 0, inputs = 0;
  const total = {};
  for (const c of cases) {
    const { tape, inputs: inp, trace } = await runCase({ seed: c.seed, player: c.make() });
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify({ game: "canvas-bird", name: c.name, seed: c.seed, tape, inputs: inp, trace }));
    const a = analyze(trace, tape);
    for (const k of Object.keys(a)) total[k] = (k === "maxScore" ? Math.max(total[k] ?? 0, a[k]) : (total[k] ?? 0) + a[k]);
    frames += trace.length; inputs += inp.length;
    log(`${c.name.padEnd(28)} frames ${String(trace.length).padStart(5)} randoms ${String(tape.length).padStart(3)} ${JSON.stringify(a)}`);
  }
  return { cases: cases.length, inputs, frames, coverage: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await record({ log: console.log }));
