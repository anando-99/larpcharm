# Scrapped looks

The main project now ships with one look, the Deck. This folder keeps the four looks that were removed, as a complete, working snapshot of firmware 7.0 and its web app, so any of them can be revived later.

| Look | What it was |
| --- | --- |
| **Aero** | Glossy Frutiger Aero / Y2K: a ring of glass orbs you spin by dragging or tilting the charm, with Meadow, Ocean and Bubblegum styles. |
| **Quest** | A scrolling pixel-art JRPG village with parallax layers, lit by the real time of day. |
| **Ronin** | A samurai climbing a mountain stairway at night. |
| **Cotton** | A pastel personal look with an avatar, a mood window, a status badge and a bio page. |

## What's here

```
firmware/LarpCharm/        firmware 7.0 with all five looks (builds as is)
firmware/tools/quest/      generators for the Quest and Ronin pixel art (questart.h, roninart.h)
firmware/tools/preview/    renders the Cotton screens on a desktop from the firmware's own code
web/                       the matching web app: look picker, Me tab, Aero/Quest/Ronin/Cotton previews
docs/cotton.png            Cotton screens, rendered from the firmware
```

## Running it

- **Firmware:** open `firmware/LarpCharm/LarpCharm.ino` and flash it with the same board settings as the main README.
- **Web app:** serve `web/` with `python3 -m http.server` and open it in Chrome.

Firmware 7.0 and the main web app (8.0) don't talk to each other fully: 7.0's look-switch and profile commands are gone from 8.0.
