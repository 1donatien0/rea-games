//! Playable Chrome Dino: dino-core runs the rules at a fixed 60 Hz, Bevy draws coloured rectangles.
//! Space or Up jumps, Down ducks, Space after a crash restarts.
use bevy::prelude::*;
use dino_core::{Dino, Input, TREX_HEIGHT, TREX_WIDTH, WIDTH};

const SCALE: f32 = 1.5;
const STEP_MS: f64 = 1000.0 / 60.0;
const INTRO_MS: f64 = 400.0;

/// A small xorshift64* generator, seeded from the clock, for the live game's random numbers.
struct Prng(u64);
impl Prng {
    fn from_clock() -> Prng {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        Prng(n | 1)
    }
    /// Next number in [0, 1).
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let v = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }
}

struct Game {
    dino: Dino,
    acc: f64,
    intro_t: f64,
}

#[derive(Component)]
struct Drawn;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Dino".into(),
                resolution: (900u32, 225u32).into(),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb(0.97, 0.97, 0.97)))
        .insert_non_send(Game {
            dino: {
                let mut p = Prng::from_clock();
                Dino::new(Box::new(move || p.next()), 1000.0)
            },
            acc: 0.0,
            intro_t: 0.0,
        })
        .add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(Update, (tick, draw).chain())
        .run();
}

fn tick(time: Res<Time>, keys: Res<ButtonInput<KeyCode>>, mut game: NonSendMut<Game>) {
    let g = &mut *game;
    // key events are collected for the next fixed step
    let jump_keys = [KeyCode::Space, KeyCode::ArrowUp];
    let mut input = Input::default();
    input.jump = keys.any_just_pressed(jump_keys);
    input.jump_up = keys.any_just_released(jump_keys);
    input.duck = keys.just_pressed(KeyCode::ArrowDown);
    input.duck_up = keys.just_released(KeyCode::ArrowDown);
    // the original restarts on the key release after a pause; a press is friendlier here
    input.enter = g.dino.crashed && (input.jump || keys.just_pressed(KeyCode::Enter));

    g.acc += (time.delta_secs_f64() * 1000.0).min(250.0);
    let mut first = true;
    while g.acc >= STEP_MS {
        g.acc -= STEP_MS;
        let mut step = if first { input } else { Input::default() };
        first = false;
        step.dt = STEP_MS;
        if g.dino.playing_intro {
            g.intro_t += STEP_MS;
            if g.intro_t >= INTRO_MS {
                step.anim_end = true;
                g.intro_t = 0.0;
            }
        } else {
            g.intro_t = 0.0;
        }
        g.dino.step(&step);
    }
}

fn rect(commands: &mut Commands, x: f64, y: f64, w: f64, h: f64, color: Color) {
    // dino-core uses y growing downwards inside a 600x150 box
    let cx = (x + w / 2.0 - WIDTH / 2.0) as f32 * SCALE;
    let cy = (75.0 - (y + h / 2.0)) as f32 * SCALE;
    commands.spawn((
        Sprite::from_color(color, Vec2::new(w as f32 * SCALE, h as f32 * SCALE)),
        Transform::from_xyz(cx, cy, 0.0),
        Drawn,
    ));
}

fn draw(
    mut commands: Commands,
    old: Query<Entity, With<Drawn>>,
    game: NonSend<Game>,
    mut windows: Query<&mut Window>,
) {
    for e in &old {
        commands.entity(e).despawn();
    }
    let d = &game.dino;
    let ink = Color::srgb(0.33, 0.33, 0.33);
    let dark = Color::srgb(0.2, 0.2, 0.2);
    rect(&mut commands, 0.0, 140.0, WIDTH, 2.0, ink);

    let t = &d.t_rex;
    if t.ducking {
        rect(
            &mut commands,
            t.x_pos,
            t.y_pos + 17.0,
            59.0,
            TREX_HEIGHT - 17.0,
            ink,
        );
        rect(
            &mut commands,
            t.x_pos + 40.0,
            t.y_pos + 17.0,
            19.0,
            10.0,
            dark,
        );
    } else {
        rect(
            &mut commands,
            t.x_pos,
            t.y_pos + 16.0,
            TREX_WIDTH - 10.0,
            22.0,
            ink,
        ); // body
        rect(&mut commands, t.x_pos + 22.0, t.y_pos, 22.0, 18.0, ink); // head
        rect(
            &mut commands,
            t.x_pos + 36.0,
            t.y_pos + 4.0,
            4.0,
            4.0,
            Color::WHITE,
        ); // eye
        let feet = if t.jumping || d.crashed || (d.time / 100.0) as i64 % 2 == 0 {
            (0.0, 0.0)
        } else {
            (8.0, -8.0)
        };
        rect(
            &mut commands,
            t.x_pos + 8.0,
            t.y_pos + 38.0,
            6.0,
            9.0 + feet.1,
            dark,
        );
        rect(
            &mut commands,
            t.x_pos + 22.0 + feet.0 - 8.0,
            t.y_pos + 38.0,
            6.0,
            9.0,
            dark,
        );
    }
    if d.crashed {
        rect(
            &mut commands,
            t.x_pos + 34.0,
            t.y_pos + 2.0,
            8.0,
            8.0,
            Color::srgb(0.8, 0.2, 0.2),
        );
    }

    for o in &d.obstacles {
        let h = o.height();
        match o.type_name() {
            "PTERODACTYL" => {
                rect(&mut commands, o.x_pos, o.y_pos + 14.0, o.width, 12.0, dark);
                let flap = if (d.time / 150.0) as i64 % 2 == 0 {
                    0.0
                } else {
                    14.0
                };
                rect(
                    &mut commands,
                    o.x_pos + 12.0,
                    o.y_pos + flap,
                    18.0,
                    14.0,
                    ink,
                );
            }
            _ => {
                let unit = o.width / o.size;
                for i in 0..o.size as i32 {
                    let x = o.x_pos + unit * i as f64;
                    rect(
                        &mut commands,
                        x + unit * 0.35,
                        o.y_pos,
                        unit * 0.3,
                        h,
                        Color::srgb(0.2, 0.45, 0.25),
                    );
                    rect(
                        &mut commands,
                        x + unit * 0.05,
                        o.y_pos + h * 0.3,
                        unit * 0.9,
                        h * 0.15,
                        Color::srgb(0.2, 0.45, 0.25),
                    );
                }
            }
        }
    }

    let score = (d.distance_ran.ceil() * 0.025).round() as i64;
    let title = if d.crashed {
        format!(
            "Dino - game over, score {score}, best {} - space to restart",
            (d.highest_score * 0.025).round() as i64
        )
    } else {
        format!("Dino - score {score}")
    };
    if let Some(mut w) = windows.iter_mut().next() {
        if w.title != title {
            w.title = title;
        }
    }
}
