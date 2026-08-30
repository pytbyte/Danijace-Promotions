#!/usr/bin/env bash

set -e

echo "============================================================"
echo " GEO-SHUA ANDROID BUILD"
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
echo "============================================================"
echo " BUILD SUCCESSFUL"
echo "============================================================"
echo
echo "APK:"
echo "$(pwd)/app/build/outputs/apk/debug/app-debug.apk"
echo
echo "============================================================"