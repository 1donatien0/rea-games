# rea-game: notes for coding agents

Read `skills/rea-game/SKILL.md` first; it is the workflow. Short version of the rules:

- Run `node bin/rea-game.mjs verify all` before saying anything works. Quote its summary line, not a paraphrase.
- Traces in `games/*/cases/` are recordings of the original. Never edit one by hand; run `rea-game record <game>`.
- A port is "verified" only when `verify` runs it through its runner and every case is identical.
- No game art, audio, names or code from an original goes into a port unless the original's licence allows it (see `NOTICE`).
- Keep `NOTICE`, `docs/STATUS.md` and the README numbers in step with what `verify` prints.
- Mistakes worth not repeating go in `docs/pitfalls.md` in the same change.
