// Larp Charm firmware: Firmware updates over Bluetooth.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Updates over Bluetooth ─────────────
// The website sends new firmware as a file transfer of kind 6, with its SHA-256. The partition table has two app
// slots (ota_0 and ota_1, 3 MB each): the image is written straight into the one not running while it arrives,
// hashed as it goes, and only switched to if the hash matches and the image checks out. Anything else leaves the
// charm running what it has. Only an unlocked (paired) link can send one.
#include <Update.h>
#include "mbedtls/sha256.h"
bool     otaOn = false;
uint8_t  otaWant[32];
mbedtls_sha256_context otaSha;

bool otaBegin(uint32_t size, const uint8_t *sha) {
  if (!authed || size < 64 * 1024 || size > 0x300000) return false;
  if (!Update.begin(size, U_FLASH)) return false;
  memcpy(otaWant, sha, 32);
  mbedtls_sha256_init(&otaSha); mbedtls_sha256_starts(&otaSha, 0);
  otaOn = true;
  klog("ota: receiving %luk", (unsigned long)(size / 1024));
  return true;
}
bool otaWrite(const uint8_t *p, uint32_t n) {
  mbedtls_sha256_update(&otaSha, p, n);
  return Update.write((uint8_t *)p, n) == n;
}
const char *otaEnd() {                    // nullptr when it worked
  uint8_t got[32];
  mbedtls_sha256_finish(&otaSha, got); mbedtls_sha256_free(&otaSha);
  otaOn = false;
  if (memcmp(got, otaWant, 32)) { Update.abort(); return "hash"; }
  if (!Update.end(true)) return "image";
  return nullptr;
}
void otaAbort() {
  if (!otaOn) return;
  Update.abort(); mbedtls_sha256_free(&otaSha);
  otaOn = false;
}
void otaRestart() {                       // the new firmware is in place: say so, then start it
  gfx->fillScreen(TTY_BG);
  textAt("$", 16, 100, 1, ACC); textAt("reboot --new-firmware", 28, 100, 1, COL_WHITE);
  textCentered("UPDATED", 124, 3, COL_LIME);
  textCentered("starting the new firmware", 158, 1, TTY_TEXT);
  gfx->flush();
  klog("ota: done, restarting");
  savePrefs();
  delay(900);
  Serial.flush();
  ESP.restart();
}
