import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createLoan,
  getLoans,
} from "@/lib/loans/service";

import type {
  CreateLoanInput,
  LoanStatus,
  LoanType,
} from "@/lib/loans/types";

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

/**
 * We deliberately define only the session fields required
 * by the loan domain.
 *
 * This avoids depending on the overloaded TypeScript type
 * exposed by the auth() export.
 */
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
 * Convert the authenticated NextAuth user into the
 * LoanActor expected by the loan service.
 *
 * The browser must never be allowed to choose who
 * created or authorized a financial record.
 */
function getSessionActor(
  session: AuthenticatedSession,
) {
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
   STRING HELPERS
========================================================= */

function getOptionalString(
  value: string | null,
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
   GET /api/loans
========================================================= */

/**
 * List loans.
 *
 * Supported query parameters:
 *
 * page
 * limit
 * search
 * status
 * type
 * memberId
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
       QUERY PARAMETERS
    ------------------------------------------------------- */

    const searchParams =
      request.nextUrl.searchParams;

    const pageParam =
      searchParams.get("page");

    const limitParam =
      searchParams.get("limit");

    const page =
      pageParam === null ||
      pageParam.trim() === ""
        ? 1
        : Number(pageParam);

    const limit =
      limitParam === null ||
      limitParam.trim() === ""
        ? 25
        : Number(limitParam);

    if (
      !Number.isInteger(page) ||
      page < 1
    ) {
      return errorResponse(
        "Page must be a positive integer.",
        400,
      );
    }

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return errorResponse(
        "Limit must be an integer between 1 and 100.",
        400,
      );
    }

    /* -------------------------------------------------------
       OPTIONAL FILTERS
    ------------------------------------------------------- */

    const search =
      getOptionalString(
        searchParams.get("search"),
      );

    const memberId =
      getOptionalString(
        searchParams.get("memberId"),
      );

    const statusParam =
      getOptionalString(
        searchParams.get("status"),
      );

    const typeParam =
      getOptionalString(
        searchParams.get("type"),
      );

    /* -------------------------------------------------------
       STATUS VALIDATION
    ------------------------------------------------------- */

    let status:
      | LoanStatus
      | undefined;

    if (statusParam) {
      const validStatuses:
        LoanStatus[] = [
        "pending",
        "active",
        "completed",
        "cancelled",
      ];

      if (
        !validStatuses.includes(
          statusParam as LoanStatus,
        )
      ) {
        return errorResponse(
          "Invalid loan status.",
          400,
        );
      }

      status =
        statusParam as LoanStatus;
    }

    /* -------------------------------------------------------
       TYPE VALIDATION
    ------------------------------------------------------- */

    let type:
      | LoanType
      | undefined;

    if (typeParam) {
      const validTypes:
        LoanType[] = [
        "emergency",
        "regular",
      ];

      if (
        !validTypes.includes(
          typeParam as LoanType,
        )
      ) {
        return errorResponse(
          "Invalid loan type.",
          400,
        );
      }

      type =
        typeParam as LoanType;
    }

    /* -------------------------------------------------------
       GET LOANS
    ------------------------------------------------------- */

    const result =
      await getLoans({
        page,
        limit,
        ...(search
          ? {
              search,
            }
          : {}),
        ...(memberId
          ? {
              memberId,
            }
          : {}),
        ...(status
          ? {
              status,
            }
          : {}),
        ...(type
          ? {
              type,
            }
          : {}),
      });

    return NextResponse.json(
      {
        success: true,
        data: result.loans,
        count: result.loans.length,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages:
          result.totalPages,
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
      "GET /api/loans error:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve loans.",
      500,
    );
  }
}

/* =========================================================
   POST /api/loans
========================================================= */

/**
 * Create a loan.
 *
 * The authenticated user becomes the financial actor.
 *
 * The client supplies only the actual loan request:
 *
 * - memberId
 * - type
 * - principal
 * - guarantor
 * - optional dailyFine
 * - optional disbursementDate
 *
 * The loan service calculates:
 *
 * - loan number
 * - member information
 * - savings eligibility
 * - interest
 * - total due
 * - first due date
 * - initial outstanding balance
 * - authorization information
 */
export async function POST(
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
     * Never allow the client to inject financial,
     * identity, or authorization state.
     *
     * These values are calculated/controlled by the
     * loan service.
     */
    delete payload.id;
    delete payload.loanNumber;
    delete payload.memberNumber;
    delete payload.memberName;

    delete payload.interestRate;
    delete payload.interestAmount;

    delete payload.totalDue;
    delete payload.amountPaid;
    delete payload.totalFines;
    delete payload.outstandingBalance;

    delete payload.fineSource;
    delete payload.fineStatus;

    delete payload.status;

    delete payload.createdBy;
    delete payload.authorizedBy;
    delete payload.authorizedAt;

    delete payload.createdAt;
    delete payload.updatedAt;

    /* -------------------------------------------------------
       BUILD CREATE INPUT
    ------------------------------------------------------- */

    const input =
      payload as unknown as CreateLoanInput;

    /* -------------------------------------------------------
       CREATE LOAN
    ------------------------------------------------------- */

    const loan =
      await createLoan(
        input,
        actor,
        actor,
      );

    return successResponse(
      loan,
      201,
    );
  } catch (error) {
    console.error(
      "POST /api/loans error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create loan.";

    /* -------------------------------------------------------
       KNOWN DOMAIN / VALIDATION ERRORS
    ------------------------------------------------------- */

    const knownError =
      message.includes(
        "required",
      ) ||
      message.includes(
        "Invalid",
      ) ||
      message.includes(
        "not found",
      ) ||
      message.includes(
        "disabled",
      ) ||
      message.includes(
        "Only active members",
      ) ||
      message.includes(
        "already has",
      ) ||
      message.includes(
        "outstanding balance",
      ) ||
      message.includes(
        "minimum savings",
      ) ||
      message.includes(
        "cannot exceed",
      ) ||
      message.includes(
        "does not have an active",
      ) ||
      message.includes(
        "invalid balance",
      ) ||
      message.includes(
        "valid actor",
      );

    return errorResponse(
      message,
      knownError
        ? 400
        : 500,
    );
  }
}