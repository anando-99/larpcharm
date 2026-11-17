# The firmware

How the Larp Charm's firmware is put together: its modules, its tasks and memory, the Bluetooth protocol, pairing
and its threat model, updates over the air, the USB serial interface the tools use, and how a release is built.

**Hardware.** Waveshare ESP32-S3-Touch-LCD-1.69: ESP32-S3 (two Xtensa LX7 cores at 240 MHz, 512 KB SRAM, 8 MB
octal PSRAM, 16 MB flash), a 240 × 280 ST7789V2 IPS screen on SPI, CST816T capacitive touch, QMI8658 6-axis IMU,
PCF85063 real-time clock, a buzzer, and a LiPo with charging. **Toolchain:** Arduino core for ESP32 3.3.12,
GFX Library for Arduino 1.6.9, NimBLE-Arduino 2.5.2, JPEGDEC 1.8.5.

## Modules

The sketch is one Arduino sketch in 21 files (5,825 lines). Arduino joins them after `LarpCharm.ino` in name order, so the
numbers fix the order (each file can use what the files before it declare).

| file | lines | what's in it |
| --- | --- | --- |
| `LarpCharm.ino` | 409 | pins, the Bluetooth command set, the display, shared state, helpers |
| `01_sensors.ino` | 124 | the clock chip (RTC) and the motion sensor |
| `02_graphics.ino` | 540 | text layout, drawing primitives, anti-aliased shapes, animated backgrounds |
| `03_deck.ino` | 296 | home: the deck (a live tmux session) and its window chooser |
| `04_screens.ino` | 449 | clock, message, photo, music (Spotify), pet, ID card |
| `05_games.ino` | 326 | the oracle, dice, coin, tic-tac-toe, rock-paper-scissors, a reflex test |
| `06_jukebox.ino` | 131 | the buzzer jukebox: built-in melodies and your own |
| `07_eyes.ino` | 235 | the animated eyes |
| `08_companions.ino` | 716 | tty (a kaomoji) and cc (the Claude Code remote and its mascot) |
| `09_charging.ino`, `10_weather.ino` | 333 | the charging screen; weather as `curl wttr.in` |
| `11_spell_recorder.ino` | 242 | the 100 Hz sampler and the training-data recorder |
| `12_spells.ino` | 535 | spells and the wand: the CNN on the charm, teach-your-own, knob, air drawing, the map |
| `13_torch_steps.ino` | 39 | the torch and the step counter |
| `14_render.ino` | 151 | screen effects, the render loop, switching screens |
| `15_auth.ino` | 131 | pairing: only paired browsers can control the charm |
| `16_ota.ino` | 51 | firmware updates over Bluetooth |
| `17_ble.ino` | 444 | status notifications, file transfers, command handling, the GATT server |
| `18_touch.ino` | 253 | taps, swipes, holds, shakes |
| `19_power.ino` | 136 | the PWR button, battery, sleep |
| `20_setup_loop.ino` | 284 | `setup()`, `loop()`, and the USB serial interface |
| `spells_engine.h` | | the spell network and DTW, plain C++ (also compiled on a computer by `test_engine.cpp`) |
| `spells_model.h` | | generated: the network's weights, prototypes, DTW recordings, the map (by `train.py`) |
| `songs.h` | | generated: the built-in melodies (by `firmware/tools/songs.py`) |

## Tasks and timing

| where | what |
| --- | --- |
| core 1, `loop()` | Bluetooth packets from a queue, touch, the PWR button, the IMU at 50 Hz, the spell engine, and drawing: each frame is drawn into a PSRAM canvas and pushed to the screen over 80 MHz SPI |
| core 0, `recTask` (priority 3) | the IMU at exactly 100 Hz while the spell screens are open (`xTaskDelayUntil`), so drawing can never make the timing uneven. It missed 1 sample in 35,000 recorded |
| NimBLE host task | the GATT server. Writes are copied into a FreeRTOS queue (`rxQueue`) and handled on core 1, so a command never races the drawing |

## Memory

**Flash** (16 MB): `nvs` (settings and pairing keys), two 3 MB app slots (`app0`, `app1`, for updates over
Bluetooth), and a 9.9 MB FAT partition for your photo, songs, taught spells and the album art cache. The app is 1.10 MB.

**PSRAM** (8 MB): the screen canvas and the zoom animation's copy of it (2 × 131 KB), the photo (131 KB), the album
art views (131 + 157 + 29 KB) and its JPEG (96 KB), a recorded take (14 KB), your taught spells' recordings (6 × 36
KB), and the spell engine's stored DTW recordings and take buffer (about 90 KB).

**Internal RAM**: the spell network's working memory (about 45 KB, in fast internal RAM on purpose: moving it out of
PSRAM, with the convolution loops reordered, took the network from 174 to 69 ms), the transfer buffer, the sketch canvas.

## The Bluetooth protocol

One GATT service, `6e400001-c4a7-4d2e-9b3c-c4a2d7c0ffee`. The browser writes `[command][payload]` to `…0002`; the
charm answers with text notifications (`key=value;…`, or `prefix=…`) on `…0003`. The MTU is 517.

| command | payload | |
| --- | --- | --- |
| `0x01` MODE | screen | open a screen |
| `0x02` TEXT | style, fg, bg (RGB565), text | the message |
| `0x03` TIME | unix seconds, UTC offset (minutes) | set the clock |
| `0x04` NOWPLAYING | colour, playing, position, length, title 0x1F artist [0x1F volume,shuffle,repeat 0x1F device] | Spotify |
| `0x05`–`0x07` XFER | begin [kind, size, id (, SHA-256)], data, end | files: photo (0), album art (3), song (4), firmware (6). The charm acks every 16 chunks |
| `0x08` BRIGHTNESS, `0x0B` SETTINGS, `0x15` THEME, `0x12` LOOK | | settings |
| `0x09` PET, `0x0E` FEED, `0x0A` CARD, `0x17` EYES, `0x13` TIMER, `0x14` TOY, `0x19` TORCH, `0x0D` BUZZ | | the other screens |
| `0x18` TUNE, `0x1A` SONG_LIST, `0x1B` SONG_DELETE | | the jukebox |
| `0x1E` CC | op, … | the Claude Code remote (larp-bridge relays it) |
| `0x1F` WEATHER | conditions, temperatures, 4 hours, place | weather |
| `0x20` REC | op, … | the spell recorder |
| `0x21` SPELL | op, … | the spellbook: actions, teaching, forgetting, the wand's views |
| `0x22` AUTH | op, … | pairing (below) |
| `0x0C` PING | | the charm answers with its full status (or, while locked, the pairing challenge) |

Notifications include the status (`b=` battery, `m=` screen, `fw=`, `th=` theme, `wv=` the spell screen's view,
`ch=` the window chooser…), sent at once when the screen changes so the website's preview follows the charm.
Also `ack=` for transfers, `media=` (the charm's music keys and knob), `cast=` (each spell cast: the result, the top
three, its power and where it lands on the map), `rec0/1/2=` (recorded takes, base64 in chunks with a byte sum),
`sk=` (air drawing strokes), and `auth=` (pairing).

## Pairing, and the threat model

Anyone within Bluetooth range can open a link to the charm, so **every link starts locked** (`15_auth.ino`):

1. The browser sends PING. The charm answers with a fresh random 128-bit challenge (a new one every time one is asked for).
2. A browser the charm knows answers with **HMAC-SHA256(its key, challenge)**. The charm checks it against the up to
   4 keys it remembers, in constant time, and unlocks the link. The challenge is then discarded.
3. A new browser asks to pair. The charm shows a **6-digit code** on its screen for 60 s. The browser sends the code;
   the charm generates a random 128-bit key, stores it in NVS and sends it once. The browser keeps it (per charm, in
   its own storage). Three wrong codes lock pairing for 30 s.

Until a link is unlocked, the charm acts only on PING and AUTH and sends nothing but `auth=` messages. The status
characteristic's stored value is cleared, so nothing from an earlier link can be read either.

| threat | covered? |
| --- | --- |
| a stranger connects and sends commands (changes the screen, sends a message, **approves a Claude Code permission**, pushes firmware) | **yes**: nothing gets past a locked link |
| someone records an unlock and replays it | **yes**: each challenge is random and used once |
| someone guesses the pairing code | **yes**: they'd also have to see your screen; 3 tries, then a 30 s lock |
| someone reads the charm's notifications on a locked link | **yes**: it only sends `auth=` messages |
| a radio sniffer reads traffic on a paired link | **no**: the link itself isn't encrypted (BLE link-layer pairing isn't reliably available to Web Bluetooth across browsers and OSes) |
| a sniffer captures the key at the moment you pair | **no**, for the same reason; pair somewhere private, and use *forget other browsers* (sys tab) to revoke |
| someone with your unlocked browser | out of scope: they are you |

## Updates over Bluetooth

`16_ota.ino`. The website sends the app image (`flash/larpcharm-ota.bin`) as a transfer of kind 6, with its SHA-256
in the header. Only an unlocked link can start one. The charm streams it into the app slot it isn't running from
(`Update`), hashing as it goes. Only if the hash matches and the image passes the ESP-IDF image checks does it mark
the new slot to boot and restart. A wrong hash, a broken image or a dropped link leaves the old firmware running.
It keeps everything in the FAT partition and NVS (your photo, songs, taught spells, pairing keys, settings).

## USB serial

`20_setup_loop.ino`. One command per line, for development and for the tools:

| command | |
| --- | --- |
| `mode <n>`, `view <v>`, `choose` | open a screen, a spell-screen view, the window chooser |
| `shot` | the frame buffer as base64 RGB565: `firmware/tools/screens.py` builds the [screen gallery](screens/gallery.png) from it |
| `take <base64>` | cast a recorded take through the charm's own engine, without its action, and print the decision, fingerprint and timing: `firmware/tools/spells/device_eval.py` replays the whole dataset this way |
| `time <unix> <offset>`, `demo …`, `reboot` | set the clock; sample content for screenshots (in memory only) |
| `r`, `c`, `k`, `t`, `x` | open the recorder / cast screen, next wand view, a 2 s timed take, close |

**Pairing and updates, tested on the charm** (`firmware/tools/test_link.py --ota`): 18 checks through the real
handler. A locked link refuses commands; a made-up answer fails; a wrong code is refused and three lock pairing; the
right code pairs; Python's HMAC-SHA256 unlocks a new link (so mbedtls on the charm agrees); a replayed answer fails;
a locked link can't start an update; an image with the wrong SHA-256 is refused; and a real 1.1 MB image is accepted,
after which the charm restarts into the other app slot and unlocks again. (These tests found that, before any
Bluetooth connection, a just-booted charm's first challenge was all zeros; challenges are now fresh every time one is issued.
Capturing the gallery found that a restart from a spell screen left the motion sensor in its ±8 g range, where startup
rejected it; the sensor is now soft-reset at every startup.)

**Hardware in the loop** (`device_eval.py`, firmware 1.0.0): all 118 recorded takes, replayed through the network on
the charm, give **the same decision as PyTorch for 118 of 118**. The fingerprints differ by at most **6 × 10⁻⁷**, and
the network takes **68 to 70 ms** each time.

## Build, flash, release

```sh
# build and flash over USB
arduino-cli compile --upload -p /dev/cu.usbmodem* \
  --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB" firmware/LarpCharm

# a release: build, copy the images to flash/ for the website (and with --gh, a GitHub release)
firmware/tools/release.sh --gh
```

`flash/` holds what the website offers. *Install over USB* (ESP Web Tools, on Chrome or Edge) writes the
bootloader, partition table, `boot_app0` and the app at their offsets, which leaves the data partition alone.
*Update over Bluetooth* sends the app. CI (`.github/workflows/ci.yml`) builds the firmware on every push with the
same board package and library versions.
