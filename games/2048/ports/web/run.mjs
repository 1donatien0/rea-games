// Runner protocol: a case on stdin, the port's trace on stdout.
import { Game2048 } from "./game2048.mjs";

const c = JSON.parse(await new Promise((r) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => r(s)); }));
let used = 0;
const rng = () => { if (used >= c.tape.length) throw new Error("port asked for more random numbers than the original used"); return c.tape[used++]; };
const g = new Game2048({ rng, initial: c.initial });
const trace = [g.snapshot()];
for (const i of c.inputs) {
  if (i.t === "move") g.move(i.d);
  else if (i.t === "restart") g.restart();
  else if (i.t === "keep") g.keepPlaying();
  trace.push(g.snapshot());
}
process.stdout.write(JSON.stringify({ trace, tapeUsed: used }));
