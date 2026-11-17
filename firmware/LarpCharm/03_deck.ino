// Larp Charm firmware: Home: the deck, a live tmux session, and its window chooser.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── The deck: a live tmux session ─────────────
// Every pane is labelled with the command that would print it. Tap a pane and the prompt types
// "open <pane>" before it zooms in. The bottom pane tails the charm's own event log (klog).
#define TILE_COUNT 14
const int16_t TILE_X[TILE_COUNT] = {2, 2, 152, 2, 92, 8, 33, 58, 83, 108, 132, 157, 182, 207};
const int16_t TILE_Y[TILE_COUNT] = {15, 81, 81, 141, 141, 258, 258, 258, 258, 258, 258, 258, 258, 258};
const int16_t TILE_W[TILE_COUNT] = {236, 146, 86, 86, 146, 25, 25, 25, 25, 24, 25, 25, 25, 25};
const int16_t TILE_H[TILE_COUNT] = {62, 56, 56, 54, 54, 22, 22, 22, 22, 22, 22, 22, 22, 22};
const uint8_t TILE_MODE[TILE_COUNT] = {M_CLOCK, M_MUSIC, M_PET, M_TOY, M_TEXT, M_CAST, M_MUSIC, M_PHOTO, M_CARD, M_EYES, M_JUKE, M_TERM, M_CLAUDE, M_WEATHER};
const char *TILE_CMD[TILE_COUNT]   = {"date", "np", "ps pet", "imu --scope", "cat motd", "spl", "spt", "img", "id", "eye", "jbx", "tty", "cc", "wx"};
const char *TILE_OPEN[TILE_COUNT]  = {"clock", "spotify", "pet", "rng", "motd", "spells", "spotify", "img", "id", "eyes", "jukebox", "tty", "claude", "weather"};
#define LOG_X 2
#define LOG_Y 199
#define LOG_W 236
#define LOG_H 55

const uint16_t TTY_TEXT = c565(205, 214, 224), TTY_DIM = c565(96, 106, 120), TTY_BG = c565(4, 6, 10);
String   deckCmd;                 // what the prompt is typing
uint32_t deckCmdAt = 0;
int8_t   deckPending = -1;        // the tile it will open once the command is typed
#define DECK_TYPE_MS 18
#define SCOPE_N 74
int8_t   scopeBuf[SCOPE_N];
uint8_t  scopeHead = 0;

int tileAt(int x, int y) {
  for (int i = 0; i < TILE_COUNT; i++) {
    int bottom = i >= 5 ? SCR_H : TILE_Y[i] + TILE_H[i] + 3;     // the status bar reaches the bottom edge
    if (x >= TILE_X[i] - 2 && x < TILE_X[i] + TILE_W[i] + 2 && y >= TILE_Y[i] - 2 && y < bottom) return i;
  }
  return -1;
}

int8_t openedTile = -1;           // the pane or window last opened, so closing shrinks back into it
int tileOfMode(uint8_t m) {
  if (openedTile >= 0 && TILE_MODE[openedTile] == m) return openedTile;
  for (int i = 0; i < TILE_COUNT; i++) if (TILE_MODE[i] == m) return i;
  return -1;
}

// a pane: a thin border with its command set into the top edge
void ttyPane(int x, int y, int w, int h, const char *cmd, bool active) {
  uint16_t edge = active ? ACC : ACC_LOW;
  gfx->drawRect(x, y, w, h, edge);
  int tw = (strlen(cmd) + 4) * 6;
  gfx->fillRect(x + 6, y - 4, tw, 9, TTY_BG);
  textAt("$", x + 9, y - 3, 1, active ? ACC : TTY_DIM);
  textAt(cmd, x + 21, y - 3, 1, active ? COL_WHITE : ACC);
}

// "[=====>----]" style bar, n characters wide
String asciiBar(float f, int n, char fill, char head, char empty) {
  int k = (int)(clamp01(f) * (n - 2) + 0.5f);
  String s = "[";
  for (int i = 0; i < n - 2; i++) s += i < k - 1 ? fill : i == k - 1 ? head : empty;
  return s + "]";
}

String fmtUptime(uint32_t ms) {
  uint32_t s = ms / 1000;
  char b[12];
  if (s >= 86400) snprintf(b, sizeof(b), "%lud%02luh", (unsigned long)(s / 86400), (unsigned long)((s / 3600) % 24));
  else if (s >= 3600) snprintf(b, sizeof(b), "%luh%02lum", (unsigned long)(s / 3600), (unsigned long)((s / 60) % 60));
  else snprintf(b, sizeof(b), "%lum%02lus", (unsigned long)(s / 60), (unsigned long)(s % 60));
  return String(b);
}

void openModule(int m);
void deckRun(int ti) {                         // tap on a pane: type its command, then open it
  if (ti < 0 || deckPending >= 0) return;
  deckCmd = String("open ") + TILE_OPEN[ti];
  deckCmdAt = millis();
  deckPending = ti;
}

// The window chooser, like tmux's `prefix w`: tap the status bar and every screen is listed full size, two columns
// of big targets instead of nine tiny windows. Tap one to open it; tap outside, swipe down or press PWR to go back.
struct ChooseItem { const char *name, *cmd; uint8_t mode; };
const ChooseItem CHOOSE[] = {
  {"spells", "spl", M_CAST}, {"spotify", "spt", M_MUSIC}, {"weather", "wx", M_WEATHER}, {"claude", "cc", M_CLAUDE},
  {"tty", "tty", M_TERM}, {"eyes", "eye", M_EYES}, {"pet", "ps", M_PET}, {"games", "rng", M_TOY},
  {"clock", "date", M_CLOCK}, {"jukebox", "jbx", M_JUKE}, {"photo", "img", M_PHOTO}, {"message", "motd", M_TEXT},
  {"id card", "id", M_CARD}, {"torch", "lux", M_TORCH}};
#define CHOOSE_N (int)(sizeof(CHOOSE) / sizeof(CHOOSE[0]))
#define CH_X0 8
#define CH_Y0 22
#define CH_W 110
#define CH_H 29
#define CH_GAP 4
bool     deckChoose = false;
uint32_t deckChooseAt = 0;
int8_t   chosePick = -1;

int chooseAt(int x, int y) {
  int col = x < CH_X0 + CH_W + CH_GAP / 2 ? 0 : 1, row = (y - CH_Y0) / (CH_H + CH_GAP);
  if (y < CH_Y0 || row < 0 || row >= (CHOOSE_N + 1) / 2) return -1;
  int i = row * 2 + col;
  return i < CHOOSE_N ? i : -1;
}
void deckOpenMode(const char *name, uint8_t m) {   // type `open <name>`, then open it (zooming out of its pane if it has one)
  if (deckPending >= 0) return;
  deckCmd = String("open ") + name;
  deckCmdAt = millis();
  int ti = tileOfMode(m);
  deckPending = ti >= 0 ? ti : 100 + m;
}
void drawChooser() {
  uint32_t now = millis();
  gfx->fillScreen(TTY_BG);
  textAt("$", 16, 3, 1, ACC); textAt("tmux choose-window", 28, 3, 1, COL_WHITE);
  for (int i = 0; i < CHOOSE_N; i++) {
    int x = CH_X0 + (i % 2) * (CH_W + CH_GAP), y = CH_Y0 + (i / 2) * (CH_H + CH_GAP);
    bool pick = i == chosePick, cur = CHOOSE[i].mode == mode;
    // the window opens in from the top, row by row
    if (now - deckChooseAt < (uint32_t)(i / 2) * 22) continue;
    if (pick) gfx->fillRect(x, y, CH_W, CH_H, ACC); else gfx->drawRect(x, y, CH_W, CH_H, ACC_LOW);
    char idx[2] = {(char)(i < 10 ? '0' + i : 'a' + i - 10), 0};       // a top line: the index, and the window's name in the bar
    textAt(idx, x + 4, y + 2, 1, pick ? TTY_BG : ACC);
    textAt(CHOOSE[i].cmd, x + CH_W - 3 - (int)strlen(CHOOSE[i].cmd) * 6, y + 2, 1, pick ? TTY_BG : (cur ? ACC : TTY_DIM));
    textAt(CHOOSE[i].name, x + 8, y + 12, 2, pick ? TTY_BG : COL_WHITE);
  }
  textAt("tap a window", 16, 264, 1, TTY_TEXT);
  textAt("pwr: back", 170, 264, 1, TTY_DIM);
}
void deckChooseTap(int x, int y) {
  int i = chooseAt(x, y);
  if (i < 0) { deckChoose = false; sfx(1); return; }
  chosePick = i;
  drawChooser(); gfx->flush(); delay(90);             // the pick lights up
  deckChoose = false; chosePick = -1;
  deckOpenMode(CHOOSE[i].name, CHOOSE[i].mode);
}

void drawDeck() {
  uint32_t now = millis();
  if (deckPending >= 0 && now - deckCmdAt >= deckCmd.length() * DECK_TYPE_MS + 160) {
    int ti = deckPending;
    deckPending = -1;
    klog("sh: %s", deckCmd.c_str());
    deckCmd = "";
    if (ti >= 100) { openedTile = -1; openModule(ti - 100); }     // a screen without a pane of its own
    else { openedTile = ti; openModule(TILE_MODE[ti]); }
    return;
  }
  if (deckChoose) { drawChooser(); return; }
  gfx->fillScreen(TTY_BG);
  char buf[48];
  struct tm t;
  bool haveTime = localNow(t);
  int activeTile = deckPending;

  // prompt line
  textAt("larp@charm", 16, 3, 1, ACC);                 // kept clear of the screen's rounded corners
  textAt(":~$", 76, 3, 1, TTY_TEXT);
  int typed = deckPending >= 0 ? min((int)deckCmd.length(), (int)((now - deckCmdAt) / DECK_TYPE_MS)) : 0;
  textAt(deckCmd.substring(0, typed), 100, 3, 1, COL_WHITE);
  if ((now / 450) % 2 || deckPending >= 0) gfx->fillRect(100 + typed * 6, 2, 6, 9, ACC);
  uint16_t bc = charging ? COL_LIME : batPct > 30 ? TTY_TEXT : batPct > 15 ? COL_AMBER : COL_RED;
  if (deckPending < 0) {
    snprintf(buf, sizeof(buf), "%s%d%%", charging ? "+" : "", batPct);
    textAt(buf, 224 - (int)strlen(buf) * 6, 3, 1, bc);
  }

  // $ date
  int x = TILE_X[0], y = TILE_Y[0];
  ttyPane(x, y, TILE_W[0], TILE_H[0], TILE_CMD[0], activeTile == 0);
  if (haveTime) {
    int hh = t.tm_hour;
    if (!use24h) { hh %= 12; if (hh == 0) hh = 12; }
    snprintf(buf, sizeof(buf), "%02d%c%02d", hh, (now / 500) % 2 ? ':' : ' ', t.tm_min);
    textAt(buf, x + 6, y + 11, 4, COL_WHITE);
    snprintf(buf, sizeof(buf), ":%02d", t.tm_sec);
    textAt(buf, x + 128, y + 25, 2, ACC);
    snprintf(buf, sizeof(buf), "%s %02d %s %d  utc%+d:%02d", DAYS[t.tm_wday], t.tm_mday, MON[t.tm_mon], t.tm_year + 1900, tzMin / 60, abs(tzMin) % 60);
    String d = buf; d.toLowerCase();
    textAt(d, x + 6, y + 47, 1, TTY_DIM);
  } else {
    textAt("--:--", x + 6, y + 11, 4, TTY_DIM);
    textAt("rtc: no sync", x + 6, y + 47, 1, COL_AMBER);
  }
  int cx = x + 172;
  textAt("up", cx, y + 10, 1, TTY_DIM);  textAt(fmtUptime(now), cx + 24, y + 10, 1, TTY_TEXT);
  snprintf(buf, sizeof(buf), "%.2fv", batVolts);
  textAt("bat", cx, y + 21, 1, TTY_DIM); textAt(buf, cx + 24, y + 21, 1, bc);
  textAt("ble", cx, y + 32, 1, TTY_DIM); textAt(bleConnected ? "up" : "down", cx + 24, y + 32, 1, bleConnected ? ACC : TTY_DIM);
  if (timerEndAt) {
    unsigned long left = (timerEndAt - now) / 1000;
    snprintf(buf, sizeof(buf), "%lu:%02lu", left / 60, left % 60);
    textAt("tmr", cx, y + 43, 1, TTY_DIM); textAt(buf, cx + 24, y + 43, 1, COL_AMBER);
  } else {
    snprintf(buf, sizeof(buf), "%lu", (unsigned long)stepsToday);
    textAt("stp", cx, y + 43, 1, TTY_DIM); textAt(buf, cx + 24, y + 43, 1, TTY_TEXT);
  }

  // $ np
  x = TILE_X[1]; y = TILE_Y[1];
  ttyPane(x, y, TILE_W[1], TILE_H[1], TILE_CMD[1], activeTile == 1);
  if (npTitle.length()) {
    textAt(">", x + 6, y + 9, 1, ACC);
    textAt(marquee(asciiOnly(npTitle), 21, 8), x + 16, y + 9, 1, COL_WHITE);
    textAt(marquee(asciiOnly(npArtist), 21, 11), x + 16, y + 20, 1, ACC);
    uint32_t pos = npPosition();
    textAt(asciiBar(npDurMs ? (float)pos / npDurMs : 0, 22, '=', '>', '-'), x + 6, y + 31, 1, TTY_TEXT);
    snprintf(buf, sizeof(buf), "%lu:%02lu/%lu:%02lu", (unsigned long)(pos / 60000), (unsigned long)((pos / 1000) % 60),
             (unsigned long)(npDurMs / 60000), (unsigned long)((npDurMs / 1000) % 60));
    textAt(buf, x + 6, y + 42, 1, TTY_DIM);
    for (int i = 0; i < 8; i++) {
      float v = npPlaying ? fabsf(sinf(frameNo * 0.3f + i * 0.9f) * sinf(i * 1.7f + frameNo * 0.11f)) : 0.05f;
      int h = 1 + (int)(v * 8);
      gfx->fillRect(x + 92 + i * 6, y + 50 - h, 4, h, ACC);
    }
  } else {
    textAt("> idle", x + 6, y + 9, 1, TTY_TEXT);
    textAt("waiting on /dev/np", x + 6, y + 20, 1, TTY_DIM);
    textAt(asciiBar(0, 22, '=', '>', '-'), x + 6, y + 31, 1, TTY_DIM);
  }

  // $ ps pet
  x = TILE_X[2]; y = TILE_Y[2];
  ttyPane(x, y, TILE_W[2], TILE_H[2], TILE_CMD[2], activeTile == 2);
  const char *const *spr = petSpecies == 1 ? GHOST : petSpecies == 2 ? FROG : CAT;
  bool dizzy = now < petDizzyUntil;
  int bob = (int)(fabsf(sinf(frameNo * (petMood > 40 ? 0.18f : 0.07f))) * 3);
  int lean = imuOK ? constrain((int)(tiltX * 5), -5, 5) : 0;
  if (dizzy) lean += (int)(sinf(frameNo * 0.9f) * 2);
  drawSprite(spr, x + 7 + lean, y + 10 - bob, 2, petColor, (frameNo % 60) < 3 || dizzy);
  String pn = asciiOnly(petName); if (pn.length() > 7) pn = pn.substring(0, 7);
  textAt(pn, x + 38, y + 10, 1, COL_WHITE);
  textAt(dizzy ? "@_@" : petSpecies == 1 ? "ghost" : petSpecies == 2 ? "frog" : "cat", x + 38, y + 21, 1, TTY_DIM);
  snprintf(buf, sizeof(buf), "mood %d%%", petMood);
  textAt(buf, x + 6, y + 33, 1, petMood > 35 ? TTY_TEXT : COL_RED);
  textAt(asciiBar(petMood / 100.0f, 12, '#', '#', '.'), x + 6, y + 43, 1, petMood > 35 ? ACC : COL_RED);

  // $ imu --scope: an oscilloscope of how hard the charm is moving
  x = TILE_X[3]; y = TILE_Y[3];
  ttyPane(x, y, TILE_W[3], TILE_H[3], TILE_CMD[3], activeTile == 3);
  float mag = sqrtf(accX * accX + accY * accY + accZ * accZ);
  float v = imuOK ? (mag - 1.0f) * 40 + tiltX * 6 : 0;
  scopeBuf[scopeHead] = (int8_t)constrain((int)v, -13, 13);
  scopeHead = (scopeHead + 1) % SCOPE_N;
  int sx = x + 6, sy = y + 22;
  for (int i = 0; i < SCOPE_N; i += 4) gfx->drawPixel(sx + i, sy, ACC_LOW);
  for (int k = -12; k <= 12; k += 6) gfx->drawPixel(sx - 2, sy + k, ACC_LOW);
  int prev = sy - scopeBuf[scopeHead];
  for (int i = 1; i < SCOPE_N; i++) {
    int yy = sy - scopeBuf[(scopeHead + i) % SCOPE_N];
    gfx->drawLine(sx + i - 1, prev, sx + i, yy, ACC);
    prev = yy;
  }
  if (imuOK) snprintf(buf, sizeof(buf), "|a| %.2fg", mag); else snprintf(buf, sizeof(buf), "no imu");
  textAt(buf, x + 6, y + 41, 1, imuOK ? TTY_TEXT : COL_AMBER);

  // $ cat motd
  x = TILE_X[4]; y = TILE_Y[4];
  ttyPane(x, y, TILE_W[4], TILE_H[4], TILE_CMD[4], activeTile == 4);
  String m = asciiOnly(textMsg);
  m.replace('\n', ' ');
  textAt(marquee(m, 11, 5), x + 6, y + 12, 2, COL_WHITE);
  snprintf(buf, sizeof(buf), "%u bytes", (unsigned)textMsg.length());
  textAt(buf, x + 6, y + 37, 1, TTY_DIM);
  if ((now / 450) % 2) gfx->fillRect(x + 6 + (strlen(buf) + 1) * 6, y + 36, 6, 9, ACC);

  // $ dmesg -w: the newest line types itself in
  gfx->drawRect(LOG_X, LOG_Y, LOG_W, LOG_H, ACC_LOW);
  gfx->fillRect(LOG_X + 6, LOG_Y - 4, 13 * 6, 9, TTY_BG);
  textAt("$", LOG_X + 9, LOG_Y - 3, 1, TTY_DIM);
  textAt("dmesg -w", LOG_X + 21, LOG_Y - 3, 1, ACC);
  int shown = min((int)klogCount, 4);
  for (int k = 0; k < shown; k++) {
    const KLine &l = klogBuf[(klogHead + KLOG_N - shown + k) % KLOG_N];
    int ly = LOG_Y + 7 + k * 11;
    bool newest = k == shown - 1;
    snprintf(buf, sizeof(buf), "[%6.1f]", l.t / 1000.0f);
    textAt(buf, LOG_X + 5, ly, 1, TTY_DIM);
    String s = l.s;
    if (newest) s = s.substring(0, min((int)s.length(), (int)((now - l.t) / 28)));
    int colon = s.indexOf(':');
    if (colon > 0) {
      textAt(s.substring(0, colon + 1), LOG_X + 5 + 54, ly, 1, ACC);
      textAt(s.substring(colon + 1), LOG_X + 5 + 54 + (colon + 1) * 6, ly, 1, newest ? COL_WHITE : TTY_TEXT);
    } else textAt(s, LOG_X + 5 + 54, ly, 1, newest ? COL_WHITE : TTY_TEXT);
  }

  // tmux status bar: the other screens, as windows (tap anywhere on it for the window chooser)
  gfx->fillRect(0, 258, SCR_W, 22, ACC);
  for (int i = 0; i < TILE_COUNT - 5; i++) {
    int k = 5 + i, wxp = TILE_X[k];
    bool act = activeTile == k;
    if (act) gfx->fillRect(wxp, 258, TILE_W[k], 22, TTY_BG);
    if (i) gfx->drawFastVLine(wxp, 261, 16, act ? ACC : TTY_BG);
    textAt(TILE_CMD[k], wxp + (TILE_W[k] - (int)strlen(TILE_CMD[k]) * 6) / 2 + 1, 265, 1, act ? ACC : TTY_BG);
  }
}
