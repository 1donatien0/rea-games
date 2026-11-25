//! Canvas Bird rules in plain Rust. Same operation order as the verified JS port so f64 results match.
//! The game advances one rendered frame per `step`; draw calls are a typed list, printed by the runner.

pub const T0: f64 = 1000000.0;
pub const W: f64 = 640.0;
pub const H: f64 = 480.0;
const PIPES: usize = 5;
const SPACING: f64 = 300.0;
const GAP: f64 = 120.0;
const MIN_OFF: f64 = -150.0;
const MAX_OFF: f64 = 50.0;
const PIPE_SPEED: f64 = 3.0;
pub const PIPE_W: f64 = 64.0;
pub const PIPE_H: f64 = 316.0;
pub const BIRD_X: f64 = 70.0;
pub const BIRD_W: f64 = 64.0;
pub const BIRD_H: f64 = 64.0;
const START_Y: f64 = 20.0;
const START_V: f64 = 2.0;
const FORCE: f64 = 0.15;
const JUMP: f64 = -6.0;
const MAX_V: f64 = 8.0;
const FRAME_MS: f64 = 1000.0 / 30.0;

/// One canvas call (or audio request) of a frame.
#[derive(Clone, Debug, PartialEq)]
pub enum Call {
    Clear,
    Background(f64),
    EnemyUp(f64, f64),
    EnemyDown(f64, f64),
    /// sprite source x, y
    Player(f64, f64, f64),
    /// stroke?, text, x, y, style
    Text {
        stroke: bool,
        text: Text,
        x: f64,
        y: f64,
        style: Style,
    },
    Point,
    Lose,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Text {
    Splash,
    Score(u32),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Style {
    /// rgba(r,g,b,alpha)
    Rgba(u8, f64),
    White,
}

#[derive(Clone, Debug)]
pub struct Pipe {
    pub id: usize,
    pub up_x: f64,
    pub up_y: f64,
    pub down_x: f64,
    pub down_y: f64,
    pub off: f64,
}

pub struct Bird {
    rng: Box<dyn FnMut() -> f64>,
    t: f64,
    pub playing: bool,
    pub controls: bool,
    pub score: u32,
    pub alpha: f64,
    rising: bool,
    stroke_alpha: f64,
    pub bg: [f64; 2],
    pub y: f64,
    pub v: f64,
    pub sprite: u32,
    sprite_clock: f64,
    fall_clock: f64,
    pub pipes: Vec<Pipe>,
    next: usize,
    last: usize,
    out: Vec<Call>,
}

impl Bird {
    pub fn new(rng: Box<dyn FnMut() -> f64>, start: f64) -> Bird {
        let n = start.floor();
        Bird {
            rng,
            t: start,
            playing: false,
            controls: false,
            score: 0,
            alpha: 1.0,
            rising: false,
            stroke_alpha: 1.0,
            bg: [0.0, W],
            y: START_Y,
            v: START_V,
            sprite: 0,
            sprite_clock: n,
            fall_clock: n,
            pipes: Vec::new(),
            next: 0,
            last: PIPES - 1,
            out: Vec::new(),
        }
    }

    fn now(&self) -> f64 {
        self.t.floor()
    }

    fn rand_int(&mut self, lo: f64, hi: f64) -> f64 {
        ((self.rng)() * (hi - lo + 1.0) + lo).floor()
    }

    fn setup_pipes(&mut self) {
        self.next = 0;
        self.last = PIPES - 1;
        self.pipes.clear();
        for i in 0..PIPES {
            let off = self.rand_int(MIN_OFF, MAX_OFF);
            let x = W + i as f64 * SPACING;
            self.pipes.push(Pipe {
                id: i,
                up_x: x,
                up_y: H / 2.0 + GAP + off,
                down_x: x,
                down_y: 0.0 - GAP + off,
                off,
            });
        }
    }

    fn score_check(&mut self, id: usize, x: f64) {
        if id == self.next && x + PIPE_W < BIRD_X + BIRD_W {
            self.next = if self.next == PIPES - 1 {
                0
            } else {
                self.next + 1
            };
            if self.controls {
                self.score += 1;
                self.out.push(Call::Point);
            }
        }
    }

    fn move_up(&mut self, i: usize) {
        self.pipes[i].up_x -= PIPE_SPEED;
        if self.pipes[i].up_x <= -PIPE_W {
            let nx = self.pipes[self.last].up_x + SPACING;
            self.pipes[i].up_x = nx;
            self.pipes[i].down_x = nx;
            self.pipes[i].off = self.rand_int(MIN_OFF, MAX_OFF); // y is not recomputed (see GAME.md)
            self.last = if self.last == PIPES - 1 {
                0
            } else {
                self.last + 1
            };
        }
        let (id, x) = (self.pipes[i].id, self.pipes[i].up_x);
        self.score_check(id, x);
    }

    fn move_down(&mut self, i: usize) {
        self.pipes[i].down_x -= PIPE_SPEED;
        let (id, x) = (self.pipes[i].id, self.pipes[i].down_x);
        self.score_check(id, x);
    }

    fn collided(&mut self) -> bool {
        let right = BIRD_X + BIRD_W;
        let top = self.y;
        let bottom = self.y + BIRD_H;
        let p = &self.pipes[self.next];
        let px = p.down_x + 40.0;
        let gap_top = p.down_y + PIPE_H;
        let gap_bottom = p.up_y;
        let mut hit = false;
        if right > px && right < px + PIPE_W - 40.0 && (top < gap_top || bottom > gap_bottom) {
            hit = true;
        }
        if bottom < 0.0 || top > H {
            hit = true;
        }
        if hit && self.controls {
            self.out.push(Call::Lose);
        }
        hit
    }

    fn sprite_frame(&mut self) -> u32 {
        let n = self.now();
        if n - self.sprite_clock > FRAME_MS {
            self.sprite_clock = n;
            self.sprite += 1;
            if self.sprite > 2 {
                self.sprite = 0;
            }
        }
        self.sprite
    }

    /// Draws one frame and returns its calls.
    pub fn draw(&mut self) -> Vec<Call> {
        self.out = Vec::new();
        self.out.push(Call::Clear);
        for i in 0..2 {
            let x = self.bg[i];
            self.out.push(Call::Background(x));
        }
        for b in self.bg.iter_mut() {
            *b -= 1.0;
            if *b <= -W {
                *b = W;
            }
        }
        let tx = W / 2.0 - 230.0;
        if !self.playing {
            self.stroke_alpha = self.alpha;
            self.out.push(Call::Text {
                stroke: true,
                text: Text::Splash,
                x: tx,
                y: 80.0,
                style: Style::Rgba(0, self.alpha),
            });
            self.out.push(Call::Text {
                stroke: false,
                text: Text::Splash,
                x: tx,
                y: 80.0,
                style: Style::Rgba(255, self.alpha),
            });
            if self.alpha < 0.0 {
                self.rising = true;
            }
            if self.alpha > 1.0 {
                self.rising = false;
            }
            self.alpha += if self.rising { 0.02 } else { -0.02 };
        } else {
            for i in 0..self.pipes.len() {
                let p = &self.pipes[i];
                let (a, b, c, d) = (p.up_x, p.up_y, p.down_x, p.down_y);
                self.out.push(Call::EnemyUp(a, b));
                self.out.push(Call::EnemyDown(c, d));
                self.move_up(i);
                self.move_down(i);
            }
            let sx = self.sprite_frame() as f64 * BIRD_W;
            self.out.push(Call::Player(sx, 0.0, self.y));
            if self.now() - self.fall_clock > FRAME_MS {
                if self.v < MAX_V {
                    self.v += FORCE;
                }
                self.y += self.v;
            }
            if self.collided() {
                self.controls = false;
                if self.y - BIRD_H > H {
                    self.playing = false;
                }
            }
            let s = self.score;
            self.out.push(Call::Text {
                stroke: true,
                text: Text::Score(s),
                x: W / 2.0 - 11.0,
                y: 51.0,
                style: Style::Rgba(0, self.stroke_alpha),
            });
            self.out.push(Call::Text {
                stroke: false,
                text: Text::Score(s),
                x: W / 2.0 - 10.0,
                y: 50.0,
                style: Style::White,
            });
        }
        std::mem::take(&mut self.out)
    }

    fn click(&mut self) {
        if self.controls {
            self.v = JUMP;
        }
        if !self.playing {
            self.score = 0;
            self.v = START_V;
            self.y = START_Y;
            self.setup_pipes();
            self.playing = true;
            self.controls = true;
        }
    }

    /// The frame drawn at page load, before any step.
    pub fn load(&mut self) -> Vec<Call> {
        self.draw()
    }

    pub fn step(&mut self, dt: f64, clicked: bool) -> Vec<Call> {
        if clicked {
            self.click();
        }
        self.t += dt;
        self.draw()
    }
}
