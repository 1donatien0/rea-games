# Playable Blocks in Godot: left/right move, up rotates, down drops a row, Escape ends the game,
# Space starts (or restarts after a loss), R restarts at any time. The rules are blocks.gd, the file the check
# runs; the art is flat-colour rectangles drawn here.
extends Control

const Blocks := preload("res://blocks.gd")
const CELL := 24.0
const COLORS := {
	"i": Color("3cc7d6"), "j": Color("3f6fe0"), "l": Color("ee9a2c"), "o": Color("ecd23a"),
	"s": Color("4fc25a"), "t": Color("a45bd6"), "z": Color("e0483f"),
}
const BG := Color("14161c")
const WELL := Color("1f2330")
const INK := Color("e8e8ee")

var game
var pending: Array = [] # key names gathered since the last frame

func _ready() -> void:
	randomize()
	game = Blocks.new([], 1000000.0, true)
	queue_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey) or not e.pressed:
		return
	match e.keycode:
		KEY_LEFT:
			pending.append("left")
		KEY_RIGHT:
			pending.append("right")
		KEY_UP:
			pending.append("up")
		KEY_DOWN:
			pending.append("down")
		KEY_ESCAPE:
			pending.append("esc")
		KEY_SPACE:
			pending.append("space")
		KEY_R:
			pending.append("play")

func _process(delta: float) -> void:
	advance(delta * 1000.0)
	queue_redraw()

# one rules frame with the real frame time and the keys gathered since the last one
func advance(dt_ms: float) -> void:
	game.step(dt_ms, pending)
	pending = []

func cell(origin: Vector2, x: int, y: int, kind: String, size: float = CELL) -> void:
	draw_rect(Rect2(origin + Vector2(x, y) * size, Vector2(size - 1.0, size - 1.0)), COLORS[kind])

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), BG)
	var well := Vector2(20, 20)
	draw_rect(Rect2(well, Vector2(10 * CELL, 20 * CELL)), WELL)
	for y in 20:
		for x in 10:
			var k: String = game.grid[y][x]
			if k != "":
				cell(well, x, y, k)
	if game.playing:
		var c: Dictionary = game.cur
		for p in Blocks.cells_of(c["type"], c["x"], c["y"], c["dir"]):
			cell(well, p.x, p.y, c["type"])
	var f := ThemeDB.fallback_font
	var side := Vector2(well.x + 10 * CELL + 20, 40)
	draw_string(f, side, "NEXT", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, INK)
	var n: Dictionary = game.nxt
	for p in Blocks.cells_of(n["type"], 0, 0, 0):
		cell(side + Vector2(0, 10), p.x, p.y, n["type"], 16.0)
	draw_string(f, side + Vector2(0, 130), "SCORE", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, INK)
	draw_string(f, side + Vector2(0, 150), str(game.vscore), HORIZONTAL_ALIGNMENT_LEFT, -1, 16, INK)
	draw_string(f, side + Vector2(0, 190), "ROWS", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, INK)
	draw_string(f, side + Vector2(0, 210), str(game.rows), HORIZONTAL_ALIGNMENT_LEFT, -1, 16, INK)
	if not game.playing:
		draw_string(f, Vector2(well.x, 230), "press space to play", HORIZONTAL_ALIGNMENT_CENTER, 10 * CELL, 16, INK)
