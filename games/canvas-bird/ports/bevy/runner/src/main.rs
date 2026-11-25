//! Runner protocol: a case JSON on stdin, {trace, tapeUsed} on stdout.
use bird_core::{Bird, Call, Style, Text, T0};
use serde_json::Value;
use std::cell::Cell;
use std::io::{Read, Write};
use std::rc::Rc;

/// A number printed the way JavaScript prints it (shortest digits; integers without ".0").
fn num(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    if x.fract() == 0.0 && x.abs() < 1e21 {
        return format!("{}", x as i128);
    }
    serde_json::Number::from_f64(x)
        .map(|n| n.to_string())
        .unwrap_or_default()
}

fn style(s: &Style) -> String {
    match s {
        Style::White => "white".into(),
        Style::Rgba(c, a) => format!("rgba({c},{c},{c},{})", num(*a)),
    }
}

fn call(c: &Call) -> String {
    match c {
        Call::Clear => "c:0:0:640:480".into(),
        Call::Background(x) => format!("i:background:{}:0", num(*x)),
        Call::EnemyUp(x, y) => format!("i:enemy_up:{}:{}", num(*x), num(*y)),
        Call::EnemyDown(x, y) => format!("i:enemy_down:{}:{}", num(*x), num(*y)),
        Call::Player(sx, _, y) => format!("s:player:{}:0:64:64:70:{}:64:64", num(*sx), num(*y)),
        Call::Text {
            stroke,
            text,
            x,
            y,
            style: st,
        } => {
            let t = match text {
                Text::Splash => "Click to start game".to_string(),
                Text::Score(n) => n.to_string(),
            };
            format!(
                "t:{}:{}:{}:{}:{}",
                if *stroke { "stroke" } else { "fill" },
                t,
                num(*x),
                num(*y),
                style(st)
            )
        }
        Call::Point => "a:point".into(),
        Call::Lose => "a:lose".into(),
    }
}

fn frame(calls: &[Call]) -> Value {
    Value::Array(calls.iter().map(|c| Value::String(call(c))).collect())
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
    let mut g = Bird::new(Box::new(rng), T0);
    let inputs = c["inputs"].as_array().expect("inputs");
    let mut trace = Vec::with_capacity(inputs.len() + 1);
    trace.push(frame(&g.load()));
    for i in inputs {
        let dt = i["dt"].as_f64().unwrap_or(0.0);
        let click = matches!(i.get("click"), Some(Value::Bool(true)));
        trace.push(frame(&g.step(dt, click)));
    }
    let mut out = serde_json::Map::new();
    out.insert("trace".into(), Value::Array(trace));
    out.insert("tapeUsed".into(), Value::from(used.get()));
    let mut so = std::io::stdout().lock();
    serde_json::to_writer(&mut so, &Value::Object(out)).unwrap();
    so.flush().unwrap();
}
