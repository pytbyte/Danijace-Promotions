export type MemberStatus =
  | "active"
  | "inactive"
  | "blacklisted";

export type MemberGender =
  | "male"
  | "female"
  | "other";

/* =========================================================
   MEMBER
========================================================= */

export type Member = {
  _id?: string;

  membershipNumber: string;

  firstName: string;
  middleName?: string;
  lastName: string;

  gender?: MemberGender;
  dateOfBirth?: string;

  phone: string;
  email?: string;

  nationalId?: string;

  address?: string;
  city?: string;
  county?: string;

  occupation?: string;

  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;

  joinDate: string;

  status: MemberStatus;

  profileImage?: string;

  notes?: string;

  createdBy: string;
  updatedBy?: string;

  createdAt: string;
  updatedAt: string;
};

/* =========================================================
   MEMBER FINANCIAL SUMMARY
========================================================= */

export type MemberFinancialSummary = {
  /**
   * Current confirmed savings balance.
   *
   * Pending transactions must not affect this value.
   */
  savingsBalance: number;

  /**
   * Total confirmed deposits.
   */
  totalDeposits: number;

  /**
   * Total confirmed withdrawals/outflows.
   */
  totalWithdrawals: number;

  /**
   * Current/latest loan information, when applicable.
   */
  loan?: {
    loanNumber: string;

    status:
      | "pending"
      | "active"
      | "completed"
      | "cancelled";

    principal: number;

    totalDue: number;

    amountPaid: number;

    totalFines: number;

    outstandingBalance: number;
    installmentAmount: number;
    endDate: string;

    firstDueDate: string;

    fineStatus:
      | "active"
      | "stopped";
  };
};

/* =========================================================
   MEMBER WITH FINANCIAL SUMMARY
========================================================= */

export type MemberWithFinancialSummary = Member & {
  financialSummary: MemberFinancialSummary;
};