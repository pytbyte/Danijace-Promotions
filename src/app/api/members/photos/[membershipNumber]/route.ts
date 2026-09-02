
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
       UPLOAD TO VERCEL BLOB
    ===================================================== */

    const blobPath = `members/${membershipNumber}.webp`;

    const blob = await put(blobPath, image, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    /* =====================================================
       UPDATE MEMBER
    ===================================================== */

    const updatedAt = new Date();

    await members.updateOne(
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

    return NextResponse.json(
      {
        success: false,
        error: "Failed to upload member photo",
      },
      { status: 500 },
    );
  }
}
