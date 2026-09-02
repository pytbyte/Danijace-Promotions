import { NextRequest, NextResponse } from "next/server";

import { get, put } from "@vercel/blob";

import clientPromise from "@/lib/mongodb";

/* =========================================================
   CONFIG
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const MEMBERSHIP_REGEX = /^GEO-\d{3,}$/i;

/* =========================================================
   HELPERS
========================================================= */

function normalizeMembershipNumber(
  value: string,
): string {
  return decodeURIComponent(value)
    .trim()
    .toUpperCase();
}

function getBlobPath(
  membershipNumber: string,
): string {
  return `members/${membershipNumber}.webp`;
}

function getStoredImageValue(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

/* =========================================================
   GET — SERVE PRIVATE MEMBER PHOTO
========================================================= */

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      membershipNumber: string;
    }>;
  },
) {
  try {
    /* -------------------------------------------------------
       MEMBERSHIP NUMBER
    ------------------------------------------------------- */

    const {
      membershipNumber: rawMembershipNumber,
    } = await params;

    const membershipNumber =
      normalizeMembershipNumber(
        rawMembershipNumber,
      );

    if (
      !MEMBERSHIP_REGEX.test(
        membershipNumber,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid membership number",
        },
        {
          status: 400,
        },
      );
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const member =
      await db
        .collection("members")
        .findOne(
          {
            membershipNumber,
          },
          {
            projection: {
              profileImage: 1,
            },
          },
        );

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error: "Member not found",
        },
        {
          status: 404,
        },
      );
    }

    /* -------------------------------------------------------
       STORED PROFILE IMAGE
    ------------------------------------------------------- */

    const storedImage =
      getStoredImageValue(
        member.profileImage,
      );

    if (!storedImage) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Profile image not found",
        },
        {
          status: 404,
        },
      );
    }

    /* -------------------------------------------------------
       RESOLVE BLOB PATH

       Supports both:

       members/GEO-000003.webp

       and older records containing:

       https://....private.blob.vercel-storage.com/
       members/GEO-000003.webp
    ------------------------------------------------------- */

    let pathname: string;

    if (
      storedImage.startsWith(
        "https://",
      ) ||
      storedImage.startsWith(
        "http://",
      )
    ) {
      try {
        const url =
          new URL(storedImage);

        pathname =
          url.pathname.replace(
            /^\/+/,
            "",
          );
      } catch {
        return NextResponse.json(
          {
            success: false,
            error:
              "Invalid profile image URL",
          },
          {
            status: 500,
          },
        );
      }
    } else {
      pathname = storedImage;
    }

    /* -------------------------------------------------------
       CONDITIONAL REQUEST
    ------------------------------------------------------- */

    const ifNoneMatch =
      request.headers.get(
        "if-none-match",
      ) || undefined;

    /* -------------------------------------------------------
       GET PRIVATE BLOB
    ------------------------------------------------------- */

    const result =
      await get(
        pathname,
        {
          access: "private",
          ifNoneMatch,
        },
      );

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Profile image not found in Blob storage",
        },
        {
          status: 404,
        },
      );
    }

    /* -------------------------------------------------------
       NOT MODIFIED
    ------------------------------------------------------- */

    if (
      result.statusCode === 304
    ) {
      return new NextResponse(
        null,
        {
          status: 304,
        },
      );
    }

    /* -------------------------------------------------------
       RESPONSE HEADERS
    ------------------------------------------------------- */

    const headers =
      new Headers();

    headers.set(
      "Content-Type",
      result.blob.contentType ||
        "image/webp",
    );

    headers.set(
      "Content-Length",
      String(
        result.blob.size,
      ),
    );

    if (result.blob.etag) {
      headers.set(
        "ETag",
        result.blob.etag,
      );
    }

    headers.set(
      "Cache-Control",
      "private, no-cache",
    );

    /* -------------------------------------------------------
       RETURN PRIVATE BLOB STREAM
    ------------------------------------------------------- */

    return new NextResponse(
      result.stream,
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    console.error(
      "[MEMBER PHOTO GET]",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to load profile image",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   POST — UPLOAD / REPLACE MEMBER PHOTO
========================================================= */

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      membershipNumber: string;
    }>;
  },
) {
  try {
    /* -------------------------------------------------------
       MEMBERSHIP NUMBER
    ------------------------------------------------------- */

    const {
      membershipNumber: rawMembershipNumber,
    } = await params;

    const membershipNumber =
      normalizeMembershipNumber(
        rawMembershipNumber,
      );

    if (
      !MEMBERSHIP_REGEX.test(
        membershipNumber,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid membership number",
        },
        {
          status: 400,
        },
      );
    }

    /* -------------------------------------------------------
       CONTENT TYPE
    ------------------------------------------------------- */

    const contentType =
      request.headers.get(
        "content-type",
      ) || "";

    if (
      !contentType
        .toLowerCase()
        .includes(
          "image/webp",
        )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only WebP images are supported",
        },
        {
          status: 400,
        },
      );
    }

    /* -------------------------------------------------------
       READ IMAGE
    ------------------------------------------------------- */

    const arrayBuffer =
      await request.arrayBuffer();

    if (
      arrayBuffer.byteLength ===
      0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Empty image",
        },
        {
          status: 400,
        },
      );
    }

    if (
      arrayBuffer.byteLength >
      MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Image must not exceed 5 MB",
        },
        {
          status: 400,
        },
      );
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const member =
      await db
        .collection("members")
        .findOne(
          {
            membershipNumber,
          },
          {
            projection: {
              _id: 1,
            },
          },
        );

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Member not found",
        },
        {
          status: 404,
        },
      );
    }

    /* -------------------------------------------------------
       DETERMINISTIC BLOB PATH
    ------------------------------------------------------- */

    const pathname =
      getBlobPath(
        membershipNumber,
      );

    /* -------------------------------------------------------
       UPLOAD / REPLACE
    ------------------------------------------------------- */

    const blob =
      await put(
        pathname,
        arrayBuffer,
        {
          access: "private",
          contentType:
            "image/webp",
          addRandomSuffix:
            false,
          allowOverwrite:
            true,
          cacheControlMaxAge:
            31536000,
        },
      );

    /* -------------------------------------------------------
       SAVE PATHNAME IN MONGODB

       We deliberately store:

       members/GEO-000003.webp

       instead of the private Blob URL.
    ------------------------------------------------------- */

    await db
      .collection("members")
      .updateOne(
        {
          membershipNumber,
        },
        {
          $set: {
            profileImage:
              blob.pathname,

            profileImageUpdatedAt:
              new Date(),

            updatedAt:
              new Date(),
          },
        },
      );

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return NextResponse.json({
      success: true,

      membershipNumber,

      profileImage:
        blob.pathname,

      profileImageUrl:
        `/api/members/photos/${encodeURIComponent(
          membershipNumber,
        )}`,
    });
  } catch (error) {
    console.error(
      "[MEMBER PHOTO BLOB UPLOAD]",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to upload profile image",
      },
      {
        status: 500,
      },
    );
  }
}