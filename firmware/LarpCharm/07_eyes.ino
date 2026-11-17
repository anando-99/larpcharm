// Larp Charm firmware: The animated eyes.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v5: the eyes ═════════════
// Two glowing blue eyes. They look around, blink, follow tilt, and change expression.
enum Expr : uint8_t { E_NEUTRAL, E_HAPPY, E_LAUGH, E_SAD, E_ANGRY, E_SURPRISED, E_SLEEPY, E_BORED, E_SUSPICIOUS, E_WINK, E_LOVE, E_DIZZY, EXPR_COUNT };
const char *EXPR_NAMES[EXPR_COUNT] = {"neutral", "happy", "laugh", "sad", "angry", "surprised", "sleepy", "bored", "suspicious", "wink", "love", "dizzy"};
EyeShape eyeL = {62, 74, 18, 0, 0, 0}, eyeR = {62, 74, 18, 0, 0, 0}, eyeLT = eyeL, eyeRT = eyeR;
float    lookX = 0, lookY = 0, lookTX = 0, lookTY = 0, tiltBaseX = 0, tiltBaseY = 0;
uint8_t  exprSet = E_NEUTRAL, exprShown = 255, idleExpr = E_NEUTRAL;
bool     exprAuto = true;
uint32_t exprUntil = 0, nextSaccade = 0, nextBlink = 0, blinkAt = 0, nextIdleExpr = 0, idleExprUntil = 0;

void exprTargets(uint8_t e) {
  const EyeShape n = {62, 74, 18, 0, 0, 0};
  eyeLT = eyeRT = n;
  switch (e) {
    case E_HAPPY:      eyeLT.lidB = eyeRT.lidB = 0.5f; break;
    case E_LAUGH:      eyeLT.lidB = eyeRT.lidB = 0.62f; eyeLT.h = eyeRT.h = 66; break;
    case E_SAD:        eyeLT.lidT = eyeRT.lidT = 0.3f; eyeLT.slope = eyeRT.slope = 0.42f; eyeLT.h = eyeRT.h = 66; break;
    case E_ANGRY:      eyeLT.lidT = eyeRT.lidT = 0.36f; eyeLT.slope = eyeRT.slope = -0.55f; eyeLT.h = eyeRT.h = 64; break;
    case E_SURPRISED:  eyeLT.w = eyeRT.w = 70; eyeLT.h = eyeRT.h = 86; eyeLT.rad = eyeRT.rad = 33; break;
    case E_SLEEPY:     eyeLT.lidT = eyeRT.lidT = 0.62f; eyeLT.slope = eyeRT.slope = 0.12f; break;
    case E_BORED:      eyeLT.lidT = eyeRT.lidT = 0.46f; eyeLT.lidB = eyeRT.lidB = 0.1f; break;
    case E_SUSPICIOUS: eyeLT.lidT = 0.52f; eyeRT.lidT = 0.16f; eyeRT.h = 70; break;
    case E_WINK:       eyeLT.lidB = 0.5f; eyeRT.h = 9; eyeRT.rad = 4; break;
    case E_DIZZY:      eyeLT.w = eyeRT.w = 50; eyeLT.h = eyeRT.h = 50; eyeLT.rad = eyeRT.rad = 25; break;
    default: break;
  }
}

void setExpr(uint8_t e, uint32_t ms) {
  exprSet = e % EXPR_COUNT;
  exprAuto = false;
  exprUntil = millis() + ms;
}

static inline void lerpShape(EyeShape &a, const EyeShape &b, float k) {
  a.w += (b.w - a.w) * k; a.h += (b.h - a.h) * k; a.rad += (b.rad - a.rad) * k;
  a.lidT += (b.lidT - a.lidT) * k; a.slope += (b.slope - a.slope) * k; a.lidB += (b.lidB - a.lidB) * k;
}

void eyesThink() {
  uint32_t now = millis();
  if (!exprAuto && now > exprUntil) exprAuto = true;
  uint8_t want = exprSet;
  if (exprAuto) {
    if (jbPlaying) want = (jbNote / 8) % 2 ? E_HAPPY : E_LAUGH;
    else if (charging) want = E_HAPPY;
    else if (batPct < 15) want = E_SLEEPY;
    else if (now - lastInteraction > 20000) want = E_SLEEPY;
    else {
      if (now > nextIdleExpr) {
        static const uint8_t IDLE[] = {E_NEUTRAL, E_HAPPY, E_SUSPICIOUS, E_BORED, E_SURPRISED, E_WINK, E_HAPPY, E_NEUTRAL};
        idleExpr = IDLE[random(0, sizeof(IDLE))];
        idleExprUntil = now + random(1400, 3200);
        nextIdleExpr = now + random(5000, 11000);
      }
      want = now < idleExprUntil ? idleExpr : E_NEUTRAL;
    }
  }
  if (want != exprShown) { exprShown = want; exprTargets(want); }

  if (now > nextSaccade) {
    if (random(0, 3) == 0) { lookTX = 0; lookTY = 0; }
    else { lookTX = random(-26, 27); lookTY = random(-16, 17); }
    nextSaccade = now + random(900, 3200);
  }
  if (imuOK) {
    tiltBaseX += (tiltX - tiltBaseX) * 0.004f; tiltBaseY += (tiltY - tiltBaseY) * 0.004f;
    float dx = tiltX - tiltBaseX, dy = tiltY - tiltBaseY;
    if (fabsf(dx) > 0.12f || fabsf(dy) > 0.12f) {
      lookTX = constrain(dx * 75, -30.0f, 30.0f); lookTY = constrain(dy * 55, -20.0f, 20.0f);
      nextSaccade = now + 900;
    }
  }
  if (exprShown == E_SLEEPY) { lookTY = 10; }
  lookX += (lookTX - lookX) * 0.32f;
  lookY += (lookTY - lookY) * 0.32f;
  lerpShape(eyeL, eyeLT, 0.28f);
  lerpShape(eyeR, eyeRT, 0.28f);
  eyeBounce *= 0.8f;
  if (now > nextBlink) {
    blinkAt = now;
    nextBlink = now + (random(0, 5) == 0 ? 280 : random(2200, 6000));
    if (exprShown == E_SLEEPY) nextBlink += 2500;
  }
}

// One eye: a rounded block with lids, a soft blue glow and a highlight.
void drawEye(float cx, float cy, const EyeShape &e, bool left) {
  if (!FB) return;
  float hw = e.w * 0.5f, hh = fmaxf(1.5f, e.h * 0.5f), r = fminf(e.rad, fminf(hw, hh));
  float vis = (1 - e.lidT * 0.9f) * (1 - e.lidB * 0.6f) * fminf(1.0f, e.h / 60.0f);
  int x0 = max(0, (int)(cx - hw - 16)), x1 = min(SCR_W - 1, (int)(cx + hw + 16));
  int y0 = max(0, (int)(cy - hh - 16)), y1 = min(SCR_H - 1, (int)(cy + hh + 16));
  const uint16_t glowC = c565(0, 96, 255);
  for (int y = y0; y <= y1; y++) {
    float py = y + 0.5f - cy, t = clamp01((py + hh) / (2 * hh));
    uint16_t core = rgbf(170 - 150 * t, 236 - 110 * t, 255);
    uint16_t *row = FB + y * SCR_W;
    for (int x = x0; x <= x1; x++) {
      float px = x + 0.5f - cx;
      float sd = sdRound(px, py, hw, hh, r);
      if (sd > 16) continue;
      float a = 0.5f - sd;
      if (a > 0) {
        float xn = px / hw, u = left ? -xn : xn;
        if (e.lidT > 0.002f || fabsf(e.slope) > 0.002f) a = fminf(a, py - (-1 + 2 * e.lidT + e.slope * u) * hh + 0.5f);
        if (e.lidB > 0.002f) a = fminf(a, hh - e.lidB * 2 * hh * (1 - 0.85f * xn * xn) - py + 0.5f);
      }
      uint16_t c = row[x];
      if (sd > 0) c = blend565(c, glowC, (uint8_t)(clamp01(0.5f * vis / (1 + sd * sd * 0.05f)) * 255));
      if (a > 0) {
        uint16_t cc = core;
        float hx = (px + hw * 0.36f) / (hw * 0.3f), hy = (py + hh * 0.5f) / (hh * 0.2f), h2 = hx * hx + hy * hy;
        if (h2 < 1) cc = blend565(cc, COL_WHITE, (uint8_t)((1 - h2) * 150));
        c = blend565(c, cc, (uint8_t)(clamp01(a) * 255));
      }
      row[x] = c;
    }
  }
}

void drawHeart(float cx, float cy, float s, uint16_t col) {
  if (!FB) return;
  for (int y = (int)(cy - s * 1.3f); y <= (int)(cy + s * 1.3f); y++) {
    if ((unsigned)y >= SCR_H) continue;
    for (int x = (int)(cx - s * 1.3f); x <= (int)(cx + s * 1.3f); x++) {
      if ((unsigned)x >= SCR_W) continue;
      int in = 0;
      for (int k = 0; k < 4; k++) {
        float X = (x + 0.25f + 0.5f * (k & 1) - cx) / s, Y = -(y + 0.25f + 0.5f * (k >> 1) - cy) / s + 0.3f;
        float q = X * X + Y * Y - 1;
        if (q * q * q - X * X * Y * Y * Y <= 0) in++;
      }
      if (in) FB[y * SCR_W + x] = blend565(FB[y * SCR_W + x], col, in * 63);
    }
  }
}

void drawEyes() {
  eyesThink();
  {
    gfx->fillScreen(COL_BLACK);
    for (int y = 10; y < SCR_H; y += 20) for (int x = 10; x < SCR_W; x += 20) gfx->drawPixel(x, y, c565(0, 26, 52));
  }
  uint32_t now = millis();
  float t = now / 1000.0f;
  uint32_t el = now - blinkAt;
  float bf = el < 90 ? 1 - el / 90.0f * 0.92f : el < 180 ? 0.08f + (el - 90) / 90.0f * 0.92f : 1;
  float cy = 140 + lookY - eyeBounce;
  if (exprShown == E_LAUGH) cy += sinf(t * 22) * 3;
  if (npPlaying && !jbPlaying) cy += sinf(t * 7.5f) * 3;
  if (exprShown == E_LOVE) {
    float s = 30 * (1 + 0.1f * sinf(t * 9));
    drawHeart(70 + lookX, cy, s, c565(255, 80, 160));
    drawHeart(170 + lookX, cy, s, c565(255, 80, 160));
  } else {
    EyeShape L = eyeL, R = eyeR;
    L.h *= bf; if (R.h > 12) R.h *= bf;
    L.w *= 1 - lookX * 0.004f; L.h *= 1 - lookX * 0.003f;
    R.w *= 1 + lookX * 0.004f; R.h *= 1 + lookX * 0.003f;
    float dxl = 0, dyl = 0, dxr = 0, dyr = 0;
    if (exprShown == E_DIZZY) { dxl = cosf(t * 8) * 12; dyl = sinf(t * 8) * 12; dxr = cosf(-t * 8 + 1) * 12; dyr = sinf(-t * 8 + 1) * 12; }
    drawEye(70 + lookX + dxl, cy + dyl, L, true);
    drawEye(170 + lookX + dxr, cy + dyr, R, false);
    if (exprShown == E_DIZZY)
      for (int i = 0; i < 3; i++) { float a = t * 4 + i * 2.094f; sparkle(120 + (int)(cosf(a) * 70), 70 + (int)(sinf(a) * 10), 4, COL_AMBER); }
  }
  if (exprShown == E_SLEEPY) {
    for (int i = 0; i < 3; i++) {
      float p = fmodf(t * 0.5f + i / 3.0f, 1.0f);
      int zx = 190 + (int)(p * 26), zy = 92 - (int)(p * 50);
      textAt("z", zx, zy, 1 + i % 2, mix565(c565(0, 140, 255), COL_BLACK, (uint8_t)(p * 255)));
    }
  }
  if (millis() < chromeUntil) topBar("//EYES", true);
}


void noteName(uint8_t m, char *out) {
  static const char *N[12] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
  if (!m) { strcpy(out, "--"); return; }
  sprintf(out, "%s%d", N[m % 12], m / 12 - 1);
}

#define JB_ROW_Y 50
#define JB_ROW_H 17
#define JB_ROWS  8
// Deck jukebox: a category bar, the songs in it, and a player strip. Tap a song to queue it.
void drawJukeDeck() {
  gfx->fillScreen(COL_VOID);
  topBar("//JUKEBOX", true);
  int16_t ids[JB_ROWS];
  if (jbCat >= catCount()) jbCat = 0;
  int n = songsInCat(jbCat, ids, JB_ROWS);
  hudPanel(10, 27, 220, 19, ACC, 1);
  String cn = catName(jbCat); cn.toUpperCase();
  textCentered(cn, 33, 1, COL_WHITE);
  textAt("<", 18, 33, 1, ACC); textAt(">", 216, 33, 1, ACC);
  for (int i = 0; i < n; i++) {
    int id = ids[i], y = JB_ROW_Y + i * JB_ROW_H;
    bool cur = jbPlaying && jbSong == id;
    int qpos = -1;
    for (int k = 0; k < jbQLen; k++) if (jbQueue[k] == id) { qpos = k; break; }
    if (cur) gfx->fillRect(14, y, 212, JB_ROW_H - 2, mix565(ACC, COL_BLACK, 170));
    String nm = songName(id); nm.toUpperCase();
    char b[40];
    snprintf(b, sizeof(b), "%02d %s", i + 1, nm.substring(0, 28).c_str());
    textAt(b, 20, y + 4, 1, cur ? COL_WHITE : (qpos >= 0 ? ACC : mix565(COL_WHITE, COL_BLACK, 70)));
    if (cur) textAt(">", 212, y + 4, 1, ACC);
    else if (qpos >= 0) { snprintf(b, sizeof(b), "Q%d", qpos + 1); textAt(b, 208, y + 4, 1, ACC); }
  }
  const int py = 192;
  hudPanel(10, py, 220, 58, ACC, 1);
  char nn[6];
  noteName(jbPlaying ? jbLastMidi : 0, nn);
  textAt(nn, 20, py + 10, 3, jbToneOn ? COL_WHITE : ACC_DIM);
  for (int i = 0; i < 20; i++) {
    uint8_t m = jbRoll[i];
    if (!m) continue;
    int h = constrain((m - 60) * 2, 2, 30);
    gfx->fillRect(100 + i * 6, py + 36 - h, 4, h, i == 19 && jbToneOn ? COL_WHITE : ACC);
  }
  gfx->fillRect(20, py + 42, 200, 2, ACC_LOW);
  gfx->fillRect(20, py + 42, (int)(200 * jbProgress()), 2, COL_WHITE);
  if (jbPlaying) {
    textAt(String("+") + (int)jbQLen + " QUEUED", 20, py + 48, 1, COL_WHITE);
    textAt("STOP", 132, py + 48, 1, ACC); textAt("SKIP >", 184, py + 48, 1, ACC);
  } else textAt("TAP A SONG TO PLAY OR QUEUE", 20, py + 48, 1, COL_WHITE);
}


void drawJuke() { drawJukeDeck(); }
