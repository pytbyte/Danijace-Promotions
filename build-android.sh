#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
APK_DIR="$ANDROID_DIR/app/build/outputs/apk/debug"
SOURCE_APK="$APK_DIR/app-debug.apk"
FINAL_APK="$APK_DIR/DANIJACE PROMOTIONS.apk"

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

command -v npm >/dev/null 2>&1 || fail "npm is required but was not found in PATH."
command -v npx >/dev/null 2>&1 || fail "npx is required but was not found in PATH."
[[ -d "$ANDROID_DIR" ]] || fail "Android project directory was not found: $ANDROID_DIR"
[[ -f "$ANDROID_DIR/gradlew" ]] || fail "Gradle wrapper was not found: $ANDROID_DIR/gradlew"

cd "$SCRIPT_DIR"

echo "============================================================"
echo " DANIJACE PROMOTIONS ANDROID BUILD"
echo "============================================================"
echo

echo "1. Building Next.js application..."
npm run build
echo

echo "2. Syncing Capacitor..."
npx cap sync android
echo

echo "3. Building Android debug APK..."
(
    cd "$ANDROID_DIR"
    ./gradlew assembleDebug
)
echo

echo "4. Naming APK..."
[[ -f "$SOURCE_APK" ]] || fail "APK was not found after the Gradle build: $SOURCE_APK"
cp -- "$SOURCE_APK" "$FINAL_APK"

echo
echo "============================================================"
echo " BUILD SUCCESSFUL"
echo "============================================================"
echo
echo "APK:"
echo "$FINAL_APK"
echo
echo "============================================================"
