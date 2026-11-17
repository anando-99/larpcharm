// Larp Charm firmware: Pairing. Only browsers you have paired can control the charm.
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ───────────── Pairing ─────────────
// Anyone nearby can open a Bluetooth link to the charm, so every link starts locked:
// - On connect the charm makes a fresh random challenge. The browser asks for it with PING and gets
//   "auth=chal,<32 hex>,<paired browsers>".
// - A paired browser answers with HMAC-SHA256(its key, challenge) (CMD_AUTH 1). The charm checks it against the keys
//   it remembers (up to AUTH_KEYS) and unlocks the link. The key never crosses the air again, and each challenge is
//   used once, so a recorded answer can't be replayed.
// - A new browser asks to pair (CMD_AUTH 0). The charm shows a 6-digit code on its screen for a minute; typed into the
//   browser (CMD_AUTH 2), it earns a fresh random 128-bit key to keep. Three wrong codes lock pairing for 30 s.
// - Until a link is unlocked the charm acts only on PING and AUTH and sends nothing but "auth=..." messages.
// The radio link itself isn't encrypted (a sniffer could read traffic, or the key at the moment of pairing):
// see docs/firmware.md for the threat model.
#include "mbedtls/md.h"
#define AUTH_KEYS 4
uint8_t  authKeys[AUTH_KEYS][16];
uint8_t  authN = 0;                       // browsers remembered
int8_t   authIdx = -1;                    // which one this link is
uint8_t  authNonce[16];
bool     authed = false;
uint32_t pairCode = 0, pairUntil = 0, pairLockUntil = 0, pairOkAt = 0;
uint8_t  pairTries = 0;

void authReset();
void authLoad() {
  authReset();
  authN = min(AUTH_KEYS, (int)prefs.getUChar("authn", 0));
  if (authN && prefs.getBytes("authk", authKeys, authN * 16) != authN * 16u) authN = 0;
}
void authSave() { prefs.putUChar("authn", authN); prefs.putBytes("authk", authKeys, authN * 16); }
static void toHex(const uint8_t *b, int n, char *o) { for (int i = 0; i < n; i++) sprintf(o + 2 * i, "%02x", b[i]); o[2 * n] = 0; }

void authReset() {                        // a new (or lost) link: locked, with a fresh challenge
  authed = false; authIdx = -1; pairUntil = 0;
  esp_fill_random(authNonce, sizeof(authNonce));
}
void authChallenge() {                    // a fresh random challenge every time one is asked for: none is ever reused
  esp_fill_random(authNonce, sizeof(authNonce));
  char b[64] = "auth=chal,";
  toHex(authNonce, 16, b + 10);
  snprintf(b + strlen(b), sizeof(b) - strlen(b), ",%u", authN);
  notifyText(b);
}
bool authCheck(const uint8_t *mac) {
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  for (int k = 0; k < authN; k++) {
    uint8_t want[32];
    if (mbedtls_md_hmac(md, authKeys[k], 16, authNonce, 16, want) != 0) continue;
    uint8_t d = 0;
    for (int i = 0; i < 32; i++) d |= want[i] ^ mac[i];   // the same time whatever matches
    if (!d) { authIdx = k; return true; }
  }
  return false;
}

void authCmd(const uint8_t *p, uint16_t len) {
  if (len < 1) return;
  uint32_t now = millis();
  char b[64];
  switch (p[0]) {
    case 1:                               // the answer to the challenge
      if (len >= 33 && authCheck(p + 1)) {
        authed = true;
        esp_fill_random(authNonce, sizeof(authNonce));   // never answer the same challenge twice
        notifyText("auth=ok");
        klog("ble: browser %d unlocked", authIdx + 1);
      } else {
        notifyText("auth=fail");
        authChallenge();
      }
      break;
    case 0:                               // a new browser wants to pair: show a code
      if (now < pairLockUntil) { snprintf(b, sizeof(b), "auth=locked,%lu", (unsigned long)((pairLockUntil - now) / 1000 + 1)); notifyText(b); break; }
      pairCode = esp_random() % 1000000;
      pairUntil = now + 60000; pairTries = 0;
      touchActivity();                    // wake the screen to show it
      sfx(1);
      notifyText("auth=code");
      if (serialLink) Serial.printf("CODE %06lu\n", (unsigned long)pairCode);   // asked over USB (tests): the code is on the wire you hold
      klog("ble: pairing code shown");
      break;
    case 2: {                             // the code, as typed in the browser (6 digits)
      if (!pairUntil || now > pairUntil) { notifyText("auth=expired"); break; }
      uint32_t got = 0; bool digits = len == 7;
      for (int i = 1; i < len && i <= 6; i++) { digits = digits && p[i] >= '0' && p[i] <= '9'; got = got * 10 + (p[i] - '0'); }
      if (!digits || got != pairCode) {
        if (++pairTries >= 3) { pairUntil = 0; pairLockUntil = now + 30000; notifyText("auth=locked,30"); klog("ble: pairing locked"); }
        else { snprintf(b, sizeof(b), "auth=bad,%u", 3 - pairTries); notifyText(b); }
        break;
      }
      if (authN == AUTH_KEYS) { memmove(authKeys[0], authKeys[1], 16 * (AUTH_KEYS - 1)); authN--; }   // forget the oldest
      esp_fill_random(authKeys[authN], 16);
      authIdx = authN++;
      authSave();
      authed = true; pairUntil = 0; pairOkAt = now;
      strcpy(b, "auth=key,"); toHex(authKeys[authIdx], 16, b + 9);
      notifyText(b);
      klog("ble: browser paired (%u known)", authN);
      sfx(4);
      break;
    }
    case 3:                               // forget every other browser (only from an unlocked link)
      if (authed && authIdx >= 0) {
        memmove(authKeys[0], authKeys[authIdx], 16); authN = 1; authIdx = 0; authSave();
        notifyText("auth=forgot");
        klog("ble: other browsers forgotten");
      }
      break;
  }
}

void authForgetAll() { authN = 0; authIdx = -1; authed = false; authSave(); }

// the code, over whatever is on screen
void drawPairOverlay() {
  uint32_t now = millis();
  if (pairOkAt && now - pairOkAt < 1600) {
    gfx->fillRect(30, 112, 180, 56, TTY_BG); gfx->drawRect(30, 112, 180, 56, COL_LIME);
    textCentered("PAIRED", 122, 2, COL_LIME); textCentered("this browser can connect now", 146, 1, TTY_TEXT);
    return;
  }
  if (!pairUntil || now > pairUntil || authed) return;
  gfx->fillRect(14, 70, 212, 140, TTY_BG);
  gfx->drawRect(14, 70, 212, 140, ACC);
  textAt("$", 22, 78, 1, ACC); textAt("pair --browser", 34, 78, 1, COL_WHITE);
  textAt("a browser wants to connect.", 22, 96, 1, TTY_TEXT);
  textAt("type this code into it:", 22, 108, 1, TTY_TEXT);
  char c[10]; snprintf(c, sizeof(c), "%03lu %03lu", (unsigned long)(pairCode / 1000), (unsigned long)(pairCode % 1000));
  textAt(c, 120 - 7 * 9, 128, 3, COL_WHITE);
  for (int i = 0; i < 3 - pairTries; i++) gfx->fillRect(22 + i * 8, 166, 5, 5, ACC);
  snprintf(c, sizeof(c), "%lus", (unsigned long)((pairUntil - now) / 1000));
  textAt(c, 218 - (int)strlen(c) * 6, 164, 1, TTY_DIM);
  textAt("not you? ignore it.", 22, 186, 1, TTY_DIM);
}
