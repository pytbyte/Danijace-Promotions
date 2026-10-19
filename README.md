# Danijace Promotions

Danijace Promotions is a SACCO management application for member records, savings, loans, repayments, and related financial operations. The web application is built with Next.js and MongoDB. An Android app wraps the hosted web application with Capacitor and adds native Google sign-in and SMS processing features.

## Project structure

- `src/app` contains the Next.js pages and API route handlers.
- `src/lib` contains application services, MongoDB access, authentication, and SMS processing logic.
- `android` contains the native Android application and background SMS workers.
- `capacitor.config.ts` configures the Android app to load the deployed website.
- `vercel.json` configures scheduled Vercel tasks.
- `tests` contains Node.js tests for SMS routing and loan fine calculations.

## Requirements

- Node.js and npm
- A MongoDB database
- For Android builds: Android Studio/Android SDK and a Java version supported by the Android Gradle Plugin in this repository
- For Android push notifications: Firebase configuration for the Android app

## Local web development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create `.env.local` in the project root and set the server configuration described below.

3. Start the development server:

   ```sh
   npm run dev
   ```

4. Open `http://localhost:3000`.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the production web application |
| `npm run start` | Serve a production build locally |
| `npm run lint` | Run ESLint |
| `npm run test:sms` | Run SMS bank-routing tests |
| `npm run test:fines` | Run loan fine tests |
| `npm run sweep:fines` | Run the historical fine sweep script; requires its environment configuration |

## Server environment

Set these values in `.env.local` for local development and in the deployment environment for production. Keep credentials private; do not commit `.env.local` or paste secrets into source control.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string. Required. |
| `MONGODB_DB` | MongoDB database name. Use the existing database's exact casing; the current database is `Danijace`. |
| `AUTH_SECRET` | Secret used by Auth.js to protect authentication sessions. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID used by web sign-in and Android token verification. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret used by web sign-in. |
| `FIREBASE_PROJECT_ID` | Firebase project ID used by server-side Firebase Admin messaging. |
| `FIREBASE_CLIENT_EMAIL` | Service account email for Firebase Admin messaging. |
| `FIREBASE_PRIVATE_KEY` | Service account private key for Firebase Admin messaging. Store it as a deployment secret. Escaped `\\n` sequences are converted to newlines by the server code. |
| `SMS_WORKER_TEST_TOKEN` | Shared token required by the Android SMS worker API. It must match the Android `DANIJACE_SMS_WORKER_TOKEN` build configuration. |
| `LOANS_FINE_SWEEP_SECRET` | Secret used to authorize the scheduled loan fine sweep endpoint. |
| `CRON_SECRET` | Optional Vercel cron authorization secret. Vercel sends it as a Bearer token; the fine sweep endpoint accepts it as well as `LOANS_FINE_SWEEP_SECRET`. |
| `FINES_SWEEP_URL` | Optional target URL for the historical fine sweep script. |
| `FINES_SWEEP_AS_OF_DATE` | Optional as-of date for the historical fine sweep script. |
| `MEMBERSHIP_PREFIX` | Optional membership-number prefix override. |

The Android Firebase configuration file is `android/app/google-services.json`. It is not committed; obtain the appropriate file from the Firebase project before configuring Android push notifications. Server Firebase Admin credentials are configured separately through the `FIREBASE_*` variables above.

## Android app

The Android app is a Capacitor client. Its `server.url` in `capacitor.config.ts` points to the deployed web application, so the UI is served from that deployment. Native Android source code is still required for SMS permissions, inbox access, local SMS queueing, background workers, push notifications, and Google sign-in.

To build a debug APK using the repository script:

```sh
./build-android.sh
```

The script builds the web application, syncs Capacitor, builds the Android debug APK, and copies it to:

```text
android/app/build/outputs/apk/debug/danijace-promotions.apk
```

You can also build from Android Studio or run Gradle directly after syncing Capacitor:

```sh
npx cap sync android
cd android
./gradlew assembleDebug
```

Install the resulting APK on a device and grant the requested permissions for SMS processing. Changes to Android Java/Kotlin code, Android resources, or Capacitor configuration require a new Android build and installation. Web-only changes are deployed with the web application and normally do not require rebuilding the Android app.

### SMS processing

The Android app reads and queues SMS for processing. The server validates and processes supported bank messages, then stores applicable financial transactions. Android background workers communicate with the SMS API and can be woken through Firebase Cloud Messaging. The current automatic SMS lookback window is one week (168 hours) on both Android and the server.

The worker authentication token is currently configured in `android/app/build.gradle` and on the server as `SMS_WORKER_TEST_TOKEN`. Keep the values in sync when changing them. This is the current test-token mechanism for the worker API.

## Deployment

The web application is deployed to Vercel. Configure all required server environment variables in the Vercel project, including the correctly cased MongoDB database name, before deploying. A web deployment updates the site loaded by the Android Capacitor app.

`vercel.json` schedules `/api/loans/fines/sweep` at `0 2 * * *` (02:00 UTC daily). Configure `CRON_SECRET` or `LOANS_FINE_SWEEP_SECRET` in Vercel so the scheduled endpoint can authenticate its request. Vercel automatically sends `CRON_SECRET` in the `Authorization` header for cron invocations.

Android changes are distributed separately as an APK or through the chosen Android release channel. Rebuild and install/release a new APK when native Android code or configuration changes.

## Notes

- The application is currently configured for Danijace Promotions in `src/lib/sacco/config.ts`.
- MongoDB database names are case-sensitive for this deployment. Use `Danijace` consistently; a differently cased name can cause MongoDB error 13297.
- Do not commit credentials, service-account files, signing keys, or local environment files.
