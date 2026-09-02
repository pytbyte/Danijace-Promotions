"use client";

import {
  Camera,
  Check,
  Eye,
  Loader2,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  type ChangeEvent,
  useRef,
  useState,
} from "react";

import type {
  Member,
  MemberWithFinancialSummary,
} from "@/lib/members/types";

/* =========================================================
   TYPES
========================================================= */

type MemberListProps = {
  members: MemberWithFinancialSummary[];

  onView?: (
    member: MemberWithFinancialSummary,
  ) => void;

  onEdit?: (
    member: MemberWithFinancialSummary,
  ) => void;

  onDelete?: (
    member: MemberWithFinancialSummary,
  ) => void;
};

/* =========================================================
   HELPERS
========================================================= */

function getFullName(member: Member) {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(Boolean)
    .join(" ");
}

function getInitials(member: Member) {
  const first =
    member.firstName?.charAt(0).toUpperCase() ??
    "";

  const last =
    member.lastName?.charAt(0).toUpperCase() ??
    "";

  return `${first}${last}` || "M";
}

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/* =========================================================
   IMAGE URL
========================================================= */

/**
 * Private Vercel Blob images must be requested through
 * our authenticated API route.
 *
 * MongoDB now stores:
 *
 * members/GEO-001.webp
 *
 * The browser should request:
 *
 * /api/members/photos/GEO-001
 */
function getProfileImageUrl(
  membershipNumber?: string,
) {
  if (!membershipNumber) {
    return null;
  }

  return `/api/members/photos/${encodeURIComponent(
    membershipNumber,
  )}`;
}

/* =========================================================
   IMAGE COMPRESSION
========================================================= */

async function compressProfileImage(
  file: File,
): Promise<Blob> {
  const MAX_INPUT_SIZE =
    5 * 1024 * 1024;

  const SIZE = 512;

  const QUALITY = 0.78;

  if (file.size > MAX_INPUT_SIZE) {
    throw new Error(
      "Image must be smaller than 5 MB.",
    );
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(
      "Please select a valid image.",
    );
  }

  if (
    typeof createImageBitmap !== "function"
  ) {
    throw new Error(
      "Your browser cannot process this image.",
    );
  }

  const bitmap =
    await createImageBitmap(file);

  try {
    const canvas =
      document.createElement("canvas");

    canvas.width = SIZE;
    canvas.height = SIZE;

    const context =
      canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "Could not process the image.",
      );
    }

    const sourceWidth =
      bitmap.width;

    const sourceHeight =
      bitmap.height;

    const sourceSize =
      Math.min(
        sourceWidth,
        sourceHeight,
      );

    const sourceX =
      (sourceWidth - sourceSize) /
      2;

    const sourceY =
      (sourceHeight - sourceSize) /
      2;

    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      SIZE,
      SIZE,
    );

    const blob =
      await new Promise<Blob | null>(
        (resolve) => {
          canvas.toBlob(
            resolve,
            "image/webp",
            QUALITY,
          );
        },
      );

    if (!blob) {
      throw new Error(
        "Could not create the compressed image.",
      );
    }

    return blob;
  } finally {
    bitmap.close();
  }
}

/* =========================================================
   PROFILE IMAGE
========================================================= */

function ProfileImage({
  member,
  fullName,
}: {
  member: Member;
  fullName: string;
}) {
  const inputRef =
    useRef<HTMLInputElement>(null);

  /*
   * Important:
   *
   * member.profileImage is now a private Blob pathname,
   * NOT a browser-accessible URL.
   *
   * Therefore we construct our API URL from the
   * membership number.
   */
  const initialImageUrl =
    member.profileImage
      ? getProfileImageUrl(
          member.membershipNumber,
        )
      : null;

  const [preview, setPreview] =
    useState<string | null>(
      initialImageUrl,
    );

  const [uploading, setUploading] =
    useState(false);

  const [uploaded, setUploaded] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  /* -------------------------------------------------------
     Select image
  ------------------------------------------------------- */

  const handleSelectImage = () => {
    if (uploading) {
      return;
    }

    setError(null);
    setUploaded(false);

    inputRef.current?.click();
  };

  /* -------------------------------------------------------
     Upload image
  ------------------------------------------------------- */

  const handleImageChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file =
      event.target.files?.[0];

    /*
     * Allow selecting the same file again.
     */
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setUploaded(false);
    setUploading(true);

    let temporaryPreview:
      | string
      | null = null;

    try {
      /* ---------------------------------------------------
         Show local preview immediately
      --------------------------------------------------- */

      temporaryPreview =
        URL.createObjectURL(file);

      setPreview(
        temporaryPreview,
      );

      /* ---------------------------------------------------
         Compress image
      --------------------------------------------------- */

      const compressed =
        await compressProfileImage(
          file,
        );

      /* ---------------------------------------------------
         Prepare upload
      --------------------------------------------------- */

      const formData =
        new FormData();

      formData.append(
        "image",
        compressed,
        `${member.membershipNumber}.webp`,
      );

      /* ---------------------------------------------------
         Upload
      --------------------------------------------------- */

      const response =
        await fetch(
          `/api/members/photos/${encodeURIComponent(
            member.membershipNumber,
          )}`,
          {
            method: "POST",
            body: formData,
          },
        );

      /* ---------------------------------------------------
         Parse response
      --------------------------------------------------- */

      let result: {
        success?: boolean;
        error?: string;
        profileImage?: string;
        profileImageUrl?: string;
      };

      try {
        result =
          await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response.",
        );
      }

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ||
            "Failed to upload profile image.",
        );
      }

      /* ---------------------------------------------------
         Use API image URL returned by server
      --------------------------------------------------- */

      const uploadedUrl =
        result.profileImageUrl ||
        getProfileImageUrl(
          member.membershipNumber,
        );

      setPreview(
        uploadedUrl,
      );

      setUploaded(true);

      /* ---------------------------------------------------
         Release temporary object URL
      --------------------------------------------------- */

      if (temporaryPreview) {
        URL.revokeObjectURL(
          temporaryPreview,
        );

        temporaryPreview = null;
      }

      /* ---------------------------------------------------
         Remove success overlay
      --------------------------------------------------- */

      window.setTimeout(() => {
        setUploaded(false);
      }, 1800);
    } catch (uploadError) {
      console.error(
        "[PROFILE IMAGE UPLOAD]",
        uploadError,
      );

      /* ---------------------------------------------------
         Restore existing image
      --------------------------------------------------- */

      setPreview(
        initialImageUrl,
      );

      setError(
        uploadError instanceof
          Error
          ? uploadError.message
          : "Failed to upload image.",
      );

      if (temporaryPreview) {
        URL.revokeObjectURL(
          temporaryPreview,
        );

        temporaryPreview = null;
      }
    } finally {
      setUploading(false);
    }
  };

  /* -------------------------------------------------------
     Render
  ------------------------------------------------------- */

  return (
    <div className="relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        className="hidden"
      />

      <button
        type="button"
        onClick={handleSelectImage}
        disabled={uploading}
        aria-label={`Change profile photo for ${fullName}`}
        title="Change profile photo"
        className="
          group
          relative
          h-14
          w-14
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.10]
          bg-white/[0.04]
          shadow-lg
          transition
          duration-200
          hover:border-white/[0.18]
          hover:bg-white/[0.07]
          active:scale-95
          disabled:cursor-wait
        "
      >
        {/* -------------------------------------------------
            IMAGE / INITIALS
        ------------------------------------------------- */}

        {preview ? (
          <img
            src={preview}
            alt={fullName}
            className="
              h-full
              w-full
              object-cover
            "
            onError={() => {
              setPreview(null);
            }}
          />
        ) : (
          <div
            className="
              flex
              h-full
              w-full
              items-center
              justify-center
              bg-yellow-500/[0.08]
              text-sm
              font-semibold
              tracking-wide
              text-yellow-400
            "
          >
            {getInitials(member)}
          </div>
        )}

        {/* -------------------------------------------------
            HOVER CAMERA
        ------------------------------------------------- */}

        {!uploading &&
          !uploaded && (
            <div
              className="
                absolute
                inset-0
                flex
                items-center
                justify-center
                bg-black/50
                opacity-0
                transition
                duration-200
                group-hover:opacity-100
              "
            >
              <Camera
                size={18}
                strokeWidth={1.8}
                className="text-white"
              />
            </div>
          )}

        {/* -------------------------------------------------
            UPLOADING
        ------------------------------------------------- */}

        {uploading && (
          <div
            className="
              absolute
              inset-0
              flex
              items-center
              justify-center
              bg-black/65
              backdrop-blur-[2px]
            "
          >
            <Loader2
              size={20}
              className="
                animate-spin
                text-white
              "
            />
          </div>
        )}

        {/* -------------------------------------------------
            SUCCESS
        ------------------------------------------------- */}

        {uploaded &&
          !uploading && (
            <div
              className="
                absolute
                inset-0
                flex
                items-center
                justify-center
                bg-emerald-500/75
              "
            >
              <Check
                size={22}
                strokeWidth={3}
                className="text-white"
              />
            </div>
          )}
      </button>

      {/* ---------------------------------------------------
          ERROR
      --------------------------------------------------- */}

      {error && (
        <div
          className="
            absolute
            left-0
            top-[calc(100%+0.5rem)]
            z-50
            w-56
            rounded-xl
            border
            border-red-400/20
            bg-red-950/95
            px-3
            py-2
            text-[11px]
            leading-relaxed
            text-red-100
            shadow-xl
          "
        >
          {error}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   MAIN MEMBER LIST
========================================================= */

export default function MemberList({
  members,
  onView,
  onEdit,
  onDelete,
}: MemberListProps) {
  /* -------------------------------------------------------
     Empty state
  ------------------------------------------------------- */

  if (members.length === 0) {
    return (
      <div
        className="
          flex
          min-h-[280px]
          items-center
          justify-center
          rounded-2xl
          border
          border-white/[0.08]
          bg-white/[0.025]
          p-6
          lg:hidden
        "
      >
        <div className="text-center">
          <div
            className="
              mx-auto
              flex
              h-12
              w-12
              items-center
              justify-center
              rounded-2xl
              border
              border-white/[0.08]
              bg-white/[0.03]
              text-white/25
            "
          >
            <UserRound
              size={21}
              strokeWidth={1.5}
            />
          </div>

          <p
            className="
              mt-4
              text-sm
              font-medium
              text-white/50
            "
          >
            No members found
          </p>

          <p
            className="
              mx-auto
              mt-2
              max-w-xs
              text-xs
              leading-5
              text-white/25
            "
          >
            Members matching your
            search will appear here.
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------
     Member list
  ------------------------------------------------------- */

  return (
    <div className="space-y-3 lg:hidden">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div
        className="
          flex
          items-center
          justify-between
          px-1
        "
      >
        <div>
          <h2
            className="
              text-sm
              font-semibold
              text-white
            "
          >
            Members
          </h2>

          <p
            className="
              mt-1
              text-xs
              text-white/30
            "
          >
            {members.length.toLocaleString()}{" "}
            {members.length === 1
              ? "member"
              : "members"}
          </p>
        </div>

        {members.length > 1 && (
          <div
            className="
              flex
              items-center
              gap-1.5
              text-[10px]
              text-white/25
            "
          >
            <span>Swipe</span>

            <span className="text-white/40">
              →
            </span>
          </div>
        )}
      </div>

      {/* =====================================================
          MOBILE CAROUSEL
      ===================================================== */}

      <div
        className="
          -mx-1
          overflow-x-auto
          overflow-y-hidden
          px-1
          pb-2
          [scrollbar-width:none]
          [-ms-overflow-style:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        <div
          className="
            flex
            w-max
            snap-x
            snap-mandatory
            gap-3
          "
        >
          {members.map(
            (member) => {
              const fullName =
                getFullName(
                  member,
                );

              return (
                <div
                  key={
                    member._id ||
                    member.membershipNumber
                  }
                  className="
                    w-[calc(100vw-56px)]
                    max-w-[390px]
                    shrink-0
                    snap-center
                  "
                >
                  <MemberCard
                    member={member}
                    fullName={fullName}
                    onView={onView}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </div>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   MEMBER CARD
========================================================= */

function MemberCard({
  member,
  fullName,
  onView,
  onEdit,
  onDelete,
}: {
  member: MemberWithFinancialSummary;

  fullName: string;

  onView?: (
    member: MemberWithFinancialSummary,
  ) => void;

  onEdit?: (
    member: MemberWithFinancialSummary,
  ) => void;

  onDelete?: (
    member: MemberWithFinancialSummary,
  ) => void;
}) {
  return (
    <article
      className="
        flex
        h-[300px]
        flex-col
        overflow-visible
        rounded-2xl
        border
        border-white/[0.08]
        bg-[#101716]
        text-white
        shadow-xl
      "
    >
      {/* =====================================================
          MEMBER HEADER
      ===================================================== */}

      <div
        className="
          flex
          items-center
          gap-3.5
          p-4
        "
      >
        <ProfileImage
          member={member}
          fullName={
            fullName ||
            "Unnamed member"
          }
        />

        <div
          className="
            min-w-0
            flex-1
          "
        >
          <div
            className="
              flex
              items-start
              justify-between
              gap-3
            "
          >
            <div className="min-w-0">
              <h3
                className="
                  truncate
                  text-sm
                  font-semibold
                  text-white
                "
              >
                {fullName ||
                  "Unnamed member"}
              </h3>

              <p
                className="
                  mt-1
                  truncate
                  text-[11px]
                  font-medium
                  tracking-wide
                  text-white/30
                "
              >
                {member.membershipNumber ||
                  "—"}
              </p>
            </div>

            <StatusBadge
              status={member.status}
            />
          </div>
        </div>
      </div>

      {/* =====================================================
          MEMBER DETAILS
      ===================================================== */}

      <div
        className="
          grid
          flex-1
          grid-cols-2
          gap-px
          border-t
          border-white/[0.07]
          bg-white/[0.05]
        "
      >
        <MemberDetail
          label="Phone"
          value={member.phone}
        />

        <MemberDetail
          label="Email"
          value={member.email}
        />

        <MemberDetail
          label="Joined"
          value={formatDate(
            member.joinDate,
          )}
        />

        <MemberDetail
          label="County"
          value={member.county}
        />
      </div>

      {/* =====================================================
          ACTIONS
      ===================================================== */}

      <div
        className="
          flex
          items-center
          gap-2
          border-t
          border-white/[0.07]
          p-3
        "
      >
        {/* VIEW */}

        <button
          type="button"
          onClick={() =>
            onView?.(member)
          }
          disabled={!onView}
          className="
            flex
            h-10
            flex-1
            items-center
            justify-center
            gap-2
            rounded-xl
            bg-white/[0.04]
            text-xs
            font-medium
            text-white/50
            transition
            hover:bg-white/[0.08]
            hover:text-white
            active:scale-[0.98]
            disabled:cursor-default
            disabled:hover:bg-white/[0.04]
            disabled:hover:text-white/50
          "
        >
          <Eye
            size={16}
            strokeWidth={1.8}
          />

          <span>View</span>
        </button>

        {/* EDIT */}

        <button
          type="button"
          onClick={() =>
            onEdit?.(member)
          }
          disabled={!onEdit}
          className="
            flex
            h-10
            flex-1
            items-center
            justify-center
            gap-2
            rounded-xl
            bg-yellow-500/[0.06]
            text-xs
            font-medium
            text-yellow-400/70
            transition
            hover:bg-yellow-500/10
            hover:text-yellow-400
            active:scale-[0.98]
            disabled:cursor-default
            disabled:hover:bg-yellow-500/[0.06]
            disabled:hover:text-yellow-400/70
          "
        >
          <Pencil
            size={16}
            strokeWidth={1.8}
          />

          <span>Edit</span>
        </button>

        {/* DELETE */}

        <button
          type="button"
          onClick={() =>
            onDelete?.(member)
          }
          disabled={!onDelete}
          aria-label={`Delete ${
            fullName ||
            "member"
          }`}
          title="Delete member"
          className="
            flex
            h-10
            w-10
            shrink-0
            items-center
            justify-center
            rounded-xl
            bg-red-500/[0.05]
            text-red-400/60
            transition
            hover:bg-red-500/10
            hover:text-red-400
            active:scale-[0.96]
            disabled:cursor-default
            disabled:hover:bg-red-500/[0.05]
            disabled:hover:text-red-400/60
          "
        >
          <Trash2
            size={16}
            strokeWidth={1.8}
          />
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   MEMBER DETAIL
========================================================= */

function MemberDetail({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div
      className="
        bg-[#0b0b0b]
        px-4
        py-3
      "
    >
      <p
        className="
          text-[9px]
          font-medium
          uppercase
          tracking-[0.14em]
          text-white/25
        "
      >
        {label}
      </p>

      <p
        className="
          mt-1.5
          truncate
          text-xs
          text-white/60
        "
      >
        {value || "—"}
      </p>
    </div>
  );
}

/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({
  status,
}: {
  status: Member["status"];
}) {
  const styles: Record<
    Member["status"],
    string
  > = {
    active:
      "bg-emerald-500/10 text-emerald-400 ring-emerald-500/10",

    inactive:
      "bg-white/[0.06] text-white/45 ring-white/[0.06]",

    suspended:
      "bg-red-500/10 text-red-400 ring-red-500/10",
  };

  const labels: Record<
    Member["status"],
    string
  > = {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
  };

  const dots: Record<
    Member["status"],
    string
  > = {
    active:
      "bg-emerald-400",

    inactive:
      "bg-white/30",

    suspended:
      "bg-red-400",
  };

  return (
    <span
      className={`
        inline-flex
        shrink-0
        items-center
        rounded-lg
        px-2
        py-1
        text-[9px]
        font-medium
        ring-1
        ${styles[status]}
      `}
    >
      <span
        className={`
          mr-1.5
          h-1.5
          w-1.5
          rounded-full
          ${dots[status]}
        `}
      />

      {labels[status]}
    </span>
  );
}