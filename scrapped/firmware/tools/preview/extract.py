# Pulls the firmware's own drawing code out of LarpCharm.ino so preview.cpp can run it on a desktop.
# Usage: python3 extract.py ../../LarpCharm/LarpCharm.ino extracted.inc
import sys

src = open(sys.argv[1]).read()


def func(sig):
    i = src.index(sig)
    depth = 0
    for k in range(src.index('{', i), len(src)):
        depth += {'{': 1, '}': -1}.get(src[k], 0)
        if depth == 0:
            return src[i:k + 1]


def span(a, b):
    i = src.index(a)
    return src[i:src.index(b, i)]


parts = [
    span("static inline uint16_t c565", "const uint16_t AERO_ACC_C"),
    span("static inline uint16_t blend565", "// Frosted glass panel"),
    func("void sparkle(int x"), func("void drawBolt(int cx"),
    span("#define ORB_N 11", "#define ORB_STEP"), func("int orbOfMode(uint8_t m)"), func("void orbGlyph(int i"),
    span("const char *DAYS_T[]", "// ───────────── Animated backgrounds"),
    func("void buildAeroBg()"), func("String asciiOnly(const String &s)"),
    span("// ═════════════ v7: the Cotton look ═════════════", "// ───────────── Status notifications ─────────────"),
]
open(sys.argv[2], 'w').write("\n".join(parts))
