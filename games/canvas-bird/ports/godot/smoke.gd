# Smoke test of the playable scene, not part of the check: godot --headless --path ports/godot --script smoke.gd
# Loads main.tscn, feeds clicks and prints the game state. It proves the scene runs and reacts to input,
# not that it looks right.
extends SceneTree

func click() -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = true
	return e

func _init() -> void:
	var main = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var g = main.game
	print("start playing=", g.playing, " y=", g.by)
	main._unhandled_input(click())
	main.advance()
	print("after click playing=", g.playing, " controls=", g.controls, " pipes=", g.pipes.size(), " used=", g.used)
	main._unhandled_input(click())
	main.advance()
	print("after flap v=", g.bv)
	var n := 0
	while g.playing and n < 6000:
		main.advance()
		n += 1
	print("idle until the round ends frames=", n, " playing=", g.playing, " score=", g.score, " controls=", g.controls)
	main._unhandled_input(click())
	main.advance()
	print("after restart playing=", g.playing, " y=", g.by, " score=", g.score)
	main.queue_redraw()
	await process_frame
	await process_frame
	print("frames drawn ok")
	quit()
