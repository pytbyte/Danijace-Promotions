import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  comparePin,
  getSecurityCollection,
  getRemainingLockSeconds,
  isLocked,
  normalizeSecurityEmail,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  validatePin,
} from "@/lib/security/pin";

import {
  createSecuritySession,
} from "@/lib/security/session";

export const runtime = "nodejs";

type VerifyRequest = {
  method?: unknown;
  pin?: unknown;
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
          error: "Authentication required.",
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
      email?: string | null;
    };

    const userId =
      typeof sessionUser.id === "string" &&
      sessionUser.id.trim()
        ? sessionUser.id.trim()
        : undefined;

    /* =====================================================
       READ REQUEST
    ===================================================== */

    let body: VerifyRequest;

    try {
      body =
        (await request.json()) as VerifyRequest;
    } catch {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       METHOD
    ===================================================== */

    if (body.method !== "pin") {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "Unsupported security verification method.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       PIN VALIDATION
    ===================================================== */

    const pin =
      typeof body.pin === "string"
        ? body.pin.trim()
        : "";

    if (!validatePin(pin)) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "PIN must contain 4 to 6 digits.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       MONGODB
    ===================================================== */

    const client = await clientPromise;

    const db = client.db();

    const security =
      await getSecurityCollection(db);

    const record =
      await security.findOne({
        email,
      });

    /* =====================================================
       NO PIN CONFIGURED
    ===================================================== */

    if (!record) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error:
            "No security PIN has been configured for this account.",
          code: "PIN_NOT_CONFIGURED",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       LOCKOUT
    ===================================================== */

    if (isLocked(record)) {
      const remaining =
        getRemainingLockSeconds(record);

      return NextResponse.json(
        {
          success: false,
          verified: false,
          locked: true,
          retryAfterSeconds: remaining,
          error:
            "Too many unsuccessful attempts. Please try again later or use device security.",
        },
        { status: 429 },
      );
    }

    /*
     * If the lock expired, clear it before continuing.
     */
    if (
      record.lockedUntil &&
      record.lockedUntil.getTime() <= Date.now()
    ) {
      await security.updateOne(
        {
          _id: record._id,
          email,
        },
        {
          $set: {
            failedPinAttempts: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          },
        },
      );

      record.failedPinAttempts = 0;
      record.lockedUntil = null;
    }

    /* =====================================================
       VERIFY HASH
    ===================================================== */

    const valid =
      await comparePin(
        pin,
        record.pinHash,
      );

    /* =====================================================
       INVALID PIN
    ===================================================== */

    if (!valid) {
      const nextAttempts =
        record.failedPinAttempts + 1;

      /*
       * Last allowed attempt:
       * immediately create a temporary lock.
       */
      if (
        nextAttempts >= PIN_MAX_ATTEMPTS
      ) {
        const lockedUntil =
          new Date(
            Date.now() +
              PIN_LOCK_MINUTES *
                60 *
                1000,
          );

        await security.updateOne(
          {
            _id: record._id,
            email,
          },
          {
            $set: {
              failedPinAttempts:
                nextAttempts,
              lockedUntil,
              updatedAt: new Date(),
            },
          },
        );

        return NextResponse.json(
          {
            success: false,
            verified: false,
            locked: true,
            attemptsRemaining: 0,
            retryAfterSeconds:
              PIN_LOCK_MINUTES * 60,
            error:
              "Too many unsuccessful attempts. Please try again later or use device security.",
          },
          { status: 429 },
        );
      }

      await security.updateOne(
        {
          _id: record._id,
          email,
        },
        {
          $set: {
            failedPinAttempts:
              nextAttempts,
            updatedAt: new Date(),
          },
        },
      );

      return NextResponse.json(
        {
          success: false,
          verified: false,
          attemptsRemaining:
            PIN_MAX_ATTEMPTS -
            nextAttempts,
          error: "Incorrect PIN.",
        },
        { status: 401 },
      );
    }

    /* =====================================================
       SUCCESS
    ===================================================== */

    const now = new Date();

    await security.updateOne(
      {
        _id: record._id,
        email,
      },
      {
        $set: {
          failedPinAttempts: 0,
          lockedUntil: null,
          lastPinVerifiedAt: now,
          updatedAt: now,
        },
      },
    );

    /* =====================================================
       CREATE SECOND-LAYER SECURITY SESSION
    ===================================================== */

    await createSecuritySession(
      db,
      {
        userId,
        email,
      },
      "pin",
    );

    /* =====================================================
       SUCCESS
    ===================================================== */

    return NextResponse.json({
      success: true,
      verified: true,
      method: "pin",
      message:
        "Identity verification successful.",
    });
  } catch (error) {
    console.error(
      "PIN VERIFICATION ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        verified: false,
        error:
          "Unable to verify security PIN.",
      },
      { status: 500 },
    );
  }
}