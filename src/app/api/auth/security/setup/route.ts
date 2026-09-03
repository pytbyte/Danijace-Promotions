import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  getSecurityCollection,
  hashPin,
  normalizeSecurityEmail,
  validatePin,
} from "@/lib/security/pin";

export const runtime = "nodejs";

type SetupRequest = {
  pin?: unknown;
  confirmPin?: unknown;
};

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATED GOOGLE SESSION
    ===================================================== */

    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    const email =
      normalizeSecurityEmail(
        session.user.email,
      );

    /*
     * NextAuth's default User type may not expose id
     * depending on the current adapter/session setup.
     *
     * We therefore safely read it when available.
     */
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

    let body: SetupRequest;

    try {
      body =
        (await request.json()) as SetupRequest;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const pin =
      typeof body.pin === "string"
        ? body.pin.trim()
        : "";

    const confirmPin =
      typeof body.confirmPin === "string"
        ? body.confirmPin.trim()
        : "";

    /* =====================================================
       VALIDATE PIN
    ===================================================== */

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
          error: "PINs do not match.",
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

    /* =====================================================
       PREVENT UNAUTHORIZED REPLACEMENT
    ===================================================== */

    const existing =
      await security.findOne({
        email,
      });

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A security PIN is already configured. Use the PIN change process instead.",
        },
        { status: 409 },
      );
    }

    /* =====================================================
       HASH
    ===================================================== */

    const pinHash = await hashPin(pin);

    const now = new Date();

    /* =====================================================
       CREATE SECURITY RECORD
    ===================================================== */

    await security.insertOne({
      ...(userId ? { userId } : {}),
      email,
      pinHash,
      pinConfiguredAt: now,
      failedPinAttempts: 0,
      lockedUntil: null,
      lastPinVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json(
      {
        success: true,
        configured: true,
        message: "Security PIN configured successfully.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "PIN SETUP ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to configure security PIN.",
      },
      { status: 500 },
    );
  }
}