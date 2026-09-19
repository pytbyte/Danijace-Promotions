import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { claimSms } from "@/lib/sms/outbox";

/* =========================================================
   POST /api/sms/outbox/claim

   Android asks for SMS messages that are ready to send.

   Only authenticated GEO-SHUA sessions may claim messages.
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* -----------------------------------------------------
       AUTHENTICATION
    ----------------------------------------------------- */

    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized.",
        },
        {
          status: 401,
        },
      );
    }

    /* -----------------------------------------------------
       BODY
    ----------------------------------------------------- */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request body.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !body ||
      typeof body !== "object"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    const data =
      body as Record<string, unknown>;

    const deviceId =
      typeof data.deviceId === "string"
        ? data.deviceId.trim()
        : "";

    if (!deviceId) {
      return NextResponse.json(
        {
          success: false,
          error: "deviceId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const limit =
      typeof data.limit === "number"
        ? data.limit
        : 10;

    /* -----------------------------------------------------
       CLAIM
    ----------------------------------------------------- */

    const messages = await claimSms({
      deviceId,
      limit,
    });

    return NextResponse.json({
      success: true,
      messages,
      count: messages.length,
    });
  } catch (error) {
    console.error(
      "SMS OUTBOX CLAIM ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to claim SMS messages.",
      },
      {
        status: 500,
      },
    );
  }
}

