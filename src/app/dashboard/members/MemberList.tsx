"use client";

import {
  Eye,
  Landmark,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";

import type {
  MemberWithFinancialSummary,
} from "@/lib/members/types";

/* =========================================================
   PROPS
========================================================= */

type MemberListProps = {
  members: MemberWithFinancialSummary[];

  onView?: (
    member: MemberWithFinancialSummary
  ) => void;

  onEdit?: (
    member: MemberWithFinancialSummary
  ) => void;

  onDelete?: (
    member: MemberWithFinancialSummary
  ) => void;
};

/* =========================================================
   HELPERS
========================================================= */

function formatMoney(
  value: number | null | undefined
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  return `KSh ${value.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatDate(
  value: string | undefined
) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFullName(
  member: MemberWithFinancialSummary
) {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(Boolean)
    .join(" ");
}

function getInitials(
  member: MemberWithFinancialSummary
) {
  const first =
    member.firstName?.charAt(0) ?? "";

  const last =
    member.lastName?.charAt(0) ?? "";

  return `${first}${last}`.toUpperCase();
}

/* =========================================================
   COMPONENT
========================================================= */

export default function MemberList({
  members,
  onView,
  onEdit,
  onDelete,
}: MemberListProps) {
  if (members.length === 0) {
    return (
      <div className="lg:hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-12 text-center">
        <UsersRound className="mx-auto mb-3 h-8 w-8 text-white/20" />

        <p className="text-sm font-medium text-white/60">
          No members found
        </p>

        <p className="mt-1 text-xs text-white/30">
          Try changing your search or status filter.
        </p>
      </div>
    );
  }

  return (
    <div className="lg:hidden w-full min-w-0 overflow-hidden">
      <div
        className="
          flex
          w-full
          min-w-0
          snap-x
          snap-mandatory
          gap-4
          overflow-x-auto
          overscroll-x-contain
          pb-3
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {members.map((member) => (
          <div
            key={
              member._id ??
              member.membershipNumber
            }
            className="
              w-full
              min-w-full
              shrink-0
              snap-center
            "
          >
            <MemberCard
              member={member}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>

      {members.length > 1 && (
        <div className="mt-1 flex items-center justify-center gap-1.5">
          <div className="h-1 w-5 rounded-full bg-sky-400/60" />
          <p className="ml-1 text-[9px] uppercase tracking-[0.16em] text-white/20">
            Swipe for more
          </p>
        </div>
      )}
    </div>
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

  onView?: (
    member: MemberWithFinancialSummary
  ) => void;

  onEdit?: (
    member: MemberWithFinancialSummary
  ) => void;

  onDelete?: (
    member: MemberWithFinancialSummary
  ) => void;
}) {
  const summary = member.financialSummary;
  const loan = summary?.loan;

  const fullName = getFullName(member);
  const initials = getInitials(member);

  const location = [
    member.city,
    member.county,
  ]
    .filter(Boolean)
    .join(", ");

  const hasActiveLoan =
    loan &&
    (loan.status === "active" ||
      loan.status === "pending");

  return (
    <article
      className="
        w-full
        overflow-hidden
        rounded-[1.5rem]
        border
        border-white/[0.07]
        bg-[#0b0d0f]
        shadow-[0_18px_50px_rgba(0,0,0,0.28)]
      "
    >
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="border-b border-white/[0.06] px-5 pb-5 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* PROFILE */}
            <div className="relative shrink-0">
              {member.profileImage ? (
                <img
                  src={member.profileImage}
                  alt={fullName}
                  className="
                    h-14
                    w-14
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
                    h-14
                    w-14
                    items-center
                    justify-center
                    rounded-2xl
                    bg-sky-400/10
                    text-sm
                    font-bold
                    text-sky-300
                    ring-1
                    ring-sky-400/15
                  "
                >
                  {initials || (
                    <UserRound className="h-6 w-6" />
                  )}
                </div>
              )}

              <span
                className={`
                  absolute
                  -bottom-1
                  -right-1
                  h-3
                  w-3
                  rounded-full
                  border-2
                  border-[#0b0d0f]
                  ${
                    member.status === "active"
                      ? "bg-emerald-400"
                      : member.status ===
                          "suspended"
                        ? "bg-rose-400"
                        : "bg-white/30"
                  }
                `}
              />
            </div>

            {/* NAME */}
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-white">
                {fullName}
              </h3>

              <p className="mt-0.5 truncate text-xs text-sky-300/70">
                {member.membershipNumber}
              </p>

              {member.occupation && (
                <p className="mt-1 truncate text-[11px] text-white/35">
                  {member.occupation}
                </p>
              )}
            </div>
          </div>

          {/* STATUS */}
          <span
            className={`
              shrink-0
              rounded-full
              px-2.5
              py-1
              text-[9px]
              font-semibold
              uppercase
              tracking-[0.12em]
              ${
                member.status === "active"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : member.status === "suspended"
                    ? "bg-rose-400/10 text-rose-300"
                    : "bg-white/[0.06] text-white/40"
              }
            `}
          >
            {member.status}
          </span>
        </div>

        {/* CONTACT */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-white/40">
            <Phone className="h-3.5 w-3.5 shrink-0 text-sky-300/60" />
            <span className="truncate">
              {member.phone || "No phone"}
            </span>
          </div>

          {location && (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-white/40">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-300/60" />
              <span className="truncate">
                {location}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* =================================================
          FINANCIAL SUMMARY
      ================================================= */}

      <div className="px-5 py-5">
        <div className="mb-3 flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-sky-300/70" />

          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            Financial Overview
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {/* SAVINGS */}
          <FinancialItem
            icon={
              <WalletCards className="h-4 w-4" />
            }
            label="Savings"
            value={formatMoney(
              summary?.savingsBalance
            )}
            highlight
          />

          {/* LOAN */}
          <FinancialItem
            icon={
              <Landmark className="h-4 w-4" />
            }
            label="Loan"
            value={
              loan
                ? formatMoney(
                    loan.outstandingBalance
                  )
                : "—"
            }
          />

          {/* DEPOSITS */}
          <FinancialItem
            label="Deposits"
            value={formatMoney(
              summary?.totalDeposits
            )}
          />

          {/* PAID */}
          <FinancialItem
            label="Loan Paid"
            value={
              loan
                ? formatMoney(loan.amountPaid)
                : "—"
            }
          />

          {/* FINES */}
          <FinancialItem
            label="Fines"
            value={
              loan
                ? formatMoney(loan.totalFines)
                : "—"
            }
          />

          {/* TOTAL DUE */}
          <FinancialItem
            label="Total Due"
            value={
              loan
                ? formatMoney(loan.totalDue)
                : "—"
            }
          />
        </div>

        {/* =================================================
            LOAN DETAILS
        ================================================= */}

        {hasActiveLoan && loan && (
          <div className="mt-4 rounded-2xl border border-sky-400/10 bg-sky-400/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-sky-300" />

                <p className="text-xs font-semibold text-white/70">
                  {loan.loanNumber}
                </p>
              </div>

              <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-sky-300">
                {loan.status}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <LoanDetail
                label="Principal"
                value={formatMoney(
                  loan.principal
                )}
              />

              <LoanDetail
                label="Total Due"
                value={formatMoney(
                  loan.totalDue
                )}
              />

              <LoanDetail
                label="Outstanding"
                value={formatMoney(
                  loan.outstandingBalance
                )}
              />

              <LoanDetail
                label="Due Date"
                value={formatDate(
                  loan.firstDueDate
                )}
              />
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-white/[0.05] pt-3">
              <ShieldCheck className="h-3.5 w-3.5 text-white/30" />

              <span className="text-[10px] text-white/35">
                Fine status:
              </span>

              <span className="text-[10px] font-medium text-white/60">
                {loan.fineStatus}
              </span>
            </div>
          </div>
        )}

        {/* =================================================
            QUICK DETAILS
        ================================================= */}

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-4">
          <div>
            <p className="text-[9px] uppercase tracking-[0.12em] text-white/25">
              Joined
            </p>

            <p className="mt-1 text-xs text-white/55">
              {formatDate(member.joinDate)}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.12em] text-white/25">
              Email
            </p>

            <p className="mt-1 truncate text-xs text-white/55">
              {member.email || "—"}
            </p>
          </div>
        </div>
      </div>

      {/* =================================================
          ACTIONS
      ================================================= */}

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-white/[0.06] px-5 py-4">
        <button
          type="button"
          onClick={() => onView?.(member)}
          className="
            flex
            min-h-10
            items-center
            justify-center
            gap-2
            rounded-xl
            bg-sky-400/10
            px-3
            text-xs
            font-medium
            text-sky-300
            transition
            active:scale-[0.98]
          "
        >
          <Eye className="h-4 w-4" />
          View Profile
        </button>

        <button
          type="button"
          onClick={() => onEdit?.(member)}
          className="
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-xl
            border
            border-white/[0.06]
            bg-white/[0.025]
            text-white/45
            transition
            active:scale-[0.96]
          "
          aria-label={`Edit ${getFullName(member)}`}
        >
          <Pencil className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => onDelete?.(member)}
          className="
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-xl
            border
            border-rose-400/10
            bg-rose-400/[0.035]
            text-rose-300/70
            transition
            active:scale-[0.96]
          "
          aria-label={`Delete ${getFullName(member)}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   FINANCIAL ITEM
========================================================= */

function FinancialItem({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`
        rounded-2xl
        border
        px-3.5
        py-3
        ${
          highlight
            ? "border-sky-400/10 bg-sky-400/[0.045]"
            : "border-white/[0.05] bg-white/[0.02]"
        }
      `}
    >
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className="text-sky-300/60">
            {icon}
          </span>
        )}

        <p className="text-[9px] uppercase tracking-[0.12em] text-white/30">
          {label}
        </p>
      </div>

      <p
        className={`
          mt-1.5
          truncate
          text-sm
          font-semibold
          ${
            highlight
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
   LOAN DETAIL
========================================================= */

function LoanDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.1em] text-white/25">
        {label}
      </p>

      <p className="mt-1 text-xs font-medium text-white/65">
        {value}
      </p>
    </div>
  );
}
