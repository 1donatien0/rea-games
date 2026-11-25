//! Runner protocol: a case JSON on stdin, {trace, tapeUsed} on stdout.
use dino_core::{Dino, Input, Snapshot};
use serde_json::{json, Map, Value};
use std::cell::Cell;
use std::io::{Read, Write};
use std::rc::Rc;

fn snap(s: &Snapshot) -> Value {
    let mut o = Map::new();
    o.insert("playing".into(), json!(s.playing));
    o.insert("crashed".into(), json!(s.crashed));
    o.insert("activated".into(), json!(s.activated));
    o.insert("playingIntro".into(), json!(s.playing_intro));
    o.insert("paused".into(), json!(s.paused));
    o.insert("currentSpeed".into(), json!(s.current_speed));
    o.insert("distanceRan".into(), json!(s.distance_ran));
    o.insert("score".into(), json!(s.score));
    o.insert("highestScore".into(), json!(s.highest_score));
    o.insert("runningTime".into(), json!(s.running_time));
    o.insert("playCount".into(), json!(s.play_count));
    o.insert("time".into(), json!(s.time));
    o.insert("running".into(), json!(s.running));
    o.insert("rafPending".into(), json!(s.raf_pending));
    o.insert(
        "tRex".into(),
        json!({
            "xPos": s.x_pos, "yPos": s.y_pos, "jumping": s.jumping, "ducking": s.ducking,
            "speedDrop": s.speed_drop, "jumpVelocity": s.jump_velocity, "jumpCount": s.jump_count,
            "status": s.status, "reachedMinHeight": s.reached_min_height,
        }),
    );
    o.insert("obstacleHistory".into(), json!(s.obstacle_history));
    let obs: Vec<Value> = s
        .obstacles
        .iter()
        .map(|b| {
            json!({
                "type": b.type_name, "xPos": b.x_pos, "yPos": b.y_pos, "size": b.size, "width": b.width,
                "gap": b.gap, "speedOffset": b.speed_offset, "followed": b.followed,
            })
        })
        .collect();
    o.insert("obstacles".into(), Value::Array(obs));
    Value::Object(o)
}

fn flag(v: &Value, k: &str) -> bool {
    match v.get(k) {
        Some(Value::Bool(b)) => *b,
        _ => false,
    }
}

fn main() {
    let mut text = String::new();
    std::io::stdin()
        .read_to_string(&mut text)
        .expect("read stdin");
    let c: Value = serde_json::from_str(&text).expect("case json");
    let tape: Vec<f64> = c["tape"]
        .as_array()
        .expect("tape")
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    let used = Rc::new(Cell::new(0usize));
    let u = used.clone();
    let rng = move || {
        let i = u.get();
        if i >= tape.len() {
            eprintln!("port asked for more random numbers than the original used");
            std::process::exit(1);
        }
        u.set(i + 1);
        tape[i]
    };
    let mut g = Dino::new(Box::new(rng), c["clock0"].as_f64().unwrap_or(1000.0));
    let inputs = c["inputs"].as_array().expect("inputs");
    let mut trace = Vec::with_capacity(inputs.len() + 1);
    trace.push(snap(&g.snapshot()));
    for i in inputs {
        let input = Input {
            dt: i["dt"].as_f64().unwrap_or(0.0),
            jump: flag(i, "jump"),
            duck: flag(i, "duck"),
            jump_up: flag(i, "jumpUp"),
            duck_up: flag(i, "duckUp"),
            enter: flag(i, "enter"),
            anim_end: flag(i, "animEnd"),
        };
        g.step(&input);
        trace.push(snap(&g.snapshot()));
    }
    let out = json!({ "trace": trace, "tapeUsed": used.get() });
    let mut so = std::io::stdout().lock();
    serde_json::to_writer(&mut so, &out).unwrap();
    so.flush().unwrap();
}
