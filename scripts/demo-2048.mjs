// Renders the hero GIF for 2048: the ORIGINAL page next to the rebuild, same moves, same random numbers.
// Usage: node scripts/demo-2048.mjs <out.gif> [moves]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../lib/rng.mjs";
import { Game2048 } from "../games/2048/ports/web/game2048.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "docs/assets/2048.gif");
const MOVES = Number(process.argv[3] ?? 140);
const SEED = 20481;

// a small look-ahead bot, so the demo shows a real game
function pickMove(g) {
  let best = -1, bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    const c = new Game2048({ rng: () => 0.5 });
    c.cells = g.cells.map((x) => x.slice()); c.score = g.score; c.over = g.over; c.won = g.won; c.kept = g.kept;
    const before = c.score;
    if (!c.move(d)) continue;
    const cornerBonus = c.cells[0][3] ? Math.log2(c.cells[0][3]) * 4 : 0;
    const s = (c.score - before) + c.empty().length * 12 + cornerBonus;
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return best;
}
const rng = mulberry32(SEED);
const bot = new Game2048({ rng });
const moves = [];
while (moves.length < MOVES && !bot.terminated) { const m = pickMove(bot); if (m < 0) break; bot.move(m); moves.push(m); }

const seedScript = `(() => { let a = ${SEED} >>> 0; Math.random = function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;
const serve = (dir) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const f = path.join(dir, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
    try { const b = fs.readFileSync(f); r.setHeader("content-type", f.endsWith(".html") ? "text/html" : f.endsWith(".css") ? "text/css" : "text/javascript"); r.end(b); } catch { r.statusCode = 404; r.end(); }
  }).listen(0, () => res(s));
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rea-2048-"));
const sOrig = await serve(path.join(root, "originals/2048/page"));
const sPort = await serve(path.join(root, "games/2048/ports/web"));
const browser = await chromium.launch();
const mk = async (s, w, h) => { const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); await p.addInitScript(seedScript); await p.goto(`http://localhost:${s.address().port}/`); return p; };
const left = await mk(sOrig, 540, 700), right = await mk(sPort, 540, 700);
await left.addStyleTag({ content: "body{margin:0 auto;padding:0 20px}.heading{margin-bottom:10px}.above-game,.game-explanation,hr,.container>p{display:none!important}" });
await right.addStyleTag({ content: "main>p,#restart{display:none}" });
await left.waitForTimeout(300); await right.waitForTimeout(300);

const origGrid = () => left.evaluate(() => {
  const g = Array.from({ length: 4 }, () => Array(4).fill(0));
  document.querySelectorAll(".tile-container .tile").forEach((t) => {
    const m = t.className.match(/tile-position-(\d)-(\d)/), v = t.className.match(/tile-(\d+)\b/);
    if (m && v && !t.className.includes("tile-merged") === !t.className.includes("tile-merged")) g[m[1] - 1][m[2] - 1] = Math.max(g[m[1] - 1][m[2] - 1], Number(v[1]));
  });
  return g;
});
const key = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"];
let identical = 0;
const labels = [];
async function frame(i, move) {
  await left.waitForTimeout(140);
  const og = await origGrid(); const pg = (await right.evaluate(() => window.__game.snapshot().grid));
  const same = JSON.stringify(og) === JSON.stringify(pg);
  if (same) identical++;
  await left.screenshot({ path: path.join(tmp, `l${String(i).padStart(4, "0")}.png`), clip: { x: 0, y: 0, width: 540, height: 640 } });
  await right.screenshot({ path: path.join(tmp, `r${String(i).padStart(4, "0")}.png`), clip: { x: 0, y: 0, width: 540, height: 640 } });
  labels.push({ i, same, move });
}
await frame(0, null);
for (let i = 0; i < moves.length; i++) {
  await left.keyboard.press(key[moves[i]]);
  await right.keyboard.press(key[moves[i]]);
  await frame(i + 1, moves[i]);
}
await browser.close(); sOrig.close(); sPort.close();
fs.writeFileSync(path.join(tmp, "labels.json"), JSON.stringify(labels));
console.log(`moves ${moves.length}, boards identical in ${identical}/${labels.length} frames`);
if (identical !== labels.length) { console.error("original and rebuild differ: not rendering"); process.exit(1); }
execFileSync("python3", [path.join(root, "scripts/compose.py"), tmp, out, "Original 2048 (MIT)", "Rebuild, checked by rea-game", "move"], { stdio: "inherit" });
console.log("wrote", out);
