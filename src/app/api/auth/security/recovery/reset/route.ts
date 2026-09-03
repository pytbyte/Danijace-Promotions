import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  getSecurityCollection,
  hashPin,
  normalizeSecurityEmail,
  validatePin,
} from "@/lib/security/pin";

import {
  getRecoveryCollection,
  hashResetToken,
} from "@/lib/security/recovery";

import {
  clearSecuritySessionsForUser,
} from "@/lib/security/session";

export const runtime = "nodejs";

type ResetRequest = {
  resetToken?: unknown;
  pin?: unknown;
  confirmPin?: unknown;
};

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Authentication required.",
        },
        { status: 401 },
      );
    }

    const email =
      normalizeSecurityEmail(
        session.user.email,
      );

    const sessionUser = session.user as {
      id?: string;
    };

    const userId =
      typeof sessionUser.id === "string" &&
      sessionUser.id.trim()
        ? sessionUser.id.trim()
        : undefined;

    /* =====================================================
       BODY
    ===================================================== */

    let body: ResetRequest;

    try {
      body =
        (await request.json()) as ResetRequest;
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

    const resetToken =
      typeof body.resetToken === "string"
        ? body.resetToken.trim()
        : "";

    const pin =
      typeof body.pin === "string"
        ? body.pin.trim()
        : "";

    const confirmPin =
      typeof body.confirmPin === "string"
        ? body.confirmPin.trim()
        : "";

    /* =====================================================
       VALIDATE
    ===================================================== */

    if (!resetToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid recovery session.",
        },
        { status: 400 },
      );
    }

    if (!validatePin(pin)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PIN must contain 4 to 6 digits.",
        },
        { status: 400 },
      );
    }

    if (pin !== confirmPin) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PINs do not match.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       DATABASE
    ===================================================== */

    const client = await clientPromise;

    const db = client.db();

    const security =
      await getSecurityCollection(db);

    const recovery =
      await getRecoveryCollection(db);

    const resetTokenHash =
      hashResetToken(
        resetToken,
      );

    /* =====================================================
       RECOVERY SESSION
    ===================================================== */

    const recoveryRecord =
      await recovery.findOne({
        email,
        resetTokenHash,
        usedAt: null,
      });

    if (!recoveryRecord) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery session is invalid or has already been used.",
        },
        { status: 400 },
      );
    }

    if (
      !recoveryRecord.verifiedAt
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery code must be verified first.",
        },
        { status: 403 },
      );
    }

    if (
      recoveryRecord.expiresAt.getTime() <=
      Date.now()
    ) {
      await recovery.deleteOne({
        _id: recoveryRecord._id,
      });

      return NextResponse.json(
        {
          success: false,
          error:
            "Recovery session has expired. Please start again.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       SECURITY RECORD
    ===================================================== */

    const securityRecord =
      await security.findOne({
        email,
      });

    if (!securityRecord) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Security PIN is not configured.",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       HASH NEW PIN
    ===================================================== */

    const pinHash =
      await hashPin(pin);

    const now = new Date();

    /* =====================================================
       UPDATE PIN
    ===================================================== */

    await security.updateOne(
      {
        _id: securityRecord._id,
        email,
      },
      {
        $set: {
          pinHash,
          pinConfiguredAt: now,

          /**
           * Recovery resets the PIN lock state.
           */
          failedPinAttempts: 0,
          lockedUntil: null,

          /**
           * Do not consider the recovered PIN
           * automatically verified.
           */
          lastPinVerifiedAt: null,

          updatedAt: now,
        },
      },
    );

    /* =====================================================
       INVALIDATE RECOVERY
    ===================================================== */

    await recovery.updateOne(
      {
        _id: recoveryRecord._id,
        email,
        resetTokenHash,
        usedAt: null,
      },
      {
        $set: {
          usedAt: now,
        },
        $unset: {
          resetTokenHash: "",
          codeHash: "",
        },
      },
    );

    /* =====================================================
       INVALIDATE SECOND-LAYER SESSIONS
    ===================================================== */

    await clearSecuritySessionsForUser(
      db,
      {
        userId,
        email,
      },
    );

    /* =====================================================
       SUCCESS
    ===================================================== */

    return NextResponse.json({
      success: true,
      reset: true,
      verified: false,
      message:
        "Your security PIN has been reset successfully. Please verify your new PIN.",
    });
  } catch (error) {
    console.error(
      "PIN RECOVERY RESET ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to reset security PIN.",
      },
      { status: 500 },
    );
  }
}