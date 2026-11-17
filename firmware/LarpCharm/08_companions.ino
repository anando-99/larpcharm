// Larp Charm firmware: The terminal companions: tty (a kaomoji) and cc (the Claude Code remote and its mascot).
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v8.2: two more companions for when you're not looking ═════════════

// ───── tty: a kaomoji that lives in the terminal ─────
// It blinks, glances around, changes mood by itself, and thinks out loud about what the charm knows.
enum TtyFace : uint8_t { TF_NEUTRAL, TF_HAPPY, TF_LAUGH, TF_LOVE, TF_SAD, TF_ANGRY, TF_SURPRISED, TF_SLEEPY, TF_BORED, TF_SUSPICIOUS, TF_WINK, TF_DIZZY, TF_MUSIC, TF_COUNT };
const char *TTY_FACE[TF_COUNT] = {"(o_o)", "(^_^)", "(^o^)", "(\x03_\x03)", "(T_T)", "(>_<)", "(O_O)", "(-_-)", "(-.-)", "(\xAA_\xAA)", "(^_-)", "(@_@)", "(^_^)"};
const char *TTY_MOOD[TF_COUNT] = {"idle", "happy", "giggling", "in love", "sad", "grumpy", "surprised", "sleepy", "bored", "suspicious", "cheeky", "dizzy", "vibing"};
uint8_t  ttyFace = TF_NEUTRAL;
uint32_t ttyFaceUntil = 0, ttyNextFace = 0, ttyBlinkAt = 0, ttyNextBlink = 0, ttyThoughtAt = 0, ttyNextThought = 0, ttyLookUntil = 0;
int8_t   ttyLook = 0;
char     ttyThought[64] = "booting feelings... ok";
struct TtyDrop { int16_t y; uint8_t spd, len; };
TtyDrop  ttyRain[40];
bool     ttyRainInit = false;

void ttySet(uint8_t f, uint32_t ms) { ttyFace = f % TF_COUNT; ttyFaceUntil = millis() + ms; }
void ttyThink() {
  struct tm t;
  bool haveTime = localNow(t);
  int pick = random(0, 9);
  if (haveTime && (t.tm_hour >= 0 && t.tm_hour < 5) && random(0, 2)) snprintf(ttyThought, sizeof(ttyThought), "it's %02d:%02d. why are we awake", t.tm_hour, t.tm_min);
  else if (npPlaying && npTitle.length() && pick < 3) snprintf(ttyThought, sizeof(ttyThought), "now playing: %s", asciiOnly(npTitle).c_str());
  else if (!charging && batPct < 30 && pick < 5) snprintf(ttyThought, sizeof(ttyThought), "battery at %d%%... snack time?", batPct);
  else if (charging && pick < 3) snprintf(ttyThought, sizeof(ttyThought), "charging. %d%% and climbing", batPct);
  else switch (pick) {
    case 0: snprintf(ttyThought, sizeof(ttyThought), "%lu steps today. legs: noted", (unsigned long)stepsToday); break;
    case 1: snprintf(ttyThought, sizeof(ttyThought), "uptime %s. still here", fmtUptime(millis()).c_str()); break;
    case 2: snprintf(ttyThought, sizeof(ttyThought), "compiling dreams... 0 errors"); break;
    case 3: snprintf(ttyThought, sizeof(ttyThought), "%s", bleConnected ? "your phone is close. nice" : "no phone nearby. just us"); break;
    case 4: snprintf(ttyThought, sizeof(ttyThought), "grep -r 'meaning' /life"); break;
    case 5: snprintf(ttyThought, sizeof(ttyThought), "sudo make me a sandwich"); break;
    case 6: snprintf(ttyThought, sizeof(ttyThought), "%s", petName.length() ? (asciiOnly(petName) + " says hi").c_str() : "pet says hi"); break;
    case 7: snprintf(ttyThought, sizeof(ttyThought), "rm -rf /worries ... done"); break;
    default: snprintf(ttyThought, sizeof(ttyThought), "%s", bleConnected ? "listening on ble..." : "waiting for a ping"); break;
  }
  ttyThoughtAt = millis();
  ttyNextThought = millis() + 7000 + random(0, 5000);
}

void drawTty() {
  uint32_t now = millis();
  struct tm t;
  bool night = localNow(t) && (t.tm_hour >= 23 || t.tm_hour < 6);
  if (!ttyRainInit) { for (int i = 0; i < 40; i++) ttyRain[i] = { (int16_t)random(-280, 0), (uint8_t)random(1, 4), (uint8_t)random(4, 12) }; ttyRainInit = true; }

  // the face picks its own mood when nobody pokes it
  if (now > ttyFaceUntil) {
    if (idleEyesOn || night) ttyFace = TF_SLEEPY;
    else if (npPlaying && npTitle.length()) ttyFace = TF_MUSIC;
    else if (now > ttyNextFace) {
      static const uint8_t CALM[8] = {TF_NEUTRAL, TF_NEUTRAL, TF_HAPPY, TF_BORED, TF_SUSPICIOUS, TF_WINK, TF_NEUTRAL, TF_HAPPY};
      ttyFace = CALM[random(0, 8)];
      ttyNextFace = now + 4000 + random(0, 5000);
      if (!random(0, 3)) { ttyLook = random(0, 2) ? 1 : -1; ttyLookUntil = now + 1400; }
    }
  }
  if (now > ttyNextBlink) { ttyBlinkAt = now; ttyNextBlink = now + 2200 + random(0, 3500); }
  if (now > ttyNextThought) ttyThink();

  gfx->fillScreen(TTY_BG);
  for (int c = 0; c < 40; c++) {                                   // faint cmatrix rain
    TtyDrop &d = ttyRain[c];
    d.y += d.spd;
    if (d.y - d.len * 8 > SCR_H) d = { (int16_t)random(-120, 0), (uint8_t)random(1, 4), (uint8_t)random(4, 12) };
    for (int k = 0; k < d.len; k++) {
      int yy = d.y - k * 8;
      if (yy < 0 || yy > SCR_H) continue;
      char ch[2] = { (char)('!' + ((c * 7 + yy / 8 + (int)(now / 300)) % 90)), 0 };
      textAt(ch, c * 6, yy, 1, k == 0 ? ACC_DIM : mix565(ACC_LOW, TTY_BG, 80 + k * 14));
    }
  }

  gfx->fillRect(12, 14, 216, 14, TTY_BG);
  textAt("larp@charm", 16, 18, 1, ACC); textAt(":~$", 76, 18, 1, TTY_TEXT); textAt("./tty --face", 100, 18, 1, COL_WHITE);

  // the face
  char face[8];
  bool blink = now - ttyBlinkAt < 140 && ttyFace != TF_SLEEPY && ttyFace != TF_DIZZY;
  strncpy(face, TTY_FACE[ttyFace], sizeof(face));
  if (blink) { face[1] = '-'; face[3] = '-'; }
  if (ttyFace == TF_DIZZY && (now / 160) % 2) { face[1] = '%'; face[3] = '%'; }
  int bob = (int)(sinf(now / (ttyFace == TF_SLEEPY ? 700.0f : 380.0f)) * 3);
  int lx = (now < ttyLookUntil ? ttyLook * 10 : 0) + (ttyFace == TF_DIZZY ? (int)(sinf(now / 90.0f) * 6) : 0);
  gfx->fillRect(30, 82, 180, 50, TTY_BG);
  textAt(face, 45 + lx, 90 + bob, 5, ttyFace == TF_LOVE ? c565(255, 90, 150) : COL_WHITE);
  if (ttyFace == TF_SLEEPY) {
    for (int i = 0; i < 3; i++) { float p = fmodf(now / 1800.0f + i / 3.0f, 1.0f); textAt(i % 2 ? "Z" : "z", 196 + (int)(p * 14), 86 - (int)(p * 34), 1 + i % 2, mix565(ACC, TTY_BG, (uint8_t)(p * 255))); }
  }
  if (ttyFace == TF_MUSIC) { char n[2] = {'\x0E', 0}; textAt(n, 200, 84 + (int)(sinf(now / 300.0f) * 5), 2, ACC); textAt(n, 22, 112 - (int)(sinf(now / 260.0f) * 5), 2, ACC); }

  // mood and the thought, typed out
  gfx->fillRect(10, 148, 220, 44, TTY_BG);
  textAt("mood:", 16, 152, 1, TTY_DIM); textAt(TTY_MOOD[ttyFace], 52, 152, 1, ACC);
  String th = ttyThought;
  int shown = min((int)th.length(), (int)((now - ttyThoughtAt) / 35));
  String s = th.substring(0, shown);
  textAt(">", 16, 166, 1, ACC);
  textAt(s.substring(0, 33), 28, 166, 1, TTY_TEXT);
  if (s.length() > 33) textAt(s.substring(33, 66), 28, 177, 1, TTY_TEXT);
  int cl = (int)s.length() > 33 ? 1 : 0, cxp = 28 + ((int)s.length() - cl * 33) * 6;
  if ((now / 450) % 2) gfx->fillRect(cxp, 165 + cl * 11, 6, 9, ACC);

  gfx->fillRect(10, 236, 220, 12, TTY_BG);
  textAt("tap: poke  2x: love  shake: @_@", 28, 238, 1, TTY_DIM);
}
void ttyWake() { ttySet(TF_SURPRISED, 1200); snprintf(ttyThought, sizeof(ttyThought), "oh! you're back"); ttyThoughtAt = millis(); ttyNextThought = millis() + 6000; }
void ttyTap(bool dbl) {
  if (dbl) ttySet(TF_LOVE, 3500);
  else { static const uint8_t R[4] = {TF_HAPPY, TF_LAUGH, TF_SURPRISED, TF_WINK}; ttySet(R[random(0, 4)], 2500); }
  ttyBlinkAt = millis();
}

// ───── cc: an homage to Claude Code, working away on the charm ─────
// Little sessions loop on their own: a prompt is typed into the input box, then tool calls, results and
// replies stream into the transcript, with the spinner between them. Answers use the charm's live data.
const uint16_t CC_ORANGE = c565(217, 119, 87), CC_TEXT = c565(232, 232, 232), CC_DIM = c565(140, 140, 150), CC_GREEN = c565(80, 200, 120), CC_RED = c565(240, 90, 90);
enum CcKind : uint8_t { CK_USER, CK_TEXT, CK_TOOL, CK_RESULT, CK_GAP, CK_ERR };
struct CcLine { uint8_t kind; char s[38]; };
#define CC_LINES 14
CcLine   ccLog[CC_LINES];
uint8_t  ccLogN = 0;
#define CC_STEPS 10
struct CcStep { uint8_t kind; uint16_t think; char s[38]; };
CcStep   ccScript[CC_STEPS];
uint8_t  ccLen = 0, ccPos = 0, ccSession = 0;
enum CcState : uint8_t { CS_REST, CS_TYPE, CS_THINK, CS_STREAM };
uint8_t  ccState = CS_REST;
uint32_t ccAt = 0;
const char *CC_VERBS[12] = {"Noodling", "Pondering", "Percolating", "Tinkering", "Musing", "Brewing", "Cogitating", "Spelunking", "Whirring", "Simmering", "Untangling", "Booping"};
uint8_t  ccVerb = 0;

void ccAdd(uint8_t kind, const char *s) {
  if (ccLogN == CC_LINES) { memmove(ccLog, ccLog + 1, sizeof(CcLine) * (CC_LINES - 1)); ccLogN--; }
  ccLog[ccLogN].kind = kind;
  snprintf(ccLog[ccLogN].s, sizeof(ccLog[0].s), "%s", s);
  ccLogN++;
}
void ccStep(uint8_t kind, uint16_t think, const char *fmt, ...) {
  if (ccLen >= CC_STEPS) return;
  CcStep &st = ccScript[ccLen++];
  st.kind = kind; st.think = think;
  va_list ap; va_start(ap, fmt); vsnprintf(st.s, sizeof(st.s), fmt, ap); va_end(ap);
}
enum CcLive : uint8_t { CL_OFFLINE, CL_READY, CL_THINKING, CL_TOOL, CL_PERM, CL_WAITING, CL_DONE };
const char *CL_NAME[7] = {"offline", "ready", "thinking", "running", "needs you", "your turn", "done"};
bool     ccLive = false;
uint32_t ccLiveAt = 0, ccLiveSince = 0, ccVerbAt = 0;
uint8_t  ccLState = CL_OFFLINE, ccPage = 0;
String   ccLProject, ccLModel, ccLTool, ccLPrompt;
uint8_t  ccSCtx = 0;
uint16_t ccSCost = 0, ccSMin = 0, ccSAdd = 0, ccSDel = 0;
String   ccSVersion, ccSSession, ccSCwd;
bool     ccPermOn = false;
uint16_t ccPermId = 0;
String   ccPermTool, ccPermDetail, ccPermProj;
uint32_t ccPermAt = 0, ccPermAnsweredAt = 0;
int8_t   ccPermAnswer = -1;                 // what you answered, shown for a moment
uint8_t  ccPermReturn = M_DECK;
String   ccPreset[6];
uint8_t  ccPresetN = 0;
int8_t   ccPresetHit = -1;
uint32_t ccPresetHitAt = 0;
bool ccLinked() { return ccLive && millis() - ccLiveAt < 35000; }

// the mascot's pose (drawn by ccMascot below)
enum CcPose : uint8_t { CP_IDLE, CP_WAVE, CP_DIZZY, CP_HAPPY };
uint8_t  ccPose = CP_IDLE;
uint32_t ccPoseUntil = 0, ccPoseAt = 0, ccBlinkAt = 0, ccNextBlink = 0, ccLookUntil = 0;
int8_t   ccLook = 0;
void ccSetPose(uint8_t p, uint32_t ms) { ccPose = p; ccPoseAt = millis(); ccPoseUntil = millis() + ms; }
// write the next little session, using what the charm knows right now
void ccPlan(int which) {
  ccLen = 0; ccPos = 0;
  switch (which) {
    case 100:                                                    // you tapped
      ccSetPose(CP_WAVE, 2200);
      ccStep(CK_USER, 0, "hi claude");
      ccStep(CK_TEXT, 900, "Hi! I'm keeping an eye on the");
      ccStep(CK_TEXT, 0, "charm. Uptime %s.", fmtUptime(millis()).c_str());
      break;
    case 101:                                                    // you shook it
      ccSetPose(CP_DIZZY, 2600);
      ccStep(CK_USER, 0, "what was that?");
      ccStep(CK_TOOL, 700, "Read(/dev/imu)");
      ccStep(CK_RESULT, 300, "peak |a| = %.1fg", sqrtf(accX * accX + accY * accY + accZ * accZ) + 1.2f);
      ccStep(CK_TEXT, 800, "Whoa, quite a shake. All good?");
      break;
    default:
      switch (ccSession++ % 5) {
        case 0:
          ccStep(CK_USER, 0, "make the deck more cli");
          ccStep(CK_TOOL, 1600, "Read(LarpCharm.ino)");
          ccStep(CK_RESULT, 300, "Read 4180 lines");
          ccStep(CK_TOOL, 2400, "Update(drawDeck)");
          ccStep(CK_RESULT, 300, "+212 -98");
          ccStep(CK_TEXT, 1200, "Done. Home is a tmux session.");
          break;
        case 1:
          ccStep(CK_USER, 0, "why is my battery at %d%%?", batPct);
          ccStep(CK_TOOL, 1400, "Bash(cat /sys/pwr)");
          ccStep(CK_RESULT, 300, "%.2fv, %s", batVolts, charging ? "charging" : "on battery");
          ccStep(CK_TEXT, 1300, charging ? "It's charging. Full soon." : batPct < 30 ? "Up %s. Plug me in soon." : "Up %s. Plenty left.", fmtUptime(millis()).c_str());
          break;
        case 2:
          ccStep(CK_USER, 0, "how many steps today?");
          ccStep(CK_TOOL, 1200, "Read(/dev/imu)");
          ccStep(CK_RESULT, 300, "%lu steps", (unsigned long)stepsToday);
          ccStep(CK_TEXT, 1100, stepsToday > 6000 ? "Big day. Your legs earned it." : "Short walk later? I'll count.");
          break;
        case 3:
          if (npTitle.length()) {
            ccStep(CK_USER, 0, "what's playing?");
            ccStep(CK_TOOL, 1100, "Read(/dev/np)");
            ccStep(CK_RESULT, 300, "%s", asciiOnly(npTitle).c_str());
            ccStep(CK_TEXT, 900, "Good pick.");
          } else {
            ccStep(CK_USER, 0, "fix the flaky timer");
            ccStep(CK_TOOL, 1500, "Grep(\"timerEndAt\")");
            ccStep(CK_RESULT, 300, "Found 9 matches");
            ccStep(CK_TOOL, 2000, "Bash(pio test)");
            ccStep(CK_RESULT, 300, "12 passed");
            ccStep(CK_TEXT, 900, "Fixed an overflow at 49 days.");
          }
          break;
        default:
          ccStep(CK_USER, 0, "commit and push");
          ccStep(CK_TOOL, 1300, "Bash(git commit -am ...)");
          ccStep(CK_RESULT, 300, "1 file changed");
          ccStep(CK_TOOL, 1400, "Bash(git push)");
          ccStep(CK_RESULT, 300, "main -> main");
          ccStep(CK_TEXT, 800, "Pushed.");
          break;
      }
  }
  if (ccLogN) ccAdd(CK_GAP, "");
  ccState = CS_TYPE; ccAt = millis(); ccVerb = random(0, 12);
}
void ccPoke(int which) { ccPlan(which); }

// The mascot: a blocky orange critter drawn on a 16x10 grid. It reacts to the session and to you.
// The critter itself, on a 16x10 grid of s-pixel cells.
// eyes: 0 open, 1 blink/closed, 2 happy, 3 dizzy, 4 down, 5 up.  arms: 0 rest, 1 flap, 2 wave, 3 both up.
// legs: 0 standing, 1 and 2 the two halves of a step, 3 tucked (in the air).
enum CcEyes : uint8_t { CE_OPEN, CE_SHUT, CE_HAPPY, CE_DIZZY, CE_DOWN, CE_UP };
void ccCritter(int x0, int y0, int s, uint8_t eyes, int8_t look, uint8_t arms, uint8_t legs, uint32_t now) {
  const uint16_t B = CC_ORANGE, E = c565(12, 12, 14);
  auto rect = [&](int cx, int cy, int w, int h, uint16_t c) { gfx->fillRect(x0 + cx * s, y0 + cy * s, w * s, h * s, c); };
  rect(2, 0, 12, 8, B);
  bool flap = arms == 1 && (now / 200) % 2;
  int la = arms == 3 ? 1 : flap ? 3 : 4, ra = arms == 3 ? 1 : arms == 2 ? (((now / 180) % 2) ? 1 : 2) : flap ? 5 : 4;
  rect(0, la, 2, 2, B);
  rect(14, ra, 2, 2, B);
  static const uint8_t LX[4] = {3, 5, 10, 12};
  for (int k = 0; k < 4; k++) rect(LX[k], 8, 1, legs == 3 || (legs == 1 && k % 2) || (legs == 2 && !(k % 2)) ? 1 : 2, B);
  static const uint8_t EX[2] = {4, 11};
  for (int i = 0; i < 2; i++) {
    int ex = EX[i], x = ex + look;
    switch (eyes) {
      case CE_SHUT:  rect(x, 3, 1, 1, E); break;
      case CE_HAPPY: rect(ex - 1, 3, 1, 1, E); rect(ex, 2, 1, 1, E); rect(ex + 1, 3, 1, 1, E); break;
      case CE_DIZZY: rect(ex - 1, 2, 1, 1, E); rect(ex + 1, 2, 1, 1, E); rect(ex, 3, 1, 1, E); rect(ex - 1, 4, 1, 1, E); rect(ex + 1, 4, 1, 1, E); break;
      case CE_DOWN:  rect(ex, 3, 1, 2, E); break;
      case CE_UP:    rect(ex + 1, 1, 1, 2, E); break;
      default:       rect(x, 2, 1, 2, E); break;
    }
  }
}

// the small one in the welcome box, reacting to the session
void ccMascot(int x0, int y0, int s) {
  uint32_t now = millis();
  if (now > ccPoseUntil) ccPose = CP_IDLE;
  if (now > ccNextBlink) { ccBlinkAt = now; ccNextBlink = now + 2400 + random(0, 3000); }
  bool live = ccLinked();
  bool sleepy = ccPose == CP_IDLE && (live ? ccLState == CL_OFFLINE : idleEyesOn);
  bool busy = !sleepy && (live ? (ccLState == CL_THINKING || ccLState == CL_TOOL) : ((ccState == CS_THINK || ccState == CS_STREAM) && ccPos < ccLen));
  bool typing = !live && ccState == CS_TYPE;
  if (!busy && !typing && !sleepy && now > ccLookUntil && !random(0, 160)) { ccLook = random(0, 2) ? 1 : -1; ccLookUntil = now + 1200; }
  int dy = 0, dx = 0;
  if (sleepy) dy = (now / 900) % 2;
  else if (busy) dy = -(int)((now / 140) % 2);
  else if (ccPose == CP_HAPPY || ccPose == CP_WAVE) { float p = (now - ccPoseAt) / 450.0f; if (p < 1) dy = -(int)(sinf(p * 3.1416f) * 3); }
  else dy = (now / 1100) % 2;
  if (ccPose == CP_DIZZY) dx = (int)(sinf(now / 70.0f) * 1.6f);
  x0 += dx * s; y0 += dy * s;
  bool blink = now - ccBlinkAt < 130;
  uint8_t eyes = sleepy ? CE_SHUT : ccPose == CP_HAPPY ? CE_HAPPY : ccPose == CP_DIZZY ? CE_DIZZY : blink ? CE_SHUT : typing ? CE_DOWN : busy ? CE_UP : CE_OPEN;
  ccCritter(x0, y0, s, eyes, now < ccLookUntil ? ccLook : 0, ccPose == CP_WAVE ? 2 : busy ? 1 : 0, busy ? 1 + (now / 160) % 2 : 0, now);
  if (sleepy) for (int i = 0; i < 2; i++) { float p = fmodf(now / 1600.0f + i * 0.5f, 1.0f); textAt(i ? "z" : "Z", x0 + 11 * s + (int)(p * 5), y0 - 6 - (int)(p * 10), 1, mix565(CC_ORANGE, c565(12, 12, 14), (uint8_t)(p * 255))); }
}

// ───── the critter, popped out to full screen: a pocket pet ─────
// tap it: pet (hearts) · double tap or swipe up: jump · tap beside it or swipe sideways: it walks there
// tilt: it slides and leans · shake: dizzy · left alone: bored, then asleep · swipe down: back in its box
#define CB_S 9
#define CB_GROUND 204
bool     ccBig = false;
float    ccBigT = 0;                       // 0 in its box .. 1 full screen
float    cbX = 0, cbVX = 0, cbY = 0, cbVY = 0, cbTarget = 0;
bool     cbWalking = false;
uint32_t cbSayUntil = 0, cbHappyUntil = 0, cbDizzyUntil = 0, cbTouchAt = 0, cbLoveDecay = 0;
char     cbSay[24] = "";
int      cbLove = 50;
struct CbHeart { float x, y, vy; uint8_t life; };
CbHeart  cbHearts[8];

void cbSpeak(const char *s, uint32_t ms) { snprintf(cbSay, sizeof(cbSay), "%s", s); cbSayUntil = millis() + ms; }
void ccBigOpen() {
  ccBig = true; cbX = 0; cbVX = 0; cbY = 0; cbVY = 0; cbWalking = false; cbTouchAt = millis();
  cbSpeak("hi!", 1600); cbHappyUntil = millis() + 1200; sfx(2);
}
void ccBigClose() { ccBig = false; sfx(1); }
void cbJump(float v) { if (cbY < 1) { cbVY = v; sfx(4); } }
void cbPet() {
  static const char *SAY[8] = {"hehe", "*boop*", "<3", "again!", ":)", "purr?", "hi!", "yay"};
  cbHappyUntil = millis() + 1400;
  cbSpeak(SAY[random(0, 8)], 1300);
  cbLove = min(100, cbLove + 8);
  for (int i = 0, k = 0; i < 8 && k < 3; i++) if (!cbHearts[i].life) { cbHearts[i] = { 120 + cbX + (float)random(-40, 41), (float)(CB_GROUND - 10 * CB_S - cbY - 22), -1.2f - random(0, 10) / 10.0f, 50 }; k++; }
  sfx(4);
}
// taps and swipes while it is full screen
void cbTap(int x, int y, bool dbl) {
  cbTouchAt = millis();
  int cx = 120 + (int)cbX, top = CB_GROUND - 10 * CB_S - (int)cbY;
  bool onIt = abs(x - cx) < 8 * CB_S + 6 && y > top - 10 && y < CB_GROUND + 6;
  if (dbl) { cbJump(9.5f); cbSpeak("wheee", 900); return; }
  if (onIt) { cbPet(); return; }
  cbTarget = constrain(x - 120, -36, 36); cbWalking = true;
}
void cbSwipe(int dir) { cbTouchAt = millis(); cbTarget = dir > 0 ? -36 : 36; cbWalking = true; }
void cbShake() { cbTouchAt = millis(); cbDizzyUntil = millis() + 2600; cbSpeak("whoa!", 1500); cbVX += random(-6, 7); cbJump(6); }

void drawCcBig(uint32_t now) {
  bool bored = now - cbTouchAt > 9000, asleep = now - cbTouchAt > 20000;
  // physics, in steps of one 30 fps frame
  if (cbWalking) { cbVX = constrain((cbTarget - cbX) * 0.12f, -2.6f, 2.6f); if (fabsf(cbTarget - cbX) < 1.5f) { cbWalking = false; cbVX = 0; } }
  else {
    if (imuOK && !asleep) cbVX += tiltX * 0.55f;
    cbVX *= 0.86f;
  }
  cbX += cbVX;
  if (cbX < -36) { cbX = -36; cbVX = 0; }
  if (cbX > 36) { cbX = 36; cbVX = 0; }
  if (cbY > 0 || cbVY > 0) { cbY += cbVY; cbVY -= 0.85f; if (cbY <= 0) { cbY = 0; cbVY = 0; } }
  if (now - cbLoveDecay > 3000) { cbLoveDecay = now; if (cbLove > 0) cbLove--; }

  gfx->fillScreen(c565(12, 12, 14));
  textAt("swipe down to go back", 57, 16, 1, CC_DIM);
  for (int x = 14; x < 226; x += 6) gfx->drawFastHLine(x, CB_GROUND + 10, 3, mix565(CC_DIM, COL_BLACK, 120));

  int s = CB_S, x0 = 120 - 8 * s + (int)cbX, y0 = CB_GROUND - 10 * s - (int)cbY;
  bool moving = fabsf(cbVX) > 0.4f, air = cbY > 0.5f, dizzy = now < cbDizzyUntil, happy = now < cbHappyUntil;
  int rw = max(20, 62 - (int)(cbY * 0.6f));
  gfx->fillEllipse(120 + (int)cbX, CB_GROUND + 3, rw, 4, c565(40, 30, 28));          // shadow
  int bob = asleep ? (now / 900) % 2 : (!moving && !air) ? (now / 1100) % 2 : 0;
  int wob = dizzy ? (int)(sinf(now / 70.0f) * 5) : 0;
  int8_t look = moving ? (cbVX > 0 ? 1 : -1) : (imuOK && fabsf(tiltX) > 0.25f) ? (tiltX > 0 ? 1 : -1) : (now < ccLookUntil ? ccLook : 0);
  if (!moving && !asleep && now > ccLookUntil && !random(0, 120)) { ccLook = random(0, 2) ? 1 : -1; ccLookUntil = now + 1200; }
  if (now > ccNextBlink) { ccBlinkAt = now; ccNextBlink = now + 2400 + random(0, 3000); }
  uint8_t eyes = asleep ? CE_SHUT : dizzy ? CE_DIZZY : happy ? CE_HAPPY : (now - ccBlinkAt < 130) ? CE_SHUT : bored ? CE_DOWN : CE_OPEN;
  uint8_t arms = air ? 3 : happy ? 2 : moving ? 1 : 0;
  uint8_t legs = air ? 3 : moving ? 1 + (now / 140) % 2 : 0;
  ccCritter(x0 + wob, y0 + bob * s / 3, s, eyes, look, arms, legs, now);
  if (asleep) for (int i = 0; i < 3; i++) { float p = fmodf(now / 1800.0f + i / 3.0f, 1.0f); textAt(i % 2 ? "z" : "Z", min(x0 + 11 * s + (int)(p * 10), 214), y0 - 8 - (int)(p * 40), 1 + i % 2, mix565(CC_ORANGE, c565(12, 12, 14), (uint8_t)(p * 255))); }

  for (int i = 0; i < 8; i++) {                                    // hearts
    CbHeart &h = cbHearts[i];
    if (!h.life) continue;
    h.y += h.vy; h.life--;
    char ch[2] = {'\x03', 0};
    textAt(ch, (int)h.x - 6, (int)h.y, 2, h.life > 15 ? c565(255, 110, 150) : mix565(c565(255, 110, 150), c565(12, 12, 14), (uint8_t)((15 - h.life) * 16)));
  }
  if (now < cbSayUntil && !asleep) {                               // speech, Claude Code style
    int w = strlen(cbSay) * 12 + 24, bx = constrain(120 + (int)cbX - w / 2, 14, 226 - w), by = max(30, y0 - 40);
    gfx->fillRoundRect(bx, by, w, 26, 6, c565(12, 12, 14));
    gfx->drawRoundRect(bx, by, w, 26, 6, CC_ORANGE);
    gfx->fillCircle(bx + 9, by + 13, 2, CC_TEXT);
    textAt(cbSay, bx + 16, by + 6, 2, CC_TEXT);
  } else if (bored && !asleep && (now / 4000) % 2) textAt("...", 120 + (int)cbX - 9, y0 - 16, 1, CC_DIM);

  textAt("mood", 28, 232, 1, CC_DIM);
  textAt(asciiBar(cbLove / 100.0f, 22, '#', '#', '.'), 58, 232, 1, cbLove > 30 ? CC_ORANGE : CC_RED);
  textAt("tap: pet  2x: jump  swipe: walk", 27, 250, 1, mix565(CC_DIM, COL_BLACK, 90));
}

// growing out of (or back into) the welcome box
void drawCcPop(float t) {
  float e = t < 1 ? 1 - powf(1 - t, 3) : 1;
  int bx = (int)(12 * (1 - e)), by = (int)(14 * (1 - e)), bw = (int)(216 + 24 * e), bh = (int)(58 + 222 * e);
  gfx->fillRoundRect(bx, by, bw, bh, 6, c565(12, 12, 14));
  gfx->drawRoundRect(bx, by, bw, bh, 6, CC_ORANGE);
  float over = t < 1 ? sinf(t * 3.1416f) * 0.25f : 0;              // a little boing on the way
  int s = max(3, (int)(3 + (CB_S - 3) * (e + over * e)));
  int x0 = (int)(21 + (120 - 8 * CB_S - 21) * e), y0 = (int)(31 + (CB_GROUND - 10 * CB_S - 31) * e);
  ccCritter(x0, y0, s, CE_HAPPY, 0, 3, 3, millis());
}

// the spinner star: grows from a dot to a six-armed star and back
void ccStar(int cx, int cy, uint8_t phase, uint16_t col) {
  static const uint8_t ARM[6] = {0, 1, 2, 3, 3, 2};
  int a = ARM[phase % 6];
  gfx->fillRect(cx, cy, 1, 1, col);
  if (a >= 1) { gfx->drawFastHLine(cx - a, cy, 2 * a + 1, col); gfx->drawFastVLine(cx, cy - a, 2 * a + 1, col); }
  if (a >= 2) for (int k = 1; k < a; k++) { gfx->drawPixel(cx - k, cy - k, col); gfx->drawPixel(cx + k, cy + k, col); gfx->drawPixel(cx + k, cy - k, col); gfx->drawPixel(cx - k, cy + k, col); }
}
void ccBox(int x, int y, int w, int h, uint16_t col) { gfx->drawRoundRect(x, y, w, h, 6, col); }

// ───── live: the real Claude Code on your computer, through larp-bridge and the web app ─────
// When the bridge is linked, the session page mirrors your real session, the status page shows what
// /status would, the launcher starts preset sessions in Terminal, and permission prompts come to the charm.
String ccField(const String &s, int k) {                       // k-th 0x1F-separated field
  int st = 0;
  for (int i = 0; i < k; i++) { st = s.indexOf('\x1F', st); if (st < 0) return ""; st++; }
  int e = s.indexOf('\x1F', st);
  return asciiOnly(e < 0 ? s.substring(st) : s.substring(st, e));
}
void ccAlert() {                                               // a little pager chirp
  if (!soundsOn) return;
  for (int i = 0; i < 3; i++) { tone(BUZZER, 1800 + i * 300, 60); delay(90); }
  noTone(BUZZER);
}
// [op] ... from the web app, which relays larp-bridge
void ccPacket(const uint8_t *p, uint16_t len) {
  if (len < 1) return;
  uint32_t now = millis();
  String s = len > 1 ? String((const char *)(p + 1), len - 1) : String();
  switch (p[0]) {
    case 0: {                                                    // state: [state][elapsed u16] project 1F model 1F tool 1F prompt
      if (len < 4) return;
      if (!ccLinked()) { ccLogN = 0; ccLen = 0; ccState = CS_REST; klog("cc: bridge linked"); }
      uint8_t was = ccLState;
      ccLState = min((int)p[1], (int)CL_DONE);
      ccLiveSince = now - (uint32_t)(p[2] | (p[3] << 8)) * 1000UL;
      String f = String((const char *)(p + 4), len - 4);
      ccLProject = ccField(f, 0); ccLModel = ccField(f, 1); ccLTool = ccField(f, 2); ccLPrompt = ccField(f, 3);
      ccLive = true; ccLiveAt = now;
      if (was != ccLState) {
        if (ccLState == CL_DONE) { ccSetPose(CP_HAPPY, 2400); klog("cc: claude is done"); }
        if (ccLState == CL_WAITING) klog("cc: your turn");
        if (ccLState == CL_THINKING || ccLState == CL_TOOL) ccVerb = random(0, 12);
      }
      break;
    }
    case 1:                                                      // log line: [kind] text
      if (len >= 2) { static const uint8_t K[5] = {CK_USER, CK_TEXT, CK_TOOL, CK_RESULT, CK_ERR}; ccAdd(K[min((int)p[1], 4)], asciiOnly(String((const char *)(p + 2), len - 2)).c_str()); }
      ccLiveAt = now;
      break;
    case 2: ccLogN = 0; break;                                   // clear
    case 3:                                                      // permission: [id u16] tool 1F detail 1F project
      if (len < 3) return;
      ccPermId = p[1] | (p[2] << 8);
      { String f = String((const char *)(p + 3), len - 3); ccPermTool = ccField(f, 0); ccPermDetail = ccField(f, 1); ccPermProj = ccField(f, 2); }
      ccPermOn = true; ccPermAt = now; ccPermAnswer = -1;
      touchActivity();
      if (mode != M_CLAUDE) { ccPermReturn = mode; setMode(M_CLAUDE); } else ccPermReturn = M_CLAUDE;
      ccBig = false; ccBigT = 0; ccSetPose(CP_WAVE, 60000);
      klog("cc: wants to use %s", ccPermTool.c_str());
      ccAlert();
      break;
    case 4:                                                      // permission over: [id u16][how 0 elsewhere 1 answered]
      if (len >= 3 && (p[1] | (p[2] << 8)) == ccPermId && ccPermOn) {
        ccPermOn = false; ccPose = CP_IDLE;
        if (ccPermAnswer < 0) toast("answered on laptop", 1200);
        if (ccPermReturn != M_CLAUDE && mode == M_CLAUDE) setMode(ccPermReturn);
      }
      break;
    case 5:                                                      // launcher presets: name 1F name ...
      ccPresetN = 0;
      for (int k = 0; k < 6; k++) { String n = ccField(s, k); if (!n.length()) break; ccPreset[ccPresetN++] = n.substring(0, 22); }
      break;
    case 6:                                                      // status: [ctx][cost c u16][min u16][+ u16][- u16] version 1F model 1F session 1F cwd
      if (len < 10) return;
      ccSCtx = p[1]; ccSCost = p[2] | (p[3] << 8); ccSMin = p[4] | (p[5] << 8); ccSAdd = p[6] | (p[7] << 8); ccSDel = p[8] | (p[9] << 8);
      { String f = String((const char *)(p + 10), len - 10); ccSVersion = ccField(f, 0); String m = ccField(f, 1); if (m.length()) ccLModel = m; ccSSession = ccField(f, 2); ccSCwd = ccField(f, 3); }
      ccLiveAt = now;
      break;
  }
}
void ccAnswer(bool allow) {
  if (!ccPermOn || ccPermAnswer >= 0) return;
  char b[24]; snprintf(b, sizeof(b), "cc=%s:%u", allow ? "allow" : "deny", ccPermId);
  notifyText(b);
  ccPermAnswer = allow; ccPermAnsweredAt = millis();
  ccSetPose(allow ? CP_HAPPY : CP_IDLE, 2000);
  klog("cc: %s from the charm", allow ? "allowed" : "denied");
  sfx(allow ? 2 : 1);
}
void ccLaunch(int i) {
  if (i < 0 || i >= ccPresetN) return;
  char b[16]; snprintf(b, sizeof(b), "cc=launch:%d", i);
  notifyText(b);
  ccPresetHit = i; ccPresetHitAt = millis();
  toast(String("launching ") + ccPreset[i], 1400);
  klog("cc: launch %s", ccPreset[i].c_str());
  sfx(2);
}

// the permission card: Claude is asking, the charm answers
void drawCcPerm(uint32_t now) {
  gfx->fillScreen(c565(12, 12, 14));
  ccBox(8, 10, 224, 252, CC_ORANGE);
  gfx->fillRect(20, 6, 74, 9, c565(12, 12, 14));
  textAt("permission", 26, 7, 1, CC_ORANGE);
  ccMascot(88, 24, 4);
  textAt("Claude wants to use", 63, 72, 1, CC_DIM);
  int tw = ccPermTool.length() * 12;
  textAt(ccPermTool, 120 - tw / 2, 86, 2, COL_WHITE);
  String d = ccPermDetail;                                     // the command or file, wrapped
  for (int k = 0, y = 110; k < 4 && d.length(); k++, y += 11) {
    String line = d.substring(0, 34);
    if (k == 3 && d.length() > 34) line = line.substring(0, 31) + "...";
    textAt(line, 120 - line.length() * 3, y, 1, CC_TEXT);
    d = d.substring(min((int)d.length(), 34));
  }
  if (ccPermProj.length()) { String in = String("in ") + ccPermProj; textAt(in, 120 - in.length() * 3, 160, 1, CC_DIM); }
  uint32_t left = (now - ccPermAt) < 45000 ? (45000 - (now - ccPermAt)) / 1000 : 0;
  if (ccPermAnswer < 0) {
    gfx->drawRoundRect(20, 186, 92, 40, 8, CC_RED);
    gfx->drawRoundRect(128, 186, 92, 40, 8, CC_GREEN);
    textAt("deny", 66 - 24, 199, 2, CC_RED);
    textAt("allow", 174 - 30, 199, 2, CC_GREEN);
    char b[40]; snprintf(b, sizeof(b), "or answer on your laptop  %lus", (unsigned long)left);
    textAt(b, 120 - strlen(b) * 3, 238, 1, CC_DIM);
  } else {
    const char *m = ccPermAnswer ? "allowed" : "denied";
    gfx->fillRoundRect(20, 186, 200, 40, 8, ccPermAnswer ? CC_GREEN : CC_RED);
    textAt(m, 120 - strlen(m) * 6, 199, 2, c565(12, 12, 14));
    textAt("sent to Claude Code", 63, 238, 1, CC_DIM);
    if (now - ccPermAnsweredAt > 1600) { ccPermOn = false; if (ccPermReturn != M_CLAUDE && mode == M_CLAUDE) setMode(ccPermReturn); }
  }
}

// the page tabs along the top: session, status, launch
void ccTabs() {
  static const char *T[3] = {"session", "status", "launch"};
  static const int X[3] = {51, 105, 153};
  for (int i = 0; i < 3; i++) textAt(T[i], X[i], 3, 1, i == ccPage ? CC_ORANGE : mix565(CC_DIM, COL_BLACK, 110));
  gfx->drawFastHLine(X[ccPage], 11, strlen(T[ccPage]) * 6 - 1, CC_ORANGE);
  gfx->fillCircle(196, 6, 2, ccLinked() ? CC_GREEN : mix565(CC_DIM, COL_BLACK, 110));
}

// what /status shows, from the bridge
void drawCcStatus(uint32_t now) {
  bool live = ccLinked();
  textAt("Status", 18, 22, 2, CC_ORANGE);
  char b[48];
  struct Row { const char *k; String v; uint16_t c; };
  String ctx = asciiBar(ccSCtx / 100.0f, 12, '#', '#', '.') + " " + String(ccSCtx) + "%";
  snprintf(b, sizeof(b), "$%u.%02u", ccSCost / 100, ccSCost % 100); String cost = b;
  snprintf(b, sizeof(b), "%uh %02um", ccSMin / 60, ccSMin % 60); String tim = ccSMin >= 60 ? String(b) : String(ccSMin) + "m";
  String state = ccLState == CL_TOOL && ccLTool.length() ? ccLTool : String(CL_NAME[ccLState]);
  Row rows[9] = {
    {"Version", ccSVersion.length() ? ccSVersion : String("-"), CC_TEXT},
    {"Session", ccSSession.length() ? ccSSession : String("-"), CC_TEXT},
    {"cwd", ccSCwd.length() ? ccSCwd : ccLProject.length() ? ccLProject : String("-"), CC_TEXT},
    {"Model", ccLModel.length() ? ccLModel : String("-"), CC_TEXT},
    {"Context", ctx, ccSCtx > 80 ? CC_RED : CC_ORANGE},
    {"Cost", cost, CC_TEXT},
    {"Time", tim, CC_TEXT},
    {"Lines", "", CC_TEXT},
    {"State", state, ccLState == CL_PERM ? CC_ORANGE : ccLState == CL_DONE ? CC_GREEN : CC_TEXT},
  };
  for (int i = 0; i < 9; i++) {
    int y = 46 + i * 17;
    textAt(rows[i].k, 18, y, 1, CC_DIM);
    if (i == 7) {
      snprintf(b, sizeof(b), "+%u", ccSAdd); textAt(b, 84, y, 1, CC_GREEN);
      int w = strlen(b) * 6; snprintf(b, sizeof(b), "-%u", ccSDel); textAt(b, 90 + w, y, 1, CC_RED);
    } else textAt(rows[i].v.substring(0, 24), 84, y, 1, live || i < 4 ? rows[i].c : CC_DIM);
  }
  if (live) { textAt("bridge linked", 18, 204, 1, CC_GREEN); }
  else {
    textAt("not linked. on your computer run", 18, 200, 1, CC_DIM);
    textAt("node larp-bridge/bridge.mjs", 18, 212, 1, CC_TEXT);
  }
  ccMascot(160, 224, 3);
}

// start a preset session on your computer
void drawCcLaunch(uint32_t now) {
  textAt("Launch", 18, 22, 2, CC_ORANGE);
  textAt("starts in Terminal on your laptop", 18, 42, 1, CC_DIM);
  if (!ccLinked() || !ccPresetN) {
    textAt("no bridge linked yet", 60, 120, 1, CC_TEXT);
    textAt("node larp-bridge/bridge.mjs", 39, 136, 1, CC_DIM);
    ccMascot(96, 180, 3);
    return;
  }
  for (int i = 0; i < ccPresetN; i++) {
    int y = 58 + i * 30;
    bool hit = ccPresetHit == i && now - ccPresetHitAt < 700;
    if (hit) gfx->fillRoundRect(14, y, 212, 25, 6, CC_ORANGE);
    else gfx->drawRoundRect(14, y, 212, 25, 6, mix565(CC_DIM, COL_BLACK, 90));
    textAt(">", 24, y + 9, 1, hit ? c565(12, 12, 14) : CC_ORANGE);
    textAt(ccPreset[i], 36, y + 9, 1, hit ? c565(12, 12, 14) : CC_TEXT);
  }
}
void ccTapPage(int x, int y) {
  if (ccPage == 2) { if (ccLinked()) for (int i = 0; i < ccPresetN; i++) if (y >= 58 + i * 30 && y < 83 + i * 30) { ccLaunch(i); return; } return; }
  if (ccPage == 1) return;
  if (x >= 14 && x <= 74 && y >= 22 && y <= 68) { ccBigOpen(); return; }    // the little critter: pop it out
  if (ccLinked()) { ccSetPose(CP_WAVE, 1500); return; }
  if (ccState == CS_REST) ccPoke(100);
}

void drawClaude() {
  uint32_t now = millis();
  bool live = ccLinked();
  if (!live) {                                                   // nothing linked: the little demo plays
    if (!ccLen) ccPlan(-1);
    CcStep &st = ccScript[min((int)ccPos, CC_STEPS - 1)];
    switch (ccState) {
      case CS_TYPE:
        if (st.kind != CK_USER) { ccState = CS_THINK; ccAt = now; break; }
        if (now - ccAt > strlen(st.s) * 55 + 500) { ccAdd(CK_USER, st.s); ccPos++; ccState = CS_THINK; ccAt = now; }
        break;
      case CS_THINK:
        if (ccPos >= ccLen) { ccState = CS_REST; ccAt = now; if (ccPose != CP_DIZZY) ccSetPose(CP_HAPPY, 2200); break; }
        if (now - ccAt > ccScript[ccPos].think) { ccState = CS_STREAM; ccAt = now; ccAdd(ccScript[ccPos].kind, ""); }
        break;
      case CS_STREAM: {
        CcStep &cur = ccScript[ccPos];
        int n = min((int)strlen(cur.s), (int)((now - ccAt) / 14));
        snprintf(ccLog[ccLogN - 1].s, sizeof(ccLog[0].s), "%.*s", n, cur.s);
        if (n >= (int)strlen(cur.s)) { ccPos++; ccState = CS_THINK; ccAt = now; if (ccPos < ccLen && ccScript[ccPos].kind != CK_RESULT) ccVerb = random(0, 12); }
        break;
      }
      default:
        if (now - ccAt > (idleEyesOn ? 9000UL : 5000UL)) ccPlan(-1);
        break;
    }
  } else if (now - ccVerbAt > 5000) { ccVerbAt = now; ccVerb = random(0, 12); }

  if (ccPermOn) { drawCcPerm(now); return; }

  ccBigT += ((ccBig ? 1.0f : 0.0f) - ccBigT) * 0.22f;
  if (fabsf(ccBigT - (ccBig ? 1.0f : 0.0f)) < 0.02f) ccBigT = ccBig ? 1.0f : 0.0f;
  if (ccBig && ccBigT >= 1.0f) { drawCcBig(now); return; }

  gfx->fillScreen(c565(12, 12, 14));
  ccTabs();
  if (ccPage == 1) { drawCcStatus(now); return; }
  if (ccPage == 2) { drawCcLaunch(now); return; }

  // welcome box
  ccBox(12, 14, 216, 58, CC_ORANGE);
  ccMascot(21, 31, 3);
  ccStar(80, 25, 4, CC_ORANGE);
  textAt("Welcome to", 88, 22, 1, CC_TEXT);
  textAt("Claude Code!", 88, 33, 1, COL_WHITE);
  if (live) {
    textAt((ccLModel.length() ? ccLModel : String("claude")).substring(0, 22), 80, 47, 1, CC_DIM);
    textAt((String("cwd: ") + (ccLProject.length() ? ccLProject : String("?"))).substring(0, 22), 80, 58, 1, CC_DIM);
  } else {
    textAt("/help for help", 80, 47, 1, CC_DIM);
    textAt("cwd: /larp/charm (demo)", 80, 58, 1, CC_DIM);
  }

  // transcript, newest at the bottom
  const int top = 80, lh = 11;
  bool thinking = live ? (ccLState == CL_THINKING || ccLState == CL_TOOL) : (ccState == CS_THINK && ccPos < ccLen);
  int rows = (thinking ? 12 : 13), first = max(0, (int)ccLogN - rows);
  int yy = top + (rows - (ccLogN - first)) * lh;
  if (yy < top) yy = top;
  for (int i = first; i < ccLogN; i++, yy += lh) {
    const CcLine &l = ccLog[i];
    switch (l.kind) {
      case CK_USER:   textAt(">", 16, yy, 1, CC_DIM); textAt(String(l.s).substring(0, 33), 28, yy, 1, CC_DIM); break;
      case CK_TEXT:   gfx->fillCircle(19, yy + 3, 2, CC_TEXT); textAt(String(l.s).substring(0, 33), 28, yy, 1, CC_TEXT); break;
      case CK_TOOL: {
        bool running = i == ccLogN - 1 && (live ? ccLState == CL_TOOL : (ccState == CS_STREAM || (thinking && ccScript[ccPos].kind == CK_RESULT)));
        gfx->fillCircle(19, yy + 3, 2, running && (now / 300) % 2 ? CC_DIM : CC_GREEN);
        String s = l.s; int p = s.indexOf('(');
        if (p > 0) { textAt(s.substring(0, p), 28, yy, 1, COL_WHITE); textAt(s.substring(p, 33), 28 + p * 6, yy, 1, CC_DIM); }
        else textAt(s.substring(0, 33), 28, yy, 1, COL_WHITE);
        break;
      }
      case CK_RESULT: case CK_ERR: {
        gfx->drawFastVLine(30, yy, 4, CC_DIM); gfx->drawFastHLine(30, yy + 4, 4, CC_DIM);
        uint16_t c = l.kind == CK_ERR ? CC_RED : l.s[0] == '+' ? CC_GREEN : CC_DIM;
        textAt(String(l.s).substring(0, 31), 40, yy, 1, c);
        if (l.kind == CK_RESULT && l.s[0] == '+') { const char *m = strchr(l.s, '-'); if (m) textAt(m, 40 + (m - l.s) * 6, yy, 1, CC_RED); }
        break;
      }
      default: break;
    }
  }
  if (thinking) {                                                  // the spinner and its whimsical verb
    char b[64];
    uint32_t secs = (now - (live ? ccLiveSince : ccAt)) / 1000 + 1;
    if (live && ccLState == CL_TOOL) snprintf(b, sizeof(b), "Running... (%lus, esc to stop)", (unsigned long)secs);
    else snprintf(b, sizeof(b), "%s... (%lus, esc to stop)", idleEyesOn && !live ? "Dreaming" : CC_VERBS[ccVerb], (unsigned long)secs);
    ccStar(19, yy + 3, (now / 120) % 6, CC_ORANGE);
    textAt(String(b).substring(0, 33), 28, yy, 1, CC_ORANGE);
  }

  // input box
  ccBox(12, 232, 216, 22, ccLState == CL_WAITING && live ? CC_ORANGE : CC_DIM);
  textAt(">", 20, 239, 1, CC_TEXT);
  if (!live && ccState == CS_TYPE && ccScript[ccPos].kind == CK_USER) {
    int n = min((int)strlen(ccScript[ccPos].s), (int)((now - ccAt) / 55));
    String s = String(ccScript[ccPos].s).substring(0, n);
    textAt(s, 32, 239, 1, CC_TEXT);
    gfx->fillRect(32 + n * 6, 238, 6, 9, CC_TEXT);
  } else {
    const char *hint = !live ? "Try \"make the charm cuter\"" : ccLState == CL_WAITING || ccLState == CL_DONE ? "your turn, on the laptop" : ccLState == CL_OFFLINE ? "session ended" : "Claude is working...";
    textAt(hint, 32, 239, 1, mix565(CC_DIM, COL_BLACK, 90));
    if ((now / 500) % 2) gfx->fillRect(32, 238, 1, 9, CC_TEXT);
  }
  textAt(live ? CL_NAME[ccLState] : "? for shortcuts", 18, 260, 1, live && ccLState == CL_DONE ? CC_GREEN : CC_DIM);
  if (ccBigT > 0.01f) drawCcPop(ccBigT);
}
