import { NextRequest, NextResponse } from "next/server";

import {
  createMember,
  getMembers,
  searchMembers,
} from "@/lib/members/service";

/* =========================================================
   GET /api/members

   Examples:

   /api/members

   /api/members?search=john

   /api/members?page=1&limit=25

   /api/members?search=john&page=1&limit=25
========================================================= */

export async function GET(request: NextRequest) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const search =
      searchParams.get("search")?.trim() || "";

    const pageParam =
      searchParams.get("page");

    const limitParam =
      searchParams.get("limit");

    const page =
      pageParam
        ? Number(pageParam)
        : 1;

    const limit =
      limitParam
        ? Number(limitParam)
        : 25;

    /* ---------------------------------------------
       VALIDATE PAGE
    --------------------------------------------- */

    if (
      !Number.isInteger(page) ||
      page < 1
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Page must be a positive integer.",
        },
        {
          status: 400,
        }
      );
    }

    /* ---------------------------------------------
       VALIDATE LIMIT
    --------------------------------------------- */

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Limit must be an integer between 1 and 100.",
        },
        {
          status: 400,
        }
      );
    }

    /* ---------------------------------------------
       GET MEMBERS
    --------------------------------------------- */

    const result = search
      ? await searchMembers(search, {
          page,
          limit,
        })
      : await getMembers({
          page,
          limit,
        });

    /* ---------------------------------------------
       RESPONSE
    --------------------------------------------- */

    return NextResponse.json(
      {
        success: true,

        data: result.members,

        count: result.members.length,

        total: result.total,

        page: result.page,

        limit: result.limit,

        totalPages: result.totalPages,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "GET /api/members error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to retrieve members.",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
   POST /api/members

   Creates a new member.
========================================================= */

export async function POST(
  request: NextRequest
) {
  try {
    /* ---------------------------------------------
       READ REQUEST BODY
    --------------------------------------------- */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid JSON request body.",
        },
        {
          status: 400,
        }
      );
    }

    /* ---------------------------------------------
       BASIC BODY VALIDATION
    --------------------------------------------- */

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid member data.",
        },
        {
          status: 400,
        }
      );
    }

    /* ---------------------------------------------
       CREATE MEMBER
    --------------------------------------------- */

    const member = await createMember(
      body as Record<string, unknown>
    );

    /* ---------------------------------------------
       RESPONSE
    --------------------------------------------- */

    return NextResponse.json(
      {
        success: true,
        data: member,
        message:
          "Member created successfully.",
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error(
      "POST /api/members error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create member.";

    /* ---------------------------------------------
       KNOWN ERRORS
    --------------------------------------------- */

    const knownError =
      message.includes("already exists") ||
      message.includes("already uses") ||
      message.includes("required") ||
      message.includes("Invalid");

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: knownError ? 400 : 500,
      }
    );
  }
}