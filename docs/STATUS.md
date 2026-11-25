# Status

What works today and how it was checked. Numbers are what `node bin/rea-game.mjs verify all` printed on the day this
was written (Linux container, Node 22, Chromium from Playwright). Nothing here was run on macOS or Windows.

## Verified

| Game | Port | Cases | Inputs / frames | Result |
|---|---|---|---|---|
| 2048 | web (JS) | 19 | 24,044 inputs | all identical |
| 2048 | Rust | 19 | 24,044 inputs | all identical |
| 2048 | Godot 4.4.1 (GDScript, headless) | 19 | 24,044 inputs | all identical |
| Dino | web (JS) | 29 | 63,000 frames | all identical, exact comparison |
| Canvas Bird | web (JS) | 30 | 68,409 frames | all identical, exact comparison |

Comparison is exact (no rounding, no tolerance) and also requires the port to use exactly the recorded random numbers.

**The check was shown to fail** when a port is broken: 2048 (spawn odds 0.9 to 0.8: 3 of 19 pass; win threshold changed:
3 cases fail), Canvas Bird (jump speed, collision window, 30 fps gate: 6, 16, 5 of 30 pass), Dino (gravity, head-box
width, gap factor, flying-obstacle speed, an extra acceleration on the crash frame: 28, 3, 28, 7 and 21 cases fail).

**Dino cosmetic randomness cannot change the trace**: `node games/dino/record.mjs --visual` replays every case with two
other seeds for clouds, stars and blinking; traces and tapes were identical.

## Playable pages

`docs/play/*.html` are single files made by `node scripts/bundle.mjs`. 2048 was opened from `file://` in headless
Chromium without console errors and played a few moves. Dino and Canvas Bird pages were loaded at desktop and phone width
by their authors with no errors; they have not been played by a person.

## Gaps (read before quoting any number)

- **Coverage is what the cases hit.** Dino: only 7 crashes into the flying obstacle, none while speed-dropping; no
  touch/mouse input, blur/focus, other canvas widths, or a restart in the frame right after a crash. Canvas Bird: 11 hits on
  the bottom pipe, no hit where the pipe in range is not the "next" one, at most one click per frame, dt between 8 and
  100 ms. 2048: sizes other than 4x4 and animations are not modelled.
- Dino cap-speed runs are rare (3 of 29 cases) because they need about 3,500 frames without a crash.
- The Dino and Canvas Bird originals are small copies of open-source projects (see `NOTICE`), not the commercial games.
- Dino's first key press starts a second update chain in the original (two updates per frame); the port reproduces it.
  It was found by comparing, and is written up in `games/dino/GAME.md`.
- Unity and Bevy ports do not exist yet. The Godot port covers 2048 only. Its playable scene (`main.tscn`) was loaded
  headless and fed key presses without errors; nobody has looked at it on screen. Godot 4.4.1 was downloaded from the
  official release and checked against the published SHA-512 before use. Breaking the GDScript port (spawn odds, win
  threshold) made 16 and 3 of 19 cases pass, so the check bites there too.
- The repository has not been pushed anywhere. Cases are stored gzipped (`rea-game pack`).
- The agent plugin manifest (`.claude-plugin`) was written from the documented format and has not been installed in
  Claude Code. The Codex plugin format is not provided; `AGENTS.md` points Codex at the skill.
- `node games/dino/record.mjs --visual` reads unpacked `cases/*.json`; run `rea-game record dino` first (it also clears packed copies).
- CI (`.github/workflows/verify.yml`) has never run.
