# Mönkijä Mayhem

A single-screen stadium ATV racer for the browser, in the spirit of *Super Off Road*.
Four riders, a 3/4 view of a dirt arena, jumps, hills, mud, nitro and an 8-race season
with a pit shop between races.

**Play:** https://leadnose.github.io/monkija-mayhem/

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Gas |
| ↓ / S | Brake / reverse |
| ← → / A D | Steer |
| Space / Shift | Nitro |
| P / Esc | Pause |
| M | Mute |

On touch screens, on-screen buttons appear during races.

## Running locally

No build step. Open `index.html` in a browser.

## Code

- `index.html`: page, styles and menu overlays
- `game.js`: track building, physics, AI, rendering, audio, season and shop logic

Tracks are lists of corner points in `TRACK_DEFS` (screen coordinates); jumps, bumps,
hills and puddles are placed on them automatically. The camera angle is the `K` constant.
