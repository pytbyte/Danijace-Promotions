import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createMemberSavingsWithdrawal,
} from "@/lib/savings/service";

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

function getString(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return undefined;
  }

  return value.trim();
}

function getFiniteNumber(
  value: unknown,
): number | null {
  const number =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

export async function POST(
  request: Request,
) {
  try {
    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400,
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    const payload =
      body as Record<string, unknown>;

    const memberId =
      getString(payload.memberId);

    if (!memberId) {
      return errorResponse(
        "Member ID is required.",
        400,
      );
    }

    const amount =
      getFiniteNumber(payload.amount);

    if (amount === null) {
      return errorResponse(
        "Withdrawal amount must be a valid number.",
        400,
      );
    }

    if (amount <= 0) {
      return errorResponse(
        "Withdrawal amount must be greater than zero.",
        400,
      );
    }

    const reason =
      getString(payload.reason);

    if (!reason) {
      return errorResponse(
        "Withdrawal reason is required.",
        400,
      );
    }

    const recordedBy =
      session.user.email
        ? {
            id: session.user.email,
            name:
              session.user.name ||
              session.user.email,
            email: session.user.email,
          }
        : undefined;

    const result =
      await createMemberSavingsWithdrawal({
        memberId,
        amount,
        reason,
        recordedBy,
        source: "manual",
      });

    return successResponse(
      result,
      201,
    );
  } catch (error) {
    console.error(
      "POST /api/savings/withdraw error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to process savings withdrawal.";

    const businessErrors = [
      "Member ID is required.",
      "Withdrawal amount must be greater than zero.",
      "Withdrawal reason is required.",
      "Withdrawal exceeds the member's total savings balance.",
      "Member does not have an active savings account.",
    ];

    return errorResponse(
      message,
      businessErrors.includes(message)
        ? 400
        : 500,
    );
  }
}

export async function GET() {
  return errorResponse(
    "Use POST /api/savings/withdraw to record a member savings withdrawal.",
    405,
  );
}

export async function PUT() {
  return errorResponse(
    "Savings withdrawals are immutable after creation.",
    405,
  );
}

export async function PATCH() {
  return errorResponse(
    "Savings withdrawals are immutable after creation.",
    405,
  );
}

export async function DELETE() {
  return errorResponse(
    "Savings withdrawals cannot be permanently deleted.",
    405,
  );
}
