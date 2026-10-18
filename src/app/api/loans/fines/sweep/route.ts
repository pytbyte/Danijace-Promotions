import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  normalizeSweepAsOfDate,
  sweepHistoricalLoanFines,
} from "@/lib/loans/fines/sweep";

function getSweepSecret(): string | undefined {
  const secret = process.env.LOANS_FINE_SWEEP_SECRET;

  return typeof secret === "string" && secret.trim()
    ? secret.trim()
    : undefined;
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = getSweepSecret();

  if (secret) {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : authorization.trim();

    return token === secret;
  }

  const session = await auth();
  return Boolean(session?.user);
}

export async function GET(
  request: NextRequest,
) {
  try {
    const authorized = await isAuthorized(request);

    if (!authorized) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined;
    const result = await sweepHistoricalLoanFines(asOfDate);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("GET /api/loans/fines/sweep error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Historical fine sweep failed.",
      },
      { status: 400 },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const authorized = await isAuthorized(request);

    if (!authorized) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    let rawBody: unknown = {};

    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const parsedBody =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? rawBody
        : {};

    const asOfDate =
      "asOfDate" in parsedBody && typeof parsedBody.asOfDate === "string"
        ? parsedBody.asOfDate
        : request.nextUrl.searchParams.get("asOfDate") ?? undefined;

    const normalizedDate = normalizeSweepAsOfDate(asOfDate);
    const result = await sweepHistoricalLoanFines(normalizedDate);

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("POST /api/loans/fines/sweep error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Historical fine sweep failed.",
      },
      { status: 400 },
    );
  }
}
