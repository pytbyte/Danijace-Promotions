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

   HOT PATH
   ---------------------------------------------------------
   Android asks for SMS messages that are ready to send.

   Goal:
   - minimum server-side work
   - minimum database round trips
   - immediately return claimed messages
   - Android can send them without waiting

   Authentication:
   - trusted Android SMS worker token
   - OR normal authenticated GEO-SHUA session
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION

       Worker authentication is deliberately checked first.

       Android workers normally do not have a NextAuth
       session. Avoid calling auth() for trusted workers.
    ===================================================== */

    if (
      !isSmsWorkerRequest(request)
    ) {
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
            headers: {
              "Cache-Control":
                "no-store",
            },
          },
        );
      }
    }


    /* =====================================================
       BODY
    ===================================================== */

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
          headers: {
            "Cache-Control":
              "no-store",
          },
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
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       REQUEST DATA
    ===================================================== */

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
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       LIMIT

       Keep the hot path predictable.

       Default:
         10

       Maximum:
         50

       We never allow a malformed or excessive value to
       create a huge MongoDB claim operation.
    ===================================================== */

    const requestedLimit =
      typeof data.limit ===
      "number" &&
      Number.isFinite(
        data.limit,
      )
        ? Math.floor(
            data.limit,
          )
        : 10;

    const limit =
      Math.min(
        50,
        Math.max(
          1,
          requestedLimit,
        ),
      );


    /* =====================================================
       CLAIM

       This MUST be the only database operation required
       by this endpoint.

       claimSmsBatch() should atomically claim messages and
       return them in the same operation where possible.
    ===================================================== */

    const messages =
      await claimSmsBatch({
        deviceId,
        limit,
      });


    /* =====================================================
       RESPONSE

       No additional database work.
       No logging on the successful hot path.
       No artificial delay.
    ===================================================== */

    return NextResponse.json(
      {
        success: true,

        messages,

        count:
          messages.length,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
          "Pragma":
            "no-cache",
          "Expires":
            "0",
        },
      },
    );

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
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}