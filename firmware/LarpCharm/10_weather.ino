// Larp Charm firmware: Weather: curl wttr.in, with ASCII-art skies and a critter dressed for them.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v8.9: weather, as curl wttr.in ═════════════
// The web app looks the weather up (Open-Meteo) for a place you pick and sends it over Bluetooth.
// The screen is `curl wttr.in` on the charm: ASCII-art weather and a little ASCII critter dressed for it.
enum WxCond : uint8_t { WX_CLEAR, WX_PARTLY, WX_CLOUDY, WX_FOG, WX_DRIZZLE, WX_RAIN, WX_SNOW, WX_THUNDER };
const char *WX_NAME[8] = {"clear", "partly cloudy", "cloudy", "fog", "drizzle", "rain", "snow", "thunderstorm"};
struct Wx {
  bool have = false, isDay = true, fahr = false;
  uint8_t cond = WX_CLEAR, hum = 0, wind = 0, rain = 0, hn = 0;
  int8_t t = 0, feels = 0, hi = 0, lo = 0;
  uint8_t hHour[4] = {0}, hCond[4] = {0};
  int8_t hT[4] = {0};
  char place[24] = "";
  uint32_t at = 0;
} wx;
uint32_t wxSayUntil = 0, wxHopAt = 0, wxSpinUntil = 0;
const char *wxSay = "";

// ── data from the web app: [cond][day][t][feels][hi][lo][hum][wind][rain%][fahr][n] n*[hour][cond][t] place ──
void wxPacket(const uint8_t *p, uint16_t len) {
  if (len < 11) return;
  wx.cond = p[0] % 8; wx.isDay = p[1]; wx.t = (int8_t)p[2]; wx.feels = (int8_t)p[3]; wx.hi = (int8_t)p[4]; wx.lo = (int8_t)p[5];
  wx.hum = p[6]; wx.wind = p[7]; wx.rain = p[8]; wx.fahr = p[9]; wx.hn = min(4, (int)p[10]);
  int o = 11;
  for (int i = 0; i < wx.hn && o + 2 < len; i++, o += 3) { wx.hHour[i] = p[o]; wx.hCond[i] = p[o + 1] % 8; wx.hT[i] = (int8_t)p[o + 2]; }
  String place = o < len ? asciiOnly(String((const char *)(p + o), len - o)) : String("");
  snprintf(wx.place, sizeof(wx.place), "%s", place.c_str());
  wx.have = true; wx.at = millis();
  prefs.putBytes("wx", &wx, sizeof(wx));
  klog("wx: %d%c %s, %s", wx.t, wx.fahr ? 'F' : 'C', WX_NAME[wx.cond], wx.place);
}
void wxLoad() { Wx w; if (prefs.getBytes("wx", &w, sizeof(w)) == sizeof(w) && w.have) { wx = w; wx.at = 0; } }
int wxCelsius(int t) { return wx.fahr ? (t - 32) * 5 / 9 : t; }

void wxDeg(int x, int y, int r, uint16_t c) { gfx->drawCircle(x, y, r, c); if (r > 1) gfx->drawCircle(x, y, r - 1, c); }

// ── the screen: `curl wttr.in` on the charm ──
// An ASCII-art sprite for the sky (the rays turn, rain and snow fall, fog drifts, lightning flashes), the
// readout beside it, a little ASCII critter dressed for the weather, and the next few hours in a table.
// The same sprites are in charm.js, so the website's preview matches.
const char *const WXS_TXT[9][5] = {
  {"    \\   /    ", "     .-.     ", "  -- (   ) --", "     `-'     ", "    /   \\    "},   // SUN_A
  {"      .      ", "   \\ .-. /   ", "  - (   ) -  ", "   / `-' \\   ", "      '      "},   // SUN_B
  {"  .     .--. ", "       /  .' ", "   *  |  (   ", "       \\  '. ", " .      '--' "},   // MOON
  {"   \\  /      ", " _ /\"\".-.    ", "   \\_(   ).  ", "   /(___(__) ", "             "},   // PARTLY
  {"  *    .     ", "   (  .-.    ", "    \\(   ).  ", "    (___(__) ", "             "},   // PARTLYN
  {"             ", "     .--.    ", "  .-(    ).  ", " (___.__)__) ", "             "},   // CLOUDY
  {"             ", " _ - _ - _ - ", "  _ - _ - _  ", " _ - _ - _ - ", "             "},   // FOG
  {"     .-.     ", "    (   ).   ", "   (___(__)  ", "             ", "             "},   // CLOUD
  {"    .-.      ", "     __)     ", "    (        ", "     `-'     ", "      *      "},   // UNKNOWN
};
const char *const WXS_MASK[9][5] = {
  {"    y   y    ", "     yyy     ", "  yy yyyyy yy", "     yyy     ", "    y   y    "},
  {"      y      ", "   y yyy y   ", "  y yyyyy y  ", "   y yyy y   ", "      y      "},
  {"  d     mmmm ", "       m  mm ", "   d  m  m   ", "       m  mm ", " d      mmmm "},
  {"   y  y      ", " y yyywww    ", "   yywwwwww  ", "   ywwwwwwww ", "             "},
  {"  d    d     ", "   m  www    ", "    mwwwwww  ", "    wwwwwwww ", "             "},
  {"             ", "     wwww    ", "  ggwwwwwww  ", " wwwwwwwwggg ", "             "},
  {"             ", " f f f f f f ", "  f f f f f  ", " f f f f f f ", "             "},
  {"     www     ", "    wwwwww   ", "   wwwwwwww  ", "             ", "             "},
  {"    www      ", "     www     ", "    w        ", "     www     ", "      y      "},
};
enum { WXS_SUN_A, WXS_SUN_B, WXS_MOON, WXS_PARTLY, WXS_PARTLYN, WXS_CLOUDY, WXS_FOG, WXS_CLOUD, WXS_UNKNOWN };
uint16_t wxCol(char k) {
  switch (k) {
    case 'y': return c565(255, 206, 60);
    case 'w': return c565(226, 232, 242);
    case 'g': return c565(140, 148, 168);
    case 'b': return c565(90, 170, 255);
    case 's': return c565(240, 248, 255);
    case 'm': return c565(240, 236, 200);
    case 'o': return c565(255, 230, 90);
    case 'f': return c565(170, 176, 190);
    case 'd': return c565(120, 130, 150);
    case 'r': return c565(255, 96, 120);
    case 't': return c565(232, 190, 120);
    default: return COL_WHITE;
  }
}
uint32_t wxOpenAt = 0;
#define WX_TYPE_MS 22

static void wxGlyph(char ch, int x, int y, int sz, uint16_t c) { char s[2] = {ch, 0}; textAt(s, x, y, sz, c); }

bool wxFlash(uint32_t now) { uint32_t k = now % 2600; return k < 140 || (k > 230 && k < 300); }

// one sprite, with `cloud` standing in for the cloud colour (grey for rain), stars twinkling
void wxSprite(int k, int x, int y, int sz, uint32_t now, char cloud, int rowShift = 0) {
  for (int r = 0; r < 5; r++) {
    int dx = rowShift ? (int)(sinf(now / 900.0f + r * 1.3f) * rowShift) : 0;
    for (int c = 0; c < 13; c++) {
      char ch = WXS_TXT[k][r][c], m = WXS_MASK[k][r][c];
      if (ch == ' ') continue;
      if (m == 'w') m = cloud;
      if (m == 'd' && ((now / 600 + c + r) & 1)) m = 's';
      wxGlyph(ch, x + c * 6 * sz + dx, y + r * 8 * sz, sz, wxCol(m));
    }
  }
}

// the rain, drizzle, snow or storm under the cloud
void wxPrecip(uint8_t cond, int x, int y, int sz, uint32_t now) {
  int cw = 6 * sz, rh = 8 * sz;
  for (int r = 3; r <= 4; r++) for (int c = 3; c <= 10; c++) {
    char ch = 0; char col = 'b';
    if (cond == WX_SNOW) { int ph = now / 420; if ((c + r * 2 + ph) % 3 == 0) { ch = '*'; col = 's'; } }
    else if (cond == WX_DRIZZLE) { int ph = now / 260; if ((c + r * 2 + ph) % 4 == 0) ch = '\''; }
    else { int ph = now / 180; if ((c + r + ph) % 2 == 0) ch = ((c + ph) & 1) ? ',' : '\''; }
    if (cond == WX_THUNDER && c >= 5 && c <= 8) ch = 0;
    if (ch) wxGlyph(ch, x + c * cw, y + r * rh, sz, wxCol(col));
  }
  if (cond == WX_THUNDER) {
    uint16_t bc = wxFlash(now) ? wxCol('o') : c565(120, 100, 40);
    wxGlyph('_', x + 6 * cw, y + 3 * rh - 4, sz, bc); wxGlyph('/', x + 7 * cw, y + 3 * rh, sz, bc);
    wxGlyph('/', x + 6 * cw, y + 4 * rh, sz, bc);
  }
}

// the big sprite for a sky
void wxBigIcon(uint8_t cond, bool day, int x, int y, int sz, uint32_t now) {
  if (!wx.have) { wxSprite(WXS_UNKNOWN, x, y, sz, now, 'w'); return; }
  int drift = (int)(sinf(now / 1400.0f) * 3);
  switch (cond) {
    case WX_CLEAR:  wxSprite(day ? ((now / 700) % 2 ? WXS_SUN_B : WXS_SUN_A) : WXS_MOON, x, y, sz, now, 'w'); break;
    case WX_PARTLY: wxSprite(day ? WXS_PARTLY : WXS_PARTLYN, x + drift, y, sz, now, 'w'); break;
    case WX_CLOUDY: wxSprite(WXS_CLOUDY, x + drift, y, sz, now, 'w'); break;
    case WX_FOG:    wxSprite(WXS_FOG, x, y, sz, now, 'w', 5); break;
    default: {
      bool dark = cond == WX_RAIN || cond == WX_THUNDER;
      wxSprite(WXS_CLOUD, x + drift, y, sz, now, cond == WX_THUNDER && wxFlash(now) ? 's' : dark ? 'g' : 'w');
      wxPrecip(cond, x, y, sz, now);
    }
  }
}

// a three-character sprite for the forecast table
void wxMini(uint8_t cond, bool day, int cx, int y) {
  const char *s = "???", *m = "www";
  switch (cond) {
    case WX_CLEAR:   if (day) { s = "-\x0F-"; m = "yyy"; } else { s = ".)."; m = "dmd"; } break;
    case WX_PARTLY:  if (day) { s = "\x0F~~"; m = "yww"; } else { s = ")~~"; m = "mww"; } break;
    case WX_CLOUDY:  s = "~~~"; m = "www"; break;
    case WX_FOG:     s = "=-="; m = "fff"; break;
    case WX_DRIZZLE: s = "'.'"; m = "bbb"; break;
    case WX_RAIN:    s = ",',"; m = "bbb"; break;
    case WX_SNOW:    s = "*.*"; m = "sss"; break;
    case WX_THUNDER: s = "'/'"; m = "bob"; break;
  }
  for (int i = 0; i < 3; i++) wxGlyph(s[i], cx - 9 + i * 6, y, 1, wxCol(m[i]));
}

// The critter: a kaomoji dressed for the weather. Tap: it hops and says something. Shake: dizzy.
void wxCritter(uint32_t now, int x, int y) {
  const char *t1 = "", *t2 = "", *face = "(^_^)";
  char c1 = 'w', c2 = 'w';
  int tc = wxCelsius(wx.t);
  bool day = !wx.have || wx.isDay;
  if (!wx.have) { t2 = "  ?  "; c2 = 'd'; face = "(o_o)"; }
  else switch (wx.cond) {
    case WX_DRIZZLE: case WX_RAIN: t1 = "/^^^\\"; c1 = 'b'; t2 = "  |  "; face = "(._.)"; break;
    case WX_THUNDER: t1 = "/^^^\\"; c1 = 'b'; t2 = "  |  "; face = "(O_O)"; break;
    case WX_SNOW:    t1 = " .*. "; c1 = 'r'; t2 = "/___\\"; c2 = 'r'; face = "(^o^)"; break;
    case WX_FOG:     t2 = "  ?  "; c2 = 'd'; face = "(o_o)"; break;
    case WX_CLOUDY:  face = "(-_-)"; break;
    default:
      if (day) { t1 = " ___ "; t2 = "/___\\"; c1 = c2 = 't'; face = tc >= 28 ? "(^_^;)" : tc < 5 ? "(>_<)" : "(^_^)"; }
      else { bool f = (now / 700) % 2; t1 = f ? "   z " : "    z"; t2 = f ? "  z  " : "   z "; c1 = c2 = 'd'; face = "(-_-)"; }
  }
  if (now < wxSpinUntil) face = "(@_@)";
  char fb[8]; snprintf(fb, sizeof(fb), "%s", face);
  if (now % 3200 < 140 && fb[1] != '-' && strlen(fb) >= 5) { fb[1] = '-'; fb[3] = '-'; }
  int jx = 0, jy = 0;
  if (now < wxSpinUntil) jx = (int)(sinf(now / 60.0f) * 3);
  else if (wx.have && tc < 5 && wx.cond != WX_SNOW) jx = (frameNo & 1) ? 1 : -1;      // shivering
  uint32_t ht = now - wxHopAt;
  if (wxHopAt && ht < 500) jy = -(int)(sinf(ht / 500.0f * 3.1416f) * 10);
  textAt(t1, x + jx, y + jy, 2, wxCol(c1));
  textAt(t2, x + jx, y + 16 + jy, 2, wxCol(c2));
  textAt(fb, x + jx, y + 32 + jy, 2, COL_WHITE);
  const char *g = "____________"; char gc = 'd';
  if (wx.have && (wx.cond == WX_RAIN || wx.cond == WX_DRIZZLE || wx.cond == WX_THUNDER)) { g = (now / 500) % 2 ? "~-~-~-~-~-~-" : "-~-~-~-~-~-~"; gc = 'b'; }
  else if (wx.have && wx.cond == WX_SNOW) { g = "*.**.*.**.*."; gc = 's'; }
  textAt(g, x - 2, y + 50, 1, wxCol(gc));
}

void drawWeather() {
  uint32_t now = millis();
  gfx->fillScreen(TTY_BG);
  char b[48];

  // $ curl wttr.in/<place>, typed out when the screen opens
  String slug = String(wx.have ? wx.place : "here"); slug.toLowerCase(); slug.replace(' ', '+');
  if (slug.length() > 20) slug = slug.substring(0, 20);
  String cmd = "curl wttr.in/" + slug;
  int typed = wxOpenAt ? min((int)cmd.length(), (int)((now - wxOpenAt) / WX_TYPE_MS)) : cmd.length();
  textAt("$", 14, 3, 1, ACC);
  textAt(cmd.substring(0, min(typed, 13)), 26, 3, 1, COL_WHITE);
  if (typed > 13) textAt(cmd.substring(13, typed), 26 + 13 * 6, 3, 1, ACC);
  if (typed < (int)cmd.length()) { gfx->fillRect(26 + typed * 6, 2, 6, 9, ACC); return; }
  if (wxOpenAt && now - wxOpenAt < cmd.length() * WX_TYPE_MS + 160) return;      // a beat while it "fetches"

  textAt("Weather report:", 14, 15, 1, TTY_DIM);
  textAt(wx.have ? String(wx.place).substring(0, 19) : String("unknown"), 14 + 16 * 6, 15, 1, TTY_TEXT);

  bool day = !wx.have || wx.isDay;
  wxBigIcon(wx.cond, day, 6, 30, 2, now);

  // temperature and the day's range, beside the sprite
  if (wx.have) {
    snprintf(b, sizeof(b), "%d", wx.t);
    int n = strlen(b), sz = n <= 2 ? 3 : 2;
    textAt(b, 170, 34, sz, COL_WHITE);
    int ex = 170 + n * 6 * sz;
    wxDeg(ex + 4, 37, 2, COL_WHITE);
    textAt(wx.fahr ? "F" : "C", ex + 8, 34, 2, COL_WHITE);
    snprintf(b, sizeof(b), "H %d", wx.hi); textAt(b, 172, 66, 1, TTY_TEXT);
    snprintf(b, sizeof(b), "L %d", wx.lo); textAt(b, 172, 78, 1, TTY_TEXT);
    textAt(day ? "day" : "night", 172, 90, 1, TTY_DIM);
  } else textAt("--", 170, 34, 3, TTY_DIM);

  // the sky, in words
  String name = wx.have ? String(WX_NAME[wx.cond]) : String("no data");
  textAt(name, 10, 114, 2, COL_WHITE);

  // ls -l style readout
  const char *lab[4] = {"feels", "wind", "hum", "rain"};
  for (int i = 0; i < 4; i++) {
    int y = 140 + i * 12;
    textAt(lab[i], 10, y, 1, TTY_DIM);
    if (!wx.have) { textAt("--", 52, y, 1, TTY_DIM); continue; }
    if (i == 0) snprintf(b, sizeof(b), "%d%c", wx.feels, wx.fahr ? 'F' : 'C');
    else if (i == 1) snprintf(b, sizeof(b), "%u km/h", wx.wind);
    else if (i == 2) snprintf(b, sizeof(b), "%u%%", wx.hum);
    else snprintf(b, sizeof(b), "%u%%", wx.rain);
    textAt(b, 52, y, 1, i == 3 && wx.rain >= 50 ? wxCol('b') : TTY_TEXT);
  }

  wxCritter(now, 164, 132);

  // the next hours, as a table
  const int tx = 9, ty = 196, cw = 55, th = 42;
  gfx->drawRect(tx, ty, cw * 4 + 1, th, ACC_DIM);
  gfx->drawFastHLine(tx, ty + 14, cw * 4 + 1, ACC_DIM);
  for (int k = 1; k < 4; k++) gfx->drawFastVLine(tx + k * cw, ty, th, ACC_DIM);
  if (wx.have && wx.hn) {
    for (int i = 0; i < 4; i++) {
      int cx = tx + i * cw + cw / 2;
      if (i >= wx.hn) { textAt("-", cx - 3, ty + 4, 1, TTY_DIM); continue; }
      snprintf(b, sizeof(b), "%02uh", wx.hHour[i]); textAt(b, cx - 9, ty + 4, 1, ACC);
      wxMini(wx.hCond[i], wx.hHour[i] >= 6 && wx.hHour[i] < 19, cx, ty + 18);
      snprintf(b, sizeof(b), "%d", wx.hT[i]);
      int w = strlen(b) * 6;
      textAt(b, cx - (w + 4) / 2, ty + 29, 1, COL_WHITE);
      gfx->drawRect(cx - (w + 4) / 2 + w + 1, ty + 29, 2, 2, COL_WHITE);
    }
  } else textAt(wx.have ? "no forecast" : "set a place: app > weather", tx + 6, ty + 4, 1, TTY_DIM);

  // a prompt waiting at the bottom
  textAt("$", 14, 248, 1, ACC);
  if ((now / 500) % 2) gfx->fillRect(26, 247, 6, 9, ACC);
  if (wx.have) {
    if (wx.at) { unsigned long m = (now - wx.at) / 60000; snprintf(b, sizeof(b), m ? "%lum ago" : "just now", m); }
    else snprintf(b, sizeof(b), "cached");
    textAt(b, 226 - (int)strlen(b) * 6, 248, 1, TTY_DIM);
  }

  // what the critter has to say, cowsay style
  if (now < wxSayUntil) {
    int w = strlen(wxSay) * 6 + 12, x = max(6, 156 - w), y = 136;
    gfx->fillRect(x, y, w, 19, TTY_BG);
    gfx->drawRect(x, y, w, 19, ACC);
    textAt(wxSay, x + 6, y + 6, 1, COL_WHITE);
    gfx->drawLine(x + w, y + 10, 166, y + 30, ACC);
  }
}
// What the charm is showing, sent to the web app when it connects so its preview mirrors the real screen:
// the weather, the pet, the message and the ID card (each kept on the charm, maybe sent from another browser).
void shareScreens() {
  char b[512];
  if (wx.have) {
    int n = snprintf(b, sizeof(b), "wx=%u,%u,%d,%d,%d,%d,%u,%u,%u,%u|", wx.cond, wx.isDay, wx.t, wx.feels, wx.hi, wx.lo, wx.hum, wx.wind, wx.rain, wx.fahr);
    for (int i = 0; i < wx.hn; i++) n += snprintf(b + n, sizeof(b) - n, "%s%u.%u.%d", i ? "," : "", wx.hHour[i], wx.hCond[i], wx.hT[i]);
    snprintf(b + n, sizeof(b) - n, "|%s", wx.place);
    notifyText(b); delay(20);
  }
  snprintf(b, sizeof(b), "pet=%u,%u\x1F%s", petSpecies, petColor, asciiOnly(petName).c_str()); notifyText(b); delay(20);
  snprintf(b, sizeof(b), "card=%u\x1F%s\x1F%s", cardAccent, asciiOnly(cardName).c_str(), asciiOnly(cardSub).c_str()); notifyText(b); delay(20);
  snprintf(b, sizeof(b), "motd=%u,%u,%u\x1F%s", textStyle, textFg, textBg, asciiOnly(textMsg).substring(0, 400).c_str()); notifyText(b);
}
void wxTap() {
  int tc = wxCelsius(wx.t);
  bool day = !wx.have || wx.isDay;
  wxSay = !wx.have ? "eh? where am i?" : wx.cond == WX_THUNDER ? "kaminari!! eek" : wx.cond == WX_RAIN || wx.cond == WX_DRIZZLE ? "ame da~ puddles!" :
          wx.cond == WX_SNOW ? "yuki da!! snowball!" : wx.cond == WX_FOG ? "kiri... can't see" : !day ? "oyasumi~ zzz" :
          tc >= 28 ? "atsui~ so hot" : tc < 5 ? "samui! brrr" : wx.cond == WX_CLOUDY ? "kumori... meh" : "ii tenki da!";
  wxSayUntil = millis() + 2200; wxHopAt = millis(); sfx(4);
}
void wxShake() { wxSpinUntil = millis() + 1200; wxSay = "waaa~"; wxSayUntil = millis() + 1200; sfx(3); }
