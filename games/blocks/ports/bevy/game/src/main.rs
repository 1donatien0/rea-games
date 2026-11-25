//! Playable Blocks: blocks-core runs the rules, Bevy draws flat-colour squares.
//! Left/right move, Up rotates, Down soft-drops, Space starts (and restarts after a loss), Esc ends the game.
use bevy::prelude::*;
use blocks_core::{cells_of, Game, Key, H, T0, W};

const CELL: f32 = 28.0;

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
}

#[derive(Component)]
struct Drawn;

fn main() {
    let mut p = Prng::from_clock();
    let game = Game::new(Box::new(move || p.next()), T0);
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Blocks".into(),
                resolution: (520u32, 640u32).into(),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::srgb_u8(0x14, 0x16, 0x1c)))
        .insert_non_send(Live { game })
        .add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(Update, (frame, draw).chain())
        .run();
}

fn frame(keys: Res<ButtonInput<KeyCode>>, time: Res<Time>, mut live: NonSendMut<Live>) {
    let mut pressed = Vec::new();
    for (code, key) in [
        (KeyCode::ArrowLeft, Key::Left),
        (KeyCode::ArrowRight, Key::Right),
        (KeyCode::ArrowUp, Key::Up),
        (KeyCode::ArrowDown, Key::Down),
        (KeyCode::Escape, Key::Esc),
        (KeyCode::Space, Key::Space),
    ] {
        if keys.just_pressed(code) {
            pressed.push(key);
        }
    }
    // R restarts at any time, like the start link
    if keys.just_pressed(KeyCode::KeyR) {
        pressed.push(Key::Play);
    }
    live.game.step(time.delta_secs_f64() * 1000.0, &pressed);
}

fn colour(kind: u8) -> Color {
    match kind {
        b'i' => Color::srgb_u8(0x88, 0xc0, 0xd0),
        b'j' => Color::srgb_u8(0x5e, 0x81, 0xac),
        b'l' => Color::srgb_u8(0xd0, 0x87, 0x70),
        b'o' => Color::srgb_u8(0xeb, 0xcb, 0x8b),
        b's' => Color::srgb_u8(0xa3, 0xbe, 0x8c),
        b't' => Color::srgb_u8(0xb4, 0x8e, 0xad),
        _ => Color::srgb_u8(0xbf, 0x61, 0x6a),
    }
}

fn square(commands: &mut Commands, kind: u8, x: f32, y: f32, z: f32) {
    commands.spawn((
        Sprite::from_color(colour(kind), Vec2::splat(CELL - 2.0)),
        Transform::from_xyz(x, y, z),
        Drawn,
    ));
}

fn label(commands: &mut Commands, text: String, x: f32, y: f32, size: f32) {
    commands.spawn((
        Text2d::new(text),
        TextFont {
            font_size: FontSize::Px(size),
            ..default()
        },
        TextColor(Color::srgb_u8(0xe8, 0xea, 0xf0)),
        Transform::from_xyz(x, y, 2.0),
        Drawn,
    ));
}

fn draw(mut commands: Commands, old: Query<Entity, With<Drawn>>, live: NonSend<Live>) {
    for e in &old {
        commands.entity(e).despawn();
    }
    let g = &live.game;
    let bw = W as f32 * CELL;
    let bh = H as f32 * CELL;
    let ox = -90.0 - bw / 2.0; // court's left edge
    let top = bh / 2.0; // court's top edge
    commands.spawn((
        Sprite::from_color(Color::srgb_u8(0x20, 0x24, 0x2e), Vec2::new(bw, bh)),
        Transform::from_xyz(ox + bw / 2.0, 0.0, 0.0),
        Drawn,
    ));
    let at = |cx: i32, cy: i32| {
        (
            ox + (cx as f32 + 0.5) * CELL,
            top - (cy as f32 + 0.5) * CELL,
        )
    };
    for (y, row) in g.grid.iter().enumerate() {
        for (x, &k) in row.iter().enumerate() {
            if k != 0 {
                let (px, py) = at(x as i32, y as i32);
                square(&mut commands, k, px, py, 1.0);
            }
        }
    }
    let c = g.cur;
    for (cx, cy) in cells_of(c.kind, c.x, c.y, c.dir) {
        let (px, py) = at(cx, cy);
        square(&mut commands, c.kind, px, py, 1.5);
    }
    // next-piece preview and score text on the right
    let px0 = ox + bw + 40.0;
    label(&mut commands, "NEXT".into(), px0 + 60.0, top - 20.0, 24.0);
    let n = g.next;
    for (cx, cy) in cells_of(n.kind, 0, 0, n.dir) {
        square(
            &mut commands,
            n.kind,
            px0 + 20.0 + cx as f32 * CELL,
            top - 70.0 - cy as f32 * CELL,
            1.0,
        );
    }
    label(
        &mut commands,
        format!("SCORE\n{}", g.vscore),
        px0 + 60.0,
        top - 220.0,
        24.0,
    );
    label(
        &mut commands,
        format!("ROWS\n{}", g.rows),
        px0 + 60.0,
        top - 300.0,
        24.0,
    );
    if !g.playing {
        label(
            &mut commands,
            "SPACE to play\narrows, Esc ends".into(),
            ox + bw / 2.0,
            0.0,
            24.0,
        );
    }
}
