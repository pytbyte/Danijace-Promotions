// ============================================================
// FILE: src/app/dashboard/members/MemberDeleteModal.tsx
// ============================================================

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Trash2,
  User,
  X,
} from "lucide-react";

import type { Member } from "@/lib/members/types";

type MemberDeleteModalProps = {
  member: Member | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (member: Member) => void;
};

export default function MemberDeleteModal({
  member,
  open,
  onClose,
  onSuccess,
}: MemberDeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  /* =========================================================
     MODAL GUARD
  ========================================================= */

  if (!open || !member) {
    return null;
  }

  /*
   * At this point member is guaranteed to exist.
   * Store it in a constant so TypeScript keeps the
   * non-null type inside nested functions.
   */
  const selectedMember: Member = member;

  /* =========================================================
     MEMBER DISPLAY DATA
  ========================================================= */

  const fullName = [
    selectedMember.firstName,
    selectedMember.middleName,
    selectedMember.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const initials =
    `${selectedMember.firstName?.charAt(0) || ""}${selectedMember.lastName?.charAt(0) || ""}`
      .toUpperCase();

  /* =========================================================
     DELETE MEMBER
  ========================================================= */

  async function handleDelete() {
    if (deleting) {
      return;
    }

    setError("");

    /* -------------------------------------------------------
       VALIDATE MEMBER ID
    ------------------------------------------------------- */

    if (!selectedMember._id) {
      setError(
        "This member does not have a valid ID."
      );
      return;
    }

    try {
      setDeleting(true);

      /* -----------------------------------------------------
         DELETE REQUEST
      ----------------------------------------------------- */

      const response = await fetch(
        `/api/members/${encodeURIComponent(
          selectedMember._id
        )}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
          },
        }
      );

      /* -----------------------------------------------------
         READ RESPONSE
      ----------------------------------------------------- */

      let result: {
        success: boolean;
        data?: Member;
        error?: string;
      };

      try {
        result = await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response."
        );
      }

      /* -----------------------------------------------------
         HANDLE SERVER ERROR
      ----------------------------------------------------- */

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            `Unable to delete member. Server returned ${response.status}.`
        );
      }

      /* -----------------------------------------------------
         SUCCESS
      ----------------------------------------------------- */

      onSuccess(selectedMember);
    } catch (err) {
      console.error(
        "Failed to delete member:",
        err
      );

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "Something went wrong while deleting the member."
        );
      }
    } finally {
      setDeleting(false);
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div
      className="
        fixed
        inset-0
        z-[110]
        flex
        items-end
        justify-center
        bg-black/75
        p-4
        backdrop-blur-sm
        sm:items-center
      "
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !deleting
        ) {
          onClose();
        }
      }}
    >
      <div
        className="
          w-full
          max-w-md
          overflow-hidden
          rounded-3xl
          border
          border-white/[0.08]
          bg-[#0b0b0b]
          shadow-[0_30px_100px_rgba(0,0,0,0.65)]
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          className="
            flex
            items-center
            justify-between
            border-b
            border-white/[0.08]
            px-5
            py-4
          "
        >
          <div className="flex items-center gap-3">
            <div
              className="
                flex
                h-10
                w-10
                items-center
                justify-center
                rounded-xl
                bg-red-500/10
                text-red-400
              "
            >
              <Trash2
                size={18}
                strokeWidth={1.8}
              />
            </div>

            <div>
              <h2 className="text-sm font-semibold text-white">
                Delete Member
              </h2>

              <p className="mt-0.5 text-[11px] text-white/30">
                This action cannot be undone
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="
              flex
              h-9
              w-9
              items-center
              justify-center
              rounded-xl
              text-white/35
              transition
              hover:bg-white/[0.06]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close"
          >
            <X
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* =================================================
            CONTENT
        ================================================= */}

        <div className="p-5 sm:p-6">
          {/* MEMBER */}

          <div
            className="
              flex
              items-center
              gap-3
              rounded-2xl
              border
              border-white/[0.07]
              bg-white/[0.025]
              p-4
            "
          >
            {selectedMember.profileImage ? (
              <img
                src={selectedMember.profileImage}
                alt={fullName || "Member"}
                className="
                  h-12
                  w-12
                  shrink-0
                  rounded-xl
                  object-cover
                  ring-1
                  ring-white/10
                "
              />
            ) : (
              <div
                className="
                  flex
                  h-12
                  w-12
                  shrink-0
                  items-center
                  justify-center
                  rounded-xl
                  bg-yellow-500/10
                  text-sm
                  font-semibold
                  text-yellow-400
                "
              >
                {initials || (
                  <User size={18} />
                )}
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {fullName || "Unnamed member"}
              </p>

              <p className="mt-1 truncate font-mono text-[11px] text-white/30">
                {selectedMember.membershipNumber ||
                  "No membership number"}
              </p>
            </div>
          </div>

          {/* =================================================
              WARNING
          ================================================= */}

          <div
            className="
              mt-4
              flex
              gap-3
              rounded-2xl
              border
              border-red-500/15
              bg-red-500/[0.05]
              p-4
            "
          >
            <AlertTriangle
              size={18}
              strokeWidth={1.8}
              className="mt-0.5 shrink-0 text-red-400"
            />

            <div>
              <p className="text-xs font-medium text-red-300">
                Permanently delete this member?
              </p>

              <p className="mt-1 text-[11px] leading-5 text-red-300/50">
                This will remove the member from
                MongoDB and they will no longer
                appear in the member directory.
              </p>
            </div>
          </div>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <div
              className="
                mt-4
                rounded-xl
                border
                border-red-500/15
                bg-red-500/[0.05]
                px-4
                py-3
                text-xs
                leading-5
                text-red-300
              "
            >
              {error}
            </div>
          )}
        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <div
          className="
            flex
            flex-col-reverse
            gap-2
            border-t
            border-white/[0.08]
            bg-[#0b0b0b]/95
            p-4
            sm:flex-row
            sm:justify-end
          "
        >
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="
              h-11
              rounded-xl
              border
              border-white/[0.08]
              px-5
              text-sm
              font-medium
              text-white/50
              transition
              hover:bg-white/[0.05]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="
              flex
              h-11
              items-center
              justify-center
              gap-2
              rounded-xl
              bg-red-500
              px-6
              text-sm
              font-semibold
              text-white
              transition
              hover:bg-red-400
              active:scale-[0.98]
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {deleting ? (
              <>
                <Loader2
                  size={16}
                  className="animate-spin"
                />

                Deleting...
              </>
            ) : (
              <>
                <Trash2
                  size={16}
                  strokeWidth={2}
                />

                Delete Member
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}