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

type SessionUser = {
  id?: string | null;
  email?: string | null;
};

type AuthenticatedSession = {
  user?: SessionUser | null;
};

export async function POST() {
  try {
    /* =====================================================
       GOOGLE AUTHENTICATION
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
       USER ID
    ===================================================== */

    const userId =
      typeof session?.user?.id === "string" &&
      session.user.id.trim()
        ? session.user.id.trim()
        : undefined;

    /* =====================================================
       DATABASE
    ===================================================== */

    const client = await clientPromise;
    const db = client.db();

    const recoveryKeys =
      await getDeviceRecoveryCollection(db);

    const challenges =
      await getDeviceRecoveryChallengeCollection(db);

    /* =====================================================
       VERIFY REGISTERED AND ENABLED ANDROID KEY
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

    /*
     * If both records have a userId, make sure the recovery
     * key belongs to the currently authenticated account.
     */
    if (
      recoveryKey.userId &&
      userId &&
      recoveryKey.userId !== userId
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Android recovery device does not belong to this account.",
        },
        { status: 403 },
      );
    }

    /* =====================================================
       INVALIDATE PREVIOUS UNUSED CHALLENGES
    ===================================================== */

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
       GENERATE CRYPTOGRAPHICALLY RANDOM CHALLENGE
    ===================================================== */

    const challengeBytes =
      randomBytes(32);

    /*
     * Base64url gives us a transport-safe challenge
     * without exposing raw binary data.
     */
    const challenge =
      challengeBytes.toString("base64url");

    /*
     * Store only the SHA-256 hash.
     *
     * Even if the challenge collection is exposed,
     * the stored value cannot simply be reused as the
     * original challenge.
     */
    const challengeHash =
      createHash("sha256")
        .update(challenge, "utf8")
        .digest("hex");

    const now = new Date();

    const expiresAt =
      new Date(
        now.getTime() +
          DEVICE_RECOVERY_CHALLENGE_TTL_MS,
      );

    /* =====================================================
       STORE CHALLENGE
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

    if (userId) {
      challengeDocument.userId = userId;
    }

    const result =
      await challenges.insertOne(
        challengeDocument,
      );

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      challenge,

      challengeId:
        result.insertedId.toString(),

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
    console.error(
      "ANDROID DEVICE RECOVERY CHALLENGE ERROR:",
      error,
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