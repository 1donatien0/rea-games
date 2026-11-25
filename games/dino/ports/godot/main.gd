# Playable Dino in Godot: Space or Up jumps (hold for a high jump), Down ducks (in the air: drops fast),
# Space after a crash restarts (the original waits 750 ms), Enter restarts at once. The rules are dino.gd, the
# file the check runs; the art is drawn here from rectangles and polygons.
extends Control

const Dino := preload("res://dino.gd")
const STEP_MS := 1000.0 / 60.0
const INK := Color("535353")
const BG := Color("f7f7f7")

var game
var acc := 0.0
var flags := 0
var intro_ms := -1.0 # game time since the dino started to slide in; the intro ends after 400 ms
var clock := 0.0 # animation clock (ms), only for drawing

func _ready() -> void:
	randomize()
	game = Dino.new([], 1000.0, true)
	queue_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey):
		return
	var jump: bool = e.keycode == KEY_SPACE or e.keycode == KEY_UP
	if e.pressed:
		if jump:
			flags |= Dino.F_JUMP
		elif e.keycode == KEY_DOWN:
			flags |= Dino.F_DUCK
	elif jump:
		flags |= Dino.F_JUMP_UP
	elif e.keycode == KEY_DOWN:
		flags |= Dino.F_DUCK_UP
	elif e.keycode == KEY_ENTER:
		flags |= Dino.F_ENTER

func _process(delta: float) -> void:
	acc += delta * 1000.0
	while acc >= STEP_MS:
		acc -= STEP_MS
		advance()
	queue_redraw()

# one rules frame of 1000/60 ms with the keys gathered since the last one
func advance() -> void:
	if game.playing_intro:
		intro_ms = 0.0 if intro_ms < 0.0 else intro_ms + STEP_MS
		if intro_ms >= 400.0:
			flags |= Dino.F_ANIM_END
			intro_ms = -1.0
	else:
		intro_ms = -1.0
	game.step(STEP_MS, flags)
	flags = 0
	clock += STEP_MS

func _draw() -> void:
	var s := minf(size.x / 600.0, size.y / 150.0)
	var origin := Vector2((size.x - 600.0 * s) / 2.0, (size.y - 150.0 * s) / 2.0)
	draw_rect(Rect2(Vector2.ZERO, size), BG)
	draw_set_transform(origin, 0.0, Vector2(s, s))
	draw_line(Vector2(0, 140), Vector2(600, 140), INK, 1.5)
	for i in 12: # ground specks scroll with the distance
		var gx := fposmod(i * 53.0 - game.distance_ran * 1.0, 600.0)
		draw_rect(Rect2(gx, 143 + (i % 3) * 3, 4 + (i % 2) * 3, 1), INK.lightened(0.4))
	for o in game.obstacles:
		draw_obstacle(o)
	draw_dino()
	var f := ThemeDB.fallback_font
	var score := int(game.snapshot()["score"])
	draw_string(f, Vector2(440, 20), "HI %05d  %05d" % [int(round(game.highest_score * 0.025)), score], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, INK)
	if game.crashed:
		draw_string(f, Vector2(0, 70), "G A M E   O V E R", HORIZONTAL_ALIGNMENT_CENTER, 600, 18, INK)
		draw_string(f, Vector2(0, 90), "space to restart", HORIZONTAL_ALIGNMENT_CENTER, 600, 12, INK)
	elif not game.activated and not game.playing:
		draw_string(f, Vector2(0, 70), "press space", HORIZONTAL_ALIGNMENT_CENTER, 600, 14, INK)

func draw_dino() -> void:
	var x: float = game.t_x
	var y: float = game.t_y
	var c := INK
	if game.crashed:
		c = Color("a33")
	if game.t_ducking:
		# long and low
		draw_rect(Rect2(x, y + 18, 40, 20), c)
		draw_rect(Rect2(x + 34, y + 14, 20, 16), c)
		draw_rect(Rect2(x + 46, y + 18, 3, 3), BG)
		draw_rect(Rect2(x + 44, y + 28, 10, 2), BG)
		_legs(x + 8, y + 38, y + 43)
		return
	draw_rect(Rect2(x + 8, y + 16, 22, 22), c) # body
	draw_rect(Rect2(x + 22, y, 18, 16), c) # head
	draw_rect(Rect2(x + 32, y + 4, 3, 3), BG) # eye
	draw_rect(Rect2(x + 30, y + 12, 10, 2), BG) # mouth line
	draw_colored_polygon(PackedVector2Array([Vector2(x + 8, y + 18), Vector2(x, y + 28), Vector2(x + 8, y + 32)]), c) # tail
	draw_rect(Rect2(x + 28, y + 24, 8, 3), c) # arm
	if game.t_jumping:
		draw_rect(Rect2(x + 10, y + 38, 5, 9), c)
		draw_rect(Rect2(x + 20, y + 38, 5, 9), c)
	else:
		_legs(x + 10, y + 38, y + 47)

func _legs(x: float, top: float, bottom: float) -> void:
	var step: bool = int(clock / 90.0) % 2 == 0 and game.playing
	var lift := 4.0 if step else 0.0
	var other := 0.0 if step else (4.0 if game.playing else 0.0)
	draw_rect(Rect2(x, top, 5, bottom - top - lift), INK)
	draw_rect(Rect2(x + 10, top, 5, bottom - top - other), INK)

func draw_obstacle(o) -> void:
	var t: String = o.type_cfg["type"]
	var w: float = o.type_cfg["width"]
	if t == "PTERODACTYL":
		var up := int(clock / 150.0) % 2 == 0
		draw_rect(Rect2(o.x + 10, o.y + 14, 34, 10), INK) # body
		draw_colored_polygon(PackedVector2Array([Vector2(o.x + 10, o.y + 14), Vector2(o.x, o.y + 18), Vector2(o.x + 10, o.y + 22)]), INK) # beak
		var wy: float = o.y + (2.0 if up else 26.0)
		draw_colored_polygon(PackedVector2Array([Vector2(o.x + 18, o.y + 16 if up else o.y + 22), Vector2(o.x + 36, o.y + 16 if up else o.y + 22),
			Vector2(o.x + 30, wy)]), INK)
		return
	for i in int(o.size):
		var cx: float = o.x + w * i
		var h: float = o.type_cfg["height"]
		draw_rect(Rect2(cx + w * 0.35, o.y, w * 0.3, h), INK) # trunk
		draw_rect(Rect2(cx + 1, o.y + h * 0.3, w * 0.35, 3), INK) # left arm
		draw_rect(Rect2(cx + 1, o.y + h * 0.2, 3, h * 0.2), INK)
		draw_rect(Rect2(cx + w * 0.6, o.y + h * 0.45, w * 0.35, 3), INK) # right arm
		draw_rect(Rect2(cx + w - 4, o.y + h * 0.35, 3, h * 0.2), INK)
