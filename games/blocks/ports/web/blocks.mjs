// Blocks: the rules of the falling-blocks puzzle, as pure logic. No DOM, no clock, no Math.random:
// the caller hands in `rng` (a function returning [0,1)) and calls step({dt, keys}) once per frame.
// Written from games/blocks/GAME.md (what the original does, observed and read), not copied.

export const W = 10, H = 20;
export const KINDS = "ijlostz";
// four rotations of a 4x4 mask each, bit 0x8000 is the top-left cell, rows run left to right
export const SHAPES = {
  i: { size: 4, masks: [0x0f00, 0x2222, 0x00f0, 0x4444] },
  j: { size: 3, masks: [0x44c0, 0x8e00, 0x6440, 0x0e20] },
  l: { size: 3, masks: [0x4460, 0x0e80, 0xc440, 0x2e00] },
  o: { size: 2, masks: [0xcc00, 0xcc00, 0xcc00, 0xcc00] },
  s: { size: 3, masks: [0x06c0, 0x8c40, 0x6c00, 0x4620] },
  t: { size: 3, masks: [0x0e40, 0x4c40, 0x4e00, 0x4640] },
  z: { size: 3, masks: [0x0c60, 0x4c80, 0xc600, 0x2640] },
};
export const START_STEP = 0.6, STEP_DECREMENT = 0.005, MIN_STEP = 0.1; // seconds per row of gravity
export const T0 = 1000000; // the recording's clock starts here (ms)

// the cells (column, row) a piece covers
export function cellsOf(kind, x, y, dir) {
  const out = [];
  const mask = SHAPES[kind].masks[dir];
  for (let i = 0; i < 16; i++) if (mask & (0x8000 >> i)) out.push([x + (i & 3), y + (i >> 2)]);
  return out;
}

export class Blocks {
  constructor({ rng, clock0 = T0 }) {
    this.rng = rng;
    this.t = clock0;              // the page's clock, ms; frames add dt to it and read the whole milliseconds
    this.last = Math.floor(clock0);
    this.bag = [];                // piece letters still in the bag, in splice order
    this.cur = null;
    this.nxt = null;
    this.reset();                 // the page resets once while it loads
  }

  // ---- pieces
  newPiece() {
    if (this.bag.length === 0) for (const k of KINDS) for (let n = 0; n < 4; n++) this.bag.push(k);
    // the original asks for a float in [0, len-1) and splice truncates it: the bag's last piece is never
    // the one taken until it is the only one left
    const kind = this.bag.splice(Math.floor(this.rng() * (this.bag.length - 1)), 1)[0];
    const x = Math.round(this.rng() * (W - SHAPES[kind].size));
    return { type: kind, x, y: 0, dir: 0 };
  }

  blocked(kind, x, y, dir) {
    for (const [cx, cy] of cellsOf(kind, x, y, dir)) {
      if (cx < 0 || cx >= W || cy < 0 || cy >= H || this.grid[cy][cx]) return true;
    }
    return false;
  }

  // ---- game state changes
  reset() {
    this.dtAcc = 0;
    this.actions = [];
    this.grid = Array.from({ length: H }, () => Array(W).fill(null));
    this.setRows(0);
    this.score = 0;
    this.vscore = 0;
    this.cur = this.nxt || this.newPiece();
    this.nxt = this.newPiece();
  }
  setRows(n) {
    this.rows = n;
    this.stepSec = Math.max(MIN_STEP, START_STEP - STEP_DECREMENT * n);
  }
  play() { this.reset(); this.playing = true; }
  lose() { this.vscore = this.score; this.playing = false; }

  move(dx, dy) {
    const c = this.cur;
    if (this.blocked(c.type, c.x + dx, c.y + dy, c.dir)) return false;
    c.x += dx; c.y += dy;
    return true;
  }
  rotate() {
    const c = this.cur;
    const d = (c.dir + 1) & 3;
    if (!this.blocked(c.type, c.x, c.y, d)) c.dir = d; // no kicks: a blocked turn is dropped
  }

  // gravity step and the soft-drop key: one row down, or lock the piece
  drop() {
    if (this.move(0, 1)) return;
    const c = this.cur;
    this.score += 10;
    for (const [cx, cy] of cellsOf(c.type, c.x, c.y, c.dir)) this.grid[cy][cx] = c.type;
    this.removeLines();
    this.cur = this.nxt;
    this.nxt = this.newPiece();
    this.actions = [];
    if (this.blocked(this.cur.type, this.cur.x, this.cur.y, this.cur.dir)) this.lose();
  }

  removeLines() {
    let n = 0;
    // rows 19..1 are checked; row 0 is never looked at (a full top row would stay)
    for (let y = H - 1; y > 0; y--) {
      if (this.grid[y].every((c) => c)) {
        for (let r = y; r > 0; r--) this.grid[r] = this.grid[r - 1].slice();
        this.grid[0] = Array(W).fill(null);
        y++; // look at the same row again
        n++;
      }
    }
    if (n > 0) {
      this.setRows(this.rows + n);
      this.score += 100 * 2 ** (n - 1);
    }
  }

  // ---- one rendered frame
  key(name) {
    if (this.playing) {
      if (name === "left") this.actions.push("left");
      else if (name === "right") this.actions.push("right");
      else if (name === "up") this.actions.push("up");
      else if (name === "down") this.actions.push("down");
      else if (name === "esc") this.lose();
      // "play" is the start link; it works in any state (the page hides it while playing)
      else if (name === "play") this.play();
    } else if (name === "space" || name === "play") this.play();
  }

  step({ dt, keys = [] }) {
    for (const k of keys) this.key(k);
    this.t += dt;
    const now = Math.floor(this.t);
    const idt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    if (!this.playing) return;
    if (this.vscore < this.score) this.vscore += 1;
    const a = this.actions.shift();
    if (a === "left") this.move(-1, 0);
    else if (a === "right") this.move(1, 0);
    else if (a === "up") this.rotate();
    else if (a === "down") this.drop();
    this.dtAcc += idt;
    // the piece may have been replaced (or the game lost) by the action above; gravity still runs
    if (this.dtAcc > this.stepSec) {
      this.dtAcc -= this.stepSec;
      this.drop();
    }
  }

  snapshot() {
    const DIRS = { up: 0, right: 1, down: 2, left: 3 };
    const p = (c) => ({ type: c.type, x: c.x, y: c.y, dir: c.dir });
    return {
      grid: this.grid.map((r) => r.map((c) => c || ".").join("")),
      current: p(this.cur),
      next: p(this.nxt),
      bag: this.bag.join(""),
      score: this.score, vscore: this.vscore, rows: this.rows, step: this.stepSec, dt: this.dtAcc,
      playing: !!this.playing,
      actions: this.actions.map((a) => DIRS[a]),
    };
  }
}
