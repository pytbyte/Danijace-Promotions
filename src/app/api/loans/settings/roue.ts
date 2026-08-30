import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  getLoanSettings,
  updateLoanSettings,
} from "@/lib/loans/service";

import type { LoanActor } from "@/lib/loans/types";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse<T>(
  data: T,
  status = 200,
) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    {
      status,
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}

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
   SESSION USER TYPE
========================================================= */

type AuthenticatedSession = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

/* =========================================================
   ACTOR
========================================================= */

/**
 * The authenticated session is the only source of
 * identity information for settings changes.
 *
 * The browser must never be allowed to specify
 * updatedBy.
 */
function getSessionActor(
  session: AuthenticatedSession,
): LoanActor {
  const name =
    typeof session?.user?.name === "string"
      ? session.user.name.trim()
      : "";

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.trim().toLowerCase()
      : "";

  if (!name || !email) {
    throw new Error(
      "Authenticated user does not have a valid name and email.",
    );
  }

  return {
    name,
    email,
  };
}

/* =========================================================
   GET /api/loans/settings
========================================================= */

/**
 * Get the current loan settings.
 *
 * The service creates the default settings document if
 * no settings currently exist.
 */
export async function GET() {
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
       GET SETTINGS
    ------------------------------------------------------- */

    const settings =
      await getLoanSettings();

    return successResponse(
      settings,
      200,
    );
  } catch (error) {
    console.error(
      "GET /api/loans/settings error:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve loan settings.",
      500,
    );
  }
}

/* =========================================================
   PATCH /api/loans/settings
========================================================= */

/**
 * Update loan settings.
 *
 * Only configurable fields are accepted.
 *
 * Server-controlled fields such as:
 *
 * - id
 * - createdAt
 * - updatedAt
 * - updatedBy
 *
 * are never accepted from the client.
 */
export async function PATCH(
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

    const actor =
      getSessionActor(session);

    /* -------------------------------------------------------
       READ BODY
    ------------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400,
      );
    }

    /* -------------------------------------------------------
       BODY VALIDATION
    ------------------------------------------------------- */

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    const payload =
      body as Record<
        string,
        unknown
      >;

    /* -------------------------------------------------------
       SERVER-CONTROLLED FIELDS
    ------------------------------------------------------- */

    /**
     * Never allow the client to modify these fields.
     */
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;
    delete payload.updatedBy;

    /* -------------------------------------------------------
       ALLOWED SETTINGS
    ------------------------------------------------------- */

    const allowedFields = [
      "regularInterestRate",
      "emergencyInterestRate",
      "regularMinimumSavings",
      "regularSavingsMultiplier",
      "repaymentGraceDays",
      "defaultDailyFine",
      "emergencyLoansEnabled",
      "regularLoansEnabled",
    ] as const;

    type AllowedField =
      (typeof allowedFields)[number];

    const changes: Partial<
      Record<
        AllowedField,
        unknown
      >
    > = {};

    for (
      const field of allowedFields
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          payload,
          field,
        )
      ) {
        changes[field] =
          payload[field];
      }
    }

    /* -------------------------------------------------------
       REQUIRE AT LEAST ONE CHANGE
    ------------------------------------------------------- */

    if (
      Object.keys(changes)
        .length === 0
    ) {
      return errorResponse(
        "No loan settings were provided for update.",
        400,
      );
    }

    /* -------------------------------------------------------
       TYPE-SAFE SETTINGS OBJECT
    ------------------------------------------------------- */

    /**
     * The validation layer will perform the actual
     * business validation.
     *
     * We intentionally do not trust arbitrary fields
     * from the request body.
     */
    const typedChanges =
      changes as Parameters<
        typeof updateLoanSettings
      >[0];

    /* -------------------------------------------------------
       UPDATE SETTINGS
    ------------------------------------------------------- */

    const updated =
      await updateLoanSettings(
        typedChanges,
        actor,
      );

    return successResponse(
      updated,
      200,
    );
  } catch (error) {
    console.error(
      "PATCH /api/loans/settings error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update loan settings.";

    /* -------------------------------------------------------
       KNOWN VALIDATION / DOMAIN ERRORS
    ------------------------------------------------------- */

    const knownError =
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("must") ||
      message.includes("cannot") ||
      message.includes("greater") ||
      message.includes("negative") ||
      message.includes("between") ||
      message.includes("rate") ||
      message.includes("savings") ||
      message.includes("fine") ||
      message.includes("days") ||
      message.includes("actor");

    return errorResponse(
      message,
      knownError
        ? 400
        : 500,
    );
  }
}