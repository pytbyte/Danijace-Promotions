/**
 * GEO-SHUA
 * Loan Domain Types
 *
 * =========================================================
 * DATE ARCHITECTURE
 * =========================================================
 *
 * BUSINESS / CALENDAR DATES
 * -------------------------
 *
 * All loan dates that represent a calendar day are stored
 * and transported as:
 *
 *   "YYYY-MM-DD"
 *
 * Example:
 *
 *   "2026-09-11"
 *
 * These values MUST NOT be converted to JavaScript Date
 * objects during normal loan processing.
 *
 * This applies to:
 *
 * - disbursementDate
 * - repaymentDate
 * - firstDueDate
 * - endDate
 * - fineDate
 * - periodStart
 * - periodEnd
 * - assessmentDate
 *
 * The value selected by the user should be the value stored
 * in MongoDB.
 *
 * Example:
 *
 * User enters:
 *
 *   2026-09-11
 *
 * Database stores:
 *
 *   "2026-09-11"
 *
 * NOT:
 *
 *   2026-09-11T00:00:00.000Z
 *
 * and NOT:
 *
 *   new Date(...)
 *
 *
 * TIMESTAMPS
 * ----------
 *
 * Actual moments in time remain JavaScript Date values.
 *
 * These include:
 *
 * - createdAt
 * - updatedAt
 * - authorizedAt
 * - transactionDate
 *
 * A timestamp represents an actual point in time.
 * A calendar date represents a business day.
 *
 * =========================================================
 * FINANCIAL RULES
 * =========================================================
 *
 * - No daily fines.
 * - Fines are percentage-based.
 * - A fine may be assessed once per completed repayment cycle.
 * - Repayment cycles default to 7 days.
 * - Each loan has a contractual installment amount for each
 *   repayment cycle.
 * - The default repayment cycle is weekly (7 days).
 * - A fine is calculated ONLY from the unpaid portion of the
 *   expected installment for that completed cycle.
 * - The entire outstanding loan balance is NOT fined simply
 *   because it remains outstanding.
 * - Existing fines never compound.
 * - Fines are calculated independently for each repayment cycle.
 * - Financial records are append-only.
 * - Repayments, fines, waivers, assessments and audits
 *   must never be permanently deleted.
 *
 * =========================================================
 * CORE REPAYMENT CALCULATION
 * =========================================================
 *
 * expectedInstallment = loan.installmentAmount
 *
 * installmentShortfall =
 *   max(
 *     0,
 *     expectedInstallment - paymentsDuringPeriod
 *   )
 *
 * fineAmount =
 *   installmentShortfall * fineRate
 *
 * Example:
 *
 * installmentAmount = 5,000
 * paymentsDuringPeriod = 3,000
 * fineRate = 0.10
 *
 * installmentShortfall = 2,000
 * fineAmount = 200
 *
 * The remaining loan balance is NOT used to calculate
 * this periodic fine.
 */

/* =========================================================
   CALENDAR DATE
========================================================= */

/**
 * A business/calendar date.
 *
 * Format:
 *
 *   YYYY-MM-DD
 *
 * Example:
 *
 *   "2026-09-11"
 *
 * IMPORTANT:
 *
 * This is intentionally a string.
 *
 * Do not change this to Date.
 */
export type CalendarDate = string;

/* =========================================================
   LOAN TYPE
========================================================= */

export type LoanType =
  | "emergency"
  | "regular";

/* =========================================================
   LOAN STATUS
========================================================= */

export type LoanStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled";

/* =========================================================
   REPAYMENT STATUS
========================================================= */

export type LoanRepaymentStatus =
  | "current"
  | "defaulted"
  | "completed";

/* =========================================================
   FINE STATUS
========================================================= */

export type FineStatus =
  | "active"
  | "stopped";

/* =========================================================
   TRANSACTION SOURCE
========================================================= */

export type TransactionSource =
  | "manual"
  | "sms"
  | "system";

/* =========================================================
   FINE SOURCE
========================================================= */

export type FineSource =
  | "system"
  | "manual";

/* =========================================================
   ASSESSMENT STATUS
========================================================= */

export type LoanAssessmentStatus =
  | "assessed"
  | "defaulted";

/* =========================================================
   ACTOR
========================================================= */

export interface LoanActor {
  name: string;
  email: string;
}

/* =========================================================
   GUARANTOR
========================================================= */

export interface LoanGuarantor {
  name: string;
  phone: string;
  idNumber?: string;
}

/* =========================================================
   LOAN SETTINGS
========================================================= */

export interface LoanSettings {
  id: string;

  regularInterestRate: number;
  emergencyInterestRate: number;

  regularMinimumSavings: number;
  regularSavingsMultiplier: number;

  /**
   * Retained for compatibility with existing settings
   * documents and consumers.
   *
   * This field is NOT authoritative for the new
   * periodic-fine calculation.
   *
   * Repayment timing is controlled by repaymentCycleDays.
   */
  repaymentGraceDays: number;

  /**
   * Number of days in one repayment assessment cycle.
   *
   * Default:
   * 7 days.
   *
   * When this is 7, the installment is effectively
   * a weekly installment.
   */
  repaymentCycleDays: number;

  /**
   * Percentage used when calculating a fine.
   *
   * Stored as a decimal.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate: number;

  emergencyLoansEnabled: boolean;
  regularLoansEnabled: boolean;

  updatedBy: LoanActor;

  createdAt: Date;
  updatedAt: Date;
}

/* =========================================================
   LOAN
========================================================= */

export interface Loan {
  id: string;

  loanNumber: string;

  memberId: string;
  memberNumber: string;
  memberName: string;

  type: LoanType;

  /**
   * Original principal amount disbursed.
   */
  principal: number;

  /**
   * Interest rate applied to the loan.
   *
   * Example:
   * 0.30 = 30%
   */
  interestRate: number;

  /**
   * Monetary interest amount.
   */
  interestAmount: number;

  /**
   * Percentage fine applied to the unpaid portion
   * of the expected installment for a completed
   * repayment cycle.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate: number;

  /**
   * Number of days in one repayment assessment cycle.
   *
   * Default:
   * 7 days.
   */
  repaymentCycleDays: number;

  /**
   * Contractual amount expected from the member
   * during each repayment cycle.
   *
   * With repaymentCycleDays = 7, this is the
   * member's weekly installment.
   *
   * This amount is entered when the loan is created
   * and may be updated only when allowed by the
   * loan update rules.
   */
  installmentAmount: number;

  /**
   * Calendar date on which the loan was disbursed.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  disbursementDate: CalendarDate;

  /**
   * Scheduled repayment date.
   *
   * Stored as a calendar date:
   *
   *   YYYY-MM-DD
   *
   * Retained for compatibility with existing
   * application code and UI.
   */
  repaymentDate: CalendarDate;

  /**
   * Final contractual loan end date.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  endDate: CalendarDate;

  /**
   * First scheduled assessment/due date.
   *
   * Normally derived from:
   *
   *   disbursementDate + repaymentCycleDays
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  firstDueDate: CalendarDate;

  /**
   * Principal + interest.
   *
   * Does NOT include fines.
   */
  totalDue: number;

  /**
   * Authoritative projection of all repayments
   * recorded against this loan.
   */
  amountPaid: number;

  /**
   * Authoritative projection of all assessed fines.
   *
   * Existing fines are never included when calculating
   * a new fine.
   */
  totalFines: number;

  /**
   * Authoritative projection of all approved
   * fine waivers.
   */
  totalWaivedFines: number;

  /**
   * Cached final outstanding balance.
   *
   * Formula:
   *
   * totalDue
   * + totalFines
   * - totalWaivedFines
   * - amountPaid
   *
   * Minimum:
   * 0
   */
  outstandingBalance: number;

  /**
   * Controls whether new fines may be assessed.
   */
  fineStatus: FineStatus;

  /**
   * Current repayment state of the loan.
   */
  repaymentStatus: LoanRepaymentStatus;

  guarantor: LoanGuarantor;

  status: LoanStatus;

  createdBy: LoanActor;

  authorizedBy: LoanActor;

  /**
   * Actual timestamp at which the loan was authorized.
   */
  authorizedAt: Date;

  /**
   * Actual timestamp at which the loan record was created.
   */
  createdAt: Date;

  /**
   * Actual timestamp at which the loan record was last updated.
   */
  updatedAt: Date;
}

/* =========================================================
   CREATE LOAN
========================================================= */

export interface CreateLoanInput {
  memberId: string;

  type: LoanType;

  principal: number;

  guarantor: LoanGuarantor;

  /**
   * Percentage-based fine.
   *
   * Applied ONLY to the unpaid portion of the
   * expected installment for a completed cycle.
   *
   * Example:
   * 0.10 = 10%
   *
   * When omitted, the authoritative loan settings
   * fineRate should be used.
   */
  fineRate?: number;

  /**
   * Expected repayment amount for each repayment cycle.
   *
   * With the default repaymentCycleDays = 7,
   * this represents the member's weekly installment.
   *
   * This may be entered manually.
   */
  installmentAmount: number;

  /**
   * Number of days in each repayment assessment cycle.
   *
   * Default:
   * 7 days.
   *
   * When omitted, the authoritative loan settings
   * repaymentCycleDays should be used.
   */
  repaymentCycleDays?: number;

  /**
   * Scheduled repayment calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   *
   * If omitted, the service may derive it from
   * the loan's repayment-cycle configuration.
   */
  repaymentDate?: CalendarDate;

  /**
   * Final contractual loan end calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  endDate?: CalendarDate;

  /**
   * Loan disbursement calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   *
   * If omitted, the service should use the current
   * calendar date.
   */
  disbursementDate?: CalendarDate;
}

/* =========================================================
   REPAYMENT
========================================================= */

export interface LoanRepayment {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  memberNumber: string;

  /**
   * Payment amount recorded.
   */
  amount: number;

  /**
   * Immutable bank/payment transaction reference.
   *
   * Must be globally unique.
   *
   * Used as the idempotency key to prevent
   * duplicate repayment records.
   */
  transactionReference: string;

  /**
   * Actual date/time the payment occurred.
   *
   * This is a timestamp because an actual payment
   * transaction may have a precise time.
   */
  transactionDate: Date;

  source: TransactionSource;

  /**
   * Original SMS/bank message when the payment
   * originated from SMS processing.
   */
  rawMessage?: string;

  recordedBy?: LoanActor;

  createdAt: Date;
}

/* =========================================================
   CREATE REPAYMENT
========================================================= */

export interface CreateLoanRepaymentInput {
  /**
   * Preferred when the payment is already associated
   * with a specific loan.
   */
  loanId?: string;

  /**
   * Can be used when the system must safely resolve
   * the member's only open loan.
   *
   * The service must never blindly select an arbitrary
   * loan when multiple open loans exist.
   */
  memberId?: string;

  /**
   * Amount being repaid.
   */
  amount: number;

  /**
   * Immutable payment transaction reference.
   *
   * Used as the idempotency key.
   */
  transactionReference: string;

  /**
   * Actual date/time the payment occurred.
   */
  transactionDate: Date;

  source: TransactionSource;

  rawMessage?: string;

  recordedBy?: LoanActor;
}

/* =========================================================
   FINE
========================================================= */

export interface LoanFine {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  /**
   * Fine amount actually assessed.
   *
   * Formula:
   *
   * installmentShortfall * fineRate
   */
  amount: number;

  /**
   * Calendar date on which the fine became
   * assessable/was recorded.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  fineDate: CalendarDate;

  /**
   * Percentage used to calculate this fine.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate: number;

  /**
   * Fixed repayment assessment cycle number.
   *
   * Cycle 1:
   * disbursement -> firstDueDate
   *
   * Cycle 2:
   * firstDueDate -> next cycle date
   *
   * Cycle N:
   * previous cycle end -> current cycle end
   */
  periodNumber: number;

  /**
   * Beginning of the repayment assessment period.
   *
   * Stored as a calendar date:
   *
   *   YYYY-MM-DD
   */
  periodStart: CalendarDate;

  /**
   * End of the repayment assessment period.
   *
   * Stored as a calendar date:
   *
   *   YYYY-MM-DD
   */
  periodEnd: CalendarDate;

  /**
   * Amount the member was expected to repay
   * during this specific period.
   *
   * Normally equals:
   *
   * loan.installmentAmount
   */
  expectedInstallment: number;

  /**
   * Total repayments recorded during this
   * specific repayment period.
   */
  paymentsDuringPeriod: number;

  /**
   * Unpaid portion of the expected installment.
   *
   * Formula:
   *
   * max(
   *   0,
   *   expectedInstallment - paymentsDuringPeriod
   * )
   *
   * This is the amount to which the fine rate
   * is applied.
   */
  installmentShortfall: number;

  /**
   * Amount used as the basis for this fine.
   *
   * For the periodic-installment model this equals
   * installmentShortfall.
   *
   * It is retained under this name for compatibility
   * with existing application code.
   *
   * IMPORTANT:
   * This must NEVER be the entire loan outstanding
   * balance when calculating the periodic fine.
   */
  assessedCoreBalance: number;

  /**
   * How the fine was created.
   */
  source: FineSource;

  createdBy?: LoanActor;

  /**
   * Actual timestamp when the fine record was created.
   */
  createdAt: Date;
}

/* =========================================================
   STOP / RESUME FINES
========================================================= */

export interface StopLoanFineInput {
  reason: string;

  stoppedBy: LoanActor;
}

/* =========================================================
   FINE WAIVER
========================================================= */

export interface LoanWaiver {
  id: string;

  /**
   * Immutable waiver idempotency/reference key.
   */
  waiverReference: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  /**
   * Amount of fine being waived.
   */
  amount: number;

  reason: string;

  waivedBy: LoanActor;

  createdAt: Date;
}

/* =========================================================
   CREATE FINE WAIVER
========================================================= */

export interface CreateLoanWaiverInput {
  /**
   * Immutable idempotency key supplied by the client.
   *
   * Used to prevent duplicate waiver records when a
   * request is retried after an uncertain network failure.
   */
  waiverReference: string;

  loanId: string;

  amount: number;

  reason: string;

  waivedBy: LoanActor;
}

/* =========================================================
   ASSESSMENT
========================================================= */

export interface LoanAssessment {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  memberNumber: string;

  /**
   * Fixed repayment cycle number.
   */
  periodNumber: number;

  /**
   * Beginning of this repayment cycle.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  periodStart: CalendarDate;

  /**
   * End of this repayment cycle.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   *
   * A fine can only be assessed after this period
   * has been completed.
   */
  periodEnd: CalendarDate;

  /**
   * Calendar date on which the assessment was created.
   *
   * Stored as:
   *
   *   YYYY-MM-DD
   */
  assessmentDate: CalendarDate;

  /**
   * Core loan balance at the beginning of the period.
   *
   * This is useful for the audit trail and loan
   * accounting, but it is NOT the basis for the
   * periodic fine.
   */
  openingCoreBalance: number;

  /**
   * Amount the member was contractually expected
   * to repay during this period.
   *
   * Normally equals:
   *
   * loan.installmentAmount
   */
  expectedInstallment: number;

  /**
   * Total repayments recorded during this period.
   */
  paymentsDuringPeriod: number;

  /**
   * Amount of the expected installment that remained
   * unpaid at the end of this period.
   *
   * Formula:
   *
   * max(
   *   0,
   *   expectedInstallment - paymentsDuringPeriod
   * )
   */
  installmentShortfall: number;

  /**
   * Kept for compatibility with existing application
   * code.
   *
   * Under the new installment-based fine model,
   * this equals installmentShortfall.
   *
   * It must NOT contain the entire loan outstanding
   * balance for purposes of calculating the fine.
   */
  balanceBeforeFine: number;

  /**
   * True when the member made at least one repayment
   * during this period.
   *
   * This does NOT necessarily mean the installment
   * was fully satisfied.
   */
  paymentMade: boolean;

  /**
   * True when the member failed to cover the full
   * expected installment for this period.
   *
   * Equivalent to:
   *
   * installmentShortfall > 0
   */
  defaulted: boolean;

  /**
   * Fine percentage applicable to this period.
   */
  fineRate: number;

  /**
   * Fine calculated for this specific period.
   *
   * Formula:
   *
   * installmentShortfall * fineRate
   */
  fineAmount: number;

  /**
   * Human-readable assessment state.
   */
  status: LoanAssessmentStatus;

  createdAt: Date;
}

/* =========================================================
   AUDIT
========================================================= */

export type LoanAuditAction =
  | "created"
  | "authorized"
  | "updated"
  | "repayment_recorded"
  | "fine_recorded"
  | "fine_stopped"
  | "assessment_recorded"
  | "waiver_recorded"
  | "cancelled"
  | "completed"
  | "defaulted";

export interface LoanAuditEntry {
  id: string;

  loanId: string;

  loanNumber: string;

  action: LoanAuditAction;

  actor: LoanActor;

  /**
   * Structured audit information.
   *
   * This may contain previous/new values,
   * calculation details, references, reasons,
   * or other immutable audit information.
   */
  details: Record<string, unknown>;

  createdAt: Date;
}

/* =========================================================
   LIST OPTIONS
========================================================= */

export interface LoanListOptions {
  page?: number;

  limit?: number;

  status?: LoanStatus;

  type?: LoanType;

  repaymentStatus?: LoanRepaymentStatus;

  memberId?: string;

  /**
   * Calendar date filter.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  repaymentDate?: CalendarDate;

  /**
   * Calendar date filter.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  endDate?: CalendarDate;

  search?: string;
}

/* =========================================================
   PAGINATION
========================================================= */

export interface PaginatedLoans {
  loans: Loan[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
}

/* =========================================================
   SUMMARY
========================================================= */

export interface LoanSummary {
  totalLoans: number;

  activeLoans: number;

  completedLoans: number;

  pendingLoans: number;

  cancelledLoans: number;

  defaultedLoans: number;

  totalPrincipal: number;

  totalInterest: number;

  totalFines: number;

  totalWaivedFines: number;

  totalPaid: number;

  totalOutstanding: number;
}

/* =========================================================
   UPDATE LOAN
========================================================= */

export type UpdateLoanInput = {
  type?: LoanType;

  principal?: number;

  installmentAmount?: number;

  /**
   * Calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  disbursementDate?: CalendarDate;

  /**
   * Calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  repaymentDate?: CalendarDate;

  /**
   * Calendar date.
   *
   * Expected format:
   *
   *   YYYY-MM-DD
   */
  endDate?: CalendarDate;

  guarantor?: LoanGuarantor;
};