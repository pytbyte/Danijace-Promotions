import { NextRequest, NextResponse } from "next/server";
import {
  deleteMember,
  getMemberById,
  updateMember,
} from "@/lib/members/service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/* =========================================================
   GET /api/members/:id

   Get one member by MongoDB ID.
========================================================= */

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    const member = await getMemberById(id);

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: "Member not found.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: member,
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "GET /api/members/[id] error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve member.",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
   PATCH /api/members/:id

   Update an existing member.
========================================================= */

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        }
      );
    }

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
          error: "Invalid JSON request body.",
        },
        {
          status: 400,
        }
      );
    }

    /* ---------------------------------------------
       VALIDATE BODY
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
       UPDATE MEMBER
    --------------------------------------------- */

    const member = await updateMember(
      id,
      body as Record<string, unknown>
    );

    return NextResponse.json(
      {
        success: true,
        data: member,
        message: "Member updated successfully.",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "PATCH /api/members/[id] error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update member.";

    /* ---------------------------------------------
       MEMBER NOT FOUND
    --------------------------------------------- */

    if (message === "Member not found.") {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 404,
        }
      );
    }

    /* ---------------------------------------------
       INVALID / DUPLICATE DATA
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

/* =========================================================
   DELETE /api/members/:id

   Permanently removes a member.
========================================================= */

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    const deleted = await deleteMember(id);

    if (!deleted) {
      return NextResponse.json(
        {
          success: false,
          error: "Member not found.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Member deleted successfully.",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "DELETE /api/members/[id] error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete member.";

    if (message === "Invalid member ID") {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 400,
        }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete member.",
      },
      {
        status: 500,
      }
    );
  }
}