import type {
  LoanStatus,
  FineStatus,
} from "@/lib/loans/types";

import type { Member } from "@/lib/members/types";

/* =========================================================
   MEMBER LOAN SUMMARY
========================================================= */

export type MemberLoanSummary = {
  loanNumber: string;

  status: LoanStatus;

  principal: number;

  totalDue: number;

  amountPaid: number;

  totalFines: number;

  outstandingBalance: number;

  firstDueDate: string;

  fineStatus: FineStatus;
};

/* =========================================================
   MEMBER FINANCIAL SUMMARY
========================================================= */

export type MemberFinancialSummary = {
  savingsBalance: number;

  totalDeposits: number;

  totalWithdrawals: number;

  loan?: MemberLoanSummary;
};

/* =========================================================
   MEMBER WITH FINANCIAL SUMMARY
========================================================= */

export type MemberWithFinancialSummary =
  Member & {
    financialSummary: MemberFinancialSummary;
  };
