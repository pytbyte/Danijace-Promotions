"use client";

import { useState } from "react";

import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  UserRound,
  VenusAndMars,
  WalletCards,
  X,
} from "lucide-react";

import type {
  MemberWithFinancialSummary,
} from "@/lib/members/types";

import { downloadMemberSummaryPdf } from "@/app/dashboard/members/memberSummaryPdf";

/* =========================================================
   PROPS
========================================================= */

type MemberViewModalProps = {
  member: MemberWithFinancialSummary | null;

  open: boolean;

  onClose: () => void;

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

function formatMoney(
  value: number | null | undefined,
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  return `KSh ${value.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    },
  )}`;
}

function formatDate(
  value: string | undefined,
): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  );
}

function getFullName(
  member: MemberWithFinancialSummary,
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
  member: MemberWithFinancialSummary,
): string {
  return (
    `${member.firstName?.charAt(0) ?? ""}${
      member.lastName?.charAt(0) ?? ""
    }`.toUpperCase() || "M"
  );
}

function getProfileImageUrl(
  membershipNumber: string,
): string {
  return `/api/members/photos/${encodeURIComponent(
    membershipNumber,
  )}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function MemberViewModal({
  member,
  open,
  onClose,
  onEdit,
  onDelete,
}: MemberViewModalProps) {
  const [downloading, setDownloading] =
    useState(false);

  const [
    imageFailed,
    setImageFailed,
  ] = useState(false);

  /* =======================================================
     CLOSED STATE
  ======================================================= */

  if (!open || !member) {
    return null;
  }

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const fullName = getFullName(member);

  const initials = getInitials(member);

  const summary =
    member.financialSummary;

  const loan = summary?.loan;

  const location = [
    member.address,
    member.city,
    member.county,
  ]
    .filter(Boolean)
    .join(", ");

  const profileImageUrl =
    member.profileImage
      ? getProfileImageUrl(
          member.membershipNumber,
        )
      : null;

  /* =======================================================
     DOWNLOAD MEMBER SUMMARY
  ======================================================= */

async function handleDownloadSummary() {
  if (!member) {
    return;
  }

  try {
    setDownloading(true);

    if (member) {
    await downloadMemberSummaryPdf(member);
  }
  } catch (error) {
    console.error(
      "[MEMBER SUMMARY DOWNLOAD]",
      error,
    );
  } finally {
    setDownloading(false);
  }
}

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-black/70
        p-4
        backdrop-blur-sm
      "
      role="dialog"
      aria-modal="true"
      aria-label={`Member profile for ${fullName}`}
    >
      <div
        className="
          flex
          max-h-[92dvh]
          w-full
          max-w-4xl
          flex-col
          overflow-hidden
          rounded-3xl
          border
          border-white/[0.08]
          bg-[#0a0c0e]
          shadow-2xl
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          className="
            flex
            shrink-0
            items-center
            justify-between
            border-b
            border-white/[0.06]
            px-5
            py-4
            sm:px-6
          "
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300/60">
              Member Profile
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">
              {fullName}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="
              flex
              h-9
              w-9
              items-center
              justify-center
              rounded-xl
              border
              border-white/[0.06]
              bg-white/[0.025]
              text-white/50
              transition
              hover:bg-white/[0.06]
              hover:text-white
              active:scale-[0.97]
            "
            aria-label="Close member profile"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* =================================================
            CONTENT
        ================================================= */}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-5 sm:p-6">
            {/* =================================================
                PROFILE
            ================================================= */}

            <section
              className="
                rounded-2xl
                border
                border-white/[0.06]
                bg-white/[0.02]
                p-5
              "
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                {/* PROFILE IMAGE */}

                <div className="shrink-0">
                  {profileImageUrl &&
                  !imageFailed ? (
                    <div
                      className="
                        h-24
                        w-24
                        overflow-hidden
                        rounded-2xl
                        bg-white/[0.03]
                        ring-1
                        ring-white/10
                      "
                    >
                      <img
                        src={profileImageUrl}
                        alt={fullName}
                        onError={() =>
                          setImageFailed(true)
                        }
                        className="
                          h-full
                          w-full
                          object-cover
                        "
                      />
                    </div>
                  ) : (
                    <InitialsAvatar
                      initials={initials}
                    />
                  )}
                </div>

                {/* MEMBER IDENTITY */}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-white">
                      {fullName}
                    </h3>

                    <span
                      className={`
                        rounded-full
                        px-2.5
                        py-1
                        text-[9px]
                        font-semibold
                        uppercase
                        tracking-[0.12em]
                        ${
                          member.status ===
                          "active"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : member.status ===
                                "suspended"
                              ? "bg-rose-400/10 text-rose-300"
                              : "bg-white/[0.06] text-white/40"
                        }
                      `}
                    >
                      {member.status}
                    </span>
                  </div>

                  <p className="mt-1 text-sm font-medium text-sky-300/70">
                    {member.membershipNumber}
                  </p>

                  {member.occupation && (
                    <p className="mt-2 text-sm text-white/40">
                      {member.occupation}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      <Phone className="h-3.5 w-3.5 text-sky-300/60" />

                      <span>
                        {member.phone ||
                          "—"}
                      </span>
                    </div>

                    {member.email && (
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <Mail className="h-3.5 w-3.5 text-sky-300/60" />

                        <span className="break-all">
                          {member.email}
                        </span>
                      </div>
                    )}

                    {location && (
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <MapPin className="h-3.5 w-3.5 text-sky-300/60" />

                        <span>
                          {location}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* =================================================
                FINANCIAL OVERVIEW
            ================================================= */}

            <section>
              <SectionTitle
                icon={
                  <WalletCards className="h-4 w-4" />
                }
                title="Financial Overview"
              />

              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                <SummaryCard
                  label="Savings"
                  value={formatMoney(
                    summary?.savingsBalance,
                  )}
                  primary
                />

                <SummaryCard
                  label="Loan"
                  value={
                    loan
                      ? formatMoney(
                          loan.outstandingBalance,
                        )
                      : "—"
                  }
                />

                <SummaryCard
                  label="Deposits"
                  value={formatMoney(
                    summary?.totalDeposits,
                  )}
                />

                <SummaryCard
                  label="Paid"
                  value={
                    loan
                      ? formatMoney(
                          loan.amountPaid,
                        )
                      : "—"
                  }
                />

                <SummaryCard
                  label="Fines"
                  value={
                    loan
                      ? formatMoney(
                          loan.totalFines,
                        )
                      : "—"
                  }
                />
              </div>
            </section>

            {/* =================================================
                LOAN DETAILS
            ================================================= */}

            {loan && (
              <section>
                <SectionTitle
                  icon={
                    <Landmark className="h-4 w-4" />
                  }
                  title="Loan Details"
                />

                <div className="mt-3 rounded-2xl border border-sky-400/10 bg-sky-400/[0.035] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-white/25">
                        Loan Number
                      </p>

                      <p className="mt-1 text-sm font-semibold text-white">
                        {loan.loanNumber}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-sky-300">
                        {loan.status}
                      </span>

                      <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-medium text-white/40">
                        Fine:{" "}
                        {loan.fineStatus}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <DetailValue
                      label="Principal"
                      value={formatMoney(
                        loan.principal,
                      )}
                    />

                    <DetailValue
                      label="Total Due"
                      value={formatMoney(
                        loan.totalDue,
                      )}
                    />

                    <DetailValue
                      label="Amount Paid"
                      value={formatMoney(
                        loan.amountPaid,
                      )}
                    />

                    <DetailValue
                      label="Outstanding"
                      value={formatMoney(
                        loan.outstandingBalance,
                      )}
                    />
                  </div>

                  <div className="mt-5 border-t border-white/[0.06] pt-4">
                    <DetailValue
                      label="First Due Date"
                      value={formatDate(
                        loan.firstDueDate,
                      )}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* =================================================
                NO LOAN
            ================================================= */}

            {summary && !loan && (
              <section>
                <div
                  className="
                    flex
                    items-center
                    gap-3
                    rounded-2xl
                    border
                    border-emerald-400/10
                    bg-emerald-400/[0.035]
                    p-4
                  "
                >
                  <div
                    className="
                      flex
                      h-10
                      w-10
                      shrink-0
                      items-center
                      justify-center
                      rounded-xl
                      bg-emerald-400/10
                      text-emerald-300
                    "
                  >
                    <CheckCircle2
                      className="h-5 w-5"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-emerald-300/80">
                      No Active Loan
                    </p>

                    <p className="mt-1 text-[11px] text-white/25">
                      No current loan position is
                      recorded for this member.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* =================================================
                PERSONAL INFORMATION
            ================================================= */}

            <InfoSection title="Personal Information">
              <DetailValue
                label="First Name"
                value={member.firstName}
              />

              <DetailValue
                label="Middle Name"
                value={member.middleName}
              />

              <DetailValue
                label="Last Name"
                value={member.lastName}
              />

              <DetailValue
                label="Gender"
                value={member.gender}
              />

              <DetailValue
                label="Date of Birth"
                value={formatDate(
                  member.dateOfBirth,
                )}
              />

              <DetailValue
                label="National ID"
                value={member.nationalId}
              />
            </InfoSection>

            {/* =================================================
                CONTACT INFORMATION
            ================================================= */}

            <InfoSection title="Contact Information">
              <DetailValue
                label="Phone"
                value={member.phone}
                icon={
                  <Phone className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="Email"
                value={member.email}
                icon={
                  <Mail className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="Address"
                value={member.address}
                icon={
                  <MapPin className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="City"
                value={member.city}
              />

              <DetailValue
                label="County"
                value={member.county}
              />

              <DetailValue
                label="Occupation"
                value={member.occupation}
              />
            </InfoSection>

            {/* =================================================
                MEMBERSHIP INFORMATION
            ================================================= */}

            <InfoSection title="Membership Information">
              <DetailValue
                label="Membership Number"
                value={
                  member.membershipNumber
                }
                icon={
                  <CreditCard className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="Join Date"
                value={formatDate(
                  member.joinDate,
                )}
                icon={
                  <CalendarDays className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="Status"
                value={member.status}
              />
            </InfoSection>

            {/* =================================================
                NEXT OF KIN
            ================================================= */}

            <InfoSection title="Next of Kin">
              <DetailValue
                label="Name"
                value={
                  member.nextOfKinName
                }
              />

              <DetailValue
                label="Phone"
                value={
                  member.nextOfKinPhone
                }
              />

              <DetailValue
                label="Relationship"
                value={
                  member.nextOfKinRelationship
                }
              />
            </InfoSection>

            {/* =================================================
                RECORD INFORMATION
            ================================================= */}

            <InfoSection title="Record Information">
              <DetailValue
                label="Created By"
                value={
                  member.createdBy
                }
                icon={
                  <ShieldCheck className="h-3.5 w-3.5" />
                }
              />

              <DetailValue
                label="Created At"
                value={formatDate(
                  member.createdAt,
                )}
              />

              <DetailValue
                label="Updated By"
                value={
                  member.updatedBy
                }
              />

              <DetailValue
                label="Updated At"
                value={formatDate(
                  member.updatedAt,
                )}
              />
            </InfoSection>

            {/* =================================================
                NOTES
            ================================================= */}

            {member.notes && (
              <section>
                <SectionTitle
                  icon={
                    <VenusAndMars className="h-4 w-4" />
                  }
                  title="Notes"
                />

                <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-white/50">
                    {member.notes}
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <div
          className="
            shrink-0
            border-t
            border-white/[0.06]
            bg-[#0a0c0e]
            px-5
            py-4
            sm:px-6
          "
        >
          <div
            className="
              flex
              flex-col
              gap-3
              sm:flex-row
              sm:items-center
              sm:justify-between
            "
          >
            {/* =================================================
                LEFT ACTIONS
            ================================================= */}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="
                  inline-flex
                  min-h-10
                  items-center
                  justify-center
                  rounded-xl
                  border
                  border-white/[0.07]
                  bg-white/[0.025]
                  px-4
                  text-xs
                  font-medium
                  text-white/55
                  transition
                  hover:bg-white/[0.05]
                  hover:text-white
                  active:scale-[0.98]
                "
              >
                Close
              </button>

              {onEdit && (
                <button
                  type="button"
                  onClick={() =>
                    onEdit(member)
                  }
                  className="
                    inline-flex
                    min-h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    bg-sky-400/10
                    px-4
                    text-xs
                    font-medium
                    text-sky-300
                    transition
                    hover:bg-sky-400/15
                    active:scale-[0.98]
                  "
                >
                  <Pencil className="h-3.5 w-3.5" />

                  <span>Edit</span>
                </button>
              )}

              {onDelete && (
                <button
                  type="button"
                  onClick={() =>
                    onDelete(member)
                  }
                  className="
                    inline-flex
                    min-h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    bg-rose-400/[0.07]
                    px-4
                    text-xs
                    font-medium
                    text-rose-300
                    transition
                    hover:bg-rose-400/10
                    active:scale-[0.98]
                  "
                >
                  <Trash2 className="h-3.5 w-3.5" />

                  <span>Delete</span>
                </button>
              )}
            </div>

            {/* =================================================
                DOWNLOAD SUMMARY
            ================================================= */}

            <button
  type="button"
  onClick={handleDownloadSummary}
  disabled={!member || downloading}
  aria-label={`Download PDF summary for ${fullName}`}
  className="
    group
    inline-flex
    h-9
    w-full
    items-center
    justify-center
    gap-1.5
    rounded-lg
    border
    border-sky-300/15
    bg-sky-400/[0.08]
    px-3
    text-[11px]
    font-semibold
    text-sky-300
    transition-all
    duration-200
    hover:border-sky-300/25
    hover:bg-sky-400/[0.13]
    hover:text-sky-200
    active:scale-[0.98]
    disabled:cursor-not-allowed
    disabled:opacity-50
    sm:w-auto
  "
>
  {downloading ? (
    <Loader2
      size={13}
      strokeWidth={1.8}
      className="animate-spin"
    />
  ) : (
    <Download
      size={13}
      strokeWidth={1.8}
      className="transition-transform duration-200 group-hover:translate-y-px"
    />
  )}

  <span className="whitespace-nowrap">
    {downloading
      ? "Preparing..."
      : "Download PDF"}
  </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   PROFILE FALLBACK
========================================================= */

function InitialsAvatar({
  initials,
}: {
  initials: string;
}) {
  return (
    <div
      className="
        flex
        h-24
        w-24
        items-center
        justify-center
        rounded-2xl
        bg-sky-400/10
        text-xl
        font-bold
        text-sky-300
        ring-1
        ring-sky-400/15
      "
    >
      {initials || (
        <UserRound className="h-8 w-8" />
      )}
    </div>
  );
}

/* =========================================================
   SECTION TITLE
========================================================= */

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sky-300/70">
        {icon}
      </span>

      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
        {title}
      </h3>
    </div>
  );
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  label,
  value,
  primary = false,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`
        rounded-2xl
        border
        p-4
        ${
          primary
            ? "border-sky-400/10 bg-sky-400/[0.045]"
            : "border-white/[0.06] bg-white/[0.02]"
        }
      `}
    >
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/25">
        {label}
      </p>

      <p
        className={`
          mt-2
          text-sm
          font-semibold
          ${
            primary
              ? "text-sky-200"
              : "text-white/75"
          }
        `}
      >
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   INFO SECTION
========================================================= */

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">
        {title}
      </h3>

      <div
        className="
          grid
          grid-cols-1
          gap-x-6
          gap-y-4
          rounded-2xl
          border
          border-white/[0.06]
          bg-white/[0.02]
          p-5
          sm:grid-cols-2
          lg:grid-cols-3
        "
      >
        {children}
      </div>
    </section>
  );
}

/* =========================================================
   DETAIL VALUE
========================================================= */

function DetailValue({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className="text-sky-300/50">
            {icon}
          </span>
        )}

        <p className="text-[9px] uppercase tracking-[0.1em] text-white/25">
          {label}
        </p>
      </div>

      <p className="mt-1 truncate text-sm text-white/60">
        {value || "—"}
      </p>
    </div>
  );
}

