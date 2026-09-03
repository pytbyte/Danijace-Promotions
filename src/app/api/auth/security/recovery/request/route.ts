import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  getSecurityCollection,
  normalizeSecurityEmail,
} from "@/lib/security/pin";

import {
  generateRecoveryCode,
  getRecoveryCollection,
  PIN_RECOVERY_MAX_REQUESTS,
  PIN_RECOVERY_REQUEST_WINDOW_SECONDS,
  PIN_RECOVERY_RESEND_SECONDS,
  hashRecoveryCode,
  isRequestWindowExpired,
} from "@/lib/security/recovery";

import { sendPinRecoveryEmail } from "@/lib/security/email/sendPinRecoveryEmail";

export const runtime = "nodejs";

export async function POST() {
  try {
    /* =====================================================
       GOOGLE / NEXTAUTH AUTHENTICATION
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
       DATABASE
    ===================================================== */

    const client = await clientPromise;

    const db = client.db();

    const security =
      await getSecurityCollection(db);

    const recovery =
      await getRecoveryCollection(db);

    /* =====================================================
       REQUIRE EXISTING PIN
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
          code: "PIN_NOT_CONFIGURED",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       FIND ACTIVE RECOVERY
    ===================================================== */

    const existing =
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

    /* =====================================================
       RATE LIMIT
    ===================================================== */

    if (existing) {
      if (
        !isRequestWindowExpired(
          existing,
        ) &&
        existing.requestCount >=
          PIN_RECOVERY_MAX_REQUESTS
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Too many recovery requests. Please try again later.",
          },
          { status: 429 },
        );
      }

      if (
        Date.now() -
          existing.lastSentAt.getTime() <
        PIN_RECOVERY_RESEND_SECONDS * 1000
      ) {
        const retryAfter = Math.ceil(
          (
            PIN_RECOVERY_RESEND_SECONDS *
              1000 -
            (Date.now() -
              existing.lastSentAt.getTime())
          ) / 1000,
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Please wait before requesting another recovery code.",
            retryAfterSeconds:
              retryAfter,
          },
          { status: 429 },
        );
      }
    }

    /* =====================================================
       GENERATE CODE
    ===================================================== */

    const code =
      generateRecoveryCode();

    const codeHash =
      hashRecoveryCode(code);

    const now = new Date();

    const expiresAt =
      new Date(
        now.getTime() +
          10 * 60 * 1000,
      );

    /* =====================================================
       REQUEST COUNTER
    ===================================================== */

    let requestCount = 1;
    let firstRequestAt = now;

    if (
      existing &&
      !isRequestWindowExpired(
        existing,
      )
    ) {
      requestCount =
        existing.requestCount + 1;

      firstRequestAt =
        existing.firstRequestAt;
    }

    /* =====================================================
       REPLACE ACTIVE CHALLENGE
    ===================================================== */

    if (existing) {
      await recovery.deleteOne({
        _id: existing._id,
      });
    }

    await recovery.insertOne({
      ...(userId ? { userId } : {}),
      email,
      codeHash,
      attempts: 0,
      requestCount,
      firstRequestAt,
      lastSentAt: now,
      createdAt: now,
      expiresAt,
      verifiedAt: null,
      usedAt: null,
    });

    /* =====================================================
       SEND EMAIL
    ===================================================== */

    try {
      await sendPinRecoveryEmail({
        email,
        code,
      });
    } catch (error) {
      console.error(
        "PIN RECOVERY EMAIL SEND ERROR:",
        error,
      );

      await recovery.deleteOne({
        email,
        codeHash,
      });

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to send the recovery code. Please try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "A recovery code has been sent to your Google account email.",
      expiresInSeconds:
        10 * 60,
    });
  } catch (error) {
    console.error(
      "PIN RECOVERY REQUEST ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to start PIN recovery.",
      },
      { status: 500 },
    );
  }
}