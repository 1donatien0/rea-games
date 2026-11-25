// Canvas Bird, rebuilt from games/canvas-bird/GAME.md. Pure logic: no DOM, no clock, no Math.random.
// createBird({ rng }) takes a random source and returns a game that advances one rendered frame per
// step({ dt, click }) and returns that frame's draw list (the strings described in driver.mjs).
// The clock is a number the game advances itself by dt, so a replay is exact.
export const T0 = 1000000;

const W = 640, H = 480;
const PIPES = 5, SPACING = 300, GAP = 120, MIN_OFF = -150, MAX_OFF = 50, PIPE_SPEED = 3;
const PIPE_W = 64, PIPE_H = 316;
const BIRD = { x: 70, w: 64, h: 64, startY: 20, startV: 2, force: 0.15, jump: -6, maxV: 8 };
const FRAME_MS = 1000 / 30;

export function createBird({ rng, start = T0 }) {
  let t = start;
  const now = () => Math.floor(t);
  const randInt = (lo, hi) => Math.floor(rng() * (hi - lo + 1) + lo);

  let playing = false; // a round is on screen (splash text is hidden)
  let controls = false; // taps flap and pipes score; false once the bird has hit something
  let score = 0;
  let alpha = 1, rising = false;
  let strokeStyle = "#000000", fillStyle = "#000000";
  const bg = [{ x: 0 }, { x: W }];
  const bird = { y: BIRD.startY, v: BIRD.startV, sprite: 0 };
  let spriteClock = now(); // when the sprite frame last changed
  const fallClock = now(); // set once and never moved: this is why the 30 fps gate stops mattering
  let pipes = [];
  let next = 0, last = PIPES - 1;
  let out = [];

  const addPipe = (i, off) => ({
    id: i,
    up: { x: W + i * SPACING, y: H / 2 + GAP + off },
    down: { x: W + i * SPACING, y: 0 - GAP + off },
    off,
  });
  function setupPipes() {
    next = 0; last = PIPES - 1; pipes = [];
    for (let i = 0; i < PIPES; i++) pipes.push(addPipe(i, randInt(MIN_OFF, MAX_OFF)));
  }

  function scoreCheck(p, x) {
    if (p.id === next && x + PIPE_W < BIRD.x + BIRD.w) {
      next = next === PIPES - 1 ? 0 : next + 1;
      if (controls) { score++; out.push("a:point"); }
    }
  }
  function moveUp(p) {
    p.up.x -= PIPE_SPEED;
    if (p.up.x <= -PIPE_W) {
      p.up.x = p.down.x = pipes[last].up.x + SPACING;
      p.off = randInt(MIN_OFF, MAX_OFF); // drawn y is NOT recomputed from it (see GAME.md)
      last = last === PIPES - 1 ? 0 : last + 1;
    }
    scoreCheck(p, p.up.x);
  }
  function moveDown(p) {
    p.down.x -= PIPE_SPEED;
    scoreCheck(p, p.down.x);
  }

  function collided() {
    const right = BIRD.x + BIRD.w, top = bird.y, bottom = bird.y + BIRD.h;
    const p = pipes[next];
    const px = p.down.x + 40, gapTop = p.down.y + PIPE_H, gapBottom = p.up.y;
    let hit = false;
    if (right > px && right < px + PIPE_W - 40) {
      if (top < gapTop || bottom > gapBottom) hit = true;
    }
    if (bottom < 0 || top > H) hit = true;
    if (hit && controls) out.push("a:lose");
    return hit;
  }

  function spriteFrame() {
    const n = now();
    if (n - spriteClock > FRAME_MS) {
      spriteClock = n;
      bird.sprite++;
      if (bird.sprite > 2) bird.sprite = 0;
    }
    return bird.sprite;
  }

  function draw() {
    out = [];
    out.push(`c:0:0:${W}:${H}`);
    for (const b of bg) out.push(`i:background:${b.x}:0`);
    for (const b of bg) { b.x -= 1; if (b.x <= -W) b.x = W; }
    if (!playing) {
      strokeStyle = `rgba(0,0,0,${alpha})`;
      out.push(`t:stroke:Click to start game:${W / 2 - 230}:80:${strokeStyle}`);
      fillStyle = `rgba(255,255,255,${alpha})`;
      out.push(`t:fill:Click to start game:${W / 2 - 230}:80:${fillStyle}`);
      if (alpha < 0) rising = true;
      if (alpha > 1) rising = false;
      alpha += rising ? 0.02 : -0.02;
    } else {
      for (const p of pipes) {
        out.push(`i:enemy_up:${p.up.x}:${p.up.y}`);
        out.push(`i:enemy_down:${p.down.x}:${p.down.y}`);
        moveUp(p);
        moveDown(p);
      }
      const sx = spriteFrame() * BIRD.w;
      out.push(`s:player:${sx}:0:${BIRD.w}:${BIRD.h}:${BIRD.x}:${bird.y}:${BIRD.w}:${BIRD.h}`);
      if (now() - fallClock > FRAME_MS) {
        if (bird.v < BIRD.maxV) bird.v += BIRD.force;
        bird.y += bird.v;
      }
      if (collided()) {
        controls = false;
        if (bird.y - BIRD.h > H) playing = false;
      }
      fillStyle = "black";
      out.push(`t:stroke:${score}:${W / 2 - 11}:51:${strokeStyle}`);
      fillStyle = "white";
      out.push(`t:fill:${score}:${W / 2 - 10}:50:${fillStyle}`);
    }
    return out;
  }

  function click() {
    if (controls) bird.v = BIRD.jump;
    if (!playing) {
      score = 0; bird.v = BIRD.startV; bird.y = BIRD.startY;
      setupPipes();
      playing = true;
      controls = true;
    }
  }

  return {
    // the frame the page draws when it loads, before any step
    load: () => draw(),
    step({ dt, click: clicked = false }) {
      if (clicked) click();
      t += dt;
      return draw();
    },
    // what a renderer with its own art needs
    view: () => ({ playing, controls, score, alpha, bird: { x: BIRD.x, y: bird.y, v: bird.v, sprite: bird.sprite }, pipes, next, bg }),
  };
}
