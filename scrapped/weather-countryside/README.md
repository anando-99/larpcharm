# Weather in the Japanese countryside (firmware 8.5 to 8.8)

The weather screen used to be a pixel-art spot by the rice paddies with a kid dressed for the weather. It was
replaced in 8.9 by the terminal `curl wttr.in` screen. The art sources and their generator are kept here.

```
art/          kid sheet, sky pieces and five backgrounds (pixel art made with SpriteCook)
mkwxart.py    turns them into wx_art.h (firmware) and wxart.js (web preview)
```

To bring it back, check out commit `d4e1bee` (firmware 8.8) for the drawing code, or run `mkwxart.py` from the repo
root after moving `art/` back to `firmware/tools/art/`.
