//! Runner protocol: a case on stdin, the port's trace on stdout.
use game2048_core::{Game, Saved, SIZE};
use serde_json::{json, Value};
use std::io::Read;
use std::rc::Rc;

fn saved(v: &Value) -> Option<Saved> {
    if !v.is_object() {
        return None;
    }
    let mut cells = [[0; SIZE]; SIZE];
    for (x, col) in v["grid"]["cells"].as_array().unwrap().iter().enumerate() {
        for (y, t) in col.as_array().unwrap().iter().enumerate() {
            cells[x][y] = t["value"].as_u64().unwrap_or(0) as u32;
        }
    }
    Some(Saved {
        cells,
        score: v["score"].as_u64().unwrap(),
        over: v["over"].as_bool().unwrap(),
        won: v["won"].as_bool().unwrap(),
        kept: v["keepPlaying"].as_bool().unwrap(),
    })
}

fn snapshot(g: &Game) -> Value {
    json!({ "grid": g.cells, "score": g.score, "over": g.over, "won": g.won, "terminated": g.terminated(), "best": g.best })
}

fn main() {
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let c: Value = serde_json::from_str(&s).unwrap();
    let tape: Rc<Vec<f64>> = Rc::new(
        c["tape"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect(),
    );
    let mut pos = 0;
    let t = tape.clone();
    let rng = Box::new(move || {
        let v = t[pos];
        pos += 1;
        v
    });
    let mut g = Game::new(rng, saved(&c["initial"]));
    let mut trace = vec![snapshot(&g)];
    for i in c["inputs"].as_array().unwrap() {
        match i["t"].as_str().unwrap() {
            "move" => g.mv(i["d"].as_u64().unwrap() as usize),
            "restart" => g.restart(),
            "keep" => g.keep_playing(),
            other => panic!("unknown input {other}"),
        }
        trace.push(snapshot(&g));
    }
    println!("{}", json!({ "trace": trace, "tapeUsed": g.used() }));
}
