// Larp Charm firmware: Power: the PWR button, battery, sleep.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Power & battery ─────────────
void handleButton() {
  static bool armed = false;
  static uint32_t downAt = 0;
  static bool wasDown = false;
  bool down = digitalRead(SYS_OUT) == LOW;
  if (!armed) { if (!down) armed = true; return; }

  if (down && !wasDown) downAt = millis();
  if (down && millis() - downAt > 2000) {
    gfx->fillScreen(COL_BLACK);
    textCentered("SHUTDOWN", 124, 3, ACC);
    gfx->flush();
    tone(BUZZER, 1800, 120); delay(200); noTone(BUZZER);
    savePrefs();
    digitalWrite(SYS_EN, LOW);
    delay(1500);
    toast("on USB power", 1500);
    armed = false;
    wasDown = true;
    return;
  }
  if (!down && wasDown && millis() - downAt < 600) {
    if (alarmUntil) { alarmUntil = 0; noTone(BUZZER); touchActivity(); }
    else if (sleeping) touchActivity();
    else if (mode == M_CLAUDE && ccBig) { touchActivity(); ccBigClose(); }
    else if (mode != M_DECK) { touchActivity(); closeModule(); }
    else if (deckChoose) { touchActivity(); deckChoose = false; }  // back out of the window chooser
    else { sleeping = true; analogWrite(LCD_BL, 0); }             // on the deck: screen off
  }
  wasDown = down;
}

int voltsToPct(float v) {
  const float V[] = {3.30, 3.60, 3.70, 3.75, 3.80, 3.90, 4.00, 4.10, 4.20};
  const int   P[] = {0,    8,    20,   35,   48,   65,   80,   92,   100};
  if (v >= V[8]) return 100;
  if (v <= V[0]) return 0;
  for (int i = 0; i < 8; i++)
    if (v < V[i + 1]) return P[i] + (int)((v - V[i]) / (V[i + 1] - V[i]) * (P[i + 1] - P[i]));
  return 100;
}

void updateBattery() {
  uint32_t now = millis();
  if (lastBatRead && now - lastBatRead < 1000) return;
  lastBatRead = now;
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(BAT_ADC);
  float v = (mv / 16) * 3.0f / 1000.0f;
  vFast = (vHistN == 0) ? v : vFast * 0.5f + v * 0.5f;
  batVolts = (vHistN == 0) ? v : batVolts * 0.85f + v * 0.15f;

  // The board has no "charger connected" pin. USB power shows up two ways:
  //  - a computer: the USB port reports a host straight away
  //  - a plain charger: the battery voltage jumps up ~0.1 V within a few seconds of plugging in, and drops the same way when unplugged
  // Anything else is just the battery, so nothing slow or guessed counts as charging any more.
  float lo = vFast, hi = vFast;
  for (int i = 0; i < min(vHistN, 6); i++) { lo = min(lo, vHist[i]); hi = max(hi, vHist[i]); }
  if (vHistN >= 3 && !wallPower && vFast - lo > 0.07f) { wallPower = true; batVolts = vFast; }
  else if (wallPower && hi - vFast > 0.07f) { wallPower = false; batVolts = vFast; }
  vHist[vHistN % 6] = vFast;
  vHistN++;
  if (now - lastSlowAt >= 10000) {                 // a charger never lets the voltage sag for a whole minute
    lastSlowAt = now;
    vSlow[vSlowN % 6] = vFast; vSlowN++;
    if (wallPower && vSlowN >= 6 && vSlow[(vSlowN - 6) % 6] - vFast > 0.03f) wallPower = false;
  }

  bool usb = Serial.isPlugged();
  bool wasCharging = charging;
  charging = usb || wallPower;

  // the charger lifts the voltage, so read a little lower while charging
  int pct = voltsToPct(charging ? batVolts - 0.10f : batVolts);
  batPct = constrain(pct, 0, 100);

  // plugged in: show the charging screen. Unplugged: go back to what was open.
  if (charging && !wasCharging) {
    touchActivity();
    if (mode != M_CHARGE && !xferActive) { chargeReturn = mode == M_TORCH ? M_DECK : mode; setMode(M_CHARGE); }
  }
  if (!charging && wasCharging) {
    if (mode == M_CHARGE) setMode(chargeReturn);
    toast("unplugged", 1200);
  }
  static bool lowWarned = false, fullWarned = false;
  if (!charging && batPct <= 15 && !lowWarned && vHistN > 3) { lowWarned = true; toast("battery low", 2500); }
  if (batPct >= 20) lowWarned = false;
  if (charging && batPct >= 100 && !fullWarned) { fullWarned = true; toast("fully charged", 2500); }
  if (!charging) fullWarned = false;
}

void updatePet() {
  static uint32_t lastStepChk = 0;
  if (millis() - lastStepChk > 5000) { lastStepChk = millis(); stepDayCheck(); }
  if (millis() - petLastDecay > 10UL * 60 * 1000) {
    petLastDecay = millis();
    if (petMood > 0) { petMood--; prefs.putInt("petmood", petMood); }
  }
  if (moveTicks > 400) {              // carrying it around counts as a walk
    moveTicks = 0;
    if (petMood < 100) petMood++;
  }
}

void serviceTimers() {
  uint32_t now = millis();
  if (timerEndAt && (int32_t)(now - timerEndAt) >= 0) {
    timerEndAt = 0;
    alarmUntil = now + 20000;
    alarmNextBeep = 0;
    jbStop();
    touchActivity();
  }
  if (alarmUntil) {
    if (now > alarmUntil) alarmUntil = 0;
    else if (now >= alarmNextBeep) {
      alarmNextBeep = now + 900;
      tone(BUZZER, 2093, 110); tone(BUZZER, 2637, 110); tone(BUZZER, 3136, 160);
      lastInteraction = now;
    }
  }
  static uint32_t lastChk = 0;
  if (hourChime && !jbPlaying && now - lastChk > 1000) {
    lastChk = now;
    struct tm t;
    if (localNow(t) && t.tm_min == 0 && t.tm_hour != lastChimeHour) {
      lastChimeHour = t.tm_hour;
      tone(BUZZER, 2093, 90); tone(BUZZER, 2637, 140);
    }
  }
}
