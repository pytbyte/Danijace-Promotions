import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  deleteLoan,
  getLoanById,
  updateLoan,
} from "@/lib/loans/service";

import type {
  CalendarDate,
  LoanType,
  UpdateLoanInput,
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function getLoanId(
  context: {
    params: Promise<{ id: string }>;
  },
): Promise<string> {
  const { id } = await context.params;

  return id.trim();
}

/* =========================================================
   CALENDAR DATE VALIDATION
========================================================= */

/**
 * Loan business dates are calendar dates.
 *
 * They are intentionally stored as strings:
 *
 *     YYYY-MM-DD
 *
 * We do NOT convert these to JavaScript Date objects.
 *
 * This prevents timezone-related date shifts such as:
 *
 *     2026-09-11
 *
 * becoming:
 *
 *     2026-09-10
 *
 * when the value passes through UTC/local-time conversion.
 */
function parseOptionalDate(
  value: unknown,
  fieldName: string,
): CalendarDate | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(
      `${fieldName} must be a valid date string in YYYY-MM-DD format.`,
    );
  }

  const date = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `${fieldName} must be a valid date string in YYYY-MM-DD format.`,
    );
  }

  const [
    year,
    month,
    day,
  ] = date.split("-").map(Number);

  /*
   * Validate the actual calendar date without converting
   * the supplied value into a Date for storage.
   */
  const daysInMonth =
    new Date(
      Date.UTC(
        year,
        month,
        0,
      ),
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
): UpdateLoanInput["guarantor"] {
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

  const guarantor: UpdateLoanInput["guarantor"] = {
    name,
    phone,
  };

  /*
   * Preserve idNumber when supplied.
   *
   * This keeps the update behavior consistent with the
   * create-loan route.
   */
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
   ALLOWED UPDATE FIELDS
========================================================= */

/**
 * These are the fields the client is allowed to request
 * changing.
 *
 * Financial/business rules are enforced by updateLoan()
 * in the service layer.
 *
 * In particular:
 *
 * - installmentAmount MAY be requested for editing.
 * - updateLoan() must reject changing it after financial
 *   activity has occurred.
 *
 * We do NOT put protected/calculated fields here such as:
 *
 * - loanNumber
 * - interestRate
 * - interestAmount
 * - totalDue
 * - amountPaid
 * - outstandingBalance
 * - fineRate
 * - repaymentCycleDays
 * - status
 * - repaymentStatus
 * - firstDueDate
 * - createdAt
 * - updatedAt
 */
const ALLOWED_UPDATE_FIELDS =
  new Set([
    "type",
    "principal",
    "installmentAmount",
    "guarantor",
    "disbursementDate",
    "repaymentDate",
    "endDate",
  ]);

/* =========================================================
   GET /api/loans/[id]
========================================================= */

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
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
       LOAN ID
    ------------------------------------------------------- */

    const id =
      await getLoanId(context);

    if (!id) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       GET LOAN
    ------------------------------------------------------- */

    const loan =
      await getLoanById(id);

    if (!loan) {
      return errorResponse(
        "Loan not found.",
        404,
      );
    }

    return successResponse(
      loan,
      200,
    );
  } catch (error) {
    console.error(
      "GET /api/loans/[id] error:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve loan.",
      500,
    );
  }
}

/* =========================================================
   PATCH /api/loans/[id]
========================================================= */

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
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
       LOAN ID
    ------------------------------------------------------- */

    const id =
      await getLoanId(context);

    if (!id) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

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

    if (!isRecord(body)) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    /* -------------------------------------------------------
       REJECT UNKNOWN / PROTECTED FIELDS
    ------------------------------------------------------- */

    const receivedFields =
      Object.keys(body);

    for (const field of receivedFields) {
      if (
        !ALLOWED_UPDATE_FIELDS.has(
          field,
        )
      ) {
        return errorResponse(
          `Field "${field}" cannot be changed through the loan update API.`,
          400,
        );
      }
    }

    if (
      receivedFields.length === 0
    ) {
      return errorResponse(
        "At least one editable loan field is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       BUILD SAFE UPDATE INPUT
    ------------------------------------------------------- */

    const changes: UpdateLoanInput =
      {};

    /* -------------------------------------------------------
       LOAN TYPE
    ------------------------------------------------------- */

    if (
      body.type !== undefined
    ) {
      if (
        body.type !== "emergency" &&
        body.type !== "regular"
      ) {
        return errorResponse(
          "Loan type must be either emergency or regular.",
          400,
        );
      }

      changes.type =
        body.type as LoanType;
    }

    /* -------------------------------------------------------
       PRINCIPAL
    ------------------------------------------------------- */

    if (
      body.principal !== undefined
    ) {
      if (
        typeof body.principal !==
          "number" ||
        !Number.isFinite(
          body.principal,
        ) ||
        body.principal <= 0
      ) {
        return errorResponse(
          "Principal must be a positive number.",
          400,
        );
      }

      if (
        !Number.isSafeInteger(
          Math.round(
            body.principal * 100,
          ),
        )
      ) {
        return errorResponse(
          "Principal is outside the supported financial range.",
          400,
        );
      }

      changes.principal =
        body.principal;
    }

    /* -------------------------------------------------------
       INSTALLMENT AMOUNT
    ------------------------------------------------------- */

    /**
     * installmentAmount is an editable request field.
     *
     * It represents the repayment amount for each
     * repayment cycle.
     *
     * Normal GEO-SHUA configuration:
     *
     *     7 days = weekly installment
     *
     * This is NOT a daily fine.
     *
     * IMPORTANT:
     *
     * We only validate it when the client actually sends
     * installmentAmount.
     *
     * The service layer remains responsible for deciding
     * whether the existing loan is still allowed to have
     * its installment changed.
     */
    if (
      body.installmentAmount !==
      undefined
    ) {
      const installmentAmount =
        typeof body.installmentAmount ===
        "number"
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

      changes.installmentAmount =
        installmentAmount;
    }

    /* -------------------------------------------------------
       GUARANTOR
    ------------------------------------------------------- */

    if (
      body.guarantor !== undefined
    ) {
      try {
        changes.guarantor =
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
    }

    /* -------------------------------------------------------
       DISBURSEMENT DATE
    ------------------------------------------------------- */

    if (
      body.disbursementDate !==
      undefined
    ) {
      try {
        changes.disbursementDate =
          parseOptionalDate(
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

    /* -------------------------------------------------------
       REPAYMENT DATE
    ------------------------------------------------------- */

    if (
      body.repaymentDate !==
      undefined
    ) {
      try {
        changes.repaymentDate =
          parseOptionalDate(
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

    /* -------------------------------------------------------
       END DATE
    ------------------------------------------------------- */

    if (
      body.endDate !== undefined
    ) {
      try {
        changes.endDate =
          parseOptionalDate(
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
      changes.disbursementDate &&
      changes.repaymentDate &&
      changes.repaymentDate <
        changes.disbursementDate
    ) {
      return errorResponse(
        "Repayment date cannot be before the disbursement date.",
        400,
      );
    }

    if (
      changes.repaymentDate &&
      changes.endDate &&
      changes.endDate <
        changes.repaymentDate
    ) {
      return errorResponse(
        "End date cannot be before the repayment date.",
        400,
      );
    }

    if (
      changes.disbursementDate &&
      changes.endDate &&
      changes.endDate <
        changes.disbursementDate
    ) {
      return errorResponse(
        "End date cannot be before the disbursement date.",
        400,
      );
    }

    /* -------------------------------------------------------
       UPDATE LOAN
    ------------------------------------------------------- */

    const loan =
      await updateLoan(
        id,
        changes,
        actor,
      );

    return successResponse(
      loan,
      200,
    );
  } catch (error) {
    console.error(
      "PATCH /api/loans/[id] error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update loan.";

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
        "cannot be changed",
      ) ||
      message.includes(
        "cannot update",
      ) ||
      message.includes(
        "cannot edit",
      ) ||
      message.includes(
        "completed",
      ) ||
      message.includes(
        "cancelled",
      ) ||
      message.includes(
        "repayment",
      ) ||
      message.includes(
        "fine",
      ) ||
      message.includes(
        "waiver",
      ) ||
      message.includes(
        "assessment",
      ) ||
      message.includes(
        "financial activity",
      ) ||
      message.includes(
        "outside the supported financial range",
      ) ||
      message.includes(
        "valid actor",
      ) ||
      message.includes(
        "must be",
      );

    return errorResponse(
      message,
      knownError ? 400 : 500,
    );
  }
}

/* =========================================================
   DELETE /api/loans/[id]
========================================================= */

export async function DELETE(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
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
       LOAN ID
    ------------------------------------------------------- */

    const id =
      await getLoanId(context);

    if (!id) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       DELETE LOAN
    ------------------------------------------------------- */

    await deleteLoan(id);

    /* -------------------------------------------------------
       SUCCESS RESPONSE
    ------------------------------------------------------- */

    return successResponse(
      {
        message:
          "Loan deleted successfully.",
      },
      200,
    );
  } catch (error) {
    console.error(
      "DELETE /api/loans/[id] error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete loan.";

    if (
      message ===
      "Invalid loan ID."
    ) {
      return errorResponse(
        message,
        400,
      );
    }

    if (
      message ===
      "Loan not found."
    ) {
      return errorResponse(
        message,
        404,
      );
    }

    return errorResponse(
      message,
      500,
    );
  }
}