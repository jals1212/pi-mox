# Changelog

Each release of `pi-mox`. Versions follow [semantic versioning](https://semver.org); before 1.0.0 a minor
version may add commands and options and a patch version fixes.

## Unreleased

## 0.3.1

### Changed

- README: shorter Herdr section.

## 0.3.0

### Added

- Herdr marker: in a Herdr pane the next cue is the pane's `$mox` sidebar token, and in a Herdr app terminal
  its `mox` label, as `·MOX· 10:30 <message preview>`. Cleared when no cue is left and when the session ends.

### Changed

- The footer previews the next message: `·MOX· 10:30 revisar PR · II h VI m (+1)`.

## 0.2.0

### Added

- `/mox show <id>` shows one cue with its whole message.

### Changed

- `/mox list` and the id completions show each message on one line: whitespace and line breaks collapse to
  one space, and a message over 60 characters is cut with `…`. `/mox show <id>` gives the whole message.

## 0.1.1

### Added

- A gallery preview image (`pi.image`) in the Roman inscription look, also at the top of the README;
  its source is `assets/preview.html`.

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
