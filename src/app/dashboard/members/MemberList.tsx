"use client";

import {
  Camera as CameraIcon,
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

import {
  Camera,
  CameraResultType,
  CameraSource,
} from "@capacitor/camera";

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

function getFullName(
  member: Member,
): string {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(Boolean)
    .join(" ");
}

function getInitials(
  member: Member,
): string {
  const first =
    member.firstName
      ?.charAt(0)
      .toUpperCase() ?? "";

  const last =
    member.lastName
      ?.charAt(0)
      .toUpperCase() ?? "";

  return `${first}${last}` || "M";
}

function formatDate(
  value?: string,
): string {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  ).format(date);
}

function formatCurrency(
  value: number,
): string {
  return `KES ${value.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    },
  )}`;
}

/* =========================================================
   PROFILE IMAGE URL
========================================================= */

function getProfileImageUrl(
  membershipNumber?: string,
  cacheBust?: string | number,
): string | null {
  if (!membershipNumber) {
    return null;
  }

  const baseUrl =
    `/api/members/photos/${encodeURIComponent(
      membershipNumber,
    )}`;

  if (
    cacheBust === undefined
  ) {
    return baseUrl;
  }

  return `${baseUrl}?v=${encodeURIComponent(
    String(cacheBust),
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

  if (
    file.size >
    MAX_INPUT_SIZE
  ) {
    throw new Error(
      "Image must be smaller than 5 MB.",
    );
  }

  if (
    !file.type.startsWith(
      "image/",
    )
  ) {
    throw new Error(
      "Please select a valid image.",
    );
  }

  if (
    typeof createImageBitmap !==
    "function"
  ) {
    throw new Error(
      "Your browser cannot process this image. Please use a newer browser.",
    );
  }

  let bitmap: ImageBitmap;

  try {
    bitmap =
      await createImageBitmap(
        file,
      );
  } catch {
    throw new Error(
      "This image format cannot be processed on this device. Please use a JPEG or PNG photo.",
    );
  }

  try {
    const canvas =
      document.createElement(
        "canvas",
      );

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

    if (
      !sourceWidth ||
      !sourceHeight
    ) {
      throw new Error(
        "The selected image is invalid.",
      );
    }

    const sourceSize =
      Math.min(
        sourceWidth,
        sourceHeight,
      );

    const sourceX =
      (sourceWidth -
        sourceSize) /
      2;

    const sourceY =
      (sourceHeight -
        sourceSize) /
      2;

    context.fillStyle =
      "#ffffff";

    context.fillRect(
      0,
      0,
      SIZE,
      SIZE,
    );

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
      await new Promise<
        Blob | null
      >((resolve) => {
        canvas.toBlob(
          resolve,
          "image/jpeg",
          QUALITY,
        );
      });

    if (!blob) {
      throw new Error(
        "Could not create the compressed image.",
      );
    }

    if (
      blob.size === 0
    ) {
      throw new Error(
        "The compressed image is empty.",
      );
    }

    if (
      blob.size >
      1024 * 1024
    ) {
      throw new Error(
        "The processed image is too large. Please choose another photo.",
      );
    }

    return blob;
  } finally {
    bitmap.close();
  }
}

/* =========================================================
   BASE64 → FILE
========================================================= */

function base64ToFile(
  base64: string,
  fileName: string,
): File {
  const byteCharacters =
    atob(base64);

  const CHUNK_SIZE =
    1024;

  const byteArrays: number[][] =
    [];

  for (
    let offset = 0;
    offset <
    byteCharacters.length;
    offset += CHUNK_SIZE
  ) {
    const slice =
      byteCharacters.slice(
        offset,
        offset +
          CHUNK_SIZE,
      );

    const byteNumbers =
      new Array<number>(
        slice.length,
      );

    for (
      let index = 0;
      index <
      slice.length;
      index++
    ) {
      byteNumbers[index] =
        slice.charCodeAt(
          index,
        );
    }

    byteArrays.push(
      byteNumbers,
    );
  }

  const totalLength =
    byteArrays.reduce(
      (
        total,
        chunk,
      ) =>
        total +
        chunk.length,
      0,
    );

  const buffer =
    new ArrayBuffer(
      totalLength,
    );

  const view =
    new Uint8Array(
      buffer,
    );

  let offset = 0;

  for (const chunk of byteArrays) {
    view.set(
      chunk,
      offset,
    );

    offset +=
      chunk.length;
  }

  const blob =
    new Blob(
      [buffer],
      {
        type: "image/jpeg",
      },
    );

  return new File(
    [blob],
    fileName,
    {
      type: "image/jpeg",
      lastModified:
        Date.now(),
    },
  );
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
    useRef<HTMLInputElement>(
      null,
    );

  const initialImageUrl =
    member.profileImage
      ? getProfileImageUrl(
          member.membershipNumber,
        )
      : null;

  const [preview, setPreview] =
    useState<
      string | null
    >(initialImageUrl);

  const [
    uploading,
    setUploading,
  ] = useState(false);

  const [
    uploaded,
    setUploaded,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(
      null,
    );

  /* =======================================================
     UPLOAD IMAGE
  ======================================================= */

  const uploadProfileImage =
    async (
      file: File,
    ): Promise<void> => {
      let temporaryPreview:
        | string
        | null = null;

      try {
        setError(null);
        setUploaded(false);
        setUploading(true);

        temporaryPreview =
          URL.createObjectURL(
            file,
          );

        setPreview(
          temporaryPreview,
        );

        const compressed =
          await compressProfileImage(
            file,
          );

        const response =
          await fetch(
            `/api/members/photos/${encodeURIComponent(
              member.membershipNumber,
            )}`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "image/jpeg",
              },

              body: compressed,
            },
          );

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

        const uploadedUrl =
          result.profileImageUrl ||
          getProfileImageUrl(
            member.membershipNumber,
            Date.now(),
          );

        setPreview(
          uploadedUrl,
        );

        setUploaded(true);

        if (
          temporaryPreview
        ) {
          URL.revokeObjectURL(
            temporaryPreview,
          );

          temporaryPreview =
            null;
        }

        window.setTimeout(
          () => {
            setUploaded(
              false,
            );
          },
          1800,
        );
      } catch (uploadError) {
        console.error(
          "[PROFILE IMAGE UPLOAD]",
          uploadError,
        );

        setPreview(
          initialImageUrl,
        );

        setError(
          uploadError instanceof
            Error
            ? uploadError.message
            : "Failed to upload image.",
        );

        if (
          temporaryPreview
        ) {
          URL.revokeObjectURL(
            temporaryPreview,
          );

          temporaryPreview =
            null;
        }
      } finally {
        setUploading(
          false,
        );
      }
    };

  /* =======================================================
     OPEN CAMERA
  ======================================================= */

  const handleOpenCamera =
    async (): Promise<void> => {
      if (uploading) {
        return;
      }

      setError(null);
      setUploaded(false);

      try {
        let permissions =
          await Camera.checkPermissions();

        let cameraPermission =
          permissions.camera;

        if (
          cameraPermission !==
          "granted"
        ) {
          permissions =
            await Camera.requestPermissions(
              {
                permissions: [
                  "camera",
                ],
              },
            );

          cameraPermission =
            permissions.camera;
        }

        if (
          cameraPermission !==
          "granted"
        ) {
          throw new Error(
            "Camera permission was not granted. Please allow camera access in your device settings.",
          );
        }

        const photo =
          await Camera.getPhoto(
            {
              source:
                CameraSource.Camera,

              resultType:
                CameraResultType.Base64,

              quality: 90,

              width: 1600,

              height: 1600,

              correctOrientation:
                true,

              allowEditing:
                false,
            },
          );

        if (
          !photo.base64String
        ) {
          throw new Error(
            "The camera did not return an image.",
          );
        }

        const file =
          base64ToFile(
            photo.base64String,
            `${member.membershipNumber}.jpg`,
          );

        await uploadProfileImage(
          file,
        );
      } catch (cameraError) {
        console.error(
          "[PROFILE CAMERA]",
          cameraError,
        );

        const message =
          cameraError instanceof
          Error
            ? cameraError.message
            : String(
                cameraError,
              );

        const normalized =
          message.toLowerCase();

        if (
          normalized.includes(
            "cancel",
          ) ||
          normalized.includes(
            "dismiss",
          ) ||
          normalized.includes(
            "user cancelled",
          )
        ) {
          return;
        }

        setError(
          message ||
            "Unable to open the camera.",
        );
      }
    };

  /* =======================================================
     OPEN GALLERY
  ======================================================= */

  const handleSelectFromGallery =
    () => {
      if (uploading) {
        return;
      }

      setError(null);
      setUploaded(false);

      inputRef.current?.click();
    };

  /* =======================================================
     IMAGE SELECTION
  ======================================================= */

  const handleImageChange =
    async (
      event: ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
      const file =
        event.target.files?.[0];

      event.target.value =
        "";

      if (!file) {
        return;
      }

      await uploadProfileImage(
        file,
      );
    };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="relative shrink-0">
      {/* =================================================
          HIDDEN GALLERY INPUT
      ================================================= */}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={
          handleImageChange
        }
        className="hidden"
      />

      {/* =================================================
          PROFILE PHOTO
      ================================================= */}

      <button
        type="button"
        onClick={
          handleOpenCamera
        }
        disabled={uploading}
        aria-label={
          uploading
            ? "Uploading profile photo"
            : `Take profile photo for ${fullName}`
        }
        className="
          group
          relative
          flex
          h-20
          w-20
          items-center
          justify-center
          overflow-hidden
          rounded-2xl
          border
          border-slate-200
          bg-slate-100
          shadow-sm
          transition
          active:scale-95
          disabled:cursor-not-allowed
          disabled:opacity-80
        "
      >
        {preview ? (
          <img
            src={preview}
            alt={`${fullName} profile`}
            className="
              h-full
              w-full
              object-cover
            "
            onError={() => {
              setPreview(
                null,
              );
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
              bg-gradient-to-br
              from-blue-100
              to-slate-100
              text-lg
              font-semibold
              text-blue-700
            "
          >
            {getInitials(
              member,
            )}
          </div>
        )}

        {/* =================================================
            UPLOADING
        ================================================= */}

        {uploading && (
          <div
            className="
              absolute
              inset-0
              flex
              items-center
              justify-center
              bg-black/55
              backdrop-blur-[2px]
            "
          >
            <Loader2
              className="
                h-6
                w-6
                animate-spin
                text-white
              "
            />
          </div>
        )}

        {/* =================================================
            SUCCESS
        ================================================= */}

        {!uploading &&
          uploaded && (
            <div
              className="
                absolute
                inset-0
                flex
                items-center
                justify-center
                bg-emerald-600/75
              "
            >
              <Check
                className="
                  h-7
                  w-7
                  text-white
                "
              />
            </div>
          )}

        {/* =================================================
            CAMERA INDICATOR
        ================================================= */}

        {!uploading &&
          !uploaded && (
            <span
              className="
                absolute
                bottom-1
                right-1
                flex
                h-7
                w-7
                items-center
                justify-center
                rounded-full
                border
                border-white/30
                bg-black/65
                text-white
                shadow-lg
              "
            >
              <CameraIcon
                className="
                  h-3.5
                  w-3.5
                "
              />
            </span>
          )}
      </button>

      {/* =================================================
          ERROR
      ================================================= */}

      {error && (
        <div
          className="
            absolute
            left-0
            top-[calc(100%+6px)]
            z-20
            w-60
            rounded-lg
            bg-red-50
            px-2
            py-1.5
            text-[10px]
            font-medium
            leading-tight
            text-red-600
          "
        >
          {error}
        </div>
      )}
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
  const config = {
    active: {
      label: "Active",
      badge:
        "bg-emerald-50 text-emerald-700",
      dot: "bg-emerald-500",
    },

    inactive: {
      label: "Inactive",
      badge:
        "bg-slate-100 text-slate-600",
      dot: "bg-slate-400",
    },

    suspended: {
      label: "Suspended",
      badge:
        "bg-amber-50 text-amber-700",
      dot: "bg-amber-500",
    },
  } satisfies Record<
    Member["status"],
    {
      label: string;
      badge: string;
      dot: string;
    }
  >;

  const item =
    config[status];

  return (
    <span
      className={`
        inline-flex
        items-center
        gap-1.5
        rounded-full
        px-2
        py-1
        text-[10px]
        font-semibold
        ${item.badge}
      `}
    >
      <span
        className={`
          h-1.5
          w-1.5
          rounded-full
          ${item.dot}
        `}
      />

      {item.label}
    </span>
  );
}

/* =========================================================
   MEMBER CARD
========================================================= */

function MemberCard({
  member,
  onView,
  onEdit,
  onDelete,
}: {
  member: MemberWithFinancialSummary;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const fullName =
    getFullName(member);

  const financial =
    member.financialSummary;

  const savingsBalance =
    Number(
      financial?.savingsBalance ??
        0,
    );

  const totalDeposits =
    Number(
      financial?.totalDeposits ??
        0,
    );

  const totalWithdrawals =
    Number(
      financial?.totalWithdrawals ??
        0,
    );

  const loan =
    financial?.loan;

  const loanOutstanding =
    Number(
      loan?.outstandingBalance ??
        0,
    );

  return (
    <article
      className="
        relative
        flex
        h-[420px]
        w-[300px]
        shrink-0
        snap-center
        flex-col
        overflow-hidden
        rounded-3xl
        border
        border-slate-200
        bg-white
        p-4
        shadow-[0_10px_40px_rgba(15,23,42,0.07)]
      "
    >
      {/* ===================================================
          HEADER
      =================================================== */}

      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div
          className="
            flex
            min-w-0
            items-center
            gap-3
          "
        >
          <ProfileImage
            member={member}
            fullName={fullName}
          />

          <div className="min-w-0">
            <h3
              className="
                truncate
                text-sm
                font-bold
                text-black
              "
            >
              {fullName ||
                "Unnamed member"}
            </h3>

            <p
              className="
                mt-0.5
                text-[11px]
                font-medium
                text-black/50
              "
            >
              {
                member.membershipNumber
              }
            </p>

            <div className="mt-1.5">
              <StatusBadge
                status={
                  member.status
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================
          PRIMARY FINANCIAL SUMMARY
      =================================================== */}

      <div
        className="
          mt-5
          grid
          grid-cols-2
          gap-2
        "
      >
        {/* SAVINGS */}

        <div
          className="
            rounded-2xl
            bg-emerald-50
            p-3
          "
        >
          <p
            className="
              text-[10px]
              font-medium
              text-black/50
            "
          >
            Savings
          </p>

          <p
            className="
              mt-1
              truncate
              text-base
              font-bold
              text-black
            "
          >
            {formatCurrency(
              savingsBalance,
            )}
          </p>
        </div>

        {/* LOAN */}

        <div
          className="
            rounded-2xl
            bg-amber-50
            p-3
          "
        >
          <p
            className="
              text-[10px]
              font-medium
              text-black/50
            "
          >
            Loan balance
          </p>

          <p
            className="
              mt-1
              truncate
              text-base
              font-bold
              text-black
            "
          >
            {loan
              ? formatCurrency(
                  loanOutstanding,
                )
              : "No loan"}
          </p>
        </div>
      </div>

      {/* ===================================================
          FINANCIAL ACTIVITY
      =================================================== */}

      <div
        className="
          mt-3
          grid
          grid-cols-2
          gap-2
        "
      >
        {/* DEPOSITS */}

        <div
          className="
            rounded-2xl
            bg-slate-50
            p-3
          "
        >
          <p
            className="
              text-[10px]
              font-medium
              text-black/50
            "
          >
            Deposits
          </p>

          <p
            className="
              mt-1
              truncate
              text-xs
              font-bold
              text-black
            "
          >
            {formatCurrency(
              totalDeposits,
            )}
          </p>
        </div>

        {/* WITHDRAWALS */}

        <div
          className="
            rounded-2xl
            bg-slate-50
            p-3
          "
        >
          <p
            className="
              text-[10px]
              font-medium
              text-black/50
            "
          >
            Withdrawals
          </p>

          <p
            className="
              mt-1
              truncate
              text-xs
              font-bold
              text-black
            "
          >
            {formatCurrency(
              totalWithdrawals,
            )}
          </p>
        </div>
      </div>

      {/* ===================================================
          MEMBER DETAILS
      =================================================== */}

      <div
        className="
          mt-4
          flex-1
          space-y-3
        "
      >
        {/* PHONE */}

        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <span
            className="
              text-xs
              text-black/50
            "
          >
            Phone
          </span>

          <span
            className="
              max-w-[165px]
              truncate
              text-xs
              font-semibold
              text-black
            "
          >
            {member.phone ||
              "—"}
          </span>
        </div>

        {/* GENDER */}

        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <span
            className="
              text-xs
              text-black/50
            "
          >
            Gender
          </span>

          <span
            className="
              text-xs
              font-semibold
              capitalize
              text-black
            "
          >
            {member.gender ||
              "—"}
          </span>
        </div>

        {/* JOINED */}

        <div
          className="
            flex
            items-center
            justify-between
            gap-3
          "
        >
          <span
            className="
              text-xs
              text-black/50
            "
          >
            Joined
          </span>

          <span
            className="
              text-xs
              font-semibold
              text-black
            "
          >
            {formatDate(
              member.joinDate,
            )}
          </span>
        </div>

        {/* ACTIVE LOAN */}

        {loan && (
          <div
            className="
              flex
              items-center
              justify-between
              gap-3
              rounded-xl
              bg-amber-50
              px-3
              py-2
            "
          >
            <span
              className="
                text-[10px]
                font-medium
                text-black/50
              "
            >
              Loan
            </span>

            <span
              className="
                max-w-[150px]
                truncate
                text-[10px]
                font-semibold
                text-black
              "
            >
              {
                loan.loanNumber
              }
              {" · "}
              {loan.status}
            </span>
          </div>
        )}
      </div>

      {/* ===================================================
          ACTIONS
      =================================================== */}

      <div
        className="
          mt-auto
          grid
          grid-cols-3
          gap-2
        "
      >
        <button
          type="button"
          onClick={
            onView
          }
          className="
            flex
            h-10
            items-center
            justify-center
            gap-1.5
            rounded-xl
            bg-slate-100
            text-xs
            font-semibold
            text-black
            transition
            hover:bg-slate-200
            active:scale-[0.98]
          "
        >
          <Eye className="h-4 w-4" />
          View
        </button>

        <button
          type="button"
          onClick={
            onEdit
          }
          className="
            flex
            h-10
            items-center
            justify-center
            gap-1.5
            rounded-xl
            bg-blue-50
            text-xs
            font-semibold
            text-blue-700
            transition
            hover:bg-blue-100
            active:scale-[0.98]
          "
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>

        <button
          type="button"
          onClick={
            onDelete
          }
          className="
            flex
            h-10
            items-center
            justify-center
            gap-1.5
            rounded-xl
            bg-red-50
            text-xs
            font-semibold
            text-red-700
            transition
            hover:bg-red-100
            active:scale-[0.98]
          "
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   MEMBER LIST
========================================================= */

export default function MemberList({
  members,
  onView,
  onEdit,
  onDelete,
}: MemberListProps) {
  if (
    !members.length
  ) {
    return (
      <div
        className="
          flex
          min-h-[300px]
          items-center
          justify-center
          rounded-3xl
          border
          border-dashed
          border-slate-200
          bg-white
          px-6
          text-center
        "
      >
        <div>
          <div
            className="
              mx-auto
              flex
              h-12
              w-12
              items-center
              justify-center
              rounded-2xl
              bg-slate-100
            "
          >
            <UserRound
              className="
                h-5
                w-5
                text-slate-500
              "
            />
          </div>

          <p
            className="
              mt-3
              text-sm
              font-semibold
              text-black
            "
          >
            No members found
          </p>

          <p
            className="
              mt-1
              text-xs
              text-black/50
            "
          >
            Members will appear
            here once they are
            registered.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ===================================================
          MOBILE CAROUSEL
      =================================================== */}

      <div
        className="
          flex
          gap-4
          overflow-x-auto
          overscroll-x-contain
          px-1
          pb-5
          snap-x
          snap-mandatory
          [-ms-overflow-style:none]
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
          lg:hidden
        "
      >
        {members.map(
          (member) => (
            <MemberCard
              key={
                member.membershipNumber ||
                member._id
              }
              member={
                member
              }
              onView={() =>
                onView?.(
                  member,
                )
              }
              onEdit={() =>
                onEdit?.(
                  member,
                )
              }
              onDelete={() =>
                onDelete?.(
                  member,
                )
              }
            />
          ),
        )}
      </div>
    </>
  );
}