# Spells: air-gesture recognition tools

Python tools for the air-gesture "spells". The data comes from the website's **spells** tab (see the main
README, "Recording spells"). Needs Python 3 with numpy, matplotlib and PyTorch, plus a C compiler for the DTW helper.

| Script | What it does |
| --- | --- |
| `spells_data.py` | loads a `larp-spells/1` file; gyro offset, active-part trimming, the gyro stroke |
| `look.py data.json out.png` | a contact sheet of every take's stroke, one row per label |
| `baseline.py data.json` | the no-ML baseline: 1-nearest-neighbour with DTW (`dtw.c`) on all six channels |
| `train_cnn.py data.json` | the first 1D CNN (fingerprint network), with 5-fold cross-validation |

Recordings stay out of git (`larp-spells-*.json` and `data/` are ignored).

## The sensor, from the calibrate takes (firmware 9.1)

- Axes: **+X towards the top of the screen, +Y towards the right edge, +Z into the screen** (away from you).
- Accelerometer: offsets 0.03 to 0.05 g, scale within 2%. Fine as it is.
- Gyro: a resting offset of about 1 to 5 °/s on X and Y that **drifts between takes**, so it is taken from the
  still half second at the start of every take. The recording protocol's "hold still" matters.
- Drawing with the screen facing you, the back of the charm swings left as it turns about +X and up as it turns
  about +Y. The stroke on screen is (−angle about X, −angle about Y).

## First results (2026-11-16: one person, one sitting, 118 takes)

The gyro strokes show how the gestures are drawn: mostly by **moving the arm** (the accelerometer's part), and
partly by **turning the wrist** (the gyro's part). The left-to-right travel of a zigzag is almost all arm.
Recognition has to use all six channels.

| 5-fold / random splits | DTW, 5 templates per class | 1D CNN (38,848 parameters) |
| --- | --- | --- |
| circle, zigzag, heart | 99 to 100% | 100% |
| flick | 74.6% | 100% |
| "not a spell" recognised as such | 3.9% | 86.7% |
| teach-your-own (`anticlockcircle`, 5 takes) | 94.3% | 80.4% |

- Telling the shapes apart is close to solved, even without ML. The hard part is saying **"no match"**, and the
  CNN does that far better.
- Teach-your-own works with DTW straight away, even for a circle drawn the other way round. The CNN's fingerprints
  don't generalise to new gestures yet, because it has only seen five kinds. Training it on many more (synthetic)
  gesture classes is the next step.
- These numbers are optimistic: every take is from one sitting. The real test is training on sitting 1 and
  testing on sitting 2.

## Next

1. Record sitting 2, then test across sittings.
2. A motion simulator for arm-and-wrist drawing, tuned to these recordings, to make hundreds of gesture classes.
3. Train the fingerprint network on simulated and real data; export it to C and JS.
4. On the charm: run it live, with teach-your-own (prototypes saved in flash) and DTW as the fallback.
