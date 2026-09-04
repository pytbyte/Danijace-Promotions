import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { auth } from "@/auth";

import clientPromise from "@/lib/mongodb";

import {
  AndroidRecoveryChallenge,
  getDeviceRecoveryCollection,
  getDeviceRecoveryChallengeCollection,
  normalizeRecoveryEmail,
  DEVICE_RECOVERY_CHALLENGE_TTL_MS,
} from "@/lib/security/deviceRecovery";

export const runtime = "nodejs";

/* =========================================================
   TYPES
========================================================= */

type SessionUser = {
  id?: string | null;
  email?: string | null;
};

type AuthenticatedSession = {
  user?: SessionUser | null;
};

/* =========================================================
   CONSTANTS
========================================================= */

const CHALLENGE_BYTES = 32;

/*
 * Base64url encoding of 32 random bytes is 43 characters.
 *
 * This is deliberately strict. The native Android layer also
 * validates the challenge before attempting to sign it.
 */
const MIN_CHALLENGE_LENGTH = 32;
const MAX_CHALLENGE_LENGTH = 128;

/* =========================================================
   POST
========================================================= */

export async function POST() {
  try {
    /* =====================================================
       1. GOOGLE AUTHENTICATION
    ===================================================== */

    const session =
      (await auth()) as AuthenticatedSession | null;

    const email = normalizeRecoveryEmail(
      session?.user?.email,
    );

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    /* =====================================================
       2. USER ID
    ===================================================== */

    const userId =
      typeof session?.user?.id === "string" &&
      session.user.id.trim().length > 0
        ? session.user.id.trim()
        : undefined;

    /* =====================================================
       3. DATABASE
    ===================================================== */

    const client = await clientPromise;
    const db = client.db();

    const recoveryKeys =
      await getDeviceRecoveryCollection(db);

    const challenges =
      await getDeviceRecoveryChallengeCollection(db);

    /* =====================================================
       4. FIND REGISTERED ANDROID RECOVERY KEY
    ===================================================== */

    const recoveryKey =
      await recoveryKeys.findOne({
        email,
        enabled: true,
        platform: "android",
        keyType: "recovery",
      });

    if (!recoveryKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Android recovery device is registered.",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       5. STRICT ACCOUNT BINDING
    ===================================================== */

    /*
     * If the recovery key has a userId, the authenticated
     * session MUST also have a userId and it MUST match.
     *
     * We intentionally do not accept:
     *
     * recoveryKey.userId = "ABC"
     * current session userId = undefined
     *
     * because that would weaken account binding.
     */

    if (recoveryKey.userId) {
      if (!userId) {
        console.error(
          "ANDROID RECOVERY CHALLENGE: recovery key has userId but current session has no userId.",
          {
            email,
          },
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Unable to verify Android recovery device ownership.",
          },
          { status: 403 },
        );
      }

      if (recoveryKey.userId !== userId) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Android recovery device does not belong to this account.",
          },
          { status: 403 },
        );
      }
    }

    /* =====================================================
       6. VALIDATE RECOVERY KEY DATA
    ===================================================== */

    if (
      typeof recoveryKey.publicKey !== "string" ||
      recoveryKey.publicKey.trim().length === 0
    ) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: registered recovery key has no public key.",
        {
          email,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Registered Android recovery device is invalid.",
        },
        { status: 500 },
      );
    }

    if (
      recoveryKey.algorithm !== "ECDSA-SHA256"
    ) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: unsupported recovery key algorithm.",
        {
          email,
          algorithm: recoveryKey.algorithm,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Registered Android recovery device uses an unsupported security algorithm.",
        },
        { status: 500 },
      );
    }

    if (recoveryKey.platform !== "android") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Registered recovery device is not an Android device.",
        },
        { status: 400 },
      );
    }

    if (recoveryKey.keyType !== "recovery") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Registered recovery key is not a recovery key.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       7. INVALIDATE PREVIOUS UNUSED CHALLENGES
    ===================================================== */

    /*
     * A user should only have one active recovery challenge.
     *
     * Any previous unused challenge becomes unusable before
     * the new challenge is issued.
     */

    await challenges.updateMany(
      {
        email,
        usedAt: null,
      },
      {
        $set: {
          usedAt: new Date(),
        },
      },
    );

    /* =====================================================
       8. GENERATE CRYPTOGRAPHIC CHALLENGE
    ===================================================== */

    const challengeBytes =
      randomBytes(CHALLENGE_BYTES);

    /*
     * Base64url is safe for:
     *
     * - JSON
     * - HTTP
     * - Android bridge
     * - database hashing
     *
     * No raw binary data is transmitted.
     */

    const challenge =
      challengeBytes.toString("base64url");

    /* =====================================================
       9. DEFENSIVE CHALLENGE VALIDATION
    ===================================================== */

    if (
      challenge.length <
        MIN_CHALLENGE_LENGTH ||
      challenge.length >
        MAX_CHALLENGE_LENGTH
    ) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: generated challenge failed length validation.",
        {
          length: challenge.length,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to generate a valid recovery challenge.",
        },
        { status: 500 },
      );
    }

    /*
     * Base64url generated by Node should only contain:
     *
     * A-Z
     * a-z
     * 0-9
     * -
     * _
     */

    if (
      !/^[A-Za-z0-9_-]+$/.test(
        challenge,
      )
    ) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: generated challenge contains invalid characters.",
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to generate a valid recovery challenge.",
        },
        { status: 500 },
      );
    }

    /* =====================================================
       10. HASH CHALLENGE FOR STORAGE
    ===================================================== */

    /*
     * IMPORTANT:
     *
     * We never store the plaintext challenge in MongoDB.
     *
     * The Android device receives the plaintext challenge.
     * MongoDB receives only its SHA-256 hash.
     */

    const challengeHash =
      createHash("sha256")
        .update(challenge, "utf8")
        .digest("hex");

    /* =====================================================
       11. EXPIRATION
    ===================================================== */

    const now = new Date();

    const expiresAt =
      new Date(
        now.getTime() +
          DEVICE_RECOVERY_CHALLENGE_TTL_MS,
      );

    /* =====================================================
       12. CREATE CHALLENGE DOCUMENT
    ===================================================== */

    const challengeDocument: AndroidRecoveryChallenge =
      {
        email,
        challengeHash,
        createdAt: now,
        expiresAt,
        usedAt: null,
        verifiedAt: null,
        attempts: 0,
      };

    /*
     * Bind the challenge to the authenticated account whenever
     * the session provides a user ID.
     */

    if (userId) {
      challengeDocument.userId = userId;
    }

    /* =====================================================
       13. STORE CHALLENGE
    ===================================================== */

    const result =
      await challenges.insertOne(
        challengeDocument,
      );

    if (!result.insertedId) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: MongoDB did not return an inserted ID.",
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to create Android recovery challenge.",
        },
        { status: 500 },
      );
    }

    /* =====================================================
       14. CHALLENGE ID
    ===================================================== */

    const challengeId =
      result.insertedId.toString();

    if (!challengeId) {
      console.error(
        "ANDROID RECOVERY CHALLENGE: invalid challenge ID generated.",
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to create Android recovery challenge.",
        },
        { status: 500 },
      );
    }

    /* =====================================================
       15. RESPONSE
    ===================================================== */

    /*
     * IMPORTANT:
     *
     * Keep `challenge` and `challengeId` at the TOP LEVEL.
     *
     * The Android recovery frontend expects:
     *
     * response.challenge
     * response.challengeId
     *
     * This prevents the frontend from accidentally passing
     * undefined into the native signing plugin.
     */

    return NextResponse.json({
      success: true,

      challenge,

      challengeId,

      expiresAt:
        expiresAt.toISOString(),

      expiresInSeconds:
        Math.floor(
          DEVICE_RECOVERY_CHALLENGE_TTL_MS /
            1000,
        ),

      algorithm:
        "ECDSA-SHA256",

      platform:
        "android",
    });
  } catch (error) {
    /* =====================================================
       ERROR HANDLING
    ===================================================== */

    console.error(
      "ANDROID DEVICE RECOVERY CHALLENGE ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "ANDROID DEVICE RECOVERY CHALLENGE ERROR MESSAGE:",
      message,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to create Android recovery challenge.",
      },
      { status: 500 },
    );
  }
}