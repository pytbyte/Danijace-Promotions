#!/usr/bin/env bash

set -e

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

cd android

./gradlew assembleDebug

echo

echo "4. Naming APK..."

SOURCE_APK="$(pwd)/app/build/outputs/apk/debug/app-debug.apk"
FINAL_APK="$(pwd)/app/build/outputs/apk/debug/DANIJACE PROMOTIONS.apk"

if [ ! -f "$SOURCE_APK" ]; then
    echo
    echo "ERROR: APK was not found:"
    echo "$SOURCE_APK"
    exit 1
fi

cp "$SOURCE_APK" "$FINAL_APK"

echo
echo "============================================================"
echo " BUILD SUCCESSFUL"
echo "============================================================"
echo
echo "APK:"
echo "$FINAL_APK"
echo
echo "============================================================"

