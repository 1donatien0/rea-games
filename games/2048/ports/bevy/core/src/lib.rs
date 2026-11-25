//! 2048 rules. The random numbers come from a closure: the runner feeds the recorded tape,
//! the game feeds a live generator.

pub const SIZE: usize = 4;
const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// A saved game, as the original's `serialize` gives it.
pub struct Saved {
    pub cells: [[u32; SIZE]; SIZE], // cells[x][y]
    pub score: u64,
    pub over: bool,
    pub won: bool,
    pub kept: bool,
}

pub struct Game {
    pub cells: [[u32; SIZE]; SIZE], // cells[x][y]
    pub score: u64,
    pub best: u64,
    pub over: bool,
    pub won: bool,
    pub kept: bool,
    rng: Box<dyn FnMut() -> f64>,
    used: usize,
}

impl Game {
    /// A new game (two tiles drawn) or, with `saved`, one restored from a saved state.
    pub fn new(rng: Box<dyn FnMut() -> f64>, saved: Option<Saved>) -> Self {
        let mut g = Game {
            cells: [[0; SIZE]; SIZE],
            score: 0,
            best: 0,
            over: false,
            won: false,
            kept: false,
            rng,
            used: 0,
        };
        g.load(saved);
        g
    }

    /// How many random numbers have been drawn.
    pub fn used(&self) -> usize {
        self.used
    }

    fn rng(&mut self) -> f64 {
        self.used += 1;
        (self.rng)()
    }

    /// Start over (None) or restore a saved state; `best` is kept.
    pub fn load(&mut self, saved: Option<Saved>) {
        self.cells = [[0; SIZE]; SIZE];
        if let Some(s) = saved {
            self.cells = s.cells;
            self.score = s.score;
            self.over = s.over;
            self.won = s.won;
            self.kept = s.kept;
        } else {
            self.score = 0;
            self.over = false;
            self.won = false;
            self.kept = false;
            self.add_tile();
            self.add_tile();
        }
        self.best = self.best.max(self.score);
    }

    pub fn restart(&mut self) {
        self.load(None);
    }

    pub fn keep_playing(&mut self) {
        self.kept = true;
    }

    pub fn terminated(&self) -> bool {
        self.over || (self.won && !self.kept)
    }

    fn add_tile(&mut self) {
        let free: Vec<(usize, usize)> = (0..SIZE)
            .flat_map(|x| (0..SIZE).map(move |y| (x, y)))
            .filter(|&(x, y)| self.cells[x][y] == 0)
            .collect();
        if free.is_empty() {
            return;
        }
        let value = if self.rng() < 0.9 { 2 } else { 4 }; // the value is drawn before the place
        let (x, y) = free[(self.rng() * free.len() as f64).floor() as usize];
        self.cells[x][y] = value;
    }

    fn slide(&mut self, line: [u32; SIZE]) -> ([u32; SIZE], u64) {
        let tiles: Vec<u32> = line.iter().copied().filter(|&v| v != 0).collect();
        let mut out = [0u32; SIZE];
        let (mut n, mut gained, mut i) = (0, 0u64, 0);
        while i < tiles.len() {
            if i + 1 < tiles.len() && tiles[i] == tiles[i + 1] {
                out[n] = tiles[i] * 2;
                gained += out[n] as u64;
                if out[n] == 2048 {
                    self.won = true;
                }
                i += 2;
            } else {
                out[n] = tiles[i];
                i += 1;
            }
            n += 1;
        }
        (out, gained)
    }

    /// Move in direction 0 up, 1 right, 2 down, 3 left.
    pub fn mv(&mut self, dir: usize) {
        if self.terminated() {
            return;
        }
        let (dx, dy) = DIRS[dir];
        let mut moved = false;
        for k in 0..SIZE {
            let coords: Vec<(usize, usize)> = (0..SIZE)
                .map(|i| {
                    let j = if dx + dy > 0 { SIZE - 1 - i } else { i };
                    if dx != 0 {
                        (j, k)
                    } else {
                        (k, j)
                    }
                })
                .collect();
            let mut line = [0u32; SIZE];
            for (i, &(x, y)) in coords.iter().enumerate() {
                line[i] = self.cells[x][y];
            }
            let (out, gained) = self.slide(line);
            for (i, &(x, y)) in coords.iter().enumerate() {
                if self.cells[x][y] != out[i] {
                    moved = true;
                }
                self.cells[x][y] = out[i];
            }
            self.score += gained;
        }
        if !moved {
            return;
        }
        self.add_tile();
        if !self.has_moves() {
            self.over = true;
        }
        self.best = self.best.max(self.score);
    }

    pub fn has_moves(&self) -> bool {
        for x in 0..SIZE {
            for y in 0..SIZE {
                let v = self.cells[x][y];
                if v == 0
                    || (x + 1 < SIZE && self.cells[x + 1][y] == v)
                    || (y + 1 < SIZE && self.cells[x][y + 1] == v)
                {
                    return true;
                }
            }
        }
        false
    }
}
