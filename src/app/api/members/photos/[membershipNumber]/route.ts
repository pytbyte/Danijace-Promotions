import { del, get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";

/* =========================================================
   CONFIG
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const MAX_FILE_SIZE =
  5 * 1024 * 1024;

const MEMBERSHIP_REGEX =
  /^GEO-\d{3,}$/i;

/*
 * The client always normalizes images into JPEG
 * before uploading.
 *
 * Therefore the server stores one canonical format:
 *
 * members/GEO-001.jpg
 */
const PROFILE_IMAGE_CONTENT_TYPE =
  "image/jpeg";

/* =========================================================
   HELPERS
========================================================= */

function normalizeMembershipNumber(
  value: string,
) {
  try {
    return decodeURIComponent(value)
      .trim()
      .toUpperCase();
  } catch {
    return value
      .trim()
      .toUpperCase();
  }
}

/* ---------------------------------------------------------
   BLOB PATH
--------------------------------------------------------- */

function getBlobPath(
  membershipNumber: string,
) {
  return `members/${membershipNumber}.jpg`;
}

/* ---------------------------------------------------------
   STORED IMAGE VALUE
--------------------------------------------------------- */

function getStoredImageValue(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

/* ---------------------------------------------------------
   RESOLVE STORED BLOB PATH
---------------------------------------------------------

   Supports both:

   1. New pathname:
      members/GEO-001.jpg

   2. Legacy stored URL:
      https://xxxxx.public.blob.vercel-storage.com/...

   This makes migration safer.
--------------------------------------------------------- */

function resolveBlobPath(value: string): string | null {
  if (
    value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    try {
      const url = new URL(value);

      return url.pathname.replace(
        /^\/+/,
        "",
      );
    } catch {
      return null;
    }
  }

  return value.replace(
    /^\/+/,
    "",
  );
}

/* ---------------------------------------------------------
   CONTENT TYPE
--------------------------------------------------------- */

function normalizeContentType(
  value: string,
) {
  return value
    .toLowerCase()
    .split(";")[0]
    .trim();
}

/* =========================================================
   GET
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
    /* -----------------------------------------------------
       PARAMETER
    ----------------------------------------------------- */

    const { membershipNumber: rawMembershipNumber } =
      await params;

    const membershipNumber =
      normalizeMembershipNumber(
        rawMembershipNumber,
      );

    /* -----------------------------------------------------
       VALIDATE MEMBERSHIP NUMBER
    ----------------------------------------------------- */

    if (
      !MEMBERSHIP_REGEX.test(
        membershipNumber,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid membership number.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       DATABASE
    ----------------------------------------------------- */

    const client =
      await clientPromise;

    const db = client.db(DB_NAME);

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
          error: "Member not found.",
        },
        {
          status: 404,
        },
      );
    }

    /* -----------------------------------------------------
       PROFILE IMAGE
    ----------------------------------------------------- */

    const storedImage =
      getStoredImageValue(
        member.profileImage,
      );

    if (!storedImage) {
      return new NextResponse(null, {
        status: 404,
      });
    }

    const pathname =
      resolveBlobPath(
        storedImage,
      );

    if (!pathname) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid stored profile image.",
        },
        {
          status: 500,
        },
      );
    }

    /* -----------------------------------------------------
       ETAG / CONDITIONAL REQUEST
    ----------------------------------------------------- */

    const ifNoneMatch =
      request.headers.get(
        "if-none-match",
      );

    /* -----------------------------------------------------
       GET PRIVATE BLOB
    ----------------------------------------------------- */

    const blob =
      await get(pathname, {
        access: "private",
        ifNoneMatch:
          ifNoneMatch || undefined,
      });

    /*
     * Vercel Blob may return null when the object
     * has not changed / conditional request matched.
     */
    if (!blob) {
      return new NextResponse(null, {
        status: 304,
      });
    }

    /* -----------------------------------------------------
       RESPONSE HEADERS
    ----------------------------------------------------- */

    const headers =
      new Headers();

    headers.set(
      "Content-Type",
      blob.blob.contentType ||
        PROFILE_IMAGE_CONTENT_TYPE,
    );

    if (blob.blob.size) {
      headers.set(
        "Content-Length",
        String(blob.blob.size),
      );
    }

    if (blob.blob.etag) {
      headers.set(
        "ETag",
        blob.blob.etag,
      );
    }

    /*
     * Keep the browser aware that this is a private
     * member asset.
     *
     * The frontend adds ?v=timestamp after replacement
     * to force the newly uploaded photo to display.
     */
    headers.set(
      "Cache-Control",
      "private, no-cache, must-revalidate",
    );

    headers.set(
      "X-Content-Type-Options",
      "nosniff",
    );

    /* -----------------------------------------------------
       STREAM IMAGE
    ----------------------------------------------------- */

    return new NextResponse(
      blob.stream,
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    console.error(
      "[PROFILE IMAGE GET]",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to load profile image.",
      },
      {
        status: 500,
      },
    );
  }
}

/* =========================================================
   POST
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
  let newBlobPath: string | null =
    null;

  try {
    /* -----------------------------------------------------
       PARAMETER
    ----------------------------------------------------- */

    const { membershipNumber: rawMembershipNumber } =
      await params;

    const membershipNumber =
      normalizeMembershipNumber(
        rawMembershipNumber,
      );

    /* -----------------------------------------------------
       VALIDATE MEMBERSHIP NUMBER
    ----------------------------------------------------- */

    if (
      !MEMBERSHIP_REGEX.test(
        membershipNumber,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid membership number.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       CONTENT TYPE
       
       The frontend has already normalized the image
       into JPEG.
    ----------------------------------------------------- */

    const contentType =
      normalizeContentType(
        request.headers.get(
          "content-type",
        ) || "",
      );

    if (
      contentType !==
      PROFILE_IMAGE_CONTENT_TYPE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid image format. The profile image must be uploaded as JPEG.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       READ BODY
    ----------------------------------------------------- */

    const arrayBuffer =
      await request.arrayBuffer();

    const fileSize =
      arrayBuffer.byteLength;

    /* -----------------------------------------------------
       EMPTY FILE
    ----------------------------------------------------- */

    if (fileSize === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The uploaded image is empty.",
        },
        {
          status: 400,
        },
      );
    }

    /* -----------------------------------------------------
       FILE SIZE
    ----------------------------------------------------- */

    if (
      fileSize > MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The uploaded image is too large.",
        },
        {
          status: 413,
        },
      );
    }

    /* -----------------------------------------------------
       DATABASE
    ----------------------------------------------------- */

    const client =
      await clientPromise;

    const db = client.db(DB_NAME);

    /* -----------------------------------------------------
       FIND MEMBER
    ----------------------------------------------------- */

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
              profileImage: 1,
            },
          },
        );

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

    /* -----------------------------------------------------
       OLD IMAGE
    ----------------------------------------------------- */

    const oldStoredImage =
      getStoredImageValue(
        member.profileImage,
      );

    const oldBlobPath =
      oldStoredImage
        ? resolveBlobPath(
            oldStoredImage,
          )
        : null;

    /* -----------------------------------------------------
       NEW DETERMINISTIC PATH
       
       Every member gets exactly one canonical image:
       
       members/GEO-001.jpg
       
       allowOverwrite means replacing the image does
       NOT create another permanent Blob object.
    ----------------------------------------------------- */

    newBlobPath =
      getBlobPath(
        membershipNumber,
      );

    /* -----------------------------------------------------
       UPLOAD
    ----------------------------------------------------- */

    const blob =
      await put(
        newBlobPath,
        arrayBuffer,
        {
          access: "private",

          contentType:
            PROFILE_IMAGE_CONTENT_TYPE,

          addRandomSuffix: false,

          allowOverwrite: true,

          cacheControlMaxAge: 31536000,
        },
      );

    /* -----------------------------------------------------
       UPDATE MEMBER
       
       Mongo stores the pathname rather than exposing
       the private Blob URL.
    ----------------------------------------------------- */

    try {
      await db
        .collection("members")
        .updateOne(
          {
            _id: member._id,
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
    } catch (databaseError) {
      /*
       * Mongo update failed after Blob upload.
       *
       * Clean up the newly uploaded object so we do not
       * leave an orphaned Blob.
       */
      console.error(
        "[PROFILE IMAGE DB UPDATE]",
        databaseError,
      );

      try {
        await del(newBlobPath);
      } catch (cleanupError) {
        console.error(
          "[PROFILE IMAGE CLEANUP AFTER DB FAILURE]",
          cleanupError,
        );
      }

      newBlobPath = null;

      throw databaseError;
    }

    /* -----------------------------------------------------
       DELETE LEGACY IMAGE
       
       Only delete when the old object is different from
       the new canonical path.
       
       This is particularly useful for members whose
       previous implementation stored a random/private
       Blob pathname or a full Blob URL.
    ----------------------------------------------------- */

    if (
      oldBlobPath &&
      oldBlobPath !== newBlobPath
    ) {
      try {
        await del(oldBlobPath);
      } catch (cleanupError) {
        /*
         * Do not fail the successful upload because an
         * old orphaned image could not be removed.
         *
         * Log it so it can be investigated.
         */
        console.error(
          "[PROFILE IMAGE OLD BLOB CLEANUP]",
          {
            membershipNumber,
            oldBlobPath,
            cleanupError,
          },
        );
      }
    }

    /* -----------------------------------------------------
       RESPONSE
    ----------------------------------------------------- */

    return NextResponse.json(
      {
        success: true,

        profileImage:
          blob.pathname,

        /*
         * The actual image is still served through our
         * private GET route.
         */
        profileImageUrl:
          `/api/members/photos/${encodeURIComponent(
            membershipNumber,
          )}?v=${Date.now()}`,
      },
      {
        status: 200,
      },
    );
    } catch (error) {
    console.error("[PROFILE IMAGE POST]", {
      error,
      name: error instanceof Error ? error.name : typeof error,
      message:
        error instanceof Error
          ? error.message
          : String(error),
      stack:
        error instanceof Error
          ? error.stack
          : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload profile image.",
      },
      {
        status: 500,
      },
    );
  }
}