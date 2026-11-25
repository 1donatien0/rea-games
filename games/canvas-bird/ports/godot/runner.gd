# Runner protocol: a case on stdin, {trace, tapeUsed} on stdout.
# godot --headless --quiet --path ports/godot --script runner.gd < case.json
# Godot's JSON parser and printer do not round-trip doubles (the parsed tape was off by one ulp, and
# stringify writes 14 digits), so the numbers are read and written here, exactly.
extends SceneTree

const Bird := preload("res://bird.gd")

# a decimal as the double JavaScript would read: m / 10^k is correctly rounded when both are exact
func parse_num(s: String) -> float:
	var t := s.strip_edges()
	if t.contains("e") or t.contains("E"):
		return t.to_float()
	var neg := t.begins_with("-")
	if neg:
		t = t.substr(1)
	var dot := t.find(".")
	var k := 0
	var digits := t
	if dot >= 0:
		k = t.length() - dot - 1
		digits = t.substr(0, dot) + t.substr(dot + 1)
	var sig := digits.lstrip("0")
	var v: float
	if sig.length() <= 18 and sig.length() > 0:
		var m := int(sig)
		if m <= 9007199254740992 and k <= 18:
			var p := 1
			for i in k:
				p *= 10
			v = float(m) / float(p)
		else:
			v = snap_lattice(t.to_float())
	else:
		v = t.to_float() if sig.length() == 0 else snap_lattice(t.to_float())
	return -v if neg else v

# the tape comes from mulberry32: multiples of 2^-32, so the closest one is the exact value
func snap_lattice(approx: float) -> float:
	var x := floorf(approx * 4294967296.0 + 0.5) / 4294967296.0
	return x if absf(x - approx) < 1e-12 else approx

func section(text: String, key: String, stop: String) -> String:
	var a := text.find(key)
	if a < 0:
		return ""
	a += key.length()
	var b := text.find(stop, a)
	return text.substr(a, (b if b >= 0 else text.length()) - a)

func _init() -> void:
	var text := OS.read_string_from_stdin(1 << 27)
	var tape_s := section(text, "\"tape\":[", "]")
	var inputs_s := section(text, "\"inputs\":[", "],\"trace\"")
	if text.find("\"inputs\":[") < 0:
		printerr("runner: no case on stdin")
		quit(1) # a script error would leave the engine running forever
		return
	var tape: Array = []
	if tape_s != "":
		for p in tape_s.split(","):
			tape.append(parse_num(p))
	var dts: Array = []
	var clicks: Array = []
	if inputs_s != "":
		for obj in inputs_s.trim_prefix("{").trim_suffix("}").split("},{"):
			var dt := 0.0
			var c := false
			for kv in obj.split(","):
				var i := kv.find(":")
				var key := kv.substr(0, i).strip_edges().trim_prefix("\"").trim_suffix("\"")
				var val := kv.substr(i + 1).strip_edges()
				if key == "dt":
					dt = parse_num(val)
				elif key == "click":
					c = val == "true"
			dts.append(dt)
			clicks.append(c)
	var g = Bird.new(tape, false)
	var out := PackedStringArray()
	out.append("{\"trace\":[")
	out.append(frame(g.load_frame()))
	for i in dts.size():
		var f: PackedStringArray = g.step(dts[i], clicks[i])
		out.append(",")
		out.append(frame(f))
		if g.overrun:
			printerr("runner: the port asked for more random numbers than the original used")
			quit(1)
			return
	out.append("],\"tapeUsed\":%d}" % g.used)
	print("".join(out))
	quit()

# one frame's draw list as a JSON array of strings (none contains a quote or a backslash)
func frame(f: PackedStringArray) -> String:
	return "[\"" + "\",\"".join(f) + "\"]"
