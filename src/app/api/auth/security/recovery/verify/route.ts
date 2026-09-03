import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  normalizeSecurityEmail,
} from "@/lib/security/pin";

import {
  getRecoveryCollection,
  hashRecoveryCode,
  generateResetToken,
  hashResetToken,
  PIN_RECOVERY_MAX_ATTEMPTS,
  validateRecoveryCode,
  isRecoveryExpired,
  isRecoveryExhausted,
} from "@/lib/security/recovery";

export const runtime = "nodejs";

type VerifyRecoveryRequest = {
  code?: unknown;
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
          verified: false,
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

    /* =====================================================
       BODY
    ===================================================== */

    let body: VerifyRecoveryRequest;

    try {
      body =
        (await request.json()) as VerifyRecoveryRequest;
    } catch {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const code =
      typeof body.code === "string"
        ? body.code.trim()
        : "";

    if (!validateRecoveryCode(code)) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Recovery code must contain 6 digits.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       DATABASE
    ===================================================== */

    const client = await clientPromise;

    const db = client.db();

    const recovery =
      await getRecoveryCollection(db);

    const record =
      await recovery.findOne(
        {
          email,
          usedAt: null,
        },
        {
          sort: {
            createdAt: -1,
          },
        },
      );

    if (!record) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Recovery code is invalid or has expired.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       EXPIRY
    ===================================================== */

    if (
      isRecoveryExpired(record)
    ) {
      await recovery.deleteOne({
        _id: record._id,
      });

      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Recovery code has expired. Please request a new code.",
          code: "RECOVERY_EXPIRED",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       ATTEMPT LIMIT
    ===================================================== */

    if (
      isRecoveryExhausted(record)
    ) {
      await recovery.deleteOne({
        _id: record._id,
      });

      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Too many incorrect recovery attempts. Please request a new code.",
          code: "RECOVERY_ATTEMPTS_EXCEEDED",
        },
        { status: 429 },
      );
    }

    /* =====================================================
       COMPARE HASH
    ===================================================== */

    const suppliedHash =
      hashRecoveryCode(code);

    if (
      suppliedHash !== record.codeHash
    ) {
      const nextAttempts =
        record.attempts + 1;

      if (
        nextAttempts >=
        PIN_RECOVERY_MAX_ATTEMPTS
      ) {
        await recovery.deleteOne({
          _id: record._id,
        });

        return NextResponse.json(
          {
            success: false,
            verified: false,
            attemptsRemaining: 0,
            error:
              "Too many incorrect recovery attempts. Please request a new code.",
            code: "RECOVERY_ATTEMPTS_EXCEEDED",
          },
          { status: 429 },
        );
      }

      await recovery.updateOne(
        {
          _id: record._id,
          usedAt: null,
        },
        {
          $set: {
            attempts: nextAttempts,
          },
        },
      );

      return NextResponse.json(
        {
          success: false,
          verified: false,
          attemptsRemaining:
            PIN_RECOVERY_MAX_ATTEMPTS -
            nextAttempts,
          error:
            "Incorrect recovery code.",
        },
        { status: 401 },
      );
    }

    /* =====================================================
       SUCCESS
    ===================================================== */

    const resetToken =
      generateResetToken();

    const resetTokenHash =
      hashResetToken(
        resetToken,
      );

    await recovery.updateOne(
      {
        _id: record._id,
        usedAt: null,
      },
      {
        $set: {
          resetTokenHash,
          verifiedAt: new Date(),
        },
      },
    );

    return NextResponse.json({
      success: true,
      verified: true,
      resetToken,
      message:
        "Recovery code verified. You can now create a new PIN.",
    });
  } catch (error) {
    console.error(
      "PIN RECOVERY VERIFY ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        verified: false,
        error:
          "Unable to verify recovery code.",
      },
      { status: 500 },
    );
  }
}