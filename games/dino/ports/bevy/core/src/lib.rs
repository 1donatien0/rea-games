//! Chrome Dino rules, ported from `ports/web/dino.mjs` with the same operations in the same
//! order, so every f64 matches the original bit for bit. No clock, no Bevy: the caller moves the
//! clock with `Input::dt` and supplies the random numbers.

pub const WIDTH: f64 = 600.0;
pub const HEIGHT: f64 = 150.0;
const FPS: f64 = 60.0;

const ACCELERATION: f64 = 0.001;
const BOTTOM_PAD: f64 = 10.0;
const CLEAR_TIME: f64 = 3000.0;
const GAMEOVER_CLEAR_TIME: f64 = 750.0;
const GAP_COEFFICIENT: f64 = 0.6;
const MAX_OBSTACLE_DUPLICATION: usize = 2;
const MAX_SPEED: f64 = 13.0;
const SPEED: f64 = 6.0;

pub const TREX_HEIGHT: f64 = 47.0;
pub const TREX_WIDTH: f64 = 44.0;
const DROP_VELOCITY: f64 = -5.0;
const GRAVITY: f64 = 0.6;
const INITIAL_JUMP_VELOCITY: f64 = -10.0;
const INTRO_DURATION: f64 = 1500.0;
const MAX_JUMP_HEIGHT: f64 = 30.0;
const MIN_JUMP_HEIGHT: f64 = 30.0;
const SPEED_DROP_COEFFICIENT: f64 = 3.0;
const START_X_POS: f64 = 50.0;

const MAX_GAP_COEFFICIENT: f64 = 1.5;
const MAX_OBSTACLE_LENGTH: f64 = 3.0;

/// JS `Math.round`: floor(x + 0.5).
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[derive(Clone, Copy)]
struct Bx {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
const fn bx(x: f64, y: f64, width: f64, height: f64) -> Bx {
    Bx {
        x,
        y,
        width,
        height,
    }
}

const TREX_DUCKING: [Bx; 1] = [bx(1.0, 18.0, 55.0, 25.0)];
const TREX_RUNNING: [Bx; 6] = [
    bx(22.0, 0.0, 17.0, 16.0),
    bx(1.0, 18.0, 30.0, 9.0),
    bx(10.0, 35.0, 14.0, 8.0),
    bx(1.0, 24.0, 29.0, 5.0),
    bx(5.0, 30.0, 21.0, 4.0),
    bx(9.0, 34.0, 15.0, 4.0),
];

struct ObstacleType {
    name: &'static str,
    width: f64,
    height: f64,
    y_pos: &'static [f64],
    multiple_speed: f64,
    min_gap: f64,
    min_speed: f64,
    speed_offset: f64,
    boxes: [Bx; 5],
}
const NOBOX: Bx = bx(0.0, 0.0, 0.0, 0.0);
const OBSTACLE_TYPES: [ObstacleType; 3] = [
    ObstacleType {
        name: "CACTUS_SMALL",
        width: 17.0,
        height: 35.0,
        y_pos: &[105.0],
        multiple_speed: 4.0,
        min_gap: 120.0,
        min_speed: 0.0,
        speed_offset: 0.0,
        boxes: [
            bx(0.0, 7.0, 5.0, 27.0),
            bx(4.0, 0.0, 6.0, 34.0),
            bx(10.0, 4.0, 7.0, 14.0),
            NOBOX,
            NOBOX,
        ],
    },
    ObstacleType {
        name: "CACTUS_LARGE",
        width: 25.0,
        height: 50.0,
        y_pos: &[90.0],
        multiple_speed: 7.0,
        min_gap: 120.0,
        min_speed: 0.0,
        speed_offset: 0.0,
        boxes: [
            bx(0.0, 12.0, 7.0, 38.0),
            bx(8.0, 0.0, 7.0, 49.0),
            bx(13.0, 10.0, 10.0, 38.0),
            NOBOX,
            NOBOX,
        ],
    },
    ObstacleType {
        name: "PTERODACTYL",
        width: 46.0,
        height: 40.0,
        y_pos: &[100.0, 75.0, 50.0],
        multiple_speed: 999.0,
        min_gap: 150.0,
        min_speed: 8.5,
        speed_offset: 0.8,
        boxes: [
            bx(15.0, 15.0, 16.0, 5.0),
            bx(18.0, 21.0, 24.0, 6.0),
            bx(2.0, 14.0, 4.0, 3.0),
            bx(6.0, 10.0, 4.0, 7.0),
            bx(10.0, 8.0, 6.0, 9.0),
        ],
    },
];
impl ObstacleType {
    fn box_count(&self) -> usize {
        if self.name == "PTERODACTYL" {
            5
        } else {
            3
        }
    }
}

fn box_compare(a: &Bx, b: &Bx) -> bool {
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.height + a.y > b.y
}
fn adjusted(b: &Bx, by: &Bx) -> Bx {
    bx(b.x + by.x, b.y + by.y, b.width, b.height)
}

/// JS `Math.floor(rng() * (max - min + 1)) + min`.
fn random_num(rng: &mut dyn FnMut() -> f64, min: f64, max: f64) -> f64 {
    (rng() * (max - min + 1.0)).floor() + min
}

pub struct Obstacle {
    ty: usize,
    pub size: f64,
    remove: bool,
    pub x_pos: f64,
    pub y_pos: f64,
    pub width: f64,
    pub gap: f64,
    pub speed_offset: f64,
    pub following_created: bool,
    boxes: Vec<Bx>,
}

impl Obstacle {
    fn new(rng: &mut dyn FnMut() -> f64, ty: usize, speed: f64, x_offset: f64) -> Obstacle {
        let t = &OBSTACLE_TYPES[ty];
        let mut o = Obstacle {
            ty,
            size: random_num(rng, 1.0, MAX_OBSTACLE_LENGTH),
            remove: false,
            x_pos: WIDTH + x_offset,
            y_pos: 0.0,
            width: 0.0,
            gap: 0.0,
            speed_offset: 0.0,
            following_created: false,
            boxes: t.boxes[..t.box_count()].to_vec(),
        };
        if o.size > 1.0 && t.multiple_speed > speed {
            o.size = 1.0;
        }
        o.width = t.width * o.size;
        if t.y_pos.len() > 1 {
            o.y_pos = t.y_pos[random_num(rng, 0.0, t.y_pos.len() as f64 - 1.0) as usize];
        } else {
            o.y_pos = t.y_pos[0];
        }
        if o.size > 1.0 {
            o.boxes[1].width = o.width - o.boxes[0].width - o.boxes[2].width;
            o.boxes[2].x = o.width - o.boxes[2].width;
        }
        if t.speed_offset != 0.0 {
            o.speed_offset = if rng() > 0.5 {
                t.speed_offset
            } else {
                -t.speed_offset
            };
        }
        let min_gap = round(o.width * speed + t.min_gap * GAP_COEFFICIENT);
        let max_gap = round(min_gap * MAX_GAP_COEFFICIENT);
        o.gap = random_num(rng, min_gap, max_gap);
        o
    }

    fn update(&mut self, delta_time: f64, mut speed: f64) {
        if !self.remove {
            if OBSTACLE_TYPES[self.ty].speed_offset != 0.0 {
                speed += self.speed_offset;
            }
            self.x_pos -= ((speed * FPS / 1000.0) * delta_time).floor();
            if !self.is_visible() {
                self.remove = true;
            }
        }
    }

    fn is_visible(&self) -> bool {
        self.x_pos + self.width > 0.0
    }

    pub fn type_name(&self) -> &'static str {
        OBSTACLE_TYPES[self.ty].name
    }
    /// Height of the obstacle type, for drawing.
    pub fn height(&self) -> f64 {
        OBSTACLE_TYPES[self.ty].height
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Waiting,
    Running,
    Crashed,
    Jumping,
    Ducking,
}
impl Status {
    pub fn name(self) -> &'static str {
        match self {
            Status::Waiting => "WAITING",
            Status::Running => "RUNNING",
            Status::Crashed => "CRASHED",
            Status::Jumping => "JUMPING",
            Status::Ducking => "DUCKING",
        }
    }
    fn ms_per_frame(self) -> f64 {
        match self {
            Status::Waiting => 1000.0 / 3.0,
            Status::Running => 1000.0 / 12.0,
            Status::Crashed => 1000.0 / 60.0,
            Status::Jumping => 1000.0 / 60.0,
            Status::Ducking => 1000.0 / 8.0,
        }
    }
}

pub struct Trex {
    pub x_pos: f64,
    ground_y_pos: f64,
    pub y_pos: f64,
    min_jump_height: f64,
    pub status: Status,
    pub jumping: bool,
    pub ducking: bool,
    pub jump_velocity: f64,
    pub reached_min_height: bool,
    pub speed_drop: bool,
    pub jump_count: f64,
    playing_intro: bool,
}

impl Trex {
    fn new() -> Trex {
        let ground = HEIGHT - TREX_HEIGHT - BOTTOM_PAD;
        Trex {
            x_pos: 0.0,
            ground_y_pos: ground,
            y_pos: ground,
            min_jump_height: ground - MIN_JUMP_HEIGHT,
            status: Status::Waiting,
            jumping: false,
            ducking: false,
            jump_velocity: 0.0,
            reached_min_height: false,
            speed_drop: false,
            jump_count: 0.0,
            playing_intro: false,
        }
    }

    fn update(&mut self, delta_time: f64, status: Option<Status>) {
        if let Some(s) = status {
            self.status = s;
        }
        if self.playing_intro && self.x_pos < START_X_POS {
            self.x_pos += round((START_X_POS / INTRO_DURATION) * delta_time);
        }
        if self.status == Status::Crashed && self.ducking {
            self.x_pos += 1.0;
        }
        if self.speed_drop && self.y_pos == self.ground_y_pos {
            self.speed_drop = false;
            self.set_duck(true);
        }
    }

    fn start_jump(&mut self, speed: f64) {
        if !self.jumping {
            self.update(0.0, Some(Status::Jumping));
            self.jump_velocity = INITIAL_JUMP_VELOCITY - speed / 10.0;
            self.jumping = true;
            self.reached_min_height = false;
            self.speed_drop = false;
        }
    }

    fn end_jump(&mut self) {
        if self.reached_min_height && self.jump_velocity < DROP_VELOCITY {
            self.jump_velocity = DROP_VELOCITY;
        }
    }

    fn update_jump(&mut self, delta_time: f64) {
        let ms_per_frame = self.status.ms_per_frame();
        let frames_elapsed = delta_time / ms_per_frame;
        if self.speed_drop {
            self.y_pos += round(self.jump_velocity * SPEED_DROP_COEFFICIENT * frames_elapsed);
        } else {
            self.y_pos += round(self.jump_velocity * frames_elapsed);
        }
        self.jump_velocity += GRAVITY * frames_elapsed;
        if self.y_pos < self.min_jump_height || self.speed_drop {
            self.reached_min_height = true;
        }
        if self.y_pos < MAX_JUMP_HEIGHT || self.speed_drop {
            self.end_jump();
        }
        if self.y_pos > self.ground_y_pos {
            self.reset();
            self.jump_count += 1.0;
        }
        self.update(delta_time, None);
    }

    fn set_speed_drop(&mut self) {
        self.speed_drop = true;
        self.jump_velocity = 1.0;
    }

    fn set_duck(&mut self, is_ducking: bool) {
        if is_ducking && self.status != Status::Ducking {
            self.update(0.0, Some(Status::Ducking));
            self.ducking = true;
        } else if self.status == Status::Ducking {
            self.update(0.0, Some(Status::Running));
            self.ducking = false;
        }
    }

    fn reset(&mut self) {
        self.y_pos = self.ground_y_pos;
        self.jump_velocity = 0.0;
        self.jumping = false;
        self.ducking = false;
        self.update(0.0, Some(Status::Running));
        self.speed_drop = false;
        self.jump_count = 0.0;
    }
}

fn check_for_collision(obstacle: &Obstacle, t_rex: &Trex) -> bool {
    let ty = &OBSTACLE_TYPES[obstacle.ty];
    let t_rex_box = bx(
        t_rex.x_pos + 1.0,
        t_rex.y_pos + 1.0,
        TREX_WIDTH - 2.0,
        TREX_HEIGHT - 2.0,
    );
    let obstacle_box = bx(
        obstacle.x_pos + 1.0,
        obstacle.y_pos + 1.0,
        ty.width * obstacle.size - 2.0,
        ty.height - 2.0,
    );
    if box_compare(&t_rex_box, &obstacle_box) {
        let t_boxes: &[Bx] = if t_rex.ducking {
            &TREX_DUCKING
        } else {
            &TREX_RUNNING
        };
        for tb in t_boxes {
            for ob in &obstacle.boxes {
                if box_compare(&adjusted(tb, &t_rex_box), &adjusted(ob, &obstacle_box)) {
                    return true;
                }
            }
        }
    }
    false
}

#[derive(Clone, Copy, Default)]
pub struct Input {
    pub dt: f64,
    pub jump: bool,
    pub duck: bool,
    pub jump_up: bool,
    pub duck_up: bool,
    pub enter: bool,
    pub anim_end: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Key {
    Jump,
    Duck,
    Enter,
}

pub struct Dino {
    rng: Box<dyn FnMut() -> f64>,
    pub now: f64,
    pub t_rex: Trex,
    pub obstacles: Vec<Obstacle>,
    pub obstacle_history: Vec<&'static str>,
    pub distance_ran: f64,
    pub highest_score: f64,
    pub time: f64,
    pub running_time: f64,
    ms_per_frame: f64,
    pub current_speed: f64,
    pub activated: bool,
    pub playing: bool,
    pub crashed: bool,
    pub paused: bool,
    pub playing_intro: bool,
    pub play_count: f64,
    intro_listener: bool,
    queue: Vec<u32>,
    running: Option<Vec<(u32, bool)>>,
    next_id: u32,
    raq_id: u32,
    update_pending: bool,
}

impl Dino {
    pub fn new(rng: Box<dyn FnMut() -> f64>, clock0: f64) -> Dino {
        let mut d = Dino {
            rng,
            now: clock0,
            t_rex: Trex::new(),
            obstacles: Vec::new(),
            obstacle_history: Vec::new(),
            distance_ran: 0.0,
            highest_score: 0.0,
            time: 0.0,
            running_time: 0.0,
            ms_per_frame: 1000.0 / FPS,
            current_speed: SPEED,
            activated: false,
            playing: false,
            crashed: false,
            paused: false,
            playing_intro: false,
            play_count: 0.0,
            intro_listener: false,
            queue: Vec::new(),
            running: None,
            next_id: 1,
            raq_id: 0,
            update_pending: false,
        };
        d.update();
        d
    }

    fn request_frame(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.queue.push(id);
        id
    }
    fn cancel_frame(&mut self, id: u32) {
        self.queue.retain(|q| *q != id);
        if let Some(r) = &mut self.running {
            for q in r.iter_mut() {
                if q.0 == id {
                    q.1 = true;
                }
            }
        }
    }
    fn schedule_next_update(&mut self) {
        if !self.update_pending {
            self.update_pending = true;
            self.raq_id = self.request_frame();
        }
    }

    /// One browser frame.
    pub fn step(&mut self, input: &Input) {
        self.now += input.dt;
        if input.jump {
            self.key_down(Key::Jump);
        }
        if input.duck {
            self.key_down(Key::Duck);
        }
        if input.jump_up {
            self.key_up(Key::Jump);
        }
        if input.duck_up {
            self.key_up(Key::Duck);
        }
        if input.enter {
            self.key_up(Key::Enter);
        }
        if input.anim_end && self.intro_listener {
            self.start_game();
        }
        let q = std::mem::take(&mut self.queue);
        self.running = Some(q.into_iter().map(|id| (id, false)).collect());
        let mut i = 0;
        loop {
            let item = match &self.running {
                Some(r) if i < r.len() => r[i],
                _ => break,
            };
            if !item.1 {
                self.update();
            }
            i += 1;
        }
        self.running = None;
    }

    fn update(&mut self) {
        self.update_pending = false;
        let now = self.now;
        let mut delta_time = now - (if self.time != 0.0 { self.time } else { now });
        self.time = now;

        if self.playing {
            if self.t_rex.jumping {
                self.t_rex.update_jump(delta_time);
            }
            self.running_time += delta_time;
            let has_obstacles = self.running_time > CLEAR_TIME;

            if self.t_rex.jump_count == 1.0 && !self.playing_intro {
                self.play_intro();
            }

            if self.playing_intro {
                self.update_horizon(0.0, self.current_speed, has_obstacles);
            } else {
                delta_time = if !self.activated { 0.0 } else { delta_time };
                self.update_horizon(delta_time, self.current_speed, has_obstacles);
            }

            let collision = has_obstacles
                && match self.obstacles.first() {
                    Some(o) => check_for_collision(o, &self.t_rex),
                    None => false,
                };
            if !collision {
                self.distance_ran += self.current_speed * delta_time / self.ms_per_frame;
                if self.current_speed < MAX_SPEED {
                    self.current_speed += ACCELERATION;
                }
            } else {
                self.game_over();
            }
        }

        if self.playing || !self.activated {
            self.t_rex.update(delta_time, None);
            self.schedule_next_update();
        }
    }

    fn play_intro(&mut self) {
        if !self.activated && !self.crashed {
            self.playing_intro = true;
            self.t_rex.playing_intro = true;
            self.intro_listener = true;
            self.playing = true;
            self.activated = true;
        } else if self.crashed {
            self.restart();
        }
    }

    fn start_game(&mut self) {
        self.running_time = 0.0;
        self.playing_intro = false;
        self.t_rex.playing_intro = false;
        self.play_count += 1.0;
    }

    fn game_over(&mut self) {
        self.stop();
        self.crashed = true;
        self.t_rex.update(100.0, Some(Status::Crashed));
        if self.distance_ran > self.highest_score {
            self.highest_score = self.distance_ran.ceil();
        }
        self.time = self.now;
    }

    fn stop(&mut self) {
        self.playing = false;
        self.paused = true;
        let id = self.raq_id;
        self.cancel_frame(id);
        self.raq_id = 0;
    }

    fn play(&mut self) {
        if !self.crashed {
            self.playing = true;
            self.paused = false;
            self.t_rex.update(0.0, Some(Status::Running));
            self.time = self.now;
            self.update();
        }
    }

    fn restart(&mut self) {
        if self.raq_id == 0 {
            self.play_count += 1.0;
            self.running_time = 0.0;
            self.playing = true;
            self.crashed = false;
            self.distance_ran = 0.0;
            self.current_speed = SPEED;
            self.time = self.now;
            self.obstacles.clear();
            self.t_rex.reset();
            self.update();
        }
    }

    fn is_running(&self) -> bool {
        self.raq_id != 0
    }

    fn key_down(&mut self, which: Key) {
        if which == Key::Jump && !self.crashed {
            if !self.playing {
                self.playing = true;
                self.update();
            }
            if !self.t_rex.jumping && !self.t_rex.ducking {
                let s = self.current_speed;
                self.t_rex.start_jump(s);
            }
        }
        if which == Key::Duck && self.playing && !self.crashed {
            if self.t_rex.jumping {
                self.t_rex.set_speed_drop();
            } else if !self.t_rex.jumping && !self.t_rex.ducking {
                self.t_rex.set_duck(true);
            }
        }
    }

    fn key_up(&mut self, which: Key) {
        let is_jump_key = which == Key::Jump;
        if self.is_running() && is_jump_key {
            self.t_rex.end_jump();
        } else if which == Key::Duck {
            self.t_rex.speed_drop = false;
            self.t_rex.set_duck(false);
        } else if self.crashed {
            let delta_time = self.now - self.time;
            if which == Key::Enter || (delta_time >= GAMEOVER_CLEAR_TIME && is_jump_key) {
                self.restart();
            }
        } else if self.paused && is_jump_key {
            self.t_rex.reset();
            self.play();
        }
    }

    fn update_horizon(&mut self, delta_time: f64, current_speed: f64, update_obstacles: bool) {
        if update_obstacles {
            self.update_obstacles(delta_time, current_speed);
        }
    }

    fn update_obstacles(&mut self, delta_time: f64, current_speed: f64) {
        let mut removed = 0;
        for o in self.obstacles.iter_mut() {
            o.update(delta_time, current_speed);
            if o.remove {
                removed += 1;
            }
        }
        // JS shifts the front of a copy once per removed obstacle
        let removed = removed.min(self.obstacles.len());
        self.obstacles.drain(..removed);
        let make_follower = match self.obstacles.last() {
            Some(last) => {
                if !last.following_created
                    && last.is_visible()
                    && (last.x_pos + last.width + last.gap) < WIDTH
                {
                    Some(true)
                } else {
                    None
                }
            }
            None => Some(false),
        };
        match make_follower {
            Some(true) => {
                self.add_new_obstacle(current_speed);
                let n = self.obstacles.len();
                self.obstacles[n - 2].following_created = true;
            }
            Some(false) => self.add_new_obstacle(current_speed),
            None => {}
        }
    }

    fn add_new_obstacle(&mut self, current_speed: f64) {
        loop {
            let ty = random_num(&mut self.rng, 0.0, OBSTACLE_TYPES.len() as f64 - 1.0) as usize;
            let t = &OBSTACLE_TYPES[ty];
            if self.duplicate_obstacle_check(t.name) || current_speed < t.min_speed {
                continue;
            }
            let o = Obstacle::new(&mut self.rng, ty, current_speed, t.width);
            self.obstacles.push(o);
            self.obstacle_history.insert(0, t.name);
            if self.obstacle_history.len() > 1 {
                self.obstacle_history.truncate(MAX_OBSTACLE_DUPLICATION);
            }
            return;
        }
    }

    fn duplicate_obstacle_check(&self, next: &str) -> bool {
        let mut count = 0;
        for h in &self.obstacle_history {
            count = if *h == next { count + 1 } else { 0 };
        }
        count >= MAX_OBSTACLE_DUPLICATION
    }

    pub fn snapshot(&self) -> Snapshot {
        let x = &self.t_rex;
        let d = self.distance_ran.ceil();
        Snapshot {
            playing: self.playing,
            crashed: self.crashed,
            activated: self.activated,
            playing_intro: self.playing_intro,
            paused: self.paused,
            current_speed: self.current_speed,
            distance_ran: self.distance_ran,
            score: if d != 0.0 { round(d * 0.025) } else { 0.0 },
            highest_score: self.highest_score,
            running_time: self.running_time,
            play_count: self.play_count,
            time: self.time,
            running: self.raq_id != 0,
            raf_pending: self.queue.len(),
            x_pos: x.x_pos,
            y_pos: x.y_pos,
            jumping: x.jumping,
            ducking: x.ducking,
            speed_drop: x.speed_drop,
            jump_velocity: x.jump_velocity,
            jump_count: x.jump_count,
            status: x.status.name(),
            reached_min_height: x.reached_min_height,
            obstacle_history: self.obstacle_history.clone(),
            obstacles: self
                .obstacles
                .iter()
                .map(|o| ObstacleSnap {
                    type_name: o.type_name(),
                    x_pos: o.x_pos,
                    y_pos: o.y_pos,
                    size: o.size,
                    width: o.width,
                    gap: o.gap,
                    speed_offset: o.speed_offset,
                    followed: o.following_created,
                })
                .collect(),
        }
    }
}

/// What the recording compares (the trace entry of one frame), with the tRex fields flattened.
pub struct Snapshot {
    pub playing: bool,
    pub crashed: bool,
    pub activated: bool,
    pub playing_intro: bool,
    pub paused: bool,
    pub current_speed: f64,
    pub distance_ran: f64,
    pub score: f64,
    pub highest_score: f64,
    pub running_time: f64,
    pub play_count: f64,
    pub time: f64,
    pub running: bool,
    pub raf_pending: usize,
    pub x_pos: f64,
    pub y_pos: f64,
    pub jumping: bool,
    pub ducking: bool,
    pub speed_drop: bool,
    pub jump_velocity: f64,
    pub jump_count: f64,
    pub status: &'static str,
    pub reached_min_height: bool,
    pub obstacle_history: Vec<&'static str>,
    pub obstacles: Vec<ObstacleSnap>,
}

pub struct ObstacleSnap {
    pub type_name: &'static str,
    pub x_pos: f64,
    pub y_pos: f64,
    pub size: f64,
    pub width: f64,
    pub gap: f64,
    pub speed_offset: f64,
    pub followed: bool,
}
