# Playable Canvas Bird in Godot: click, tap or press Space to flap; the first click starts a round, and after a
# loss a click restarts. The rules are bird.gd, the file the check runs; the art is drawn here from shapes.
extends Control

const Bird := preload("res://bird.gd")
const STEP_MS := 1000.0 / 60.0

var game
var acc := 0.0
var clicked := false
var clock := 0.0 # animation clock (ms), only for drawing

func _ready() -> void:
	randomize()
	game = Bird.new([], true)
	game.load_frame()
	queue_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		clicked = true
	elif e is InputEventScreenTouch and e.pressed:
		clicked = true
	elif e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_SPACE:
		clicked = true

func _process(delta: float) -> void:
	acc += delta * 1000.0
	while acc >= STEP_MS:
		acc -= STEP_MS
		advance()
	queue_redraw()

# one rules frame of 1000/60 ms with the click gathered since the last one
func advance() -> void:
	game.step(STEP_MS, clicked)
	clicked = false
	clock += STEP_MS

func _draw() -> void:
	var s := minf(size.x / Bird.W, size.y / Bird.H)
	var origin := Vector2((size.x - Bird.W * s) / 2.0, (size.y - Bird.H * s) / 2.0)
	draw_rect(Rect2(Vector2.ZERO, size), Color("1b2a3a"))
	draw_set_transform(origin, 0.0, Vector2(s, s))
	draw_rect(Rect2(0, 0, Bird.W, Bird.H), Color("7ec8e8"))
	for bx in [game.bg0, game.bg1]:
		_scenery(bx)
	for o in game.pipes:
		_pipe(o)
	_bird()
	var f := ThemeDB.fallback_font
	if game.playing:
		draw_string(f, Vector2(0, 50), str(game.score), HORIZONTAL_ALIGNMENT_CENTER, Bird.W, 36, Color.WHITE)
	else:
		var a := clampf(game.alpha, 0.0, 1.0)
		draw_string(f, Vector2(0, 240), "Click to start game", HORIZONTAL_ALIGNMENT_CENTER, Bird.W, 36, Color(1, 1, 1, a))

func _scenery(bx: float) -> void:
	draw_rect(Rect2(bx, 420, Bird.W, 60), Color("6aa84f"))
	draw_rect(Rect2(bx, 410, Bird.W, 10), Color("93c47d"))
	for i in 4:
		var cx := bx + 60.0 + i * 160.0
		var cy := 80.0 + (i % 2) * 50.0
		draw_circle(Vector2(cx, cy), 22, Color(1, 1, 1, 0.8))
		draw_circle(Vector2(cx + 24, cy + 6), 18, Color(1, 1, 1, 0.8))
		draw_circle(Vector2(cx - 22, cy + 8), 16, Color(1, 1, 1, 0.8))

func _pipe(o) -> void:
	var green := Color("3f9b3f")
	var dark := Color("2c6e2c")
	# the up pipe hangs from its y to the bottom, the down pipe ends at y + 316
	draw_rect(Rect2(o.up_x + 4, o.up_y, 56, Bird.PIPE_H), green)
	draw_rect(Rect2(o.up_x, o.up_y, 64, 22), dark)
	draw_rect(Rect2(o.down_x + 4, o.down_y, 56, Bird.PIPE_H), green)
	draw_rect(Rect2(o.down_x, o.down_y + Bird.PIPE_H - 22, 64, 22), dark)

func _bird() -> void:
	var c := Vector2(Bird.BIRD_X + 32.0, game.by + 32.0)
	var tilt := clampf(game.bv * 0.06, -0.5, 0.8)
	var body := Color("f2c230") if game.controls or not game.playing else Color("d96a4a")
	draw_circle(c, 26, body)
	var wing_up: bool = game.sprite == 1
	var wy := -12.0 if wing_up else (12.0 if game.sprite == 2 else 0.0)
	draw_colored_polygon(PackedVector2Array([c + Vector2(-20, 0), c + Vector2(-2, wy), c + Vector2(-2, 8)]), Color("c9962a"))
	draw_circle(c + Vector2(12, -8 + tilt * 6.0), 7, Color.WHITE)
	draw_circle(c + Vector2(14, -8 + tilt * 6.0), 3, Color.BLACK)
	draw_colored_polygon(PackedVector2Array([c + Vector2(22, -2), c + Vector2(36, 4), c + Vector2(22, 10)]), Color("e8742c"))
