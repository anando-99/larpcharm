# Model card: the spell network

| | |
| --- | --- |
| task | recognise air gestures ("spells") drawn with the charm in hand, and fingerprint new ones for teach-your-own |
| input | one take from the charm's QMI8658: accel (g) and gyro (°/s) at 100 Hz, 1 to 6 s, starting with the hand still |
| preprocessing | trim to the active part (gyro > 25 °/s, ±0.2 s), remove starting gravity and gyro offset, gyro / 200, resample to 128 steps, add log(duration) → 7 × 128 |
| architecture | 1D CNN: conv 7→32 k5, conv 32→64 k5 /2, conv 64→64 k3 /2, conv 64→64 k3 (BN + ReLU), mean over time, linear 64→32, L2 norm |
| parameters | 38,848 (155 KB as float32) |
| output | a 32-number fingerprint; classes by nearest prototype (cosine), "no match" under 0.85 or nearest = `none` |
| classes | circle, zigzag, flick, heart, none (not a spell) |
| training data | 110 takes from one person in one sitting (20 per spell, 30 not-a-spell), heavily augmented |
| training | cosine softmax (scale 16), label smoothing 0.05, AdamW 3e-3, one-cycle, 160 epochs |
| runs on | the charm (ESP32-S3, 69 ms, `spells_engine.h`) and the website (`spells-net.js`), both verified against PyTorch to ~1e-7 |

**Cross-validated results** (`evaluate.py`; details in `eval.json` and [docs/spells.md](../../../../docs/spells.md)):
built-in spells 100% correct, none cast as another; "not a spell" 96.7% rejected; a gesture taught from 5 recordings
(never trained on) recognised 91.9% of the time, with 0.2% of other spells and 0% of not-a-spell taken for it.

**Limits.** One person, one sitting: it has learnt its owner's way of drawing, and cross-validation within a sitting is
optimistic. Not tested on other people or other grips. Casting needs a thumb on the screen; it isn't made for always-on use.

Files: `spells_cnn.pt` (PyTorch weights), `model.json` (training details and metrics), `eval.json` (the full
evaluation), `testvec.*` (takes and their PyTorch fingerprints, for the C and JS tests).
