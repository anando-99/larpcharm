// Larp Charm firmware: setup() and loop().
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Setup / loop ─────────────
int bootY = 54;
void bootLine(const char *k, const char *v, bool ok) {
  textAt(String("> ") + k, 24, bootY, 1, ACC);
  textAt(v, 216 - (int)strlen(v) * 6, bootY, 1, ok ? COL_WHITE : COL_AMBER);
  bootY += 14;
  gfx->flush();
  delay(60);
}

void setup() {
  pinMode(SYS_EN, OUTPUT);
  digitalWrite(SYS_EN, HIGH);
  pinMode(SYS_OUT, INPUT);
  pinMode(BUZZER, OUTPUT);

  Serial.setRxBufferSize(24576);                    // room for a whole recorded take (serialDev)
  Serial.begin(115200);
  setCpuFrequencyMhz(240);

  Wire.begin(I2C_SDA, I2C_SCL, 400000);
  prefs.begin("charm", false);
  loadPrefs();
  wxLoad();

  if (!gfx->begin(80000000)) Serial.println("display init failed");
  gfx->fillScreen(COL_BLACK);
  gfx->flush();
  pinMode(LCD_BL, OUTPUT);
  analogWrite(LCD_BL, brightness);

  // boot log: each line is a real check
  FB = gfx->getFramebuffer();
  snapAccent();
  {
    textAt("LARP//OS", 24, 22, 2, ACC);
    textAt("v" FW_VERSION, 130, 29, 1, COL_WHITE);
    gfx->drawFastHLine(24, 42, 192, ACC_DIM);
  }
  bootLine("display", "ST7789 240x280", true);

  touchInit();
  bootLine("touch", "CST816", true);
  imuInit();
  xTaskCreatePinnedToCore(recTask, "rec", 3072, nullptr, 3, nullptr, 0);   // the spell recorder's 100 Hz sampler (idle until used)
  bootLine("motion", imuOK ? "QMI8658" : "no reply", imuOK);
  initFx();

  photoBuf = (uint16_t *)ps_malloc(FB_BYTES);
  artBuf   = (uint16_t *)ps_malloc(FB_BYTES);
  artThumb = (uint16_t *)ps_malloc(NP_ART * NP_ART * 2);
  artSrc   = (uint16_t *)ps_malloc(ART_SRC * ART_SRC * 2);
  recBuf   = (int16_t *)ps_malloc(REC_MAX * 12);
  artJpg   = (uint8_t *)ps_malloc(ART_JPG_MAX);
  prevFb   = (uint16_t *)ps_malloc(FB_BYTES);
  jbNotesBuf = (uint8_t *)ps_malloc(MY_SONG_MAX * 2);
  bootLine("memory", (photoBuf && artBuf && artJpg && prevFb) ? "PSRAM ok" : "low", photoBuf && artBuf && artJpg && prevFb);
  xferBuf  = (uint8_t *)malloc(XBUF_SZ);
  if (!xferBuf) xferBuf = (uint8_t *)ps_malloc(XBUF_SZ);

  fsOK = FFat.begin(true);
  if (!fsOK) Serial.println("FFat mount failed - check Partition Scheme (16M Flash 3MB APP/9.9MB FATFS)");
  if (fsOK) {
    if (!FFat.exists("/s")) FFat.mkdir("/s");
    FFat.remove("/s/tmp.part");
    File f = FFat.open("/photo.bin", "r");
    if (f && photoBuf && f.size() == FB_BYTES) { f.read((uint8_t *)photoBuf, FB_BYTES); photoLoaded = true; }
    if (f) f.close();
  }
  scanMySongs();
  if (fsOK && FFat.exists("/show.bin")) FFat.remove("/show.bin");
  splInit();                                         // the spell network's buffers, its recordings, your taught spells             // left behind by the sing-along (removed in 8.7)
  bootLine("storage", fsOK ? "FFat ok" : "not mounted", fsOK);

  time_t e;
  if (rtcReadUTC(e)) setSystemTime(e);
  bootLine("clock", timeValid ? "RTC ok" : "needs sync", timeValid);

  layoutText();
  rxQueue = xQueueCreate(32, sizeof(Packet));
  authLoad();                                        // the browsers paired before (15_auth.ino)
  bleInit();
  bootLine("uplink", "BLE ready", true);
  updateBattery();
  char pw[16];
  snprintf(pw, sizeof(pw), "%d%% %.2fV", batPct, batVolts);
  bootLine("power", pw, batPct > 15);

  textAt("JACKING IN", 24, bootY + 12, 2, COL_WHITE);
  gfx->flush();
  sfx(2);
  delay(450);
  lastInteraction = millis();
  if (charging) { chargeReturn = mode; setMode(M_CHARGE, false); }
  else setMode(mode, false);
  glitchFrames = 5;
  klog("kernel: larp-os " FW_VERSION " up");
  klog("imu: %s", imuOK ? "qmi8658 online" : "no reply");
  klog("fs: %s", fsOK ? "ffat mounted" : "not mounted");
  klog("rtc: %s", timeValid ? "clock ok" : "needs sync");
}

// Turns changes in the charm's state into log lines for the deck's dmesg pane.
void klogWatch() {
  static bool inited = false, ble = false, chg = false;
  static int batBand = -1, songWas = -1;
  static uint32_t stepsBand = 0, timerWas = 0, alarmWas = 0;
  static String trackWas;
  if (!inited) {
    inited = true; ble = bleConnected; chg = charging; batBand = batPct / 10; stepsBand = stepsToday / 500;
    songWas = jbPlaying ? jbSong : -1; trackWas = npTitle;
    return;
  }
  if (bleConnected != ble) { ble = bleConnected; klog(ble ? "ble: link up" : "ble: link down"); }
  if (charging != chg) { chg = charging; klog(chg ? "pwr: charging, %d%%" : "pwr: on battery, %d%%", batPct); }
  if (batPct / 10 != batBand) { if (!charging && batPct / 10 < batBand) klog("pwr: battery %d%%, %.2fv", batPct, batVolts); batBand = batPct / 10; }
  if (stepsToday / 500 != stepsBand) { stepsBand = stepsToday / 500; if (stepsBand) klog("ped: %lu steps today", (unsigned long)stepsToday); }
  if ((timerEndAt != 0) != (timerWas != 0)) { if (timerEndAt) klog("tmr: armed, %lum", (unsigned long)((timerEndAt - millis() + 59999) / 60000)); timerWas = timerEndAt; }
  if ((alarmUntil != 0) && !alarmWas) klog("tmr: time's up");
  alarmWas = alarmUntil;
  int song = jbPlaying ? jbSong : -1;
  if (song != songWas) { songWas = song; if (song >= 0) klog("snd: %s", songName(song)); }
  if (npTitle != trackWas) { trackWas = npTitle; if (npTitle.length()) klog("np: %s", asciiOnly(npTitle).c_str()); }
}

// ───────────── USB serial, for development and the tools ─────────────
// One line per command (newline-terminated). Single keys: r the spell recorder, c the cast screen, k the next wand
// view, t a 2 s timed take, x close it. Words:
//   mode <n> · view <v> · choose        open a screen / a spell-screen view / the deck's window chooser
//   shot                                the screen as "SHOT 240 280 <base64 RGB565, little-endian>"
//   take <base64>                       cast a recorded take (raw rows of ax ay az gx gy gz) without its action;
//                                       prints "CAST <spell> <similarity> <power>" and "EMB <32 numbers>"
//   demo np|art|sketch|wx|card|clear    sample content for screenshots (in memory only; reboot to drop it)
//   time <unix seconds> <utc offset, minutes>   set the clock
//   pkt <base64>                        handle a Bluetooth packet as if it came over the air; the answers come back as
//                                       "NOTE <text>" (firmware/tools/test_link.py tests pairing and updates this way)
//   unpair                              forget every paired browser
//   reboot
// Used by firmware/tools/screens.py (the screen gallery) and firmware/tools/spells/device_eval.py.
static size_t b64dec(const char *s, size_t n, uint8_t *o, size_t cap) {
  auto v = [](char c) -> int { return c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : c == '/' ? 63 : -1; };
  size_t k = 0; uint32_t acc = 0; int bits = 0;
  for (size_t i = 0; i < n; i++) {
    int x = v(s[i]); if (x < 0) continue;
    acc = (acc << 6) | x; bits += 6;
    if (bits >= 8) { bits -= 8; if (k < cap) o[k++] = (acc >> bits) & 0xFF; }
  }
  return k;
}
void serialShot() {
  if (!FB) { Serial.println("SHOT 0 0 "); return; }
  Serial.printf("SHOT %d %d ", SCR_W, SCR_H);
  const uint8_t *src = (const uint8_t *)FB; char out[1028];
  for (uint32_t off = 0; off < FB_BYTES; off += 768) { size_t k = b64(src + off, min<uint32_t>(768, FB_BYTES - off), out); Serial.write((const uint8_t *)out, k); }
  Serial.println();
}
void serialDemo(const String &w) {
  if (w == "np") {
    npTitle = "I Thought I Saw Your Face Today"; npArtist = "She & Him"; npPlaying = true; npPosMs = 27000; npDurMs = 170000;
    npStamp = millis(); npColor = c565(90, 120, 255); npVol = 72; npShuffle = true; npRepeat = 1; npDevice = "MacBook Pro";
  } else if (w == "art" && artSrc) {                // a soft painted cover
    for (int y = 0; y < ART_SRC; y++) for (int x = 0; x < ART_SRC; x++) {
      float dx = x - 150, dy = y - 160, r = sqrtf(dx * dx + dy * dy) / 150;
      float k = constrain(1.1f - r, 0.0f, 1.0f);
      artSrc[y * ART_SRC + x] = c565(245 - (int)(20 * r), 225 - (int)(60 * r) + (int)(25 * k), 170 - (int)(150 * k));
    }
    artMakeViews(ART_SRC, ART_SRC); artLoaded = true;
  } else if (w == "sketch" && skX) {                // a star, drawn in one stroke
    skN = 0;
    for (int i = 0; i <= 10 * 8; i++) {
      int a = i / 8, b = (a + 1) % 10; float u = (i % 8) / 8.0f;
      float aa = -1.5708f + a * 2.5133f, bb = -1.5708f + b * 2.5133f;
      skX[skN] = (int16_t)(114 + 76 * ((1 - u) * cosf(aa) + u * cosf(bb))); skY[skN] = (int16_t)(100 + 76 * ((1 - u) * sinf(aa) + u * sinf(bb))); skN++;
    }
    skPx = skX[skN - 1]; skPy = skY[skN - 1];
  } else if (w == "wx") {
    wx.have = true; wx.isDay = true; wx.fahr = false; wx.cond = WX_RAIN; wx.t = 12; wx.feels = 9; wx.hi = 15; wx.lo = 8; wx.hum = 82; wx.wind = 14; wx.rain = 70;
    wx.hn = 4; const uint8_t hh[4] = {14, 15, 16, 17}, hc[4] = {WX_RAIN, WX_DRIZZLE, WX_PARTLY, WX_CLEAR}; const int8_t ht[4] = {12, 12, 13, 11};
    for (int i = 0; i < 4; i++) { wx.hHour[i] = hh[i]; wx.hCond[i] = hc[i]; wx.hT[i] = ht[i]; }
    snprintf(wx.place, sizeof(wx.place), "Tokyo"); wx.at = millis() - 180000;
  } else if (w == "card") {
    cardName = "your name"; cardSub = "tap for portfolio"; petName = "mochi"; textMsg = "hello :)"; layoutText();
  } else if (w == "clear") { mapStarN = 0; castKind = -1; }
  Serial.printf("OK demo %s\n", w.c_str());
}
void serialCmd(const String &l) {
  int sp = l.indexOf(' ');
  String w = sp < 0 ? l : l.substring(0, sp), a = sp < 0 ? String("") : l.substring(sp + 1);
  if (w == "mode") { int m = a.toInt(); if (m != mode) { deckChoose = false; if (mode == M_DECK) openModule(m); else setMode(m); } lastFrame = 0; Serial.printf("OK mode %d\n", mode); }
  else if (w == "view") { if (mode != M_CAST) setMode(M_CAST); wandSet(a.toInt()); Serial.printf("OK view %d\n", wandView); }
  else if (w == "choose") { if (mode != M_DECK) setMode(M_DECK); deckChoose = !deckChoose; deckChooseAt = millis(); Serial.println("OK choose"); }
  else if (w == "shot") serialShot();
  else if (w == "take" && recBuf) {
    size_t n = b64dec(a.c_str(), a.length(), (uint8_t *)recBuf, REC_MAX * 12) / 12;
    if (mode != M_CAST) setMode(M_CAST);
    wandView = 0; recLastN = n;
    castRun(); castActed = true;                     // the effect plays; the spell does nothing
    Serial.printf("CAST %s %.4f %.3f\n", castKind == 99 ? "-" : splName(castKind), castSim, castPower);
    Serial.print("EMB"); for (int e = 0; e < SPL_EMB; e++) Serial.printf(" %.6f", castEmb[e]); Serial.println();
  }
  else if (w == "demo") serialDemo(a);
  else if (w == "pkt") {
    static uint8_t pk[600];
    size_t n = b64dec(a.c_str(), a.length(), pk, sizeof(pk));
    serialLink = true; handlePacket(pk, n); serialLink = false;
    Serial.println("OK pkt");
  }
  else if (w == "unpair") { authForgetAll(); Serial.println("OK unpair"); }
  else if (w == "time") { int s2 = a.indexOf(' '); time_t e = (time_t)strtoul(a.c_str(), nullptr, 10); tzMin = s2 > 0 ? a.substring(s2 + 1).toInt() : tzMin; setSystemTime(e); rtcWriteUTC(e); Serial.println("OK time"); }
  else if (w == "reboot") { Serial.println("OK reboot"); delay(50); ESP.restart(); }
  else Serial.printf("ERR %s\n", w.c_str());
}
void serialKey(char c) {
  if (c == 'r' && mode != M_REC) openModule(M_REC);
  else if (c == 'c' && mode != M_CAST) openModule(M_CAST);
  else if (c == 't' && (mode == M_REC || mode == M_CAST)) recStart(false, 2000);
  else if (c == 'x' && (mode == M_REC || mode == M_CAST)) closeModule();
  else if (c == 'k' && mode == M_CAST) wandSet(wandView + 1);
}
String serLine;
void serialDev() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serLine.length() == 1) serialKey(serLine[0]); else if (serLine.length()) serialCmd(serLine);
      serLine = "";
    } else if (serLine.length() < 24000) serLine += c;
  }
}

void loop() {
  static Packet pkt;
  bool gotData = false;
  int handled = 0;
  while (handled < 40 && xQueueReceive(rxQueue, &pkt, 0) == pdTRUE) {
    handlePacket(pkt.data, pkt.len);
    if (pkt.len && pkt.data[0] == CMD_XFER_DATA) gotData = true;
    handled++;
  }
  if (xferAbort) { xferAbort = false; if (xferActive) xferCleanup(); }
  if (gotData && xferActive && xferGot != xferAcked && uxQueueMessagesWaiting(rxQueue) == 0) {
    char b[24]; snprintf(b, sizeof(b), "ack=%lu", (unsigned long)xferGot);
    notifyText(b);
    xferAcked = xferGot;
  }

  handleTouch();
  handleButton();
  klogWatch();
  if (imuUpdate()) onShake();
  recPoll();
  castPoll();
  wandPoll();
  serialDev();
  serviceTimers();
  updateBattery();
  updatePet();

  jbService();
  uint32_t idleLimit = mode == M_TORCH || mode == M_REC ? 300000UL : sleepSec * 1000UL;   // the torch stays on for 5 minutes
  if (!sleeping && sleepSec > 0 && !xferActive && !alarmUntil && millis() - lastInteraction > idleLimit) {
    uint8_t idleMode = idleKind == 1 ? M_EYES : idleKind == 2 ? M_TERM : M_CLAUDE;
    if (idleKind && !idleEyesOn && mode != M_TORCH && mode != idleMode && mode != M_CHARGE) {
      idleReturn = mode;
      setMode(idleMode);
      idleEyesOn = true;
      if (idleMode == M_EYES) setExpr(E_SLEEPY, 600000);
      chromeUntil = 0;
      analogWrite(LCD_BL, max(10, brightness / 3));
      lastInteraction = millis();
    } else {
      if (idleEyesOn) { idleEyesOn = false; exprAuto = true; setMode(idleReturn); }
      if (mode == M_TORCH) setMode(M_DECK);
      sleeping = true;
      analogWrite(LCD_BL, 0);
    }
  }

  // tell the web app straight away when the screen changes, so its preview follows the charm
  static uint32_t lastSig = 0;
  uint32_t sig = mode | (theme << 5) | ((uint32_t)npBig << 8) | ((uint32_t)toyKind << 9) | ((uint32_t)(exprAuto ? 255 : exprSet) << 13) | ((uint32_t)bgStyle << 21) | ((uint32_t)faceStyle << 26) | ((uint32_t)wandView << 28) | ((uint32_t)deckChoose << 30);
  if (bleConnected && (millis() - lastStatus > 15000 || jbDirty || (sig != lastSig && millis() - lastStatus > 120))) { lastStatus = millis(); jbDirty = false; lastSig = sig; sendStatus(); }

  if (sleeping) { delay(10); return; }

  uint32_t interval = (xferActive && xferKind != 3) ? 150 : 33;
  if (millis() - lastFrame >= interval) {
    lastFrame = millis();
    render();
  }
}
