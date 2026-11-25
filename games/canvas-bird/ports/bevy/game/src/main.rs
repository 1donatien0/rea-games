//! Playable Canvas Bird: bird-core runs the rules at 60 steps a second, Bevy draws plain shapes.
//! Click, tap or press Space to flap; click after losing to restart. The score is in the window title.
use bevy::prelude::*;
use bird_core::{Bird, BIRD_H, BIRD_W, BIRD_X, H, PIPE_H, PIPE_W, W};

const STEP_MS: f64 = 1000.0 / 60.0;

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
    bird: Bird,
    acc: f64,
}

#[derive(Component)]
struct Drawn;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Canvas Bird".into(),
                resolution: (640u32, 480u32).into(),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb(0.45, 0.75, 0.9)))
        .insert_non_send(Game {
            bird: {
                let mut p = Prng::from_clock();
                let mut b = Bird::new(Box::new(move || p.next()), bird_core::T0);
                b.load();
                b
            },
            acc: 0.0,
        })
        .add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(Update, (tick, draw).chain())
        .run();
}

fn tick(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    mut game: NonSendMut<Game>,
) {
    let g = &mut *game;
    let mut click = keys.just_pressed(KeyCode::Space)
        || mouse.just_pressed(MouseButton::Left)
        || touches.any_just_pressed();
    g.acc += (time.delta_secs_f64() * 1000.0).min(250.0);
    while g.acc >= STEP_MS {
        g.acc -= STEP_MS;
        g.bird.step(STEP_MS, click);
        click = false;
    }
}

/// Rectangle in game pixels (y down, 640x480).
fn rect(commands: &mut Commands, x: f64, y: f64, w: f64, h: f64, color: Color) {
    let cx = (x + w / 2.0 - W / 2.0) as f32;
    let cy = (H / 2.0 - (y + h / 2.0)) as f32;
    commands.spawn((
        Sprite::from_color(color, Vec2::new(w as f32, h as f32)),
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
    let b = &game.bird;
    let hill = Color::srgb(0.35, 0.65, 0.4);
    for (i, x) in b.bg.iter().enumerate() {
        rect(
            &mut commands,
            *x,
            400.0,
            W,
            80.0,
            if i == 0 {
                hill
            } else {
                Color::srgb(0.3, 0.6, 0.35)
            },
        );
    }
    if b.playing {
        let pipe = Color::srgb(0.2, 0.55, 0.25);
        let cap = Color::srgb(0.15, 0.4, 0.2);
        for p in &b.pipes {
            rect(&mut commands, p.up_x, p.up_y, PIPE_W, PIPE_H, pipe);
            rect(&mut commands, p.up_x - 4.0, p.up_y, PIPE_W + 8.0, 20.0, cap);
            rect(&mut commands, p.down_x, p.down_y, PIPE_W, PIPE_H, pipe);
            rect(
                &mut commands,
                p.down_x - 4.0,
                p.down_y + PIPE_H - 20.0,
                PIPE_W + 8.0,
                20.0,
                cap,
            );
        }
    }
    // bird: body, wing that follows the sprite frame, beak, eye
    let wing = [-8.0, 0.0, 8.0][(b.sprite % 3) as usize];
    rect(
        &mut commands,
        BIRD_X + 4.0,
        b.y + 12.0,
        BIRD_W - 12.0,
        BIRD_H - 24.0,
        Color::srgb(0.95, 0.8, 0.2),
    );
    rect(
        &mut commands,
        BIRD_X + 12.0,
        b.y + 28.0 + wing,
        24.0,
        12.0,
        Color::srgb(0.85, 0.6, 0.15),
    );
    rect(
        &mut commands,
        BIRD_X + BIRD_W - 10.0,
        b.y + 26.0,
        12.0,
        8.0,
        Color::srgb(0.95, 0.45, 0.1),
    );
    rect(
        &mut commands,
        BIRD_X + 42.0,
        b.y + 18.0,
        8.0,
        8.0,
        Color::WHITE,
    );
    rect(
        &mut commands,
        BIRD_X + 46.0,
        b.y + 20.0,
        4.0,
        4.0,
        Color::BLACK,
    );

    let title = if !b.playing {
        "Canvas Bird - click to start".to_string()
    } else if b.controls {
        format!("Canvas Bird - score {}", b.score)
    } else {
        format!("Canvas Bird - crashed, score {}", b.score)
    };
    if let Some(mut w) = windows.iter_mut().next() {
        if w.title != title {
            w.title = title;
        }
    }
}
