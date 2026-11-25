# Chrome Dino rules in GDScript, written from games/dino/GAME.md and checked against ports/web/dino.mjs.
# Pure logic: no engine time, no engine randomness unless `live` is set. Every number is a float and
# every operation runs in the order the JavaScript port uses, so the trace matches bit for bit.
#   Dino.new(tape, clock0, live)   tape: recorded gameplay randoms; live: draw from randf() instead
#   step(dt, flags)                one browser frame, flags are the F_* bits below
extends RefCounted

const WIDTH := 600.0
const HEIGHT := 150.0
const FPS := 60.0

const F_JUMP := 1
const F_DUCK := 2
const F_JUMP_UP := 4
const F_DUCK_UP := 8
const F_ENTER := 16
const F_ANIM_END := 32

const ACCELERATION := 0.001
const BOTTOM_PAD := 10.0
const CLEAR_TIME := 3000.0
const GAMEOVER_CLEAR_TIME := 750.0
const GAP_COEFFICIENT := 0.6
const MAX_OBSTACLE_DUPLICATION := 2
const MAX_SPEED := 13.0
const SPEED := 6.0

const T_DROP_VELOCITY := -5.0
const T_GRAVITY := 0.6
const T_HEIGHT := 47.0
const T_INITIAL_JUMP_VELOCITY := -10.0
const T_INTRO_DURATION := 1500.0
const T_MAX_JUMP_HEIGHT := 30.0
const T_MIN_JUMP_HEIGHT := 30.0
const T_SPEED_DROP_COEFFICIENT := 3.0
const T_START_X_POS := 50.0
const T_WIDTH := 44.0

const MAX_GAP_COEFFICIENT := 1.5
const MAX_OBSTACLE_LENGTH := 3

# boxes are [x, y, width, height]
const TREX_BOXES_DUCKING := [[1.0, 18.0, 55.0, 25.0]]
const TREX_BOXES_RUNNING := [[22.0, 0.0, 17.0, 16.0], [1.0, 18.0, 30.0, 9.0], [10.0, 35.0, 14.0, 8.0],
	[1.0, 24.0, 29.0, 5.0], [5.0, 30.0, 21.0, 4.0], [9.0, 34.0, 15.0, 4.0]]
const OBSTACLE_TYPES := [
	{"type": "CACTUS_SMALL", "width": 17.0, "height": 35.0, "yPos": [105.0], "multipleSpeed": 4.0, "minGap": 120.0,
		"minSpeed": 0.0, "speedOffset": 0.0, "boxes": [[0.0, 7.0, 5.0, 27.0], [4.0, 0.0, 6.0, 34.0], [10.0, 4.0, 7.0, 14.0]]},
	{"type": "CACTUS_LARGE", "width": 25.0, "height": 50.0, "yPos": [90.0], "multipleSpeed": 7.0, "minGap": 120.0,
		"minSpeed": 0.0, "speedOffset": 0.0, "boxes": [[0.0, 12.0, 7.0, 38.0], [8.0, 0.0, 7.0, 49.0], [13.0, 10.0, 10.0, 38.0]]},
	{"type": "PTERODACTYL", "width": 46.0, "height": 40.0, "yPos": [100.0, 75.0, 50.0], "multipleSpeed": 999.0, "minGap": 150.0,
		"minSpeed": 8.5, "speedOffset": 0.8,
		"boxes": [[15.0, 15.0, 16.0, 5.0], [18.0, 21.0, 24.0, 6.0], [2.0, 14.0, 4.0, 3.0], [6.0, 10.0, 4.0, 7.0], [10.0, 8.0, 6.0, 9.0]]},
]

# ---- state --------------------------------------------------------------------------------
var tape: Array = []
var used := 0
var live := false
var overrun := false # the port asked for more tape than recorded (the runner reports it)

var now := 0.0
var obstacles: Array = [] # of Obstacle
var obstacle_history: Array = []
var distance_ran := 0.0
var highest_score := 0.0
var time := 0.0
var running_time := 0.0
var ms_per_frame := 1000.0 / FPS
var current_speed := SPEED
var activated := false
var playing := false
var crashed := false
var paused := false
var playing_intro := false
var play_count := 0.0
var intro_listener := false

# requestAnimationFrame bookkeeping: pending callbacks [id, cancelled], the frame being run, last id
var queue: Array = []
var running_q = null
var next_id := 1
var raq_id := 0
var update_pending := false

# dino
var t_x := 0.0
var t_ground := HEIGHT - T_HEIGHT - BOTTOM_PAD
var t_y := 0.0
var t_min_jump := 0.0
var t_status := "WAITING"
var t_jumping := false
var t_ducking := false
var t_jump_velocity := 0.0
var t_reached_min := false
var t_speed_drop := false
var t_jump_count := 0.0
var t_playing_intro := false

class Obstacle:
	var type_cfg: Dictionary
	var size := 1.0
	var remove := false
	var x := 0.0
	var y := 0.0
	var width := 0.0
	var gap := 0.0
	var speed_offset := 0.0
	var followed := false
	var boxes: Array = []

	func is_visible() -> bool:
		return x + width > 0.0

	func update(delta_time: float, speed: float) -> void:
		if not remove:
			if type_cfg["speedOffset"] != 0.0:
				speed += speed_offset
			x -= floorf((speed * 60.0 / 1000.0) * delta_time)
			if not is_visible():
				remove = true

func _init(p_tape: Array = [], clock0 := 1000.0, p_live := false) -> void:
	tape = p_tape
	live = p_live
	now = clock0
	t_y = t_ground
	t_min_jump = t_ground - T_MIN_JUMP_HEIGHT
	# Runner.init ends with one update(): it starts the waiting-for-input loop
	update()

# JavaScript's Math.round: halves go up (GDScript's round() sends them away from zero)
static func js_round(v: float) -> float:
	var f := floorf(v)
	return f + 1.0 if v - f >= 0.5 else f

func rng() -> float:
	if live:
		return randf()
	if used >= tape.size():
		overrun = true
		return 0.0
	var v: float = tape[used]
	used += 1
	return v

func random_num(lo: float, hi: float) -> float:
	return floorf(rng() * (hi - lo + 1.0)) + lo

# ---- requestAnimationFrame ----------------------------------------------------------------
func request_frame() -> int:
	var id := next_id
	next_id += 1
	queue.append([id, false])
	return id

func cancel_frame(id: int) -> void:
	var kept := []
	for q in queue:
		if q[0] != id:
			kept.append(q)
	queue = kept
	if running_q != null:
		for q in running_q:
			if q[0] == id:
				q[1] = true

func schedule_next_update() -> void:
	if not update_pending:
		update_pending = true
		raq_id = request_frame()

# ---- one frame ----------------------------------------------------------------------------
func step(dt: float, flags: int) -> void:
	now = now + dt
	if flags & F_JUMP: key_down("jump")
	if flags & F_DUCK: key_down("duck")
	if flags & F_JUMP_UP: key_up("jump")
	if flags & F_DUCK_UP: key_up("duck")
	if flags & F_ENTER: key_up("enter")
	if (flags & F_ANIM_END) and intro_listener:
		start_game()
	running_q = queue
	queue = []
	for q in running_q:
		if not q[1]:
			update()
	running_q = null

# ---- Runner -------------------------------------------------------------------------------
func update() -> void:
	update_pending = false
	var n := now
	var delta_time := n - (time if time != 0.0 else n)
	time = n

	if playing:
		if t_jumping:
			trex_update_jump(delta_time)
		running_time += delta_time
		var has_obstacles := running_time > CLEAR_TIME

		# the first landing starts the intro
		if t_jump_count == 1.0 and not playing_intro:
			play_intro()

		# the horizon does not move until the intro is over
		if playing_intro:
			update_obstacles_if(0.0, current_speed, has_obstacles)
		else:
			delta_time = delta_time if activated else 0.0
			update_obstacles_if(delta_time, current_speed, has_obstacles)

		var collision := has_obstacles and check_for_collision()
		if not collision:
			distance_ran += current_speed * delta_time / ms_per_frame
			if current_speed < MAX_SPEED:
				current_speed += ACCELERATION
		else:
			game_over()

	if playing or not activated:
		trex_update(delta_time)
		schedule_next_update()

func play_intro() -> void:
	if not activated and not crashed:
		playing_intro = true
		t_playing_intro = true
		intro_listener = true
		playing = true
		activated = true
	elif crashed:
		restart()

func start_game() -> void:
	running_time = 0.0
	playing_intro = false
	t_playing_intro = false
	play_count += 1.0

func game_over() -> void:
	stop()
	crashed = true
	trex_update(100.0, "CRASHED")
	if distance_ran > highest_score:
		highest_score = ceilf(distance_ran)
	time = now

func stop() -> void:
	playing = false
	paused = true
	cancel_frame(raq_id)
	raq_id = 0

func play() -> void:
	if not crashed:
		playing = true
		paused = false
		trex_update(0.0, "RUNNING")
		time = now
		update()

func restart() -> void:
	if raq_id == 0:
		play_count += 1.0
		running_time = 0.0
		playing = true
		crashed = false
		distance_ran = 0.0
		current_speed = SPEED
		time = now
		obstacles = [] # Horizon.reset (obstacle_history is kept)
		trex_reset()
		update()

func is_running() -> bool:
	return raq_id != 0

# ---- keys ---------------------------------------------------------------------------------
func key_down(which: String) -> void:
	if which == "jump" and not crashed:
		if not playing:
			playing = true
			update()
		if not t_jumping and not t_ducking:
			trex_start_jump(current_speed)
	if which == "duck" and playing and not crashed:
		if t_jumping:
			trex_set_speed_drop()
		elif not t_jumping and not t_ducking:
			trex_set_duck(true)

func key_up(which: String) -> void:
	var is_jump := which == "jump"
	if is_running() and is_jump:
		trex_end_jump()
	elif which == "duck":
		t_speed_drop = false
		trex_set_duck(false)
	elif crashed:
		var delta_time := now - time
		if which == "enter" or (delta_time >= GAMEOVER_CLEAR_TIME and is_jump):
			restart()
	elif paused and is_jump:
		trex_reset()
		play()

# ---- Trex ---------------------------------------------------------------------------------
func trex_update(delta_time: float, status := "") -> void:
	if status != "":
		t_status = status
	# the intro slides the dino in from the left
	if t_playing_intro and t_x < T_START_X_POS:
		t_x += js_round((T_START_X_POS / T_INTRO_DURATION) * delta_time)
	# the original's draw() shifts a crashed, ducking dino one pixel
	if t_status == "CRASHED" and t_ducking:
		t_x += 1.0
	# a speed drop turns into a duck once the dino is on the ground
	if t_speed_drop and t_y == t_ground:
		t_speed_drop = false
		trex_set_duck(true)

func trex_start_jump(speed: float) -> void:
	if not t_jumping:
		trex_update(0.0, "JUMPING")
		t_jump_velocity = T_INITIAL_JUMP_VELOCITY - speed / 10.0
		t_jumping = true
		t_reached_min = false
		t_speed_drop = false

func trex_end_jump() -> void:
	if t_reached_min and t_jump_velocity < T_DROP_VELOCITY:
		t_jump_velocity = T_DROP_VELOCITY

func ms_per_anim_frame() -> float:
	match t_status:
		"WAITING": return 1000.0 / 3.0
		"RUNNING": return 1000.0 / 12.0
		"DUCKING": return 1000.0 / 8.0
	return 1000.0 / 60.0 # CRASHED, JUMPING

func trex_update_jump(delta_time: float) -> void:
	var frames_elapsed := delta_time / ms_per_anim_frame()
	if t_speed_drop:
		t_y += js_round(t_jump_velocity * T_SPEED_DROP_COEFFICIENT * frames_elapsed)
	else:
		t_y += js_round(t_jump_velocity * frames_elapsed)
	t_jump_velocity += T_GRAVITY * frames_elapsed
	if t_y < t_min_jump or t_speed_drop:
		t_reached_min = true
	if t_y < T_MAX_JUMP_HEIGHT or t_speed_drop:
		trex_end_jump()
	if t_y > t_ground:
		trex_reset()
		t_jump_count += 1.0
	trex_update(delta_time)

func trex_set_speed_drop() -> void:
	t_speed_drop = true
	t_jump_velocity = 1.0

func trex_set_duck(is_ducking: bool) -> void:
	if is_ducking and t_status != "DUCKING":
		trex_update(0.0, "DUCKING")
		t_ducking = true
	elif t_status == "DUCKING":
		trex_update(0.0, "RUNNING")
		t_ducking = false

func trex_reset() -> void:
	t_y = t_ground
	t_jump_velocity = 0.0
	t_jumping = false
	t_ducking = false
	trex_update(0.0, "RUNNING")
	t_speed_drop = false
	t_jump_count = 0.0

# ---- collision ----------------------------------------------------------------------------
static func box_compare(ax: float, ay: float, aw: float, ah: float, bx: float, by: float, bw: float, bh: float) -> bool:
	return ax < bx + bw and ax + aw > bx and ay < by + bh and ah + ay > by

func check_for_collision() -> bool:
	if obstacles.is_empty():
		return false
	var o: Obstacle = obstacles[0]
	var tx := t_x + 1.0
	var ty := t_y + 1.0
	var tw := T_WIDTH - 2.0
	var th := T_HEIGHT - 2.0
	var ox := o.x + 1.0
	var oy := o.y + 1.0
	var ow: float = o.type_cfg["width"] * o.size - 2.0
	var oh: float = o.type_cfg["height"] - 2.0
	if box_compare(tx, ty, tw, th, ox, oy, ow, oh):
		var tboxes: Array = TREX_BOXES_DUCKING if t_ducking else TREX_BOXES_RUNNING
		for tb in tboxes:
			for ob in o.boxes:
				if box_compare(tb[0] + tx, tb[1] + ty, tb[2], tb[3], ob[0] + ox, ob[1] + oy, ob[2], ob[3]):
					return true
	return false

# ---- Horizon ------------------------------------------------------------------------------
func update_obstacles_if(delta_time: float, speed: float, do_update: bool) -> void:
	if do_update:
		update_obstacles(delta_time, speed)

func update_obstacles(delta_time: float, speed: float) -> void:
	var updated := obstacles.duplicate()
	for o in obstacles:
		o.update(delta_time, speed)
		if o.remove:
			updated.pop_front()
	obstacles = updated
	if obstacles.size() > 0:
		var last: Obstacle = obstacles[obstacles.size() - 1]
		if last != null and not last.followed and last.is_visible() and (last.x + last.width + last.gap) < WIDTH:
			add_new_obstacle(speed)
			last.followed = true
	else:
		add_new_obstacle(speed)

func add_new_obstacle(speed: float) -> void:
	var type: Dictionary = OBSTACLE_TYPES[int(random_num(0.0, OBSTACLE_TYPES.size() - 1.0))]
	if overrun:
		return # out of tape: stop here, the runner reports it
	if duplicate_obstacle_check(type["type"]) or speed < type["minSpeed"]:
		add_new_obstacle(speed)
	else:
		obstacles.append(make_obstacle(type, speed, type["width"]))
		obstacle_history.push_front(type["type"])
		if obstacle_history.size() > 1:
			obstacle_history.resize(mini(obstacle_history.size(), MAX_OBSTACLE_DUPLICATION))

func make_obstacle(type: Dictionary, speed: float, x_offset: float) -> Obstacle:
	var o := Obstacle.new()
	o.type_cfg = type
	o.size = random_num(1.0, MAX_OBSTACLE_LENGTH)
	o.x = WIDTH + x_offset
	for b in type["boxes"]:
		o.boxes.append(b.duplicate())
	# only allow groups when the speed is high enough
	if o.size > 1.0 and type["multipleSpeed"] > speed:
		o.size = 1.0
	o.width = type["width"] * o.size
	var ys: Array = type["yPos"]
	if ys.size() > 1:
		o.y = ys[int(random_num(0.0, ys.size() - 1.0))]
	else:
		o.y = ys[0]
	# the middle box grows with the group, the last one moves to the end
	if o.size > 1.0:
		o.boxes[1][2] = o.width - o.boxes[0][2] - o.boxes[2][2]
		o.boxes[2][0] = o.width - o.boxes[2][2]
	if type["speedOffset"] != 0.0:
		o.speed_offset = type["speedOffset"] if rng() > 0.5 else -type["speedOffset"]
	var min_gap := js_round(o.width * speed + type["minGap"] * GAP_COEFFICIENT)
	var max_gap := js_round(min_gap * MAX_GAP_COEFFICIENT)
	o.gap = random_num(min_gap, max_gap)
	return o

func duplicate_obstacle_check(next: String) -> bool:
	var count := 0
	for h in obstacle_history:
		count = count + 1 if h == next else 0
	return count >= MAX_OBSTACLE_DUPLICATION

# ---- what the recording compares ----------------------------------------------------------
func snapshot() -> Dictionary:
	var d := ceilf(distance_ran)
	var obs := []
	for o in obstacles:
		obs.append({"type": o.type_cfg["type"], "xPos": o.x, "yPos": o.y, "size": o.size, "width": o.width, "gap": o.gap,
			"speedOffset": o.speed_offset, "followed": o.followed})
	return {
		"playing": playing,
		"crashed": crashed,
		"activated": activated,
		"playingIntro": playing_intro,
		"paused": paused,
		"currentSpeed": current_speed,
		"distanceRan": distance_ran,
		"score": js_round(d * 0.025) if d != 0.0 else 0.0,
		"highestScore": highest_score,
		"runningTime": running_time,
		"playCount": play_count,
		"time": time,
		"running": raq_id != 0,
		"rafPending": queue.size(),
		"tRex": {"xPos": t_x, "yPos": t_y, "jumping": t_jumping, "ducking": t_ducking, "speedDrop": t_speed_drop,
			"jumpVelocity": t_jump_velocity, "jumpCount": t_jump_count, "status": t_status, "reachedMinHeight": t_reached_min},
		"obstacleHistory": obstacle_history.duplicate(),
		"obstacles": obs,
	}
