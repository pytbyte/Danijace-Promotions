import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  getMemberById,
} from "@/lib/members/service";

import {
  getSavingsAccount,
  getSavingsAccountById,
  getOrCreateSavingsAccount,
} from "@/lib/savings/service";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse<T>(
  data: T,
  status = 200
) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    {
      status,
    }
  );
}

function errorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
    }
  );
}

/* =========================================================
   VALIDATION HELPERS
========================================================= */

function getString(
  value: unknown
): string | undefined {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return undefined;
  }

  return value.trim();
}

/* =========================================================
   GET
   GET /api/savings/accounts
========================================================= */

/**
 * Retrieve a member's fixed savings account.
 *
 * Supported query parameters:
 *
 * ?memberId=...
 * ?accountId=...
 *
 * Examples:
 *
 * /api/savings/accounts?memberId=...
 *
 * /api/savings/accounts?accountId=...
 *
 * IMPORTANT
 * ---------
 *
 * Savings accounts are now member-owned.
 *
 * There is NO SACCO lookup here.
 *
 * The relationship is:
 *
 * Member
 *   ↓
 * Fixed Savings Account
 *
 * The server remains authoritative.
 */
export async function GET(
  request: Request
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /* -------------------------------------------------------
       QUERY PARAMETERS
    ------------------------------------------------------- */

    const { searchParams } =
      new URL(request.url);

    const memberId =
      getString(
        searchParams.get(
          "memberId"
        )
      );

    const accountId =
      getString(
        searchParams.get(
          "accountId"
        )
      );

    /* -------------------------------------------------------
       VALIDATE QUERY
    ------------------------------------------------------- */

    if (
      !memberId &&
      !accountId
    ) {
      return errorResponse(
        "Provide either memberId or accountId.",
        400
      );
    }

    /*
     * Do not silently choose one when both
     * identifiers are supplied.
     */
    if (
      memberId &&
      accountId
    ) {
      return errorResponse(
        "Provide either memberId or accountId, not both.",
        400
      );
    }

    /* -------------------------------------------------------
       ACCOUNT BY ID
    ------------------------------------------------------- */

    if (accountId) {
      const account =
        await getSavingsAccountById(
          accountId
        );

      if (!account) {
        return errorResponse(
          "Savings account not found.",
          404
        );
      }

      return successResponse(
        account
      );
    }

    /* -------------------------------------------------------
       ACCOUNT BY MEMBER
    ------------------------------------------------------- */

    /*
     * Verify that the member exists before looking
     * for their savings account.
     *
     * This prevents arbitrary member IDs from being
     * treated as valid owners.
     */
    const member =
      await getMemberById(
        memberId!
      );

    if (!member) {
      return errorResponse(
        "Member not found.",
        404
      );
    }

    /*
     * There is exactly one fixed savings account
     * for a member.
     *
     * IMPORTANT:
     *
     * getSavingsAccount now receives ONLY memberId.
     */
    const account =
      await getSavingsAccount(
        memberId!
      );

    /*
     * A member can exist before an account is created.
     *
     * This is a normal state and therefore returns:
     *
     * {
     *   success: true,
     *   data: null
     * }
     */
    if (!account) {
      return successResponse(
        null
      );
    }

    return successResponse(
      account
    );
  } catch (error) {
    console.error(
      "GET /api/savings/accounts error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve savings account.",
      500
    );
  }
}

/* =========================================================
   POST
   POST /api/savings/accounts
========================================================= */

/**
 * Create or retrieve a member's fixed savings account.
 *
 * POST /api/savings/accounts
 *
 * Body:
 *
 * {
 *   "memberId": "..."
 * }
 *
 * The server obtains the member's authoritative
 * information from the members collection.
 *
 * The client cannot supply:
 *
 * - memberName
 * - accountNumber
 * - balance
 * - status
 * - createdAt
 * - updatedAt
 *
 * The operation is idempotent.
 *
 * If the member already has a fixed savings account,
 * the existing account is returned.
 */
export async function POST(
  request: Request
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /* -------------------------------------------------------
       PARSE BODY
    ------------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Request body must be a JSON object.",
        400
      );
    }

    const payload =
      body as Record<
        string,
        unknown
      >;

    /* -------------------------------------------------------
       MEMBER ID
    ------------------------------------------------------- */

    const memberId =
      getString(
        payload.memberId
      );

    if (!memberId) {
      return errorResponse(
        "Member ID is required.",
        400
      );
    }

    /* -------------------------------------------------------
       AUTHORITATIVE MEMBER LOOKUP
    ------------------------------------------------------- */

    const member =
      await getMemberById(
        memberId
      );

    if (!member) {
      return errorResponse(
        "Member not found.",
        404
      );
    }

    /*
     * The member collection is authoritative.
     *
     * Do not trust memberName supplied by the client.
     */
    const memberName =
      [
        member.firstName,
        member.middleName,
        member.lastName,
      ]
        .filter(
          (
            value
          ): value is string =>
            typeof value === "string" &&
            value.trim().length > 0
        )
        .map(
          (value) =>
            value.trim()
        )
        .join(" ")
        .trim();

    if (!memberName) {
      return errorResponse(
        "Member has no valid name.",
        400
      );
    }

    /* -------------------------------------------------------
       CREATE / GET ACCOUNT
    ------------------------------------------------------- */

    /*
     * SACCO HAS BEEN REMOVED.
     *
     * The savings service receives only the information
     * required to establish ownership.
     */
    const account =
      await getOrCreateSavingsAccount(
        {
          memberId,
          memberName,
        }
      );

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return successResponse(
      account,
      200
    );
  } catch (error) {
    console.error(
      "POST /api/savings/accounts error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create savings account.";

    /*
     * Known domain/input errors are returned as
     * client errors.
     */
    const knownError =
      message.includes("required") ||
      message.includes("not found") ||
      message.includes("inactive") ||
      message.includes("Invalid") ||
      message.includes("already exists") ||
      message.includes("does not belong");

    return errorResponse(
      message,
      knownError ? 400 : 500
    );
  }
}