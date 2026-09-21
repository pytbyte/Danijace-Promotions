import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  claimSmsBatch,
} from "@/lib/sms/outbox/service";

import {
  isSmsWorkerRequest,
} from "@/lib/sms/outbox/workerAuth";

/* =========================================================
   POST /api/sms/outbox/claim

   Android asks for SMS messages that are ready to send.

   Authentication:
   - Normal authenticated GEO-SHUA session
   - OR trusted Android SMS worker token
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* -----------------------------------------------------
       AUTHENTICATION

       Android background workers do not have a
       NextAuth session, so allow the configured
       SMS worker authentication mechanism.
    ----------------------------------------------------- */

    const workerRequest =
      isSmsWorkerRequest(request);

    if (!workerRequest) {
      const session =
        await auth();

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
    }

    /* -----------------------------------------------------
       BODY
    ----------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid JSON request body.",
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
          error:
            "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    const data =
      body as Record<
        string,
        unknown
      >;

    const deviceId =
      typeof data.deviceId ===
      "string"
        ? data.deviceId.trim()
        : "";

    if (!deviceId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "deviceId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const limit =
      typeof data.limit ===
      "number"
        ? data.limit
        : 10;

    /* -----------------------------------------------------
       CLAIM
    ----------------------------------------------------- */

    const messages =
      await claimSmsBatch({
        deviceId,
        limit,
      });

    /* -----------------------------------------------------
       RESPONSE
    ----------------------------------------------------- */

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
        error:
          "Failed to claim SMS messages.",
      },
      {
        status: 500,
      },
    );
  }
}