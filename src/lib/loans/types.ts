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
 * All loan dates that represent a financial/business calendar
 * day are stored and transported as:
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
 * - repayment transactionDate
 *
 * The value selected or determined by the business logic
 * should be the value stored in MongoDB.
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
 * - transactionAt
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
 * - Fines are calculated independently for each repayment
 *   cycle.
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
 * Canonical format:
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
   *
   *   7
   */
  repaymentCycleDays: number;

  /**
   * Percentage used when calculating a fine.
   *
   * Example:
   *
   *   0.10 = 10%
   */
  fineRate: number;

  emergencyLoansEnabled: boolean;

  regularLoansEnabled: boolean;

  updatedBy: LoanActor;

  createdAt: Date;

  updatedAt: Date;
}

/* =========================================================
   WEEKLY REPAYMENT BREAKDOWN
========================================================= */

/**
 * Status of an individual repayment cycle.
 *
 * paid:
 *   The installment has been fully covered.
 *
 * partial:
 *   The installment is not fully covered and some
 *   payment has already been allocated to it.
 *
 * current:
 *   This is the currently open repayment cycle.
 *
 * unpaid:
 *   The cycle is complete but no payment has been
 *   allocated toward it.
 */
export type WeeklyRepaymentPeriodStatus =
  | "paid"
  | "partial"
  | "current"
  | "unpaid";

/**
 * Response-only representation of one repayment cycle.
 *
 * This is NOT stored in MongoDB.
 */
export interface WeeklyRepaymentBreakdownPeriod {
  periodNumber: number;
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
  installment: number;
  allocated: number;
  balance: number;
  fine: number;
  status: WeeklyRepaymentPeriodStatus;
}

/**
 * Response-only representation of how an individual
 * repayment was allocated.
 *
 * A single payment can produce multiple allocation
 * records when it covers more than one installment.
 *
 * Example:
 *
 * Payment = 5,000
 *
 * Period 1 needs = 2,000
 * Period 2 needs = 2,000
 * Period 3 needs = 1,000
 *
 * The backend can therefore return three allocation
 * records for the same payment.
 */
export interface WeeklyRepaymentAllocation {
  /**
   * Globally deterministic allocation order within
   * the returned calculation.
   */
  allocationNumber: number;

  /**
   * Identifies the original payment.
   *
   * This is response-only ordering information.
   */
  paymentSequence: number;

  /**
   * Calendar date on which the payment occurred.
   */
  paymentDate: CalendarDate;

  /**
   * Original amount of the payment.
   */
  paymentAmount: number;

  /**
   * Repayment cycle receiving this allocation.
   */
  periodNumber: number;

  periodStart: CalendarDate;

  periodEnd: CalendarDate;

  /**
   * Amount of this payment applied to this period.
   */
  amountApplied: number;

  /**
   * Period balance immediately before this allocation.
   */
  beforeRemaining: number;

  /**
   * Period balance immediately after this allocation.
   */
  afterRemaining: number;

  /**
   * Portion of the original payment still available
   * after this allocation.
   *
   * If greater than zero, the payment may continue
   * into the next unpaid installment.
   */
  remainingPayment: number;

  /**
   * True when this allocation completely cleared
   * the current installment and some portion of the
   * payment continued toward the next installment.
   */
  carriedForward: boolean;
}

/**
 * Response-only record describing payment credit
 * that remained after all displayed repayment cycles
 * were fully covered.
 *
 * This credit does NOT reduce the displayed weekly
 * repayment balance.
 */
export interface WeeklyRepaymentSurplus {
  paymentSequence: number;

  paymentDate: CalendarDate;

  paymentAmount: number;

  /**
   * Amount of the payment that was not required by
   * any installment represented in the calculation.
   */
  unusedCredit: number;
}

/**
 * Complete response-only weekly repayment calculation.
 *
 * This is deliberately not persisted in MongoDB.
 *
 * The backend calculates it from:
 *
 * - loan
 * - assessments
 * - repayments
 *
 * The frontend should display this object directly
 * rather than reconstructing repayment allocation logic.
 */
export interface WeeklyRepaymentBreakdown {
  installmentAmount: number;
  cycleDays: number;
  latestCompletedPeriod: number;
  currentPeriodNumber: number;

  completedBalance: number;
  currentBalance: number;
  totalBalance: number;

  totalFines: number;

  periods: WeeklyRepaymentBreakdownPeriod[];
  allocations: WeeklyRepaymentAllocation[];
  surpluses: WeeklyRepaymentSurplus[];
}

/* =========================================================
   LOAN
========================================================= */

export interface Loan {
  id: string;

  loanNumber: string;

  completedInstallmentBalance: number;

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
   *
   *   0.30 = 30%
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
   *
   *   0.10 = 10%
   */
  fineRate: number;

  /**
   * Number of days in one repayment assessment cycle.
   *
   * Default:
   *
   *   7
   */
  repaymentCycleDays: number;

  /**
   * Contractual amount expected from the member
   * during each repayment cycle.
   *
   * With repaymentCycleDays = 7, this is the
   * member's weekly installment.
   */
  installmentAmount: number;

  /**
   * Current amount the member needs to pay toward the
   * weekly/current repayment obligation.
   *
   * This includes:
   *
   * - unpaid balances carried from completed cycles
   * - the current cycle's contractual installment
   * - less payments allocated to those cycles
   *
   * This is a response/calculation field.
   *
   * It is NOT stored in MongoDB.
   */
  weeklyRepaymentBalance?: number;

  /**
   * Complete response-only explanation of the
   * weekly repayment balance.
   *
   * This is calculated by the loan service from the
   * loan's assessments and repayments.
   *
   * It is NOT stored in MongoDB.
   *
   * The frontend should use this object to display:
   *
   * - completed installment balances
   * - current installment balance
   * - repayment periods
   * - payment allocations
   * - carried-forward payments
   * - unused/future credit
   */
  weeklyRepaymentBreakdown?: WeeklyRepaymentBreakdown;

  /**
   * Calendar date on which the loan was disbursed.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  disbursementDate: CalendarDate;

  /**
   * Scheduled repayment calendar date.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  repaymentDate: CalendarDate;

  /**
   * Final contractual loan end date.
   *
   * Format:
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
   * Format:
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
   * Authoritative projection of repayments
   * recorded against this loan.
   */
  amountPaid: number;

  /**
   * Authoritative projection of assessed fines.
   */
  totalFines: number;

  /**
   * Authoritative projection of approved
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
   *
   *   0
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
   *
   *   0.10 = 10%
   *
   * When omitted, the authoritative loan settings
   * fineRate should be used.
   */
  fineRate?: number;

  /**
   * Expected repayment amount for each repayment cycle.
   *
   * With repaymentCycleDays = 7, this represents
   * the member's weekly installment.
   */
  installmentAmount: number;

  /**
   * Number of days in each repayment assessment cycle.
   *
   * Default:
   *
   *   7
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
   * Used as the idempotency key to prevent duplicate
   * repayment records.
   */
  transactionReference: string;

  /**
   * Calendar date on which the payment occurred.
   *
   * Format:
   *
   *   YYYY-MM-DD
   *
   * This is intentionally NOT a JavaScript Date.
   */
  transactionDate: CalendarDate;

  /**
   * Exact timestamp of the original bank transaction.
   *
   * This is the actual moment the bank transaction occurred,
   * as reported by the bank SMS.
   *
   * IMPORTANT:
   *
   * This is NOT:
   *
   * - the Android SMS receipt timestamp
   * - the GEO-SHUA repayment createdAt timestamp
   *
   * It is used for historical loan resolution and replay
   * protection.
   *
   * Example:
   *
   *   2026-09-05T10:17:00.000Z
   *
   * Manual/system repayments may not have this value.
   */
  transactionAt?: Date;

  source: TransactionSource;

  /**
   * Original SMS/bank message when the payment
   * originated from SMS processing.
   */
  rawMessage?: string;

  recordedBy?: LoanActor;

  /**
   * Actual timestamp when this repayment record
   * was created in the system.
   */
  createdAt: Date;
}

/* =========================================================
   CREATE LOAN REPAYMENT
========================================================= */

export interface CreateLoanRepaymentInput {
  loanId?: string;

  memberId?: string;

  amount: number;

  transactionReference: string;

  /**
   * Canonical financial calendar date.
   *
   * Example:
   *
   *   2026-09-05
   */
  transactionDate: CalendarDate;

  /**
   * Exact timestamp of the bank transaction.
   *
   * This is NOT the Android SMS receipt timestamp.
   *
   * It is the actual financial event time reported
   * by the bank and is used for historical loan
   * resolution.
   *
   * In particular, it allows the system to determine
   * whether a payment occurred before or after a loan
   * was authorized.
   */
  transactionAt?: Date;

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
   * Calendar date on which the fine was assessed.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  fineDate: CalendarDate;

  /**
   * Percentage used to calculate this fine.
   *
   * Example:
   *
   *   0.10 = 10%
   */
  fineRate: number;

  /**
   * Fixed repayment assessment cycle number.
   */
  periodNumber: number;

  /**
   * Beginning of the repayment assessment period.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  periodStart: CalendarDate;

  /**
   * End of the repayment assessment period.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  periodEnd: CalendarDate;

  /**
   * Amount the member was expected to repay
   * during this specific period.
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
   */
  installmentShortfall: number;

  /**
   * Amount used as the basis for this fine.
   *
   * For the periodic-installment model this equals
   * installmentShortfall.
   *
   * IMPORTANT:
   *
   * This must NOT be the entire loan outstanding
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
   * request is retried.
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
   * Format:
   *
   *   YYYY-MM-DD
   */
  periodStart: CalendarDate;

  /**
   * End of this repayment cycle.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  periodEnd: CalendarDate;

  /**
   * Calendar date on which the assessment was created.
   *
   * Format:
   *
   *   YYYY-MM-DD
   */
  assessmentDate: CalendarDate;

  /**
   * Core loan balance at the beginning of the period.
   *
   * This is useful for the audit trail but is NOT
   * the basis for calculating the periodic fine.
   */
  openingCoreBalance: number;

  /**
   * Amount the member was contractually expected
   * to repay during this period.
   */
  expectedInstallment: number;

  /**
   * Total repayments recorded during this period.
   */
  paymentsDuringPeriod: number;

  /**
   * Amount of the expected installment that remained
   * unpaid at the end of this period.
   */
  installmentShortfall: number;

  /**
   * Compatibility field.
   *
   * Under the installment-based fine model this equals
   * installmentShortfall.
   *
   * It must NOT contain the entire loan outstanding
   * balance for purposes of calculating the fine.
   */
  balanceBeforeFine: number;

  /**
   * True when the member made at least one repayment
   * during this period.
   */
  paymentMade: boolean;

  /**
   * True when the member failed to cover the full
   * expected installment for this period.
   */
  defaulted: boolean;

  /**
   * Fine percentage applicable to this period.
   */
  fineRate: number;

  /**
   * Fine calculated for this specific period.
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
   * Structured immutable audit information.
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
   * Format:
   *
   *   YYYY-MM-DD
   */
  repaymentDate?: CalendarDate;

  /**
   * Calendar date filter.
   *
   * Format:
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