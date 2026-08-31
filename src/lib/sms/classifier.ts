/**
 * GEO-SHUA
 * Bank SMS Classifier
 *
 * RESPONSIBILITY
 * ------------------------------------------------------------------
 *
 * Parse a bank SMS into a normalized bank transaction.
 *
 * IMPORTANT:
 *
 * The bank account number appearing in the SMS is a BANK account.
 * It is NOT:
 *
 *   - a GEO-SHUA savings account ID
 *   - a GEO-SHUA member ID
 *   - a GEO-SHUA loan ID
 *   - a GEO-SHUA loan number
 *
 * Example SMS:
 *
 * UHVJO4KICG Confirmed. KES 2,000.00 received from
 * DAVID NG'ANG'A KUNG'U for account 082083 on 31/08/26
 * at 09:17 AM.
 *
 * Produces:
 *
 * {
 *   transactionReference: "UHVJO4KICG",
 *   amount: 2000,
 *   senderName: "DAVID NG'ANG'A KUNG'U",
 *   bankAccountNumber: "082083",
 *   transactionDate: Date,
 *   rawMessage: originalMessage,
 *   paymentType: "loan"
 * }
 *
 * It does NOT produce:
 *
 *   loanNumber: "LOAN-000001"
 *
 * because the bank SMS does not contain that information.
 */

export type BankPaymentType =
  | "loan"
  | "savings"
  | "unknown";

export type ClassifiedBankSms = {
  transactionReference: string;

  amount: number;

  senderName: string;

  bankAccountNumber: string;

  transactionDate: Date;

  paymentType: BankPaymentType;

  rawMessage: string;
};

/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeWhitespace(
  value: string,
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReference(
  value: string,
): string {
  return normalizeWhitespace(
    value,
  ).toUpperCase();
}

function normalizeName(
  value: string,
): string {
  return normalizeWhitespace(
    value,
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBankAccount(
  value: string,
): string {
  return normalizeWhitespace(
    value,
  );
}

/* =========================================================
   MONEY
========================================================= */

function parseMoney(
  value: string,
): number {
  const clean =
    value
      .replace(/,/g, "")
      .trim();

  const amount =
    Number(clean);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "Invalid payment amount in bank SMS.",
    );
  }

  /*
   * Financial values are stored to cents.
   */
  const cents =
    Math.round(
      amount * 100,
    );

  if (
    !Number.isSafeInteger(
      cents,
    )
  ) {
    throw new Error(
      "Payment amount is outside the supported financial range.",
    );
  }

  return (
    cents / 100
  );
}

/* =========================================================
   DATE
========================================================= */

/**
 * Parse:
 *
 *   31/08/26 at 09:17 AM
 *
 * as a Kenya/local bank transaction date.
 *
 * We deliberately construct the Date rather than relying on
 * JavaScript's implementation-dependent parsing of DD/MM/YY.
 */
function parseBankDate(
  datePart: string,
  timePart: string,
): Date {
  const dateMatch =
    datePart.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/,
    );

  if (!dateMatch) {
    throw new Error(
      "Invalid bank transaction date.",
    );
  }

  const day =
    Number(dateMatch[1]);

  const month =
    Number(dateMatch[2]);

  let year =
    Number(dateMatch[3]);

  /*
   * Bank SMS uses two-digit years.
   *
   * 26 -> 2026
   */
  if (
    year < 100
  ) {
    year += 2000;
  }

  const timeMatch =
    timePart.match(
      /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    );

  if (!timeMatch) {
    throw new Error(
      "Invalid bank transaction time.",
    );
  }

  const hour12 =
    Number(timeMatch[1]);

  const minute =
    Number(timeMatch[2]);

  const meridiem =
    timeMatch[3].toUpperCase();

  if (
    hour12 < 1 ||
    hour12 > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(
      "Invalid bank transaction time.",
    );
  }

  let hour =
    hour12 % 12;

  if (
    meridiem === "PM"
  ) {
    hour += 12;
  }

  /*
   * Use local server time semantics.
   *
   * The bank SMS represents a Kenya transaction and the
   * application should run with Africa/Nairobi timezone.
   */
  const result =
    new Date(
      year,
      month - 1,
      day,
      hour,
      minute,
      0,
      0,
    );

  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {
    throw new Error(
      "Invalid bank transaction date.",
    );
  }

  /*
   * Protect against JavaScript date normalization.
   *
   * Example:
   * 31/02 becoming March.
   */
  if (
    result.getFullYear() !== year ||
    result.getMonth() !==
      month - 1 ||
    result.getDate() !== day ||
    result.getHours() !== hour ||
    result.getMinutes() !== minute
  ) {
    throw new Error(
      "Invalid bank transaction date.",
    );
  }

  return result;
}

/* =========================================================
   ACCOUNT → PAYMENT TYPE
========================================================= */

/**
 * The bank account is a PAYMENT DESTINATION.
 *
 * It must never be confused with a GEO-SHUA savings account.
 *
 * Configure:
 *
 * GEO_SHUA_LOAN_BANK_ACCOUNTS=082083
 *
 * and, if GEO-SHUA later has a separate bank collection account
 * for savings:
 *
 * GEO_SHUA_SAVINGS_BANK_ACCOUNTS=123456
 *
 * Multiple accounts may be comma-separated.
 */
function classifyPaymentType(
  bankAccountNumber: string,
): BankPaymentType {
  const loanAccounts =
    (
      process.env
        .GEO_SHUA_LOAN_BANK_ACCOUNTS ||
      ""
    )
      .split(",")
      .map(
        (value) =>
          value.trim(),
      )
      .filter(Boolean);

  const savingsAccounts =
    (
      process.env
        .GEO_SHUA_SAVINGS_BANK_ACCOUNTS ||
      ""
    )
      .split(",")
      .map(
        (value) =>
          value.trim(),
      )
      .filter(Boolean);

  if (
    loanAccounts.includes(
      bankAccountNumber,
    )
  ) {
    return "loan";
  }

  if (
    savingsAccounts.includes(
      bankAccountNumber,
    )
  ) {
    return "savings";
  }

  return "unknown";
}

/* =========================================================
   CLASSIFIER
========================================================= */

export function classifyBankSms(
  rawMessage: string,
): ClassifiedBankSms {
  if (
    typeof rawMessage !==
      "string" ||
    !rawMessage.trim()
  ) {
    throw new Error(
      "Bank SMS message is required.",
    );
  }

  const message =
    normalizeWhitespace(
      rawMessage,
    );

  /*
   * -------------------------------------------------------
   * TRANSACTION REFERENCE
   * -------------------------------------------------------
   *
   * The reference is the first token in the example bank SMS.
   */
  const referenceMatch =
    message.match(
      /^([A-Z0-9]+)\s+Confirmed\./i,
    );

  if (!referenceMatch) {
    throw new Error(
      "Bank SMS transaction reference could not be identified.",
    );
  }

  const transactionReference =
    normalizeReference(
      referenceMatch[1],
    );

  if (
    !transactionReference
  ) {
    throw new Error(
      "Bank SMS transaction reference is empty.",
    );
  }

  /*
   * -------------------------------------------------------
   * AMOUNT
   * -------------------------------------------------------
   */
  const amountMatch =
    message.match(
      /\bKES\s*([\d,]+(?:\.\d{1,2})?)\b/i,
    );

  if (!amountMatch) {
    throw new Error(
      "Bank SMS payment amount could not be identified.",
    );
  }

  const amount =
    parseMoney(
      amountMatch[1],
    );

  /*
   * -------------------------------------------------------
   * SENDER NAME
   * -------------------------------------------------------
   *
   * Example:
   *
   * received from DAVID NG'ANG'A KUNG'U for account...
   */
  const senderMatch =
    message.match(
      /\breceived\s+from\s+(.+?)\s+for\s+account\b/i,
    );

  if (!senderMatch) {
    throw new Error(
      "Bank SMS sender name could not be identified.",
    );
  }

  const senderName =
    normalizeName(
      senderMatch[1],
    );

  if (!senderName) {
    throw new Error(
      "Bank SMS sender name is empty.",
    );
  }

  /*
   * -------------------------------------------------------
   * BANK ACCOUNT
   * -------------------------------------------------------
   *
   * This is the bank payment account.
   *
   * It is NOT a GEO-SHUA savings account.
   */
  const accountMatch =
    message.match(
      /\bfor\s+account\s+([A-Z0-9-]+)\b/i,
    );

  if (!accountMatch) {
    throw new Error(
      "Bank payment account could not be identified.",
    );
  }

  const bankAccountNumber =
    normalizeBankAccount(
      accountMatch[1],
    );

  if (!bankAccountNumber) {
    throw new Error(
      "Bank payment account is empty.",
    );
  }

  /*
   * -------------------------------------------------------
   * DATE + TIME
   * -------------------------------------------------------
   */
  const dateTimeMatch =
    message.match(
      /\bon\s+(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i,
    );

  if (!dateTimeMatch) {
    throw new Error(
      "Bank transaction date and time could not be identified.",
    );
  }

  const transactionDate =
    parseBankDate(
      dateTimeMatch[1],
      dateTimeMatch[2],
    );

  /*
   * -------------------------------------------------------
   * PAYMENT TYPE
   * -------------------------------------------------------
   */
  const paymentType =
    classifyPaymentType(
      bankAccountNumber,
    );

  return {
    transactionReference,

    amount,

    senderName,

    bankAccountNumber,

    transactionDate,

    paymentType,

    rawMessage: message,
  };
}