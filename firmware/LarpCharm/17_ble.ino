// Larp Charm firmware: Bluetooth: status notifications, file transfers, command handling, the GATT server.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Status notifications ─────────────
void notifyText(const char *s) {
  if (!authed && strncmp(s, "auth=", 5)) return;            // a locked link hears nothing but pairing
  if (serialLink) { Serial.printf("NOTE %s\n", s); return; }  // the packet came over USB (tests)
  if (!statusChar || !bleConnected) return;
  statusChar->setValue((const uint8_t *)s, strlen(s));
  statusChar->notify();
}

void sendStatus(const char *extra = nullptr) {
  char buf[300];
  unsigned long used = fsOK ? (unsigned long)FFat.usedBytes() : 0;
  unsigned long total = fsOK ? (unsigned long)FFat.totalBytes() : 0;
  snprintf(buf, sizeof(buf), "b=%d;v=%.2f;c=%d;m=%d;fw=%s;fs=%lu,%lu;lk=%d,%d;imu=%d;toy=%d;th=%d;st=%lu;eye=%d;jb=%d;q=%d;nb=%d;wv=%d;ch=%d%s%s",
           batPct, batVolts, charging ? 1 : 0, mode, FW_VERSION, used, total,
           bgStyle, faceStyle, imuOK ? 1 : 0, toyKind, theme, (unsigned long)stepsToday,
           exprAuto ? 255 : exprSet, jbPlaying ? jbSong : -1, jbQLen, npBig ? 1 : 0, wandView, deckChoose ? 1 : 0,
           extra ? ";" : "", extra ? extra : "");
  notifyText(buf);
}

// ───────────── Transfers ─────────────
void xferCleanup() {
  if (xferKind == 6) otaAbort();
  if (xferFile) xferFile.close();
  if (xferKind == 2 && fsOK) FFat.remove("/c/tmp.part");
  if (xferKind == 4 && fsOK) FFat.remove("/s/tmp.part");
  xferActive = false;
  xferBufLen = 0;
}

void xferFlush() {
  if ((xferKind == 2 || xferKind == 4) && xferFile && xferBufLen) { xferFile.write(xferBuf, xferBufLen); xferBufLen = 0; }
}

// decodes the album-cover JPEG into its own buffer (up to 280x280)
int jpegToArt(JPEGDRAW *p) {
  if (p->x < 0 || p->x >= ART_SRC) return 1;
  int w = min((int)p->iWidth, ART_SRC - (int)p->x);
  for (int row = 0; row < p->iHeight; row++) {
    int y = p->y + row;
    if (y < 0 || y >= ART_SRC) continue;
    memcpy(artSrc + y * ART_SRC + p->x, p->pPixels + row * p->iWidth, w * 2);
  }
  return 1;
}

static uint32_t rdU32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

void xferBegin(const uint8_t *p, uint16_t len) {
  if (xferActive) xferCleanup();
  if (len < 5) { sendStatus("xfer=err;why=bad"); return; }
  xferKind = p[0];
  xferSize = rdU32(p + 1);
  xferId = len >= 9 ? rdU32(p + 5) : 0;
  xferGot = xferAcked = 0;
  xferBufLen = 0;
  bool ok = false;
  const char *why = "bad";
  if (xferKind == 0)      { ok = photoBuf && xferSize == FB_BYTES; if (ok) photoLoaded = false; }
  else if (xferKind == 3) { ok = artSrc && artJpg && xferSize > 100 && xferSize <= ART_JPG_MAX; }
  else if (xferKind == 6) {                        // new firmware (16_ota.ino), with its SHA-256 after the header
    why = !authed ? "locked" : len < 41 ? "bad" : "ota";
    ok = len >= 41 && otaBegin(xferSize, p + 9);
  }
  else if (xferKind == 4) {                        // a song: written to /s/<slot>.sng
    int slot = -1;
    for (int i = 0; i < MY_SONGS; i++) if (!mySongHas[i]) { slot = i; break; }
    if (!fsOK) why = "nofs";
    else if (slot < 0) why = "full";
    else if (xferSize <= sizeof(SongHdr) || xferSize > sizeof(SongHdr) + MY_SONG_MAX * 2) why = "bad";
    else { xferId = slot; FFat.remove("/s/tmp.part"); xferFile = FFat.open("/s/tmp.part", "w"); ok = (bool)xferFile && xferBuf; if (!ok) why = "open"; }
  }
  if (!ok) { char b[32]; snprintf(b, sizeof(b), "xfer=err;why=%s", why); sendStatus(b); return; }
  xferActive = true;
  xferAbort = false;
}

void xferData(const uint8_t *p, uint16_t len) {
  if (!xferActive) return;
  uint32_t take = min<uint32_t>(len, xferSize - xferGot);
  if (xferKind == 0)      memcpy((uint8_t *)photoBuf + xferGot, p, take);
  else if (xferKind == 3) memcpy(artJpg + xferGot, p, take);
  else if (xferKind == 4) { memcpy(xferBuf + xferBufLen, p, take); xferBufLen += take; if (xferBufLen > XBUF_SZ - 520) xferFlush(); }
  else if (xferKind == 6) { if (!otaWrite(p, take)) { xferCleanup(); sendStatus("xfer=err;why=write"); return; } }
  else {
    uint32_t off = 0;
    while (off < take) {
      uint32_t n = min<uint32_t>(take - off, XBUF_SZ - xferBufLen);
      memcpy(xferBuf + xferBufLen, p + off, n);
      xferBufLen += n; off += n;
      if (xferBufLen == XBUF_SZ) xferFlush();
    }
  }
  xferGot += take;
}

void xferEnd() {
  if (!xferActive || xferGot != xferSize) { xferCleanup(); sendStatus("xfer=err;why=short"); return; }
  if (xferKind == 6) {
    xferActive = false;
    const char *why = otaEnd();
    if (why) { char b[40]; snprintf(b, sizeof(b), "xfer=err;why=%s", why); sendStatus(b); klog("ota: failed (%s)", why); return; }
    char b[32]; snprintf(b, sizeof(b), "ack=%lu", (unsigned long)xferGot);
    notifyText(b);
    sendStatus("xfer=ok");
    otaRestart();
    return;
  }
  if (xferKind == 0) {
    photoLoaded = true;
    if (fsOK) { File f = FFat.open("/photo.bin", "w"); if (f) { f.write((uint8_t *)photoBuf, FB_BYTES); f.close(); } }
    xferActive = false;
    setMode(M_PHOTO, false);
    klog("fs: photo.bin %luk", (unsigned long)(xferSize / 1024));
  } else if (xferKind == 3) {
    xferActive = false;
    bool ok = false;
    if (jpeg.openRAM(artJpg, xferSize, jpegToArt)) {
      jpeg.setPixelType(RGB565_LITTLE_ENDIAN);
      int aw = jpeg.getWidth(), ah = jpeg.getHeight();
      ok = jpeg.decode(0, 0, 0);
      jpeg.close();
      if (ok) artMakeViews(aw, ah);
    }
    artLoaded = ok;
    if (!ok) { sendStatus("xfer=err;why=format"); return; }
  } else if (xferKind == 4) {
    xferFlush();
    xferFile.close();
    File f = FFat.open("/s/tmp.part", "r");
    SongHdr h;
    bool ok = f && f.read((uint8_t *)&h, sizeof(h)) == sizeof(h) && memcmp(h.magic, "LSNG", 4) == 0 && h.n > 0 && h.n <= MY_SONG_MAX && f.size() >= sizeof(h) + h.n * 2;
    if (f) f.close();
    if (!ok) { xferCleanup(); sendStatus("xfer=err;why=format"); return; }
    FFat.remove(mySongPath(xferId));
    FFat.rename("/s/tmp.part", mySongPath(xferId));
    xferActive = false;
    scanMySongs();
    jbCat = MY_CAT; jbSelId = 100 + xferId;
    toast("song added", 1200);
    klog("fs: song %d saved", 100 + (int)xferId);
  }
  char b[32]; snprintf(b, sizeof(b), "ack=%lu", (unsigned long)xferGot);
  notifyText(b);
  sendStatus("xfer=ok");
}

// ───────────── Command handling ─────────────
void handlePacket(const uint8_t *d, uint16_t n) {
  if (n == 0) return;
  if (!authed && d[0] != CMD_PING && d[0] != CMD_AUTH) {    // locked: only pairing gets through (15_auth.ino)
    static uint32_t lastNeed = 0;
    if (millis() - lastNeed > 1000) { lastNeed = millis(); notifyText("auth=need"); }
    return;
  }
  // background traffic (now-playing updates, album art, time sync) must not keep the screen awake
  bool quiet = d[0] == CMD_XFER_DATA || d[0] == CMD_NOWPLAYING || d[0] == CMD_PING || d[0] == CMD_TIME ||
               (d[0] == CMD_XFER_BEGIN && n >= 2 && d[1] == 3) || (d[0] == CMD_XFER_END && xferKind == 3);
  if (!quiet) touchActivity();
  else if (d[0] == CMD_XFER_DATA && xferKind != 3) lastInteraction = millis();
  const uint8_t *p = d + 1; uint16_t len = n - 1;
  switch (d[0]) {
    case CMD_MODE: if (len >= 1) setMode(p[0]); break;

    case CMD_TEXT:
      if (len >= 5) {
        textStyle = p[0] % TEXT_STYLES;
        textFg = (p[1] << 8) | p[2];
        textBg = (p[3] << 8) | p[4];
        textMsg = String((const char *)(p + 5), len - 5);
        layoutText();
        prefs.putString("text", textMsg); prefs.putUChar("tstyle", textStyle);
        prefs.putUShort("tfg", textFg);   prefs.putUShort("tbg", textBg);
        setMode(M_TEXT, false);
        klog("rx: motd, %u bytes", (unsigned)textMsg.length());
      }
      break;

    case CMD_TIME:
      if (len >= 6) {
        time_t e = rdU32(p);
        tzMin = (int16_t)(p[4] | (p[5] << 8));
        setSystemTime(e);
        rtcWriteUTC(e);
        prefs.putShort("tz", tzMin);
        klog("rtc: synced, utc%+d:%02d", tzMin / 60, abs(tzMin) % 60);
      }
      break;

    case CMD_NOWPLAYING:
      if (len >= 12) {
        npColor = c565(p[0], p[1], p[2]);
        npPlaying = p[3];
        npPosMs = rdU32(p + 4);
        npDurMs = rdU32(p + 8);
        npStamp = millis();
        String s((const char *)(p + 12), len - 12);
        int sep = s.indexOf('\x1F');
        String newTitle = sep >= 0 ? s.substring(0, sep) : s;
        static uint32_t titleAt = 0, artAskAt = 0;
        if (newTitle != npTitle) { artLoaded = false; npTitleX = 0; titleAt = millis(); }
        npTitle = newTitle;
        // title 0x1F artist [0x1F "vol,shuffle,repeat" 0x1F device]  (the extras arrived in 8.7)
        String rest = sep >= 0 ? s.substring(sep + 1) : "";
        int s2 = rest.indexOf('\x1F');
        npArtist = s2 >= 0 ? rest.substring(0, s2) : rest;
        npVol = -1; npShuffle = false; npRepeat = 0; npDevice = "";
        if (s2 >= 0) {
          String ex = rest.substring(s2 + 1);
          int s3 = ex.indexOf('\x1F');
          if (s3 >= 0) { npDevice = ex.substring(s3 + 1); ex = ex.substring(0, s3); }
          int vol = -1, sh = 0, rp = 0;
          if (sscanf(ex.c_str(), "%d,%d,%d", &vol, &sh, &rp) >= 1) { npVol = constrain(vol, -1, 100); npShuffle = sh; npRepeat = constrain(rp, 0, 2); }
          // Spotify always has a cover: if it still hasn't come (the charm restarted mid-song), ask for it again
          if (npTitle.length() && !artLoaded && !xferActive && millis() - titleAt > 6000 && millis() - artAskAt > 15000) { artAskAt = millis(); sendStatus("art=need"); }
        }
      }
      break;

    case CMD_XFER_BEGIN: xferBegin(p, len); break;
    case CMD_XFER_DATA:  xferData(p, len);  break;
    case CMD_XFER_END:   xferEnd();         break;

    case CMD_BRIGHTNESS:
      if (len >= 1) { setBacklight(p[0]); prefs.putUChar("bright", brightness); }
      break;

    case CMD_PET:
      if (len >= 4) {
        petSpecies = p[0] % 3;
        petColor = c565(p[1], p[2], p[3]);
        if (len > 4) petName = String((const char *)(p + 4), len - 4);
        prefs.putUChar("petsp", petSpecies); prefs.putUShort("petcol", petColor);
        prefs.putString("petname", petName);
        setMode(M_PET, false);
      }
      break;

    case CMD_PET_FEED:
      petMood = min(100, petMood + 25);
      petHeartsUntil = millis() + 2500;
      prefs.putInt("petmood", petMood);
      setMode(M_PET, false);
      break;

    case CMD_CARD:
      if (len >= 3) {
        cardAccent = c565(p[0], p[1], p[2]);
        String s((const char *)(p + 3), len - 3);
        int sep = s.indexOf('\x1F');
        cardName = sep >= 0 ? s.substring(0, sep) : s;
        cardSub  = sep >= 0 ? s.substring(sep + 1) : "";
        prefs.putString("cname", cardName); prefs.putString("csub", cardSub);
        prefs.putUShort("cacc", cardAccent);
        setMode(M_CARD, false);
      }
      break;

    case CMD_SETTINGS:
      if (len >= 3) {
        sleepSec = p[0] | (p[1] << 8);
        swapSwipe = p[2];
        prefs.putUShort("sleep", sleepSec); prefs.putBool("swap", swapSwipe);
        if (len >= 4) { soundsOn = p[3] & 1; shakeWake = p[3] & 2; hourChime = p[3] & 4; fxOn = p[3] & 8; if (len < 6) idleKind = (p[3] & 16) ? 1 : 0; prefs.putUChar("flags", p[3] & 63); }
        if (len >= 5) { tiltBits = p[4] & 7; prefs.putUChar("tilt", tiltBits); }
        if (len >= 6) idleKind = p[5] % 4;
        prefs.putUChar("idlek", idleKind);
      }
      break;

    case CMD_LOOK:
      if (len >= 2) {
        bgStyle = p[0] % BG_COUNT;
        faceStyle = p[1] % FACE_COUNT;
        prefs.putUChar("bg", bgStyle); prefs.putUChar("face", faceStyle);
        if (len >= 3) { theme = p[2] % THEME_COUNT; prefs.putUChar("theme", theme); }
        if (mode == M_DECK) glitchFrames = 2; else setMode(M_CLOCK, false);     // the deck shows the background too
      }
      break;

    case CMD_THEME:
      if (len >= 1) {
        theme = p[0] % THEME_COUNT;
        prefs.putUChar("theme", theme);
        themePreviewUntil = millis() + 2500;
        glitchFrames = 2;
        toast(THEME_NAMES[theme], 900);
        klog("tty: theme %s", THEME_NAMES[theme]);
      }
      break;

    case CMD_TIMER:
      if (len >= 2) {
        uint32_t sec = p[0] | (p[1] << 8);
        alarmUntil = 0;
        timerEndAt = sec ? (millis() + sec * 1000UL) : 0;
        if (timerEndAt == 0 && sec) timerEndAt = 1;
        toast(sec ? "timer set" : "timer off", 900);
      }
      break;

    case CMD_TOY:
      if (len >= 1) {
        if (p[0] % TOY_COUNT != toyKind) toySwitch(p[0] % TOY_COUNT);
        setMode(M_TOY, false);
        if (len >= 2 && p[1]) toyRoll();
      }
      break;

    case CMD_CC: ccPacket(p, len); break;
    case CMD_WEATHER: wxPacket(p, len); break;
    case CMD_SPELL:
      if (len < 1) break;
      if (p[0] == 0 && len >= 3) {
        uint8_t a = p[2] % SA_COUNT;
        if (p[1] < 4) { splBaseAct[p[1]] = a; prefs.putUChar((String("spa") + p[1]).c_str(), a); }
        else if (p[1] >= 10 && p[1] < 10 + SPL_CUSTOM && splC[p[1] - 10].used) { splC[p[1] - 10].act = a; splSaveCustom(p[1] - 10); }
      } else if (p[0] == 1 && len >= 3 && p[1] < SPL_CUSTOM && splC[p[1]].tpl[0]) {
        teachSlot = p[1]; teachN = 0; teachAct = p[2] % SA_COUNT;
        String nm = asciiOnly(String((const char *)(p + 3), len - 3)); nm.trim(); if (!nm.length()) nm = String("spell ") + (p[1] + 1);
        snprintf(teachName, sizeof(teachName), "%s", nm.c_str());
        if (mode != M_CAST) openModule(M_CAST);
      } else if (p[0] == 2) teachSlot = -1;
      else if (p[0] == 3 && len >= 2 && p[1] < SPL_CUSTOM) { splC[p[1]].used = false; if (fsOK) FFat.remove(splPath(p[1])); }
      else if (p[0] == 5) { if (mode != M_CAST) openModule(M_CAST); }
      else if (p[0] == 6) { skClear(); break; }
      else if (p[0] == 7 && len >= 2) { if (mode != M_CAST) openModule(M_CAST); wandSet(p[1]); break; }
      splListToApp();
      break;

    case CMD_REC:
      if (len < 1) break;
      if (p[0] == 0 && len >= 5) {
        recTake = p[1] | (p[2] << 8); recGoal = p[3] | (p[4] << 8);
        String s((const char *)(p + 5), len - 5);
        int k = s.indexOf('\x1F');
        recLabel = asciiOnly(k >= 0 ? s.substring(0, k) : s); recHint = k >= 0 ? asciiOnly(s.substring(k + 1)) : String("");
        if (mode != M_REC) openModule(M_REC);
      } else if (p[0] == 1) { if (mode == M_REC) closeModule(); }
      else if (p[0] == 2 && len >= 3) { if (mode != M_REC) openModule(M_REC); recStart(false, p[1] | (p[2] << 8)); }
      else if (p[0] == 3) recStop();
      else if (p[0] == 4 && !recOn) recSend(false);
      break;

    case CMD_EYES:
      if (len >= 1) {
        if (p[0] >= EXPR_COUNT) exprAuto = true; else setExpr(p[0], 10000);
        if (mode != M_EYES) openModule(M_EYES);
      }
      break;

    case CMD_TUNE:
      if (len >= 1) {
        if (p[0] == 0) jbStop();
        else if (p[0] == 3) jbSkip();
        else {
          if (p[0] == 1) jbStop();
          for (int i = 1; i < len; i++) jbEnqueue(p[i]);
          if (p[0] == 1 && mode != M_JUKE) openModule(M_JUKE);
        }
        sendStatus();
      }
      break;

    case CMD_TORCH:
      if (len >= 1) {
        if (len >= 2) torchCol = p[1] & 3;
        if (p[0] && mode != M_TORCH) openModule(M_TORCH);
        else if (!p[0] && mode == M_TORCH) closeModule();
      }
      break;

    case CMD_SONG_LIST:
      for (int i = 0; i < MY_SONGS; i++) if (mySongHas[i]) {
        char b[64]; snprintf(b, sizeof(b), "song=%d,%u,%s", 100 + i, mySongN[i], mySongName[i]); notifyText(b); delay(20);
      }
      sendStatus("songs=end");
      break;

    case CMD_SONG_DELETE:
      if (len >= 1 && p[0] >= 100 && p[0] < 100 + MY_SONGS && fsOK) {
        if (jbSong == p[0]) jbStop();
        FFat.remove(mySongPath(p[0] - 100));
        scanMySongs();
        if (jbCat >= catCount()) jbCat = 0;
        if (!songExists(jbSelId)) jbSelId = 0;
      }
      sendStatus("songs=changed");
      break;

    case CMD_PING:      if (!authed) { authChallenge(); break; } sendStatus(); shareScreens(); splListToApp(); break;
    case CMD_AUTH:      authCmd(p, len); break;
    case CMD_BUZZ:      beep(len >= 1 ? constrain((int)p[0], 1, 10) : 3); break;
  }
}

// ───────────── BLE ─────────────
class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s, NimBLEConnInfo &info) override {
    authReset();
    statusChar->setValue((const uint8_t *)"locked", 6);
    bleConnected = true;
    toast("link up", 1000);
  }
  void onDisconnect(NimBLEServer *s, NimBLEConnInfo &info, int reason) override {
    bleConnected = false;
    authReset();
    statusChar->setValue((const uint8_t *)"locked", 6);       // nothing from the last link stays readable
    xferAbort = true;
    NimBLEDevice::startAdvertising();
  }
};

class RxCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &info) override {
    static Packet pkt;
    NimBLEAttValue v = c->getValue();
    pkt.len = min<size_t>(v.length(), sizeof(pkt.data));
    memcpy(pkt.data, v.data(), pkt.len);
    xQueueSend(rxQueue, &pkt, pdMS_TO_TICKS(3000));
  }
};

void bleInit() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(517);
  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  NimBLEService *svc = server->createService(SVC_UUID);
  NimBLECharacteristic *rx = svc->createCharacteristic(RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCB());
  statusChar = svc->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  statusChar->setValue((const uint8_t *)"locked", 6);
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  NimBLEAdvertisementData scan;
  scan.setName(DEVICE_NAME);
  adv->setScanResponseData(scan);
  adv->enableScanResponse(true);
  adv->start();
}
