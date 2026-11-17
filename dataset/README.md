# The spells dataset

Air gestures ("spells") drawn with the Larp Charm in hand, recorded by the charm's own 6-axis IMU. This is the data
the spell network was trained and evaluated on (see [docs/spells.md](../docs/spells.md) and the training notebook,
[firmware/tools/spells/train_spells.ipynb](../firmware/tools/spells/train_spells.ipynb)).

**127 takes, 5.8 minutes of motion**, one person, one sitting (2026-11-16), firmware 9.1.

| folder | what | takes | length |
| --- | --- | --- | --- |
| [`spells/circle/`](spells/circle) | one loop, clockwise, starting at the top | 20 | 2.4 to 4.0 s |
| [`spells/zigzag/`](spells/zigzag) | three sharp peaks, left to right | 20 | 2.6 to 5.0 s |
| [`spells/flick/`](spells/flick) | a quick wrist snap to the right | 20 | 0.3 to 1.1 s |
| [`spells/heart/`](spells/heart) | one stroke: from the top middle, down the left, back up the right | 20 | 3.0 to 4.7 s |
| [`not-a-spell/none/`](not-a-spell/none) | anything but a spell: holding still, tilting to read the screen, a shake, half a circle, scribbles, pointing, picking it up | 30 | 0.4 to 2.7 s |
| [`custom/anticlockcircle/`](custom/anticlockcircle) | a circle the other way round. **Never trained on**: it tests teach-your-own | 8 | 2.6 to 3.6 s |
| [`calibrate/`](calibrate) | the charm lying still on each face, and turned slowly about each axis | 9 | 5 to 10 s |

## Files

- **`index.csv`**: one row per take. `file`, `label`, `group` (spell, none, custom, calibrate), `session`, `posture`,
  `grip`, `trigger` (thumb: held while drawing; timed: started by the website), `hz`, `samples`, `seconds`,
  `missed` (samples the sampler missed: 1 in the whole set), `accel_lsb_per_g` and `gyro_lsb_per_dps` (the raw
  scale), `recorded_at` (UTC) and `firmware`.
- **One CSV per take**: `t_s, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps`, at 100 Hz. Takes are numbered in recording order.

```python
import sys; sys.path.insert(0, 'firmware/tools/spells')
from spells_data import load
takes = load('dataset')          # list of dicts: label, group, ..., 'x': (samples, 6) array in g and dps
```

## How it was recorded

- **Sensor.** QMI8658 on a Waveshare ESP32-S3-Touch-LCD-1.69: accel ±8 g, gyro ±2048 °/s, 224 Hz on the chip
  with its ~30 Hz low-pass, sampled at exactly 100 Hz by a FreeRTOS task. Raw 16-bit values (4096 per g, 16 per °/s).
  The CSVs give them in g and °/s; `spells_data.load` puts them back on the exact raw steps.
- **Axes** (from the calibrate takes): **+X towards the top of the screen, +Y towards the right edge, +Z into the screen**,
  away from you. With the charm held upright, screen facing you, gravity reads about +1 g on X.
- **Protocol.** Grip: fingertips, screen facing you. Thumb on the charm's screen, hold still about half a second,
  draw the gesture in the air, hold still, let go. Size and speed were varied on purpose; the shape was not. Recorded
  sitting, with the website's spells tab (*record training data*), which plots every take so bad ones were deleted on the spot.
- **Calibration.** Timed takes with the charm untouched: flat screen up (`still`, 10 s), screen down and on each
  edge (5 s), then turned slowly a quarter turn and back about each axis (`turn-x`, `turn-y`, `turn-z`, 8 s).
  The gyro's resting offset (1 to 5 °/s) drifts between takes, so every take should be corrected from its own still start.

Left out of this folder: an accidental 0.3 s take recorded under a calibration label, and a `screen-down` take
where the charm was still moving. Both were replaced by good takes in the same sitting.

## Limits

One person, one sitting, one grip. Models trained on it will have learnt that person's way of drawing; within-sitting
cross-validation is optimistic. More sittings and more people are the next thing to record.

## Licence

The same as the rest of the repo: [MIT](../LICENSE).
