// Desktop preview: runs the firmware's own Cotton drawing code against a stub framebuffer and writes PPM images.
// Build: python3 extract.py ../../LarpCharm/LarpCharm.ino extracted.inc && c++ -std=c++17 -O2 -I../../LarpCharm -o preview preview.cpp && ./preview
#include <cstdint>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <ctime>
#define PROGMEM
template <class A, class B> static inline auto max(A a, B b) -> decltype(a + b) { return a > b ? a : b; }
template <class A, class B> static inline auto min(A a, B b) -> decltype(a + b) { return a < b ? a : b; }
#define constrain(v, lo, hi) ((v) < (lo) ? (lo) : ((v) > (hi) ? (hi) : (v)))

struct String {
  std::string s;
  String() {}
  String(const char *c) : s(c ? c : "") {}
  String(const char *c, size_t n) : s(c, n) {}
  String(const std::string &x) : s(x) {}
  String(int v) : s(std::to_string(v)) {}
  size_t length() const { return s.size(); }
  void reserve(size_t n) { s.reserve(n); }
  const char *c_str() const { return s.c_str(); }
  char operator[](size_t i) const { return i < s.size() ? s[i] : 0; }
  String substring(size_t a) const { return a >= s.size() ? String() : String(s.substr(a)); }
  String substring(size_t a, size_t b) const { if (a >= s.size()) return String(); if (b > s.size()) b = s.size(); return b > a ? String(s.substr(a, b - a)) : String(); }
  void trim() { size_t a = s.find_first_not_of(" \t\n"), b = s.find_last_not_of(" \t\n"); s = a == std::string::npos ? "" : s.substr(a, b - a + 1); }
  String &operator+=(char c) { s += c; return *this; }
  String &operator+=(const String &o) { s += o.s; return *this; }
  String operator+(const String &o) const { return String(s + o.s); }
  String operator+(const char *o) const { return String(s + o); }
  friend String operator+(const char *a, const String &b) { return String(std::string(a) + b.s); }
};

#define SCR_W 240
#define SCR_H 280
#define FB_BYTES (SCR_W * SCR_H * 2)
uint16_t fbMem[SCR_W * SCR_H], homeMem[SCR_W * SCR_H], prevMem[SCR_W * SCR_H], bgMem[SCR_W * SCR_H];
uint16_t *FB = fbMem, *homeBase = homeMem, *prevFb = prevMem, *aeroBg = bgMem;
int8_t aeroBuilt = -1, homeBaseVar = -1;

static inline void px(int x, int y, uint16_t c) { if ((unsigned)x < SCR_W && (unsigned)y < SCR_H) FB[y * SCR_W + x] = c; }
struct Gfx {
  void drawPixel(int x, int y, uint16_t c) { px(x, y, c); }
  void drawFastHLine(int x, int y, int w, uint16_t c) { for (int i = 0; i < w; i++) px(x + i, y, c); }
  void drawFastVLine(int x, int y, int h, uint16_t c) { for (int i = 0; i < h; i++) px(x, y + i, c); }
  void fillRect(int x, int y, int w, int h, uint16_t c) { for (int j = 0; j < h; j++) drawFastHLine(x, y + j, w, c); }
  void fillScreen(uint16_t c) { fillRect(0, 0, SCR_W, SCR_H, c); }
  void drawLine(int x0, int y0, int x1, int y1, uint16_t c) {
    int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) { px(x0, y0, c); if (x0 == x1 && y0 == y1) break; int e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  void fillCircle(int cx, int cy, int r, uint16_t c) { for (int y = -r; y <= r; y++) for (int x = -r; x <= r; x++) if (x * x + y * y <= r * r) px(cx + x, cy + y, c); }
  void drawCircle(int cx, int cy, int r, uint16_t c) { for (int y = -r; y <= r; y++) for (int x = -r; x <= r; x++) { int d = x * x + y * y; if (d <= r * r && d > (r - 1) * (r - 1)) px(cx + x, cy + y, c); } }
  void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint16_t c) {
    int minx = min(x0, min(x1, x2)), maxx = max(x0, max(x1, x2)), miny = min(y0, min(y1, y2)), maxy = max(y0, max(y1, y2));
    for (int y = miny; y <= maxy; y++) for (int x = minx; x <= maxx; x++) {
      int w0 = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0), w1 = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1), w2 = (x0 - x2) * (y - y2) - (y0 - y2) * (x - x2);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) px(x, y, c);
    }
  }
  void fillRoundRect(int x, int y, int w, int h, int r, uint16_t c) { fillRect(x, y, w, h, c); (void)r; }
  void drawRoundRect(int x, int y, int w, int h, int r, uint16_t c) { drawFastHLine(x, y, w, c); drawFastHLine(x, y + h - 1, w, c); drawFastVLine(x, y, h, c); drawFastVLine(x + w - 1, y, h, c); (void)r; }
  void flush() {}
} gfxObj, *gfx = &gfxObj;

uint32_t nowMs = 100000;
uint32_t millis() { return nowMs; }
long random(long a, long b) { return a + rand() % (b - a); }
struct Prefs {
  size_t getBytes(const char *, void *, size_t) { return 0; }
  String getString(const char *, const String &d) { return d; }
  void putBytes(const char *, const void *, size_t) {}
  void putString(const char *, const String &) {}
} prefs;
void sfx(uint8_t) {}
void sendStatus(const char *) {}
void openModule(int) {}
void toast(const String &, uint32_t) {}

enum Mode : uint8_t { M_CLOCK = 0, M_TEXT, M_PHOTO, M_SING, M_MUSIC, M_PET, M_TOY, M_CARD, M_DECK, M_EYES, M_JUKE, M_TORCH, M_CHARGE, M_BIO, M_COUNT };
#define SKIN_AERO 1
#define SKIN_COTTON 4
uint8_t skin = SKIN_COTTON, aeroVar = 0, mode = M_DECK;
static inline uint8_t aeroPal() { return skin == SKIN_COTTON ? 3 : aeroVar % 3; }
bool use24h = false, charging = false, bleConnected = true, sleeping = false;
int batPct = 76;
uint32_t lastInteraction = 100000, frameNo = 7;
bool localNow(struct tm &t) { time_t e = 1763224920; gmtime_r(&e, &t); return true; }   // a fixed Saturday afternoon

#include "aafonts.h"
#include "extracted.inc"

void save(const char *name) {
  FILE *f = fopen(name, "wb");
  fprintf(f, "P6\n%d %d\n255\n", SCR_W, SCR_H);
  for (int i = 0; i < SCR_W * SCR_H; i++) { uint16_t c = FB[i]; uint8_t rgb[3] = { r8(c), g8(c), b8(c) }; fwrite(rgb, 1, 3, f); }
  fclose(f);
}

int main() {
  ctName = "Momo"; ctPron = "she/her"; ctBio = "builder of tiny glowing things. coffee first, then code. say hi if you see this charm!";
  ctLikes = "matcha,cats,pixel art,rainy days,lofi";
  char fn[64];
  for (int m = 0; m < CT_MOODS; m++) {
    ct.mood = m; ct.stat = m % CT_STATS; ct.acc = m % CT_ACCS; ct.hair = m % CT_HAIRS; ct.hcol = (m * 3) % CT_HCOLS; ct.outfit = m % CT_OUTFITS; ct.tone = m % CT_TONES;
    nowMs = 100000 + m * 777; lastInteraction = nowMs; ctNextAct = nowMs + 99999;
    drawCottonHome(); snprintf(fn, sizeof(fn), "home_%d.ppm", m); save(fn);
  }
  ct = {0, 2, 1, 0, 1, 0, 1, 0};
  nowMs = 300000; lastInteraction = nowMs; ctSay = "you got this!"; ctSayUntil = nowMs + 5000; ctWaveAt = nowMs - 300;
  drawCottonHome(); save("home_say.ppm");
  ctSayUntil = 0;
  lastInteraction = nowMs - 20000;                       // doze
  for (int i = 0; i < 80; i++) { nowMs += 33; drawCottonHome(); }
  save("home_doze.ppm");
  lastInteraction = nowMs; ctDozing = false; ctDozeT = 0; ctDrawer = true;
  for (int i = 0; i < 30; i++) { nowMs += 33; lastInteraction = nowMs; drawCottonHome(); }
  save("home_drawer.ppm");
  ctDrawer = false; ctDrawerT = 0;
  ctBioDirty = true; drawBio(); save("bio.ppm");
  ctName = "Sakura Mochi"; ctPron = ""; ct.stat = CT_STATS; ctCustom = "at the library"; ct.statCol = 2; ct.hair = 2; ct.acc = 4; ct.mood = 2;
  ctBioDirty = true; drawBio(); save("bio2.ppm");
  return 0;
}
