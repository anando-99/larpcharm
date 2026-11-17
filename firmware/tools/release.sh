#!/bin/sh
# Build the firmware and publish it for the website:   firmware/tools/release.sh [--gh]
#   flash/bootloader.bin, partitions.bin, boot_app0.bin   the rest of the flash, for "install over usb"
#   flash/larpcharm-ota.bin   the app: flashed at 0x10000 over usb, or sent whole for "update over bluetooth"
#   flash/manifest.json       what ESP Web Tools (the website's installer) reads: the parts, their offsets, the version
# Only these parts are written over usb, so the charm's data partition (photos, songs, taught spells) stays.
# --gh also makes a GitHub release v<version> with both images attached.
set -e
cd "$(dirname "$0")/../.."
CLI="${ARDUINO_CLI:-arduino-cli}"
command -v "$CLI" >/dev/null 2>&1 || CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB"
BUILD="${BUILD_DIR:-/tmp/larpcharm-build}"
VERSION=$(sed -n 's/^#define FW_VERSION *"\(.*\)"/\1/p' firmware/LarpCharm/LarpCharm.ino)
"$CLI" compile --fqbn "$FQBN" --build-path "$BUILD" firmware/LarpCharm
mkdir -p flash
rm -f flash/larpcharm.bin
cp "$BUILD/LarpCharm.ino.bootloader.bin" flash/bootloader.bin
cp "$BUILD/LarpCharm.ino.partitions.bin" flash/partitions.bin
cp "$BUILD/boot_app0.bin" flash/boot_app0.bin
cp "$BUILD/LarpCharm.ino.bin" flash/larpcharm-ota.bin
cat > flash/manifest.json <<JSON
{
  "name": "Larp Charm",
  "version": "$VERSION",
  "new_install_prompt_erase": true,
  "builds": [{ "chipFamily": "ESP32-S3", "parts": [
    { "path": "bootloader.bin", "offset": 0 },
    { "path": "partitions.bin", "offset": 32768 },
    { "path": "boot_app0.bin", "offset": 57344 },
    { "path": "larpcharm-ota.bin", "offset": 65536 }
  ] }]
}
JSON
echo "flash/: firmware $VERSION, app $(wc -c < flash/larpcharm-ota.bin | tr -d ' ') bytes"
if [ "$1" = "--gh" ]; then
  (cd flash && shasum -a 256 bootloader.bin partitions.bin boot_app0.bin larpcharm-ota.bin) > "$BUILD/SHA256SUMS"
  (cd flash && zip -q "$BUILD/larpcharm-$VERSION-usb.zip" manifest.json bootloader.bin partitions.bin boot_app0.bin larpcharm-ota.bin)
  gh release create "v$VERSION" flash/larpcharm-ota.bin "$BUILD/larpcharm-$VERSION-usb.zip" "$BUILD/SHA256SUMS" \
    --title "Larp Charm $VERSION" --notes-file "${NOTES:-/dev/null}"
fi
