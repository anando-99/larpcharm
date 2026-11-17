// Larp Charm firmware: Spells and the wand: the 1D CNN on the charm, teach-your-own, knob, air drawing, the constellation.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ 9.2: spells, cast in the air ═════════════
// Hold your thumb on the `spell --cast` screen, draw a spell in the air, let go. A 1D CNN (spells_model.h,
// trained on recorded takes by firmware/tools/spells) turns the take into a 32-number fingerprint; the four
// built-in spells are the nearest class prototype, or "no match" under SPL_BASE_THR. Spells you teach are
// recognised by DTW against their own 5 recordings, with the CNN able to veto (the hybrid rule in
// firmware/tools/spells/evaluate.py). Each spell plays its effect, then does what the spellbook says.
// The network runs here on the charm in a few tens of milliseconds; nothing leaves the charm to recognise.
#include "spells_engine.h"
#define SPL_CUSTOM 6                  // spells you can teach
#define SPL_TEACH  5                  // recordings per taught spell
#define SPL_TROWS  300                // rows kept per recording (6 s at 50 Hz)
enum SplAct : uint8_t { SA_NONE, SA_TORCH, SA_THEME, SA_NEXT, SA_PLAY, SA_LOVE, SA_WEATHER, SA_CLOCK, SA_PET, SA_DICE, SA_CLAUDE, SA_SPOTIFY, SA_COUNT };
const char *SA_NAMES[SA_COUNT] = {"nothing", "torch", "new colour", "next song", "play/pause", "eyes in love", "weather", "clock", "pet", "roll dice", "claude", "spotify"};
const char *SPL_WORD[4] = {"LUMOS", "FULMEN", "ACCIO", "AMOR"};       // what the charm calls out for circle, zigzag, flick, heart
uint8_t splBaseAct[4] = {SA_TORCH, SA_THEME, SA_NEXT, SA_LOVE};
struct SplCustom { bool used; uint8_t act; char name[17]; float proto[SPL_EMB]; float wmax; uint16_t rows[SPL_TEACH]; float *tpl[SPL_TEACH]; };
SplCustom splC[SPL_CUSTOM];
float   *splSeg = nullptr, *splIn = nullptr, *splA = nullptr, *splB = nullptr, *splFeat = nullptr, *splRows = nullptr;
float   *splBaseTpl = nullptr;        // the stored recordings for the base spells, as floats
uint32_t splBaseOff[SPL_TPL_N];
// the last cast
int8_t   castKind = -1;               // -1 none yet, 0..3 base spell, 10+k taught spell k, 99 fizzle
float    castSim = 0, castTop[3]; const char *castTopName[3]; char castTopBuf[3][17];
uint32_t castAt = 0, castMs = 0; uint8_t castActNow = SA_NONE;
// teaching
int8_t   teachSlot = -1; uint8_t teachN = 0, teachAct = SA_NONE; char teachName[17] = "";
float    teachEmb[SPL_TEACH][SPL_EMB];
float    castEmb[SPL_EMB];                // the last cast's fingerprint

// ═════════════ 9.3: the wand ═════════════
// The spell screen has four views along its top: cast (spells, with charge-up), knob (twist the charm like a dial:
// Spotify volume, or brightness when nothing plays), draw (the charm is a laser pointer: hold your thumb and draw in
// the air; shake to wipe) and map (the constellation: the network's fingerprint space, every cast landing as a star).
// Knob and draw read the gyro live: its offset is tracked whenever the charm is still, so they don't drift.
const char *WAND_TABS[4] = {"cast", "knob", "draw", "map"};
float    gyroBias[3] = {0, 0, 0};       // dps, kept up to date while still
uint16_t wandFrom = 0;                  // next sample of the current hold still to read
// knob
float    knobAng = 0, knobStart = 0; int knobVal = -1, knobSent = -1; bool knobVol = false; uint32_t knobSentAt = 0;
// draw: points in the 228 x 196 canvas; x = -1 lifts the pen
#define SK_MAX 2400
#define SK_W 228
#define SK_H 196
int16_t *skX = nullptr, *skY = nullptr; uint16_t skN = 0, skStroke = 0;
float    skPx = SK_W / 2, skPy = SK_H / 2;
uint32_t skShakeAt = 0; uint8_t skShakeHits = 0;
// map: the last casts, as stars
struct MapStar { float x, y; int8_t kind; uint32_t at; };
MapStar  mapStars[10]; uint8_t mapStarN = 0;
float    castPower = 0; uint32_t castBonusAt = 0;

void wandSet(uint8_t v) {
  if (recOn) return;
  wandView = v % 4; sfx(1); glitchFrames = 2;
  if (wandView == 1) { knobVal = npVol >= 0 && bleConnected ? npVol : (brightness - 8) * 100 / 247; }
}

void mapProject(const float *emb, float &x, float &y) {
  float z0 = 0, z1 = 0;
  for (int e = 0; e < SPL_EMB; e++) { float d = emb[e] - SPL_MAP_MEAN[e]; z0 += d * SPL_MAP_V[e]; z1 += d * SPL_MAP_V[SPL_EMB + e]; }
  x = (z0 - SPL_MAP_BOX[0]) / (SPL_MAP_BOX[2] - SPL_MAP_BOX[0]); y = (z1 - SPL_MAP_BOX[1]) / (SPL_MAP_BOX[3] - SPL_MAP_BOX[1]);
}
void mapAdd(const float *emb, int8_t kind) {
  if (mapStarN == 10) { memmove(mapStars, mapStars + 1, sizeof(MapStar) * 9); mapStarN = 9; }
  MapStar &s = mapStars[mapStarN++]; mapProject(emb, s.x, s.y); s.kind = kind; s.at = millis();
}

// how hard you cast: the angle the charm swept through and how fast it turned (0..1)
float castPowerOf(const float *seg, int n) {
  float ang[3] = {0, 0, 0}, lo[3] = {0, 0, 0}, hi[3] = {0, 0, 0}, peak = 0;
  for (int i = 0; i < n; i++) {
    float m = 0;
    for (int c = 0; c < 3; c++) { float w = seg[i * 6 + 3 + c] * 200; ang[c] += w / REC_HZ; lo[c] = min(lo[c], ang[c]); hi[c] = max(hi[c], ang[c]); m += w * w; }
    peak = max(peak, sqrtf(m));
  }
  float span = max(hi[0] - lo[0], max(hi[1] - lo[1], hi[2] - lo[2]));
  return constrain(0.5f * min(1.0f, span / 90.0f) + 0.5f * min(1.0f, peak / 500.0f), 0.0f, 1.0f);
}

void skSendStroke(uint16_t from) {
  if (!bleConnected || !skX) return;
  char b[512]; uint8_t raw[280];
  bool first = true;
  for (uint16_t i = from; i < skN; ) {
    int k = 0;
    while (i < skN && k < 280) { if (skX[i] >= 0) { raw[k++] = (uint8_t)skX[i]; raw[k++] = (uint8_t)skY[i]; } i++; }
    int m = snprintf(b, sizeof(b), "sk=%c,", first ? 's' : 'c');
    m += b64(raw, k, b + m); b[m] = 0;
    notifyText(b); delay(12); first = false;
  }
}
void skClear() { skN = 0; skPx = SK_W / 2; skPy = SK_H / 2; if (bleConnected) notifyText("sk=x"); }

// thumb down on the knob or draw view
void wandBegin() {
  wandFrom = 0;
  if (wandView == 1) {
    knobVol = npVol >= 0 && bleConnected;
    knobStart = knobVol ? npVol : (brightness - 8) * 100.0f / 247; knobAng = 0; knobVal = (int)knobStart;
  } else if (wandView == 2 && skX) {
    if (skN && skN < SK_MAX) { skX[skN] = -1; skY[skN] = -1; skN++; }
    skStroke = skN;
    if (skN < SK_MAX) { skX[skN] = (int16_t)skPx; skY[skN] = (int16_t)skPy; skN++; }
  }
}
// thumb up
void wandEnd() {
  if (wandView == 1) {
    if (knobVol && knobVal != knobSent) { char b[24]; snprintf(b, sizeof(b), "media=vol:%d", knobVal); notifyText(b); knobSent = knobVal; }
    if (!knobVol) prefs.putUChar("bright", brightness);
    sfx(1);
  } else if (wandView == 2) skSendStroke(skStroke);
}

// every loop on the spell screen: follow the gyro's offset, read the twist or the stroke, spot a shake
void wandPoll() {
  if (mode != M_CAST || !recSampling) return;
  uint32_t now = millis();
  static uint32_t lastTrack = 0;
  if (now - lastTrack > 100) {                       // still for half a second? then that's the gyro's offset
    lastTrack = now;
    uint16_t head = recLiveHead; float mean[3] = {0, 0, 0}, dev = 0; float amax = 0;
    for (int i = 0; i < 50; i++) for (int c = 0; c < 3; c++) mean[c] += recLive[(uint16_t)(head - 1 - i) % REC_LIVE][3 + c] / (float)REC_G_LSB / 50;
    for (int i = 0; i < 50; i++) {
      const int16_t *v = recLive[(uint16_t)(head - 1 - i) % REC_LIVE];
      for (int c = 0; c < 3; c++) dev = max(dev, fabsf(v[3 + c] / (float)REC_G_LSB - mean[c]));
      if (i < 12) amax = max(amax, sqrtf((float)v[0] * v[0] + (float)v[1] * v[1] + (float)v[2] * v[2]) / REC_A_LSB);
    }
    if (dev < 3 && fabsf(mean[0]) < 20 && fabsf(mean[1]) < 20 && fabsf(mean[2]) < 20) for (int c = 0; c < 3; c++) gyroBias[c] = gyroBias[c] * 0.7f + mean[c] * 0.3f;
    if (wandView == 2 && !recOn && amax > 2.2f) {    // shake to wipe the sketch
      if (now - skShakeAt > 700) skShakeHits = 0;
      skShakeAt = now;
      if (++skShakeHits >= 3) { skShakeHits = 0; skClear(); toast("wiped", 600); sfx(3); }
    }
  }
  if (!recOn || wandView == 0 || wandView == 3) return;
  uint16_t n = recN;
  for (; wandFrom < n; wandFrom++) {
    const int16_t *v = recBuf + wandFrom * 6;
    float gx = v[3] / (float)REC_G_LSB - gyroBias[0], gy = v[4] / (float)REC_G_LSB - gyroBias[1], gz = v[5] / (float)REC_G_LSB - gyroBias[2];
    if (wandView == 1) knobAng += gz / REC_HZ;      // clockwise (as you look at the screen) is +Z
    else if (skX) {
      skPx = constrain(skPx - gx / REC_HZ * 2.4f, 0.0f, (float)SK_W - 1); skPy = constrain(skPy - gy / REC_HZ * 2.4f, 0.0f, (float)SK_H - 1);
      int16_t lx = skX[skN - 1], ly = skY[skN - 1];
      if (skN < SK_MAX && (abs((int)skPx - lx) + abs((int)skPy - ly)) >= 2) { skX[skN] = (int16_t)skPx; skY[skN] = (int16_t)skPy; skN++; }
    }
  }
  if (wandView == 1) {
    knobVal = constrain((int)lroundf(knobStart + knobAng / 3), 0, 100);   // a quarter turn = 30%
    if (knobVol) {
      npVol = knobVal;
      if (knobVal != knobSent && now - knobSentAt > 300) { char b[24]; snprintf(b, sizeof(b), "media=vol:%d", knobVal); notifyText(b); knobSent = knobVal; knobSentAt = now; }
    } else setBacklight(8 + knobVal * 247 / 100);
  }
}

void drawKnob(int bx, int by, int bw, int bh) {
  int cx = bx + bw / 2, cy = by + bh / 2 + 6, r = 62;
  int v = knobVal < 0 ? 0 : knobVal;
  for (int i = 0; i <= 40; i++) {                    // a 270 degree dial, lit up to the value
    float a = (135 + i * 270 / 40.0f) * 0.017453f;
    uint16_t c = i * 100 / 40 <= v ? ACC : ACC_LOW;
    int x0 = cx + (int)(cosf(a) * (r - 8)), y0 = cy + (int)(sinf(a) * (r - 8)), x1 = cx + (int)(cosf(a) * r), y1 = cy + (int)(sinf(a) * r);
    gfx->drawLine(x0, y0, x1, y1, c); if (i % 10 == 0) gfx->drawLine(x0, y0, cx + (int)(cosf(a) * (r + 5)), cy + (int)(sinf(a) * (r + 5)), TTY_DIM);
  }
  float a = (135 + v * 2.7f) * 0.017453f;
  gfx->drawLine(cx, cy, cx + (int)(cosf(a) * (r - 14)), cy + (int)(sinf(a) * (r - 14)), COL_WHITE);
  gfx->fillCircle(cx, cy, 4, ACC);
  char b[16]; snprintf(b, sizeof(b), "%d", v);
  textAt(b, cx - (int)strlen(b) * 9, cy + 18, 3, COL_WHITE);
  bool vol = recOn ? knobVol : (npVol >= 0 && bleConnected);
  textAt(vol ? "spotify volume" : "brightness", cx - (vol ? 42 : 30), by + 8, 1, vol ? ACC : TTY_TEXT);
}

void drawSketch(int bx, int by) {
  if (!skX) return;
  for (uint16_t i = 1; i < skN; i++) {
    if (skX[i] < 0 || skX[i - 1] < 0) continue;
    uint16_t c = recOn && i >= skStroke ? COL_WHITE : ACC;
    gfx->drawLine(bx + skX[i - 1], by + skY[i - 1], bx + skX[i], by + skY[i], c);
    gfx->drawLine(bx + skX[i - 1] + 1, by + skY[i - 1], bx + skX[i] + 1, by + skY[i], c);
  }
  int px = bx + (int)skPx, py = by + (int)skPy;                      // the pointer
  uint16_t pc = recOn ? COL_RED : ((millis() / 400) % 2 ? COL_WHITE : ACC);
  gfx->drawFastHLine(px - 5, py, 4, pc); gfx->drawFastHLine(px + 2, py, 4, pc); gfx->drawFastVLine(px, py - 5, 4, pc); gfx->drawFastVLine(px, py + 2, 4, pc);
}

uint16_t mapCol(int k) {
  static const uint16_t C[5] = {c565(0, 229, 255), c565(255, 96, 96), c565(255, 176, 64), c565(244, 114, 182), c565(110, 120, 135)};
  return k >= 0 && k < 5 ? C[k] : k >= 10 ? COL_LIME : COL_WHITE;
}
void drawMap(int bx, int by, int bw, int bh) {
  uint32_t now = millis();
  auto sx = [&](float x) { return bx + 8 + (int)(constrain(x, 0.0f, 1.0f) * (bw - 16)); };
  auto sy = [&](float y) { return by + bh - 8 - (int)(constrain(y, 0.0f, 1.0f) * (bh - 16)); };
  for (int i = 0; i < SPL_MAP_N; i++) {               // stars: recorded takes of each spell
    float x = (SPL_MAP_PTS[i * 3] - SPL_MAP_BOX[0]) / (SPL_MAP_BOX[2] - SPL_MAP_BOX[0]), y = (SPL_MAP_PTS[i * 3 + 1] - SPL_MAP_BOX[1]) / (SPL_MAP_BOX[3] - SPL_MAP_BOX[1]);
    int k = (int)SPL_MAP_PTS[i * 3 + 2]; uint16_t c = mapCol(k);
    if ((now / 300 + i * 7) % 11 == 0) sparkle(sx(x), sy(y), 1, c); else gfx->drawPixel(sx(x), sy(y), c);
  }
  for (int c = 0; c < SPL_CLASSES; c++) {             // constellations: the class prototypes, named
    float x, y; mapProject(SPL_PROTO + c * SPL_EMB, x, y);
    gfx->drawCircle(sx(x), sy(y), 3, mapCol(c));
    textAt(SPL_NAMES[c], constrain(sx(x) + 6, bx + 2, bx + bw - 6 * (int)strlen(SPL_NAMES[c]) - 2), sy(y) - 3, 1, mapCol(c));
  }
  for (int k = 0; k < SPL_CUSTOM; k++) if (splC[k].used) {
    float x, y; mapProject(splC[k].proto, x, y);
    gfx->drawCircle(sx(x), sy(y), 3, COL_LIME);
    textAt(splC[k].name, constrain(sx(x) + 6, bx + 2, bx + bw - 6 * (int)strlen(splC[k].name) - 2), sy(y) - 3, 1, COL_LIME);
  }
  for (int i = 0; i < mapStarN; i++) {                // your casts
    const MapStar &s = mapStars[i]; bool last = i == mapStarN - 1;
    int x = sx(s.x), y = sy(s.y); uint16_t c = s.kind == 99 ? TTY_DIM : COL_WHITE;
    if (last) { int r = 3 + (int)((now - s.at) / 120) % 5; gfx->drawCircle(x, y, r, c); sparkle(x, y, 3, c); }
    else gfx->fillCircle(x, y, 1, mix565(TTY_BG, c, 120 + i * 12));
  }
}


String splPath(int k) { return String("/spl/") + k + ".bin"; }
const char *splName(int8_t kind) { return kind >= 10 && kind < 10 + SPL_CUSTOM ? splC[kind - 10].name : kind >= 0 && kind < 4 ? SPL_NAMES[kind] : "fizzle"; }

bool splSaveCustom(int k) {
  if (!fsOK) return false;
  FFat.mkdir("/spl");
  File f = FFat.open(splPath(k), "w"); if (!f) return false;
  SplCustom &c = splC[k];
  f.write((const uint8_t *)"LSPL", 4); f.write(1); f.write(c.act); f.write((const uint8_t *)c.name, 17);
  f.write((const uint8_t *)c.proto, sizeof(c.proto)); f.write((const uint8_t *)&c.wmax, 4); f.write((const uint8_t *)c.rows, sizeof(c.rows));
  for (int i = 0; i < SPL_TEACH; i++) f.write((const uint8_t *)c.tpl[i], c.rows[i] * 6 * 4);
  f.close(); return true;
}
void splLoad() {
  for (int k = 0; k < SPL_CUSTOM; k++) {
    SplCustom &c = splC[k]; c.used = false;
    if (!c.tpl[0]) for (int i = 0; i < SPL_TEACH; i++) c.tpl[i] = (float *)ps_malloc(SPL_TROWS * 6 * 4);
    if (!fsOK || !c.tpl[0]) continue;
    File f = FFat.open(splPath(k), "r"); if (!f) continue;
    char mg[4]; uint8_t v;
    bool ok = f.read((uint8_t *)mg, 4) == 4 && !memcmp(mg, "LSPL", 4) && f.read(&v, 1) == 1 && v == 1 && f.read(&c.act, 1) == 1 &&
              f.read((uint8_t *)c.name, 17) == 17 && f.read((uint8_t *)c.proto, sizeof(c.proto)) == sizeof(c.proto) &&
              f.read((uint8_t *)&c.wmax, 4) == 4 && f.read((uint8_t *)c.rows, sizeof(c.rows)) == sizeof(c.rows);
    for (int i = 0; ok && i < SPL_TEACH; i++) ok = c.rows[i] <= SPL_TROWS && f.read((uint8_t *)c.tpl[i], c.rows[i] * 24) == c.rows[i] * 24;
    f.close(); c.name[16] = 0; c.used = ok;
  }
  for (int i = 0; i < 4; i++) splBaseAct[i] = prefs.getUChar((String("spa") + i).c_str(), splBaseAct[i]) % SA_COUNT;
}
void splInit() {
  // the network's working memory in the fast internal RAM (about 45 KB), the rest in PSRAM
  auto fast = [](size_t n) { void *p = heap_caps_malloc(n, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT); return (float *)(p ? p : ps_malloc(n)); };
  skX = (int16_t *)malloc(SK_MAX * 2); skY = (int16_t *)malloc(SK_MAX * 2);
  splSeg = (float *)ps_malloc(SPL_MAX_ROWS * 6 * 4); splIn = fast(SPL_IN * SPL_T * 4);
  splA = fast(SPL_BUF * 4); splB = fast(SPL_BUF * 4);
  splFeat = fast(SPL_TROWS * 6 * 4); splRows = fast((SPL_TROWS + 2) * 2 * 4);
  uint32_t tot = 0;
  for (int t = 0; t < SPL_TPL_N; t++) { splBaseOff[t] = tot; tot += SPL_TPL_INFO[t * 3 + 2]; }
  splBaseTpl = (float *)ps_malloc(tot * 6 * 4);
  if (splBaseTpl) for (int t = 0; t < SPL_TPL_N; t++) {
    const int16_t *src = SPL_TPL_DATA + SPL_TPL_INFO[t * 3 + 1] * 6;
    for (int i = 0; i < SPL_TPL_INFO[t * 3 + 2] * 6; i++) splBaseTpl[splBaseOff[t] * 6 + i] = src[i] / SPL_TPL_SCALE;
  }
  splLoad();
}

void splListToApp() {
  char b[96];
  snprintf(b, sizeof(b), "spb=%u,%u,%u,%u", splBaseAct[0], splBaseAct[1], splBaseAct[2], splBaseAct[3]); notifyText(b); delay(15);
  for (int k = 0; k < SPL_CUSTOM; k++) if (splC[k].used) { snprintf(b, sizeof(b), "spc=%d,%u,%s", k, splC[k].act, splC[k].name); notifyText(b); delay(15); }
  notifyText("spc=end");
}

void splAct(uint8_t a) {
  switch (a) {
    case SA_TORCH:   openModule(M_TORCH); break;
    case SA_THEME:   theme = (theme + 1) % THEME_COUNT; prefs.putUChar("theme", theme); themePreviewUntil = millis() + 2500; toast(THEME_NAMES[theme], 900); break;
    case SA_NEXT:    mediaCmd(1); break;
    case SA_PLAY:    mediaCmd(0); break;
    case SA_LOVE:    openModule(M_EYES); setExpr(E_LOVE, 6000); break;
    case SA_WEATHER: openModule(M_WEATHER); break;
    case SA_CLOCK:   openModule(M_CLOCK); break;
    case SA_PET:     openModule(M_PET); petMood = min(100, petMood + 10); petHeartsUntil = millis() + 2500; break;
    case SA_DICE:    openModule(M_TOY); toySwitch(1); toyRoll(); break;
    case SA_CLAUDE:  openModule(M_CLAUDE); break;
    case SA_SPOTIFY: openModule(M_MUSIC); break;
    default: break;
  }
}

// a take has come in on the cast screen: recognise it (or, while teaching, learn from it)
void castRun() {
  if (!splSeg || !splBaseTpl) return;
  uint32_t t0 = millis();
  int n = spl_segment(recBuf, recLastN, REC_A_LSB, REC_G_LSB, splSeg);
  if (n < 8) { castKind = 99; castAt = millis(); return; }
  spl_input(splSeg, n, splIn);
  float emb[SPL_EMB]; spl_embed(splIn, emb, splA, splB);
  memcpy(castEmb, emb, sizeof(emb));
  uint32_t tEmb = millis() - t0;
  int fm = spl_dtw_feat(splSeg, min(n, SPL_TROWS * 2), splFeat);
  char b[128];

  if (teachSlot >= 0) {                                  // one more recording of the spell being taught
    SplCustom &c = splC[teachSlot];
    memcpy(teachEmb[teachN], emb, sizeof(emb));
    mapAdd(emb, 10 + teachSlot);
    memcpy(c.tpl[teachN], splFeat, fm * 24); c.rows[teachN] = fm;
    teachN++;
    snprintf(b, sizeof(b), "teach=%d,%u,%u", teachSlot, teachN, SPL_TEACH); notifyText(b);
    sfx(4);
    if (teachN >= SPL_TEACH) {
      float nrm = 0;
      for (int e = 0; e < SPL_EMB; e++) { float s = 0; for (int i = 0; i < SPL_TEACH; i++) s += teachEmb[i][e]; c.proto[e] = s; nrm += s * s; }
      nrm = sqrtf(nrm) + 1e-12f; for (int e = 0; e < SPL_EMB; e++) c.proto[e] /= nrm;
      float wm = 0;
      for (int i = 0; i < SPL_TEACH; i++) for (int j = i + 1; j < SPL_TEACH; j++) wm = max(wm, spl_dtw(c.tpl[i], c.rows[i], c.tpl[j], c.rows[j], splRows));
      c.wmax = wm; c.act = teachAct; memcpy(c.name, teachName, 17); c.used = true;
      bool ok = splSaveCustom(teachSlot);
      klog("spl: learnt %s", c.name);
      toast(ok ? "learnt!" : "not saved", 1200);
      snprintf(b, sizeof(b), "teach=%d,done", teachSlot); notifyText(b);
      teachSlot = -1;
      castKind = 10 + (&c - splC); castSim = 1; castAt = millis(); castActed = true;
    }
    return;
  }

  float sim[SPL_CLASSES];
  for (int c = 0; c < SPL_CLASSES; c++) sim[c] = spl_dot(emb, SPL_PROTO + c * SPL_EMB, SPL_EMB);
  // DTW: the nearest recording of each taught spell, and (only then needed) of the base spells
  int bestK = -1; float bestD = INFINITY, db = INFINITY;
  for (int k = 0; k < SPL_CUSTOM; k++) if (splC[k].used) {
    float d = INFINITY;
    for (int i = 0; i < SPL_TEACH; i++) d = min(d, spl_dtw(splFeat, fm, splC[k].tpl[i], splC[k].rows[i], splRows));
    if (d < bestD) { bestD = d; bestK = k; }
  }
  if (bestK >= 0) for (int t = 0; t < SPL_TPL_N; t++) db = min(db, spl_dtw(splFeat, fm, splBaseTpl + splBaseOff[t] * 6, SPL_TPL_INFO[t * 3 + 2], splRows));
  // the top three by fingerprint similarity (built-in spells and taught ones), for the readout
  struct { const char *n; float s; } top[SPL_CLASSES + SPL_CUSTOM]; int nt = 0;
  for (int c = 0; c < SPL_CLASSES; c++) top[nt++] = {SPL_NAMES[c], sim[c]};
  for (int k = 0; k < SPL_CUSTOM; k++) if (splC[k].used) top[nt++] = {splC[k].name, spl_dot(emb, splC[k].proto, SPL_EMB)};
  for (int i = 0; i < 3; i++) for (int j = i + 1; j < nt; j++) if (top[j].s > top[i].s) { auto t = top[i]; top[i] = top[j]; top[j] = t; }
  for (int i = 0; i < 3; i++) { snprintf(castTopBuf[i], 17, "%s", i < nt ? top[i].n : ""); castTopName[i] = castTopBuf[i]; castTop[i] = i < nt ? top[i].s : 0; }

  int8_t kind = 99; float s = 0; char how = 'c';
  if (bestK >= 0) {
    float sc = spl_dot(emb, splC[bestK].proto, SPL_EMB);
    if (bestD < db && bestD <= SPL_TEACH_SPREAD * splC[bestK].wmax && sc >= SPL_TEACH_MIN_SIM && !(sim[SPL_NONE] > sc)) { kind = 10 + bestK; s = sc; how = 'd'; }
  }
  if (kind == 99) {
    int c = 0; for (int i = 1; i < SPL_CLASSES; i++) if (sim[i] > sim[c]) c = i;
    if (c != SPL_NONE && sim[c] >= SPL_BASE_THR) { kind = c; s = sim[c]; } else s = sim[c];
  }
  castPower = castPowerOf(splSeg, n);
  mapAdd(emb, kind);
  castKind = kind; castSim = s; castAt = millis(); castMs = castAt - t0; castActed = false;
  castActNow = kind >= 10 ? splC[kind - 10].act : kind < 4 ? splBaseAct[kind] : SA_NONE;
  klog("spl: %s %.2f %lums", splName(kind), s, (unsigned long)castMs);
  Serial.printf("cast: network %lu ms (buffers %s); ", (unsigned long)tEmb, esp_ptr_internal(splA) ? "internal" : "psram");
  Serial.printf("cast: %s %.3f (%c) in %lu ms, %d rows; top %s %.3f, %s %.3f, %s %.3f; dtw base %.3f\n", splName(kind), s, how, (unsigned long)castMs, n,
                castTopName[0], castTop[0], castTopName[1], castTop[1], castTopName[2], castTop[2], db);
  sfx(kind == 99 ? 4 : 3);
  const MapStar &ms = mapStars[mapStarN - 1];
  snprintf(b, sizeof(b), "cast=%s,%.3f,%c,%u,%lu,%s,%.3f,%s,%.3f,%s,%.3f,%.2f,%.3f,%.3f", kind == 99 ? "-" : splName(kind), s, how, castActNow, (unsigned long)castMs,
           castTopName[0], castTop[0], castTopName[1], castTop[1], castTopName[2], castTop[2], castPower, ms.x, ms.y);
  if (bleConnected) notifyText(b);
}

void castPoll() {                                      // the effect plays, then the spell does its thing
  if (castBonusAt && millis() > castBonusAt) { castBonusAt = 0; mediaCmd(1); }      // an overcharged flick skips twice
  if (mode != M_CAST || castActed || millis() - castAt < 1500) return;
  castActed = true;
  if (castKind == 99 || castActNow == SA_NONE) return;
  bool over = castPower >= 0.8f;                         // overcharged: a little extra
  if (over && castActNow == SA_THEME) { theme = (theme + 1 + random(0, THEME_COUNT - 1)) % THEME_COUNT; prefs.putUChar("theme", theme); themePreviewUntil = millis() + 2500; toast(THEME_NAMES[theme], 900); return; }
  splAct(castActNow);
  if (over && castActNow == SA_NEXT) castBonusAt = millis() + 800;
  if (over && castActNow == SA_LOVE) { petHeartsUntil = millis() + 3000; petMood = min(100, petMood + 5); }
}

// ── the effects ──
void fxSparkles(int cx, int cy, int r, uint32_t t, uint16_t c) {
  for (int i = 0; i < 14; i++) {
    float a = i * 0.449f + t / 400.0f, rr = r * (0.6f + 0.5f * ((i * 37) % 10) / 10.0f) + t / 30.0f;
    if ((t / 80 + i) % 3) gfx->drawPixel(cx + (int)(cosf(a) * rr), cy + (int)(sinf(a) * rr), c);
    else sparkle(cx + (int)(cosf(a) * rr), cy + (int)(sinf(a) * rr), 2, c);
  }
}
void fxHeart(int cx, int cy, float sz, uint16_t c) {
  int lx = 0, ly = 0;
  for (int i = 0; i <= 64; i++) {
    float a = i / 64.0f * 6.2832f, x = -16 * powf(sinf(a), 3), y = 13 * cosf(a) - 5 * cosf(2 * a) - 2 * cosf(3 * a) - cosf(4 * a);
    int px = cx + (int)(x * sz), py = cy - (int)((y - 2) * sz);
    if (i) { gfx->drawLine(lx, ly, px, py, c); gfx->drawLine(lx + 1, ly, px + 1, py, c); }
    lx = px; ly = py;
  }
}
void castEffect(int x0, int y0, int w, int h, uint32_t t) {
  int cx = x0 + w / 2, cy = y0 + h / 2;
  float u = min(1.0f, t / 900.0f);
  switch (castKind) {
    case 0:                                         // circle: a ring of light opens
      for (int k = 0; k < 2 + (int)(castPower * 4); k++) gfx->drawCircle(cx, cy, (int)(u * (34 + 30 * castPower)) + k, mix565(COL_WHITE, ACC, k * 50));
      fxSparkles(cx, cy, (int)(u * (34 + 30 * castPower)), t, COL_WHITE);
      break;
    case 1: {                                       // zigzag: lightning
      if ((t / 70) % 4 == 0) gfx->fillRect(x0 + 1, y0 + 1, w - 2, h - 2, mix565(TTY_BG, COL_WHITE, 70));
      int bolts = 1 + (castPower > 0.45f) + (castPower > 0.8f);
      for (int bo = 0; bo < bolts; bo++) {
        int ox = (bo - (bolts - 1) / 2.0f) * 62, px = cx - 30 + ox, py = y0 + 6;
        for (int i = 1; i <= 6; i++) {
          int nx = cx + ox + ((i % 2) ? 28 : -24) - i * 2, ny = y0 + 6 + i * (h - 12) / 6;
          if (i <= (int)(u * 7)) for (int o = -1; o <= 1; o++) gfx->drawLine(px + o, py, nx + o, ny, o ? ACC : COL_WHITE);
          px = nx; py = ny;
        }
      }
      break;
    }
    case 2:                                         // flick: streaks fly off to the right
      for (int i = 0, ns = 5 + (int)(castPower * 8); i < ns; i++) {
        int y = y0 + 14 + i * (h - 28) / max(1, ns - 1), x = x0 + (int)((t / 2 + i * 41) % (w + 60)) - 40;
        gfx->drawFastHLine(max(x0 + 2, x - 30), y, 30, mix565(ACC, COL_WHITE, i * 25));
        textAt(">", min(x0 + w - 8, x), y - 3, 1, COL_WHITE);
      }
      break;
    case 3: {                                       // heart: a heart beats, little ones rise
      float beat = 1.0f + 0.12f * fabsf(sinf(t / 140.0f));
      fxHeart(cx, cy + 4, (1.6f + 1.2f * castPower) * u * beat, COL_PINK);
      for (int i = 0; i < 6; i++) { int hx = x0 + 20 + i * 36, hy = y0 + h - 10 - (int)((t / 6 + i * 23) % (h - 20)); textAt("\x03", hx, hy, 1, COL_PINK); }
      break;
    }
    case 99:                                        // fizzle: a puff of smoke
      for (int i = 0; i < 5; i++) textAt("~", cx - 30 + i * 13 + (int)(sinf(t / 200.0f + i) * 4), cy - (int)(t / 25) % 40 + (i % 2) * 8, 2, TTY_DIM);
      textAt("*poof*", cx - 36, cy + 22, 2, TTY_DIM);
      break;
    default:                                        // a spell you taught: your own stroke, lit up
      recStroke(x0, y0, w, h, COL_WHITE);
      fxSparkles(cx, cy, 40, t, ACC);
      break;
  }
}

void drawCast() {
  uint32_t now = millis();
  gfx->fillScreen(TTY_BG);
  char b[48];
  for (int i = 0; i < 4; i++) {                         // the views, like tmux windows: tap one
    int x = 14 + i * 36; bool on = i == wandView;
    if (on) gfx->fillRect(x, 1, 34, 11, ACC);
    textAt(WAND_TABS[i], x + (34 - (int)strlen(WAND_TABS[i]) * 6) / 2, 3, 1, on ? TTY_BG : ACC);
  }
  if (teachSlot >= 0) { snprintf(b, sizeof(b), "%u/%u", teachN, SPL_TEACH); textAt(b, 226 - (int)strlen(b) * 6, 3, 1, COL_AMBER); }
  else textAt("spl", 208, 3, 1, TTY_DIM);
  if (wandView != 0) {
    const int bx = 6, by = 18, bw = 228, bh = 200;
    ttyPane(bx, by, bw, bh, wandView == 1 ? "knob" : wandView == 2 ? "air --draw" : "fingerprints --map", recOn);
    if (wandView == 1) {
      drawKnob(bx, by, bw, bh);
      textAt(recOn ? "twist: clockwise = up" : "hold thumb, twist like a dial", 12, 226, 1, recOn ? ACC : TTY_TEXT);
      textAt("a quarter turn = 30%", 12, 238, 1, TTY_DIM);
    } else if (wandView == 2) {
      drawSketch(bx, by + 2);
      textAt(recOn ? "drawing... let go to lift the pen" : "hold thumb and draw in the air", 12, 226, 1, recOn ? ACC : TTY_TEXT);
      textAt("shake to wipe, the website keeps it", 12, 238, 1, TTY_DIM);
    } else {
      drawMap(bx, by, bw, bh);
      if (castKind >= 0 && mapStarN) { snprintf(b, sizeof(b), "> %s %.2f", splName(castKind), castSim); textAt(b, 12, 226, 1, castKind == 99 ? TTY_DIM : COL_WHITE); }
      else textAt("cast here: your fingerprint lands", 12, 226, 1, TTY_TEXT);
      textAt("32-d fingerprints, 2-d pca, no actions", 12, 238, 1, TTY_DIM);
    }
    textAt("pwr: exit", 12, 250, 1, TTY_DIM);
    return;
  }
  const int bx = 6, by = 20, bw = 228, bh = 140;
  bool fresh = castKind >= 0 && now - castAt < 2600;
  ttyPane(bx, by, bw, bh, recOn ? "stroke" : fresh ? "fx" : teachSlot >= 0 ? "teach" : "spellbook", recOn || fresh);
  if (recOn) recStroke(bx, by, bw, bh, COL_RED);
  else if (fresh) { recStroke(bx, by, bw, bh, ACC_LOW); castEffect(bx, by, bw, bh, now - castAt); }
  else if (teachSlot >= 0) {
    textAt(teachName, bx + 12, by + 14, 2, COL_WHITE);
    snprintf(b, sizeof(b), "does: %s", SA_NAMES[teachAct]); textAt(b, bx + 12, by + 36, 1, TTY_DIM);
    for (int i = 0; i < SPL_TEACH; i++) {
      gfx->drawRect(bx + 14 + i * 40, by + 60, 32, 32, ACC);
      if (i < teachN) gfx->fillRect(bx + 18 + i * 40, by + 64, 24, 24, ACC);
    }
    textAt("draw it the same way 5x", bx + 12, by + 104, 1, TTY_TEXT);
  } else {
    int y = by + 10;
    const char *how[4] = {"one loop, clockwise", "three sharp peaks", "a quick snap right", "one stroke heart"};
    for (int i = 0; i < 4; i++, y += 20) {
      textAt(SPL_NAMES[i], bx + 10, y, 1, ACC); textAt(how[i], bx + 62, y, 1, TTY_DIM);
      snprintf(b, sizeof(b), "> %s", SA_NAMES[splBaseAct[i]]); textAt(b, bx + 62, y + 9, 1, TTY_TEXT);
    }
    int nc = 0;
    for (int k = 0; k < SPL_CUSTOM && y < by + bh - 12; k++) if (splC[k].used) {
      snprintf(b, sizeof(b), "%s > %s", splC[k].name, SA_NAMES[splC[k].act]); textAt(b, bx + 10, y, 1, COL_LIME); y += 11; nc++;
    }
    if (!nc && y < by + bh - 12) textAt("teach your own: spells tab", bx + 10, y + 2, 1, TTY_DIM);
  }

  // the readout: what the network thinks
  int ry = 168;
  if (castKind >= 0 && !recOn) {
    for (int i = 0; i < 3; i++) {
      if (!castTopName[i] || !castTopName[i][0]) continue;
      float s = max(0.0f, castTop[i]);
      textAt(i == 0 ? ">" : " ", 10, ry + i * 11, 1, ACC);
      textAt(String(castTopName[i]).substring(0, 9), 18, ry + i * 11, 1, i == 0 ? COL_WHITE : TTY_TEXT);
      snprintf(b, sizeof(b), "%.2f", castTop[i]); textAt(b, 78, ry + i * 11, 1, TTY_DIM);
      textAt(asciiBar(s, 18, '#', '#', '.'), 108, ry + i * 11, 1, i == 0 ? ACC : ACC_DIM);
    }
    String word = castKind == 99 ? String("fizzle") : castKind < 4 ? String(SPL_WORD[castKind]) + "!" : String(splName(castKind)) + "!";
    word.toUpperCase();
    textAt(word, 12, 206, 2, castKind == 99 ? TTY_DIM : ACC);
    if (castKind != 99) {                                 // how hard it was cast
      int pw = 6 + (int)(castPower * 10); for (int i = 0; i < 16; i++) gfx->fillRect(150 + i * 5, 210, 4, 7, i < pw ? (castPower >= 0.8f ? COL_AMBER : ACC) : ACC_LOW);
      textAt(castPower >= 0.8f ? "overcharged" : "power", 150, 200, 1, castPower >= 0.8f ? COL_AMBER : TTY_DIM);
    }
    if (castKind != 99) { snprintf(b, sizeof(b), "-> %s  (%lums)", SA_NAMES[castActNow], (unsigned long)castMs); textAt(b, 12, 226, 1, TTY_TEXT); }
    else textAt("no match. draw it bigger?", 12, 226, 1, TTY_DIM);
  } else if (recOn) {
    if ((now / 300) % 2) gfx->fillCircle(17, ry + 4, 4, COL_RED);
    snprintf(b, sizeof(b), "casting %.1fs", (now - recStartAt) / 1000.0f); textAt(b, 26, ry, 2, COL_RED);
    textAt("let go to cast", 12, ry + 22, 1, TTY_DIM);
  } else {
    textAt(teachSlot >= 0 ? "hold thumb, draw, let go" : "hold thumb, draw a spell,", 12, ry, 1, TTY_TEXT);
    if (teachSlot < 0) textAt("let go", 12, ry + 11, 1, TTY_TEXT);
    if ((now / 500) % 2) gfx->fillRect(teachSlot >= 0 ? 160 : 52, teachSlot >= 0 ? ry - 1 : ry + 10, 6, 9, ACC);
    textAt("still 0.5s, draw, still 0.5s", 12, ry + 30, 1, TTY_DIM);
  }
  textAt("pwr: exit", 12, 246, 1, TTY_DIM);
  textAt("1d cnn, 39k", 160, 246, 1, TTY_DIM);
}
