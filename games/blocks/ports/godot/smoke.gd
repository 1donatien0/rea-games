# Smoke test of the playable scene, not part of the check: godot --headless --path ports/godot --script smoke.gd
# Loads main.tscn, feeds key events and prints the game state. It proves the scene runs and reacts to keys,
# not that it looks right.
extends SceneTree

func key(code: int) -> InputEventKey:
	var e := InputEventKey.new()
	e.keycode = code
	e.physical_keycode = code
	e.pressed = true
	return e

func _init() -> void:
	var main = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var g = main.game
	print("start playing=", g.playing, " score=", g.score)
	main._unhandled_input(key(KEY_SPACE))
	main.advance(16.7)
	print("after space playing=", g.playing, " cur=", g.cur)
	var x0: int = g.cur["x"]
	main._unhandled_input(key(KEY_LEFT))
	main.advance(16.7)
	print("after left x ", x0, " -> ", g.cur["x"])
	var d0: int = g.cur["dir"]
	main._unhandled_input(key(KEY_UP))
	main.advance(16.7)
	print("after up dir ", d0, " -> ", g.cur["dir"])
	var y0: int = g.cur["y"]
	main._unhandled_input(key(KEY_DOWN))
	main.advance(16.7)
	print("after down y ", y0, " -> ", g.cur["y"])
	var n := 0
	while g.playing and n < 100000:
		main._unhandled_input(key(KEY_DOWN))
		main.advance(16.7)
		n += 1
	print("stacked out after ", n, " frames: playing=", g.playing, " score=", g.score, " rows=", g.rows)
	main._unhandled_input(key(KEY_SPACE))
	main.advance(16.7)
	print("restart playing=", g.playing, " score=", g.score)
	main._unhandled_input(key(KEY_ESCAPE))
	main.advance(16.7)
	print("escape playing=", g.playing)
	main.queue_redraw()
	await process_frame
	await process_frame
	print("frames drawn ok")
	quit()
