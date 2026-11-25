// Turns each game's playable port into ONE html file (docs/play/<game>.html) that works from file:// and GitHub Pages.
// Module imports are inlined, `export` is dropped. Only relative "./x.mjs" imports are supported.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listGames, loadGame } from "../lib/verify.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const seen = new Set();
function inline(dir, file) {
  const full = path.join(dir, file);
  if (seen.has(full)) return "";
  seen.add(full);
  let src = fs.readFileSync(full, "utf8");
  let pre = "";
  src = src.replace(/^import\s+[^;]*?from\s+["'](\.\/[^"']+)["'];?\s*$/gm, (_, rel) => { pre += inline(path.dirname(full), rel); return ""; });
  return pre + src.replace(/^export\s+(default\s+)?/gm, "") + "\n";
}
fs.mkdirSync(path.join(root, "docs/play"), { recursive: true });
for (const g of listGames(root)) {
  const { dir, meta } = loadGame(root, g);
  const play = Object.values(meta.ports).find((p) => p.play)?.play;
  if (!play) continue;
  const htmlPath = path.join(dir, play);
  const html = fs.readFileSync(htmlPath, "utf8");
  const out = html.replace(/<script type="module">([\s\S]*?)<\/script>/, (_, body) => {
    let pre = "";
    const rest = body.replace(/^import\s+[^;]*?from\s+["'](\.\/[^"']+)["'];?\s*$/gm, (__, rel) => { pre += inline(path.dirname(htmlPath), rel); return ""; });
    return `<script>\n(() => {\n${pre}${rest}\n})();\n</script>`;
  });
  fs.writeFileSync(path.join(root, "docs/play", `${g}.html`), out);
  console.log("wrote docs/play/" + g + ".html", out.length, "bytes");
  seen.clear();
}
