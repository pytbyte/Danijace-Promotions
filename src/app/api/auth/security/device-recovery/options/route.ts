import { NextResponse } from "next/server";
import { auth } from "@/auth";

import {
  getDeviceRecoveryCollection,
  normalizeRecoveryEmail,
  isValidRecoveryPublicKey,
} from "@/lib/security/deviceRecovery";

import clientPromise from "@/lib/mongodb";

export const runtime = "nodejs";

type SessionUser = {
  id?: string | null;
  email?: string | null;
};

type AuthenticatedSession = {
  user?: SessionUser | null;
};

export async function POST(request: Request) {
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
       REQUEST BODY
    ===================================================== */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        { status: 400 },
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("publicKey" in body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Android recovery public key is required.",
        },
        { status: 400 },
      );
    }

    const publicKey =
      typeof body.publicKey === "string"
        ? body.publicKey.trim()
        : "";

    /* =====================================================
       PUBLIC KEY VALIDATION
    ===================================================== */

    if (!isValidRecoveryPublicKey(publicKey)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid Android recovery public key.",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       DATABASE
    ===================================================== */

    const client = await clientPromise;
    const db = client.db();

    const collection =
      await getDeviceRecoveryCollection(db);

    const now = new Date();

    /* =====================================================
       USER ID
    ===================================================== */

    const userId =
      typeof session?.user?.id === "string" &&
      session.user.id.trim()
        ? session.user.id.trim()
        : undefined;

    /* =====================================================
       RECOVERY KEY UPDATE
    ===================================================== */

    const update: Record<string, unknown> = {
      email,
      publicKey,
      algorithm: "ECDSA-SHA256",
      platform: "android",
      keyType: "recovery",
      updatedAt: now,
      enabled: true,
    };

    /*
     * Only store userId when one actually exists.
     *
     * This is important because the MongoDB collection
     * uses a sparse unique index on userId.
     */
    if (userId) {
      update.userId = userId;
    }

    /* =====================================================
       REGISTER / ROTATE DEVICE KEY
    ===================================================== */

    await collection.updateOne(
      { email },
      {
        $set: update,

        $setOnInsert: {
          createdAt: now,
          lastUsedAt: null,
        },
      },
      {
        upsert: true,
      },
    );

    /* =====================================================
       SUCCESS
    ===================================================== */

    return NextResponse.json({
      success: true,
      registered: true,
      platform: "android",
      algorithm: "ECDSA-SHA256",
    });
  } catch (error) {
    console.error(
      "ANDROID DEVICE RECOVERY KEY REGISTRATION ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to register Android device recovery.",
      },
      { status: 500 },
    );
  }
}