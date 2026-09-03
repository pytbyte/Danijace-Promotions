import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";
import { auth } from "@/auth";

import {
  getSecurityCollection,
  isLocked,
  getRemainingLockSeconds,
  normalizeSecurityEmail,
} from "@/lib/security/pin";

import {
  hasSecuritySession,
} from "@/lib/security/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        {
          authenticated: false,
          configured: false,
          verified: false,
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

    if (!record) {
      return NextResponse.json({
        authenticated: true,
        configured: false,
        verified: false,
      });
    }

    const verified =
      await hasSecuritySession(
        db,
        {
          userId,
          email,
        },
      );

    const locked =
      isLocked(record);

    return NextResponse.json({
      authenticated: true,
      configured: true,
      verified,
      locked,
      retryAfterSeconds: locked
        ? getRemainingLockSeconds(record)
        : 0,
    });
  } catch (error) {
    console.error(
      "SECURITY STATUS ERROR:",
      error,
    );

    return NextResponse.json(
      {
        authenticated: false,
        configured: false,
        verified: false,
        error:
          "Unable to read security status.",
      },
      { status: 500 },
    );
  }
}