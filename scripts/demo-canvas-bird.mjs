// Renders the hero GIF for Canvas Bird: the ORIGINAL (originals/canvas-bird, driven by games/canvas-bird/driver.mjs)
// next to the rebuild (games/canvas-bird/ports/web/index.html in the same Chromium), same recorded clicks, dt and
// random numbers. Usage: node scripts/demo-canvas-bird.mjs [out.gif] [case] [every-Nth-step] [steps]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openOriginal } from "../games/canvas-bird/driver.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "docs/assets/canvas-bird.gif");
const name = process.argv[3] ?? "bot-aims-low";
const EVERY = Number(process.argv[4] ?? 12);
const c = JSON.parse(fs.readFileSync(path.join(root, "games/canvas-bird/cases", name + ".json"), "utf8"));
const STEPS = Math.min(c.inputs.length, Number(process.argv[5] ?? 1140));

const serve = (dir) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const f = path.join(dir, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
    try { r.setHeader("content-type", f.endsWith(".html") ? "text/html" : "text/javascript"); r.end(fs.readFileSync(f)); } catch { r.statusCode = 404; r.end(); }
  }).listen(0, () => res(s));
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rea-bird-"));
const orig = await openOriginal({ seed: c.seed });
const sPort = await serve(path.join(root, "games/canvas-bird/ports/web"));
const browser = await chromium.launch();
const right = await browser.newPage({ viewport: { width: 672, height: 540 }, deviceScaleFactor: 1 }); // canvas 640x480
await right.addInitScript((tape) => { window.__tape = tape; }, c.tape);
await right.clock.install({ time: 0 }); // fake time for the page; its own frame loop only draws
await right.goto(`http://localhost:${sPort.address().port}/`);
await right.waitForFunction(() => window.__rea);
await right.addStyleTag({ content: "p{display:none}body{padding:0;justify-content:flex-start}#wrap{border-radius:0;box-shadow:none;width:640px}" });
const origCanvas = orig.page.locator("#canvas");
const portCanvas = right.locator("#c");

// what a viewer sees: the whole draw list of the frame (every image, sprite, text and sound call, exact numbers)
const info = (f) => {
  const score = f.filter((s) => s.startsWith("t:fill") && s.endsWith(":white")).map((s) => s.split(":")[2])[0];
  const bird = f.find((s) => s.startsWith("s:player:"));
  const pipes = f.filter((s) => s.startsWith("i:enemy_up:")).length;
  return { score: score ?? "-", y: bird ? Number(bird.split(":")[7]) : null, pipes };
};
const labels = [];
let stepsSame = 0, shownSame = 0, windowOk = true, k = 0;
for (let n = 0; n < STEPS; n++) {
  const inp = c.inputs[n];
  const fo = await orig.step(inp);
  if (inp.click) await right.keyboard.press("Space");
  await right.clock.runFor(Math.max(1, Math.round(inp.dt)));
  const fp = await right.evaluate((dt) => window.__rea.step(dt), inp.dt);
  const ok = JSON.stringify(fo) === JSON.stringify(fp);
  if (ok) stepsSame++; else windowOk = false;
  if ((n + 1) % EVERY === 0 || n === STEPS - 1) {
    const f = String(k).padStart(4, "0");
    await origCanvas.screenshot({ path: path.join(tmp, `l${f}.png`) });
    await portCanvas.screenshot({ path: path.join(tmp, `r${f}.png`) });
    const o = info(fo);
    labels.push({ i: k++, same: windowOk, move: n + 1, extra: `step ${n + 1} of ${STEPS}  ·  score ${o.score}  ·  bird y ${o.y === null ? "-" : o.y.toFixed(1)}  ·  compared: every draw call of the frame (${fo.length} calls)` });
    if (windowOk) shownSame++;
    windowOk = true;
  }
}
const tapeOrig = await orig.tape();
const tapeUsed = await right.evaluate(() => window.__rea.tapeUsed());
await browser.close(); sPort.close(); await orig.close();
fs.writeFileSync(path.join(tmp, "labels.json"), JSON.stringify(labels));
console.log(`case ${name}: ${STEPS} steps, ${labels.length} frames shown (every ${EVERY}th)`);
console.log(`shown frames identical ${shownSame}/${labels.length}; every step's draw list identical ${stepsSame}/${STEPS}`);
console.log(`tape: original drew ${tapeOrig.length} (first ${tapeUsed} are the ones the port used, recording has ${c.tape.length})`);
execFileSync("python3", [path.join(root, "scripts/compose.py"), tmp, out, "Original Canvas Bird (MIT)", "Rebuild, checked by rea-games", "frame"], { stdio: "inherit", env: { ...process.env, FPS: process.env.FPS ?? "12", WIDTH: process.env.WIDTH ?? "760" } });
console.log("wrote", out);
