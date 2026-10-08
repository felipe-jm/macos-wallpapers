#!/bin/bash
# Builds "ASCII Wallpaper.app": bundles the 320x180 (16:9) scenes in ./scenes,
# reworked from ascii.rest's 200x100 originals, with the WebGL dot renderer in
# ./web into one script, compiles the Swift menu-bar app and signs it ad hoc.
#   ./build.sh           build into ./build
#   ./build.sh install   build, copy to ~/Applications and launch
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="ASCII Wallpaper"
BUILD=build
APP="$BUILD/$APP_NAME.app"
RES="$APP/Contents/Resources"

npm ci --no-audit --no-fund --silent

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/web"

# Every scene in ./scenes (types.ts is the contract and dot.ts a helper, not scenes).
SCENES=$(cd scenes && ls *.ts | grep -v -e '^types\.ts$' -e '^dot\.ts$' | sed 's/\.ts$//')
{
  echo 'import { start } from "../web/wallpaper.js";'
  i=0
  for s in $SCENES; do echo "import * as s$i from \"../scenes/$s.ts\";"; i=$((i + 1)); done
  echo 'start({'
  i=0
  for s in $SCENES; do echo "  \"$s\": s$i,"; i=$((i + 1)); done
  echo '});'
} > "$BUILD/entry.js"
printf '%s\n' $SCENES > "$RES/web/scenes.txt"

npx esbuild "$BUILD/entry.js" --bundle --format=iife --minify --log-level=warning --outfile="$RES/web/scenes.js"
cp web/index.html "$RES/web/"

swiftc -O -target arm64-apple-macos13 Sources/main.swift -o "$APP/Contents/MacOS/AsciiWallpaper"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ASCII Wallpaper</string>
  <key>CFBundleIdentifier</key><string>rest.ascii.wallpaper</string>
  <key>CFBundleExecutable</key><string>AsciiWallpaper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP"
echo "built $APP ($(wc -l < "$RES/web/scenes.txt" | tr -d ' ') scenes)"

if [ "${1:-}" = "install" ]; then
  pkill -x AsciiWallpaper || true
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$APP_NAME.app"
  cp -R "$APP" "$HOME/Applications/"
  open "$HOME/Applications/$APP_NAME.app"
  echo "installed ~/Applications/$APP_NAME.app"
fi
