// Replays one recorded case: reads it from stdin, prints { trace, tapeUsed } on stdout.
import fs from "node:fs";
import { createBird } from "./bird.mjs";

const c = JSON.parse(fs.readFileSync(0, "utf8"));
let used = 0;
const rng = () => {
  if (used >= c.tape.length) throw new Error(`asked for random number ${used + 1}, the recording has ${c.tape.length}`);
  return c.tape[used++];
};
const g = createBird({ rng });
const trace = [g.load()];
for (const i of c.inputs) trace.push(g.step(i));
process.stdout.write(JSON.stringify({ trace, tapeUsed: used }));
