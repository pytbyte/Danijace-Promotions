"use client";

import React from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

import { Capacitor } from "@capacitor/core";
import {
  Directory,
  Filesystem,
} from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import type {
  Member,
  MemberWithFinancialSummary,
} from "@/lib/members/types";

import type { SavingsTransaction } from "@/lib/savings/types";

/* =========================================================
   CONSTANTS
========================================================= */

const COMPANY_NAME = "GEO-SHUA COMPANY";
const COMPANY_SUBTITLE = "Member Financial Services";

const TRANSACTIONS_ENDPOINT =
  "/api/savings/transactions";

const LOANS_ENDPOINT =
  "/api/loans";

const PHOTO_ENDPOINT =
  "/api/members/photos";

const API_PAGE_LIMIT = 100;

const MONEY_EPSILON = 0.01;

/* =========================================================
   COLORS
========================================================= */

const COLORS = {
  ink: "#17231F",
  brand: "#283730",
  accent: "#5C8D78",
  accentSoft: "#EAF1ED",

  muted: "#68756F",
  subtle: "#8A9690",

  line: "#DCE3DF",
  soft: "#F5F8F6",
  softAlt: "#FAFCFB",

  white: "#FFFFFF",

  positive: "#2E6B4D",
  positiveSoft: "#EAF4EE",

  negative: "#A14C4C",
  negativeSoft: "#F7EEEE",
};

/* =========================================================
   TYPES
========================================================= */

type PdfMember =
  | Member
  | MemberWithFinancialSummary;

type TransactionPageData = {
  transactions?: unknown;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
  totalPages?: unknown;
};

type TransactionsApiResponse = {
  success?: boolean;

  data?:
    | TransactionPageData
    | unknown[]
    | null;

  transactions?: unknown;

  total?: unknown;
  page?: unknown;
  limit?: unknown;
  totalPages?: unknown;

  error?: unknown;
  message?: unknown;
};

type PaginationData = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type StatementTransaction = {
  id: string;

  transactionAt: string;

  description: string;

  reference: string;

  type: string;

  source: string;

  status:
    | "pending"
    | "confirmed"
    | "reversed";

  debit: number;

  credit: number;

  balance: number;

  reason?: string;

  relatedTransactionId?: string;

  sourceReference?: string;

  smsId?: string;
};

type StatementSummary = {
  openingBalance: number;

  totalCredits: number;

  totalDebits: number;

  closingBalance: number;

  transactionCount: number;

  reconciled: boolean;
};

type StatementOptions = {
  from?: string | Date;

  to?: string | Date;
};

type LoanData = {
  loanNumber: string;

  status:
    | "pending"
    | "active"
    | "completed"
    | "cancelled";

  principal: number;

  installmentAmount: number;

  totalDue: number;

  amountPaid: number;

  totalFines: number;

  outstandingBalance: number;

  firstDueDate: string;
  
  disbursmentDate: string;

  endDate: string;

  fineStatus:
    | "active"
    | "stopped";
};

/* =========================================================
   FORMATTING HELPERS
========================================================= */

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return null;
}

function safeString(
  value: unknown,
  fallback = "",
): string {
  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value.trim();
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return String(value);
  }

  return fallback;
}

function safeNumber(
  value: unknown,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const number =
      Number(value);

    if (
      Number.isFinite(number)
    ) {
      return number;
    }
  }

  return 0;
}

function roundMoney(
  value: number,
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return (
    Math.round(
      (value + Number.EPSILON) *
        100,
    ) / 100
  );
}

function formatKES(
  value: number,
): string {
  const amount =
    roundMoney(
      safeNumber(value),
    );

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(amount);
}

function formatKESPlain(
  value: number,
): string {
  const amount =
    roundMoney(
      safeNumber(value),
    );

  return new Intl.NumberFormat(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(amount);
}

function normalizeDate(
  value: unknown,
): string {
  if (value instanceof Date) {
    if (
      !Number.isNaN(
        value.getTime(),
      )
    ) {
      return value
        .toISOString()
        .slice(0, 10);
    }

    return "";
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const trimmed =
      value.trim();

    /*
     * Calendar dates are authoritative
     * business dates in GEO-SHUA.
     *
     * Preserve YYYY-MM-DD exactly instead
     * of converting it through local time.
     */
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        trimmed,
      )
    ) {
      return trimmed;
    }

    const date =
      new Date(trimmed);

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date
        .toISOString()
        .slice(0, 10);
    }

    return "";
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const date =
      new Date(value);

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date
        .toISOString()
        .slice(0, 10);
    }
  }

  const objectValue =
    asRecord(value);

  if (objectValue) {
    const mongoDate =
      objectValue.$date;

    if (
      typeof mongoDate ===
        "string" &&
      mongoDate.trim()
    ) {
      return normalizeDate(
        mongoDate,
      );
    }

    if (
      typeof mongoDate ===
        "number" &&
      Number.isFinite(mongoDate)
    ) {
      return normalizeDate(
        mongoDate,
      );
    }
  }

  /*
   * Never use Unix epoch as a fake
   * business date. Missing dates remain
   * empty and are rendered as Unknown date.
   */
  return "";
}
function isValidDateString(
  value: string,
): boolean {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  return !Number.isNaN(
    date.getTime(),
  );
}

function formatDate(
  value: string | Date,
): string {
  const normalized =
    normalizeDate(value);

  if (
    !isValidDateString(
      normalized,
    )
  ) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  ).format(
    new Date(normalized),
  );
}

function formatDateTime(
  value: string | Date,
): string {
  const normalized =
    normalizeDate(value);

  if (
    !isValidDateString(
      normalized,
    )
  ) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(
    new Date(normalized),
  );
}

/* =========================================================
   MEMBER HELPERS
========================================================= */

function getMemberFullName(
  member: PdfMember,
): string {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(
      (
        value,
      ): value is string =>
        typeof value === "string" &&
        value.trim().length > 0,
    )
    .map(
      (value) =>
        value.trim(),
    )
    .join(" ")
    .trim();
}

function getMemberId(
  member: PdfMember,
): string {
  return safeString(
    member.membershipNumber,
    "N/A",
  );
}

function getMemberStatus(
  member: PdfMember,
): string {
  const status = safeString(
    (member as PdfMember & {
      status?: unknown;
    }).status,
  ).toLowerCase();

  if (!status) {
    return "Unknown";
  }

  if (status === "suspended") {
    return "Blacklisted";
  }

  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) =>
      char.toUpperCase(),
    );
}

function getMemberInitials(
  member: PdfMember,
): string {
  const parts = [
    member.firstName,
    member.middleName,
    member.lastName,
  ].filter(
    (
      value,
    ): value is string =>
      typeof value === "string" &&
      value.trim().length > 0,
  );

  if (
    !parts.length
  ) {
    return "G";
  }

  const first =
    parts[0]
      .trim()
      .charAt(0)
      .toUpperCase();

  const last =
    parts[
      parts.length - 1
    ]
      .trim()
      .charAt(0)
      .toUpperCase();

  return `${first}${last}`;
}

/* =========================================================
   FINANCIAL SUMMARY
========================================================= */

function hasFinancialSummary(
  member: PdfMember,
): member is MemberWithFinancialSummary {
  if (
    !member ||
    typeof member !== "object"
  ) {
    return false;
  }

  if (
    !("financialSummary" in member)
  ) {
    return false;
  }

  const summary =
    member.financialSummary;

  return (
    summary !== null &&
    typeof summary ===
      "object"
  );
}

/* =========================================================
   TRANSACTION HELPERS
========================================================= */

function getRawTransaction(
  transaction: SavingsTransaction,
): Record<string, unknown> {
  return transaction as unknown as Record<
    string,
    unknown
  >;
}

function getTransactionType(
  transaction: SavingsTransaction,
): string {
  return safeString(
    getRawTransaction(
      transaction,
    ).type,
    "transaction",
  ).toLowerCase();
}

function getTransactionSource(
  transaction: SavingsTransaction,
): string {
  return safeString(
    getRawTransaction(
      transaction,
    ).source,
    "unknown",
  ).toLowerCase();
}

function getTransactionDescription(
  transaction: SavingsTransaction,
): string {
  const raw =
    getRawTransaction(
      transaction,
    );

  const explicit =
    safeString(
      raw.description,
    );

  if (explicit) {
    return explicit;
  }

  const reason =
    safeString(
      raw.reason,
    );

  if (reason) {
    return reason;
  }

  switch (
    getTransactionType(
      transaction,
    )
  ) {
    case "deposit":
      return "Savings Deposit";

    case "adjustment":
      return "Savings Adjustment";

    case "reversal":
      return "Transaction Reversal";

    default:
      return "Savings Transaction";
  }
}

function getTransactionReference(
  transaction: SavingsTransaction,
): string {
  const raw =
    getRawTransaction(
      transaction,
    );

  return (
    safeString(
      raw.reference,
    ) ||
    safeString(
      raw.sourceReference,
    ) ||
    safeString(
      raw.smsId,
    ) ||
    safeString(
      raw.id,
    ) ||
    "N/A"
  );
}

function getTransactionStatus(
  transaction: SavingsTransaction,
):
  | "pending"
  | "confirmed"
  | "reversed" {
  const raw =
    getRawTransaction(
      transaction,
    );

  const status =
    safeString(
      raw.status,
      "confirmed",
    ).toLowerCase();

  if (
    status === "pending"
  ) {
    return "pending";
  }

  if (
    status === "reversed"
  ) {
    return "reversed";
  }

  return "confirmed";
}

function getSignedAmount(
  transaction: SavingsTransaction,
): number {
  const raw =
    getRawTransaction(
      transaction,
    );

  const possibleSignedValues =
    [
      raw.signedAmount,
      raw.netAmount,
      raw.balanceChange,
    ];

  for (
    const candidate of
      possibleSignedValues
  ) {
    if (
      typeof candidate ===
        "number" &&
      Number.isFinite(
        candidate,
      )
    ) {
      return candidate;
    }

    if (
      typeof candidate ===
        "string" &&
      candidate.trim()
    ) {
      const parsed =
        Number(candidate);

      if (
        Number.isFinite(
          parsed,
        )
      ) {
        return parsed;
      }
    }
  }

  const amount =
    Math.abs(
      safeNumber(
        raw.amount,
      ),
    );

  const type =
    getTransactionType(
      transaction,
    );

  switch (type) {
    case "deposit":
      return amount;

    case "adjustment":
      return -amount;

    case "reversal":
      return -amount;

    default: {
      const direction =
        safeString(
          raw.direction,
        ).toLowerCase();

      if (
        direction ===
          "credit" ||
        direction === "in"
      ) {
        return amount;
      }

      if (
        direction ===
          "debit" ||
        direction === "out"
      ) {
        return -amount;
      }

      return amount;
    }
  }
}

function isStatementTransaction(
  transaction: SavingsTransaction,
): boolean {
  return (
    getTransactionStatus(
      transaction,
    ) !== "pending"
  );
}

/* =========================================================
   TRANSACTION NORMALIZATION
========================================================= */

function normalizeTransaction(
  value: unknown,
): SavingsTransaction | null {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const raw =
    value as Partial<SavingsTransaction> & {
      _id?: unknown;
      description?: unknown;
      signedAmount?: unknown;
      netAmount?: unknown;
      balanceChange?: unknown;
      direction?: unknown;
    };

  const rawId =
    raw.id ??
    raw._id;

  if (
    rawId ===
      undefined ||
    rawId === null ||
    String(
      rawId,
    ).trim() === ""
  ) {
    return null;
  }

  return {
    ...raw,

    id: String(
      rawId,
    ),

    memberId: String(
      raw.memberId ?? "",
    ),

    memberName:
      String(
        raw.memberName ??
          "Unknown member",
      ),

    amount:
      safeNumber(
        raw.amount,
      ),

    reference:
      raw.reference ===
        undefined ||
      raw.reference === null
        ? undefined
        : String(
            raw.reference,
          ),

    smsId:
      raw.smsId ===
        undefined ||
      raw.smsId === null
        ? undefined
        : String(
            raw.smsId,
          ),

    sourceReference:
      raw.sourceReference ===
        undefined ||
      raw.sourceReference === null
        ? undefined
        : String(
            raw.sourceReference,
          ),

    reason:
      raw.reason ===
        undefined ||
      raw.reason === null
        ? undefined
        : String(
            raw.reason,
          ),

    relatedTransactionId:
      raw.relatedTransactionId ===
        undefined ||
      raw.relatedTransactionId === null
        ? undefined
        : String(
            raw.relatedTransactionId,
          ),

    transactionAt:
      normalizeDate(
        raw.transactionAt,
      ),

    createdAt:
      normalizeDate(
        raw.createdAt,
      ),

    updatedAt:
      normalizeDate(
        raw.updatedAt,
      ),
  } as SavingsTransaction;
}

/* =========================================================
   API RESPONSE
========================================================= */

async function readJsonResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text =
    await response.text();

  if (
    !text.trim()
  ) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(text);

    return (
      asRecord(parsed) ??
      {}
    );
  } catch {
    throw new Error(
      `The server returned an invalid JSON response (${response.status}).`,
    );
  }
}

/* =========================================================
   API PAGE EXTRACTION
========================================================= */

function extractTransactions(
  payload: TransactionsApiResponse,
): SavingsTransaction[] {
  const dataRecord =
    asRecord(
      payload.data,
    );

  let candidate:
    | unknown
    | undefined;

  if (
    Array.isArray(
      payload.data,
    )
  ) {
    candidate =
      payload.data;
  } else if (
    dataRecord
  ) {
    candidate =
      dataRecord.transactions;
  }

  if (
    candidate ===
    undefined
  ) {
    candidate =
      payload.transactions;
  }

  if (
    !Array.isArray(
      candidate,
    )
  ) {
    return [];
  }

  return candidate
    .map(
      (
        item: unknown,
      ) =>
        normalizeTransaction(
          item,
        ),
    )
    .filter(
      (
        item,
      ): item is SavingsTransaction =>
        Boolean(item),
    );
}

function extractPagination(
  payload: TransactionsApiResponse,
): PaginationData {
  const dataRecord =
    asRecord(
      payload.data,
    );

  const source =
    dataRecord ??
    payload;

  return {
    page: Math.max(
      1,
      Math.floor(
        safeNumber(
          source.page,
        ) || 1,
      ),
    ),

    limit: Math.max(
      1,
      Math.floor(
        safeNumber(
          source.limit,
        ) ||
          API_PAGE_LIMIT,
      ),
    ),

    total: Math.max(
      0,
      Math.floor(
        safeNumber(
          source.total,
        ),
      ),
    ),

    totalPages:
      Math.max(
        1,
        Math.floor(
          safeNumber(
            source.totalPages,
          ) || 1,
        ),
      ),
  };
}

/* =========================================================
   FETCH TRANSACTION PAGE
========================================================= */

async function fetchTransactionPage(
  memberId: string,
  page: number,
): Promise<{
  transactions: SavingsTransaction[];
  pagination: PaginationData;
}> {
  const params =
    new URLSearchParams();

  params.set(
    "memberId",
    memberId,
  );

  params.set(
    "page",
    String(page),
  );

  params.set(
    "limit",
    String(
      API_PAGE_LIMIT,
    ),
  );

  const response =
    await fetch(
      `${TRANSACTIONS_ENDPOINT}?${params.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        credentials:
          "same-origin",
        headers: {
          Accept:
            "application/json",
        },
      },
    );

  const payload =
    (await readJsonResponse(
      response,
    )) as TransactionsApiResponse;

  if (
    !response.ok ||
    payload.success === false
  ) {
    throw new Error(
      safeString(
        payload.error ??
          payload.message,
        `Unable to load savings transactions (server ${response.status}).`,
      ),
    );
  }

  return {
    transactions:
      extractTransactions(
        payload,
      ),

    pagination:
      extractPagination(
        payload,
      ),
  };
}

/* =========================================================
   FETCH ALL MEMBER TRANSACTIONS
========================================================= */

async function fetchMemberTransactions(
  memberId: string,
): Promise<SavingsTransaction[]> {
  if (
    !memberId.trim()
  ) {
    return [];
  }

  const allTransactions =
    new Map<
      string,
      SavingsTransaction
    >();

  let page = 1;
  let totalPages = 1;

  do {
    const result =
      await fetchTransactionPage(
        memberId,
        page,
      );

    for (
      const transaction of
        result.transactions
    ) {
      /*
       * Never allow a malformed API response
       * to contaminate another member's statement.
       */
      if (
        transaction.memberId &&
        transaction.memberId !==
          memberId
      ) {
        continue;
      }

      allTransactions.set(
        transaction.id,
        transaction,
      );
    }

    totalPages =
      Math.max(
        totalPages,
        result.pagination
          .totalPages,
      );

    page += 1;
  } while (
    page <= totalPages
  );

  return Array.from(
    allTransactions.values(),
  )
    .filter(
      isStatementTransaction,
    )
    .sort(
      (left, right) =>
        new Date(
          normalizeDate(
            left.transactionAt,
          ),
        ).getTime() -
        new Date(
          normalizeDate(
            right.transactionAt,
          ),
        ).getTime(),
    );
}

/* =========================================================
   BUILD FULL ACCOUNT LEDGER
========================================================= */

function buildFullLedger(
  transactions: SavingsTransaction[],
  closingBalanceHint: number,
): StatementTransaction[] {
  if (
    !transactions.length
  ) {
    return [];
  }

  let runningBalance =
    roundMoney(
      closingBalanceHint,
    );

  const descending =
    [...transactions].sort(
      (left, right) =>
        new Date(
          normalizeDate(
            right.transactionAt,
          ),
        ).getTime() -
        new Date(
          normalizeDate(
            left.transactionAt,
          ),
        ).getTime(),
    );

  const reconstructed =
    new Map<
      string,
      number
    >();

  for (
    const transaction of
      descending
  ) {
    const signedAmount =
      roundMoney(
        getSignedAmount(
          transaction,
        ),
      );

    /*
     * balance_after =
     * balance_before + signedAmount
     *
     * Therefore:
     *
     * balance_before =
     * balance_after - signedAmount
     */
    reconstructed.set(
      transaction.id,
      roundMoney(
        runningBalance,
      ),
    );

    runningBalance =
      roundMoney(
        runningBalance -
          signedAmount,
      );
  }

  return transactions.map(
    (transaction) => {
      const afterBalance =
        reconstructed.get(
          transaction.id,
        ) ?? 0;

      const signedAmount =
        roundMoney(
          getSignedAmount(
            transaction,
          ),
        );

      const beforeBalance =
        roundMoney(
          afterBalance -
            signedAmount,
        );

      const isCredit =
        signedAmount > 0;

      const debit =
        isCredit
          ? 0
          : Math.abs(
              signedAmount,
            );

      const credit =
        isCredit
          ? signedAmount
          : 0;

      const raw =
        getRawTransaction(
          transaction,
        );

      return {
        id: transaction.id,

        transactionAt:
          normalizeDate(
            transaction.transactionAt,
          ),

        description:
          getTransactionDescription(
            transaction,
          ),

        reference:
          getTransactionReference(
            transaction,
          ),

        type:
          getTransactionType(
            transaction,
          ),

        source:
          getTransactionSource(
            transaction,
          ),

        status:
          getTransactionStatus(
            transaction,
          ),

        debit:
          roundMoney(
            debit,
          ),

        credit:
          roundMoney(
            credit,
          ),

        balance:
          roundMoney(
            beforeBalance +
              signedAmount,
          ),

        reason:
          safeString(
            raw.reason,
          ) || undefined,

        relatedTransactionId:
          safeString(
            raw.relatedTransactionId,
          ) || undefined,

        sourceReference:
          safeString(
            raw.sourceReference,
          ) || undefined,

        smsId:
          safeString(
            raw.smsId,
          ) || undefined,
      };
    },
  );
}

/* =========================================================
   PERIOD HELPERS
========================================================= */

function getPeriodDate(
  value:
    | string
    | Date
    | undefined,
  fallback: Date,
): Date {
  if (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime(),
    )
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const parsed =
      new Date(value);

    if (
      !Number.isNaN(
        parsed.getTime(),
      )
    ) {
      return parsed;
    }
  }

  return fallback;
}

function buildStatementPeriod(
  member: PdfMember,
  options: StatementOptions,
): {
  from: Date;
  to: Date;
} {
  const joinDate =
    getPeriodDate(
      member.joinDate,
      new Date(0),
    );

  const today =
    new Date();

  const from =
    getPeriodDate(
      options.from,
      joinDate,
    );

  const to =
    getPeriodDate(
      options.to,
      today,
    );

  if (
    from.getTime() <=
    to.getTime()
  ) {
    return {
      from,
      to,
    };
  }

  return {
    from: to,
    to: from,
  };
}

/* =========================================================
   STATEMENT BUILDING
========================================================= */

function buildStatementTransactions(
  fullLedger: StatementTransaction[],
  periodFrom: Date,
  periodTo: Date,
): {
  transactions: StatementTransaction[];
  openingBalance: number;
} {
  const ordered =
    [...fullLedger].sort(
      (left, right) =>
        new Date(
          left.transactionAt,
        ).getTime() -
        new Date(
          right.transactionAt,
        ).getTime(),
    );

  let openingBalance = 0;

  /*
   * Take the balance immediately before
   * the selected statement period.
   */
  for (
    const transaction of
      ordered
  ) {
    const transactionTime =
      new Date(
        transaction.transactionAt,
      ).getTime();

    if (
      transactionTime <
      periodFrom.getTime()
    ) {
      openingBalance =
        roundMoney(
          transaction.balance,
        );

      continue;
    }

    break;
  }

  const periodTransactions =
    ordered.filter(
      (transaction) => {
        const time =
          new Date(
            transaction.transactionAt,
          ).getTime();

        return (
          time >=
            periodFrom.getTime() &&
          time <=
            periodTo.getTime()
        );
      },
    );

  return {
    transactions:
      periodTransactions,

    openingBalance:
      roundMoney(
        openingBalance,
      ),
  };
}

function buildStatementSummary(
  transactions: StatementTransaction[],
  openingBalance: number,
): StatementSummary {
  const totalCredits =
    roundMoney(
      transactions.reduce(
        (
          total,
          transaction,
        ) =>
          total +
          transaction.credit,
        0,
      ),
    );

  const totalDebits =
    roundMoney(
      transactions.reduce(
        (
          total,
          transaction,
        ) =>
          total +
          transaction.debit,
        0,
      ),
    );

  const closingBalance =
    transactions.length
      ? roundMoney(
          transactions[
            transactions.length - 1
          ].balance,
        )
      : roundMoney(
          openingBalance,
        );

  const calculatedClosing =
    roundMoney(
      openingBalance +
        totalCredits -
        totalDebits,
    );

  const reconciled =
    Math.abs(
      calculatedClosing -
        closingBalance,
    ) <=
    MONEY_EPSILON;

  return {
    openingBalance:
      roundMoney(
        openingBalance,
      ),

    totalCredits,

    totalDebits,

    closingBalance,

    transactionCount:
      transactions.length,

    reconciled,
  };
}

/* =========================================================
   LOAN
========================================================= */

type LoanApiResponse = {
  success?: boolean;

  data?:
    | unknown[]
    | Record<string, unknown>
    | null;

  error?: unknown;

  message?: unknown;
};

function getLoanListFromApiResponse(
  payload: LoanApiResponse,
): Record<string, unknown>[] {
  const data =
    payload.data;

  if (
    Array.isArray(data)
  ) {
    return data
      .map(
        (item) =>
          asRecord(item),
      )
      .filter(
        (
          item,
        ): item is Record<
          string,
          unknown
        > =>
          Boolean(item),
      );
  }

  const dataRecord =
    asRecord(data);

  if (!dataRecord) {
    return [];
  }

  const loans =
    dataRecord.loans;

  if (
    !Array.isArray(loans)
  ) {
    return [];
  }

  return loans
    .map(
      (item) =>
        asRecord(item),
    )
    .filter(
      (
        item,
      ): item is Record<
        string,
        unknown
      > =>
        Boolean(item),
    );
}

async function fetchMemberLoan(
  memberId: string,
  summaryLoanNumber?: string,
): Promise<
  Record<string, unknown> | null
> {
  const normalizedMemberId =
    safeString(memberId);

  if (!normalizedMemberId) {
    return null;
  }

  try {
    const params =
      new URLSearchParams();

    params.set(
      "memberId",
      normalizedMemberId,
    );

    params.set(
      "page",
      "1",
    );

    params.set(
      "limit",
      "1000",
    );

    const response =
      await fetch(
        `${LOANS_ENDPOINT}?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          credentials:
            "same-origin",
          headers: {
            Accept:
              "application/json",
          },
        },
      );

    const text =
      await response.text();

    if (
      !response.ok ||
      !text.trim()
    ) {
      return null;
    }

    let payload:
      LoanApiResponse;

    try {
      payload =
        JSON.parse(
          text,
        ) as LoanApiResponse;
    } catch {
      return null;
    }

    if (
      payload.success === false
    ) {
      return null;
    }

    const loans =
      getLoanListFromApiResponse(
        payload,
      );

    if (
      !loans.length
    ) {
      return null;
    }

    /*
     * Prefer the exact loan already
     * referenced by the member financial
     * summary. This prevents accidentally
     * attaching an older loan to the PDF.
     */
    const normalizedLoanNumber =
      safeString(
        summaryLoanNumber,
      );

    if (
      normalizedLoanNumber
    ) {
      const exactLoan =
        loans.find(
          (loan) =>
            safeString(
              loan.loanNumber,
            ) ===
            normalizedLoanNumber,
        );

      if (exactLoan) {
        return exactLoan;
      }
    }

    /*
     * If the summary did not provide a loan
     * number, prefer an active loan, then a
     * pending loan, then any returned loan.
     */
    return (
      loans.find(
        (loan) =>
          safeString(
            loan.status,
          ).toLowerCase() ===
          "active",
      ) ??
      loans.find(
        (loan) =>
          safeString(
            loan.status,
          ).toLowerCase() ===
          "pending",
      ) ??
      loans[0] ??
      null
    );
  } catch {
    return null;
  }
}

function getLoanFromMember(
  member: PdfMember,
  authoritativeLoan:
    | Record<string, unknown>
    | null,
): LoanData | null {
  const summaryLoan =
    hasFinancialSummary(
      member,
    )
      ? asRecord(
          member.financialSummary
            .loan,
        )
      : null;

  if (
    !summaryLoan &&
    !authoritativeLoan
  ) {
    return null;
  }

  const source =
    authoritativeLoan ??
    summaryLoan;

  if (!source) {
    return null;
  }

  const loanNumber =
    safeString(
      source.loanNumber,
    ) ||
    safeString(
      summaryLoan?.loanNumber,
      "N/A",
    );

  const installmentAmount =
    safeNumber(
      source.installmentAmount,
    );

  const endDate =
    normalizeDate(
      source.endDate ??
        summaryLoan?.endDate,
    );

  /*
   * Financial values come from the
   * authoritative loan record whenever
   * available. The member summary is used
   * only as a fallback for projection values
   * that are not returned by the loan list.
   */
  return {
    loanNumber:
      safeString(
        loanNumber,
        "N/A",
      ),

    status:
      source.status ===
        "pending" ||
      source.status ===
        "active" ||
      source.status ===
        "completed" ||
      source.status ===
        "cancelled"
        ? source.status
        : (
            summaryLoan?.status ===
              "pending" ||
            summaryLoan?.status ===
              "active" ||
            summaryLoan?.status ===
              "completed" ||
            summaryLoan?.status ===
              "cancelled"
              ? summaryLoan.status
              : "active"
          ),

    principal:
      roundMoney(
        safeNumber(
          source.principal ??
            summaryLoan?.principal,
        ),
      ),

    installmentAmount:
      roundMoney(
        installmentAmount ||
          safeNumber(
            summaryLoan?.installmentAmount,
          ),
      ),

    totalDue:
      roundMoney(
        safeNumber(
          source.totalDue ??
            summaryLoan?.totalDue,
        ),
      ),

    amountPaid:
      roundMoney(
        safeNumber(
          source.amountPaid ??
            summaryLoan?.amountPaid,
        ),
      ),

    totalFines:
      roundMoney(
        safeNumber(
          source.totalFines ??
            summaryLoan?.totalFines,
        ),
      ),

    outstandingBalance:
      roundMoney(
        safeNumber(
          source.outstandingBalance ??
            summaryLoan?.outstandingBalance,
        ),
      ),

    firstDueDate:
      normalizeDate(
        source.firstDueDate ??
          summaryLoan?.firstDueDate,
      ),

    endDate,

    fineStatus:
      source.fineStatus ===
        "active" ||
      source.fineStatus ===
        "stopped"
        ? source.fineStatus
        : (
            summaryLoan?.fineStatus ===
              "active" ||
            summaryLoan?.fineStatus ===
              "stopped"
              ? summaryLoan.fineStatus
              : "active"
          ),
  };
}

/* =========================================================
   PHOTO
========================================================= */

async function getMemberPhoto(
  membershipNumber: string,
): Promise<
  string | null
> {
  if (
    !membershipNumber.trim()
  ) {
    return null;
  }

  try {
    const response =
      await fetch(
        `${PHOTO_ENDPOINT}/${encodeURIComponent(
          membershipNumber,
        )}`,
        {
          method: "GET",
          cache: "no-store",
          credentials:
            "same-origin",
        },
      );

    if (
      !response.ok
    ) {
      return null;
    }

    const blob =
      await response.blob();

    if (
      !blob.size
    ) {
      return null;
    }

    return await new Promise<
      string | null
    >(
      (
        resolve,
      ) => {
        const reader =
          new FileReader();

        reader.onload =
          () => {
            const result =
              reader.result;

            resolve(
              typeof result ===
                "string"
                ? result
                : null,
            );
          };

        reader.onerror =
          () => {
            resolve(null);
          };

        reader.readAsDataURL(
          blob,
        );
      },
    );
  } catch {
    return null;
  }
}

/* =========================================================
   ANDROID PDF HELPERS
========================================================= */

/**
 * Convert the generated browser Blob into a base64
 * string suitable for Capacitor Filesystem.writeFile().
 *
 * This helper does NOT alter the PDF itself.
 */
async function blobToBase64(
  blob: Blob,
): Promise<string> {
  return await new Promise(
    (
      resolve,
      reject,
    ) => {
      const reader =
        new FileReader();

      reader.onloadend =
        () => {
          const result =
            reader.result;

          if (
            typeof result !==
            "string"
          ) {
            reject(
              new Error(
                "Unable to convert PDF to base64.",
              ),
            );

            return;
          }

          const commaIndex =
            result.indexOf(",");

          resolve(
            commaIndex >= 0
              ? result.slice(
                  commaIndex + 1,
                )
              : result,
          );
        };

      reader.onerror =
        () => {
          reject(
            new Error(
              "Unable to read generated PDF.",
            ),
          );
        };

      reader.readAsDataURL(
        blob,
      );
    },
  );
}

/**
 * Android-native PDF delivery.
 *
 * The PDF is temporarily written into the app's
 * native cache directory and then handed to Android's
 * native share/save system.
 *
 * This avoids relying on:
 *
 *   URL.createObjectURL()
 *   <a download>
 *   anchor.click()
 *
 * which is unreliable inside a Capacitor Android WebView.
 */
async function savePdfOnAndroid(
  blob: Blob,
  fileName: string,
): Promise<void> {
  const base64 =
    await blobToBase64(
      blob,
    );

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory:
      Directory.Cache,
  });

  const { uri } =
    await Filesystem.getUri({
      path: fileName,
      directory:
        Directory.Cache,
    });

  if (!uri) {
    throw new Error(
      "Unable to obtain the native PDF file URI.",
    );
  }

  await Share.share({
    title: fileName,

    text:
      "GEO-SHUA account statement",

    url: uri,

    dialogTitle:
      "Save or share statement",
  });
}

/* =========================================================
   STYLES
========================================================= */

const styles =
  StyleSheet.create({
    page: {
      size: "A4",

      paddingTop: 40,
      paddingBottom: 42,
      paddingHorizontal: 42,

      fontFamily:
        "Helvetica",

      fontSize: 9,

      color:
        COLORS.ink,

      backgroundColor:
        COLORS.white,
    },

    header: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "flex-start",

      paddingBottom: 16,

      marginBottom: 20,

      borderBottomWidth: 1,

      borderBottomColor:
        COLORS.line,
    },

    companyBlock: {
      flexDirection:
        "column",
    },

    companyName: {
      fontSize: 17,

      fontWeight: 700,

      color:
        COLORS.brand,

      letterSpacing:
        0.8,
    },

    companySubtitle: {
      marginTop: 3,

      fontSize: 8,

      color:
        COLORS.muted,

      letterSpacing:
        0.45,
    },

    statementLabel: {
      marginTop: 7,

      fontSize: 7.5,

      fontWeight: 700,

      color:
        COLORS.accent,

      letterSpacing:
        1.5,

      textTransform:
        "uppercase",
    },

    statementMeta: {
      alignItems:
        "flex-end",
    },

    statementMetaLabel: {
      fontSize: 6.5,

      color:
        COLORS.muted,

      letterSpacing:
        0.7,
    },

    statementMetaValue: {
      marginTop: 3,

      fontSize: 8.5,

      fontWeight: 700,

      color:
        COLORS.ink,
    },

    memberHeader: {
      flexDirection:
        "row",

      alignItems:
        "center",

      marginBottom: 22,
    },

    memberPhoto: {
      width: 56,

      height: 56,

      borderRadius: 28,

      objectFit:
        "cover",

      marginRight: 14,
    },

    memberFallback: {
      width: 56,

      height: 56,

      borderRadius: 28,

      backgroundColor:
        COLORS.accentSoft,

      borderWidth: 1,

      borderColor:
        COLORS.line,

      justifyContent:
        "center",

      alignItems:
        "center",

      marginRight: 14,
    },

    memberInitials: {
      fontSize: 15,

      fontWeight: 700,

      color:
        COLORS.brand,
    },

    memberIdentity: {
      flex: 1,
    },

    memberName: {
      fontSize: 15,

      fontWeight: 700,

      color:
        COLORS.ink,
    },

    memberStatus: {
      marginTop: 3,

      fontSize: 7.5,

      fontWeight: 700,

      color: "#C62828",
    },

    memberNumber: {
      marginTop: 4,

      fontSize: 8,

      color:
        COLORS.muted,
    },

    memberPeriod: {
      marginTop: 3,

      fontSize: 7,

      color:
        COLORS.subtle,
    },

    section: {
      marginTop: 16,
    },

    sectionHeader: {
      flexDirection:
        "row",

      alignItems:
        "center",

      marginBottom: 8,
    },

    sectionTitle: {
      fontSize: 7.8,

      fontWeight: 700,

      color:
        COLORS.brand,

      letterSpacing:
        1.15,

      textTransform:
        "uppercase",
    },

    sectionLine: {
      flex: 1,

      height: 1,

      marginLeft: 9,

      backgroundColor:
        COLORS.line,
    },

    overviewGrid: {
      flexDirection:
        "row",

      gap: 7,
    },

    metricCard: {
      flex: 1,

      minHeight: 68,

      padding: 11,

      backgroundColor:
        COLORS.soft,

      borderRadius: 6,

      borderWidth: 1,

      borderColor:
        COLORS.line,
    },

    metricLabel: {
      fontSize: 6.6,

      color:
        COLORS.muted,

      textTransform:
        "uppercase",

      letterSpacing:
        0.6,
    },

    metricValue: {
      marginTop: 8,

      fontSize: 12.5,

      fontWeight: 700,

      color:
        COLORS.ink,
    },

    metricSubtext: {
      marginTop: 3,

      fontSize: 6.3,

      color:
        COLORS.subtle,
    },

    reconciliation: {
      marginTop: 8,

      padding: 10,

      borderWidth: 1,

      borderColor:
        COLORS.line,

      borderRadius: 6,

      backgroundColor:
        COLORS.softAlt,

      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    reconciliationLeft: {
      flexDirection:
        "column",
    },

    reconciliationLabel: {
      fontSize: 7,

      color:
        COLORS.muted,
    },

    reconciliationFormula: {
      marginTop: 3,

      fontSize: 6.7,

      color:
        COLORS.subtle,
    },

    reconciliationBadge: {
      paddingVertical: 4,

      paddingHorizontal: 7,

      borderRadius: 99,

      backgroundColor:
        COLORS.positiveSoft,
    },

    reconciliationBadgeText: {
      fontSize: 6.8,

      fontWeight: 700,

      color:
        COLORS.positive,
    },

    loanBox: {
      borderWidth: 1,

      borderColor:
        COLORS.line,

      borderRadius: 6,

      overflow:
        "hidden",
    },

    loanTop: {
      padding: 10,

      backgroundColor:
        COLORS.soft,

      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    loanNumber: {
      fontSize: 8.5,

      fontWeight: 700,

      color:
        COLORS.brand,
    },

    loanStatus: {
      fontSize: 6.5,

      fontWeight: 700,

      color:
        COLORS.accent,

      textTransform:
        "uppercase",

      letterSpacing:
        0.7,
    },

    loanBody: {
      paddingHorizontal: 10,
      paddingVertical: 5,
    },

    loanRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      paddingVertical: 5,

      borderBottomWidth: 1,

      borderBottomColor:
        COLORS.line,
    },

    loanRowLast: {
      borderBottomWidth: 0,
    },

    loanLabel: {
      fontSize: 7.3,

      color:
        COLORS.muted,
    },

    loanValue: {
      fontSize: 7.5,

      fontWeight: 700,

      color:
        COLORS.ink,
    },

    loanOutstanding: {
      color:
        COLORS.negative,
    },

    infoGrid: {
      flexDirection:
        "row",

      flexWrap:
        "wrap",

      borderWidth: 1,

      borderColor:
        COLORS.line,

      borderRadius: 6,

      overflow:
        "hidden",
    },

    infoColumn: {
      width: "50%",

      paddingHorizontal: 10,
    },

    infoRow: {
      flexDirection:
        "row",

      justifyContent:
        "space-between",

      paddingVertical: 6,

      borderBottomWidth: 1,

      borderBottomColor:
        COLORS.line,
    },

    infoLabel: {
      fontSize: 7,

      color:
        COLORS.muted,
    },

    infoValue: {
      maxWidth:
        "62%",

      fontSize: 7.2,

      fontWeight: 600,

      color:
        COLORS.ink,

      textAlign:
        "right",
    },

    table: {
      borderWidth: 1,

      borderColor:
        COLORS.line,

      borderRadius: 6,

      overflow:
        "hidden",
    },

    tableHeader: {
      flexDirection:
        "row",

      paddingVertical: 7,

      paddingHorizontal: 7,

      backgroundColor:
        COLORS.brand,
    },

    tableHeaderText: {
      fontSize: 6.5,

      fontWeight: 700,

      color:
        COLORS.white,

      letterSpacing:
        0.45,
    },

    tableRow: {
      flexDirection:
        "row",

      paddingVertical: 6.7,

      paddingHorizontal: 7,

      borderTopWidth: 1,

      borderTopColor:
        COLORS.line,
    },

    tableRowAlternate: {
      backgroundColor:
        COLORS.softAlt,
    },

    tableCell: {
      fontSize: 6.8,

      color:
        COLORS.ink,
    },

    tableCellMuted: {
      fontSize: 6.6,

      color:
        COLORS.muted,
    },

    tableDebit: {
      fontSize: 6.8,

      color:
        COLORS.negative,

      textAlign:
        "right",
    },

    tableCredit: {
      fontSize: 6.8,

      color:
        COLORS.positive,

      textAlign:
        "right",
    },

    tableBalance: {
      fontSize: 6.8,

      fontWeight: 700,

      color:
        COLORS.ink,

      textAlign:
        "right",
    },

    transactionType: {
      marginTop: 2,

      fontSize: 5.8,

      color:
        COLORS.subtle,
    },

    summaryBar: {
      marginTop: 8,

      padding: 9,

      backgroundColor:
        COLORS.soft,

      borderRadius: 6,

      borderWidth: 1,

      borderColor:
        COLORS.line,

      flexDirection:
        "row",

      justifyContent:
        "space-between",
    },

    summaryItem: {
      flex: 1,
    },

    summaryItemMiddle: {
      paddingHorizontal: 9,

      borderLeftWidth: 1,

      borderRightWidth: 1,

      borderLeftColor:
        COLORS.line,

      borderRightColor:
        COLORS.line,
    },

    summaryLabel: {
      fontSize: 6.3,

      color:
        COLORS.muted,

      textTransform:
        "uppercase",

      letterSpacing:
        0.5,
    },

    summaryValue: {
      marginTop: 4,

      fontSize: 8.5,

      fontWeight: 700,

      color:
        COLORS.ink,
    },

    note: {
      marginTop: 12,

      padding: 9,

      backgroundColor:
        COLORS.soft,

      borderRadius: 5,

      borderWidth: 1,

      borderColor:
        COLORS.line,
    },

    noteTitle: {
      fontSize: 6.5,

      fontWeight: 700,

      color:
        COLORS.brand,

      textTransform:
        "uppercase",

      letterSpacing:
        0.6,
    },

    noteText: {
      marginTop: 4,

      fontSize: 6.6,

      lineHeight:
        1.45,

      color:
        COLORS.muted,
    },

    emptyState: {
      paddingVertical: 22,

      paddingHorizontal: 10,

      alignItems:
        "center",

      borderWidth: 1,

      borderColor:
        COLORS.line,

      borderRadius: 6,

      backgroundColor:
        COLORS.softAlt,
    },

    emptyStateTitle: {
      fontSize: 8,

      fontWeight: 700,

      color:
        COLORS.brand,
    },

    emptyStateText: {
      marginTop: 4,

      fontSize: 6.7,

      color:
        COLORS.muted,

      textAlign:
        "center",
    },

    footer: {
      position:
        "absolute",

      bottom: 21,

      left: 42,

      right: 42,

      paddingTop: 7,

      borderTopWidth: 1,

      borderTopColor:
        COLORS.line,

      flexDirection:
        "row",

      justifyContent:
        "space-between",

      alignItems:
        "center",
    },

    footerText: {
      fontSize: 6.2,

      color:
        COLORS.muted,

      letterSpacing:
        0.25,
    },

    footerPage: {
      fontSize: 6.2,

      color:
        COLORS.muted,
    },
  });

/* =========================================================
   SMALL PDF COMPONENTS
========================================================= */

function SectionHeader({
  title,
}: {
  title: string;
}) {
  return (
    <View
      style={
        styles.sectionHeader
      }
    >
      <Text
        style={
          styles.sectionTitle
        }
      >
        {title}
      </Text>

      <View
        style={
          styles.sectionLine
        }
      />
    </View>
  );
}

function MetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <View
      style={
        styles.metricCard
      }
    >
      <Text
        style={
          styles.metricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.metricValue
        }
      >
        {value}
      </Text>

      {subtext ? (
        <Text
          style={
            styles.metricSubtext
          }
        >
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={
        styles.infoRow
      }
    >
      <Text
        style={
          styles.infoLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.infoValue
        }
      >
        {value || "—"}
      </Text>
    </View>
  );
}

function LoanRow({
  label,
  value,
  emphasize = false,
  last = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={
        last
          ? [
              styles.loanRow,
              styles.loanRowLast,
            ]
          : styles.loanRow
      }
    >
      <Text
        style={
          styles.loanLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          emphasize
            ? [
                styles.loanValue,
                styles.loanOutstanding,
              ]
            : styles.loanValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

function PageHeader() {
  return (
    <View
      style={
        styles.header
      }
      fixed
    >
      <View
        style={
          styles.companyBlock
        }
      >
        <Text
          style={
            styles.companyName
          }
        >
          {COMPANY_NAME}
        </Text>

        <Text
          style={
            styles.companySubtitle
          }
        >
          {COMPANY_SUBTITLE}
        </Text>

        <Text
          style={
            styles.statementLabel
          }
        >
          Account Statement
        </Text>
      </View>

      <View
        style={
          styles.statementMeta
        }
      >
        <Text
          style={
            styles.statementMetaLabel
          }
        >
          STATEMENT DATE
        </Text>

        <Text
          style={
            styles.statementMetaValue
          }
        >
          {formatDate(
            new Date(),
          )}
        </Text>
      </View>
    </View>
  );
}

function PageFooter() {
  return (
    <View
      style={
        styles.footer
      }
      fixed
    >
      <Text
        style={
          styles.footerText
        }
      >
        {COMPANY_NAME} • CONFIDENTIAL
      </Text>

      <Text
        style={
          styles.footerPage
        }
        render={({
          pageNumber,
          totalPages,
        }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

/* =========================================================
   TRANSACTION TABLE
========================================================= */

function TransactionHeader() {
  return (
    <View
      style={
        styles.tableHeader
      }
      fixed
    >
      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "12%",
          },
        ]}
      >
        DATE
      </Text>

      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "27%",
          },
        ]}
      >
        DESCRIPTION
      </Text>

      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "18%",
          },
        ]}
      >
        REFERENCE
      </Text>

      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "14%",
            textAlign:
              "right",
          },
        ]}
      >
        DEBIT
      </Text>

      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "14%",
            textAlign:
              "right",
          },
        ]}
      >
        CREDIT
      </Text>

      <Text
        style={[
          styles.tableHeaderText,
          {
            width: "15%",
            textAlign:
              "right",
          },
        ]}
      >
        BALANCE
      </Text>
    </View>
  );
}

function TransactionRow({
  transaction,
  index,
}: {
  transaction:
    StatementTransaction;

  index: number;
}) {
  return (
    <View
      style={
        index % 2 === 1
          ? [
              styles.tableRow,
              styles.tableRowAlternate,
            ]
          : styles.tableRow
      }
      wrap={false}
    >
      <View
        style={{
          width: "12%",
        }}
      >
        <Text
          style={
            styles.tableCell
          }
        >
          {formatDate(
            transaction.transactionAt,
          )}
        </Text>

        <Text
          style={
            styles.transactionType
          }
        >
          {transaction.status ===
          "reversed"
            ? "Reversed"
            : transaction.source.toUpperCase()}
        </Text>
      </View>

      <View
        style={{
          width: "27%",
          paddingRight: 6,
        }}
      >
        <Text
          style={
            styles.tableCell
          }
        >
          {transaction.description}
        </Text>
      </View>

      <View
        style={{
          width: "18%",
          paddingRight: 5,
        }}
      >
        <Text
          style={
            styles.tableCellMuted
          }
        >
          {transaction.reference}
        </Text>
      </View>

      <Text
        style={[
          styles.tableDebit,
          {
            width: "14%",
          },
        ]}
      >
        {transaction.debit >
        0
          ? formatKESPlain(
              transaction.debit,
            )
          : "—"}
      </Text>

      <Text
        style={[
          styles.tableCredit,
          {
            width: "14%",
          },
        ]}
      >
        {transaction.credit >
        0
          ? formatKESPlain(
              transaction.credit,
            )
          : "—"}
      </Text>

      <Text
        style={[
          styles.tableBalance,
          {
            width: "15%",
          },
        ]}
      >
        {formatKESPlain(
          transaction.balance,
        )}
      </Text>
    </View>
  );
}

/* =========================================================
   MEMBER ACCOUNT STATEMENT
========================================================= */

function MemberAccountStatement({
  member,
  photoDataUrl,
  statementTransactions,
  summary,
  periodFrom,
  periodTo,
  loan,
}: {
  member: PdfMember;

  photoDataUrl:
    | string
    | null;

  statementTransactions:
    StatementTransaction[];

  summary:
    StatementSummary;

  periodFrom: Date;

  periodTo: Date;

  loan: LoanData | null;
}) {
  const fullName =
    getMemberFullName(
      member,
    );

  const membershipNumber =
    getMemberId(member);

  const address =
    [
      member.address,
      member.city,
      member.county,
    ]
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.trim().length >
            0,
      )
      .join(", ");

  const totalDeposits =
    hasFinancialSummary(
      member,
    )
      ? roundMoney(
          safeNumber(
            member
              .financialSummary
              .totalDeposits,
          ),
        )
      : summary.totalCredits;

  const totalWithdrawals =
    hasFinancialSummary(
      member,
    )
      ? roundMoney(
          safeNumber(
            member
              .financialSummary
              .totalWithdrawals,
          ),
        )
      : summary.totalDebits;

  const availableSavings =
    hasFinancialSummary(
      member,
    )
      ? roundMoney(
          safeNumber(
            member
              .financialSummary
              .savingsBalance,
          ),
        )
      : summary.closingBalance;

  return (
    <Document
      title={`${COMPANY_NAME} Account Statement - ${membershipNumber}`}
      author={
        COMPANY_NAME
      }
      subject="Member account statement"
      creator={
        COMPANY_NAME
      }
      producer={
        COMPANY_NAME
      }
    >
      {/* =================================================
          PAGE 1
      ================================================= */}

      <Page
        size="A4"
        style={
          styles.page
        }
        wrap
      >
        <PageHeader />

        <View
          style={
            styles.memberHeader
          }
        >
          {photoDataUrl ? (
            <Image
              src={
                photoDataUrl
              }
              style={
                styles.memberPhoto
              }
            />
          ) : (
            <View
              style={
                styles.memberFallback
              }
            >
              <Text
                style={
                  styles.memberInitials
                }
              >
                {getMemberInitials(
                  member,
                )}
              </Text>
            </View>
          )}

          <View
            style={
              styles.memberIdentity
            }
          >
            <Text
              style={
                styles.memberName
              }
            >
              {fullName ||
                "Member"}
            </Text>

            <Text
              style={
                styles.memberStatus
              }
            >
              Status: {getMemberStatus(member)}
            </Text>

            <Text
              style={
                styles.memberNumber
              }
            >
              Member / Account No.{" "}
              {membershipNumber}
            </Text>

            <Text
              style={
                styles.memberPeriod
              }
            >
              Statement Period:{" "}
              {formatDate(
                periodFrom,
              )}{" "}
              –{" "}
              {formatDate(
                periodTo,
              )}
            </Text>

            <Text
              style={
                styles.memberPeriod
              }
            >
              Generated:{" "}
              {formatDateTime(
                new Date(),
              )}
            </Text>
          </View>
        </View>

        {/* ACCOUNT OVERVIEW */}

        <View
          style={
            styles.section
          }
        >
          <SectionHeader
            title="Account Overview"
          />

          <View
            style={
              styles.overviewGrid
            }
          >
            <MetricCard
              label="Available Savings"
              value={formatKES(
                availableSavings,
              )}
              subtext="Current confirmed balance"
            />

            <MetricCard
              label="Total Deposits"
              value={formatKES(
                totalDeposits,
              )}
              subtext="Account activity"
            />

            <MetricCard
              label="Total Debits"
              value={formatKES(
                totalWithdrawals,
              )}
              subtext="Withdrawals / adjustments"
            />

            <MetricCard
              label="Loan Outstanding"
              value={formatKES(
                loan
                  ?.outstandingBalance ??
                  0,
              )}
              subtext={
                loan
                  ? loan.loanNumber
                  : "No active loan"
              }
            />
          </View>

          <View
            style={
              styles.reconciliation
            }
          >
            <View
              style={
                styles.reconciliationLeft
              }
            >
              <Text
                style={
                  styles.reconciliationLabel
                }
              >
                Account Reconciliation
              </Text>

              <Text
                style={
                  styles.reconciliationFormula
                }
              >
                Opening balance + credits − debits = closing balance
              </Text>
            </View>

            <View
              style={
                styles.reconciliationBadge
              }
            >
              <Text
                style={
                  styles.reconciliationBadgeText
                }
              >
                {summary.reconciled
                  ? "RECONCILED"
                  : "REVIEW REQUIRED"}
              </Text>
            </View>
          </View>
        </View>

        {/* LOAN */}

        {loan ? (
          <View
            style={
              styles.section
            }
          >
            <SectionHeader
              title="Loan Position"
            />

            <View
              style={
                styles.loanBox
              }
            >
              <View
                style={
                  styles.loanTop
                }
              >
                <Text
                  style={
                    styles.loanNumber
                  }
                >
                  {loan.loanNumber}
                </Text>

                <Text
                  style={
                    styles.loanStatus
                  }
                >
                  {loan.status}
                </Text>
              </View>

              <View
                style={
                  styles.loanBody
                }
              >
                <LoanRow
                  label="Principal"
                  value={formatKES(
                    loan.principal,
                  )}
                />

                <LoanRow
                  label="Installment Amount"
                  value={formatKES(
                    loan.installmentAmount,
                  )}
                />

                <LoanRow
                  label="Total Repayable"
                  value={formatKES(
                    loan.totalDue,
                  )}
                />

                <LoanRow
                  label="Paid"
                  value={formatKES(
                    loan.amountPaid,
                  )}
                />

                <LoanRow
                  label="Fines"
                  value={formatKES(
                    loan.totalFines,
                  )}
                />

                <LoanRow
                  label="Outstanding"
                  value={formatKES(
                    loan.outstandingBalance,
                  )}
                  emphasize
                />
                
                <LoanRow
                  label="Loan Start Date"
                  value={formatDate(
                    loan.disbursementDate,
                  )}
                  last
                />

                <LoanRow
                  label="Loan End Date"
                  value={formatDate(
                    loan.endDate,
                  )}
                  last
                />
              </View>
            </View>
          </View>
        ) : null}

        {/* CUSTOMER INFORMATION */}

        <View
          style={
            styles.section
          }
        >
          <SectionHeader
            title="Customer Information"
          />

          <View
            style={
              styles.infoGrid
            }
          >
            <View
              style={
                styles.infoColumn
              }
            >
              <InfoRow
                label="Name"
                value={
                  fullName
                }
              />

              <InfoRow
                label="Phone"
                value={
                  safeString(
                    member.phone,
                  )
                }
              />

              <InfoRow
                label="National ID"
                value={
                  safeString(
                    member.nationalId,
                  )
                }
              />

              <InfoRow
                label="Gender"
                value={
                  safeString(
                    member.gender,
                  )
                }
              />
            </View>

            <View
              style={
                styles.infoColumn
              }
            >
              <InfoRow
                label="Email"
                value={
                  safeString(
                    member.email,
                  )
                }
              />

              <InfoRow
                label="Occupation"
                value={
                  safeString(
                    member.occupation,
                  )
                }
              />

              <InfoRow
                label="Join Date"
                value={formatDate(
                  member.joinDate,
                )}
              />

              <InfoRow
                label="Address"
                value={
                  address
                }
              />
            </View>
          </View>
        </View>

        {/* STATEMENT NOTICE */}

        <View
          style={
            styles.note
          }
        >
          <Text
            style={
              styles.noteTitle
            }
          >
            Statement Notice
          </Text>

          <Text
            style={
              styles.noteText
            }
          >
            This statement is computer-generated and does not
            require a signature. It reflects confirmed entries
            recorded in the GEO-SHUA savings ledger at the time
            of generation. Pending transactions are excluded from
            the account balance, while reversed transactions remain
            visible for audit and reconciliation purposes.
          </Text>
        </View>

        <PageFooter />
      </Page>

      {/* =================================================
          PAGE 2
      ================================================= */}

      <Page
        size="A4"
        style={
          styles.page
        }
        wrap
      >
        <PageHeader />

        <View
          style={
            styles.memberHeader
          }
        >
          {photoDataUrl ? (
            <Image
              src={
                photoDataUrl
              }
              style={
                styles.memberPhoto
              }
            />
          ) : (
            <View
              style={
                styles.memberFallback
              }
            >
              <Text
                style={
                  styles.memberInitials
                }
              >
                {getMemberInitials(
                  member,
                )}
              </Text>
            </View>
          )}

          <View
            style={
              styles.memberIdentity
            }
          >
            <Text
              style={
                styles.memberName
              }
            >
              {fullName ||
                "Member"}
            </Text>

            <Text
              style={
                styles.memberStatus
              }
            >
              Status: {getMemberStatus(member)}
            </Text>

            <Text
              style={
                styles.memberNumber
              }
            >
              Account No.{" "}
              {membershipNumber}
            </Text>

            <Text
              style={
                styles.memberPeriod
              }
            >
              Transaction History •{" "}
              {formatDate(
                periodFrom,
              )}{" "}
              –{" "}
              {formatDate(
                periodTo,
              )}
            </Text>
          </View>
        </View>

        <View
          style={
            styles.section
          }
        >
          <SectionHeader
            title="Transaction History"
          />

          {statementTransactions.length >
          0 ? (
            <>
              <View
                style={
                  styles.table
                }
              >
                <TransactionHeader />

                {statementTransactions.map(
                  (
                    transaction,
                    index,
                  ) => (
                    <TransactionRow
                      key={
                        transaction.id
                      }
                      transaction={
                        transaction
                      }
                      index={
                        index
                      }
                    />
                  ),
                )}
              </View>

              <View
                style={
                  styles.summaryBar
                }
              >
                <View
                  style={
                    styles.summaryItem
                  }
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Opening Balance
                  </Text>

                  <Text
                    style={
                      styles.summaryValue
                    }
                  >
                    {formatKES(
                      summary.openingBalance,
                    )}
                  </Text>
                </View>

                <View
                  style={[
                    styles.summaryItem,
                    styles.summaryItemMiddle,
                  ]}
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Net Activity
                  </Text>

                  <Text
                    style={
                      styles.summaryValue
                    }
                  >
                    {formatKES(
                      roundMoney(
                        summary.totalCredits -
                          summary.totalDebits,
                      ),
                    )}
                  </Text>
                </View>

                <View
                  style={
                    styles.summaryItem
                  }
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Closing Balance
                  </Text>

                  <Text
                    style={
                      styles.summaryValue
                    }
                  >
                    {formatKES(
                      summary.closingBalance,
                    )}
                  </Text>
                </View>
              </View>

              <View
                style={
                  styles.summaryBar
                }
              >
                <View
                  style={
                    styles.summaryItem
                  }
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Credits
                  </Text>

                  <Text
                    style={[
                      styles.summaryValue,
                      {
                        color:
                          COLORS.positive,
                      },
                    ]}
                  >
                    {formatKES(
                      summary.totalCredits,
                    )}
                  </Text>
                </View>

                <View
                  style={[
                    styles.summaryItem,
                    styles.summaryItemMiddle,
                  ]}
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Debits
                  </Text>

                  <Text
                    style={[
                      styles.summaryValue,
                      {
                        color:
                          COLORS.negative,
                      },
                    ]}
                  >
                    {formatKES(
                      summary.totalDebits,
                    )}
                  </Text>
                </View>

                <View
                  style={
                    styles.summaryItem
                  }
                >
                  <Text
                    style={
                      styles.summaryLabel
                    }
                  >
                    Transactions
                  </Text>

                  <Text
                    style={
                      styles.summaryValue
                    }
                  >
                    {summary.transactionCount.toLocaleString(
                      "en-KE",
                    )}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <View
              style={
                styles.emptyState
              }
            >
              <Text
                style={
                  styles.emptyStateTitle
                }
              >
                No confirmed transactions
              </Text>

              <Text
                style={
                  styles.emptyStateText
                }
              >
                No confirmed savings activity was recorded for
                this account during the selected statement period.
              </Text>
            </View>
          )}
        </View>

        <View
          style={
            styles.note
          }
        >
          <Text
            style={
              styles.noteTitle
            }
          >
            Reconciliation
          </Text>

          <Text
            style={
              styles.noteText
            }
          >
            Opening balance{" "}
            {formatKES(
              summary.openingBalance,
            )}{" "}
            + credits{" "}
            {formatKES(
              summary.totalCredits,
            )}{" "}
            − debits{" "}
            {formatKES(
              summary.totalDebits,
            )}{" "}
            = closing balance{" "}
            {formatKES(
              summary.closingBalance,
            )}
            .{" "}
            {summary.reconciled
              ? "The statement reconciles."
              : "The statement requires review because the reconstructed balance does not reconcile within the permitted rounding tolerance."}
          </Text>
        </View>

        <PageFooter />
      </Page>
    </Document>
  );
}

/* =========================================================
   FILE NAME
========================================================= */

function buildFileName(
  member: PdfMember,
): string {
  const membershipNumber =
    getMemberId(
      member,
    ).replace(
      /[^a-zA-Z0-9-_]/g,
      "_",
    );

  const name =
    getMemberFullName(
      member,
    )
      .replace(
        /[^a-zA-Z0-9-_]+/g,
        "_",
      )
      .replace(
        /^_+|_+$/g,
        "",
      );

  return `${COMPANY_NAME.replace(
    /\s+/g,
    "-",
  )}-Account-Statement-${membershipNumber}-${name || "Member"}.pdf`;
}

/* =========================================================
   PUBLIC GENERATOR
========================================================= */

export async function downloadMemberSummaryPdf(
  member: PdfMember,
  options: StatementOptions = {},
): Promise<void> {
  if (
    typeof window ===
    "undefined"
  ) {
    throw new Error(
      "PDF generation is only available in the browser.",
    );
  }

  if (!member) {
    throw new Error(
      "A valid member is required to generate the statement.",
    );
  }

  const membershipNumber =
    getMemberId(
      member,
    );

  if (
    !membershipNumber ||
    membershipNumber ===
      "N/A"
  ) {
    throw new Error(
      "The member does not have a valid membership number.",
    );
  }

  const memberId =
    safeString(
      member._id,
    );

  if (!memberId) {
    throw new Error(
      "The member does not have a valid database identifier.",
    );
  }

  const summaryLoanNumber =
    hasFinancialSummary(
      member,
    )
      ? safeString(
          asRecord(
            member.financialSummary
              .loan,
          )?.loanNumber,
        )
      : "";

  const [
    transactions,
    photoDataUrl,
    authoritativeLoan,
  ] =
    await Promise.all([
      fetchMemberTransactions(
        memberId,
      ),

      getMemberPhoto(
        membershipNumber,
      ),

      fetchMemberLoan(
        memberId,
        summaryLoanNumber,
      ),
    ]);

  const period =
    buildStatementPeriod(
      member,
      options,
    );

  let closingBalanceHint =
    0;

  if (
    hasFinancialSummary(
      member,
    )
  ) {
    closingBalanceHint =
      roundMoney(
        safeNumber(
          member.financialSummary
            .savingsBalance,
        ),
      );
  } else {
    closingBalanceHint =
      roundMoney(
        transactions.reduce(
          (
            balance,
            transaction,
          ) =>
            balance +
            getSignedAmount(
              transaction,
            ),
          0,
        ),
      );
  }

  const fullLedger =
    buildFullLedger(
      transactions,
      closingBalanceHint,
    );

  const statementData =
    buildStatementTransactions(
      fullLedger,
      period.from,
      period.to,
    );

  const summary =
    buildStatementSummary(
      statementData.transactions,
      statementData.openingBalance,
    );

  const loan =
    getLoanFromMember(
      member,
      authoritativeLoan,
    );

  const statementDocument = (
    <MemberAccountStatement
      member={member}
      photoDataUrl={
        photoDataUrl
      }
      statementTransactions={
        statementData.transactions
      }
      summary={
        summary
      }
      periodFrom={
        period.from
      }
      periodTo={
        period.to
      }
      loan={loan}
    />
  );

  const blob =
    await pdf(
      statementDocument,
    ).toBlob();

  if (
    !blob ||
    !blob.size
  ) {
    throw new Error(
      "The PDF generator returned an empty document.",
    );
  }

  const fileName =
    buildFileName(
      member,
    );

  /* =======================================================
     ANDROID CAPACITOR
  ======================================================= */

  if (
    Capacitor.getPlatform() ===
    "android"
  ) {
    await savePdfOnAndroid(
      blob,
      fileName,
    );

    return;
  }

  /* =======================================================
     WEB / PWA
  ======================================================= */

  const objectUrl =
    URL.createObjectURL(
      blob,
    );

  try {
    /*
     * React-PDF exposes a <Document>
     * component, therefore use window.document
     * for the browser DOM explicitly.
     */
    const anchor =
      window.document.createElement(
        "a",
      );

    anchor.href =
      objectUrl;

    anchor.download =
      fileName;

    anchor.style.display =
      "none";

    window.document.body.appendChild(
      anchor,
    );

    anchor.click();

    anchor.remove();
  } finally {
    URL.revokeObjectURL(
      objectUrl,
    );
  }
}

/* =========================================================
   BACKWARD-COMPATIBLE EXPORT
========================================================= */

export const generateMemberAccountStatement =
  downloadMemberSummaryPdf;