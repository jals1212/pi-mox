# Changelog

Each release of `pi-mox`. Versions follow [semantic versioning](https://semver.org); before 1.0.0 a minor
version may add commands and options and a patch version fixes.

## Unreleased

## 0.1.0

### Added

- `/mox <time> <message>` schedules a message for the agent. At that time the message is delivered as a
  follow-up (after the current turn, or at once when Pi is idle) and starts a turn.
- Absolute times `10:30` (24-hour; today, or tomorrow when the time is not ahead) and relative times
  `+2h15m`, `+90m`, `+45s`.
- `/mox list` (or bare `/mox`) shows the pending cues; `/mox cancel <id>` cancels one by Roman or Arabic id.
  Several cues can wait at once, and ids are never reused within a session.
- Footer `·MOX· 10:30 · II h VI m` for the next cue, with `(+N)` when more wait.
- The delivered message is shown as `·MOX· 10:30 — <message>`.
- Cues live in memory only: closing Pi drops them. Each fires once and is not retried.
