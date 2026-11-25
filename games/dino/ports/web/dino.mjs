// Chrome Dino gameplay, rebuilt from games/dino/GAME.md. Pure logic: no DOM, no clock, no Math.random.
//   rng()  returns the next gameplay random number in [0, 1) (the recorded tape, or Math.random)
//   step({dt, jump, duck, jumpUp, duckUp, enter, animEnd})  one browser frame:
//          the clock moves by dt ms, the key events of the frame run, then the pending
//          requestAnimationFrame callbacks run (there can be two, see GAME.md "update chains").
// Numbers are computed with the same operations in the same order as the original, so the trace
// matches bit for bit.

export const WIDTH = 600;
export const HEIGHT = 150;
const FPS = 60;

const CFG = {
  ACCELERATION: 0.001, BOTTOM_PAD: 10, CLEAR_TIME: 3000, GAMEOVER_CLEAR_TIME: 750, GAP_COEFFICIENT: 0.6,
  MAX_OBSTACLE_DUPLICATION: 2, MAX_SPEED: 13, SPEED: 6,
};
const TREX = {
  DROP_VELOCITY: -5, GRAVITY: 0.6, HEIGHT: 47, INIITAL_JUMP_VELOCITY: -10, INTRO_DURATION: 1500,
  MAX_JUMP_HEIGHT: 30, MIN_JUMP_HEIGHT: 30, SPEED_DROP_COEFFICIENT: 3, START_X_POS: 50, WIDTH: 44,
};
// ms per animation frame of each status; the jump physics divides the frame time by it
const MS_PER_FRAME = { WAITING: 1000 / 3, RUNNING: 1000 / 12, CRASHED: 1000 / 60, JUMPING: 1000 / 60, DUCKING: 1000 / 8 };

const box = (x, y, width, height) => ({ x, y, width, height });
const TREX_BOXES = {
  DUCKING: [box(1, 18, 55, 25)],
  RUNNING: [box(22, 0, 17, 16), box(1, 18, 30, 9), box(10, 35, 14, 8), box(1, 24, 29, 5), box(5, 30, 21, 4), box(9, 34, 15, 4)],
};
const OBSTACLE_TYPES = [
  { type: "CACTUS_SMALL", width: 17, height: 35, yPos: 105, multipleSpeed: 4, minGap: 120, minSpeed: 0,
    boxes: [box(0, 7, 5, 27), box(4, 0, 6, 34), box(10, 4, 7, 14)] },
  { type: "CACTUS_LARGE", width: 25, height: 50, yPos: 90, multipleSpeed: 7, minGap: 120, minSpeed: 0,
    boxes: [box(0, 12, 7, 38), box(8, 0, 7, 49), box(13, 10, 10, 38)] },
  { type: "PTERODACTYL", width: 46, height: 40, yPos: [100, 75, 50], multipleSpeed: 999, minSpeed: 8.5, minGap: 150,
    speedOffset: 0.8,
    boxes: [box(15, 15, 16, 5), box(18, 21, 24, 6), box(2, 14, 4, 3), box(6, 10, 4, 7), box(10, 8, 6, 9)] },
];
const MAX_GAP_COEFFICIENT = 1.5;
const MAX_OBSTACLE_LENGTH = 3;

const boxCompare = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.height + a.y > b.y;
const adjusted = (b, by) => box(b.x + by.x, b.y + by.y, b.width, b.height);

class Obstacle {
  constructor(rng, type, speed, xOffset) {
    this.typeConfig = type;
    this.size = getRandomNum(rng, 1, MAX_OBSTACLE_LENGTH);
    this.remove = false;
    this.xPos = WIDTH + (xOffset || 0);
    this.yPos = 0;
    this.width = 0;
    this.gap = 0;
    this.speedOffset = 0;
    this.followingObstacleCreated = false;
    this.boxes = type.boxes.map((b) => box(b.x, b.y, b.width, b.height));
    // only allow groups when the speed is high enough
    if (this.size > 1 && type.multipleSpeed > speed) this.size = 1;
    this.width = type.width * this.size;
    if (Array.isArray(type.yPos)) this.yPos = type.yPos[getRandomNum(rng, 0, type.yPos.length - 1)];
    else this.yPos = type.yPos;
    // the middle box grows with the group, the last one moves to the end
    if (this.size > 1) {
      this.boxes[1].width = this.width - this.boxes[0].width - this.boxes[2].width;
      this.boxes[2].x = this.width - this.boxes[2].width;
    }
    if (type.speedOffset) this.speedOffset = rng() > 0.5 ? type.speedOffset : -type.speedOffset;
    const minGap = Math.round(this.width * speed + type.minGap * CFG.GAP_COEFFICIENT);
    const maxGap = Math.round(minGap * MAX_GAP_COEFFICIENT);
    this.gap = getRandomNum(rng, minGap, maxGap);
  }

  update(deltaTime, speed) {
    if (!this.remove) {
      if (this.typeConfig.speedOffset) speed += this.speedOffset;
      this.xPos -= Math.floor((speed * FPS / 1000) * deltaTime);
      if (!this.isVisible()) this.remove = true;
    }
  }

  isVisible() { return this.xPos + this.width > 0; }
}

function getRandomNum(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

class Trex {
  constructor() {
    this.xPos = 0;
    this.groundYPos = HEIGHT - TREX.HEIGHT - CFG.BOTTOM_PAD;
    this.yPos = this.groundYPos;
    this.minJumpHeight = this.groundYPos - TREX.MIN_JUMP_HEIGHT;
    this.status = "WAITING";
    this.jumping = false;
    this.ducking = false;
    this.jumpVelocity = 0;
    this.reachedMinHeight = false;
    this.speedDrop = false;
    this.jumpCount = 0;
    this.playingIntro = false;
  }

  update(deltaTime, status) {
    if (status) this.status = status;
    // the intro slides the dino in from the left
    if (this.playingIntro && this.xPos < TREX.START_X_POS) this.xPos += Math.round((TREX.START_X_POS / TREX.INTRO_DURATION) * deltaTime);
    // the original's draw() shifts a crashed, ducking dino one pixel (it draws the standing sprite)
    if (this.status === "CRASHED" && this.ducking) this.xPos++;
    // a speed drop turns into a duck once the dino is on the ground
    if (this.speedDrop && this.yPos == this.groundYPos) {
      this.speedDrop = false;
      this.setDuck(true);
    }
  }

  startJump(speed) {
    if (!this.jumping) {
      this.update(0, "JUMPING");
      this.jumpVelocity = TREX.INIITAL_JUMP_VELOCITY - speed / 10;
      this.jumping = true;
      this.reachedMinHeight = false;
      this.speedDrop = false;
    }
  }

  endJump() {
    if (this.reachedMinHeight && this.jumpVelocity < TREX.DROP_VELOCITY) this.jumpVelocity = TREX.DROP_VELOCITY;
  }

  updateJump(deltaTime) {
    const msPerFrame = MS_PER_FRAME[this.status];
    const framesElapsed = deltaTime / msPerFrame;
    if (this.speedDrop) this.yPos += Math.round(this.jumpVelocity * TREX.SPEED_DROP_COEFFICIENT * framesElapsed);
    else this.yPos += Math.round(this.jumpVelocity * framesElapsed);
    this.jumpVelocity += TREX.GRAVITY * framesElapsed;
    if (this.yPos < this.minJumpHeight || this.speedDrop) this.reachedMinHeight = true;
    if (this.yPos < TREX.MAX_JUMP_HEIGHT || this.speedDrop) this.endJump();
    if (this.yPos > this.groundYPos) {
      this.reset();
      this.jumpCount++;
    }
    this.update(deltaTime);
  }

  setSpeedDrop() {
    this.speedDrop = true;
    this.jumpVelocity = 1;
  }

  setDuck(isDucking) {
    if (isDucking && this.status != "DUCKING") {
      this.update(0, "DUCKING");
      this.ducking = true;
    } else if (this.status == "DUCKING") {
      this.update(0, "RUNNING");
      this.ducking = false;
    }
  }

  reset() {
    this.yPos = this.groundYPos;
    this.jumpVelocity = 0;
    this.jumping = false;
    this.ducking = false;
    this.update(0, "RUNNING");
    this.speedDrop = false;
    this.jumpCount = 0;
  }
}

function checkForCollision(obstacle, tRex) {
  const tRexBox = box(tRex.xPos + 1, tRex.yPos + 1, TREX.WIDTH - 2, TREX.HEIGHT - 2);
  const obstacleBox = box(obstacle.xPos + 1, obstacle.yPos + 1, obstacle.typeConfig.width * obstacle.size - 2, obstacle.typeConfig.height - 2);
  if (boxCompare(tRexBox, obstacleBox)) {
    const tBoxes = tRex.ducking ? TREX_BOXES.DUCKING : TREX_BOXES.RUNNING;
    for (let t = 0; t < tBoxes.length; t++) {
      for (let i = 0; i < obstacle.boxes.length; i++) {
        if (boxCompare(adjusted(tBoxes[t], tRexBox), adjusted(obstacle.boxes[i], obstacleBox))) return true;
      }
    }
  }
  return false;
}

export class Dino {
  constructor({ rng, clock0 = 1000 }) {
    this.rng = rng;
    this.now = clock0;
    this.tRex = new Trex();
    this.obstacles = [];
    this.obstacleHistory = [];
    this.distanceRan = 0;
    this.highestScore = 0;
    this.time = 0;
    this.runningTime = 0;
    this.msPerFrame = 1000 / FPS;
    this.currentSpeed = CFG.SPEED;
    this.activated = false;
    this.playing = false;
    this.crashed = false;
    this.paused = false;
    this.playingIntro = false;
    this.playCount = 0;
    this.introListener = false;
    // requestAnimationFrame bookkeeping: pending callbacks, the frame being run, last id handed out
    this.queue = [];
    this.running = null;
    this.nextId = 1;
    this.raqId = 0;
    this.updatePending = false;
    // Runner.init ends with one update(): it starts the waiting-for-input loop
    this.update();
  }

  // ---- requestAnimationFrame ------------------------------------------------------------
  requestFrame() {
    const id = this.nextId++;
    this.queue.push({ id });
    return id;
  }
  cancelFrame(id) {
    this.queue = this.queue.filter((q) => q.id !== id);
    if (this.running) for (const q of this.running) if (q.id === id) q.cancelled = true;
  }
  scheduleNextUpdate() {
    if (!this.updatePending) {
      this.updatePending = true;
      this.raqId = this.requestFrame();
    }
  }

  // ---- one frame ------------------------------------------------------------------------
  step(input) {
    this.now = this.now + input.dt;
    if (input.jump) this.keyDown("jump");
    if (input.duck) this.keyDown("duck");
    if (input.jumpUp) this.keyUp("jump");
    if (input.duckUp) this.keyUp("duck");
    if (input.enter) this.keyUp("enter");
    if (input.animEnd && this.introListener) this.startGame();
    this.running = this.queue;
    this.queue = [];
    for (const q of this.running) if (!q.cancelled) this.update();
    this.running = null;
  }

  // ---- Runner ---------------------------------------------------------------------------
  update() {
    this.updatePending = false;
    const now = this.now;
    let deltaTime = now - (this.time || now);
    this.time = now;

    if (this.playing) {
      if (this.tRex.jumping) this.tRex.updateJump(deltaTime);
      this.runningTime += deltaTime;
      const hasObstacles = this.runningTime > CFG.CLEAR_TIME;

      // the first landing starts the intro
      if (this.tRex.jumpCount == 1 && !this.playingIntro) this.playIntro();

      // the horizon does not move until the intro is over
      if (this.playingIntro) {
        this.updateHorizon(0, this.currentSpeed, hasObstacles);
      } else {
        deltaTime = !this.activated ? 0 : deltaTime;
        this.updateHorizon(deltaTime, this.currentSpeed, hasObstacles);
      }

      const collision = hasObstacles && checkForCollision(this.obstacles[0], this.tRex);
      if (!collision) {
        this.distanceRan += this.currentSpeed * deltaTime / this.msPerFrame;
        if (this.currentSpeed < CFG.MAX_SPEED) this.currentSpeed += CFG.ACCELERATION;
      } else {
        this.gameOver();
      }
    }

    // (the original also keeps this loop alive while !activated && blinkCount < 3; the port
    // assumes fewer than 3 blinks happen before the first key, which the recording checks)
    if (this.playing || !this.activated) {
      this.tRex.update(deltaTime);
      this.scheduleNextUpdate();
    }
  }

  playIntro() {
    if (!this.activated && !this.crashed) {
      this.playingIntro = true;
      this.tRex.playingIntro = true;
      this.introListener = true;
      this.playing = true;
      this.activated = true;
    } else if (this.crashed) {
      this.restart();
    }
  }

  startGame() {
    this.runningTime = 0;
    this.playingIntro = false;
    this.tRex.playingIntro = false;
    this.playCount++;
  }

  gameOver() {
    this.stop();
    this.crashed = true;
    this.tRex.update(100, "CRASHED");
    if (this.distanceRan > this.highestScore) this.highestScore = Math.ceil(this.distanceRan);
    this.time = this.now;
  }

  stop() {
    this.playing = false;
    this.paused = true;
    this.cancelFrame(this.raqId);
    this.raqId = 0;
  }

  play() {
    if (!this.crashed) {
      this.playing = true;
      this.paused = false;
      this.tRex.update(0, "RUNNING");
      this.time = this.now;
      this.update();
    }
  }

  restart() {
    if (!this.raqId) {
      this.playCount++;
      this.runningTime = 0;
      this.playing = true;
      this.crashed = false;
      this.distanceRan = 0;
      this.currentSpeed = CFG.SPEED; // setSpeed(SPEED) at width 600
      this.time = this.now;
      this.obstacles = []; // Horizon.reset (obstacleHistory is kept)
      this.tRex.reset();
      this.update();
    }
  }

  isRunning() { return !!this.raqId; }

  // ---- keys -----------------------------------------------------------------------------
  keyDown(which) {
    if (which === "jump" && !this.crashed) {
      if (!this.playing) {
        this.playing = true;
        this.update();
      }
      if (!this.tRex.jumping && !this.tRex.ducking) this.tRex.startJump(this.currentSpeed);
    }
    if (which === "duck" && this.playing && !this.crashed) {
      if (this.tRex.jumping) this.tRex.setSpeedDrop();
      else if (!this.tRex.jumping && !this.tRex.ducking) this.tRex.setDuck(true);
    }
  }

  keyUp(which) {
    const isJumpKey = which === "jump";
    if (this.isRunning() && isJumpKey) {
      this.tRex.endJump();
    } else if (which === "duck") {
      this.tRex.speedDrop = false;
      this.tRex.setDuck(false);
    } else if (this.crashed) {
      const deltaTime = this.now - this.time;
      if (which === "enter" || (deltaTime >= CFG.GAMEOVER_CLEAR_TIME && isJumpKey)) this.restart();
    } else if (this.paused && isJumpKey) {
      this.tRex.reset();
      this.play();
    }
  }

  // ---- Horizon --------------------------------------------------------------------------
  updateHorizon(deltaTime, currentSpeed, updateObstacles) {
    if (updateObstacles) this.updateObstacles(deltaTime, currentSpeed);
  }

  updateObstacles(deltaTime, currentSpeed) {
    const updated = this.obstacles.slice(0);
    for (let i = 0; i < this.obstacles.length; i++) {
      const obstacle = this.obstacles[i];
      obstacle.update(deltaTime, currentSpeed);
      if (obstacle.remove) updated.shift();
    }
    this.obstacles = updated;
    if (this.obstacles.length > 0) {
      const last = this.obstacles[this.obstacles.length - 1];
      if (last && !last.followingObstacleCreated && last.isVisible() && (last.xPos + last.width + last.gap) < WIDTH) {
        this.addNewObstacle(currentSpeed);
        last.followingObstacleCreated = true;
      }
    } else {
      this.addNewObstacle(currentSpeed);
    }
  }

  addNewObstacle(currentSpeed) {
    const type = OBSTACLE_TYPES[getRandomNum(this.rng, 0, OBSTACLE_TYPES.length - 1)];
    if (this.duplicateObstacleCheck(type.type) || currentSpeed < type.minSpeed) {
      this.addNewObstacle(currentSpeed);
    } else {
      this.obstacles.push(new Obstacle(this.rng, type, currentSpeed, type.width));
      this.obstacleHistory.unshift(type.type);
      if (this.obstacleHistory.length > 1) this.obstacleHistory.splice(CFG.MAX_OBSTACLE_DUPLICATION);
    }
  }

  duplicateObstacleCheck(next) {
    let count = 0;
    for (let i = 0; i < this.obstacleHistory.length; i++) count = this.obstacleHistory[i] == next ? count + 1 : 0;
    return count >= CFG.MAX_OBSTACLE_DUPLICATION;
  }

  // ---- what the recording compares ------------------------------------------------------
  snapshot() {
    const x = this.tRex;
    const d = Math.ceil(this.distanceRan);
    return {
      playing: this.playing,
      crashed: this.crashed,
      activated: this.activated,
      playingIntro: !!this.playingIntro,
      paused: this.paused,
      currentSpeed: this.currentSpeed,
      distanceRan: this.distanceRan,
      score: d ? Math.round(d * 0.025) : 0,
      highestScore: this.highestScore,
      runningTime: this.runningTime,
      playCount: this.playCount,
      time: this.time,
      running: !!this.raqId,
      rafPending: this.queue.length,
      tRex: {
        xPos: x.xPos, yPos: x.yPos, jumping: x.jumping, ducking: x.ducking, speedDrop: x.speedDrop,
        jumpVelocity: x.jumpVelocity, jumpCount: x.jumpCount, status: x.status, reachedMinHeight: x.reachedMinHeight,
      },
      obstacleHistory: this.obstacleHistory.slice(),
      obstacles: this.obstacles.map((o) => ({
        type: o.typeConfig.type, xPos: o.xPos, yPos: o.yPos, size: o.size, width: o.width, gap: o.gap,
        speedOffset: o.speedOffset, followed: o.followingObstacleCreated,
      })),
    };
  }
}
