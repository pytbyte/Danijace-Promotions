"use client";

import {
  X,
  UserRound,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  CalendarDays,
  VenusAndMars,
  Pencil,
  Trash2,
} from "lucide-react";

import type { Member } from "@/lib/members/types";

type MemberViewModalProps = {
  member: Member | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (member: Member) => void;
  onDelete?: (member: Member) => void;
};

export default function MemberViewModal({
  member,
  open,
  onClose,
  onEdit,
  onDelete,
}: MemberViewModalProps) {
  if (!open || !member) {
    return null;
  }

  const fullName = [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  if (!open || !member) {
  return null;
}

const currentMember = member;

function handleEdit() {
  onClose();
  onEdit?.(currentMember);
}

function handleDelete() {
  onDelete?.(currentMember);
}

  return (
    <div
      className="
        fixed
        inset-0
        z-50
        flex
        items-center
        justify-center
        bg-black/70
        p-4
        backdrop-blur-sm
      "
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="
          flex
          max-h-[90vh]
          w-full
          max-w-2xl
          flex-col
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.08]
          bg-[#0b0b0b]
          shadow-2xl
        "
      >
        {/* =====================================================
            HEADER
        ===================================================== */}

        <div
          className="
            flex
            shrink-0
            items-center
            justify-between
            border-b
            border-white/[0.07]
            px-5
            py-4
          "
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">
              Member Details
            </h2>

            <p className="mt-1 text-xs text-white/30">
              View member information
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              text-white/35
              transition
              hover:bg-white/[0.06]
              hover:text-white
            "
            aria-label="Close member details"
            title="Close"
          >
            <X
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* =====================================================
            MEMBER PROFILE
        ===================================================== */}

        <div
          className="
            flex
            shrink-0
            items-center
            gap-4
            border-b
            border-white/[0.07]
            px-5
            py-5
          "
        >
          {member.profileImage ? (
            <img
              src={member.profileImage}
              alt={fullName || "Member"}
              className="
                h-16
                w-16
                shrink-0
                rounded-2xl
                object-cover
                ring-1
                ring-white/10
              "
            />
          ) : (
            <div
              className="
                flex
                h-16
                w-16
                shrink-0
                items-center
                justify-center
                rounded-2xl
                bg-yellow-500/10
                text-lg
                font-semibold
                text-yellow-400
              "
            >
              {member.firstName?.charAt(0).toUpperCase() || ""}
              {member.lastName?.charAt(0).toUpperCase() || ""}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-white">
              {fullName || "Unnamed member"}
            </h3>

            <p className="mt-1 truncate font-mono text-xs text-white/35">
              {member.membershipNumber || "No membership number"}
            </p>

            <div className="mt-2">
              <StatusBadge status={member.status} />
            </div>
          </div>
        </div>

        {/* =====================================================
            DETAILS
        ===================================================== */}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            {/* ---------------------------------------------
                PERSONAL INFORMATION
            --------------------------------------------- */}

            <section>
              <SectionTitle title="Personal Information" />

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem
                  icon={<UserRound size={15} />}
                  label="First Name"
                  value={member.firstName}
                />

                <DetailItem
                  icon={<UserRound size={15} />}
                  label="Middle Name"
                  value={member.middleName}
                />

                <DetailItem
                  icon={<UserRound size={15} />}
                  label="Last Name"
                  value={member.lastName}
                />

                <DetailItem
                  icon={<VenusAndMars size={15} />}
                  label="Gender"
                  value={member.gender}
                />

                <DetailItem
                  icon={<CalendarDays size={15} />}
                  label="Join Date"
                  value={formatDate(member.joinDate)}
                />

                <DetailItem
                  icon={<CreditCard size={15} />}
                  label="National ID"
                  value={member.nationalId}
                />
              </div>
            </section>

            {/* ---------------------------------------------
                CONTACT INFORMATION
            --------------------------------------------- */}

            <section>
              <SectionTitle title="Contact Information" />

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem
                  icon={<Phone size={15} />}
                  label="Phone"
                  value={member.phone}
                />

                <DetailItem
                  icon={<Mail size={15} />}
                  label="Email"
                  value={member.email}
                />

                <DetailItem
                  icon={<MapPin size={15} />}
                  label="Address"
                  value={member.address}
                />

                <DetailItem
                  icon={<MapPin size={15} />}
                  label="City"
                  value={member.city}
                />

                <DetailItem
                  icon={<MapPin size={15} />}
                  label="County"
                  value={member.county}
                />
              </div>
            </section>

            {/* ---------------------------------------------
                MEMBERSHIP INFORMATION
            --------------------------------------------- */}

            <section>
              <SectionTitle title="Membership Information" />

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem
                  icon={<CreditCard size={15} />}
                  label="Membership No."
                  value={member.membershipNumber}
                />

                <DetailItem
                  icon={<CalendarDays size={15} />}
                  label="Join Date"
                  value={formatDate(member.joinDate)}
                />

                <DetailItem
                  icon={<UserRound size={15} />}
                  label="Occupation"
                  value={member.occupation}
                />

                <DetailItem
                  icon={<UserRound size={15} />}
                  label="Status"
                  value={formatStatus(member.status)}
                />
              </div>
            </section>

            {/* ---------------------------------------------
                NEXT OF KIN
            --------------------------------------------- */}

            {(member.nextOfKinName ||
              member.nextOfKinPhone ||
              member.nextOfKinRelationship) && (
              <section>
                <SectionTitle title="Next of Kin" />

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <DetailItem
                    icon={<UserRound size={15} />}
                    label="Name"
                    value={member.nextOfKinName}
                  />

                  <DetailItem
                    icon={<Phone size={15} />}
                    label="Phone"
                    value={member.nextOfKinPhone}
                  />

                  <DetailItem
                    icon={<UserRound size={15} />}
                    label="Relationship"
                    value={member.nextOfKinRelationship}
                  />
                </div>
              </section>
            )}

            {/* ---------------------------------------------
                RECORD INFORMATION
            --------------------------------------------- */}

            <section>
              <SectionTitle title="Record Information" />

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DetailItem
                  icon={<CalendarDays size={15} />}
                  label="Created"
                  value={formatDate(member.createdAt)}
                />

                <DetailItem
                  icon={<CalendarDays size={15} />}
                  label="Updated"
                  value={formatDate(member.updatedAt)}
                />

                <DetailItem
                  icon={<UserRound size={15} />}
                  label="Created By"
                  value={member.createdBy}
                />
              </div>
            </section>
          </div>
        </div>

        {/* =====================================================
            FOOTER ACTIONS
        ===================================================== */}

        <div
          className="
            flex
            shrink-0
            flex-col
            gap-2
            border-t
            border-white/[0.07]
            p-4
            sm:flex-row
          "
        >
          <button
            type="button"
            onClick={onClose}
            className="
              flex
              h-10
              flex-1
              items-center
              justify-center
              rounded-xl
              bg-white/[0.04]
              px-4
              text-xs
              font-medium
              text-white/55
              transition
              hover:bg-white/[0.07]
              hover:text-white
            "
          >
            Close
          </button>

          {onEdit && (
            <button
              type="button"
              onClick={handleEdit}
              className="
                flex
                h-10
                flex-1
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-yellow-500/[0.08]
                px-4
                text-xs
                font-medium
                text-yellow-400
                transition
                hover:bg-yellow-500/15
              "
            >
              <Pencil
                size={15}
                strokeWidth={1.8}
              />

              Edit Member
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="
                flex
                h-10
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-red-500/[0.06]
                px-4
                text-xs
                font-medium
                text-red-400/80
                transition
                hover:bg-red-500/10
                hover:text-red-400
                sm:flex-none
              "
            >
              <Trash2
                size={15}
                strokeWidth={1.8}
              />

              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SECTION TITLE
========================================================= */

function SectionTitle({
  title,
}: {
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-white/[0.06]" />

      <span
        className="
          shrink-0
          text-[9px]
          font-semibold
          uppercase
          tracking-[0.16em]
          text-white/25
        "
      >
        {title}
      </span>

      <div className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

/* =========================================================
   DETAIL ITEM
========================================================= */

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div
      className="
        min-w-0
        rounded-xl
        border
        border-white/[0.06]
        bg-white/[0.02]
        p-3
      "
    >
      <div className="flex items-center gap-2 text-white/25">
        {icon}

        <span
          className="
            truncate
            text-[9px]
            font-medium
            uppercase
            tracking-[0.14em]
          "
        >
          {label}
        </span>
      </div>

      <p
        className="
          mt-2
          break-words
          text-xs
          leading-5
          text-white/65
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
  const styles: Record<Member["status"], string> = {
    active:
      "bg-emerald-500/10 text-emerald-400 ring-emerald-500/10",

    inactive:
      "bg-white/[0.06] text-white/45 ring-white/[0.06]",

    suspended:
      "bg-red-500/10 text-red-400 ring-red-500/10",
  };

  const labels: Record<Member["status"], string> = {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
  };

  const dots: Record<Member["status"], string> = {
    active: "bg-emerald-400",
    inactive: "bg-white/30",
    suspended: "bg-red-400",
  };

  return (
    <span
      className={`
        inline-flex
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

/* =========================================================
   STATUS FORMATTER
========================================================= */

function formatStatus(
  status: Member["status"]
) {
  switch (status) {
    case "active":
      return "Active";

    case "inactive":
      return "Inactive";

    case "suspended":
      return "Suspended";

    default:
      return "—";
  }
}

/* =========================================================
   DATE FORMATTER
========================================================= */

function formatDate(
  value?: string | null
) {
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