// Larp Charm firmware: Screen effects, the render loop and switching screens.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Screen effects ─────────────
void scanlines() {
  if (!FB) return;
  for (int y = 1; y < SCR_H; y += 2) {
    uint16_t *p = FB + y * SCR_W;
    for (int x = 0; x < SCR_W; x++) p[x] -= (p[x] >> 2) & 0x39E7;
  }
}

// tears a few bands of the frame sideways
void glitchFx(int bands) {
  if (!FB) return;
  static uint16_t rowTmp[SCR_W];
  for (int b = 0; b < bands; b++) {
    int y = random(0, SCR_H - 16), h = random(2, 14), off = random(-28, 29);
    if (off == 0) continue;
    for (int j = 0; j < h; j++) {
      uint16_t *row = FB + (y + j) * SCR_W;
      memcpy(rowTmp, row, SCR_W * 2);
      for (int x = 0; x < SCR_W; x++) row[x] = rowTmp[(x - off + SCR_W) % SCR_W];
    }
  }
  gfx->drawFastHLine(0, random(0, SCR_H), SCR_W, ACC);
}

// old-TV switch-on when the screen wakes
void wakeFx() {
  if (!wakeFxAt) return;
  uint32_t el = millis() - wakeFxAt;
  if (el > 260) { wakeFxAt = 0; return; }
  float t = el / 260.0f;
  int half = 2 + (int)(t * t * 138);
  gfx->fillRect(0, 0, SCR_W, 140 - half, COL_BLACK);
  gfx->fillRect(0, 140 + half, SCR_W, 140 - half, COL_BLACK);
  gfx->drawFastHLine(0, 140 - half, SCR_W, COL_WHITE);
  gfx->drawFastHLine(0, 140 + half - 1, SCR_W, COL_WHITE);
}

void drawScene() {
  switch (mode) {
    case M_CLOCK: drawClock(); break;
    case M_TEXT:  drawText();  break;
    case M_PHOTO: drawPhoto(); break;
    case M_MUSIC: drawMusic(); break;
    case M_PET:   drawPet();   break;
    case M_TOY:   drawToy();   break;
    case M_CARD:  drawCard();  break;
    case M_EYES:  drawEyes();  break;
    case M_TERM:  drawTty();   break;
    case M_CLAUDE: drawClaude(); break;
    case M_WEATHER: drawWeather(); break;
    case M_REC:   drawRec();   break;
    case M_CAST:  drawCast();  break;
    case M_JUKE:  drawJuke();  break;
    case M_TORCH: drawTorch(); break;
    case M_CHARGE: drawCharge(); break;
    default:      drawDeck(); break;
  }
}

void render() {
  updateAccent();
  drawScene();
  if (mode == M_CLOCK || mode == M_PET || mode == M_TOY || mode == M_CARD) drawTicker();
  bool fx = fxOn;
  if (fx && mode != M_PHOTO && mode != M_MUSIC && mode != M_TORCH) scanlines();
  if (glitchFrames) { glitchFx(5); glitchFrames--; }
  else if (fx && mode == M_DECK && random(0, 220) == 0) glitchFrames = 2;
  drawAlarm();
  drawTransferOverlay();
  drawPairOverlay();
  drawToast();
  wakeFx();
  gfx->flush();
  frameNo++;
}

void setMode(int m, bool announce) {
  (void)announce;
  uint8_t old = mode;
  mode = ((m % M_COUNT) + M_COUNT) % M_COUNT;
  if (mode == M_GONE3) mode = M_DECK;
  if (mode != M_CHARGE && mode != M_TORCH && mode != M_REC && mode != M_CAST && !idleEyesOn) prefs.putUChar("mode", mode);
  bool wantS = mode == M_REC || mode == M_CAST, hadS = old == M_REC || old == M_CAST;     // the gyro is on for these two
  if (wantS && !hadS) recSensor(true);
  if (hadS && !wantS) recSensor(false);
  if (mode == M_CAST && old != M_CAST) castKind = -1;
  if (old == M_TORCH && mode != M_TORCH && !sleeping) analogWrite(LCD_BL, brightness);
  if (mode == M_TORCH && old != M_TORCH) { analogWrite(LCD_BL, 255); chromeUntil = millis() + 2500; }
  if (mode == M_EYES && old != M_EYES) { chromeUntil = millis() + 1500; tiltBaseX = tiltX; tiltBaseY = tiltY; nextIdleExpr = millis() + 4000; exprShown = 255; }
  if (mode == M_PHOTO) chromeUntil = millis() + 1500;
  if (mode == M_MUSIC && old != M_MUSIC) npBig = false;
  if (mode == M_WEATHER && old != M_WEATHER) wxOpenAt = millis();
  if (mode != M_CLAUDE) { ccBig = false; ccBigT = 0; }
  if (mode == M_TEXT) typeStart = millis();
  glitchFrames = 3;
}

// A frame grows out of the tapped block until it fills the screen (or shrinks back into it).
void zoomAnim(int ti, bool opening) {
  if (!FB || !prevFb || sleeping || ti < 0) return;
  memcpy(prevFb, FB, FB_BYTES);
  const int steps = 6;
  for (int s = 1; s <= steps; s++) {
    float t = (float)s / steps;
    t = 1.0f - (1.0f - t) * (1.0f - t);
    if (!opening) t = 1.0f - t;
    int x = TILE_X[ti] - (int)(TILE_X[ti] * t), y = TILE_Y[ti] - (int)(TILE_Y[ti] * t);
    int w = TILE_W[ti] + (int)((SCR_W - TILE_W[ti]) * t), h = TILE_H[ti] + (int)((SCR_H - TILE_H[ti]) * t);
    memcpy(FB, prevFb, FB_BYTES);
    gfx->fillRect(x, y, w, h, COL_BLACK);
    gfx->drawRect(x, y, w, h, ACC);
    gfx->drawRect(x + 1, y + 1, w - 2, h - 2, ACC);
    gfx->flush();
  }
}

void openModule(int m) {
  if (mode == M_DECK) { sfx(1); zoomAnim(tileOfMode(m), true); }
  setMode(m);
  lastFrame = 0;
}

void closeModule() {
  if (mode == M_DECK) return;
  if (mode == M_CHARGE) { setMode(chargeReturn == M_CHARGE ? M_DECK : chargeReturn); lastFrame = 0; return; }
  int ti = tileOfMode(mode);
  sfx(1);
  setMode(M_DECK);
  updateAccent();
  drawScene();
  zoomAnim(ti, false);
  glitchFrames = 1;
  lastFrame = 0;
}

// The idle eyes (an option): when the sleep timer runs out, the eyes take over and doze off first.
void idleEyesEnd() {
  if (!idleEyesOn) return;
  idleEyesOn = false;
  exprAuto = true;
  ttyFaceUntil = 0; ttyWake();
  setMode(idleReturn);
  if (!sleeping) analogWrite(LCD_BL, mode == M_TORCH ? 255 : brightness);
  lastFrame = 0;
}

void sendStatus(const char *extra);
