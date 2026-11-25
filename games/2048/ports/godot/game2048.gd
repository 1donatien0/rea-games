# 2048, written from games/2048/GAME.md. cells[x][y], column first, like the recording.
extends RefCounted

const SIZE := 4
const DIRS := [[0, -1], [1, 0], [0, 1], [-1, 0]] # up, right, down, left as (dx, dy)

var cells: Array = []
var score := 0
var best := 0
var over := false
var won := false
var kept := false
var tape: Array = []
var used := 0
var live := false # play mode: draw from the engine's generator instead of a recorded tape

func _init(p_tape: Array, initial, p_live := false) -> void:
	tape = p_tape
	live = p_live
	load_state(initial)

func rng() -> float:
	if live:
		return randf()
	var v: float = tape[used]
	used += 1
	return v

func load_state(saved) -> void:
	cells = []
	for x in SIZE:
		var col := []
		col.resize(SIZE)
		col.fill(0)
		cells.append(col)
	if saved is Dictionary:
		var cols: Array = saved["grid"]["cells"]
		for x in SIZE:
			for y in SIZE:
				var t = cols[x][y]
				cells[x][y] = int(t["value"]) if t != null else 0
		score = int(saved["score"])
		over = saved["over"]
		won = saved["won"]
		kept = saved["keepPlaying"]
	else:
		score = 0
		over = false
		won = false
		kept = false
		add_tile()
		add_tile()
	best = maxi(best, score)

func terminated() -> bool:
	return over or (won and not kept)

func restart() -> void:
	load_state(null)

func keep_playing() -> void:
	kept = true

func add_tile() -> void:
	var free := []
	for x in SIZE:
		for y in SIZE:
			if cells[x][y] == 0:
				free.append([x, y])
	if free.is_empty():
		return
	var value := 2 if rng() < 0.9 else 4 # the value is drawn before the place
	var pick: Array = free[int(floor(rng() * free.size()))]
	cells[pick[0]][pick[1]] = value

# Slide one line toward its start; a tile merges at most once, the pair nearest the wall first.
func slide(line: Array) -> Array:
	var tiles := []
	for v in line:
		if v != 0:
			tiles.append(v)
	var out := []
	var gained := 0
	var i := 0
	while i < tiles.size():
		if i + 1 < tiles.size() and tiles[i] == tiles[i + 1]:
			var m: int = tiles[i] * 2
			out.append(m)
			gained += m
			if m == 2048:
				won = true
			i += 2
		else:
			out.append(tiles[i])
			i += 1
	while out.size() < SIZE:
		out.append(0)
	return [out, gained]

func move(dir: int) -> void:
	if terminated():
		return
	var dx: int = DIRS[dir][0]
	var dy: int = DIRS[dir][1]
	var moved := false
	for k in SIZE:
		var coords := []
		for i in SIZE:
			var j: int = (SIZE - 1 - i) if (dx + dy > 0) else i
			coords.append([j, k] if dx != 0 else [k, j])
		var line := []
		for c in coords:
			line.append(cells[c[0]][c[1]])
		var res := slide(line)
		var out: Array = res[0]
		for i in SIZE:
			var c: Array = coords[i]
			if cells[c[0]][c[1]] != out[i]:
				moved = true
			cells[c[0]][c[1]] = out[i]
		score += res[1]
	if not moved:
		return
	add_tile()
	if not has_moves():
		over = true
	best = maxi(best, score)

func has_moves() -> bool:
	for x in SIZE:
		for y in SIZE:
			var v: int = cells[x][y]
			if v == 0:
				return true
			if x + 1 < SIZE and cells[x + 1][y] == v:
				return true
			if y + 1 < SIZE and cells[x][y + 1] == v:
				return true
	return false

func snapshot() -> Dictionary:
	var g := []
	for x in SIZE:
		g.append(cells[x].duplicate())
	return {"grid": g, "score": score, "over": over, "won": won, "terminated": terminated(), "best": best}
