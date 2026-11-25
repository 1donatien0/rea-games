// 2048, written from games/2048/GAME.md. Cells are stored as cells[x][y] (column first),
// the same layout the recording uses, so snapshots compare directly.
export const SIZE = 4;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left as (dx, dy)

export class Game2048 {
  constructor({ rng = Math.random, initial = null } = {}) {
    this.rng = rng;
    this.best = 0;
    this.load(initial);
  }

  load(saved) {
    if (saved) {
      this.cells = saved.grid.cells.map((col) => col.map((t) => (t ? t.value : 0)));
      ({ score: this.score, over: this.over, won: this.won, keepPlaying: this.kept } = saved);
    } else {
      this.cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
      this.score = 0;
      this.over = this.won = this.kept = false;
      this.addTile();
      this.addTile();
    }
    this.best = Math.max(this.best, this.score);
  }

  get terminated() { return this.over || (this.won && !this.kept); }

  restart() { this.load(null); }
  keepPlaying() { this.kept = true; }

  empty() {
    const out = [];
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) if (!this.cells[x][y]) out.push([x, y]);
    return out;
  }

  addTile() {
    const free = this.empty();
    if (!free.length) return;
    const value = this.rng() < 0.9 ? 2 : 4; // the value is drawn before the place
    const [x, y] = free[Math.floor(this.rng() * free.length)];
    this.cells[x][y] = value;
  }

  // Slide one line toward its start. A tile merges at most once per move, and the pair
  // nearest the wall merges first.
  slide(line) {
    const tiles = line.filter(Boolean);
    const out = [];
    let gained = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === tiles[i + 1]) {
        out.push(tiles[i] * 2);
        gained += tiles[i] * 2;
        if (tiles[i] * 2 === 2048) this.won = true;
        i++;
      } else out.push(tiles[i]);
    }
    while (out.length < SIZE) out.push(0);
    return { out, gained };
  }

  move(dir) {
    if (this.terminated) return false;
    const [dx, dy] = DIRS[dir];
    let moved = false;
    for (let k = 0; k < SIZE; k++) {
      // the k-th line, listed from the wall the tiles move toward
      const coords = [];
      for (let i = 0; i < SIZE; i++) {
        const j = dx + dy > 0 ? SIZE - 1 - i : i; // moving right or down: the wall is at the end
        coords.push(dx !== 0 ? [j, k] : [k, j]);
      }
      const { out, gained } = this.slide(coords.map(([x, y]) => this.cells[x][y]));
      coords.forEach(([x, y], i) => {
        if (this.cells[x][y] !== out[i]) moved = true;
        this.cells[x][y] = out[i];
      });
      this.score += gained;
    }
    if (!moved) return false;
    this.addTile();
    if (!this.hasMoves()) this.over = true;
    this.best = Math.max(this.best, this.score);
    return true;
  }

  hasMoves() {
    if (this.empty().length) return true;
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
      const v = this.cells[x][y];
      if ((x + 1 < SIZE && this.cells[x + 1][y] === v) || (y + 1 < SIZE && this.cells[x][y + 1] === v)) return true;
    }
    return false;
  }

  snapshot() {
    return {
      grid: this.cells.map((c) => c.slice()),
      score: this.score, over: this.over, won: this.won, terminated: this.terminated, best: this.best,
    };
  }
}
