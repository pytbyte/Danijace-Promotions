/**
 * GEO-SHUA
 * Loan Settings API
 *
 * GET   /api/loans/settings
 * PATCH /api/loans/settings
 *
 * Financial configuration is controlled server-side.
 * The authenticated session is the only source of actor identity.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  getLoanSettings,
  updateLoanSettings,
} from "@/lib/loans/service";

import type {
  LoanActor,
  LoanSettings,
} from "@/lib/loans/types";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function jsonResponse<T>(
  body: T,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function successResponse<T>(
  data: T,
  status = 200,
): NextResponse {
  return jsonResponse(
    {
      success: true,
      data,
    },
    status,
  );
}

function errorResponse(
  error: string,
  status: number,
): NextResponse {
  return jsonResponse(
    {
      success: false,
      error,
    },
    status,
  );
}

/* =========================================================
   SESSION TYPES
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
   ALLOWED SETTINGS
========================================================= */

const ALLOWED_FIELDS = [
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
  (typeof ALLOWED_FIELDS)[number];

type LoanSettingsChanges =
  Partial<
    Pick<
      LoanSettings,
      AllowedField
    >
  >;

/* =========================================================
   REQUEST BODY
========================================================= */

function extractChanges(
  body: unknown,
): LoanSettingsChanges {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new Error(
      "Request body must be a JSON object.",
    );
  }

  const source =
    body as Record<
      string,
      unknown
    >;

  const changes: Record<
    string,
    unknown
  > = {};

  for (
    const field of ALLOWED_FIELDS
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        source,
        field,
      )
    ) {
      changes[field] =
        source[field];
    }
  }

  if (
    Object.keys(changes).length === 0
  ) {
    throw new Error(
      "No loan settings were provided for update.",
    );
  }

  return changes as LoanSettingsChanges;
}

/* =========================================================
   ERROR CLASSIFICATION
========================================================= */

function isClientError(
  message: string,
): boolean {
  const lower =
    message.toLowerCase();

  const knownTerms = [
    "required",
    "invalid",
    "must",
    "cannot",
    "greater",
    "negative",
    "between",
    "rate",
    "savings",
    "fine",
    "days",
    "actor",
    "whole number",
    "true or false",
    "zero or greater",
  ];

  return knownTerms.some(
    (term) =>
      lower.includes(term),
  );
}

/* =========================================================
   GET /api/loans/settings
========================================================= */

export async function GET(): Promise<NextResponse> {
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
       SETTINGS
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
      "Failed to retrieve loan settings.",
      500,
    );
  }
}

/* =========================================================
   PATCH /api/loans/settings
========================================================= */

export async function PATCH(
  request: NextRequest,
): Promise<NextResponse> {
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
       REQUEST BODY
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
       EXTRACT ONLY ALLOWED FIELDS
    ------------------------------------------------------- */

    let changes: LoanSettingsChanges;

    try {
      changes =
        extractChanges(body);
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Invalid loan settings.",
        400,
      );
    }

    /* -------------------------------------------------------
       UPDATE
    ------------------------------------------------------- */

    const updated =
      await updateLoanSettings(
        changes,
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

    return errorResponse(
      isClientError(message)
        ? message
        : "Failed to update loan settings.",
      isClientError(message)
        ? 400
        : 500,
    );
  }
}