import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  deleteMember,
  getMemberById,
  updateMember,
} from "@/lib/members/service";

/* =========================================================
   GET /api/members/[id]
========================================================= */

/**
 * Retrieves one member by MongoDB member ID.
 */
export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    /* =====================================================
       1. AUTHENTICATE USER
    ===================================================== */

    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       2. GET MEMBER ID
    ===================================================== */

    const { id } = await context.params;

    const memberId =
      typeof id === "string"
        ? id.trim()
        : "";

    if (!memberId) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. LOAD MEMBER
    ===================================================== */

    const member =
      await getMemberById(memberId);

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: "Member not found.",
        },
        {
          status: 404,
        },
      );
    }

    /* =====================================================
       4. SUCCESS
    ===================================================== */

    return NextResponse.json(
      {
        success: true,
        data: member,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "GET /api/members/[id] error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load member.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   PATCH /api/members/[id]
========================================================= */

/**
 * Updates an existing member.
 *
 * Protected fields such as:
 *
 * - _id
 * - membershipNumber
 * - createdAt
 * - createdBy
 *
 * are protected by the service layer.
 */
export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    /* =====================================================
       1. AUTHENTICATE USER
    ===================================================== */

    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       2. GET MEMBER ID
    ===================================================== */

    const { id } = await context.params;

    const memberId =
      typeof id === "string"
        ? id.trim()
        : "";

    if (!memberId) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. READ REQUEST BODY
    ===================================================== */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must contain valid JSON.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       4. VALIDATE BODY SHAPE
    ===================================================== */

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must be a JSON object.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       5. GET AUTHENTICATED ACTOR
    ===================================================== */

    const updatedBy =
      session.user.email ||
      session.user.name ||
      "authenticated-user";

    /* =====================================================
       6. UPDATE MEMBER
    ===================================================== */

    const updatedMember =
      await updateMember(
        memberId,
        body as Partial<import("@/lib/members/types").Member>,
        updatedBy,
      );

    /* =====================================================
       7. SUCCESS
    ===================================================== */

    return NextResponse.json(
      {
        success: true,
        data: updatedMember,
        message: "Member updated successfully.",
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    /* =====================================================
       SERVER LOGGING
    ===================================================== */

    console.error(
      "PATCH /api/members/[id] error:",
      error,
    );

    /* =====================================================
       ERROR MESSAGE
    ===================================================== */

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update member.";

    /* =====================================================
       KNOWN CLIENT ERRORS
    ===================================================== */

    const notFound =
      message === "Member not found.";

    const invalidId =
      message === "Invalid member ID.";

    const validationError =
      !message.includes(
        "could not be retrieved",
      ) &&
      !message.includes(
        "updated but",
      ) &&
      !message.includes(
        "database",
      );

    if (
      notFound
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 404,
        },
      );
    }

    if (
      invalidId
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Validation and duplicate errors generated
     * by updateMember() are safe to return to the
     * client because they describe the supplied data.
     */
    if (
      validationError
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to update member.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   DELETE /api/members/[id]
========================================================= */

/**
 * Permanently deletes a member and all member-owned
 * financial records.
 *
 * AUTHENTICATION
 * ---------------------------------------------------------
 * A valid authenticated session is required.
 *
 * There is no administrator email whitelist here.
 *
 * If a user has an active authenticated session,
 * the deletion is allowed.
 */
export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    /* =====================================================
       1. AUTHENTICATE USER
    ===================================================== */

    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       2. GET MEMBER ID
    ===================================================== */

    const { id } = await context.params;

    const memberId =
      typeof id === "string"
        ? id.trim()
        : "";

    if (!memberId) {
      return NextResponse.json(
        {
          success: false,
          error: "Member ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       3. PERFORM COMPLETE HARD DELETE
    ===================================================== */

    await deleteMember(memberId);

    /* =====================================================
       4. SUCCESS
    ===================================================== */

    return NextResponse.json(
      {
        success: true,
        message:
          "Member and all associated records were permanently deleted.",
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    /* =====================================================
       SERVER LOGGING
    ===================================================== */

    console.error(
      "DELETE /api/members/[id] error:",
      error,
    );

    /* =====================================================
       ERROR RESPONSE
    ===================================================== */

    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete member.";

    const knownError =
      message === "Member not found." ||
      message === "Invalid member ID." ||
      message.includes(
        "could not be permanently deleted",
      ) ||
      message.includes(
        "deletion verification failed",
      );

    return NextResponse.json(
      {
        success: false,
        error: knownError
          ? message
          : "Failed to permanently delete member.",
      },
      {
        status: knownError
          ? 400
          : 500,
      },
    );
  }
}
