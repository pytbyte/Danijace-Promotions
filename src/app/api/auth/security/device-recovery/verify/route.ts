import { NextResponse } from "next/server";
import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "crypto";
import { ObjectId } from "mongodb";

import { auth } from "@/auth";
import clientPromise from "@/lib/mongodb";

import {
  getDeviceRecoveryCollection,
  getDeviceRecoveryChallengeCollection,
  getDeviceRecoveryAuthorizationCollection,
  normalizeRecoveryEmail,
  DEVICE_RECOVERY_AUTHORIZATION_TTL_MS,
} from "@/lib/security/deviceRecovery";

export const runtime = "nodejs";

/* =========================================================
   SECURITY SETTINGS
========================================================= */

const MAX_CHALLENGE_ATTEMPTS = 5;

/* =========================================================
   SESSION TYPES
========================================================= */

type SessionUser = {
  id?: string | null;
  email?: string | null;
};

type AuthenticatedSession = {
  user?: SessionUser | null;
};

/* =========================================================
   REQUEST TYPE
========================================================= */

type VerifyRequest = {
  challengeId?: unknown;
  challenge?: unknown;
  signature?: unknown;
};

/* =========================================================
   HASH CHALLENGE
========================================================= */

function hashChallenge(
  challenge: string,
): string {
  return createHash("sha256")
    .update(challenge, "utf8")
    .digest("hex");
}

/* =========================================================
   CONSTANT-TIME HASH COMPARISON
========================================================= */

function safeHashEquals(
  expected: string,
  supplied: string,
): boolean {
  const expectedBuffer =
    Buffer.from(expected, "utf8");

  const suppliedBuffer =
    Buffer.from(supplied, "utf8");

  if (
    expectedBuffer.length !==
    suppliedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    expectedBuffer,
    suppliedBuffer,
  );
}

/* =========================================================
   BASE64 VALIDATION
========================================================= */

function isValidBase64(
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.length > 16384
  ) {
    return false;
  }

  if (
    trimmed.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(
      trimmed,
    )
  ) {
    return false;
  }

  try {
    const decoded =
      Buffer.from(
        trimmed,
        "base64",
      );

    return decoded.length > 0;
  } catch {
    return false;
  }
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       1. REQUIRE GOOGLE AUTHENTICATION
    ===================================================== */

    const session =
      (await auth()) as
        | AuthenticatedSession
        | null;

    const email =
      normalizeRecoveryEmail(
        session?.user?.email,
      );

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Authentication required.",
        },
        { status: 401 },
      );
    }

    const userId =
      typeof session?.user?.id ===
        "string" &&
      session.user.id.trim()
        ? session.user.id.trim()
        : undefined;

    /* =====================================================
       2. PARSE REQUEST
    ===================================================== */

    let body: VerifyRequest;

    try {
      body =
        (await request.json()) as
          VerifyRequest;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const challengeId =
      typeof body.challengeId ===
      "string"
        ? body.challengeId.trim()
        : "";

    const challenge =
      typeof body.challenge ===
      "string"
        ? body.challenge.trim()
        : "";

    const signature =
      typeof body.signature ===
      "string"
        ? body.signature.trim()
        : "";

    if (
      !challengeId ||
      !challenge ||
      !signature
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Challenge ID, challenge, and signature are required.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       3. VALIDATE CHALLENGE ID
    ===================================================== */

    if (
      !ObjectId.isValid(
        challengeId,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid recovery challenge.",
        },
        { status: 400 },
      );
    }

    const challengeObjectId =
      new ObjectId(challengeId);

    /* =====================================================
       4. VALIDATE SIGNATURE
    ===================================================== */

    if (
      !isValidBase64(signature)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid recovery signature.",
        },
        { status: 400 },
      );
    }

    const signatureBuffer =
      Buffer.from(
        signature,
        "base64",
      );

    /*
     * ECDSA P-256 DER signatures are
     * normally small. Keep a generous
     * upper boundary.
     */

    if (
      signatureBuffer.length < 8 ||
      signatureBuffer.length > 512
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid recovery signature.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       5. DATABASE
    ===================================================== */

    const client =
      await clientPromise;

    const db = client.db();

    const recoveryKeys =
      await getDeviceRecoveryCollection(
        db,
      );

    const challenges =
      await getDeviceRecoveryChallengeCollection(
        db,
      );

    const authorizations =
      await getDeviceRecoveryAuthorizationCollection(
        db,
      );

    /* =====================================================
       6. LOAD CHALLENGE
    ===================================================== */

    const storedChallenge =
      await challenges.findOne({
        _id: challengeObjectId,
        email,
      });

    if (!storedChallenge) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery challenge not found.",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       7. ENFORCE USER BINDING
    ===================================================== */

    if (
      storedChallenge.userId &&
      userId &&
      storedChallenge.userId !==
        userId
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery challenge does not belong to this account.",
        },
        { status: 403 },
      );
    }

    /* =====================================================
       8. REJECT USED CHALLENGE
    ===================================================== */

    if (storedChallenge.usedAt) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This recovery challenge has already been used.",
        },
        { status: 409 },
      );
    }

    /* =====================================================
       9. CHECK EXPIRATION
    ===================================================== */

    const now =
      new Date();

    if (
      storedChallenge.expiresAt.getTime() <=
      now.getTime()
    ) {
      await challenges.updateOne(
        {
          _id:
            storedChallenge._id,
          usedAt: null,
        },
        {
          $set: {
            usedAt: now,
          },
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery challenge has expired.",
        },
        { status: 410 },
      );
    }

    /* =====================================================
       10. CHECK ATTEMPTS
    ===================================================== */

    if (
      storedChallenge.attempts >=
      MAX_CHALLENGE_ATTEMPTS
    ) {
      await challenges.updateOne(
        {
          _id:
            storedChallenge._id,
          usedAt: null,
        },
        {
          $set: {
            usedAt: now,
          },
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Too many recovery verification attempts.",
        },
        { status: 429 },
      );
    }

    /* =====================================================
       11. VERIFY CHALLENGE
    ===================================================== */

    const suppliedChallengeHash =
      hashChallenge(
        challenge,
      );

    if (
      !safeHashEquals(
        storedChallenge.challengeHash,
        suppliedChallengeHash,
      )
    ) {
      const updated =
        await challenges.findOneAndUpdate(
          {
            _id:
              storedChallenge._id,
            usedAt: null,
          },
          {
            $inc: {
              attempts: 1,
            },
          },
          {
            returnDocument:
              "after",
          },
        );

      const attempts =
        updated?.attempts ??
        storedChallenge.attempts +
          1;

      if (
        attempts >=
        MAX_CHALLENGE_ATTEMPTS
      ) {
        await challenges.updateOne(
          {
            _id:
              storedChallenge._id,
            usedAt: null,
          },
          {
            $set: {
              usedAt: now,
            },
          },
        );
      }

      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid recovery challenge.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       12. LOAD TRUSTED ANDROID KEY
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
       13. ENFORCE KEY ACCOUNT BINDING
    ===================================================== */

    if (
      recoveryKey.userId &&
      userId &&
      recoveryKey.userId !==
        userId
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
       14. LOAD PUBLIC KEY
    ===================================================== */

    let publicKey;

    try {
      publicKey =
        createPublicKey({
          key: Buffer.from(
            recoveryKey.publicKey,
            "base64",
          ),
          format: "der",
          type: "spki",
        });
    } catch (error) {
      console.error(
        "ANDROID RECOVERY PUBLIC KEY PARSE ERROR:",
        error,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Registered Android recovery key is invalid.",
        },
        { status: 500 },
      );
    }

    /* =====================================================
       15. VERIFY ECDSA SIGNATURE
    ===================================================== */

    let signatureValid =
      false;

    try {
      signatureValid =
        verifySignature(
          "sha256",
          Buffer.from(
            challenge,
            "utf8",
          ),
          publicKey,
          signatureBuffer,
        );
    } catch (error) {
      console.error(
        "ANDROID RECOVERY SIGNATURE VERIFICATION ERROR:",
        error,
      );

      signatureValid = false;
    }

    /* =====================================================
       16. INVALID SIGNATURE
    ===================================================== */

    if (!signatureValid) {
      const updated =
        await challenges.findOneAndUpdate(
          {
            _id:
              storedChallenge._id,
            usedAt: null,
          },
          {
            $inc: {
              attempts: 1,
            },
          },
          {
            returnDocument:
              "after",
          },
        );

      const attempts =
        updated?.attempts ??
        storedChallenge.attempts +
          1;

      if (
        attempts >=
        MAX_CHALLENGE_ATTEMPTS
      ) {
        await challenges.updateOne(
          {
            _id:
              storedChallenge._id,
            usedAt: null,
          },
          {
            $set: {
              usedAt: now,
            },
          },
        );
      }

      return NextResponse.json(
        {
          success: false,
          error:
            "Android device verification failed.",
        },
        { status: 401 },
      );
    }

    /* =====================================================
       17. ATOMICALLY CONSUME CHALLENGE
    ===================================================== */

    const consumed =
      await challenges.findOneAndUpdate(
        {
          _id:
            storedChallenge._id,
          email,
          usedAt: null,
          expiresAt: {
            $gt: now,
          },
        },
        {
          $set: {
            usedAt: now,
            verifiedAt: now,
          },
        },
        {
          returnDocument:
            "after",
        },
      );

    if (!consumed) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery challenge is no longer valid.",
        },
        { status: 409 },
      );
    }

    /* =====================================================
       18. UPDATE DEVICE LAST USED
    ===================================================== */

    await recoveryKeys.updateOne(
      {
        _id: recoveryKey._id,
        email,
        enabled: true,
      },
      {
        $set: {
          lastUsedAt: now,
          updatedAt: now,
        },
      },
    );

    /* =====================================================
       19. GENERATE RECOVERY AUTHORIZATION
    ===================================================== */

    const authorizationToken =
      randomBytes(
        32,
      ).toString(
        "base64url",
      );

    const authorizationHash =
      createHash("sha256")
        .update(
          authorizationToken,
          "utf8",
        )
        .digest("hex");

    const authorizationExpiresAt =
      new Date(
        now.getTime() +
          DEVICE_RECOVERY_AUTHORIZATION_TTL_MS,
      );

    /* =====================================================
       20. STORE HASHED AUTHORIZATION
    ===================================================== */

    await authorizations.insertOne(
      {
        email,

        ...(userId
          ? { userId }
          : {}),

        challengeId:
          storedChallenge._id,

        tokenHash:
          authorizationHash,

        createdAt: now,

        expiresAt:
          authorizationExpiresAt,

        usedAt: null,
      },
    );

    /* =====================================================
       21. SUCCESS
    ===================================================== */

    return NextResponse.json({
      success: true,

      verified: true,

      method:
        "android-device-cryptographic-proof",

      platform: "android",

      algorithm:
        "ECDSA-SHA256",

      authorizationToken,

      authorizationExpiresAt:
        authorizationExpiresAt.toISOString(),

      expiresInSeconds:
        Math.floor(
          DEVICE_RECOVERY_AUTHORIZATION_TTL_MS /
            1000,
        ),
    });
  } catch (error) {
    console.error(
      "ANDROID DEVICE RECOVERY VERIFICATION ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify Android device recovery.",
      },
      { status: 500 },
    );
  }
}