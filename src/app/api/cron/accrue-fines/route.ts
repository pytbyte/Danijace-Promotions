import { NextResponse } from "next/server";

import { accrueAllLoanFines } from "@/lib/loans/fines/reconcile";

async function handleRequest(req: Request) {
  const token = process.env.CRON_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "CRON_TOKEN not configured" },
      { status: 500 },
    );
  }

  const provided =
    req.headers.get("x-cron-token") ||
    new URL(req.url).searchParams.get("token");

  if (!provided || provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reconciled = await accrueAllLoanFines(new Date());

    return NextResponse.json(
      { reconciledPeriods: reconciled },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("accrue-fines error:", error);
    return NextResponse.json(
      { error: String(error ?? "unknown") },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}
