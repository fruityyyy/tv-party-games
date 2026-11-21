#!/bin/sh
# Bundles the game server into the Android TV app and builds the APK.
# Output: android/app/build/outputs/apk/release/app-release.apk
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/android/app/src/main/assets/nodejs-project"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

echo "Bundling game server…"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT/server.js" "$ROOT/game.js" "$ROOT/package.json" "$ROOT/package-lock.json" "$DEST/"
cp -R "$ROOT/public" "$DEST/"
cp -R "$ROOT/shared" "$DEST/shared"
(cd "$DEST" && npm ci --omit=dev --no-audit --no-fund --silent)

echo "sdk.dir=$ANDROID_HOME" > "$ROOT/android/local.properties"
cd "$ROOT/android"
./gradlew assembleRelease
ls -lh app/build/outputs/apk/release/app-release.apk
