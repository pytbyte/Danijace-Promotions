import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  deleteMember,
  getMemberById,
} from "@/lib/members/service";

/* =========================================================
   GET /api/members/[id]
========================================================= */

/**
 * Retrieves one member by MongoDB member ID.
 *
 * The ID must be the MongoDB ObjectId represented as a string.
 *
 * Response:
 *
 * {
 *   success: true,
 *   data: member
 * }
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
    /* =====================================================
       SERVER LOGGING
    ===================================================== */

    console.error(
      "GET /api/members/[id] error:",
      error,
    );

    /* =====================================================
       ERROR RESPONSE
    ===================================================== */

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