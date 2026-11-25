//! Blocks: the rules of the falling-blocks puzzle, as pure logic. No clock, no global random:
//! the caller hands in `rng` (a closure returning [0,1)) and calls `step` once per frame.
//! Written from games/blocks/GAME.md; the order of operations matches the recording.

pub const W: usize = 10;
pub const H: usize = 20;
pub const KINDS: [u8; 7] = *b"ijlostz";
pub const START_STEP: f64 = 0.6;
pub const STEP_DECREMENT: f64 = 0.005;
pub const MIN_STEP: f64 = 0.1;
/// The recording's clock starts here (ms).
pub const T0: f64 = 1000000.0;

/// (size, four rotations of a 4x4 mask; 0x8000 is the top-left cell)
pub fn shape(kind: u8) -> (usize, [u16; 4]) {
    match kind {
        b'i' => (4, [0x0f00, 0x2222, 0x00f0, 0x4444]),
        b'j' => (3, [0x44c0, 0x8e00, 0x6440, 0x0e20]),
        b'l' => (3, [0x4460, 0x0e80, 0xc440, 0x2e00]),
        b'o' => (2, [0xcc00; 4]),
        b's' => (3, [0x06c0, 0x8c40, 0x6c00, 0x4620]),
        b't' => (3, [0x0e40, 0x4c40, 0x4e00, 0x4640]),
        b'z' => (3, [0x0c60, 0x4c80, 0xc600, 0x2640]),
        _ => panic!("unknown piece"),
    }
}

/// The four cells (column, row) a piece covers.
pub fn cells_of(kind: u8, x: i32, y: i32, dir: usize) -> Vec<(i32, i32)> {
    let mask = shape(kind).1[dir];
    (0..16)
        .filter(|i| mask & (0x8000 >> i) != 0)
        .map(|i| (x + (i & 3), y + (i >> 2)))
        .collect()
}

#[derive(Clone, Copy, Debug)]
pub struct Piece {
    pub kind: u8,
    pub x: i32,
    pub y: i32,
    pub dir: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Key {
    Left,
    Right,
    Up,
    Down,
    Esc,
    Space,
    Play,
}

/// Queued actions; the number is the trace's code (0 up, 1 right, 2 down, 3 left).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Up = 0,
    Right = 1,
    Down = 2,
    Left = 3,
}

pub struct Game {
    rng: Box<dyn FnMut() -> f64>,
    used: usize,
    t: f64,
    last: f64,
    pub bag: Vec<u8>,
    pub cur: Piece,
    pub next: Piece,
    pub grid: [[u8; W]; H], // 0 = empty, else the piece letter
    pub actions: Vec<Action>,
    pub score: u64,
    pub vscore: u64,
    pub rows: u64,
    pub step_sec: f64,
    pub dt: f64,
    pub playing: bool,
}

impl Game {
    pub fn new(rng: Box<dyn FnMut() -> f64>, clock0: f64) -> Game {
        let dummy = Piece {
            kind: b'o',
            x: 0,
            y: 0,
            dir: 0,
        };
        let mut g = Game {
            rng,
            used: 0,
            t: clock0,
            last: clock0.floor(),
            bag: Vec::new(),
            cur: dummy,
            next: dummy,
            grid: [[0; W]; H],
            actions: Vec::new(),
            score: 0,
            vscore: 0,
            rows: 0,
            step_sec: START_STEP,
            dt: 0.0,
            playing: false,
        };
        // the page's load-time reset draws current, then next
        g.clear();
        g.cur = g.new_piece();
        g.next = g.new_piece();
        g
    }

    /// How many random numbers were drawn.
    pub fn used(&self) -> usize {
        self.used
    }

    fn rand(&mut self) -> f64 {
        self.used += 1;
        (self.rng)()
    }

    fn new_piece(&mut self) -> Piece {
        if self.bag.is_empty() {
            for k in KINDS {
                for _ in 0..4 {
                    self.bag.push(k);
                }
            }
        }
        // the index is floor(r * (len - 1)): the bag's last piece is not drawn until it is alone
        let r = self.rand();
        let i = (r * (self.bag.len() - 1) as f64).floor() as usize;
        let kind = self.bag.remove(i);
        let r = self.rand();
        let x = (r * (W - shape(kind).0) as f64).round() as i32;
        Piece {
            kind,
            x,
            y: 0,
            dir: 0,
        }
    }

    fn blocked(&self, kind: u8, x: i32, y: i32, dir: usize) -> bool {
        cells_of(kind, x, y, dir).into_iter().any(|(cx, cy)| {
            cx < 0
                || cx >= W as i32
                || cy < 0
                || cy >= H as i32
                || self.grid[cy as usize][cx as usize] != 0
        })
    }

    fn clear(&mut self) {
        self.dt = 0.0;
        self.actions.clear();
        self.grid = [[0; W]; H];
        self.set_rows(0);
        self.score = 0;
        self.vscore = 0;
    }

    fn reset(&mut self) {
        self.clear();
        self.cur = self.next;
        self.next = self.new_piece();
    }

    fn set_rows(&mut self, n: u64) {
        self.rows = n;
        self.step_sec = MIN_STEP.max(START_STEP - STEP_DECREMENT * n as f64);
    }

    pub fn play(&mut self) {
        self.reset();
        self.playing = true;
    }

    pub fn lose(&mut self) {
        self.vscore = self.score;
        self.playing = false;
    }

    fn mv(&mut self, dx: i32, dy: i32) -> bool {
        let c = self.cur;
        if self.blocked(c.kind, c.x + dx, c.y + dy, c.dir) {
            return false;
        }
        self.cur.x += dx;
        self.cur.y += dy;
        true
    }

    fn rotate(&mut self) {
        let c = self.cur;
        let d = (c.dir + 1) & 3;
        if !self.blocked(c.kind, c.x, c.y, d) {
            self.cur.dir = d; // no wall kicks
        }
    }

    fn drop(&mut self) {
        if self.mv(0, 1) {
            return;
        }
        let c = self.cur;
        self.score += 10;
        for (cx, cy) in cells_of(c.kind, c.x, c.y, c.dir) {
            self.grid[cy as usize][cx as usize] = c.kind;
        }
        self.remove_lines();
        self.cur = self.next;
        self.next = self.new_piece();
        self.actions.clear();
        let c = self.cur;
        if self.blocked(c.kind, c.x, c.y, c.dir) {
            self.lose();
        }
    }

    fn remove_lines(&mut self) {
        let mut n = 0u64;
        // rows 19..1; row 0 is never looked at
        let mut y = H - 1;
        while y > 0 {
            if self.grid[y].iter().all(|&c| c != 0) {
                for r in (1..=y).rev() {
                    self.grid[r] = self.grid[r - 1];
                }
                self.grid[0] = [0; W];
                n += 1;
                // look at the same row again
            } else {
                y -= 1;
            }
        }
        if n > 0 {
            self.set_rows(self.rows + n);
            self.score += 100 * 2u64.pow(n as u32 - 1);
        }
    }

    pub fn key(&mut self, k: Key) {
        if self.playing {
            match k {
                Key::Left => self.actions.push(Action::Left),
                Key::Right => self.actions.push(Action::Right),
                Key::Up => self.actions.push(Action::Up),
                Key::Down => self.actions.push(Action::Down),
                Key::Esc => self.lose(),
                Key::Play => self.play(),
                Key::Space => {}
            }
        } else if k == Key::Space || k == Key::Play {
            self.play();
        }
    }

    /// One rendered frame: the keys in order, then the clock moves by `dt_ms` and the game updates.
    pub fn step(&mut self, dt_ms: f64, keys: &[Key]) {
        for &k in keys {
            self.key(k);
        }
        self.t += dt_ms;
        let now = self.t.floor();
        let idt = ((now - self.last) / 1000.0).min(1.0);
        self.last = now;
        if !self.playing {
            return;
        }
        if self.vscore < self.score {
            self.vscore += 1;
        }
        if !self.actions.is_empty() {
            match self.actions.remove(0) {
                Action::Left => {
                    self.mv(-1, 0);
                }
                Action::Right => {
                    self.mv(1, 0);
                }
                Action::Up => self.rotate(),
                Action::Down => self.drop(),
            }
        }
        self.dt += idt;
        if self.dt > self.step_sec {
            self.dt -= self.step_sec;
            self.drop();
        }
    }
}
