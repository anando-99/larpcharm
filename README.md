# Larp Charm

**A wearable bag charm with a touchscreen, a Web Bluetooth control app that looks and works like a terminal, and a pocket remote for Claude Code.**

Larp Charm runs on a Waveshare ESP32-S3-Touch-LCD-1.69 (240×280 IPS, capacitive touch, 6-axis IMU, buzzer, LiPo). The firmware is a small single-sketch "OS" with a cyberdeck interface and a dozen apps. The companion web app pairs over Bluetooth LE: no install, no backend, no native app. It also runs a live copy of the charm's screen in the page.

**Live web app: [anando-99.github.io/larpcharm](https://anando-99.github.io/larpcharm/)**

![Web app with the live charm preview](docs/web-app.png)

## Highlights

- **A remote for Claude Code.** `larp-bridge` (a dependency-free Node script) plugs into Claude Code's hooks and status line. The charm's `cc` screen then mirrors your real session on the laptop: the live transcript with tool calls and results, the spinner with Claude's actual state, and a `/status`-style page with model, context, cost, time and lines changed. When Claude needs permission, the charm buzzes and shows an **approve / deny** card, and your tap answers Claude on the laptop. A launcher page starts preset sessions in Terminal. The mascot reacts to all of it. It is fail-safe by design: if the bridge or the charm isn't there, Claude Code behaves exactly as normal, and unanswered prompts fall back to the terminal after 45 s.
- **A control panel that is a terminal.** The web app is styled like a tmux session (panes, `0:claude 1:look …` windows, `[ buttons ]`, `--flags`), with a real command line pinned to the bottom: `open claude`, `theme phosphor`, `msg ship it`, `timer 25`, `allow`, `launch 2`, `status`, with history and tab completion.
- **Custom BLE protocol.** A Nordic-UART-style GATT service with 23 binary commands, chunked file transfer (JPEG photos, album art, songs, sing-along shows) and a notify channel for battery, version and storage status.
- **The deck: a live tmux session.** Home is a terminal drawn in the classic 5×7 bitmap font. Each pane is labelled with the command that would print it (`$ date`, `$ np`, `$ ps pet`, `$ imu --scope` with a live accelerometer oscilloscope, `$ cat motd`), and a tmux-style status bar holds the other screens as windows (`img sng id eye jbx tty cc`). Tap a pane and the prompt types `open <pane>` before zooming in.
- **`dmesg -w` for a bag charm.** The firmware keeps its own kernel-style event log (`klog`) and tails it on the deck: Bluetooth link changes, charging and battery steps, shakes with their g-force, step milestones, time syncs, received messages and files, songs, timers. Every line is a real event, timestamped from boot.
- **Two terminal companions.** Like the animated eyes, they can take over when the charm is idle:
  - **`tty`**: a big kaomoji living in the terminal (`(o_o)`, `(^_^)`, `(♥_♥)`, `(@_@)`, `(-_-) zZ`) over a faint cmatrix rain. It blinks, glances around and changes mood by itself, reacts to taps and shakes, and thinks out loud at a typed prompt using real data: battery, steps, the song playing, the time of night.
  - **`cc`**: an homage to the Claude Code terminal UI, with its blocky orange mascot in the welcome box (it looks down while a prompt is typed, bounces and flaps while Claude works, does a happy hop when a session ends, waves when you tap, goes dizzy when shaken and sleeps when idle; tap it and it pops out to full screen as a pocket pet you can pet, make jump, walk around, tilt and shake, with a mood meter that fills when you pet it), the `✻` spinner and its whimsical verbs, tool calls with `⎿` results, and the input box. It loops through little sessions about the charm and answers with live data ("why is my battery at 76%?" reads the real voltage). Tap to say hi; shake it and it notices the g-force.
- **Spotify integration.** OAuth 2.0 PKCE runs entirely in the browser (no client secret, no server). The charm shows the album art full screen, takes its accent colour from the cover, and gives you tap zones for previous, play/pause and next.
- **Sing-along.** Type lyrics and a pencil-doodle kitten acts each line out with faces, props and scenes. The browser preview (`sing.js`) is a line-by-line port of the firmware renderer, drawing into the same 240×280 RGB565 frame with the same glyph bitmaps.
- **Weather, with Biscuit.** Pick a city (or your location) in the app; it fetches the weather from [Open-Meteo](https://open-meteo.com) (free, no key) and sends it over Bluetooth. Biscuit, a pixel-art pup, dresses for it in one of eight outfits: shades and a popsicle when it's hot, a backwards cap when it's warm, a hoodie, a scarf and beanie, a puffer and earmuffs (with frosty breath) when it's freezing, a raincoat and umbrella in the rain, a winter coat and snowball in the snow, pyjamas and a nightcap at night. It breathes, sways as you tilt the charm, turns to look around, shivers in the cold, trembles at thunder, and hops with hearts when you tap it. The scene lives too: parallax hills, a tree that sways with the real wind, flowers, birds and the odd plane, butterflies on warm days, fireflies and shooting stars at night, puddles that ripple, a snowman, blowing leaves, a rainbow after drizzle and lightning in storms. Up top: temperature, high/low, feels-like, humidity, wind, and a four-hour forecast with icons. `weather <city>` works at the `larp>` prompt.
- **Minigames.** Next to the oracle, dice and coin: tic-tac-toe against the charm (minimax with the odd deliberate slip, so it's beatable), rock-paper-scissors with a countdown, and a reflex test that times you in milliseconds and keeps your best. Playable in the web preview too, or start one with `game ttt` at the `larp>` prompt.
- **Motion and sound.** Shake to wake, roll dice, ask the oracle or shuffle backdrops. There's a buzzer jukebox of public-domain melodies, and you can upload your own songs from MIDI files.
- **Reproducible asset pipeline.** Fonts and melodies are generated by Python scripts into C headers (and JS modules for the web app), so the firmware and the browser preview never drift apart.
- **Also:** 6 colour themes, 11 animated backdrops, 4 clock faces, expressive animated eyes, a virtual pet with a step counter, an ID card, a torch, a timer, an hourly chime, a charging screen and an NFC tag writer (Web NFC).

## Architecture

```
┌──────────────────────────── Browser (Chrome) ─────────────────────────────┐
│ index.html   UI and styles, plus the larp> command line                    │
│ app.js       BLE connection, command packets, file transfer, Spotify PKCE  │
│ charm.js     live 240×280 simulator of the charm's screen                  │
│ sing.js      sing-along renderer (port of the firmware's)                  │
│ songs.js, sing-font.js, pup.js   generated from the firmware's sources     │
└──────────────┬────────────────────┬────────────────────────────────────────┘
               │ SSE + JSON         │ Web Bluetooth (GATT write / notify)
┌──────────────▼─────────────┐      │
│ larp-bridge/bridge.mjs     │◀── Claude Code hooks (hook.mjs) + status line
│ 127.0.0.1:7337, no deps    │      │
└────────────────────────────┘      │
┌───────────────────────────────────▼────────────────────────────────────────┐
│ firmware/LarpCharm/LarpCharm.ino   ESP32-S3, Arduino core 3.x              │
│   ST7789V2 display (Arduino_GFX) · CST816T touch · QMI8658 IMU · buzzer    │
│   NimBLE GATT server · FFat storage · JPEGDEC · PSRAM frame buffers        │
│ aafonts.h · songs.h   generated by firmware/tools                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### BLE protocol

| UUID | Role |
| --- | --- |
| `6e400001-c4a7-4d2e-9b3c-c4a2d7c0ffee` | Service |
| `6e400002-…` | RX: app → charm, `[cmd][payload…]` |
| `6e400003-…` | Status: charm → app, read and notify (`key=value` text) |

Commands cover mode switching, text, time sync, now playing, chunked transfer (`XFER_BEGIN/DATA/END`), brightness, pet, ID card, settings, themes, eyes, jukebox, torch and song management. The full table, with payload layouts, is the `enum Cmd` in [`LarpCharm.ino`](firmware/LarpCharm/LarpCharm.ino).

## Repository layout

```
index.html, app.js, charm.js, sing.js   web app (served by GitHub Pages)
songs.js, sing-font.js, pup.js          generated data shared with the firmware
docs/                                   README media
larp-bridge/                            Claude Code ⇄ charm bridge, hooks, installer, launcher presets
firmware/LarpCharm/                     Arduino sketch and generated headers
firmware/tools/                         generators: fonts, melodies and the pup sprite
scrapped/                               retired looks (Aero, Quest, Ronin, Cotton), kept for reference
```

## Getting started

### Web app

Open the [web app](https://anando-99.github.io/larpcharm/) (or serve the repo root locally with `python3 -m http.server`) in Chrome on Android, Windows, macOS or Linux, then press **Connect**. Web Bluetooth needs a secure context (HTTPS or `localhost`). The preview works without a charm.

**Spotify (optional).** Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), add the page's exact URL as a redirect URI, and paste the Client ID into the Music panel. Playback controls need Spotify Premium.

### Claude Code remote (optional)

```sh
node larp-bridge/install.mjs      # once: adds the hooks and a status line to ~/.claude/settings.json (with a backup)
node larp-bridge/bridge.mjs       # keep it running while you work
```

Open `http://localhost:7337` (the bridge serves this web app), connect the charm, and open its `cc` screen. Swipe sideways for session, status and launch. Edit `larp-bridge/presets.json` to change the launcher. `node larp-bridge/install.mjs --uninstall` takes the hooks back out. The bridge only listens on `127.0.0.1`, only accepts commands from this web app's origins, and the launcher can only start the presets you define.

### Firmware

1. Install the **esp32 by Espressif** board package (3.x) and these libraries from the Library Manager: **GFX Library for Arduino** (1.6.x), **NimBLE-Arduino** (2.x), **JPEGDEC** (1.x).
2. Open `firmware/LarpCharm/LarpCharm.ino` and select:
   - Board: **ESP32S3 Dev Module**
   - USB CDC On Boot: **Enabled**
   - Flash Size: **16MB**
   - PSRAM: **OPI PSRAM**
   - Partition Scheme: **16M Flash (3MB APP/9.9MB FATFS)**
3. Upload.

Or from the command line:

```sh
arduino-cli compile --upload -p <port> \
  --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB" \
  firmware/LarpCharm
```

The web app and the firmware are versioned together; this app expects firmware **8.5** (shown on the charm's status screen and in the app once connected).

## Using the charm

| Gesture | Action |
| --- | --- |
| Tap | Open a pane (the prompt types the command first) / interact |
| Swipe down, or the side button | Close / back home |
| Swipe left or right | Colour theme (the terminal's colour) on home, backdrop on the clock, next or previous track, depending on the screen |
| Swipe up or down on home | Brightness |
| Press and hold | ID card |
| Shake | Wake, roll dice, shuffle, make the pet dizzy |
| Hold PWR for 2 s | Power off (on battery) |

## Asset pipeline

The generated files are checked in, so you only need these scripts to change the fonts, songs or sprite. They need Python 3 with Pillow.

| Script | Output |
| --- | --- |
| `firmware/tools/songs.py` | `songs.h` and `songs.js` (run from a scratch dir, then copy) |
| `firmware/tools/mkfont.py out.h [fontdir]` | `aafonts.h` (anti-aliased 4-bit fonts) |
| `firmware/tools/mkfontjs.py aafonts.h sing-font.js` | the sing-along lettering for the web app |
| `firmware/tools/mksprite.py [sheet.png]` | `pup_sprite.h` and `pup.js` from `pup_sheet.png` (8 outfits, 4×2 grid, transparent background) |

Font files are not in the repo. Download them from Google Fonts (SIL Open Font Licence) into a `fonts/` folder next to the script.

## Credits

- Fonts: Nunito and Gloria Hallelujah (SIL Open Font Licence 1.1), rasterised into bitmaps.
- Melodies are public domain or original.
- Libraries: [Arduino_GFX](https://github.com/moononournation/Arduino_GFX), [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino), [JPEGDEC](https://github.com/bitbank2/JPEGDEC).

## License

[MIT](LICENSE)
