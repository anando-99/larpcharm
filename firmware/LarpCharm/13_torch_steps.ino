// Larp Charm firmware: The torch and the step counter.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v5: torch ═════════════
const uint16_t TORCH_COL[4] = { COL_WHITE, c565(255, 206, 150), c565(255, 0, 0), c565(120, 230, 255) };
const char *TORCH_NAMES[4] = {"white", "warm", "red", "ice"};
uint8_t torchCol = 0;
void drawTorch() {
  gfx->fillScreen(TORCH_COL[torchCol & 3]);
  if (millis() < chromeUntil) {
    textCentered("TAP: COLOUR  SWIPE DOWN: OFF", 252, 1, c565(90, 90, 90));
  }
}

// ═════════════ v5: step counter ═════════════
void stepFeed(float x, float y, float z, uint32_t now) {
  float m = sqrtf(x * x + y * y + z * z);
  stepLP = stepLP * 0.7f + m * 0.3f;
  if (!stepArmed && stepLP < 1.03f) stepArmed = true;
  if (stepArmed && stepLP > 1.17f && now - lastStepAt > 260) {
    stepArmed = false;
    if (now - lastStepAt > 2000) stepRun = 0;
    lastStepAt = now;
    if (stepRun < 255) stepRun++;
    if (stepRun == 5) stepsToday += 5;                  // ignore single bumps: count once a rhythm starts
    else if (stepRun > 5) stepsToday++;
  }
}
void stepDayCheck() {
  struct tm t;
  if (!localNow(t)) return;
  if (stepDay != t.tm_yday) {
    if (stepDay >= 0) stepsToday = 0;
    stepDay = t.tm_yday;
    prefs.putShort("sday", stepDay);
    prefs.putULong("steps", stepsToday);
  }
  if (stepsToday - stepsSaved >= 200) { stepsSaved = stepsToday; prefs.putULong("steps", stepsToday); petMood = min(100, petMood + 1); }
}
