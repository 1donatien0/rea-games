//! Runner protocol: a case on stdin, the port's trace on stdout.
use blocks_core::{Game, Key, H};
use serde_json::{json, Value};
use std::io::Read;

fn snapshot(g: &Game) -> Value {
    let piece = |p: &blocks_core::Piece| json!({ "type": (p.kind as char).to_string(), "x": p.x, "y": p.y, "dir": p.dir });
    let grid: Vec<String> = (0..H)
        .map(|y| {
            g.grid[y]
                .iter()
                .map(|&c| if c == 0 { '.' } else { c as char })
                .collect()
        })
        .collect();
    json!({
        "grid": grid,
        "current": piece(&g.cur),
        "next": piece(&g.next),
        "bag": String::from_utf8_lossy(&g.bag),
        "score": g.score, "vscore": g.vscore, "rows": g.rows, "step": g.step_sec, "dt": g.dt,
        "playing": g.playing,
        "actions": g.actions.iter().map(|&a| a as u8).collect::<Vec<_>>(),
    })
}

fn key(name: &str) -> Key {
    match name {
        "left" => Key::Left,
        "right" => Key::Right,
        "up" => Key::Up,
        "down" => Key::Down,
        "esc" => Key::Esc,
        "space" => Key::Space,
        "play" => Key::Play,
        other => panic!("unknown key {other}"),
    }
}

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let c: Value = serde_json::from_str(&s).unwrap();
    let tape: Vec<f64> = c["tape"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let mut pos = 0;
    let rng = Box::new(move || {
        let v = tape[pos];
        pos += 1;
        v
    });
    let mut g = Game::new(rng, c["clock0"].as_f64().unwrap());
    let mut trace = vec![snapshot(&g)];
    for i in c["inputs"].as_array().unwrap() {
        let keys: Vec<Key> = i["keys"]
            .as_array()
            .map(|a| a.iter().map(|k| key(k.as_str().unwrap())).collect())
            .unwrap_or_default();
        g.step(i["dt"].as_f64().unwrap(), &keys);
        trace.push(snapshot(&g));
    }
    println!("{}", json!({ "trace": trace, "tapeUsed": g.used() }));
}
