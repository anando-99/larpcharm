// Larp Charm firmware: The spell recorder: 100 Hz accelerometer + gyro takes for training data.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ 9.1: the spell recorder ═════════════
// For teaching the charm air-gesture "spells". The website's spells tab picks what to record (a label, how
// many takes); you hold your thumb on the screen while you draw the gesture in the air, and the take goes to
// the website as raw accelerometer + gyro samples at 100 Hz. The website can also start timed takes (the
// calibration ones, with the charm lying untouched). The gyro is on only while this screen is open.
// A task on core 0 samples the sensor at exactly 100 Hz, so drawing the screen can't make the timing jitter.
#define REC_HZ    100
#define REC_MAX   1200                 // 12 s
#define REC_LIVE  128
#define REC_A_LSB 4096                 // accelerometer +-8 g
#define REC_G_LSB 16                   // gyro +-2048 dps
int16_t *recBuf = nullptr;             // REC_MAX x [ax ay az gx gy gz], raw
volatile uint16_t recN = 0, recMissed = 0;
int16_t  recLive[REC_LIVE][6];
volatile uint16_t recLiveHead = 0;
String   recLabel = "", recHint = "";
uint16_t recTake = 0, recGoal = 0, recId = 0, recLastN = 0;
uint8_t  recState = 0;                 // 0 ready, 1 recording, 2 sending, 3 sent, 4 too short, 5 no link
uint32_t recStateAt = 0, recStartAt = 0, recTimedMs = 0;
bool     recByThumb = false;
const uint16_t REC_COL[6] = {c565(255, 96, 96), c565(96, 224, 128), c565(96, 160, 255), c565(255, 176, 64), c565(200, 120, 255), c565(80, 230, 230)};

bool imuRead6(int16_t *v) {
  Wire.beginTransmission(IMU_ADDR); Wire.write(0x35);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)IMU_ADDR, (uint8_t)12) != 12) return false;
  uint8_t b[12];
  for (int i = 0; i < 12; i++) b[i] = Wire.read();
  for (int i = 0; i < 6; i++) v[i] = imuBE ? (int16_t)((b[2 * i] << 8) | b[2 * i + 1]) : (int16_t)((b[2 * i + 1] << 8) | b[2 * i]);
  return true;
}

void recTask(void *) {
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    if (!recSampling) { vTaskDelay(pdMS_TO_TICKS(20)); last = xTaskGetTickCount(); continue; }
    if (xTaskDelayUntil(&last, pdMS_TO_TICKS(1000 / REC_HZ)) == pdFALSE && recOn) recMissed++;
    int16_t v[6];
    if (!imuRead6(v)) { if (recOn) recMissed++; continue; }
    memcpy(recLive[recLiveHead % REC_LIVE], v, sizeof(v));
    recLiveHead++;
    if (recOn && recBuf && recN < REC_MAX) { memcpy(recBuf + recN * 6, v, sizeof(v)); recN++; }
  }
}

// accelerometer +-8 g and gyro +-2048 dps at 224 Hz with a ~30 Hz low-pass, sampled at 100 Hz; back to normal after
void recSensor(bool on) {
  if (!imuOK) return;
  if (on) {
    imuWrite(0x03, 0x25); imuWrite(0x04, 0x75); imuWrite(0x06, 0x77); imuWrite(0x08, 0x03);
    delay(60);
    recSampling = true;
  } else {
    recSampling = false; recOn = false;
    delay(25);
    imuWrite(0x08, 0x01); imuWrite(0x06, 0x00); imuWrite(0x04, 0x00); imuWrite(0x03, 0x16);
  }
}

static size_t b64(const uint8_t *s, size_t n, char *o) {
  static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t k = 0;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = s[i] << 16 | (i + 1 < n ? s[i + 1] << 8 : 0) | (i + 2 < n ? s[i + 2] : 0);
    o[k++] = T[(v >> 18) & 63]; o[k++] = T[(v >> 12) & 63];
    o[k++] = i + 1 < n ? T[(v >> 6) & 63] : '=';
    o[k++] = i + 2 < n ? T[v & 63] : '=';
  }
  return k;
}

// rec0=id,samples,hz,accel lsb/g,gyro lsb/dps,missed,trigger   rec1=id,seq,base64 (360 bytes)   rec2=id,chunks,bytesum
void recSend(bool fresh) {
  if (!recBuf || !recLastN) return;
  if (fresh) recId++;
  recState = 2;
  char b[512];
  snprintf(b, sizeof(b), "rec0=%u,%u,%u,%u,%u,%u,%c", recId, recLastN, REC_HZ, REC_A_LSB, REC_G_LSB, recMissed, recByThumb ? 't' : 'w');
  notifyText(b); delay(20);
  const uint8_t *src = (const uint8_t *)recBuf;
  uint32_t bytes = (uint32_t)recLastN * 12, sum = 0;
  uint16_t seq = 0;
  for (uint32_t off = 0; off < bytes; off += 360, seq++) {
    uint32_t len = min<uint32_t>(360, bytes - off);
    int k = snprintf(b, sizeof(b), "rec1=%u,%u,", recId, seq);
    k += b64(src + off, len, b + k);
    b[k] = 0;
    for (uint32_t i = 0; i < len; i++) sum += src[off + i];
    notifyText(b); delay(20);
  }
  snprintf(b, sizeof(b), "rec2=%u,%u,%lu", recId, seq, (unsigned long)sum);
  notifyText(b);
  recState = 3; recStateAt = millis();
}

void recStart(bool thumb, uint32_t timedMs) {
  if (!recSampling || recOn || recState == 2) return;
  recN = 0; recMissed = 0;
  recByThumb = thumb; recTimedMs = min<uint32_t>(timedMs, REC_MAX * 10); recStartAt = millis();
  recOn = true; recState = 1; recStateAt = millis();
  if (bleConnected) notifyText("recst=1");
}

void recStop() {
  if (!recOn) return;
  recOn = false;
  delay(12);                                         // let the sampler finish the sample it is on
  if (bleConnected) notifyText("recst=0");
  if (mode == M_CAST && (wandView == 1 || wandView == 2)) { wandEnd(); return; }      // the knob and the pen don't cast
  if (recN < 30) { recState = 4; recStateAt = millis(); sfx(4); if (mode == M_CAST) toast("too short", 700); return; }     // under 0.3 s
  recLastN = recN;
  if (mode == M_CAST && wandView == 3) { recState = 0; castRun(); castActed = true; return; }   // the map: explore, no actions
  if (mode == M_CAST) { recState = 0; castRun(); return; }
  {                                                  // a summary on USB serial, for checking the sampler
    long m[6] = {0}; int peak = 0;
    for (int i = 0; i < recLastN; i++) { for (int c = 0; c < 6; c++) m[c] += recBuf[i * 6 + c]; peak = max(peak, abs((int)recBuf[i * 6 + 3]) + abs((int)recBuf[i * 6 + 4]) + abs((int)recBuf[i * 6 + 5])); }
    Serial.printf("rec: n=%u missed=%u ms=%lu mean a=%.3f,%.3f,%.3f g  w=%.2f,%.2f,%.2f dps  peak|w|1=%d dps\n", recLastN, recMissed, (unsigned long)(millis() - recStartAt),
                  m[0] / (float)recLastN / REC_A_LSB, m[1] / (float)recLastN / REC_A_LSB, m[2] / (float)recLastN / REC_A_LSB,
                  m[3] / (float)recLastN / REC_G_LSB, m[4] / (float)recLastN / REC_G_LSB, m[5] / (float)recLastN / REC_G_LSB, peak / REC_G_LSB);
  }
  if (!bleConnected) { recState = 5; recStateAt = millis(); return; }
  klog("rec: %s, %u.%02us", recLabel.length() ? recLabel.c_str() : "take", recLastN / 100, recLastN % 100);
  recSend(true);
}

void recPoll() {
  if (mode != M_REC && mode != M_CAST) return;
  lastInteraction = millis();                        // no sleeping in the middle of a session
  if (recOn && ((!recByThumb && millis() - recStartAt >= recTimedMs) || recN >= REC_MAX)) recStop();
}

// the path the charm's pointing direction took, from the gyro (bias taken from the still start of the take).
// Sensor axes (from the calibrate takes): +X screen top, +Y right edge, +Z into the screen; the back of the
// charm swings left as it turns about +X and up as it turns about +Y.
void recStroke(int x0, int y0, int w, int h, uint16_t col) {
  uint16_t n = recOn ? recN : recLastN;
  if (n < 6 || !recBuf) return;
  int nb = min<int>(20, n);
  float bx = 0, by = 0;
  for (int i = 0; i < nb; i++) { bx += recBuf[i * 6 + 3]; by += recBuf[i * 6 + 4]; }
  bx /= nb; by /= nb;
  const float k = 1.0f / REC_G_LSB / REC_HZ;            // raw -> degrees per sample
  float px = 0, py = 0, mnx = 0, mxx = 0, mny = 0, mxy = 0;
  for (int i = 0; i < n; i++) {
    px -= (recBuf[i * 6 + 3] - bx) * k; py -= (recBuf[i * 6 + 4] - by) * k;
    mnx = min(mnx, px); mxx = max(mxx, px); mny = min(mny, py); mxy = max(mxy, py);
  }
  float span = max(max(mxx - mnx, mxy - mny), 8.0f), s = min(w - 16, h - 16) / span;
  float cx = x0 + w / 2 - (mnx + mxx) / 2 * s, cy = y0 + h / 2 - (mny + mxy) / 2 * s;
  px = py = 0;
  int lx = (int)cx, ly = (int)cy;
  for (int i = 0; i < n; i++) {
    px -= (recBuf[i * 6 + 3] - bx) * k; py -= (recBuf[i * 6 + 4] - by) * k;
    int x = (int)(cx + px * s), y = (int)(cy + py * s);
    gfx->drawLine(lx, ly, x, y, mix565(ACC_DIM, col, min(255, i * 255 / max(1, (int)n - 1))));
    lx = x; ly = y;
  }
  gfx->fillCircle(lx, ly, 3, COL_WHITE);
}

void drawRec() {
  uint32_t now = millis();
  gfx->fillScreen(TTY_BG);
  char b[48];
  textAt("$", 14, 3, 1, ACC); textAt("spell --rec", 26, 3, 1, COL_WHITE);
  textAt(imuOK ? "100hz" : "no imu", 196, 3, 1, imuOK ? TTY_DIM : COL_RED);

  // what to record, and how many so far
  String lab = recLabel.length() ? recLabel : String("no label");
  if (lab.length() > 12) lab = lab.substring(0, 12);
  textAt(lab, 12, 20, 2, recLabel.length() ? COL_WHITE : TTY_DIM);
  if (recGoal) {
    snprintf(b, sizeof(b), "%u/%u", recTake, recGoal);
    textAt(b, 228 - (int)strlen(b) * 12, 20, 2, recTake >= recGoal ? COL_LIME : ACC);
  }
  String h = recLabel.length() ? recHint : String("pick one in the spells tab");
  textAt(h.substring(0, 36), 12, 40, 1, TTY_DIM);
  if (h.length() > 36) textAt(h.substring(36, 72), 12, 50, 1, TTY_DIM);

  // the box: live sensor traces when idle, the stroke while and after recording
  const int bx = 6, by = 68, bw = 228, bh = 118;
  bool showStroke = recOn || ((recState == 2 || recState == 3) && now - recStateAt < 2500);
  ttyPane(bx, by, bw, bh, showStroke ? "stroke" : "imu --raw", recOn);
  if (showStroke) recStroke(bx, by, bw, bh, recOn ? COL_RED : ACC);
  else {
    uint16_t head = recLiveHead;
    for (int ch = 0; ch < 6; ch++) {
      bool gyro = ch >= 3;
      int mid = gyro ? by + 89 : by + 31;
      float sc = gyro ? 26.0f / (400.0f * REC_G_LSB) : 26.0f / (2.0f * REC_A_LSB);
      if (ch == 0 || ch == 3) for (int x = bx + 4; x < bx + bw - 4; x += 4) gfx->drawPixel(x, mid, ACC_LOW);
      int lx = 0, ly = 0;
      for (int i = 0; i < REC_LIVE - 1; i++) {
        int16_t v = recLive[(uint16_t)(head + i) % REC_LIVE][ch];
        int x = bx + 4 + i * (bw - 8) / (REC_LIVE - 1), y = constrain(mid - (int)(v * sc), mid - 27, mid + 27);
        if (i) gfx->drawLine(lx, ly, x, y, REC_COL[ch]);
        lx = x; ly = y;
      }
    }
    textAt("acc", bx + 6, by + 6, 1, TTY_DIM); textAt("gyro", bx + 6, by + 64, 1, TTY_DIM);
  }

  // what's happening
  int sy = 196;
  if (recOn) {
    float t = (now - recStartAt) / 1000.0f;
    if ((now / 300) % 2) gfx->fillCircle(17, sy + 3, 4, COL_RED);
    snprintf(b, sizeof(b), "REC %.2fs", t);
    textAt(b, 26, sy - 4, 2, COL_RED);
    if (!recByThumb && recTimedMs) {
      snprintf(b, sizeof(b), "/ %.0fs", recTimedMs / 1000.0f);
      textAt(b, 150, sy, 1, TTY_DIM);
      gfx->fillRect(12, sy + 16, 216, 3, ACC_LOW);
      gfx->fillRect(12, sy + 16, (int)(216 * min(1.0f, (now - recStartAt) / (float)recTimedMs)), 3, COL_RED);
    } else textAt("let go to stop", 12, sy + 16, 1, TTY_DIM);
  } else {
    const char *msg; uint16_t col = TTY_TEXT;
    bool fresh = now - recStateAt < 2200;
    if (recState == 2) { msg = "sending..."; col = ACC; }
    else if (recState == 3 && fresh) { msg = "ok: take saved"; col = COL_LIME; }
    else if (recState == 4 && fresh) { msg = "too short: hold longer"; col = COL_AMBER; }
    else if (recState == 5 && fresh) { msg = "no link: take not saved"; col = COL_RED; }
    else if (!bleConnected) { msg = "no link: open spells tab"; col = COL_AMBER; }
    else msg = "hold thumb, draw, let go";
    textAt(msg, 12, sy, 1, col);
    if (col == TTY_TEXT && (now / 500) % 2) gfx->fillRect(12 + strlen(msg) * 6 + 4, sy - 1, 6, 9, ACC);
    textAt("still 0.5s, draw, still 0.5s", 12, sy + 14, 1, TTY_DIM);
  }

  // live readout
  int16_t v[6]; memcpy(v, recLive[(uint16_t)(recLiveHead - 1) % REC_LIVE], sizeof(v));
  float am = sqrtf((float)v[0] * v[0] + (float)v[1] * v[1] + (float)v[2] * v[2]) / REC_A_LSB;
  float gm = sqrtf((float)v[3] * v[3] + (float)v[4] * v[4] + (float)v[5] * v[5]) / REC_G_LSB;
  const char *nm[6] = {"ax", "ay", "az", "gx", "gy", "gz"};
  for (int i = 0; i < 6; i++) textAt(nm[i], 12 + i * 20, 228, 1, REC_COL[i]);
  snprintf(b, sizeof(b), "|a| %.2fg", am); textAt(b, 136, 228, 1, TTY_TEXT);
  snprintf(b, sizeof(b), "|w| %.0f dps", gm); textAt(b, 136, 240, 1, TTY_TEXT);
  textAt("pwr: exit", 12, 240, 1, TTY_DIM);
}
