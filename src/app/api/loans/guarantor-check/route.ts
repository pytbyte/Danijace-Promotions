import {
  NextRequest,
  NextResponse,
} from "next/server";

import { auth } from "@/auth";

import {
  getExistingGuarantorCommitments,
} from "@/lib/loans/service";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function errorResponse(
  message: string,
  status: number,
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
    },
  );
}

/* =========================================================
   SESSION
========================================================= */

type AuthenticatedSession = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

/* =========================================================
   GET /api/loans/guarantor-check
========================================================= */

/**
 * Checks whether the selected member is currently recorded
 * as a guarantor on any pending or active loan.
 *
 * READ ONLY.
 *
 * This endpoint is intentionally separate from:
 *
 * GET /api/loans
 *
 * because the frontend only needs this information once
 * when selecting a member during loan creation.
 */
export async function GET(
  request: NextRequest,
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      (await auth()) as AuthenticatedSession | null;

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    /* -------------------------------------------------------
       MEMBER ID
    ------------------------------------------------------- */

    const memberId =
      request.nextUrl.searchParams
        .get("memberId")
        ?.trim() ?? "";

    if (!memberId) {
      return errorResponse(
        "Member ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       LOOKUP
    ------------------------------------------------------- */

    const guarantees =
      await getExistingGuarantorCommitments(
        memberId,
      );

    /* -------------------------------------------------------
       RESPONSE
       
       IMPORTANT:
       The frontend currently reads:
       
       data.guarantees
       
       so the response intentionally exposes
       `guarantees` at the top level.
    ------------------------------------------------------- */

    return NextResponse.json(
      {
        success: true,
        guarantees,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    console.error(
      "GET /api/loans/guarantor-check error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to check existing guarantor commitments.";

    if (
      message ===
      "Invalid member ID."
    ) {
      return errorResponse(
        message,
        400,
      );
    }

    if (
      message ===
      "Member not found."
    ) {
      return errorResponse(
        message,
        404,
      );
    }

    return errorResponse(
      "Unable to check existing guarantor commitments.",
      500,
    );
  }
}