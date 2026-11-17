// Larp Charm firmware: Touch: taps, swipes, holds and shakes.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Touch: coordinate-based gestures ─────────────
void IRAM_ATTR onTouchInt() { touchFlag = true; }

void touchWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(CST816_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}

void touchInit() {
  pinMode(TP_RST, OUTPUT);
  digitalWrite(TP_RST, LOW);  delay(10);
  digitalWrite(TP_RST, HIGH); delay(60);
  touchWrite(0xFE, 0x01);   // DisAutoSleep: stay awake so every touch registers
  touchWrite(0xFA, 0x70);   // IrqCtl: interrupt on touch, change and motion
  pinMode(TP_INT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TP_INT), onTouchInt, FALLING);
}

bool readTouch(int16_t &x, int16_t &y, uint8_t &fingers) {
  Wire.beginTransmission(CST816_ADDR);
  Wire.write(0x02);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)CST816_ADDR, (uint8_t)5) != 5) return false;
  fingers = Wire.read() & 0x0F;
  uint8_t xh = Wire.read(), xl = Wire.read(), yh = Wire.read(), yl = Wire.read();
  x = ((xh & 0x0F) << 8) | xl;
  y = ((yh & 0x0F) << 8) | yl;
  return true;
}

struct { bool down = false; bool consumed = false; int16_t x0 = 0, y0 = 0, x = 0, y = 0; uint32_t t0 = 0; } tch;
uint32_t lastTouchPoll = 0, lastTapAt = 0;

#define SWIPE_PX      40   // distance that commits a swipe while the finger is still down
#define FLICK_PX      22   // shorter distance accepted on release if it was quick
#define TAP_PX        16
#define LONGPRESS_MS 650

void cycleBg(int dir) {
  bgStyle = (bgStyle + BG_COUNT + dir) % BG_COUNT;
  if (bgStyle == 8 && !photoLoaded) bgStyle = (bgStyle + BG_COUNT + dir) % BG_COUNT;
  prefs.putUChar("bg", bgStyle);
  toast(BG_NAMES[bgStyle], 800);
  glitchFrames = 2;
  sfx(1);
}

// Sideways swipes act on whatever is open. dir +1 = finger moved left.
void onSwipe(int dir) {
  if (swapSwipe) dir = -dir;
  switch (mode) {
    case M_DECK:
      theme = (theme + THEME_COUNT + dir) % THEME_COUNT;
      prefs.putUChar("theme", theme);
      themePreviewUntil = millis() + 2500;
      toast(THEME_NAMES[theme], 900);
      glitchFrames = 2;
      sfx(1);
      break;
    case M_CLOCK: cycleBg(dir); break;
    case M_TEXT:
      textStyle = (textStyle + TEXT_STYLES + dir) % TEXT_STYLES;
      prefs.putUChar("tstyle", textStyle);
      marqueeX = SCR_W; typeStart = millis();
      sfx(1);
      break;
    case M_MUSIC: mediaCmd(dir > 0 ? 1 : 2); break;
    case M_TOY:
      toySwitch(toyKind + dir);
      break;
    case M_PET:
      petMood = min(100, petMood + 3);
      petHeartsUntil = millis() + 1500;
      break;
    case M_EYES: {
      uint8_t e = (exprShown + EXPR_COUNT + dir) % EXPR_COUNT;
      setExpr(e, 8000);
      toast(EXPR_NAMES[e], 800);
      sfx(4);
      break;
    }
    case M_JUKE:
      jbCat = (jbCat + catCount() + dir) % catCount(); sfx(1);
      break;
    case M_TORCH: torchCol = (torchCol + 4 + dir) % 4; break;
    case M_TERM:  ttySet((ttyFace + TF_COUNT + dir) % TF_COUNT, 6000); toast(TTY_MOOD[ttyFace], 700); sfx(4); break;
    case M_CLAUDE: if (ccPermOn) break; if (ccBig) cbSwipe(dir); else { ccPage = (ccPage + 3 + dir) % 3; sfx(1); } break;
    default: break;
  }
}

// Swipe down closes whatever is open. On the home screen, up and down change brightness.
void onVSwipe(int up) {
  if (mode == M_DECK && deckChoose) { deckChoose = false; return; }
  if (mode == M_CLAUDE && ccBig) { if (up > 0) { cbJump(11); cbTouchAt = millis(); } else ccBigClose(); return; }
  if (up < 0 && mode != M_DECK) { closeModule(); return; }
  if (mode == M_TORCH) return;
  setBacklight(brightness + (up > 0 ? 40 : -40));
  prefs.putUChar("bright", brightness);
  toast(up > 0 ? "bright +" : "bright -", 500);
}

void onTap(bool dbl) {
  sfx(0);
  switch (mode) {
    case M_DECK:
      if (deckChoose) deckChooseTap(tch.x0, tch.y0);
      else if (tch.y0 >= 252 && deckPending < 0) { deckChoose = true; deckChooseAt = millis(); chosePick = -1; sfx(1); }   // the status bar: the window chooser
      else deckRun(tileAt(tch.x0, tch.y0));
      break;
    case M_CLOCK:
      if (dbl) {              // second tap of a double tap: undo the style change, flip 12/24 h
        faceStyle = (faceStyle + FACE_COUNT - 1) % FACE_COUNT;
        use24h = !use24h; prefs.putBool("h24", use24h);
        toast(use24h ? "24h" : "12h", 700);
      } else faceStyle = (faceStyle + 1) % FACE_COUNT;
      prefs.putUChar("face", faceStyle);
      break;
    case M_TEXT:
      textStyle = (textStyle + 1) % TEXT_STYLES;
      prefs.putUChar("tstyle", textStyle);
      marqueeX = SCR_W; typeStart = millis();
      break;
    case M_PHOTO: chromeUntil = millis() + 1500; break;
    case M_CAST:  if (tch.y0 < 18 && tch.x0 >= 14 && tch.x0 < 158) wandSet((tch.x0 - 14) / 36); break;
    case M_MUSIC:
      if (npBig) { npBig = false; glitchFrames = 2; }
      else if (tch.y0 >= NP_KEY_Y - 4) mediaCmd(tch.x0 < 54 ? 2 : tch.x0 > 186 ? 1 : 0);
      else if (tch.y0 >= NP_VOL_Y - 8) mediaCmd(tch.x0 < 120 ? 4 : 3);
      else if (tch.x0 < NP_AX + NP_ART + 6 && tch.y0 >= NP_AY - 6 && tch.y0 < NP_AY + NP_ART + 6) { npBig = true; glitchFrames = 2; }
      break;
    case M_PET:
      petMood = min(100, petMood + (dbl ? 25 : 3));
      petHeartsUntil = millis() + (dbl ? 2500 : 1500);
      if (dbl) { prefs.putInt("petmood", petMood); toast("yum!", 700); }
      break;
    case M_TOY:
      toyTap(tch.x0, tch.y0, tch.t0);
      break;
    case M_EYES:
      if (dbl) setExpr(E_LOVE, 3500);
      else {
        static const uint8_t R[5] = {E_HAPPY, E_LAUGH, E_SURPRISED, E_HAPPY, E_WINK};
        setExpr(R[random(0, 5)], 2500);
        blinkAt = millis();
      }
      sfx(4);
      break;
    case M_JUKE:
      {
        int16_t ids[JB_ROWS];
        int n = songsInCat(jbCat, ids, JB_ROWS), row = (tch.y0 - JB_ROW_Y) / JB_ROW_H;
        if (tch.y0 < JB_ROW_Y - 2) { jbCat = (jbCat + catCount() + (tch.x0 < 120 ? -1 : 1)) % catCount(); }
        else if (tch.y0 < 190 && row >= 0 && row < n) { bool was = jbPlaying; jbSelId = ids[row]; jbEnqueue(ids[row]); toast(was ? "queued" : "playing", 700); }
        else if (tch.y0 >= 190 && jbPlaying) { if (tch.x0 > 170) jbSkip(); else jbStop(); }
        else if (tch.y0 >= 190) jbStartSong(jbSelId);
      }
      break;
    case M_TORCH: torchCol = (torchCol + 1) % 4; chromeUntil = 0; break;
    case M_CHARGE: closeModule(); break;
    case M_TERM:   ttyTap(dbl); sfx(4); break;
    case M_WEATHER: wxTap(); break;
    case M_CLAUDE:
      if (ccPermOn) { if (tch.y0 >= 180 && tch.y0 < 232) ccAnswer(tch.x0 >= 120); }
      else if (ccBig) cbTap(tch.x0, tch.y0, dbl);
      else ccTapPage(tch.x0, tch.y0);
      break;
    default: break;
  }
}

void onShake() {
  if (sleeping) {
    if (shakeWake) { touchActivity(); sfx(0); klog("imu: shake, waking up"); }
    return;
  }
  touchActivity();
  klog("imu: shake, |a|=%.1fg", sqrtf(accX * accX + accY * accY + accZ * accZ));
  switch (mode) {
    case M_DECK:
      // fall through
    case M_CLOCK: cycleBg(1); break;
    case M_PET:
      petDizzyUntil = millis() + 3000;
      toast("wheee!", 900);
      sfx(3);
      break;
    case M_TOY: if (toyKind != TOY_TTT && toyKind != TOY_REFLEX) toyRoll(); break;
    case M_TEXT:
      textStyle = (textStyle + 1) % TEXT_STYLES;
      prefs.putUChar("tstyle", textStyle);
      marqueeX = SCR_W; typeStart = millis();
      break;
    case M_EYES: setExpr(E_DIZZY, 3000); sfx(3); break;
    case M_TERM: ttySet(TF_DIZZY, 3000); sfx(3); break;
    case M_WEATHER: wxShake(); break;
    case M_CLAUDE: if (ccPermOn) break; if (ccBig) cbShake(); else if (ccLinked()) ccSetPose(CP_DIZZY, 2400); else ccPoke(101); sfx(3); break;
    case M_JUKE: { int16_t all[48]; int n = allSongs(all, 48); jbSelId = all[random(0, n)]; jbStop(); jbStartSong(jbSelId); toast("shuffle", 800); break; }
    default: break;
  }
}

void handleTouch() {
  uint32_t now = millis();
  if (!touchFlag && now - lastTouchPoll < 12) return;
  if (sleeping && !touchFlag && now - lastTouchPoll < 60) return;
  lastTouchPoll = now;
  touchFlag = false;
  int16_t x, y; uint8_t fingers;
  if (!readTouch(x, y, fingers)) return;

  if (fingers > 0) {
    if (!tch.down) {
      tch.down = true; tch.consumed = false;
      tch.x0 = tch.x = x; tch.y0 = tch.y = y; tch.t0 = now;
      if (alarmUntil) { alarmUntil = 0; noTone(BUZZER); touchActivity(); tch.consumed = true; return; }
      if (sleeping) { touchActivity(); tch.consumed = true; return; }   // first touch only wakes
      if (idleEyesOn) { touchActivity(); tch.consumed = true; return; } // and wakes you out of the idle eyes
      touchActivity();
      if (mode == M_REC || (mode == M_CAST && y >= 18)) {     // thumb down: record a take / cast / twist / draw
        tch.consumed = true; recStart(true, 0); if (mode == M_CAST) wandBegin(); return;
      }
    }
    tch.x = x; tch.y = y;
    lastInteraction = now;
    int dx = x - tch.x0, dy = y - tch.y0;
    if (tch.consumed) return;
    if (abs(dx) >= SWIPE_PX && abs(dx) > abs(dy)) { tch.consumed = true; onSwipe(dx < 0 ? 1 : -1); return; }
    if (abs(dy) >= SWIPE_PX && abs(dy) > abs(dx)) { tch.consumed = true; onVSwipe(dy < 0 ? 1 : -1); return; }
    if (now - tch.t0 > LONGPRESS_MS && abs(dx) < TAP_PX && abs(dy) < TAP_PX) {
      tch.consumed = true;
      if (mode == M_CARD) closeModule();
      else openModule(M_CARD);                                    // anywhere else: the ID card
    }
  } else if (tch.down) {
    tch.down = false;
    if ((mode == M_REC || mode == M_CAST) && recOn && recByThumb) { recStop(); return; }   // thumb up: send it / cast it
    if (tch.consumed) return;
    int dx = tch.x - tch.x0, dy = tch.y - tch.y0;
    uint32_t dt = now - tch.t0;
    if (abs(dx) < TAP_PX && abs(dy) < TAP_PX) {
      bool dbl = (now - lastTapAt) < 350;
      lastTapAt = dbl ? 0 : now;
      onTap(dbl);
    } else if (dt < 400 && abs(dx) >= FLICK_PX && abs(dx) > abs(dy)) {
      onSwipe(dx < 0 ? 1 : -1);
    } else if (dt < 400 && abs(dy) >= FLICK_PX && abs(dy) > abs(dx)) {
      onVSwipe(dy < 0 ? 1 : -1);
    }
  }
}
