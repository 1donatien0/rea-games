//! Runner protocol: a case on stdin, the port's trace on stdout.
use serde_json::{json, Value};
use std::io::Read;

const SIZE: usize = 4;
const DIRS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

struct Game<'a> {
    cells: [[u32; SIZE]; SIZE], // cells[x][y]
    score: u64,
    best: u64,
    over: bool,
    won: bool,
    kept: bool,
    tape: &'a [f64],
    used: usize,
}

impl<'a> Game<'a> {
    fn new(tape: &'a [f64], initial: &Value) -> Self {
        let mut g = Game { cells: [[0; SIZE]; SIZE], score: 0, best: 0, over: false, won: false, kept: false, tape, used: 0 };
        g.load(initial);
        g
    }

    fn rng(&mut self) -> f64 {
        let v = self.tape[self.used];
        self.used += 1;
        v
    }

    fn load(&mut self, saved: &Value) {
        self.cells = [[0; SIZE]; SIZE];
        if saved.is_object() {
            for (x, col) in saved["grid"]["cells"].as_array().unwrap().iter().enumerate() {
                for (y, t) in col.as_array().unwrap().iter().enumerate() {
                    self.cells[x][y] = t["value"].as_u64().unwrap_or(0) as u32;
                }
            }
            self.score = saved["score"].as_u64().unwrap();
            self.over = saved["over"].as_bool().unwrap();
            self.won = saved["won"].as_bool().unwrap();
            self.kept = saved["keepPlaying"].as_bool().unwrap();
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

    fn terminated(&self) -> bool {
        self.over || (self.won && !self.kept)
    }

    fn add_tile(&mut self) {
        let free: Vec<(usize, usize)> = (0..SIZE).flat_map(|x| (0..SIZE).map(move |y| (x, y))).filter(|&(x, y)| self.cells[x][y] == 0).collect();
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

    fn mv(&mut self, dir: usize) {
        if self.terminated() {
            return;
        }
        let (dx, dy) = DIRS[dir];
        let mut moved = false;
        for k in 0..SIZE {
            let coords: Vec<(usize, usize)> = (0..SIZE)
                .map(|i| {
                    let j = if dx + dy > 0 { SIZE - 1 - i } else { i };
                    if dx != 0 { (j, k) } else { (k, j) }
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

    fn has_moves(&self) -> bool {
        for x in 0..SIZE {
            for y in 0..SIZE {
                let v = self.cells[x][y];
                if v == 0 || (x + 1 < SIZE && self.cells[x + 1][y] == v) || (y + 1 < SIZE && self.cells[x][y + 1] == v) {
                    return true;
                }
            }
        }
        false
    }

    fn snapshot(&self) -> Value {
        json!({ "grid": self.cells, "score": self.score, "over": self.over, "won": self.won, "terminated": self.terminated(), "best": self.best })
    }
}

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let c: Value = serde_json::from_str(&s).unwrap();
    let tape: Vec<f64> = c["tape"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let mut g = Game::new(&tape, &c["initial"]);
    let mut trace = vec![g.snapshot()];
    for i in c["inputs"].as_array().unwrap() {
        match i["t"].as_str().unwrap() {
            "move" => g.mv(i["d"].as_u64().unwrap() as usize),
            "restart" => g.load(&Value::Null),
            "keep" => g.kept = true,
            other => panic!("unknown input {other}"),
        }
        trace.push(g.snapshot());
    }
    println!("{}", json!({ "trace": trace, "tapeUsed": g.used }));
}
