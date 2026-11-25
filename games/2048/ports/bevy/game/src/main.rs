//! Playable 2048: game2048-core runs the rules, Bevy draws coloured rectangles with the tile values.
//! Arrow keys or WASD move, R restarts, K keeps playing after 2048. Swipe with the mouse or a touch.
use bevy::prelude::*;
use game2048_core::{Game, SIZE};

const CELL: f32 = 100.0;
const GAP: f32 = 10.0;

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

struct Live {
    game: Game,
    swipe_start: Option<Vec2>,
}

#[derive(Component)]
struct Drawn;

fn main() {
    let mut p = Prng::from_clock();
    let game = Game::new(Box::new(move || p.next()), None);
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "2048".into(),
                resolution: (520u32, 600u32).into(),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb_u8(0x14, 0x16, 0x1c)))
        .insert_non_send(Live {
            game,
            swipe_start: None,
        })
        .add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(Update, (input, draw).chain())
        .run();
}

fn swipe_dir(d: Vec2) -> Option<usize> {
    if d.length() < 30.0 {
        return None;
    }
    // screen y grows downwards
    Some(if d.x.abs() > d.y.abs() {
        if d.x > 0.0 {
            1
        } else {
            3
        }
    } else if d.y > 0.0 {
        2
    } else {
        0
    })
}

fn input(
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    touches: Res<Touches>,
    windows: Query<&Window>,
    mut live: NonSendMut<Live>,
) {
    let mut dir = None;
    for (k, d) in [
        (KeyCode::ArrowUp, 0),
        (KeyCode::KeyW, 0),
        (KeyCode::ArrowRight, 1),
        (KeyCode::KeyD, 1),
        (KeyCode::ArrowDown, 2),
        (KeyCode::KeyS, 2),
        (KeyCode::ArrowLeft, 3),
        (KeyCode::KeyA, 3),
    ] {
        if keys.just_pressed(k) {
            dir = Some(d);
        }
    }
    // swipe: mouse drag or touch
    if mouse.just_pressed(MouseButton::Left) {
        live.swipe_start = windows.iter().next().and_then(|w| w.cursor_position());
    }
    if mouse.just_released(MouseButton::Left) {
        if let (Some(a), Some(b)) = (
            live.swipe_start.take(),
            windows.iter().next().and_then(|w| w.cursor_position()),
        ) {
            dir = dir.or(swipe_dir(b - a));
        }
    }
    for t in touches.iter_just_released() {
        dir = dir.or(swipe_dir(t.position() - t.start_position()));
    }
    let g = &mut live.game;
    if let Some(d) = dir {
        g.mv(d);
    }
    if keys.just_pressed(KeyCode::KeyR) {
        g.restart();
    }
    if keys.just_pressed(KeyCode::KeyK) && g.won {
        g.keep_playing();
    }
}

fn tile_color(v: u32) -> Color {
    match v {
        0 => Color::srgb_u8(0x2b, 0x30, 0x3c),
        2 => Color::srgb_u8(0x3b, 0x42, 0x52),
        4 => Color::srgb_u8(0x43, 0x4c, 0x5e),
        8 => Color::srgb_u8(0xd0, 0x87, 0x70),
        16 => Color::srgb_u8(0xd9, 0x77, 0x4f),
        32 => Color::srgb_u8(0xe0, 0x61, 0x3b),
        64 => Color::srgb_u8(0xe8, 0x4a, 0x2c),
        128 => Color::srgb_u8(0xeb, 0xcb, 0x8b),
        256 => Color::srgb_u8(0xe8, 0xc2, 0x6a),
        512 => Color::srgb_u8(0xe6, 0xb8, 0x4a),
        1024 => Color::srgb_u8(0xa3, 0xbe, 0x8c),
        2048 => Color::srgb_u8(0x88, 0xc0, 0xd0),
        _ => Color::srgb_u8(0xb4, 0x8e, 0xad),
    }
}

fn draw(
    mut commands: Commands,
    old: Query<Entity, With<Drawn>>,
    live: NonSend<Live>,
    mut windows: Query<&mut Window>,
) {
    for e in &old {
        commands.entity(e).despawn();
    }
    let g = &live.game;
    let board = SIZE as f32 * CELL + (SIZE as f32 + 1.0) * GAP;
    let origin = Vec2::new(0.0, -40.0);
    commands.spawn((
        Sprite::from_color(Color::srgb_u8(0x20, 0x24, 0x2e), Vec2::splat(board)),
        Transform::from_xyz(origin.x, origin.y, 0.0),
        Drawn,
    ));
    for x in 0..SIZE {
        for y in 0..SIZE {
            let v = g.cells[x][y];
            let cx = origin.x + (x as f32 - 1.5) * (CELL + GAP);
            let cy = origin.y + (1.5 - y as f32) * (CELL + GAP);
            commands.spawn((
                Sprite::from_color(tile_color(v), Vec2::splat(CELL)),
                Transform::from_xyz(cx, cy, 1.0),
                Drawn,
            ));
            if v != 0 {
                let ink = if v <= 4 {
                    Color::srgb_u8(0xe8, 0xea, 0xf0)
                } else if v <= 64 || v > 2048 {
                    Color::WHITE
                } else {
                    Color::srgb_u8(0x22, 0x22, 0x22)
                };
                let size = if v < 100 {
                    48.0
                } else if v < 1000 {
                    40.0
                } else {
                    32.0
                };
                commands.spawn((
                    Text2d::new(v.to_string()),
                    TextFont {
                        font_size: FontSize::Px(size),
                        ..default()
                    },
                    TextColor(ink),
                    Transform::from_xyz(cx, cy, 2.0),
                    Drawn,
                ));
            }
        }
    }
    let status = if g.over {
        "  GAME OVER (R)"
    } else if g.won && !g.kept {
        "  YOU WIN! (K keep playing, R restart)"
    } else {
        ""
    };
    if let Some(mut w) = windows.iter_mut().next() {
        w.title = format!("2048  score {}  best {}{}", g.score, g.best, status);
    }
}
