// Larp Charm firmware: Games: the oracle, dice and coin, tic-tac-toe, rock-paper-scissors, a reflex test.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── RNG: oracle (8-ball), dice, coin ─────────────
const char *EIGHT[] = {"yes!", "no.", "maybe", "ask\nlater", "for\nsure", "nope", "do it", "bad\nidea", "100%", "lol no",
                       "go for\nit", "sleep\non it", "ask ur\nmom", "signs\nsay yes", "not\ntoday", "duh", "hmm...\nno",
                       "totally", "try\nagain", "vibes\nsay yes"};
#define EIGHT_N ((int)(sizeof(EIGHT) / sizeof(EIGHT[0])))

void textBlock(const char *s, int cy, uint8_t size, uint16_t color) {
  String str(s);
  int n = 1, len = str.length();
  for (int i = 0; i < len; i++) if (str[i] == '\n') n++;
  int lh = 8 * size + 4, y = cy - n * lh / 2 + 2, start = 0;
  for (int i = 0; i <= len; i++) {
    if (i == len || str[i] == '\n') { textCentered(str.substring(start, i), y, size, color); y += lh; start = i + 1; }
  }
}

// ═════════════ v8.4: minigames, next to the oracle, dice and coin ═════════════
// tic-tac-toe against the charm, rock-paper-scissors, and a reflex test. Swipe sideways (or tap the title) to switch.
#define TOY_COUNT 6
enum ToyKind : uint8_t { TOY_ORACLE, TOY_DICE, TOY_COIN, TOY_TTT, TOY_RPS, TOY_REFLEX };
const char *TOY_TITLE[TOY_COUNT] = {"< ORACLE >", "< DICE >", "< COIN >", "< TIC-TAC-TOE >", "< R-P-S >", "< REFLEX >"};
uint16_t ttScore[3] = {0, 0, 0}, rpsScore[3] = {0, 0, 0};      // you, charm, draws

// ── tic-tac-toe: you are X, the charm is O and plays well but not perfectly ──
int8_t   ttB[9];
uint8_t  ttWinner = 0;                // 0 playing, 1 you, 2 charm, 3 draw
int8_t   ttLine = -1;
bool     ttCharmTurn = false, ttYouStart = false, ttStarted = false;
uint32_t ttMoveAt = 0, ttEndAt = 0;
const uint8_t TT_LINES[8][3] = {{0, 1, 2}, {3, 4, 5}, {6, 7, 8}, {0, 3, 6}, {1, 4, 7}, {2, 5, 8}, {0, 4, 8}, {2, 4, 6}};
int ttCheck(const int8_t *b, int8_t *line) {
  for (int i = 0; i < 8; i++) {
    int8_t v = b[TT_LINES[i][0]];
    if (v && v == b[TT_LINES[i][1]] && v == b[TT_LINES[i][2]]) { if (line) *line = i; return v; }
  }
  for (int i = 0; i < 9; i++) if (!b[i]) return 0;
  return 3;
}
int ttMinimax(int8_t *b, bool charm, int depth) {
  int r = ttCheck(b, nullptr);
  if (r == 2) return 10 - depth;
  if (r == 1) return depth - 10;
  if (r == 3) return 0;
  int best = charm ? -100 : 100;
  for (int i = 0; i < 9; i++) if (!b[i]) {
    b[i] = charm ? 2 : 1;
    int v = ttMinimax(b, !charm, depth + 1);
    b[i] = 0;
    best = charm ? max(best, v) : min(best, v);
  }
  return best;
}
int ttPick() {
  int empty[9], n = 0;
  for (int i = 0; i < 9; i++) if (!ttB[i]) empty[n++] = i;
  if (n == 9) { static const uint8_t OPEN[5] = {4, 0, 2, 6, 8}; return OPEN[random(0, 5)]; }
  if (random(0, 100) < 22) return empty[random(0, n)];             // a slip now and then, so you can win
  int best = -1000, at = empty[0];
  for (int k = 0; k < n; k++) {
    int i = empty[k];
    ttB[i] = 2;
    int v = ttMinimax(ttB, false, 1) * 10 + random(0, 3);
    ttB[i] = 0;
    if (v > best) { best = v; at = i; }
  }
  return at;
}
void ttNew() {
  memset(ttB, 0, sizeof(ttB));
  ttWinner = 0; ttLine = -1; ttStarted = true;
  ttYouStart = !ttYouStart;
  ttCharmTurn = !ttYouStart;
  ttMoveAt = millis() + 600;
}
void ttEnd(int w) {
  ttWinner = w; ttEndAt = millis(); ttCharmTurn = false;
  ttScore[w == 1 ? 0 : w == 2 ? 1 : 2]++;
  sfx(w == 1 ? 2 : w == 2 ? 3 : 1);
  klog("game: ttt, %s", w == 1 ? "you win" : w == 2 ? "charm wins" : "draw");
}
void ttTap(int x, int y) {
  if (!ttStarted || ttWinner) { ttNew(); return; }
  if (ttCharmTurn || x < 30 || x >= 210 || y < 58 || y >= 238) return;
  int c = ((y - 58) / 60) * 3 + (x - 30) / 60;
  if (ttB[c]) return;
  ttB[c] = 1; sfx(0);
  int r = ttCheck(ttB, &ttLine);
  if (r) { ttEnd(r); return; }
  ttCharmTurn = true; ttMoveAt = millis() + 380 + random(0, 420);
}
void drawTtt(uint32_t now) {
  if (!ttStarted) ttNew();
  if (ttCharmTurn && !ttWinner && now >= ttMoveAt) {
    ttB[ttPick()] = 2; ttCharmTurn = false; sfx(4);
    int r = ttCheck(ttB, &ttLine);
    if (r) ttEnd(r);
  }
  for (int k = 1; k < 3; k++) {
    gfx->fillRect(30 + k * 60 - 1, 62, 2, 172, ACC_DIM);
    gfx->fillRect(34, 58 + k * 60 - 1, 172, 2, ACC_DIM);
  }
  for (int i = 0; i < 9; i++) {
    int cx = 60 + (i % 3) * 60, cy = 88 + (i / 3) * 60;
    bool lit = ttLine >= 0 && (TT_LINES[ttLine][0] == i || TT_LINES[ttLine][1] == i || TT_LINES[ttLine][2] == i) && (now / 250) % 2;
    if (ttB[i] == 1) for (int t = -2; t <= 2; t++) {
      uint16_t c = lit ? ACC : COL_WHITE;
      gfx->drawLine(cx - 17 + t, cy - 17, cx + 17 + t, cy + 17, c);
      gfx->drawLine(cx + 17 + t, cy - 17, cx - 17 + t, cy + 17, c);
    } else if (ttB[i] == 2) for (int r = 15; r <= 19; r++) gfx->drawCircle(cx, cy, r, lit ? COL_WHITE : ACC);
  }
  char b[40];
  const char *msg = ttWinner == 1 ? "you win!" : ttWinner == 2 ? "i win :)" : ttWinner == 3 ? "draw" : ttCharmTurn ? ((now / 300) % 2 ? "thinking.." : "thinking. ") : "your move";
  textCentered(msg, 244, 1, ttWinner == 1 ? COL_LIME : ttWinner ? ACC : COL_WHITE);
  snprintf(b, sizeof(b), "you %u  me %u  draw %u", ttScore[0], ttScore[1], ttScore[2]);
  textCentered(b, 256, 1, ACC_DIM);
}

// ── rock-paper-scissors ──
int8_t   rpsYou = -1, rpsMe = -1;
uint32_t rpsAt = 0;
const char *RPS_NAME[3] = {"rock", "paper", "scissors"};
void rpsPlay(int k) {
  if (rpsYou >= 0 && millis() - rpsAt < 1000) return;
  rpsYou = k % 3; rpsMe = random(0, 3); rpsAt = millis(); sfx(3);
}
void rpsIcon(int k, int cx, int cy, uint16_t c) {
  if (k == 0) { gfx->fillCircle(cx, cy, 24, c); gfx->drawLine(cx - 10, cy - 6, cx + 2, cy + 2, COL_VOID); gfx->drawLine(cx + 6, cy - 12, cx + 12, cy - 2, COL_VOID); }
  else if (k == 1) { gfx->fillRect(cx - 20, cy - 26, 40, 52, c); for (int i = 0; i < 4; i++) gfx->drawFastHLine(cx - 14, cy - 16 + i * 10, 28, COL_VOID); }
  else {
    for (int t = -2; t <= 2; t++) { gfx->drawLine(cx - 18 + t, cy - 24, cx + 10 + t, cy + 10, c); gfx->drawLine(cx + 18 + t, cy - 24, cx - 10 + t, cy + 10, c); }
    for (int r = 6; r <= 8; r++) { gfx->drawCircle(cx - 12, cy + 18, r, c); gfx->drawCircle(cx + 12, cy + 18, r, c); }
  }
}
void drawRps(uint32_t now) {
  textAt("you", 51, 58, 2, COL_WHITE); textAt("me", 168, 58, 2, ACC);
  uint32_t el = now - rpsAt;
  bool counting = rpsYou >= 0 && el < 900;
  if (rpsYou < 0) {
    rpsIcon(0, 60, 116, ACC_LOW); rpsIcon(0, 180, 116, ACC_LOW);
    textCentered("pick one", 166, 2, COL_WHITE);
  } else if (counting) {
    int bob = (int)(fabsf(sinf(el * 0.021f)) * 14);
    rpsIcon(0, 60, 112 - bob, COL_WHITE); rpsIcon(0, 180, 112 - bob, ACC);
    static const char *CD[3] = {"rock..", "paper..", "scissors.."};
    textCentered(CD[min(2, (int)(el / 300))], 166, 2, COL_WHITE);
  } else {
    if (el < 960) sfx(0);
    rpsIcon(rpsYou, 60, 116, COL_WHITE); rpsIcon(rpsMe, 180, 116, ACC);
    textCentered(String(RPS_NAME[rpsYou]) + " vs " + RPS_NAME[rpsMe], 152, 1, ACC_DIM);
    int r = (rpsYou - rpsMe + 3) % 3;
    static uint32_t scored = 0;
    if (scored != rpsAt) { scored = rpsAt; rpsScore[r == 1 ? 0 : r == 2 ? 1 : 2]++; klog("game: rps, %s", r == 1 ? "you win" : r == 2 ? "charm wins" : "draw"); }
    textCentered(r == 1 ? "YOU WIN" : r == 2 ? "I WIN" : "DRAW", 168, 2, r == 1 ? COL_LIME : r == 2 ? ACC : COL_WHITE);
  }
  for (int k = 0; k < 3; k++) {
    int x = 14 + k * 74;
    bool sel = rpsYou == k && !counting;
    if (sel) gfx->fillRect(x, 200, 64, 32, ACC); else hudPanel(x, 200, 64, 32, ACC, 2);
    textAt(RPS_NAME[k], x + (64 - strlen(RPS_NAME[k]) * 6) / 2, 212, 1, sel ? COL_BLACK : COL_WHITE);
  }
  char b[40]; snprintf(b, sizeof(b), "you %u  me %u  draw %u", rpsScore[0], rpsScore[1], rpsScore[2]);
  textCentered(b, 248, 1, ACC_DIM);
}

// ── reflex: wait for it, then tap as fast as you can ──
enum RfState : uint8_t { RF_IDLE, RF_WAIT, RF_GO, RF_DONE, RF_EARLY };
uint8_t  rfState = RF_IDLE;
uint32_t rfGoAt = 0, rfShownAt = 0, rfMs = 0;
uint16_t rfBest = 0;
bool     rfBestLoaded = false;
void rfStart() { rfState = RF_WAIT; rfGoAt = millis() + 1400 + random(0, 2600); rfShownAt = 0; sfx(0); }
void rfTap(uint32_t downAt) {
  switch (rfState) {
    case RF_WAIT: rfState = RF_EARLY; sfx(1); break;
    case RF_GO:
      if (!rfShownAt || downAt < rfShownAt) { rfState = RF_EARLY; break; }
      rfMs = downAt - rfShownAt; rfState = RF_DONE; sfx(2);
      if (!rfBest || rfMs < rfBest) { rfBest = rfMs; prefs.putUShort("rfbest", rfBest); klog("game: reflex best %lums", (unsigned long)rfMs); }
      break;
    default: rfStart(); break;
  }
}
void drawReflex(uint32_t now) {
  if (!rfBestLoaded) { rfBest = prefs.getUShort("rfbest", 0); rfBestLoaded = true; }
  if (rfState == RF_WAIT && now >= rfGoAt) rfState = RF_GO;
  char b[40];
  switch (rfState) {
    case RF_WAIT:
      textCentered("wait for it...", 140, 2, COL_WHITE);
      for (int i = 0; i < 3; i++) gfx->fillRect(108 + i * 10, 172, 6, 6, (now / 300) % 3 == (uint32_t)i ? ACC : ACC_LOW);
      break;
    case RF_GO:
      gfx->fillRect(0, 50, SCR_W, 200, ACC);
      textCentered("TAP!", 130, 5, COL_BLACK);
      if (!rfShownAt) rfShownAt = now + 8;                         // the frame reaches the screen about now
      break;
    case RF_DONE:
      snprintf(b, sizeof(b), "%lums", (unsigned long)rfMs);
      textCentered(b, 112, 4, COL_WHITE);
      textCentered(rfMs < 220 ? "lightning" : rfMs < 280 ? "quick" : rfMs < 380 ? "not bad" : "sleepy?", 156, 2, ACC);
      textCentered("tap to go again", 188, 1, ACC_DIM);
      break;
    case RF_EARLY:
      textCentered("too soon!", 128, 3, COL_RED);
      textCentered("tap to try again", 168, 1, ACC_DIM);
      break;
    default:
      textCentered("tap when the", 116, 2, COL_WHITE);
      textCentered("screen lights up", 138, 2, COL_WHITE);
      textCentered("tap to start", 178, 1, ACC_DIM);
      break;
  }
  if (rfBest) { snprintf(b, sizeof(b), "best %ums", rfBest); textCentered(b, 252, 1, rfState == RF_GO ? COL_BLACK : ACC_DIM); }
}
void toySwitch(int k) {
  toyKind = (k + TOY_COUNT) % TOY_COUNT; toyHasResult = false; toyRollAt = 0;
  if (toyKind == TOY_REFLEX) rfState = RF_IDLE;
  prefs.putUChar("toy", toyKind);
  sfx(1);
}
// a tap on the toy screen
void toyTap(int x, int y, uint32_t downAt) {
  if (y < 54) { toySwitch(toyKind + 1); return; }
  switch (toyKind) {
    case TOY_TTT: ttTap(x, y); break;
    case TOY_RPS: if (y >= 196 && y < 236) rpsPlay(min(2, max(0, (x - 14) / 74))); break;
    case TOY_REFLEX: rfTap(downAt); break;
    default: toyRoll(); break;
  }
}

void toyRoll() {
  touchActivity();
  if (toyKind == TOY_TTT) { ttNew(); return; }
  if (toyKind == TOY_RPS) { rpsPlay(random(0, 3)); return; }
  if (toyKind == TOY_REFLEX) { rfStart(); return; }
  toyRollAt = millis();
  toyHasResult = true;
  if (toyKind == 0)      toyResult = random(0, EIGHT_N);
  else if (toyKind == 1) { toyResult = 1 + random(0, 6); toyResult2 = 1 + random(0, 6); }
  else                   toyResult = random(0, 2);
  sfx(3);
}

void drawDie(int x, int y, int s, uint8_t v) {
  static const uint16_t P[7] = {0, 0b000010000, 0b100000001, 0b100010001, 0b101000101, 0b101010101, 0b101101101};
  gfx->drawRect(x + 5, y + 5, s, s, ACC);
  gfx->fillRect(x, y, s, s, COL_WHITE);
  if (v < 1 || v > 6) v = 1;
  for (int i = 0; i < 9; i++)
    if ((P[v] >> (8 - i)) & 1) gfx->fillRect(x + s / 4 * (1 + i % 3) - s / 11, y + s / 4 * (1 + i / 3) - s / 11, 2 * (s / 11), 2 * (s / 11), COL_BLACK);
}

void drawToy() {
  uint32_t el = millis() - toyRollAt;
  bool rolling = toyRollAt && el < 1100;
  int jx = rolling ? (int)random(-5, 6) : 0, jy = rolling ? (int)random(-5, 6) : 0;

  gfx->fillScreen(COL_VOID);
  for (int y = 50; y < SCR_H; y += 20) for (int x = 10; x < SCR_W; x += 20) gfx->drawPixel(x, y, ACC_DIM);

  if (toyKind >= TOY_TTT) {
    uint32_t now = millis();
    if (toyKind == TOY_TTT) drawTtt(now); else if (toyKind == TOY_RPS) drawRps(now); else drawReflex(now);
  } else if (toyKind == 0) {
    gfx->fillCircle(120 + jx, 160 + jy, 92, COL_BLACK);
    gfx->drawCircle(120 + jx, 160 + jy, 92, ACC);
    gfx->drawCircle(120 + jx, 160 + jy, 86, ACC_LOW);
    gfx->fillCircle(120 + jx, 164 + jy, 60, mix565(ACC, COL_BLACK, 200));
    gfx->drawCircle(120 + jx, 164 + jy, 60, ACC);
    if (rolling)           textBlock("...", 164, 3, COL_WHITE);
    else if (toyHasResult) textBlock(EIGHT[toyResult % EIGHT_N], 164, 2, COL_WHITE);
    else                   textBlock(imuOK ? "shake\nme" : "tap\nme", 164, 2, COL_WHITE);
  } else if (toyKind == 1) {
    uint8_t a = rolling ? 1 + random(0, 6) : toyResult, b = rolling ? 1 + random(0, 6) : toyResult2;
    if (!toyHasResult) { a = 5; b = 2; }
    drawDie(26 + jx, 100 + jy, 88, a);
    drawDie(126 - jx, 100 - jy, 88, b);
    if (toyHasResult && !rolling) textPop(String("= ") + (toyResult + toyResult2), 208, 4, ACC);
    else if (!toyHasResult)       textPop(imuOK ? "shake to roll" : "tap to roll", 218, 2, COL_WHITE);
  } else {
    const uint16_t gold = c565(255, 200, 60), dark = c565(190, 130, 20);
    if (rolling) {
      int rx = max(3, (int)(fabsf(sinf(el * 0.02f)) * 70));
      gfx->fillEllipse(120, 150 - (int)(sinf(el * 3.14159f / 1100.0f) * 44), rx, 70, gold);
    } else {
      gfx->fillCircle(120, 150, 72, dark);
      gfx->fillCircle(120, 150, 66, gold);
      gfx->drawCircle(120, 150, 58, dark);
      if (toyHasResult) {
        textAt(toyResult ? "T" : "H", 120 - 21, 150 - 28, 7, dark);
        textPop(toyResult ? "TAILS" : "HEADS", 234, 2, ACC);
      } else {
        textAt("?", 120 - 21, 150 - 28, 7, dark);
        textPop(imuOK ? "shake to flip" : "tap to flip", 234, 2, COL_WHITE);
      }
    }
  }
  topBar("//RNG", true);
  if (!(toyKind == TOY_REFLEX && rfState == RF_GO)) textPop(TOY_TITLE[toyKind % TOY_COUNT], 30, 2, ACC);
}

void drawAlarm() {
  if (!alarmUntil) return;
  bool flash = (millis() / 300) % 2;
  gfx->fillRect(16, 92, 208, 96, flash ? ACC : COL_BLACK);
  hudPanel(16, 92, 208, 96, COL_WHITE, 0);
  textCentered("TIME'S UP", 116, 3, flash ? COL_BLACK : ACC);
  textCentered("tap to stop", 160, 1, flash ? COL_BLACK : COL_WHITE);
}

// a line across the bottom of the other screens while a song is playing
void drawTicker() {
  if (!npPlaying || !npTitle.length()) return;
  dimRect(44, 260, 152, 13, 2);
  gfx->drawChar(48, 263, 0x0E, ACC, ACC);
  String s = asciiOnly(npTitle);
  if (npArtist.length()) s += String(" - ") + asciiOnly(npArtist);
  textAt(marquee(s, 22, 7), 58, 263, 1, COL_WHITE);
}

void openModule(int m);
float eyeBounce = 0;                                  // the eyes hop to the jukebox's notes
