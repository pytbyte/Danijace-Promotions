# Danijace Promotions

Danijace Promotions is a SACCO management system for member records, savings, loans, and payment-related SMS workflows. It provides a web dashboard and installable PWA, with a Capacitor Android app for device features such as SMS inbox monitoring and background SMS delivery.

## What it does

- Manages members, membership details, and profile photos.
- Tracks savings accounts and transactions, including adjustments and reversals.
- Manages loans, guarantor checks, repayments, waivers, and loan settings.
- Summarizes members, savings, and loan activity in the dashboard.
- Reads supported payment SMS from Android devices and routes them through the savings and loan processing flows.
- Queues outgoing member SMS for registered Android worker devices. Firebase Cloud Messaging wakes workers so they can claim queued messages from the server.
- Supports Google sign-in and account security features, including PIN recovery and Android device authentication.

## Technology

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4 and the React Compiler
- MongoDB for application records
- Auth.js (NextAuth) with Google sign-in
- Vercel Blob for member profile photos
- Resend for PIN recovery email
- Firebase Admin and Firebase Cloud Messaging for Android worker wake-ups
- Capacitor 8 for the Android app

## Requirements

- Node.js 20.9 or newer and npm
- A MongoDB database
- Google OAuth credentials
- Vercel Blob and Resend credentials for profile photo uploads and PIN recovery email
- A Firebase project for Android push notifications
- Android SDK and a compatible JDK to build the Android app

## Local development

Install the locked dependencies:

```bash
npm ci
```

Create `.env.local` in the repository root. It is ignored by Git.

```dotenv
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>
MONGODB_DB=danijace-promotions
AUTH_SECRET=<random-secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
```

Add the local callback URL to the Google OAuth client:

```text
http://localhost:3000/api/auth/callback/google
```

Start the development server:

```bash
npm run dev
```

Open <http://localhost:3000>. The root page is the sign-in page; the management dashboard is under `/dashboard`.

## Environment variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `MONGODB_URI` | Connects to MongoDB | Required. |
| `MONGODB_DB` | Selects the database | Defaults to `danijace-promotions`. |
| `AUTH_SECRET` | Signs Auth.js sessions | Set a strong random value in each environment. |
| `GOOGLE_CLIENT_ID` | Google OAuth and Android token audience | Required for Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | Required for web sign-in. |
| `MEMBERSHIP_PREFIX` | Prefix used for generated membership numbers | Defaults to `GEO` in the current code; preserve the existing format unless membership records are being migrated. |
| `BLOB_READ_WRITE_TOKEN` | Stores and retrieves member profile photos | Required when using Vercel Blob. |
| `RESEND_API_KEY` | Sends PIN recovery emails | Required for that feature. |
| `RESEND_FROM_EMAIL` | Sender address for PIN recovery emails | Must be configured with Resend. |
| `FIREBASE_PROJECT_ID` | Firebase Admin project | Used for Android push notifications. |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service account | Used with the private key in deployed environments. |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin service account private key | Keep it in server-side environment settings. Newline escapes (`\\n`) are supported. |
| `SMS_WORKER_TEST_TOKEN` | Authenticates Android SMS worker requests | Must match the Android build configuration. The current shared-token mechanism is temporary and should be replaced before production use. |

Firebase Admin can use Google Application Default Credentials when the three Firebase service-account variables are not set. Do not commit `.env.local`, service-account keys, or other secrets.

## Common commands

```bash
npm run dev      # Start local development
npm run lint     # Run ESLint
npm run build    # Build the production web app with Webpack
npm run start    # Serve a production build locally
```

## Android app

The Android application ID is `com.pytbyte.danijacepromotions`. The checked-in `android/app/google-services.json` is configured for the Danijace Promotions Firebase project and this application ID. Replace it with the Firebase-generated file for the matching project and package if either changes.

The Capacitor configuration points the Android app at `https://danijace-promotions.vercel.app`; an installed APK therefore loads the hosted web app. The build script runs the web build, syncs Capacitor, builds a debug APK, and copies it to `android/app/build/outputs/apk/debug/DANIJACE PROMOTIONS.apk`:

```bash
./build-android.sh
```

For local or staging Android work, update the Capacitor server URL to the intended environment before building.

## Deployment

The web app uses server-side API routes and MongoDB, so deploy it to a Node.js-capable host. The Android configuration currently targets the Vercel deployment at `https://danijace-promotions.vercel.app`.

Set the required environment variables in the deployment environment. For Google web sign-in, register the deployment callback URL:

```text
https://danijace-promotions.vercel.app/api/auth/callback/google
```

Configure Firebase Admin credentials for push notifications, Vercel Blob for member photos, and Resend for PIN recovery email when those features are enabled. Keep all private credentials in server-side environment settings.

## Repository layout

- `src/app` — web pages and API routes
- `src/components` — dashboard, member, loan, savings, SMS, and security UI
- `src/lib` — MongoDB access and member, loan, savings, SMS, and security services
- `android` — native Android services and Capacitor plugins
- `capacitor.config.ts` — Android app identity and hosted web-app URL
