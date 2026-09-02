import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

import clientPromise from "@/lib/mongodb";

const DB_NAME = process.env.MONGODB_DB || "geo-shua";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

type RouteContext = {
  params: Promise<{
    membershipNumber: string;
  }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    /* =====================================================
       GET MEMBERSHIP NUMBER
    ===================================================== */

    const { membershipNumber: rawMembershipNumber } =
      await context.params;

    const membershipNumber = decodeURIComponent(
      rawMembershipNumber,
    )
      .trim()
      .toUpperCase();

    if (!/^GEO-\d{3,}$/.test(membershipNumber)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid membership number",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       READ UPLOAD
    ===================================================== */

    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No image was provided",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       VALIDATE IMAGE
    ===================================================== */

    if (image.size === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "The uploaded image is empty",
        },
        { status: 400 },
      );
    }

    if (image.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: "Image must be smaller than 5 MB",
        },
        { status: 400 },
      );
    }

    if (image.type !== "image/webp") {
      return NextResponse.json(
        {
          success: false,
          error: "Only WebP images are accepted",
        },
        { status: 400 },
      );
    }

    /* =====================================================
       DATABASE
    ===================================================== */

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const members = db.collection("members");

    const member = await members.findOne({
      membershipNumber,
    });

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: "Member not found",
        },
        { status: 404 },
      );
    }

    /* =====================================================
       VERIFY VERCEL BLOB CONFIGURATION
    ===================================================== */

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error(
        "[MEMBER PHOTO UPLOAD] BLOB_READ_WRITE_TOKEN is missing",
      );

      return NextResponse.json(
        {
          success: false,
          error: "Member photo storage is not configured",
          details:
            "BLOB_READ_WRITE_TOKEN is missing from the server environment",
        },
        { status: 500 },
      );
    }

    /* =====================================================
       UPLOAD TO VERCEL BLOB
    ===================================================== */

    const blobPath = `members/${membershipNumber}.webp`;

    let blob;

    try {
      blob = await put(blobPath, image, {
        access: "public",
        contentType: "image/webp",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31536000,
      });
    } catch (error) {
      console.error(
        "[MEMBER PHOTO BLOB UPLOAD]",
        error,
      );

      const details =
        error instanceof Error
          ? error.message
          : "Unknown Vercel Blob upload error";

      return NextResponse.json(
        {
          success: false,
          error: "Failed to upload image to storage",
          details,
        },
        { status: 500 },
      );
    }

    /* =====================================================
       UPDATE MEMBER
    ===================================================== */

    const updatedAt = new Date();

    try {
      const updateResult = await members.updateOne(
        {
          membershipNumber,
        },
        {
          $set: {
            profileImage: blob.url,
            profileImageUpdatedAt: updatedAt,
          },
        },
      );

      if (updateResult.matchedCount === 0) {
        console.error(
          "[MEMBER PHOTO UPLOAD] Member disappeared before update",
          {
            membershipNumber,
          },
        );

        return NextResponse.json(
          {
            success: false,
            error: "Member could not be updated",
            details:
              "The member was found before upload but could not be updated afterward",
          },
          { status: 404 },
        );
      }
    } catch (error) {
      console.error(
        "[MEMBER PHOTO DATABASE UPDATE]",
        error,
      );

      const details =
        error instanceof Error
          ? error.message
          : "Unknown database update error";

      return NextResponse.json(
        {
          success: false,
          error:
            "Image uploaded but member record could not be updated",
          details,
        },
        { status: 500 },
      );
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,
      membershipNumber,
      profileImage: blob.url,
      profileImageUrl: blob.url,
    });
  } catch (error) {
    console.error(
      "[MEMBER PHOTO UPLOAD]",
      error,
    );

    const details =
      error instanceof Error
        ? error.message
        : "Unknown server error";

    return NextResponse.json(
      {
        success: false,
        error: "Failed to upload member photo",
        details,
      },
      { status: 500 },
    );
  }
}