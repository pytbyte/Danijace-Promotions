import {
  after,
  NextRequest,
  NextResponse,
} from "next/server";

import { auth } from "@/auth";

import {
  accrueAllLoanFines,
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
   SESSION USER
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
   GENERIC HELPERS
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/* =========================================================
   GUARANTOR VALIDATION
========================================================= */

/**
 * We deliberately build the guarantor object field-by-field.
 *
 * DO NOT cast:
 *
 *   guarantor as LoanGuarantor
 *
 * because request JSON is untrusted data.
 *
 * This also fixes:
 *
 * TS2352:
 * Conversion of type Record<string, unknown>
 * to type LoanGuarantor may be a mistake.
 */
function parseGuarantor(
  value: unknown,
): CreateLoanInput["guarantor"] {
  if (!isRecord(value)) {
    throw new Error(
      "A valid guarantor is required.",
    );
  }

  const name =
    typeof value.name === "string"
      ? value.name.trim()
      : "";

  const phone =
    typeof value.phone === "string"
      ? value.phone.trim()
      : "";

  if (!name) {
    throw new Error(
      "Guarantor name is required.",
    );
  }

  if (!phone) {
    throw new Error(
      "Guarantor phone number is required.",
    );
  }

  return {
    name,
    phone,
  };
}

/* =========================================================
   BACKGROUND FINE ACCRUAL
========================================================= */

/**
 * Fine accrual must NEVER delay the loan-list response.
 *
 * Next.js `after()` schedules this work after the response
 * has been sent.
 *
 * This keeps:
 *
 *   GET /api/loans
 *
 * fast while still allowing the authoritative fine engine
 * to update overdue loans in the background.
 *
 * IMPORTANT:
 *
 * `accrueAllLoanFines()` remains the authoritative fine
 * calculation. We are only changing WHEN it executes.
 */
function scheduleBackgroundFineAccrual() {
  after(async () => {
    try {
      await accrueAllLoanFines();
    } catch (error) {
      console.error(
        "Background loan fine accrual failed:",
        error,
      );
    }
  });
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
        ? 1000
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
      limit > 1000
    ) {
      return errorResponse(
        "Limit must be an integer between 1 and 1000.",
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
       GET LOANS IMMEDIATELY
    ------------------------------------------------------- */

    /**
     * IMPORTANT:
     *
     * Fine accrual is intentionally NOT awaited here.
     *
     * The loan list is returned immediately.
     */
    const result =
      await getLoans({
        page,
        limit,
        ...(search
          ? { search }
          : {}),
        ...(memberId
          ? { memberId }
          : {}),
        ...(status
          ? { status }
          : {}),
        ...(type
          ? { type }
          : {}),
      });

    /* -------------------------------------------------------
       SCHEDULE FINE ACCRUAL AFTER RESPONSE
    ------------------------------------------------------- */

    scheduleBackgroundFineAccrual();

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

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
 * SECURITY / DATA INTEGRITY:
 *
 * The client is NOT trusted for:
 *
 * - loan number
 * - member name
 * - member number
 * - interest rate
 * - interest amount
 * - total due
 * - amount paid
 * - outstanding balance
 * - fines
 * - loan status
 * - authorization
 * - audit fields
 *
 * The service calculates and controls these values.
 *
 * The authenticated session user becomes the creator
 * and authorizer under the current workflow.
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
       READ JSON
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
       BODY MUST BE OBJECT
    ------------------------------------------------------- */

    if (!isRecord(body)) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    /* -------------------------------------------------------
       MEMBER ID
    ------------------------------------------------------- */

    const memberId =
      typeof body.memberId === "string"
        ? body.memberId.trim()
        : "";

    if (!memberId) {
      return errorResponse(
        "Member ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       LOAN TYPE
    ------------------------------------------------------- */

    const type =
      typeof body.type === "string"
        ? body.type.trim()
        : "";

    if (
      type !== "emergency" &&
      type !== "regular"
    ) {
      return errorResponse(
        "Loan type must be either emergency or regular.",
        400,
      );
    }

    /* -------------------------------------------------------
       PRINCIPAL
    ------------------------------------------------------- */

    const principal =
      typeof body.principal === "number"
        ? body.principal
        : NaN;

    if (
      !Number.isFinite(principal) ||
      principal <= 0
    ) {
      return errorResponse(
        "Principal must be a positive number.",
        400,
      );
    }

    /*
     * Reject absurd numeric values.
     *
     * This prevents Infinity / NaN / extremely large
     * values from entering financial calculations.
     */
    if (
      !Number.isSafeInteger(
        Math.round(principal * 100),
      )
    ) {
      return errorResponse(
        "Principal is outside the supported financial range.",
        400,
      );
    }

    /* -------------------------------------------------------
       GUARANTOR
    ------------------------------------------------------- */

    let guarantor:
      CreateLoanInput["guarantor"];

    try {
      guarantor =
        parseGuarantor(
          body.guarantor,
        );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "A valid guarantor is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       DAILY FINE
    ------------------------------------------------------- */

    let cleanDailyFine:
      | number
      | undefined;

    if (
      body.dailyFine !== undefined
    ) {
      if (
        typeof body.dailyFine !==
          "number" ||
        !Number.isFinite(
          body.dailyFine,
        ) ||
        body.dailyFine < 0
      ) {
        return errorResponse(
          "Daily fine must be a valid non-negative number.",
          400,
        );
      }

      if (
        !Number.isSafeInteger(
          Math.round(
            body.dailyFine * 100,
          ),
        )
      ) {
        return errorResponse(
          "Daily fine is outside the supported financial range.",
          400,
        );
      }

      cleanDailyFine =
        body.dailyFine;
    }

    /* -------------------------------------------------------
       DISBURSEMENT DATE
    ------------------------------------------------------- */

    let cleanDisbursementDate:
      | Date
      | undefined;

    if (
      body.disbursementDate !==
      undefined
    ) {
      if (
        typeof body.disbursementDate !==
        "string"
      ) {
        return errorResponse(
          "Disbursement date must be a valid date string.",
          400,
        );
      }

      const parsed =
        new Date(
          body.disbursementDate,
        );

      if (
        Number.isNaN(
          parsed.getTime(),
        )
      ) {
        return errorResponse(
          "Invalid disbursement date.",
          400,
        );
      }

      cleanDisbursementDate =
        parsed;
    }

    /* -------------------------------------------------------
       BUILD SAFE CREATE INPUT
    ------------------------------------------------------- */

    const input: CreateLoanInput = {
      memberId,

      type: type as LoanType,

      principal,

      guarantor,

      ...(cleanDailyFine !==
      undefined
        ? {
            dailyFine:
              cleanDailyFine,
          }
        : {}),

      ...(cleanDisbursementDate
        ? {
            disbursementDate:
              cleanDisbursementDate,
          }
        : {}),
    };

    /* -------------------------------------------------------
       CREATE LOAN
    ------------------------------------------------------- */

    /**
     * IMPORTANT:
     *
     * createLoan() performs the authoritative member lookup.
     *
     * The service contains:
     *
     *   if (member.status !== "active") {
     *     throw new Error(
     *       "Only active members can receive loans."
     *     );
     *
     * Therefore manipulating this API request cannot bypass
     * the inactive-member restriction.
     */
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
       DOMAIN / VALIDATION ERRORS
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
      ) ||
      message.includes(
        "cannot receive loans",
      ) ||
      message.includes(
        "must be",
      ) ||
      message.includes(
        "outside the supported financial range",
      );

    return errorResponse(
      message,
      knownError
        ? 400
        : 500,
    );
  }
}