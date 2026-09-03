import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      reset: false,
      error: "Device PIN reset is not implemented yet.",
    },
    { status: 501 },
  );
}