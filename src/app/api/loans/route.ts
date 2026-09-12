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
  CalendarDate,
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
    { status },
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
    { status },
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
   SESSION ACTOR
========================================================= */

function getSessionActor(
  session: AuthenticatedSession,
) {
  const name =
    typeof session.user?.name === "string"
      ? session.user.name.trim()
      : "";

  const email =
    typeof session.user?.email === "string"
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

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
   CALENDAR DATE
========================================================= */

/**
 * Loan business dates are stored as:
 *
 * YYYY-MM-DD
 *
 * They are NOT JavaScript Date objects.
 */
function parseCalendarDate(
  value: unknown,
  fieldName: string,
): CalendarDate {
  if (typeof value !== "string") {
    throw new Error(
      `${fieldName} must be a valid date string.`,
    );
  }

  const date = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `${fieldName} must use YYYY-MM-DD format.`,
    );
  }

  const [year, month, day] =
    date.split("-").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(
      `Invalid ${fieldName.toLowerCase()}.`,
    );
  }

  const daysInMonth = new Date(
    Date.UTC(year, month, 0),
  ).getUTCDate();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth
  ) {
    throw new Error(
      `Invalid ${fieldName.toLowerCase()}.`,
    );
  }

  return date as CalendarDate;
}

/* =========================================================
   GUARANTOR
========================================================= */

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

  const guarantor: CreateLoanInput["guarantor"] = {
    name,
    phone,
  };

  if (
    typeof value.idNumber === "string" &&
    value.idNumber.trim()
  ) {
    guarantor.idNumber =
      value.idNumber.trim();
  }

  return guarantor;
}

/* =========================================================
   BACKGROUND FINE ACCRUAL
========================================================= */

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

export async function GET(
  request: NextRequest,
) {
  try {
    const session =
      (await auth()) as AuthenticatedSession | null;

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    const params =
      request.nextUrl.searchParams;

    const pageParam =
      params.get("page");

    const limitParam =
      params.get("limit");

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

    const search =
      getOptionalString(
        params.get("search"),
      );

    const memberId =
      getOptionalString(
        params.get("memberId"),
      );

    const statusParam =
      getOptionalString(
        params.get("status"),
      );

    const typeParam =
      getOptionalString(
        params.get("type"),
      );

    let status:
      | LoanStatus
      | undefined;

    if (statusParam) {
      const validStatuses: LoanStatus[] = [
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

    let type:
      | LoanType
      | undefined;

    if (typeParam) {
      const validTypes: LoanType[] = [
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

    scheduleBackgroundFineAccrual();

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

export async function POST(
  request: NextRequest,
) {
  try {
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

    if (!isRecord(body)) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    /* -------------------------------------------------------
       MEMBER
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
       INSTALLMENT AMOUNT
    ------------------------------------------------------- */

    const installmentAmount =
      typeof body.installmentAmount === "number"
        ? body.installmentAmount
        : NaN;

    if (
      !Number.isFinite(
        installmentAmount,
      ) ||
      installmentAmount <= 0
    ) {
      return errorResponse(
        "Installment amount must be a positive number.",
        400,
      );
    }

    if (
      !Number.isSafeInteger(
        Math.round(
          installmentAmount * 100,
        ),
      )
    ) {
      return errorResponse(
        "Installment amount is outside the supported financial range.",
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
       LOAN DATES
    ------------------------------------------------------- */

    let disbursementDate:
      | CalendarDate
      | undefined;

    let repaymentDate:
      | CalendarDate
      | undefined;

    let endDate:
      | CalendarDate
      | undefined;

    /*
     * IMPORTANT:
     *
     * These are calendar dates, not timestamps.
     *
     * We validate them but NEVER convert them to
     * JavaScript Date objects.
     *
     * Example:
     *
     * "2026-09-11"
     *
     * remains:
     *
     * "2026-09-11"
     */

    if (
      body.disbursementDate !==
      undefined
    ) {
      try {
        disbursementDate =
          parseCalendarDate(
            body.disbursementDate,
            "Disbursement date",
          );
      } catch (error) {
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Invalid disbursement date.",
          400,
        );
      }
    }

    if (
      body.repaymentDate !==
      undefined
    ) {
      try {
        repaymentDate =
          parseCalendarDate(
            body.repaymentDate,
            "Repayment date",
          );
      } catch (error) {
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Invalid repayment date.",
          400,
        );
      }
    }

    if (
      body.endDate !==
      undefined
    ) {
      try {
        endDate =
          parseCalendarDate(
            body.endDate,
            "End date",
          );
      } catch (error) {
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Invalid end date.",
          400,
        );
      }
    }

    /* -------------------------------------------------------
       DATE ORDER VALIDATION
    ------------------------------------------------------- */

    if (
      disbursementDate &&
      repaymentDate &&
      repaymentDate < disbursementDate
    ) {
      return errorResponse(
        "Repayment date cannot be before the disbursement date.",
        400,
      );
    }

    if (
      repaymentDate &&
      endDate &&
      endDate < repaymentDate
    ) {
      return errorResponse(
        "End date cannot be before the repayment date.",
        400,
      );
    }

    if (
      disbursementDate &&
      endDate &&
      endDate < disbursementDate
    ) {
      return errorResponse(
        "End date cannot be before the disbursement date.",
        400,
      );
    }

    /* -------------------------------------------------------
       CREATE INPUT
    ------------------------------------------------------- */

    const input: CreateLoanInput = {
      memberId,

      type:
        type as LoanType,

      principal,

      guarantor,

      installmentAmount,

      ...(disbursementDate
        ? {
            disbursementDate,
          }
        : {}),

      ...(repaymentDate
        ? {
            repaymentDate,
          }
        : {}),

      ...(endDate
        ? {
            endDate,
          }
        : {}),
    };

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

    const knownError =
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("not found") ||
      message.includes("disabled") ||
      message.includes("Only active members") ||
      message.includes("already has") ||
      message.includes("outstanding balance") ||
      message.includes("minimum savings") ||
      message.includes("cannot exceed") ||
      message.includes("does not have an active") ||
      message.includes("invalid balance") ||
      message.includes("valid actor") ||
      message.includes("cannot receive loans") ||
      message.includes("must be") ||
      message.includes(
        "outside the supported financial range",
      );

    return errorResponse(
      message,
      knownError ? 400 : 500,
    );
  }
}