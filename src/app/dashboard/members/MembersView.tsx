"use client";

import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldAlert,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  Member,
  MemberWithFinancialSummary,
} from "@/lib/members/types";

import { downloadMemberSummaryPdf } from "@/app/dashboard/members/memberSummaryPdf";

/* =========================================================
   TYPES
========================================================= */

type MemberViewModalProps = {
  member: Member | MemberWithFinancialSummary;
  onClose: () => void;
  onEdit?: (
    member: Member | MemberWithFinancialSummary,
  ) => void;
  onDelete?: (
    member: Member | MemberWithFinancialSummary,
  ) => void;
};

/* =========================================================
   TYPE GUARD
========================================================= */

function hasFinancialSummary(
  member: Member | MemberWithFinancialSummary,
): member is MemberWithFinancialSummary {
  return (
    "financialSummary" in member &&
    !!member.financialSummary
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function MemberViewModal({
  member,
  onClose,
  onEdit,
  onDelete,
}: MemberViewModalProps) {
  const [downloading, setDownloading] =
    useState(false);

  const [imageFailed, setImageFailed] =
    useState(false);

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const fullName = [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const initials = getInitials(member);

  const profileImageUrl = member.profileImage
    ? getProfileImageUrl(
        member.membershipNumber,
      )
    : null;

  const financialSummary =
    hasFinancialSummary(member)
      ? member.financialSummary
      : undefined;

  const loan = financialSummary?.loan;

  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [onClose]);

  /* =======================================================
     BODY SCROLL LOCK
  ======================================================= */

  useEffect(() => {
    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, []);

  /* =======================================================
     DOWNLOAD MEMBER SUMMARY
  ======================================================= */

  async function handleDownloadSummary() {
    if (downloading) {
      return;
    }

    try {
      setDownloading(true);

      await downloadMemberSummaryPdf(member);
    } catch (error) {
      console.error(
        "[MEMBER SUMMARY DOWNLOAD]",
        error,
      );
    } finally {
      setDownloading(false);
    }
  }

  /* =======================================================
     EDIT
  ======================================================= */

  function handleEdit() {
    onEdit?.(member);
  }

  /* =======================================================
     DELETE
  ======================================================= */

  function handleDelete() {
    onDelete?.(member);
  }

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-end
        justify-center
        bg-black/40
        p-0
        backdrop-blur-md
        sm:items-center
        sm:p-4
      "
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-view-title"
        className="
          flex
          max-h-[94vh]
          w-full
          flex-col
          overflow-hidden
          rounded-t-[28px]
          border
          border-slate-200
          bg-white
          shadow-2xl
          shadow-black/20
          sm:max-w-3xl
          sm:rounded-[28px]
        "
      >
        {/* ===================================================
            HEADER
        =================================================== */}

        <header
          className="
            shrink-0
            border-b
            border-slate-200
            bg-white
            px-4
            py-4
            sm:px-6
            sm:py-5
          "
        >
          <div className="flex items-start gap-3">
            {/* =================================================
                PROFILE
            ================================================= */}

            <div className="shrink-0">
              {profileImageUrl &&
              !imageFailed ? (
                <div
                  className="
                    h-14
                    w-14
                    overflow-hidden
                    rounded-2xl
                    bg-slate-100
                    ring-1
                    ring-slate-200
                    sm:h-16
                    sm:w-16
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

            {/* =================================================
                IDENTITY
            ================================================= */}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="member-view-title"
                  className="
                    truncate
                    text-lg
                    font-semibold
                    tracking-tight
                    text-black
                    sm:text-xl
                  "
                >
                  {fullName}
                </h2>

                <StatusBadge
                  status={member.status}
                />
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs font-semibold text-sky-700">
                  {member.membershipNumber}
                </p>

                {member.phone && (
                  <p className="text-[11px] text-black/50">
                    {member.phone}
                  </p>
                )}
              </div>

              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-black/40">
                Member record
              </p>
            </div>

            {/* =================================================
                CLOSE
            ================================================= */}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close member view"
              className="
                flex
                h-9
                w-9
                shrink-0
                items-center
                justify-center
                rounded-xl
                border
                border-slate-200
                bg-white
                text-black
                transition
                hover:border-slate-300
                hover:bg-slate-50
                active:scale-[0.97]
              "
            >
              <X
                size={18}
                strokeWidth={1.8}
              />
            </button>
          </div>
        </header>

        {/* ===================================================
            BODY
        =================================================== */}

        <div
          className="
            min-h-0
            flex-1
            overflow-y-auto
            overscroll-contain
            bg-white
            px-4
            py-5
            sm:px-6
            sm:py-6
          "
        >
          {/* =================================================
              FINANCIAL OVERVIEW
          ================================================= */}

          <section>
            <SectionTitle
              icon={CreditCard}
              title="Financial Overview"
            />

            {financialSummary ? (
              <div
                className="
                  grid
                  grid-cols-2
                  gap-2.5
                  sm:grid-cols-4
                "
              >
                <MetricCard
                  label="Savings"
                  value={formatMoney(
                    financialSummary.savingsBalance,
                  )}
                  highlight
                />

                <MetricCard
                  label="Deposits"
                  value={formatMoney(
                    financialSummary.totalDeposits,
                  )}
                />

                <MetricCard
                  label="Withdrawals"
                  value={formatMoney(
                    financialSummary.totalWithdrawals,
                  )}
                />

                <MetricCard
                  label="Loan Outstanding"
                  value={
                    loan
                      ? formatMoney(
                          loan.outstandingBalance,
                        )
                      : "None"
                  }
                  danger={
                    !!loan &&
                    loan.outstandingBalance > 0
                  }
                />
              </div>
            ) : (
              <div
                className="
                  rounded-2xl
                  border
                  border-slate-200
                  bg-white
                  p-4
                "
              >
                <div className="flex items-center gap-3">
                  <div
                    className="
                      flex
                      h-10
                      w-10
                      shrink-0
                      items-center
                      justify-center
                      rounded-xl
                      border
                      border-slate-200
                      bg-slate-50
                      text-black
                    "
                  >
                    <CreditCard
                      size={17}
                      strokeWidth={1.6}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs font-medium text-black">
                      Financial summary not loaded
                    </p>

                    <p className="mt-1 text-[11px] leading-5 text-black/50">
                      Financial information will
                      appear here when the member
                      record includes the financial
                      summary.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* =================================================
              LOAN POSITION
          ================================================= */}

          {financialSummary && (
            <section className="mt-7">
              <SectionTitle
                icon={CreditCard}
                title="Loan Position"
              />

              {loan ? (
                <div
                  className="
                    rounded-2xl
                    border
                    border-slate-200
                    bg-white
                    p-4
                  "
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.14em] text-black/40">
                        Loan Number
                      </p>

                      <p className="mt-1 text-sm font-semibold text-black">
                        {loan.loanNumber}
                      </p>
                    </div>

                    <LoanStatusBadge
                      status={loan.status}
                    />
                  </div>

                  <div
                    className="
                      mt-5
                      grid
                      grid-cols-2
                      gap-4
                      sm:grid-cols-4
                    "
                  >
                    <InfoMetric
                      label="Principal"
                      value={formatMoney(
                        loan.principal,
                      )}
                    />

                    <InfoMetric
                      label="Total Due"
                      value={formatMoney(
                        loan.totalDue,
                      )}
                    />

                    <InfoMetric
                      label="Amount Paid"
                      value={formatMoney(
                        loan.amountPaid,
                      )}
                    />

                    <InfoMetric
                      label="Outstanding"
                      value={formatMoney(
                        loan.outstandingBalance,
                      )}
                      danger={
                        loan.outstandingBalance > 0
                      }
                    />
                  </div>

                  <div
                    className="
                      mt-5
                      flex
                      flex-wrap
                      gap-x-5
                      gap-y-2
                      border-t
                      border-slate-200
                      pt-3
                    "
                  >
                    <MetaItem
                      label="First Due Date"
                      value={formatDate(
                        loan.firstDueDate,
                      )}
                    />

                    <MetaItem
                      label="Fine Status"
                      value={formatStatus(
                        loan.fineStatus,
                      )}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="
                    rounded-2xl
                    border
                    border-emerald-200
                    bg-emerald-50
                    p-4
                  "
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="
                        flex
                        h-9
                        w-9
                        shrink-0
                        items-center
                        justify-center
                        rounded-xl
                        bg-emerald-100
                        text-emerald-700
                      "
                    >
                      <CheckCircle2
                        size={17}
                        strokeWidth={1.7}
                      />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-emerald-800">
                        No active loan
                      </p>

                      <p className="mt-1 text-[11px] text-black/50">
                        No loan position is currently
                        recorded for this member.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* =================================================
              PERSONAL INFORMATION
          ================================================= */}

          <section className="mt-7">
            <SectionTitle
              icon={User}
              title="Personal Information"
            />

            <InfoGrid>
              <InfoItem
                label="First Name"
                value={member.firstName}
              />

              <InfoItem
                label="Middle Name"
                value={member.middleName}
              />

              <InfoItem
                label="Last Name"
                value={member.lastName}
              />

              <InfoItem
                label="Gender"
                value={
                  member.gender
                    ? formatStatus(
                        member.gender,
                      )
                    : undefined
                }
              />

              <InfoItem
                label="Date of Birth"
                value={
                  member.dateOfBirth
                    ? formatDate(
                        member.dateOfBirth,
                      )
                    : undefined
                }
              />

              <InfoItem
                label="National ID"
                value={member.nationalId}
              />
            </InfoGrid>
          </section>

          {/* =================================================
              CONTACT INFORMATION
          ================================================= */}

          <section className="mt-7">
            <SectionTitle
              icon={Phone}
              title="Contact Information"
            />

            <InfoGrid>
              <InfoItem
                icon={Phone}
                label="Phone"
                value={member.phone}
              />

              <InfoItem
                icon={Mail}
                label="Email"
                value={member.email}
              />

              <InfoItem
                icon={MapPin}
                label="Address"
                value={member.address}
              />

              <InfoItem
                icon={MapPin}
                label="City"
                value={member.city}
              />

              <InfoItem
                icon={MapPin}
                label="County"
                value={member.county}
              />

              <InfoItem
                label="Occupation"
                value={member.occupation}
              />
            </InfoGrid>
          </section>

          {/* =================================================
              MEMBERSHIP INFORMATION
          ================================================= */}

          <section className="mt-7">
            <SectionTitle
              icon={CalendarDays}
              title="Membership Information"
            />

            <InfoGrid>
              <InfoItem
                label="Membership Number"
                value={
                  member.membershipNumber
                }
              />

              <InfoItem
                label="Join Date"
                value={formatDate(
                  member.joinDate,
                )}
              />

              <InfoItem
                label="Status"
                value={formatStatus(
                  member.status,
                )}
              />

              <InfoItem
                label="Occupation"
                value={member.occupation}
              />
            </InfoGrid>
          </section>

          {/* =================================================
              NEXT OF KIN
          ================================================= */}

          <section className="mt-7">
            <SectionTitle
              icon={Users}
              title="Next of Kin"
            />

            <InfoGrid>
              <InfoItem
                label="Name"
                value={
                  member.nextOfKinName
                }
              />

              <InfoItem
                label="Phone"
                value={
                  member.nextOfKinPhone
                }
              />

              <InfoItem
                label="Relationship"
                value={
                  member.nextOfKinRelationship
                }
              />
            </InfoGrid>
          </section>

          {/* =================================================
              NOTES
          ================================================= */}

          {member.notes && (
            <section className="mt-7">
              <SectionTitle
                icon={FileText}
                title="Member Notes"
              />

              <div
                className="
                  rounded-2xl
                  border
                  border-slate-200
                  bg-white
                  p-4
                "
              >
                <p className="whitespace-pre-wrap text-sm leading-6 text-black/70">
                  {member.notes}
                </p>
              </div>
            </section>
          )}

          {/* =================================================
              RECORD INFORMATION
          ================================================= */}

          <section className="mt-7">
            <SectionTitle
              icon={ShieldAlert}
              title="Record Information"
            />

            <InfoGrid>
              <InfoItem
                label="Created By"
                value={member.createdBy}
              />

              <InfoItem
                label="Updated By"
                value={member.updatedBy}
              />

              <InfoItem
                label="Created At"
                value={formatDate(
                  member.createdAt,
                )}
              />

              <InfoItem
                label="Last Updated"
                value={formatDate(
                  member.updatedAt,
                )}
              />
            </InfoGrid>
          </section>
        </div>

        {/* ===================================================
            FOOTER
        =================================================== */}

        <footer
          className="
            shrink-0
            border-t
            border-slate-200
            bg-white
            px-4
            py-3
            sm:px-6
          "
        >
          <div
            className="
              flex
              flex-col-reverse
              gap-2
              sm:flex-row
              sm:items-center
              sm:justify-between
            "
          >
            {/* =================================================
                SECONDARY ACTIONS
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
                  border-slate-200
                  bg-white
                  px-4
                  text-xs
                  font-medium
                  text-black
                  transition
                  hover:bg-slate-50
                  hover:border-slate-300
                  active:scale-[0.98]
                "
              >
                Close
              </button>

              {onEdit && (
                <button
                  type="button"
                  onClick={handleEdit}
                  className="
                    inline-flex
                    min-h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    border
                    border-slate-200
                    bg-white
                    px-3
                    text-xs
                    font-medium
                    text-black
                    transition
                    hover:bg-slate-50
                    hover:border-slate-300
                    active:scale-[0.98]
                  "
                >
                  <Pencil
                    size={14}
                    strokeWidth={1.7}
                  />

                  <span>Edit</span>
                </button>
              )}

              {onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="
                    inline-flex
                    min-h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    border
                    border-rose-200
                    bg-rose-50
                    px-3
                    text-xs
                    font-medium
                    text-rose-700
                    transition
                    hover:bg-rose-100
                    active:scale-[0.98]
                  "
                >
                  <Trash2
                    size={14}
                    strokeWidth={1.7}
                  />

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
              disabled={downloading}
              className="
                inline-flex
                min-h-10
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-sky-500
                px-4
                text-xs
                font-semibold
                text-white
                shadow-lg
                shadow-sky-500/10
                transition
                hover:bg-sky-400
                disabled:cursor-not-allowed
                disabled:opacity-50
                active:scale-[0.98]
                sm:px-5
              "
            >
              {downloading ? (
                <Loader2
                  size={16}
                  strokeWidth={1.8}
                  className="animate-spin"
                />
              ) : (
                <Download
                  size={16}
                  strokeWidth={1.8}
                />
              )}

              <span>
                {downloading
                  ? "Preparing..."
                  : "Download Summary"}
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/* =========================================================
   SECTION TITLE
========================================================= */

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: typeof User;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon
        size={14}
        strokeWidth={1.7}
        className="text-sky-600"
      />

      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-black/50">
        {title}
      </p>
    </div>
  );
}

/* =========================================================
   METRIC CARD
========================================================= */

function MetricCard({
  label,
  value,
  highlight = false,
  danger = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`
        rounded-2xl
        border
        bg-white
        p-3
        ${
          danger
            ? "border-rose-200"
            : highlight
              ? "border-sky-200"
              : "border-slate-200"
        }
      `}
    >
      <p className="text-[8px] uppercase tracking-[0.12em] text-black/45">
        {label}
      </p>

      <p
        className={`
          mt-2
          truncate
          text-sm
          font-semibold
          ${
            danger
              ? "text-rose-700"
              : highlight
                ? "text-sky-700"
                : "text-black"
          }
        `}
      >
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   INFO GRID
========================================================= */

function InfoGrid({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {children}
    </div>
  );
}

/* =========================================================
   INFO ITEM
========================================================= */

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof User;
  label: string;
  value?: string;
}) {
  return (
    <div
      className="
        rounded-xl
        border
        border-slate-200
        bg-white
        px-3
        py-2.5
      "
    >
      <div className="flex items-start gap-2">
        {Icon && (
          <Icon
            size={13}
            strokeWidth={1.6}
            className="mt-0.5 shrink-0 text-black/50"
          />
        )}

        <div className="min-w-0">
          <p className="text-[8px] uppercase tracking-[0.1em] text-black/45">
            {label}
          </p>

          <p className="mt-1 break-words text-xs text-black">
            {value || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   INFO METRIC
========================================================= */

function InfoMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-[0.1em] text-black/45">
        {label}
      </p>

      <p
        className={`
          mt-1
          text-xs
          font-semibold
          ${
            danger
              ? "text-rose-700"
              : "text-black"
          }
        `}
      >
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   META ITEM
========================================================= */

function MetaItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className="text-[8px] uppercase tracking-[0.1em] text-black/45">
        {label}
      </span>

      <span className="ml-1 text-[10px] text-black">
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   INITIALS AVATAR
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
        h-14
        w-14
        shrink-0
        items-center
        justify-center
        rounded-2xl
        border
        border-sky-200
        bg-sky-50
        text-base
        font-bold
        text-sky-700
        sm:h-16
        sm:w-16
      "
    >
      {initials}
    </div>
  );
}

/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({
  status,
}: {
  status:
    | "active"
    | "inactive"
    | "blacklisted";
}) {
  const className =
    status === "active"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "blacklisted"
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : "bg-slate-100 text-black ring-slate-200";

  return (
    <span
      className={`
        shrink-0
        rounded-full
        px-2
        py-0.5
        text-[8px]
        font-semibold
        uppercase
        tracking-[0.1em]
        ring-1
        ${className}
      `}
    >
      {status}
    </span>
  );
}

/* =========================================================
   LOAN STATUS BADGE
========================================================= */

function LoanStatusBadge({
  status,
}: {
  status:
    | "pending"
    | "active"
    | "completed"
    | "cancelled";
}) {
  const className =
    status === "active"
      ? "bg-sky-50 text-sky-700 ring-sky-200"
      : status === "completed"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : status === "cancelled"
          ? "bg-rose-50 text-rose-700 ring-rose-200"
          : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <span
      className={`
        shrink-0
        rounded-full
        px-2
        py-1
        text-[8px]
        font-semibold
        uppercase
        tracking-[0.1em]
        ring-1
        ${className}
      `}
    >
      {status}
    </span>
  );
}

/* =========================================================
   FORMAT MONEY
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

/* =========================================================
   FORMAT DATE
========================================================= */

function formatDate(
  value?: string,
): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
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

/* =========================================================
   FORMAT STATUS
========================================================= */

function formatStatus(
  value?: string,
): string {
  if (!value) {
    return "—";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

/* =========================================================
   INITIALS
========================================================= */

function getInitials(
  member: Member | MemberWithFinancialSummary,
): string {
  const first =
    member.firstName?.charAt(0) ?? "";

  const last =
    member.lastName?.charAt(0) ?? "";

  return (
    `${first}${last}`.toUpperCase() ||
    "M"
  );
}

/* =========================================================
   PROFILE IMAGE URL
========================================================= */

function getProfileImageUrl(
  membershipNumber: string,
): string {
  return `/api/members/photos/${encodeURIComponent(
    membershipNumber,
  )}`;
}