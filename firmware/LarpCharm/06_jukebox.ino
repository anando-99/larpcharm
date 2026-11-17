// Larp Charm firmware: The buzzer jukebox: built-in melodies and your own (from MIDI).
// One of the sketch's tabs; Arduino joins them after LarpCharm.ino in name order (see docs/firmware.md).

// ═════════════ v5: buzzer jukebox ═════════════
// Built-in songs are ids 0..SONG_COUNT-1. Songs you add from the app are stored on the charm as ids 100..107.
#define MY_SONGS   8
#define MY_SONG_MAX 1500
#define MY_CAT     CAT_COUNT
char     mySongName[MY_SONGS][25];
uint16_t mySongN[MY_SONGS];
uint8_t  mySongBpm[MY_SONGS];
bool     mySongHas[MY_SONGS];
uint8_t *jbNotesBuf = nullptr;                 // the custom song being played, loaded from flash
const uint8_t *jbNotes = nullptr;
uint16_t jbCount = 0;
uint8_t  jbBpm = 120, jbCat = 0;
int16_t  jbSelId = 0;

#pragma pack(push, 1)
struct SongHdr { char magic[4]; uint8_t ver; uint8_t bpm; uint16_t n; char name[24]; };
#pragma pack(pop)

String mySongPath(int slot) { return String("/s/") + slot + ".sng"; }

void scanMySongs() {
  for (int i = 0; i < MY_SONGS; i++) {
    mySongHas[i] = false;
    if (!fsOK) continue;
    File f = FFat.open(mySongPath(i), "r");
    SongHdr h;
    if (f && f.read((uint8_t *)&h, sizeof(h)) == sizeof(h) && memcmp(h.magic, "LSNG", 4) == 0 && h.n > 0 && h.n <= MY_SONG_MAX) {
      mySongHas[i] = true; mySongN[i] = h.n; mySongBpm[i] = max((uint8_t)30, h.bpm);
      memcpy(mySongName[i], h.name, 24); mySongName[i][24] = 0;
    }
    if (f) f.close();
  }
}
int mySongCount() { int n = 0; for (int i = 0; i < MY_SONGS; i++) n += mySongHas[i]; return n; }

bool songExists(int id) { return (id >= 0 && id < SONG_COUNT) || (id >= 100 && id < 100 + MY_SONGS && mySongHas[id - 100]); }
const char *songName(int id) {
  if (id >= 0 && id < SONG_COUNT) return SONGS[id].name;
  if (id >= 100 && id < 100 + MY_SONGS && mySongHas[id - 100]) return mySongName[id - 100];
  return "?";
}
int songCat(int id) { return id >= 100 ? MY_CAT : SONGS[id].cat; }
int catCount() { return mySongCount() ? CAT_COUNT + 1 : CAT_COUNT; }
const char *catName(int c) { return c >= CAT_COUNT ? "My songs" : SONG_CATS[c]; }
int songsInCat(int c, int16_t *out, int maxN) {
  int n = 0;
  if (c >= CAT_COUNT) { for (int i = 0; i < MY_SONGS && n < maxN; i++) if (mySongHas[i]) out[n++] = 100 + i; }
  else for (int i = 0; i < SONG_COUNT && n < maxN; i++) if (SONGS[i].cat == c) out[n++] = i;
  return n;
}
// every song in category order, for flicking through them one by one
int allSongs(int16_t *out, int maxN) {
  int n = 0;
  for (int c = 0; c < catCount(); c++) n += songsInCat(c, out + n, maxN - n);
  return n;
}
int16_t stepSong(int16_t id, int dir) {
  int16_t all[48];
  int n = allSongs(all, 48), k = 0;
  for (int i = 0; i < n; i++) if (all[i] == id) { k = i; break; }
  return all[(k + n + dir) % n];
}

uint8_t  jbQueue[16];
uint8_t  jbQLen = 0, jbLastMidi = 0;
int16_t  jbSong = -1;
uint16_t jbNote = 0;
uint32_t jbNoteEnd = 0, jbNoteOff = 0;
bool     jbPlaying = false, jbToneOn = false;
uint8_t  jbRoll[20];
uint32_t jbSelUntil = 0;
bool     jbDirty = false;

static inline unsigned midiHz(uint8_t m) { return (unsigned)(440.0f * powf(2.0f, (m - 69) / 12.0f) + 0.5f); }

bool jbLoad(int id) {
  if (id >= 0 && id < SONG_COUNT) { jbNotes = SONGS[id].notes; jbCount = SONGS[id].n; jbBpm = SONGS[id].bpm; return true; }
  int slot = id - 100;
  if (slot < 0 || slot >= MY_SONGS || !mySongHas[slot] || !fsOK || !jbNotesBuf) return false;
  File f = FFat.open(mySongPath(slot), "r");
  SongHdr h;
  bool ok = f && f.read((uint8_t *)&h, sizeof(h)) == sizeof(h) && h.n <= MY_SONG_MAX && f.read(jbNotesBuf, h.n * 2) == h.n * 2;
  if (f) f.close();
  if (!ok) return false;
  jbNotes = jbNotesBuf; jbCount = h.n; jbBpm = max((uint8_t)30, h.bpm);
  return true;
}
void jbStartSong(int s) {
  jbDirty = true;
  if (!songExists(s) || !jbLoad(s)) { jbPlaying = false; jbSong = -1; return; }
  jbSong = s; jbNote = 0; jbPlaying = true;
  jbNoteEnd = millis() + 250;
  memset(jbRoll, 0, sizeof(jbRoll));
}
void jbStop() {
  jbDirty = true;
  jbPlaying = false; jbSong = -1; jbQLen = 0;
  if (jbToneOn) { noTone(BUZZER); jbToneOn = false; }
}
void jbEnqueue(int s) {
  if (!songExists(s)) return;
  jbDirty = true;
  if (!jbPlaying) jbStartSong(s);
  else if (jbQLen < sizeof(jbQueue)) jbQueue[jbQLen++] = s;
}
void jbSkip() {
  if (jbToneOn) { noTone(BUZZER); jbToneOn = false; }
  if (!jbQLen) { jbStop(); return; }
  int s = jbQueue[0];
  memmove(jbQueue, jbQueue + 1, --jbQLen);
  jbStartSong(s);
}
void jbService() {
  if (!jbPlaying) return;
  uint32_t now = millis();
  if (jbToneOn && (int32_t)(now - jbNoteOff) >= 0) { noTone(BUZZER); jbToneOn = false; }
  if ((int32_t)(now - jbNoteEnd) < 0) return;
  if (jbNote >= jbCount) { jbSkip(); return; }
  uint8_t m = jbNotes[jbNote * 2], d = jbNotes[jbNote * 2 + 1];
  jbNote++;
  uint32_t dur = (uint32_t)max((uint8_t)1, d) * 15000UL / jbBpm;
  jbNoteEnd = (now - jbNoteEnd > 60) ? now + dur : jbNoteEnd + dur;
  memmove(jbRoll, jbRoll + 1, sizeof(jbRoll) - 1);
  jbRoll[sizeof(jbRoll) - 1] = m;
  if (m) { tone(BUZZER, midiHz(m)); jbToneOn = true; jbNoteOff = now + dur * 85 / 100; jbLastMidi = m; eyeBounce = 6; }
}
float jbProgress() { return (jbSong < 0 || !jbCount) ? 0 : (float)jbNote / jbCount; }
