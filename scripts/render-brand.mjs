// Renders docs/assets/logo.png (512), the social preview (1280x640) and a preview of both wordmarks.
import fs from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const read = (f) => fs.readFileSync(f, "utf8");
const b = await chromium.launch();
let p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent(`<body style="margin:0;background:transparent">${read("docs/assets/logo.svg").replace("<svg", '<svg width="512" height="512"')}</body>`);
await p.screenshot({ path: "docs/assets/logo.png", omitBackground: true });
p = await b.newPage({ viewport: { width: 1280, height: 640 } });
await p.setContent(`<body style="margin:0;width:1280px;height:640px;background:#14161c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;color:#F6EBDD">
${read("docs/brand/logo-dark.svg").replace("<svg", '<svg width="860"')}
<div style="font-size:40px;margin-top:18px;max-width:900px;text-align:center;line-height:1.3">Reverse-engineer any game, rebuild it in any engine, and prove it plays the same.</div>
<div style="font-size:28px;margin-top:22px;color:#E2560F;font-weight:700">2048 · Chrome Dino · Canvas Bird · web · Rust · Godot</div></body>`);
await p.screenshot({ path: "docs/assets/social-preview.png" });
p = await b.newPage({ viewport: { width: 900, height: 600 } });
await p.setContent(`<body style="margin:0"><div style="background:#14161c;padding:10px 20px">${read("docs/brand/logo-dark.svg").replace("<svg", '<svg width="860"')}</div><div style="background:#fff;padding:10px 20px">${read("docs/brand/logo-light.svg").replace("<svg", '<svg width="860"')}</div></body>`);
await p.screenshot({ path: process.argv[2] ?? "/tmp/brand-preview.png" });
await b.close();
