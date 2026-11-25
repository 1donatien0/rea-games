# Runner protocol: a case on stdin, {trace, tapeUsed} on stdout.
# godot --headless --quiet --path ports/godot --script runner.gd < case.json
extends SceneTree

const Game := preload("res://game2048.gd")

func _init() -> void:
	# one line of JSON, as the runner protocol sends it (a pipe cannot be opened as a file here)
	var text := OS.read_string_from_stdin(1 << 25)
	var c = JSON.parse_string(text)
	if c == null:
		printerr("runner: no case on stdin")
		quit(1) # a script error would leave the engine running forever
		return
	var g = Game.new(c["tape"], c["initial"])
	var trace := [g.snapshot()]
	for i in c["inputs"]:
		match i["t"]:
			"move": g.move(int(i["d"]))
			"restart": g.restart()
			"keep": g.keep_playing()
		trace.append(g.snapshot())
	print(JSON.stringify({"trace": trace, "tapeUsed": g.used}))
	quit()
