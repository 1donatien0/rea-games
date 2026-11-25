// Renders the hero GIF for Blocks: the ORIGINAL (originals/blocks, driven by games/blocks/driver.mjs) next to the
// rebuild (games/blocks/ports/web/index.html in the same Chromium), same recorded keys, dt and random numbers.
// Usage: node scripts/demo-blocks.mjs [out.gif] [case] [every-Nth-step] [steps]
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openOriginal } from "../games/blocks/driver.mjs";

const require = createRequire(import.meta.url);
const pw = (() => { for (const t of ["playwright", process.env.PLAYWRIGHT_PATH, "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean)) { try { return require(t); } catch {} } throw new Error("playwright not found"); })();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "docs/assets/blocks.gif");
const name = process.argv[3] ?? "bot-quads-33ms";
const EVERY = Number(process.argv[4] ?? 5);
// cases are stored gzipped; read in memory, nothing is written to games/blocks/cases
const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "games/blocks/cases", name + ".json.gz"))).toString("utf8"));
const STEPS = Math.min(c.inputs.length, Number(process.argv[5] ?? 760));

const serve = (dir) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const f = path.join(dir, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
    try { r.setHeader("content-type", f.endsWith(".html") ? "text/html" : "text/javascript"); r.end(fs.readFileSync(f)); } catch { r.statusCode = 404; r.end(); }
  }).listen(0, () => res(s));
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rea-blocks-"));
const orig = await openOriginal({ seed: c.seed });
const sPort = await serve(path.join(root, "games/blocks/ports/web"));
const browser = await pw.chromium.launch();
const right = await browser.newPage({ viewport: { width: 520, height: 720 }, deviceScaleFactor: 1 });
await right.addInitScript((tape) => { window.__tape = tape; }, c.tape); // the recorded random numbers
await right.goto(`http://localhost:${sPort.address().port}/`);
await right.waitForFunction(() => window.__rea);
await right.addStyleTag({ content: "header,p.keys{display:none}main{width:420px}" });
const box = await orig.page.locator("#tetris").boundingBox(); // a clip, not an element screenshot: that one made the page resize and blank its canvas
const portShot = right.locator("#stage");

// the page state: grid, current piece, next piece, bag, score, rows, step, gravity accumulator, queue
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const labels = [];
let stepsSame = 0, shownSame = 0, windowOk = true, k = 0, maxClear = 0, prevRows = 0;
if (!same(orig.initial, await right.evaluate(() => window.__rea.snapshot()))) windowOk = false;
for (let n = 0; n < STEPS; n++) {
  const inp = c.inputs[n];
  const fo = await orig.step(inp);
  const fp = await right.evaluate(([dt, keys]) => window.__rea.step(dt, keys), [inp.dt, inp.keys ?? []]);
  if (same(fo, fp)) stepsSame++; else windowOk = false;
  maxClear = Math.max(maxClear, fo.rows - prevRows); prevRows = fo.rows;
  if ((n + 1) % EVERY === 0 || n === STEPS - 1) {
    const f = String(k).padStart(4, "0");
    await orig.page.screenshot({ path: path.join(tmp, `l${f}.png`), clip: box });
    await portShot.screenshot({ path: path.join(tmp, `r${f}.png`) });
    labels.push({ i: k++, same: windowOk, move: n + 1, extra: `step ${n + 1} of ${STEPS}  ·  score ${fo.score} (shown ${fo.vscore})  ·  rows ${fo.rows}  ·  compared: grid, piece, next, bag, score, rows, gravity timer, key queue` });
    if (windowOk) shownSame++;
    windowOk = true;
  }
}
const tapeOrig = await orig.tape();
const tapeUsed = await right.evaluate(() => window.__rea.tapeUsed());
await browser.close(); sPort.close(); await orig.close();
fs.writeFileSync(path.join(tmp, "labels.json"), JSON.stringify(labels));
console.log(`case ${name}: ${STEPS} steps, ${labels.length} frames shown (every ${EVERY}th), biggest clear in one step: ${maxClear} rows`);
console.log(`shown frames identical ${shownSame}/${labels.length}; every step's full state identical ${stepsSame}/${STEPS}`);
console.log(`tape: original drew ${tapeOrig.length}, port used ${tapeUsed}, recording has ${c.tape.length}`);
execFileSync("python3", [path.join(root, "scripts/compose.py"), tmp, out, "Original Blocks (MIT)", "Rebuild, checked by rea-games", "frame"], { stdio: "inherit", env: { ...process.env, FPS: process.env.FPS ?? "14", WIDTH: process.env.WIDTH ?? "760" } });
console.log("wrote", out);
