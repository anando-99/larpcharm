// Larp Charm firmware: The full-screen modules: clock, message, photo, music (spotify), pet, ID card.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Full-screen modules ─────────────
void clockHand(float ang, int len, uint16_t c, int thick) {
  int x1 = 120 + (int)(sinf(ang) * len), y1 = 140 - (int)(cosf(ang) * len);
  for (int o = -(thick / 2); o <= thick / 2; o++) {
    gfx->drawLine(120 + o, 140, x1 + o, y1, c);
    gfx->drawLine(120, 140 + o, x1, y1 + o, c);
  }
}

void drawClock() {
  drawBackground();
  topBar("//CHRONO", false);

  struct tm t;
  if (!localNow(t)) {
    dimRect(8, 74, 224, 102, 1);
    brackets(8, 74, 224, 102, 12, ACC);
    segTime(16, 86, 42, 78, 8, -1, 0, true, ACC, ACC_LOW);
    textPop("NO TIME SYNC", 190, 2, COL_WHITE);
    textPop("open the app once", 214, 1, ACC);
    return;
  }
  int h = t.tm_hour;
  if (!use24h) { h = h % 12; if (h == 0) h = 12; }
  char buf[28];

  if (faceStyle == 1) {                                   // analog
    gfx->drawCircle(120, 140, 98, ACC);
    gfx->drawCircle(120, 140, 97, ACC);
    for (int i = 0; i < 12; i++) {
      float a = i * 0.5235988f;
      int r0 = (i % 3 == 0) ? 82 : 88;
      gfx->drawLine(120 + (int)(sinf(a) * r0), 140 - (int)(cosf(a) * r0), 120 + (int)(sinf(a) * 95), 140 - (int)(cosf(a) * 95), COL_WHITE);
    }
    clockHand((t.tm_hour % 12 + t.tm_min / 60.0f) * 0.5235988f, 50, COL_BLACK, 7);
    clockHand((t.tm_hour % 12 + t.tm_min / 60.0f) * 0.5235988f, 50, COL_WHITE, 5);
    clockHand((t.tm_min + t.tm_sec / 60.0f) * 0.1047198f, 76, COL_BLACK, 5);
    clockHand((t.tm_min + t.tm_sec / 60.0f) * 0.1047198f, 76, ACC, 3);
    clockHand(t.tm_sec * 0.1047198f, 86, COL_WHITE, 1);
    gfx->fillRect(116, 136, 9, 9, ACC);
    snprintf(buf, sizeof(buf), "%s %02d %s", DAYS[t.tm_wday], t.tm_mday, MON[t.tm_mon]);
    textPop(buf, 248, 1, COL_WHITE);
  } else if (faceStyle == 2) {                            // words
    static const char *HN[12] = {"twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"};
    int m5 = ((t.tm_min + 2) / 5) * 5, hh = t.tm_hour;
    bool to = m5 > 30;
    if (to) hh++;
    if (m5 == 60) m5 = 0;
    hh %= 12;
    int k = (to && m5) ? 60 - m5 : m5;
    const char *pre = k == 5 ? "five" : k == 10 ? "ten" : k == 15 ? "quarter" : k == 20 ? "twenty" : k == 25 ? "twenty five" : "half";
    if (k == 0) {
      textPop(HN[hh], 108, 4, COL_WHITE);
      textPop("o'clock", 152, 3, ACC);
    } else {
      textPop(pre, 90, 3, ACC);
      textPop(to ? "to" : "past", 126, 3, COL_WHITE);
      textPop(HN[hh], 162, 4, COL_WHITE);
    }
  } else if (faceStyle == 3) {                            // bouncing time
    static float bx = 40, by = 60, bvx = 1.6f, bvy = 1.2f;
    static uint16_t bc = COL_WHITE;
    snprintf(buf, sizeof(buf), "%02d:%02d", h, t.tm_min);
    bx += bvx; by += bvy;
    int hit = 0;
    if (bx < 0)           { bx = 0;           bvx = fabsf(bvx);  hit++; }
    if (bx > SCR_W - 154) { bx = SCR_W - 154; bvx = -fabsf(bvx); hit++; }
    if (by < 26)          { by = 26;          bvy = fabsf(bvy);  hit++; }
    if (by > SCR_H - 60)  { by = SCR_H - 60;  bvy = -fabsf(bvy); hit++; }
    if (hit) { bc = hue565((uint8_t)random(0, 256)); if (hit >= 2) sfx(2); }
    gfx->setTextWrap(false);
    textAt(buf, (int)bx + 3, (int)by + 3, 5, COL_BLACK);
    textAt(buf, (int)bx, (int)by, 5, bc);
    gfx->setTextWrap(true);
  } else {                                                // seven-segment
    dimRect(8, 74, 224, 102, 1);
    brackets(8, 74, 224, 102, 12, ACC);
    segTime(16, 86, 42, 78, 8, h, t.tm_min, (millis() / 500) % 2, COL_WHITE, mix565(ACC, COL_BLACK, 215));
    if (use24h) snprintf(buf, sizeof(buf), "%s %02d %s", DAYS[t.tm_wday], t.tm_mday, MON[t.tm_mon]);
    else        snprintf(buf, sizeof(buf), "%s %02d %s %s", DAYS[t.tm_wday], t.tm_mday, MON[t.tm_mon], t.tm_hour < 12 ? "AM" : "PM");
    textPop(buf, 188, 2, ACC);
    for (int i = 0; i < 60; i++) gfx->fillRect(20 + i * 200 / 60, 214, 2, 6, i <= t.tm_sec ? COL_WHITE : ACC_DIM);
  }
  if (charging) textPop(String("CHARGING ") + batPct + "%", 236, 1, COL_LIME);
}

void drawText() {
  if (textStyle == 3) {                                   // terminal: types itself out
    gfx->fillScreen(COL_BLACK);
    topBar("//MSG", true);
    int shown = (int)((millis() - typeStart) / 45), count = 0;
    int lineH = 8 * textSize + 4;
    int y = (SCR_H - (int)textLines.size() * lineH) / 2 + 4;
    int cx = 10, cy = y;
    gfx->setTextSize(textSize);
    gfx->setTextColor(textFg);
    for (size_t li = 0; li < textLines.size() && count < shown; li++) {
      const String &ln = textLines[li];
      cx = 10; cy = y;
      for (size_t c = 0; c < ln.length() && count < shown; c++, count++) {
        gfx->setCursor(10 + c * 6 * textSize, y);
        gfx->print(ln[c]);
        cx = 10 + (c + 1) * 6 * textSize;
      }
      count++;
      y += lineH;
    }
    if ((millis() / 300) % 2) rectC(cx, cy, 5 * textSize, 7 * textSize, textFg);
    if (shown > count + 60) typeStart = millis();
    return;
  }
  gfx->fillScreen(textBg);
  if (textStyle == 1) {
    String m = asciiOnly(textMsg); m.replace('\n', ' ');
    int sz = 6, w = m.length() * 6 * sz;
    gfx->setTextWrap(false);
    gfx->setTextSize(sz);
    gfx->setTextColor(textFg);
    gfx->setCursor(marqueeX, SCR_H / 2 - 24);
    gfx->print(m);
    gfx->setTextWrap(true);
    marqueeX -= 5;
    if (marqueeX < -w) marqueeX = SCR_W;
    for (int y = 70; y < 210; y += 6) gfx->drawFastHLine(0, y, SCR_W, mix565(textBg, textFg, 25));
    return;
  }
  int lineH = 8 * textSize + 4;
  int y = (SCR_H - (int)textLines.size() * lineH) / 2 + 4;
  for (size_t li = 0; li < textLines.size(); li++) {
    const String &ln = textLines[li];
    int x = (SCR_W - (int)ln.length() * 6 * textSize) / 2;
    gfx->setTextSize(textSize);
    if (textStyle == 2) {
      for (size_t c = 0; c < ln.length(); c++) {
        gfx->setTextColor(hue565((c * 18 + li * 30 + frameNo * 4) & 0xFF));
        gfx->setCursor(x + c * 6 * textSize, y);
        gfx->print(ln[c]);
      }
    } else {
      gfx->setTextColor(mix565(textBg, COL_BLACK, 160));
      gfx->setCursor(x + 2, y + 2); gfx->print(ln);
      gfx->setTextColor(textFg);
      gfx->setCursor(x, y); gfx->print(ln);
    }
    y += lineH;
  }
}

void drawPhoto() {
  if (photoLoaded && photoBuf) {
    gfx->draw16bitRGBBitmap(0, 0, photoBuf, SCR_W, SCR_H);
    if (millis() < chromeUntil) topBar("//IMG", true);
  } else {
    emptyState("//IMG", "NO IMAGE", "send a photo", "from the app");
  }
}

// Music: a Spotify player in a terminal. The cover sits top left, `ls`-style facts and a `cava` spectrum
// beside it, the song below, block-character bars for time and volume, and three keys along the bottom.
// Tap the keys = previous / play-pause / next. Tap the cover to see it full screen (tap again to come back).
// Tap the volume row: left half quieter, right half louder. Everything is sent to the phone.
#define NP_ART 120
#define NP_AX  9
#define NP_AY  31
#define NP_KEY_Y 242
#define NP_VOL_Y 226
void mediaCmd(uint8_t kind) {
  if (!bleConnected) { toast("no link", 800); return; }
  static const char *M[5] = {"media=toggle", "media=next", "media=prev", "media=volup", "media=voldown"};
  if (kind == 0) { npPosMs = npPosition(); npStamp = millis(); npPlaying = !npPlaying; }
  if (kind >= 3) {
    if (npVol < 0) { toast("no volume", 700); return; }
    npVol = constrain(npVol + (kind == 3 ? 10 : -10), 0, 100);
    char b[12]; snprintf(b, sizeof(b), "vol %d%%", npVol); toast(b, 600);
  }
  mediaFlashKind = kind;
  mediaFlashUntil = millis() + 350;
  notifyText(M[kind % 5]);
}

// From the decoded cover: a 120x120 thumbnail (box-averaged middle square) and a
// full-screen view (the cover scaled to fill 240x280, cropped at the sides).
void artMakeViews(int w, int h) {
  if (!artSrc) return;
  w = min(w, ART_SRC); h = min(h, ART_SRC);
  if (w < 8 || h < 8) return;
  if (artThumb) {
    int side = min(w, h), ox = (w - side) / 2, oy = (h - side) / 2;
    for (int ty = 0; ty < NP_ART; ty++) {
      int y0 = oy + ty * side / NP_ART, y1 = max(y0 + 1, oy + (ty + 1) * side / NP_ART);
      for (int tx = 0; tx < NP_ART; tx++) {
        int x0 = ox + tx * side / NP_ART, x1 = max(x0 + 1, ox + (tx + 1) * side / NP_ART);
        uint32_t r = 0, g = 0, b = 0, n = 0;
        for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
          uint16_t v = artSrc[y * ART_SRC + x];
          r += v >> 11; g += (v >> 5) & 63; b += v & 31; n++;
        }
        artThumb[ty * NP_ART + tx] = ((r / n) << 11) | ((g / n) << 5) | (b / n);
      }
    }
  }
  if (artBuf) {
    // source pixels per screen pixel, in 1/1024ths: the smaller of w/240 and h/280 so the cover fills
    int k = min(w * 1024 / SCR_W, h * 1024 / SCR_H);
    int ox = (w * 1024 - SCR_W * k) / 2048, oy = (h * 1024 - SCR_H * k) / 2048;
    for (int y = 0; y < SCR_H; y++) {
      int sy = min(h - 1, oy + (y * k + k / 2) / 1024);
      for (int x = 0; x < SCR_W; x++) artBuf[y * SCR_W + x] = artSrc[sy * ART_SRC + min(w - 1, ox + (x * k + k / 2) / 1024)];
    }
  }
}

static void fmtMs(char *b, size_t n, uint32_t ms) {
  snprintf(b, n, "%lu:%02lu", (unsigned long)(ms / 60000), (unsigned long)((ms / 1000) % 60));
}

// a row of character cells, like a progress bar drawn with block glyphs
static void cellBar(int x, int y, int cells, float f, uint16_t on, uint16_t off, uint16_t head) {
  int k = (int)(clamp01(f) * cells + 0.5f);
  for (int i = 0; i < cells; i++) gfx->fillRect(x + i * 6, y, 5, 7, i < k - 1 ? on : i == k - 1 ? head : off);
}

// the three keys along the bottom; the one just pressed shows in inverse video
static void npKey(int x, int w, uint8_t kind, bool lit) {
  bool flash = millis() < mediaFlashUntil && mediaFlashKind == kind;
  bool inv = lit || flash;
  uint16_t fg = inv ? TTY_BG : ACC;
  if (inv) gfx->fillRect(x, NP_KEY_Y, w, 26, flash && !lit ? COL_WHITE : ACC);
  else gfx->drawRect(x, NP_KEY_Y, w, 26, ACC);
  int cy = NP_KEY_Y + 13;
  if (kind == 0) {
    int ix = x + 10;
    if (npPlaying) { gfx->fillRect(ix, cy - 6, 4, 13, fg); gfx->fillRect(ix + 7, cy - 6, 4, 13, fg); }
    else gfx->fillTriangle(ix, cy - 7, ix, cy + 7, ix + 11, cy, fg);
    textAt(npPlaying ? "PLAYING" : "PAUSED", ix + 18, cy - 7, 2, fg);
  } else {
    int cx = x + w / 2, d = kind == 1 ? 1 : -1;
    gfx->fillTriangle(cx - 9 * d, cy - 6, cx - 9 * d, cy + 6, cx - 1 * d, cy, fg);
    gfx->fillTriangle(cx - 1 * d, cy - 6, cx - 1 * d, cy + 6, cx + 7 * d, cy, fg);
    gfx->fillRect(d > 0 ? cx + 7 : cx - 9, cy - 6, 2, 13, fg);
  }
}

// The cover full screen with the song, its length and a little equaliser along the bottom (the 8.6 look).
void drawMusicBig() {
  if (artLoaded && artBuf && FB) memcpy(FB, artBuf, FB_BYTES);
  else {
    gfx->fillScreen(COL_VOID);
    float beat = npPlaying ? (sinf(frameNo * 0.35f) * 0.5f + 0.5f) : 0.2f;
    for (int i = 0; i < 6; i++) gfx->drawCircle(120, 108, 20 + i * 14 + (int)(beat * 6), mix565(ACC, COL_BLACK, 50 + i * 32));
    float a = frameNo * (npPlaying ? 0.08f : 0.0f);
    gfx->drawLine(120, 108, 120 + (int)(cosf(a) * 96), 108 + (int)(sinf(a) * 96), ACC);
    gfx->fillRect(116, 104, 9, 9, ACC);
  }
  shadeRows(140, SCR_H, 256, 22);
  topBar(npPlaying ? "//AUDIO" : "//PAUSED", true);

  String title  = asciiOnly(npTitle.length() ? npTitle : String("NO SIGNAL"));
  String artist = asciiOnly(npArtist.length() || npTitle.length() ? npArtist : String("play something on your phone"));
  int tw = title.length() * 12;
  gfx->setTextWrap(false);
  gfx->setTextSize(2);
  gfx->setTextColor(COL_WHITE);
  if (tw <= 212) { gfx->setCursor(14, 190); gfx->print(title); npTitleX = 0; }
  else {
    gfx->setCursor(14 - npTitleX, 190); gfx->print(title);
    gfx->setCursor(14 - npTitleX + tw + 60, 190); gfx->print(title);
    npTitleX = (npTitleX + 2) % (tw + 60);
  }
  gfx->setTextWrap(true);
  if (artist.length() > 35) artist = artist.substring(0, 34) + ".";
  textAt(artist, 14, 212, 1, ACC);

  uint32_t pos = npPosition();
  char buf[16];
  gfx->fillRect(14, 228, 212, 2, c565(70, 70, 80));
  if (npDurMs) {
    int w = max(2, (int)(212.0f * pos / npDurMs));
    gfx->fillRect(14, 227, w, 4, ACC);
    gfx->fillRect(12 + w, 224, 3, 10, COL_WHITE);
    fmtMs(buf, sizeof(buf), npDurMs);
    textAt(buf, 226 - (int)strlen(buf) * 6, 240, 1, COL_WHITE);
  }
  fmtMs(buf, sizeof(buf), pos);
  textAt(buf, 14, 240, 1, COL_WHITE);
  for (int i = 0; i < 20; i++) {
    float v = npPlaying ? fabsf(sinf(frameNo * 0.3f + i * 0.9f) * sinf(i * 1.7f + frameNo * 0.11f)) : 0.05f;
    int h = 2 + (int)(v * 16);
    gfx->fillRect(60 + i * 6, 258 - h, 4, h, mix565(ACC, COL_WHITE, i * 6));
  }

  if (millis() < mediaFlashUntil && mediaFlashKind < 3) {       // swipes skip here too
    const int cx = 120, cy = 104;
    dimRect(84, 68, 72, 72, 2);
    brackets(84, 68, 72, 72, 10, ACC);
    int d = mediaFlashKind == 1 ? 1 : -1;
    if (mediaFlashKind == 0) {
      if (npPlaying) gfx->fillTriangle(cx - 12, cy - 18, cx - 12, cy + 18, cx + 18, cy, COL_WHITE);
      else { gfx->fillRect(cx - 14, cy - 18, 10, 36, COL_WHITE); gfx->fillRect(cx + 4, cy - 18, 10, 36, COL_WHITE); }
    } else {
      gfx->fillTriangle(cx - 16 * d, cy - 16, cx - 16 * d, cy + 16, cx + 2 * d, cy, COL_WHITE);
      gfx->fillTriangle(cx - 2 * d, cy - 16, cx - 2 * d, cy + 16, cx + 16 * d, cy, COL_WHITE);
    }
  }
}

void drawMusic() {
  if (npBig) { drawMusicBig(); return; }
  gfx->fillScreen(TTY_BG);
  char buf[24];
  bool have = npTitle.length() > 0;

  // ◆ SPOTIFY ......................... signal
  textAt("\x04", 12, 5, 2, ACC);
  textAt("SPOTIFY", 28, 5, 2, ACC);
  uint32_t age = millis() - npStamp;
  int lit = !bleConnected ? 0 : !have ? 1 : age < 12000 ? 5 : age < 40000 ? 3 : 2;
  for (int i = 0; i < 5; i++) gfx->fillRect(194 + i * 6, 19 - (3 + i * 3), 4, 3 + i * 3, i < lit ? ACC : ACC_LOW);
  for (int x = 8; x < 232; x += 3) gfx->drawPixel(x, 24, ACC_DIM);

  // the cover
  gfx->drawRect(NP_AX - 1, NP_AY - 1, NP_ART + 2, NP_ART + 2, ACC);
  if (artLoaded && artThumb) gfx->draw16bitRGBBitmap(NP_AX, NP_AY, artThumb, NP_ART, NP_ART);
  else {
    int cx = NP_AX + NP_ART / 2, cy = NP_AY + NP_ART / 2;
    for (int i = 0; i < 5; i++) gfx->drawCircle(cx, cy, 14 + i * 10, i == 4 ? ACC_DIM : ACC_LOW);
    float a = frameNo * (npPlaying ? 0.08f : 0.0f);
    gfx->drawLine(cx, cy, cx + (int)(cosf(a) * 54), cy + (int)(sinf(a) * 54), ACC);
    gfx->fillCircle(cx, cy, 5, ACC);
    textAt(have ? "no art" : "no tty", cx - 18, NP_AY + NP_ART - 12, 1, TTY_DIM);
  }

  // facts, `ls -l` style
  const int fx = 140;
  const char *rep = npRepeat == 2 ? "one" : npRepeat == 1 ? "all" : "off";
  String dev = asciiOnly(npDevice); dev.toLowerCase();
  if (!dev.length()) dev = have ? "phone" : "--";
  if (dev.length() > 11) dev = dev.substring(0, 10) + "~";
  textAt("dev", fx, 32, 1, TTY_DIM); textAt(dev, fx + 24, 32, 1, TTY_TEXT);
  textAt("shf", fx, 44, 1, TTY_DIM); textAt(npVol < 0 ? "--" : npShuffle ? "on" : "off", fx + 24, 44, 1, npShuffle ? ACC : TTY_TEXT);
  textAt("rpt", fx, 56, 1, TTY_DIM); textAt(npVol < 0 ? "--" : rep, fx + 24, 56, 1, npRepeat ? ACC : TTY_TEXT);
  textAt("st", fx, 68, 1, TTY_DIM);
  textAt(!have ? "idle" : npPlaying ? "play" : "pause", fx + 24, 68, 1, npPlaying ? ACC : TTY_TEXT);

  // $ cava: a little spectrum
  ttyPane(fx - 2, 86, 94, 66, "cava", npPlaying);
  for (int i = 0; i < 12; i++) {
    float v = npPlaying ? fabsf(sinf(frameNo * 0.3f + i * 0.9f) * sinf(i * 1.7f + frameNo * 0.11f)) : 0.03f;
    int h = 1 + (int)(v * 46);
    for (int y = 0; y < h; y += 3) gfx->fillRect(fx + 3 + i * 7, 146 - y - 2, 5, 2, mix565(ACC, COL_WHITE, min(255, y * 4)));
  }

  // the song
  String title  = asciiOnly(have ? npTitle : String("NO SIGNAL"));
  String artist = asciiOnly(have ? npArtist : String("play on spotify"));
  textAt(marquee(title, 18, 6), 12, 160, 2, COL_WHITE);
  if (artist.length() > 18) artist = artist.substring(0, 16) + "..";
  textAt(artist, 12, 180, 2, ACC);

  // time
  uint32_t pos = npPosition();
  float f = npDurMs ? (float)pos / npDurMs : 0;
  cellBar(12, 202, 36, f, ACC, ACC_LOW, COL_WHITE);
  fmtMs(buf, sizeof(buf), pos);  textAt(buf, 12, 213, 1, COL_WHITE);
  if (npDurMs) {
    fmtMs(buf, sizeof(buf), npDurMs); textAt(buf, 228 - (int)strlen(buf) * 6, 213, 1, TTY_TEXT);
    snprintf(buf, sizeof(buf), "-%lu:%02lu", (unsigned long)((npDurMs - pos) / 60000), (unsigned long)(((npDurMs - pos) / 1000) % 60));
    textAt(buf, 120 - (int)strlen(buf) * 3, 213, 1, TTY_DIM);
  }

  // volume: a little speaker, then cells
  bool vflash = millis() < mediaFlashUntil && mediaFlashKind >= 3;
  uint16_t vc = vflash ? COL_WHITE : ACC;
  gfx->fillRect(12, NP_VOL_Y + 2, 3, 4, vc);
  gfx->fillTriangle(14, NP_VOL_Y + 4, 19, NP_VOL_Y - 1, 19, NP_VOL_Y + 8, vc);
  if (npVol >= 0) {
    cellBar(26, NP_VOL_Y, 28, npVol / 100.0f, vc, ACC_LOW, COL_WHITE);
    snprintf(buf, sizeof(buf), "%d%%", npVol);
  } else { cellBar(26, NP_VOL_Y, 28, 0, ACC, ACC_LOW, ACC_LOW); strcpy(buf, "--"); }
  textAt(buf, 228 - (int)strlen(buf) * 6, NP_VOL_Y, 1, TTY_TEXT);

  // keys
  npKey(12, 40, 2, false);
  npKey(58, 124, 0, npPlaying);
  npKey(188, 40, 1, false);
}

void drawPet() {
  verticalGradient(COL_VOID, mix565(petColor, COL_BLACK, 205));
  floorGrid(204, ACC_LOW);
  topBar("//DAEMON", true);
  textCentered(asciiOnly(petName), 34, 3, COL_WHITE);

  const char *const *spr = petSpecies == 1 ? GHOST : petSpecies == 2 ? FROG : CAT;
  int bounce = (int)(fabsf(sinf(frameNo * (petMood > 40 ? 0.18f : 0.07f))) * (petMood > 40 ? 14 : 4));
  bool blink = (frameNo % 60) < 3;
  bool dizzy = millis() < petDizzyUntil;
  int slide = imuOK ? constrain((int)(tiltX * 28), -24, 24) : 0;      // leans the way you tilt it
  if (dizzy) slide += (int)(sinf(frameNo * 0.9f) * 6);
  gfx->fillEllipse(120 + slide, 200, 46 - bounce, 6, ACC_LOW);
  drawSprite(spr, 60 + slide, 74 - bounce, 10, petColor, blink || dizzy);
  if (dizzy) {
    for (int i = 0; i < 3; i++) {
      float a = frameNo * 0.35f + i * 2.094f;
      sparkle(120 + slide + (int)(cosf(a) * 44), 66 - bounce + (int)(sinf(a) * 9), 4, COL_AMBER);
    }
  }
  if (millis() < petHeartsUntil) {
    for (int i = 0; i < 4; i++) {
      int hx = 40 + i * 52, hy = 80 - (int)((millis() / 20 + i * 17) % 50);
      gfx->fillCircle(hx - 3, hy, 4, COL_PINK); gfx->fillCircle(hx + 3, hy, 4, COL_PINK);
      gfx->fillTriangle(hx - 7, hy + 1, hx + 7, hy + 1, hx, hy + 9, COL_PINK);
    }
  }
  uint16_t mc = petMood > 50 ? ACC : petMood > 20 ? COL_AMBER : COL_RED;
  for (int i = 0; i < 10; i++) gfx->fillRect(51 + i * 14, 226, 11, 8, i < (petMood + 5) / 10 ? mc : ACC_LOW);
  textCentered(dizzy ? "STATE: DIZZY" : petMood > 70 ? "STATE: HAPPY" : petMood > 35 ? "STATE: IDLE" : "STATE: HUNGRY", 242, 1, COL_WHITE);
}

void drawCard() {
  const uint16_t a = cardAccent;
  gfx->fillScreen(COL_VOID);
  topBar("//ID", true);
  hudPanel(12, 32, 216, 112, a, 0);
  gfx->fillRect(12, 38, 4, 100, a);
  textAt("OPERATOR", 26, 42, 1, mix565(a, COL_BLACK, 90));
  String name = asciiOnly(cardName), sub = asciiOnly(cardSub);
  textAt(name, 26, 58, name.length() <= 10 ? 3 : name.length() <= 16 ? 2 : 1, COL_WHITE);
  textAt(sub, 26, 90, sub.length() <= 16 ? 2 : 1, a);
  uint32_t hsh = 2166136261u;                                   // barcode drawn from the name
  for (size_t i = 0; i < name.length(); i++) hsh = (hsh ^ (uint8_t)name[i]) * 16777619u;
  for (int x = 26, i = 0; x < 214; i++) {
    hsh = hsh * 1664525u + 1013904223u;
    int w = 1 + ((hsh >> 28) & 3);
    if (!(i & 1)) rectC(x, 116, min(w, 214 - x), 18, a);
    x += w;
  }
  int phase = (frameNo / 4) % 4;
  for (int i = 0; i < 3; i++) {
    uint16_t c = (i < phase) ? a : mix565(a, COL_BLACK, 190);
    gfx->drawCircle(120, 198, 14 + i * 11, c);
    gfx->drawCircle(120, 198, 15 + i * 11, c);
  }
  gfx->fillRect(115, 193, 11, 11, COL_WHITE);
  textCentered(">> TAP PHONE HERE <<", 244, 1, COL_WHITE);
}
