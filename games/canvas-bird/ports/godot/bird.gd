# Canvas Bird rules in GDScript, written from games/canvas-bird/GAME.md and checked against ports/web/bird.mjs.
# Pure logic: no engine time, no engine randomness unless `live` is set. Every operation runs in the order the
# JavaScript port uses, so the draw lists match string for string.
#   Bird.new(tape, live)    tape: recorded random numbers; live: draw from randf() instead
#   load_frame()            the frame the page draws on load, before any step
#   step(dt, click)         one rendered frame; returns its draw list (PackedStringArray)
extends RefCounted

const T0 := 1000000.0
const W := 640.0
const H := 480.0
const PIPES := 5
const SPACING := 300.0
const GAP := 120.0
const MIN_OFF := -150.0
const MAX_OFF := 50.0
const PIPE_SPEED := 3.0
const PIPE_W := 64.0
const PIPE_H := 316.0
const BIRD_X := 70.0
const BIRD_W := 64.0
const BIRD_H := 64.0
const START_Y := 20.0
const START_V := 2.0
const FORCE := 0.15
const JUMP := -6.0
const MAX_V := 8.0
const FRAME_MS := 1000.0 / 30.0

class Pipe:
	extends RefCounted
	var id := 0
	var up_x := 0.0
	var up_y := 0.0
	var down_x := 0.0
	var down_y := 0.0
	var off := 0.0

var tape: Array = []
var used := 0
var live := false
var overrun := false # the port asked for more tape than recorded (the runner reports it)

var t := T0
var playing := false # a round is on screen (the splash text is hidden)
var controls := false # taps flap and pipes score; false once the bird has hit something
var score := 0
var alpha := 1.0
var rising := false
var stroke_style := "#000000"
var bg0 := 0.0
var bg1 := W
var by := START_Y
var bv := START_V
var sprite := 0
var sprite_clock := 0.0
var fall_clock := 0.0 # set once and never moved: this is why the 30 fps gate stops mattering
var pipes: Array = []
var next := 0
var last := PIPES - 1
var out := PackedStringArray()

func _init(p_tape: Array, p_live: bool) -> void:
	tape = p_tape
	live = p_live
	sprite_clock = floorf(t)
	fall_clock = floorf(t)

# ---- numbers as JavaScript prints them ---------------------------------------------------------------

# does the fixed-point text s read back as the double a? m / 10^k is correctly rounded when m and 10^k are
# exact; above 2^53 the distance of m from a * p is worked out in double-double
static func reads_as(s: String, a: float) -> bool:
	var dot := s.find(".")
	var k := s.length() - dot - 1
	var sig := (s.substr(0, dot) + s.substr(dot + 1)).lstrip("0")
	if sig.length() == 0:
		return a == 0.0
	if sig.length() >= 17 or k > 22:
		return true # 17 significant digits of the exact value always read back as it
	var p := 1.0
	for i in k:
		p *= 10.0
	var m := int(sig)
	if m <= 9007199254740992 or m % 2 == 0:
		return float(m) / p == a
	# m above 2^53: a * p to double-double (Dekker), then m - a * p against half a gap of doubles around a
	var c1 := 134217729.0 * a
	var ah := c1 - (c1 - a)
	var al := a - ah
	var c2 := 134217729.0 * p
	var ph := c2 - (c2 - p)
	var pl := p - ph
	var prod := a * p
	var err := ((ah * ph - prod) + ah * pl + al * ph) + al * pl
	var resid := float(m - int(prod)) - err
	var e := int(floorf(log(a) / log(2.0)))
	while pow(2.0, e) > a:
		e -= 1
	while pow(2.0, e + 1) <= a:
		e += 1
	var ulp := pow(2.0, e - 52)
	if resid < 0.0 and pow(2.0, e) == a:
		ulp *= 0.5 # below a power of two the doubles are twice as close
	var half := ulp * 0.5
	return absf(resid) < half * p

# the shortest decimal that reads back as v: a fixed-point string, or JS's exponent form for tiny values
static func num(v: float) -> String:
	if v == floorf(v) and absf(v) < 1e15:
		return str(int(v))
	var neg := v < 0.0
	var a := absf(v)
	var res := ""
	if a >= 1e-6:
		for k in range(1, 25):
			var s := String.num(a, k)
			if reads_as(s, a):
				res = s
				break
		if res == "":
			res = String.num(a, 24)
		if res.contains("."):
			res = res.rstrip("0").rstrip(".")
	else:
		res = _sci(a)
	return "-" + res if neg else res

static func _sci(a: float) -> String:
	var s := String.num(a, 80)
	var digits := s.substr(s.find(".") + 1)
	var z := 0
	while z < digits.length() and digits[z] == "0":
		z += 1
	var e10 := -(z + 1)
	var sig := digits.substr(z)
	for p in range(1, 18):
		var d := sig.substr(0, p)
		if sig.length() > p and sig[p] >= "5":
			d = str(int(d) + 1).pad_zeros(p)
		var e := e10
		if d.length() > p: # 9.99 rounded up to 10.0
			d = d.substr(0, p)
			e += 1
		var m := d.substr(0, 1) + ("." + d.substr(1) if d.length() > 1 else "")
		var cand := "%se%d" % [m, e]
		if cand.to_float() == a or p == 17:
			return cand
	return sig

# ---- random --------------------------------------------------------------------------------------------

func rand_int(lo: float, hi: float) -> float:
	var r := 0.0
	if live:
		r = randf()
	elif used < tape.size():
		r = tape[used]
	else:
		overrun = true
	used += 1
	return floorf(r * (hi - lo + 1.0) + lo)

# ---- rules, in the order of bird.mjs -------------------------------------------------------------------

func make_pipe(i: int, off: float) -> Pipe:
	var p := Pipe.new()
	p.id = i
	p.up_x = W + i * SPACING
	p.up_y = H / 2.0 + GAP + off
	p.down_x = p.up_x
	p.down_y = 0.0 - GAP + off
	p.off = off
	return p

func setup_pipes() -> void:
	next = 0
	last = PIPES - 1
	pipes = []
	for i in PIPES:
		pipes.append(make_pipe(i, rand_int(MIN_OFF, MAX_OFF)))

func score_check(p: Pipe, x: float) -> void:
	if p.id == next and x + PIPE_W < BIRD_X + BIRD_W:
		next = 0 if next == PIPES - 1 else next + 1
		if controls:
			score += 1
			out.append("a:point")

func move_up(p: Pipe) -> void:
	p.up_x -= PIPE_SPEED
	if p.up_x <= -PIPE_W:
		var nx: float = (pipes[last] as Pipe).up_x + SPACING
		p.up_x = nx
		p.down_x = nx
		p.off = rand_int(MIN_OFF, MAX_OFF) # drawn y is not recomputed from it (see GAME.md)
		last = 0 if last == PIPES - 1 else last + 1
	score_check(p, p.up_x)

func move_down(p: Pipe) -> void:
	p.down_x -= PIPE_SPEED
	score_check(p, p.down_x)

func collided() -> bool:
	var right := BIRD_X + BIRD_W
	var top := by
	var bottom := by + BIRD_H
	var p: Pipe = pipes[next]
	var px := p.down_x + 40.0
	var gap_top := p.down_y + PIPE_H
	var gap_bottom := p.up_y
	var hit := false
	if right > px and right < px + PIPE_W - 40.0:
		if top < gap_top or bottom > gap_bottom:
			hit = true
	if bottom < 0.0 or top > H:
		hit = true
	if hit and controls:
		out.append("a:lose")
	return hit

func sprite_frame() -> int:
	var n := floorf(t)
	if n - sprite_clock > FRAME_MS:
		sprite_clock = n
		sprite += 1
		if sprite > 2:
			sprite = 0
	return sprite

func draw() -> PackedStringArray:
	out = PackedStringArray()
	out.append("c:0:0:640:480")
	out.append("i:background:%s:0" % num(bg0))
	out.append("i:background:%s:0" % num(bg1))
	bg0 -= 1.0
	if bg0 <= -W:
		bg0 = W
	bg1 -= 1.0
	if bg1 <= -W:
		bg1 = W
	if not playing:
		var a := num(alpha)
		stroke_style = "rgba(0,0,0,%s)" % a
		out.append("t:stroke:Click to start game:90:80:" + stroke_style)
		out.append("t:fill:Click to start game:90:80:rgba(255,255,255,%s)" % a)
		if alpha < 0.0:
			rising = true
		if alpha > 1.0:
			rising = false
		alpha += 0.02 if rising else -0.02
	else:
		for o in pipes:
			var p: Pipe = o
			out.append("i:enemy_up:%s:%s" % [num(p.up_x), num(p.up_y)])
			out.append("i:enemy_down:%s:%s" % [num(p.down_x), num(p.down_y)])
			move_up(p)
			move_down(p)
		var sx := sprite_frame() * 64
		out.append("s:player:%d:0:64:64:70:%s:64:64" % [sx, num(by)])
		if floorf(t) - fall_clock > FRAME_MS:
			if bv < MAX_V:
				bv += FORCE
			by += bv
		if collided():
			controls = false
			if by - BIRD_H > H:
				playing = false
		out.append("t:stroke:%d:309:51:%s" % [score, stroke_style])
		out.append("t:fill:%d:310:50:white" % score)
	return out

func do_click() -> void:
	if controls:
		bv = JUMP
	if not playing:
		score = 0
		bv = START_V
		by = START_Y
		setup_pipes()
		playing = true
		controls = true

func load_frame() -> PackedStringArray:
	return draw()

func step(dt: float, clicked: bool) -> PackedStringArray:
	if clicked:
		do_click()
	t += dt
	return draw()
