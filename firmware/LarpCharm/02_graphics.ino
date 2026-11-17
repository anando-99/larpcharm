// Larp Charm firmware: Text layout, drawing primitives, anti-aliased shapes, animated backgrounds, shared screen bits.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Text layout ─────────────
void layoutText() {
  String msg = asciiOnly(textMsg);
  for (int s = 6; s >= 1; --s) {
    textLines.clear();
    int maxChars = 220 / (6 * s);
    String line;
    int i = 0, n = msg.length();
    while (i <= n) {
      int j = i;
      while (j < n && msg[j] != ' ' && msg[j] != '\n') j++;
      String word = msg.substring(i, j);
      while ((int)word.length() > maxChars) {
        if (line.length()) { textLines.push_back(line); line = ""; }
        textLines.push_back(word.substring(0, maxChars));
        word = word.substring(maxChars);
      }
      if (line.length() == 0) line = word;
      else if ((int)(line.length() + 1 + word.length()) <= maxChars) line += " " + word;
      else { textLines.push_back(line); line = word; }
      if (j < n && msg[j] == '\n') { textLines.push_back(line); line = ""; }
      i = j + 1;
    }
    if (line.length()) textLines.push_back(line);
    int h = textLines.size() * (8 * s + 4);
    if (h <= 200 || s == 1) { textSize = s; break; }
  }
  marqueeX = SCR_W;
}

// ───────────── Drawing primitives ─────────────
void notifyText(const char *s);

void textAt(const String &s, int x, int y, uint8_t size, uint16_t color) {
  gfx->setTextSize(size); gfx->setTextColor(color); gfx->setCursor(x, y); gfx->print(s);
}

void textCentered(const String &s, int y, uint8_t size, uint16_t color) {
  textAt(s, (SCR_W - (int)s.length() * 6 * size) / 2, y, size, color);
}

// centred text with a hard shadow so it reads on any background
void textPop(const String &s, int y, uint8_t size, uint16_t color) {
  int w = s.length() * 6 * size, x = (SCR_W - w) / 2, o = max(1, size / 2);
  textAt(s, x + o, y + o, size, COL_BLACK);
  textAt(s, x, y, size, color);
}

void verticalGradient(uint16_t top, uint16_t bottom) {
  for (int y = 0; y < SCR_H; y++) gfx->drawFastHLine(0, y, SCR_W, mix565(top, bottom, y * 255 / SCR_H));
}

// fillRect that is safe when partly off screen
void rectC(int x, int y, int w, int h, uint16_t c) {
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > SCR_W) w = SCR_W - x;
  if (y + h > SCR_H) h = SCR_H - y;
  if (w > 0 && h > 0) gfx->fillRect(x, y, w, h, c);
}

// Darkens part of the frame in place. level 1 = half, 2 = quarter, 3 = three quarters.
void dimRect(int x, int y, int w, int h, uint8_t level) {
  if (!FB) return;
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > SCR_W) w = SCR_W - x;
  if (y + h > SCR_H) h = SCR_H - y;
  if (w <= 0 || h <= 0) return;
  for (int j = 0; j < h; j++) {
    uint16_t *p = FB + (y + j) * SCR_W + x;
    if (level == 1)      for (int i = 0; i < w; i++) p[i] = (p[i] >> 1) & 0x7BEF;
    else if (level == 2) for (int i = 0; i < w; i++) p[i] = (p[i] >> 2) & 0x39E7;
    else                 for (int i = 0; i < w; i++) p[i] -= (p[i] >> 2) & 0x39E7;
  }
}

// Fades rows y0..y1-1 from brightness k0 to k1 (0..256). Used as a scrim over album art.
void shadeRows(int y0, int y1, int k0, int k1) {
  if (!FB) return;
  y0 = max(0, y0); y1 = min((int)SCR_H, y1);
  for (int y = y0; y < y1; y++) {
    int k = k0 + (k1 - k0) * (y - y0) / max(1, y1 - y0 - 1);
    uint16_t *p = FB + y * SCR_W;
    for (int x = 0; x < SCR_W; x++) {
      uint16_t v = p[x];
      p[x] = ((((v >> 11) & 31) * k >> 8) << 11) | ((((v >> 5) & 63) * k >> 8) << 5) | ((v & 31) * k >> 8);
    }
  }
}

// The accent colour follows the theme, and takes the album's colour while music plays.
void accentTarget(uint8_t &r, uint8_t &g, uint8_t &b) {
  uint16_t t = THEMES[theme % THEME_COUNT];
  r = r8(t); g = g8(t); b = b8(t);
  if (npPlaying && npTitle.length() && millis() > themePreviewUntil) {
    int nr = r8(npColor), ng = g8(npColor), nb = b8(npColor), mx = max(nr, max(ng, nb));
    if (mx >= 40) { r = nr * 255 / mx; g = ng * 255 / mx; b = nb * 255 / mx; }
  }
}
void setAccent() {
  ACC = c565((uint8_t)accR, (uint8_t)accG, (uint8_t)accB);
  ACC_DIM = mix565(ACC, COL_BLACK, 140);
  ACC_LOW = mix565(ACC, COL_BLACK, 208);
}
void snapAccent() {
  uint8_t r, g, b; accentTarget(r, g, b);
  accR = r; accG = g; accB = b;
  setAccent();
}
void updateAccent() {
  uint8_t r, g, b; accentTarget(r, g, b);
  accR += (r - accR) * 0.14f; accG += (g - accG) * 0.14f; accB += (b - accB) * 0.14f;
  setAccent();
}

void drawBolt(int cx, int cy, uint16_t c) {
  gfx->fillTriangle(cx + 2, cy - 7, cx - 4, cy + 1, cx + 1, cy + 1, c);
  gfx->fillTriangle(cx - 1, cy - 1, cx + 4, cy - 1, cx - 2, cy + 7, c);
}

// angular panel outline: top-left and bottom-right corners are cut off
void hudPanel(int x, int y, int w, int h, uint16_t c, uint8_t dim) {
  if (dim) dimRect(x, y, w, h, dim);
  const int k = 6;
  gfx->drawFastHLine(x + k, y, w - k, c);
  gfx->drawFastVLine(x, y + k, h - k, c);
  gfx->drawLine(x, y + k, x + k, y, c);
  gfx->drawFastHLine(x, y + h - 1, w - k, c);
  gfx->drawFastVLine(x + w - 1, y, h - k, c);
  gfx->drawLine(x + w - 1 - k, y + h - 1, x + w - 1, y + h - 1 - k, c);
}

void brackets(int x, int y, int w, int h, int k, uint16_t c) {
  gfx->drawFastHLine(x, y, k, c);                 gfx->drawFastVLine(x, y, k, c);
  gfx->drawFastHLine(x + w - k, y, k, c);         gfx->drawFastVLine(x + w - 1, y, k, c);
  gfx->drawFastHLine(x, y + h - 1, k, c);         gfx->drawFastVLine(x, y + h - k, k, c);
  gfx->drawFastHLine(x + w - k, y + h - 1, k, c); gfx->drawFastVLine(x + w - 1, y + h - k, k, c);
}

void tagLabel(const char *s, int x, int y) {
  gfx->fillRect(x, y, (int)strlen(s) * 6 + 5, 9, ACC);
  textAt(s, x + 3, y + 1, 1, COL_BLACK);
}

// Seven-segment digits with faint "off" segments, like an old LCD. d < 0 draws a dash.
const uint8_t SEG7[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
void segDigit(int x, int y, int w, int h, int t, int d, uint16_t on, uint16_t off) {
  uint8_t m = (d >= 0 && d <= 9) ? SEG7[d] : 0x40;
  int vl = (h - 3 * t) / 2 - 2, hl = w - 2 * t - 2;
  int yg = y + t + vl + 2, yd = yg + t + vl + 2;
  gfx->fillRect(x + t + 1, y, hl, t, (m & 0x01) ? on : off);
  gfx->fillRect(x + w - t, y + t + 1, t, vl, (m & 0x02) ? on : off);
  gfx->fillRect(x + w - t, yg + t + 1, t, vl, (m & 0x04) ? on : off);
  gfx->fillRect(x + t + 1, yd, hl, t, (m & 0x08) ? on : off);
  gfx->fillRect(x, yg + t + 1, t, vl, (m & 0x10) ? on : off);
  gfx->fillRect(x, y + t + 1, t, vl, (m & 0x20) ? on : off);
  gfx->fillRect(x + t + 1, yg, hl, t, (m & 0x40) ? on : off);
}

// HH:MM in seven-segment digits. Total width is 4*w + 5*t. hh < 0 draws dashes.
void segTime(int x, int y, int w, int h, int t, int hh, int mm, bool colon, uint16_t on, uint16_t off) {
  segDigit(x, y, w, h, t, hh < 0 ? -1 : hh / 10, on, off);
  segDigit(x + w + t, y, w, h, t, hh < 0 ? -1 : hh % 10, on, off);
  int cx = x + 2 * w + 2 * t;
  gfx->fillRect(cx, y + h / 3 - t / 2, t, t, colon ? on : off);
  gfx->fillRect(cx, y + 2 * h / 3 - t / 2, t, t, colon ? on : off);
  segDigit(cx + 2 * t, y, w, h, t, hh < 0 ? -1 : mm / 10, on, off);
  segDigit(cx + 3 * t + w, y, w, h, t, hh < 0 ? -1 : mm % 10, on, off);
}

// The battery level as a number, nothing else. A bolt sits in front of it while charging.
void drawBatteryCells(int x, int y) {
  (void)x;
  char b[6];
  snprintf(b, sizeof(b), "%d%%", batPct);
  uint16_t col = charging ? COL_LIME : batPct > 30 ? ACC : batPct > 15 ? COL_AMBER : COL_RED;
  int w = strlen(b) * 6, rx = 214;
  textAt(b, rx - w, y + 1, 1, col);
  if (charging) drawBolt(rx - w - 7, y + 4, COL_AMBER);
}

// The status line every screen shares: name, time or timer, link bars, battery.
void topBar(const char *label, bool showTime) {
  dimRect(0, 0, SCR_W, 23, 1);
  textAt(label, 34, 9, 1, ACC);
  char buf[16];
  if (timerEndAt) {
    unsigned long left = (timerEndAt - millis()) / 1000;
    if (left >= 6000) snprintf(buf, sizeof(buf), "T-%luh%02lu", left / 3600, (left / 60) % 60);
    else              snprintf(buf, sizeof(buf), "T-%02lu:%02lu", left / 60, left % 60);
    textAt(buf, 96, 9, 1, COL_AMBER);
  } else if (showTime) {
    struct tm t;
    if (localNow(t)) { snprintf(buf, sizeof(buf), "%02d:%02d", t.tm_hour, t.tm_min); textAt(buf, 105, 9, 1, COL_WHITE); }
  } else if (mode == M_DECK && timeValid) {
    if (stepsToday < 10000) snprintf(buf, sizeof(buf), "%lu STP", (unsigned long)stepsToday);
    else snprintf(buf, sizeof(buf), "%.1fK STP", stepsToday / 1000.0f);
    textAt(buf, 88, 9, 1, COL_WHITE);
  }
  for (int i = 0; i < 3; i++) gfx->fillRect(148 + i * 4, 15 - i * 2, 3, 2 + i * 2, bleConnected ? ACC : COL_GREY);
  drawBatteryCells(176, 8);
}

void drawToast() {
  if (millis() > toastUntil) return;
  String m = toastMsg; m.toUpperCase();
  int w = m.length() * 12 + 20, x = (SCR_W - w) / 2;
  gfx->fillRect(x, 230, w, 26, COL_BLACK);
  hudPanel(x, 230, w, 26, ACC, 0);
  textCentered(m, 236, 2, ACC);
}

void drawTransferOverlay() {
  if (!xferActive || xferSize == 0 || xferKind == 3) return;      // album art arrives quietly
  int pct = (int)(100ULL * xferGot / xferSize);
  gfx->fillRect(30, 112, 180, 56, COL_BLACK);
  hudPanel(30, 112, 180, 56, ACC, 0);
  textCentered(String(xferKind == 6 ? "FIRMWARE " : "UPLINK ") + pct + "%", 122, 2, COL_WHITE);
  for (int i = 0; i < 16; i++) gfx->fillRect(41 + i * 10, 148, 8, 8, i * 100 < pct * 16 ? ACC : ACC_LOW);
}

// what a screen shows when it has nothing to show yet
void emptyState(const char *label, const char *big, const char *l1, const char *l2) {
  gfx->fillScreen(COL_VOID);
  for (int y = 40; y < 250; y += 20) for (int x = 20; x < SCR_W; x += 20) gfx->drawPixel(x, y, ACC_DIM);
  topBar(label, true);
  brackets(34, 84, 172, 100, 14, ACC);
  textCentered(big, 106, 2, ACC);
  textCentered(l1, 138, 1, COL_WHITE);
  textCentered(l2, 152, 1, COL_WHITE);
}

String marquee(const String &s, int chars, int speedDiv) {
  if ((int)s.length() <= chars) return s;
  String loop = s + "   ";
  int off = (frameNo / speedDiv) % loop.length();
  String d = loop + loop;
  return d.substring(off, off + chars);
}

void sparkle(int x, int y, int r, uint16_t c) {
  gfx->drawFastHLine(x - r, y, 2 * r + 1, c);
  gfx->drawFastVLine(x, y - r, 2 * r + 1, c);
  gfx->drawPixel(x - 1, y - 1, c); gfx->drawPixel(x + 1, y + 1, c);
  gfx->drawPixel(x + 1, y - 1, c); gfx->drawPixel(x - 1, y + 1, c);
}

void drawSparkles(uint16_t c) {
  static const uint8_t pts[][2] = {{24,52},{210,70},{40,230},{200,214},{120,40},{18,150},{224,150},{90,250}};
  for (int i = 0; i < 8; i++) {
    int phase = (frameNo + i * 9) % 40;
    int r = phase < 20 ? phase / 5 : (40 - phase) / 5;
    if (r > 0) sparkle(pts[i][0], pts[i][1], r, c);
  }
}

// ═════════════ v5: anti-aliased drawing (the eyes, the jukebox disc) ═════════════
static inline uint16_t blend565(uint16_t bg, uint16_t fg, uint8_t a) {
  if (a >= 252) return fg;
  if (a < 8) return bg;
  uint32_t b = (bg | ((uint32_t)bg << 16)) & 0x07E0F81F;
  uint32_t f = (fg | ((uint32_t)fg << 16)) & 0x07E0F81F;
  uint32_t r = ((((f - b) * (a >> 3)) >> 5) + b) & 0x07E0F81F;
  return (uint16_t)(r | (r >> 16));
}
static inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
static inline uint16_t rgbf(float r, float g, float b) {
  return c565((uint8_t)constrain((int)r, 0, 255), (uint8_t)constrain((int)g, 0, 255), (uint8_t)constrain((int)b, 0, 255));
}
      // "screen": lighten toward white

// signed distance to a rounded rectangle centred at the origin
static inline float sdRound(float px, float py, float hw, float hh, float r) {
  float qx = fabsf(px) - (hw - r), qy = fabsf(py) - (hh - r);
  float ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
  return sqrtf(ox * ox + oy * oy) + fminf(fmaxf(qx, qy), 0.0f) - r;
}

// ───────────── Animated backgrounds ─────────────
static int8_t sinLut[256];
struct Star  { float x, y, z; };
struct Flake { float x, y, vx, vy; uint8_t r; };
struct Blob  { float x, y, vx, vy, r; };
struct NetNode { float x, y, vx, vy; };
#define NODE_N 16
NetNode nodes[NODE_N];
Star  stars[70];
Flake flakes[70];
Blob  blobs[5];
float matrixY[40];
uint8_t matrixSpd[40];

void initFx() {
  for (int i = 0; i < 256; i++) sinLut[i] = (int8_t)(sinf(i * 6.2831853f / 256.0f) * 127.0f);
  for (int i = 0; i < 70; i++) {
    stars[i].x = (int)random(-1000, 1000) / 1000.0f;
    stars[i].y = (int)random(-1000, 1000) / 1000.0f;
    stars[i].z = (int)random(100, 1000) / 1000.0f;
    flakes[i].x = random(0, SCR_W - 4); flakes[i].y = random(0, SCR_H - 4);
    flakes[i].vx = 0; flakes[i].vy = 0; flakes[i].r = 1 + random(0, 3);
  }
  for (int i = 0; i < 5; i++) {
    blobs[i].x = random(12, 48); blobs[i].y = random(12, 58);
    blobs[i].vx = (int)random(-20, 21) / 100.0f; blobs[i].vy = (int)random(-20, 21) / 100.0f;
    blobs[i].r = 7 + i * 1.5f;
  }
  for (int i = 0; i < 40; i++) { matrixY[i] = -(float)random(0, 35); matrixSpd[i] = random(2, 7); }
  for (int i = 0; i < NODE_N; i++) {
    nodes[i].x = random(10, 230); nodes[i].y = random(10, 270);
    nodes[i].vx = (int)random(-40, 41) / 100.0f; nodes[i].vy = (int)random(-40, 41) / 100.0f;
  }
}

void bgWarp() {
  gfx->fillScreen(c565(4, 2, 18));
  float cx = 120 + tiltX * 40;
  for (int i = 0; i < 70; i++) {
    Star &s = stars[i];
    s.z -= 0.012f;
    if (s.z <= 0.05f) { s.x = (int)random(-1000, 1000) / 1000.0f; s.y = (int)random(-1000, 1000) / 1000.0f; s.z = 1.0f; }
    int px = (int)(cx + s.x / s.z * 120), py = (int)(140 + s.y / s.z * 140);
    if (px < 0 || px >= SCR_W - 2 || py < 0 || py >= SCR_H - 2) { s.z = 0; continue; }
    int b = (int)(255 * (1.0f - s.z));
    int sz = s.z < 0.3f ? 2 : 1;
    gfx->fillRect(px, py, sz, sz, c565(b, b, min(255, b + 60)));
  }
}

void bgVapor() {
  const int hz = 170;
  for (int y = 0; y < hz; y++) gfx->drawFastHLine(0, y, SCR_W, mix565(c565(20, 6, 60), c565(255, 90, 170), y * 255 / hz));
  for (int dy = -52; dy <= 52; dy++) {                       // striped sun
    int yy = 118 + dy;
    if (yy >= hz) break;
    if (dy > 4 && ((dy + (int)(frameNo / 3)) % 10) < 3) continue;
    int w = (int)sqrtf((float)(52 * 52 - dy * dy));
    if (w > 0) gfx->drawFastHLine(120 - w, yy, 2 * w, mix565(c565(255, 230, 90), c565(255, 80, 140), (dy + 52) * 255 / 104));
  }
  gfx->fillRect(0, hz, SCR_W, SCR_H - hz, c565(14, 4, 40));
  uint16_t gc = c565(90, 220, 255);
  float ph = (frameNo % 20) / 20.0f;
  for (int i = 0; i < 9; i++) {
    float t = (i + ph) / 9.0f;
    int y = hz + (int)(t * t * (SCR_H - hz));
    if (y < SCR_H) gfx->drawFastHLine(0, y, SCR_W, gc);
  }
  for (int i = -8; i <= 8; i++) {                            // floor lines, clipped to the screen
    float x0 = 120 + i * 14, x1 = 120 + i * 90, y1 = SCR_H - 1;
    if (x1 < 0)          { y1 = hz + (0 - x0) / (x1 - x0) * (SCR_H - 1 - hz); x1 = 0; }
    if (x1 > SCR_W - 1)  { y1 = hz + (SCR_W - 1 - x0) / (x1 - x0) * (SCR_H - 1 - hz); x1 = SCR_W - 1; }
    gfx->drawLine((int)x0, hz, (int)x1, (int)y1, gc);
  }
  gfx->drawFastHLine(0, hz, SCR_W, COL_PINK);
}

void bgMatrix() {
  gfx->fillScreen(COL_BLACK);
  gfx->setTextSize(1);
  for (int c = 0; c < 40; c++) {
    matrixY[c] += matrixSpd[c] * 0.12f;
    if (matrixY[c] > 49) { matrixY[c] = -(float)random(0, 20); matrixSpd[c] = random(2, 7); }
    int head = (int)matrixY[c];
    for (int k = 0; k < 12; k++) {
      int row = head - k;
      if (row < 0 || row >= 35) continue;
      int g = 220 - k * 18;
      uint16_t col = (k == 0) ? c565(200, 255, 220) : c565(0, g, g / 4);
      char ch = 33 + ((c * 31 + row * 17 + (int)(frameNo >> 4)) % 90);
      gfx->drawChar(c * 6, row * 8, ch, col, COL_BLACK);
    }
  }
}

void bgPlasma() {
  uint8_t t = frameNo * 3;
  for (int y = 0; y < 70; y++) {
    for (int x = 0; x < 60; x++) {
      int v = sinLut[(uint8_t)(x * 5 + t)] + sinLut[(uint8_t)(y * 4 - t)] + sinLut[(uint8_t)((x + y) * 3 + t / 2)] + sinLut[(uint8_t)(x * 2 - y * 3 + t)];
      gfx->fillRect(x * 4, y * 4, 4, 4, mix565(hue565((uint8_t)(v / 3 + t)), COL_GRAPE2, 110));
    }
  }
}

void bgLava() {
  for (int i = 0; i < 5; i++) {
    Blob &b = blobs[i];
    b.vx += tiltX * 0.006f;
    b.vy += tiltY * 0.006f + sinf(frameNo * 0.012f + i * 1.7f) * 0.012f;
    b.vx = constrain(b.vx * 0.99f, -0.6f, 0.6f);
    b.vy = constrain(b.vy * 0.99f, -0.6f, 0.6f);
    b.x += b.vx; b.y += b.vy;
    if (b.x < 6)  { b.x = 6;  b.vx = fabsf(b.vx); }
    if (b.x > 54) { b.x = 54; b.vx = -fabsf(b.vx); }
    if (b.y < 6)  { b.y = 6;  b.vy = fabsf(b.vy); }
    if (b.y > 64) { b.y = 64; b.vy = -fabsf(b.vy); }
  }
  const uint16_t cBg = c565(40, 8, 60), cEdge = c565(255, 60, 120), cMid = c565(255, 140, 60), cHot = c565(255, 225, 120);
  for (int y = 0; y < 70; y++) {
    for (int x = 0; x < 60; x++) {
      float s = 0;
      for (int i = 0; i < 5; i++) {
        float dx = x - blobs[i].x, dy = y - blobs[i].y;
        s += blobs[i].r * blobs[i].r / (dx * dx + dy * dy + 1.0f);
      }
      gfx->fillRect(x * 4, y * 4, 4, 4, s > 1.7f ? cHot : s > 1.15f ? cMid : s > 0.85f ? cEdge : cBg);
    }
  }
}

// Snow that always falls toward real-world "down", whichever way the charm hangs.
void bgSnow() {
  verticalGradient(c565(8, 20, 60), c565(40, 90, 160));
  float gxv = imuOK ? tiltX : 0, gyv = imuOK ? tiltY : 1;
  for (int i = 0; i < 70; i++) {
    Flake &f = flakes[i];
    f.vx += gxv * 0.06f + (accX - tiltX) * 1.2f + (int)random(-10, 11) * 0.008f;
    f.vy += gyv * 0.06f + (accY - tiltY) * 1.2f + (int)random(-10, 11) * 0.008f;
    f.vx *= 0.93f; f.vy *= 0.93f;
    f.x += f.vx * f.r; f.y += f.vy * f.r;
    if (f.x < 0) f.x += SCR_W - 4;
    if (f.x > SCR_W - 4) f.x -= SCR_W - 4;
    if (f.y < 0) f.y += SCR_H - 4;
    if (f.y > SCR_H - 4) f.y -= SCR_H - 4;
    rectC((int)f.x, (int)f.y, f.r, f.r, COL_WHITE);
  }
}

void bgChecker() {
  int off = (frameNo % 80) / 2;
  const uint16_t a = c565(255, 170, 215), b = c565(170, 225, 255);
  for (int ty = -1; ty < 8; ty++)
    for (int tx = -1; tx < 7; tx++)
      rectC(tx * 40 + off, ty * 40 + off, 40, 40, ((tx + ty) & 1) ? a : b);
}

// drifting nodes that link up when they pass close to each other
void bgNet() {
  gfx->fillScreen(COL_VOID);
  for (int i = 0; i < NODE_N; i++) {
    NetNode &n = nodes[i];
    n.x += n.vx + tiltX * 0.4f; n.y += n.vy;
    if (n.x < 4)   { n.x = 4;   n.vx = fabsf(n.vx); }
    if (n.x > 235) { n.x = 235; n.vx = -fabsf(n.vx); }
    if (n.y < 4)   { n.y = 4;   n.vy = fabsf(n.vy); }
    if (n.y > 275) { n.y = 275; n.vy = -fabsf(n.vy); }
  }
  for (int i = 0; i < NODE_N; i++)
    for (int j = i + 1; j < NODE_N; j++) {
      float dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
      if (d2 < 6400.0f)
        gfx->drawLine((int)nodes[i].x, (int)nodes[i].y, (int)nodes[j].x, (int)nodes[j].y, mix565(ACC, COL_VOID, (uint8_t)(d2 * 255.0f / 6400.0f)));
    }
  for (int i = 0; i < NODE_N; i++) gfx->fillRect((int)nodes[i].x - 1, (int)nodes[i].y - 1, 3, 3, ACC);
}

// near-black with a dot grid and a slow scan beam. Easiest on the battery.
void bgVoid() {
  gfx->fillScreen(COL_BLACK);
  for (int y = 10; y < SCR_H; y += 20) for (int x = 10; x < SCR_W; x += 20) gfx->drawPixel(x, y, ACC_DIM);
  int sy = (int)((frameNo * 2) % (SCR_H + 60)) - 30;
  for (int k = 0; k < 24; k++) {
    int y = sy - k;
    if (y >= 0 && y < SCR_H) gfx->drawFastHLine(0, y, SCR_W, mix565(ACC, COL_BLACK, 160 + k * 4));
  }
}

void drawBackground() {
  switch (bgStyle) {
    case 1: bgWarp(); break;
    case 2: bgVapor(); break;
    case 3: bgMatrix(); break;
    case 4: bgPlasma(); break;
    case 5: bgLava(); break;
    case 6: bgSnow(); break;
    case 7: bgChecker(); break;
    case 9: bgNet(); break;
    case 10: bgVoid(); break;
    case 8:
      if (photoLoaded && photoBuf) { gfx->draw16bitRGBBitmap(0, 0, photoBuf, SCR_W, SCR_H); break; }
      // no photo yet: fall through to aurora
      [[fallthrough]];
    default:
      verticalGradient(COL_GRAPE2, COL_ICE2);
      drawSparkles(c565(200, 180, 255));
  }
}

// ───────────── Shared bits for the screens ─────────────
static const char *DAYS[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
static const char *MON[]  = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};

uint32_t npPosition() {
  uint32_t p = npPosMs + (npPlaying ? millis() - npStamp : 0);
  return npDurMs ? min(p, npDurMs) : p;
}

// perspective floor, clipped to the screen
void floorGrid(int hz, uint16_t gc) {
  for (int i = 0; i < 9; i++) {
    float t = i / 9.0f;
    int y = hz + (int)(t * t * (SCR_H - hz));
    if (y < SCR_H) gfx->drawFastHLine(0, y, SCR_W, gc);
  }
  for (int i = -8; i <= 8; i++) {
    float x0 = 120 + i * 14, x1 = 120 + i * 90, y1 = SCR_H - 1;
    if (x1 < 0)         { y1 = hz + (0 - x0) / (x1 - x0) * (SCR_H - 1 - hz); x1 = 0; }
    if (x1 > SCR_W - 1) { y1 = hz + (SCR_W - 1 - x0) / (x1 - x0) * (SCR_H - 1 - hz); x1 = SCR_W - 1; }
    gfx->drawLine((int)x0, hz, (int)x1, (int)y1, gc);
  }
}

const char *CAT[12] = {
  "K..........K", "KK........KK", "KBK......KBK", "KBBKKKKKKBBK",
  "KBBBBBBBBBBK", "KBBKBBBBKBBK", "KBBKBBBBKBBK", "KBPBBKKBBPBK",
  "KBBBBBBBBBBK", ".KBBBBBBBBK.", "..KBBBBBBK..", "...KKKKKK..."};
const char *GHOST[12] = {
  "...KKKKKK...", "..KBBBBBBK..", ".KBBBBBBBBK.", "KBBBBBBBBBBK",
  "KBBKBBBBKBBK", "KBBKBBBBKBBK", "KBBBBBBBBBBK", "KBPBBBBBBPBK",
  "KBBBBKKBBBBK", "KBBBBBBBBBBK", "KBKBBKKBBKBK", "KK.KK..KK.KK"};
const char *FROG[12] = {
  ".KKK....KKK.", "KWWKK..KKWWK", "KWKWKKKKWKWK", "KBBBBBBBBBBK",
  "KBBBBBBBBBBK", "KBPBBBBBBPBK", "KBBKBBBBKBBK", "KBBBKKKKBBBK",
  "KBBBBBBBBBBK", ".KBBBBBBBBK.", "KBBK....KBBK", "KKK......KKK"};

void drawSprite(const char *const *spr, int ox, int oy, int scale, uint16_t body, bool blink) {
  int eyeRow = (spr == GHOST) ? 4 : (spr == FROG) ? 2 : 5;
  for (int y = 0; y < 12; y++) {
    for (int x = 0; x < 12; x++) {
      char ch = spr[y][x];
      if (ch == '.') continue;
      uint16_t c = ch == 'K' ? c565(30, 20, 50) : ch == 'W' ? COL_WHITE : ch == 'P' ? COL_PINK : body;
      if (blink && ch == 'K' && x > 0 && x < 11 && y == eyeRow) c = (spr == FROG) ? COL_WHITE : body;
      gfx->fillRect(ox + x * scale, oy + y * scale, scale, scale, c);
    }
  }
}
