# Blocks rules in GDScript, written from games/blocks/GAME.md and checked against ports/web/blocks.mjs.
# Pure logic: no engine time, no engine randomness unless `live` is set. Operations run in the order the
# JavaScript port uses, so the trace matches bit for bit.
#   Blocks.new(tape, clock0, live)   tape: recorded randoms; live: draw from randf() instead
#   step(dt, keys)                   one rendered frame; keys: ordered names left right up down esc space play
extends RefCounted

const W := 10
const H := 20
const KINDS := "ijlostz"
const SIZES := {"i": 4, "j": 3, "l": 3, "o": 2, "s": 3, "t": 3, "z": 3}
const MASKS := {
	"i": [0x0f00, 0x2222, 0x00f0, 0x4444],
	"j": [0x44c0, 0x8e00, 0x6440, 0x0e20],
	"l": [0x4460, 0x0e80, 0xc440, 0x2e00],
	"o": [0xcc00, 0xcc00, 0xcc00, 0xcc00],
	"s": [0x06c0, 0x8c40, 0x6c00, 0x4620],
	"t": [0x0e40, 0x4c40, 0x4e00, 0x4640],
	"z": [0x0c60, 0x4c80, 0xc600, 0x2640],
}
const START_STEP := 0.6
const STEP_DECREMENT := 0.005
const MIN_STEP := 0.1

# actions in the queue: 0 up (rotate), 1 right, 2 down, 3 left
const A_UP := 0
const A_RIGHT := 1
const A_DOWN := 2
const A_LEFT := 3

var tape: Array = []
var used := 0
var live := false
var overrun := false # the port asked for more tape than recorded (the runner reports it)

var t := 0.0
var last := 0
var bag: Array = [] # piece letters still in the bag, in splice order
var cur: Dictionary = {}
var nxt: Dictionary = {}
var grid: Array = [] # grid[y][x] is "" or a piece letter
var dt_acc := 0.0
var actions: Array = []
var rows := 0
var step_sec := START_STEP
var score := 0
var vscore := 0
var playing := false

func _init(tape_in: Array, clock0: float, live_flag: bool) -> void:
	tape = tape_in
	live = live_flag
	t = clock0
	last = int(floorf(clock0))
	reset() # the page resets once while it loads

func rng() -> float:
	if live:
		return randf()
	if used >= tape.size():
		overrun = true
		return 0.0
	used += 1
	return tape[used - 1]

# JavaScript Math.round on a non-negative number
static func js_round(x: float) -> int:
	var f := floorf(x)
	return int(f) + (1 if x - f >= 0.5 else 0)

func new_piece() -> Dictionary:
	if bag.size() == 0:
		for k in KINDS:
			for n in 4:
				bag.append(k)
	# a float in [0, len-1) truncated: the bag's last piece is not taken until it is alone
	var idx := int(floorf(rng() * float(bag.size() - 1)))
	var kind: String = bag[idx]
	bag.remove_at(idx)
	var x := js_round(rng() * float(W - SIZES[kind]))
	return {"type": kind, "x": x, "y": 0, "dir": 0}

# the cells (column, row) a piece covers
static func cells_of(kind: String, x: int, y: int, dir: int) -> Array:
	var out: Array = []
	var mask: int = MASKS[kind][dir]
	for i in 16:
		if mask & (0x8000 >> i):
			out.append(Vector2i(x + (i & 3), y + (i >> 2)))
	return out

func blocked(kind: String, x: int, y: int, dir: int) -> bool:
	for c in cells_of(kind, x, y, dir):
		if c.x < 0 or c.x >= W or c.y < 0 or c.y >= H or grid[c.y][c.x] != "":
			return true
	return false

func empty_row() -> Array:
	var r: Array = []
	r.resize(W)
	r.fill("")
	return r

func reset() -> void:
	dt_acc = 0.0
	actions = []
	grid = []
	for y in H:
		grid.append(empty_row())
	set_rows(0)
	score = 0
	vscore = 0
	cur = nxt if not nxt.is_empty() else new_piece()
	nxt = new_piece()

func set_rows(n: int) -> void:
	rows = n
	step_sec = maxf(MIN_STEP, START_STEP - STEP_DECREMENT * float(n))

func play() -> void:
	reset()
	playing = true

func lose() -> void:
	vscore = score
	playing = false

func move(dx: int, dy: int) -> bool:
	if blocked(cur["type"], cur["x"] + dx, cur["y"] + dy, cur["dir"]):
		return false
	cur["x"] += dx
	cur["y"] += dy
	return true

func rotate() -> void:
	var d: int = (cur["dir"] + 1) & 3
	if not blocked(cur["type"], cur["x"], cur["y"], d):
		cur["dir"] = d # no kicks: a blocked turn is dropped

# gravity step and the soft-drop key: one row down, or lock the piece
func drop() -> void:
	if move(0, 1):
		return
	score += 10
	for c in cells_of(cur["type"], cur["x"], cur["y"], cur["dir"]):
		grid[c.y][c.x] = cur["type"]
	remove_lines()
	cur = nxt
	nxt = new_piece()
	actions = []
	if blocked(cur["type"], cur["x"], cur["y"], cur["dir"]):
		lose()

func remove_lines() -> void:
	var n := 0
	# rows 19..1 are checked; row 0 is never looked at
	var y := H - 1
	while y > 0:
		var full := true
		for c in grid[y]:
			if c == "":
				full = false
				break
		if full:
			for r in range(y, 0, -1):
				grid[r] = grid[r - 1].duplicate()
			grid[0] = empty_row()
			y += 1 # look at the same row again
			n += 1
		y -= 1
	if n > 0:
		set_rows(rows + n)
		score += 100 * (1 << (n - 1))

func key(name: String) -> void:
	if playing:
		match name:
			"left":
				actions.append(A_LEFT)
			"right":
				actions.append(A_RIGHT)
			"up":
				actions.append(A_UP)
			"down":
				actions.append(A_DOWN)
			"esc":
				lose()
			"play":
				play()
	elif name == "space" or name == "play":
		play()

func step(dt: float, keys: Array) -> void:
	for k in keys:
		key(k)
	t += dt
	var now := int(floorf(t))
	var idt := minf(1.0, float(now - last) / 1000.0)
	last = now
	if not playing:
		return
	if vscore < score:
		vscore += 1
	if actions.size() > 0:
		var a: int = actions.pop_front()
		match a:
			A_LEFT:
				move(-1, 0)
			A_RIGHT:
				move(1, 0)
			A_UP:
				rotate()
			A_DOWN:
				drop()
	dt_acc += idt
	# the piece may have been replaced (or the game lost) by the action above; gravity still runs
	if dt_acc > step_sec:
		dt_acc -= step_sec
		drop()

func piece_dict(p: Dictionary) -> Dictionary:
	return {"type": p["type"], "x": p["x"], "y": p["y"], "dir": p["dir"]}

func snapshot() -> Dictionary:
	var g: Array = []
	for y in H:
		var s := ""
		for c in grid[y]:
			s += "." if c == "" else c
		g.append(s)
	return {
		"grid": g, "current": piece_dict(cur), "next": piece_dict(nxt), "bag": "".join(bag),
		"score": score, "vscore": vscore, "rows": rows, "step": step_sec, "dt": dt_acc,
		"playing": playing, "actions": actions.duplicate(),
	}
