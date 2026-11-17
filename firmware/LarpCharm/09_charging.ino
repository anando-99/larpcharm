// Larp Charm firmware: The charging screen.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v5: charging screen ═════════════
uint8_t chargeReturn = M_DECK;

void drawChargeDeck() {
  gfx->fillScreen(COL_VOID);
  for (int y = 40; y < 250; y += 20) for (int x = 20; x < SCR_W; x += 20) gfx->drawPixel(x, y, ACC_LOW);
  topBar("//POWER", true);
  uint16_t col = charging ? COL_LIME : ACC;
  int p = batPct, nd = p >= 100 ? 3 : p >= 10 ? 2 : 1, dw = 34, dt = 7, gap = 8;
  int x = (SCR_W - (nd * dw + (nd - 1) * gap + 30)) / 2;
  char s[4]; snprintf(s, sizeof(s), "%d", p);
  for (int i = 0; i < nd; i++) segDigit(x + i * (dw + gap), 48, dw, 64, dt, s[i] - '0', col, mix565(col, COL_BLACK, 220));
  textAt("%", x + nd * (dw + gap), 88, 3, col);
  hudPanel(22, 132, 186, 52, col, 1);
  gfx->fillRect(208, 148, 8, 20, col);
  int lit = (p + 9) / 10;
  for (int i = 0; i < 10; i++) {
    bool on = i < lit - 1 || (i == lit - 1 && (!charging || (millis() / 400) % 2));
    gfx->fillRect(30 + i * 17, 140, 14, 36, on ? col : mix565(col, COL_BLACK, 215));
  }
  if (charging) {
    int py = (millis() / 30) % 40;
    for (int k = 0; k < 4; k++) gfx->fillRect(118, 196 + (py + k * 10) % 40, 4, 4, mix565(col, COL_BLACK, k * 50));
  }
  char b[32];
  snprintf(b, sizeof(b), "%s  %.2fV", charging ? (p >= 99 ? "FULL" : "CHARGING") : "ON BATTERY", batVolts);
  textCentered(b, 244, 1, COL_WHITE);
}

void drawCharge() { drawChargeDeck(); }
