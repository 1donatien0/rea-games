# Playable 2048 in Godot: arrow keys / WASD, R restarts. The rules are game2048.gd, the same file the check runs.
extends Control

const Game := preload("res://game2048.gd")
const COLORS := {0: Color("2b303c"), 2: Color("3b4252"), 4: Color("434c5e"), 8: Color("d08770"), 16: Color("d9774f"),
	32: Color("e0613b"), 64: Color("e84a2c"), 128: Color("ebcb8b"), 256: Color("e8c26a"), 512: Color("e6b84a"),
	1024: Color("a3be8c"), 2048: Color("88c0d0")}

var game

func _ready() -> void:
	randomize()
	game = Game.new([], null, true)
	queue_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey and e.pressed):
		return
	var dir := -1
	match e.keycode:
		KEY_UP, KEY_W: dir = 0
		KEY_RIGHT, KEY_D: dir = 1
		KEY_DOWN, KEY_S: dir = 2
		KEY_LEFT, KEY_A: dir = 3
		KEY_R: game.restart()
		KEY_K: game.keep_playing()
	if dir >= 0:
		game.move(dir)
	queue_redraw()

func _draw() -> void:
	var s: Dictionary = game.snapshot()
	var side := minf(size.x, size.y) * 0.9
	var origin := (size - Vector2(side, side)) / 2.0
	draw_rect(Rect2(Vector2.ZERO, size), Color("14161c"))
	draw_rect(Rect2(origin, Vector2(side, side)), Color("20242e"))
	var cell := side / 4.0
	var font := ThemeDB.fallback_font
	for x in 4:
		for y in 4:
			var v: int = s["grid"][x][y]
			var r := Rect2(origin + Vector2(x, y) * cell + Vector2(6, 6), Vector2(cell - 12, cell - 12))
			draw_rect(r, COLORS.get(v, Color("b48ead")))
			if v > 0:
				draw_string(font, r.position + Vector2(0, r.size.y * 0.62), str(v), HORIZONTAL_ALIGNMENT_CENTER, r.size.x, int(cell * 0.32))
	draw_string(font, Vector2(origin.x, origin.y - 12), "score %d   best %d" % [s["score"], s["best"]], HORIZONTAL_ALIGNMENT_LEFT, -1, 22)
	if s["terminated"]:
		draw_rect(Rect2(origin, Vector2(side, side)), Color(0.08, 0.09, 0.11, 0.82))
		draw_string(font, origin + Vector2(0, side * 0.5), "Game over" if s["over"] else "2048! K keeps playing, R restarts", HORIZONTAL_ALIGNMENT_CENTER, side, 30)
