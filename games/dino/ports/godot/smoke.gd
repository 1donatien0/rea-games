# Smoke test of the playable scene, not part of the check: godot --headless --path ports/godot --script smoke.gd
# Loads main.tscn, feeds key events and prints the game state. It proves the scene runs and reacts to keys,
# not that it looks right.
extends SceneTree

func key(code: int, pressed: bool) -> InputEventKey:
	var e := InputEventKey.new()
	e.keycode = code
	e.physical_keycode = code
	e.pressed = pressed
	return e

func _init() -> void:
	var main = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var g = main.game
	print("start playing=", g.playing, " y=", g.t_y)
	main._unhandled_input(key(KEY_SPACE, true))
	for i in 3:
		main.advance()
	print("after space playing=", g.playing, " jumping=", g.t_jumping, " y=", g.t_y)
	for i in 120:
		main.advance()
	print("after 120 frames jumping=", g.t_jumping, " activated=", g.activated, " intro=", g.playing_intro, " x=", g.t_x)
	main._unhandled_input(key(KEY_SPACE, false))
	main._unhandled_input(key(KEY_DOWN, true))
	for i in 60:
		main.advance()
	print("after down ducking=", g.t_ducking, " status=", g.t_status)
	main._unhandled_input(key(KEY_DOWN, false))
	var n := 0
	while not g.crashed and n < 6000:
		main.advance()
		n += 1
	print("idle until crash frames=", n, " crashed=", g.crashed, " obstacles=", g.obstacles.size(), " tape-free used=", g.used)
	for i in 60: # 1 s later, space restarts
		main.advance()
	main._unhandled_input(key(KEY_SPACE, true))
	main._unhandled_input(key(KEY_SPACE, false))
	main.advance()
	main.advance()
	print("after restart crashed=", g.crashed, " playing=", g.playing, " distance=", g.distance_ran)
	main.queue_redraw()
	await process_frame
	await process_frame
	print("frames drawn ok")
	quit()
