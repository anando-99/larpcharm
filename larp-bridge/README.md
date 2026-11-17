# larp-bridge

Links Claude Code on your computer to the Larp Charm. No dependencies, just Node 18+.

```
Claude Code ──hooks / status line──▶ bridge.mjs (127.0.0.1:7337) ──SSE──▶ web app ──BLE──▶ charm
     ▲                                     │                                               │
     └──── permission decision ◀───────────┘◀──────── allow / deny / launch ────────────────┘
```

| File | What it does |
| --- | --- |
| `bridge.mjs` | Keeps the session state, streams it to the web app, waits for permission answers, launches presets, and serves the web app at `http://localhost:7337`. |
| `hook.mjs` | The Claude Code hook. Forwards each event; for `PermissionRequest` it waits for the charm's answer and prints Claude Code's decision JSON. Exits at once, printing nothing, if the bridge isn't running. |
| `statusline.mjs` | A status line (`◆ Opus 5.5 · larpcharm · ctx 37% · $0.84`) that also passes model, cost and context to the bridge. |
| `install.mjs` | Adds the hooks (and the status line, if you don't have one) to `~/.claude/settings.json`, with a backup. `--uninstall` removes them. |
| `presets.json` | The launcher: up to six `{ name, cwd, prompt, args }` sessions the charm can start in Terminal. |

Safety: the bridge binds to `127.0.0.1`, refuses web requests from origins other than the web app (set `LARP_ORIGINS` to change them), refuses hook posts that come from a web page, and the launcher can only run your presets. Permission prompts only wait for the charm when one is actually connected, and for at most 45 seconds before the normal prompt takes over.

## Steam

The charm's `steam` screen shows your profile, your library with its hours and the game you're playing. Steam's Web API sends no CORS headers, so the web page can't ask it; the bridge does. In the web app's **steam** tab, paste a [Steam Web API key](https://steamcommunity.com/dev/apikey) and your profile (its URL, custom name or SteamID64) and press save: the bridge tries them with Steam first and only keeps them if Steam accepts them. The key stays in `~/.larp-bridge/steam.json` (a folder only you can open, outside the project) and is never sent back to a page. `STEAM_API_KEY` and `STEAM_ID` in the environment work too.

While a page is open the bridge asks Steam what you're playing every 30 s and reads your library every 10 min (and whenever a game ends). Hours and games need your profile's **Game details** set to Public.
