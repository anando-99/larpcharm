// Larp Charm firmware: The clock chip (PCF85063 RTC) and the motion sensor (QMI8658).
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── RTC (PCF85063) ─────────────
static uint8_t bcd2dec(uint8_t b) { return (b >> 4) * 10 + (b & 0x0F); }
static uint8_t dec2bcd(uint8_t d) { return ((d / 10) << 4) | (d % 10); }

bool rtcReadUTC(time_t &out) {
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(0x04);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)RTC_ADDR, (uint8_t)7) != 7) return false;
  uint8_t s = Wire.read(), mi = Wire.read(), h = Wire.read(), d = Wire.read();
  Wire.read();
  uint8_t mo = Wire.read(), y = Wire.read();
  if (s & 0x80) return false;
  struct tm t = {};
  t.tm_sec = bcd2dec(s & 0x7F); t.tm_min = bcd2dec(mi & 0x7F); t.tm_hour = bcd2dec(h & 0x3F);
  t.tm_mday = bcd2dec(d & 0x3F); t.tm_mon = bcd2dec(mo & 0x1F) - 1; t.tm_year = bcd2dec(y) + 100;
  out = mktime(&t);
  return out > 1700000000;
}

void rtcWriteUTC(time_t e) {
  struct tm t; gmtime_r(&e, &t);
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(0x04);
  Wire.write(dec2bcd(t.tm_sec));
  Wire.write(dec2bcd(t.tm_min));
  Wire.write(dec2bcd(t.tm_hour));
  Wire.write(dec2bcd(t.tm_mday));
  Wire.write(t.tm_wday);
  Wire.write(dec2bcd(t.tm_mon + 1));
  Wire.write(dec2bcd(t.tm_year % 100));
  Wire.endTransmission();
}

void setSystemTime(time_t e) {
  struct timeval tv = { e, 0 };
  settimeofday(&tv, nullptr);
  timeValid = true;
}

bool localNow(struct tm &t) {
  if (!timeValid) return false;
  time_t now; time(&now); now += tzMin * 60;
  gmtime_r(&now, &t);
  return true;
}

// ───────────── Motion sensor (QMI8658 accelerometer) ─────────────
#define IMU_ADDR 0x6B

void imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(IMU_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}

bool imuReadRaw(int16_t &x, int16_t &y, int16_t &z) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(0x35);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)IMU_ADDR, (uint8_t)6) != 6) return false;
  uint8_t b[6];
  for (int i = 0; i < 6; i++) b[i] = Wire.read();
  if (imuBE) { x = (int16_t)((b[0] << 8) | b[1]); y = (int16_t)((b[2] << 8) | b[3]); z = (int16_t)((b[4] << 8) | b[5]); }
  else       { x = (int16_t)((b[1] << 8) | b[0]); y = (int16_t)((b[3] << 8) | b[2]); z = (int16_t)((b[5] << 8) | b[4]); }
  return true;
}

void imuInit() {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(0x00);                                   // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom((uint8_t)IMU_ADDR, (uint8_t)1) != 1) return;
  if (Wire.read() != 0x05) return;
  // A reboot (an update, a restart from USB) doesn't power-cycle the sensor, which keeps whatever the last session set,
  // e.g. the spell screens' +-8 g range, and then ignores the changes below. Soft-reset it to its defaults first.
  imuWrite(0x60, 0xB0);     // RESET
  delay(30);
  imuWrite(0x08, 0x00);     // CTRL7: everything off while it is set up
  imuWrite(0x02, 0x40);     // CTRL1: register auto-increment
  imuWrite(0x03, 0x16);     // CTRL2: accel +-4 g, 125 Hz
  imuWrite(0x08, 0x01);     // CTRL7: accelerometer on, gyro off (saves power)
  delay(60);
  // work out the byte order: at rest the reading must be about 1 g
  for (int pass = 0; pass < 2; pass++) {
    imuBE = (pass == 1);
    int good = 0;
    for (int i = 0; i < 5; i++) {
      int16_t x, y, z;
      if (imuReadRaw(x, y, z)) {
        float m = sqrtf((float)x * x + (float)y * y + (float)z * z) / 8192.0f;
        if (m > 0.7f && m < 1.4f) good++;
      }
      delay(12);
    }
    if (good >= 4) { imuOK = true; return; }
  }
  imuBE = false;
  klog("imu: no 1 g at rest");
}

// Reads the accelerometer. Returns true when the charm was shaken.
bool imuUpdate() {
  if (!imuOK || recSampling) return false;          // the spell recorder has the sensor (in another range)
  uint32_t now = millis();
  if (now - lastImuRead < (sleeping ? 70u : 20u)) return false;
  lastImuRead = now;
  int16_t rx, ry, rz;
  if (!imuReadRaw(rx, ry, rz)) return false;
  float x = rx / 8192.0f, y = ry / 8192.0f, z = rz / 8192.0f;
  stepFeed(x, y, z, now);
  if (tiltBits & 4) { float t = x; x = y; y = t; }
  if (tiltBits & 1) x = -x;
  if (tiltBits & 2) y = -y;
  float dx = x - accX, dy = y - accY, dz = z - accZ;
  float d = sqrtf(dx * dx + dy * dy + dz * dz);
  accX = x; accY = y; accZ = z;
  tiltX = tiltX * 0.8f + x * 0.2f;
  tiltY = tiltY * 0.8f + y * 0.2f;
  if (d > 0.22f) moveTicks++;
  bool shook = false;
  if (d > 0.9f) {
    if (now - shakeHitAt > 700) shakeHits = 0;
    shakeHitAt = now;
    shakeHits++;
    if (shakeHits >= 3 && now - lastShakeAt > 900) { lastShakeAt = now; shakeHits = 0; shook = true; }
  }
  return shook;
}
