# Spells: air-gesture recognition tools

Python tools for the air-gesture "spells". The data comes from the website's **spells** tab (see the main
README, "Recording spells"). Needs Python 3 with numpy, matplotlib and PyTorch, plus a C compiler for the DTW helper.

| Script | What it does |
| --- | --- |
| **`train_spells.ipynb`** | **the whole training, step by step, with every output: data, baseline, preprocessing, network, cross-validation, teach-your-own, the final model** |
| `export_dataset.py export.json ../../../dataset` | turns a spells-tab export into the repo's dataset folder (one folder per shape) |
| `spells_data.py` | loads the dataset folder or an export; gyro offset, active-part trimming, the gyro stroke |
| `spells_model.py` | the network and its input pipeline (mirrored in the firmware and the website) |
| `dtw.py`, `dtw.c` | dynamic time warping, compiled on first use |
| `look.py data.json out.png` | a contact sheet of every take's stroke, one row per label |
| `baseline.py data.json` | the no-ML baseline: 1-nearest-neighbour with DTW on all six channels |
| `evaluate.py data.json model/eval.json` | cross-validation of the built-in spells and leave-one-gesture-out teach-your-own |
| `train.py data.json model/eval.json` | trains the final network and exports `spells_model.h` (charm) and `spells-model.js` (website) |
| `figures.py data.json` | the figures in `docs/spells/` |
| `test_engine.cpp`, `test_net.js` | check the charm's and the website's engines against PyTorch (also in CI) |
| `device_eval.py ../../../dataset model/device_eval.json` | hardware in the loop: replays every take through the network on a charm plugged in over USB |
| `charm_serial.py` | talks to the charm over USB serial (standard library only) |
| `requirements.txt` | the Python packages (PyTorch separately) |
| `train_cnn.py` | the first CNN experiment (5-fold CV), kept for reference |

The model itself, with a model card: [`model/`](model/). The full write-up: [docs/spells.md](../../../docs/spells.md).

The recordings are in [`dataset/`](../../../dataset) (raw exports, `larp-spells-*.json`, stay out of git). Every
script takes the dataset folder or an export file as its first argument.

## The sensor, from the calibrate takes (firmware 9.1)

- Axes: **+X towards the top of the screen, +Y towards the right edge, +Z into the screen** (away from you).
- Accelerometer: offsets 0.03 to 0.05 g, scale within 2%. Fine as it is.
- Gyro: a resting offset of about 1 to 5 °/s on X and Y that **drifts between takes**, so it is taken from the
  still half second at the start of every take. The recording protocol's "hold still" matters.
- Drawing with the screen facing you, the back of the charm swings left as it turns about +X and up as it turns
  about +Y. The stroke on screen is (−angle about X, −angle about Y).

## Results

See [docs/spells.md](../../../docs/spells.md). In short (cross-validated, one person, one sitting): the built-in spells
are 100% right with 96.7% of "not a spell" rejected, and a gesture taught from 5 recordings is recognised 91.9% of the
time. The network runs on the charm in 69 ms.
