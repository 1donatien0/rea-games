// Renders the hero GIF for Chrome Dino: the ORIGINAL (originals/dino, driven by games/dino/driver.mjs) next to the
// rebuild (games/dino/ports/web/index.html in the same Chromium), same recorded inputs, same recorded random numbers.
// Usage: node scripts/demo-dino.mjs [out.gif] [case] [every-Nth-step]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openOriginal } from "../games/dino/driver.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "docs/assets/dino.gif");
const name = process.argv[3] ?? "bot-late-jumper";
const EVERY = Number(process.argv[4] ?? 15);
const c = JSON.parse(fs.readFileSync(path.join(root, "games/dino/cases", name + ".json"), "utf8"));

const serve = (dir) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const f = path.join(dir, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
    try { r.setHeader("content-type", f.endsWith(".html") ? "text/html" : "text/javascript"); r.end(fs.readFileSync(f)); } catch { r.statusCode = 404; r.end(); }
  }).listen(0, () => res(s));
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rea-dino-"));
const orig = await openOriginal({ seed: c.seed });
const sPort = await serve(path.join(root, "games/dino/ports/web"));
const browser = await chromium.launch();
// 644 px wide so the port's canvas is exactly 600 px, like the original's
const right = await browser.newPage({ viewport: { width: 644, height: 300 }, deviceScaleFactor: 1 });
await right.addInitScript((tape) => { window.__tape = tape; }, c.tape);
await right.clock.install({ time: 0 }); // fake time for the page: its own frame loop only moves when the clock is run
await right.goto(`http://localhost:${sPort.address().port}/`);
await right.waitForFunction(() => window.__rea);
await right.addStyleTag({ content: "body{background:#fff!important}main>header,p.keys{display:none}#stage{box-shadow:none;padding:0}" });
// the original zooms its container to the window width once it runs (arcade mode); keep it at its own 600x150 so every frame has one size
await orig.page.addStyleTag({ content: ".runner-container{transform:none!important;transition:none!important}" });
const origCanvas = orig.page.locator("canvas.runner-canvas");
const portCanvas = right.locator("#c");

const press = async (i) => {
  if (i.jump) await right.keyboard.down("Space");
  if (i.duck) await right.keyboard.down("ArrowDown");
  if (i.jumpUp) await right.keyboard.up("Space");
  if (i.duckUp) await right.keyboard.up("ArrowDown");
  if (i.enter) await right.keyboard.up("Enter");
};
// what a viewer can compare: obstacles (type, x, y), the dino's y, crash flag, score
const view = (s) => JSON.stringify([s.obstacles.map((o) => [o.type, o.xPos, o.yPos]), s.tRex.yPos, s.crashed, s.score]);

const labels = [];
let shown = 0, shownSame = 0, stepsSame = 0, fullSame = 0, windowOk = true, k = 0;
const shoot = async (idx, s, same) => {
  const n = String(k).padStart(4, "0");
  await origCanvas.screenshot({ path: path.join(tmp, `l${n}.png`) });
  await portCanvas.screenshot({ path: path.join(tmp, `r${n}.png`) });
  labels.push({ i: k++, same, move: idx, extra: `step ${idx} of ${c.inputs.length}  ·  score ${s.score}  ·  ${s.obstacles.length} obstacle(s)  ·  compared: obstacle x/y, dino y, crash, score` });
  shown++; if (same) shownSame++;
};
await shoot(0, await orig.initial(), true);
const first = await right.evaluate(() => window.__rea.snapshot());
if (view(first) !== view(await orig.initial())) labels[0].same = false;
for (let n = 0; n < c.inputs.length; n++) {
  const inp = c.inputs[n];
  const { state } = await orig.step(inp);
  await press(inp);
  await right.clock.runFor(Math.max(1, Math.round(inp.dt)));
  const ps = await right.evaluate((dt) => window.__rea.step(dt), inp.dt);
  const ok = view(state) === view(ps);
  if (ok) stepsSame++; else windowOk = false;
  if (JSON.stringify(state) === JSON.stringify(ps)) fullSame++;
  if ((n + 1) % EVERY === 0 || n === c.inputs.length - 1) { await shoot(n + 1, state, windowOk); windowOk = true; }
}
const tapeOrig = await orig.tape();
const tapeUsed = await right.evaluate(() => window.__rea.tapeUsed());
await browser.close(); sPort.close(); await orig.close();
fs.writeFileSync(path.join(tmp, "labels.json"), JSON.stringify(labels));
console.log(`case ${name}: ${c.inputs.length} steps, ${shown} frames shown (every ${EVERY}th)`);
console.log(`shown frames identical ${shownSame}/${shown}; every step identical on the compared view ${stepsSame}/${c.inputs.length}; whole snapshot equal ${fullSame}/${c.inputs.length}`);
console.log(`tape: original drew ${tapeOrig.length}, recording ${c.tape.length}, port used ${tapeUsed}`);
if (orig.errors.length) console.log("page errors:", orig.errors);
execFileSync("python3", [path.join(root, "scripts/compose.py"), tmp, out, "Original Chrome Dino (BSD-3)", "Rebuild, checked by rea-game", "frame"], { stdio: "inherit", env: { ...process.env, FPS: process.env.FPS ?? "12" } });
console.log("wrote", out);
