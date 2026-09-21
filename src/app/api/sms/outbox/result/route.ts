import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  reportSmsResult,
} from "@/lib/sms/outbox/service";

/* =========================================================
   POST /api/sms/outbox/result

   Android reports whether a claimed SMS was successfully
   sent or failed.
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* -----------------------------------------------------
       AUTHENTICATION
    ----------------------------------------------------- */

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

    const smsId =
      typeof data.smsId ===
      "string"
        ? data.smsId.trim()
        : "";

    const status =
      data.status === "sent" ||
      data.status === "failed"
        ? data.status
        : null;

    const providerMessageId =
      typeof data.providerMessageId ===
      "string"
        ? data.providerMessageId.trim()
        : undefined;

    const error =
      typeof data.error ===
      "string"
        ? data.error.trim()
        : undefined;

    /* -----------------------------------------------------
       VALIDATION
    ----------------------------------------------------- */

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

    if (!smsId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "smsId is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!status) {
      return NextResponse.json(
        {
          success: false,
          error:
            'status must be either "sent" or "failed".',
        },
        {
          status: 400,
        },
      );
    }

    if (
      status === "failed" &&
      !error
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "error is required when status is failed.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       REPORT
    ----------------------------------------------------- */

    await reportSmsResult({
      deviceId,
      smsId,
      status,
      providerMessageId,
      error,
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "SMS OUTBOX RESULT ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update SMS result.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}