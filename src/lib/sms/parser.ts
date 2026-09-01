/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PARSER
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 * This parser ONLY parses and normalizes incoming bank SMS
 * messages.
 *
 * It does NOT:
 *
 * - query members
 * - query savings accounts
 * - query loans
 * - create financial transactions
 * - modify balances
 * - decide the final financial destination
 *
 * Pipeline:
 *
 *   Android SmsMessage
 *        ↓
 *   parser.ts
 *        ↓
 *   ParsedBankSms
 *        ↓
 *   classifier.ts
 *        ↓
 *   loan / savings / unknown
 *
 * The account number appearing in the bank SMS is a BANK
 * collection account. It is NOT:
 *
 * - a GEO-SHUA member ID
 * - a GEO-SHUA savings account ID
 * - a GEO-SHUA loan ID
 * - a GEO-SHUA loan number
 *
 * Example:
 *
 * UHTHY4Z1PL Confirmed. KES 1,400.00 received from
 * FRANCIS MWANGI KAMAU for account 2650821 on
 * 31/08/26 at 09:17 AM.
 *
 * =========================================================
 */

import type {
  SmsMessage,
} from "@/lib/sms/SmsReader";

/* =========================================================
   TYPES
========================================================= */

export type BankPaymentType =
  | "loan"
  | "savings"
  | "unknown";

/**
 * Parsed and normalized bank SMS.
 *
 * At parser level transactionType is intentionally
 * "unknown". The classifier is responsible for deciding
 * whether the bank account represents a loan or savings
 * collection account.
 */
export type ParsedBankSms = {
  /**
   * Bank transaction/reference code.
   */
  reference: string;

  /**
   * Positive transaction amount.
   */
  amount: number;

  /**
   * Sender/member name exactly as supplied by the bank,
   * with basic whitespace normalization.
   */
  senderName: string;

  /**
   * Bank collection account number appearing in the SMS.
   *
   * This is a routing value only.
   */
  accountNumber: string;

  /**
   * Financial destination.
   *
   * The parser does not make this decision.
   */
  transactionType: BankPaymentType;

  /**
   * Bank-reported transaction date/time.
   *
   * Constructed explicitly using Kenya time (+03:00).
   */
  transactionDate: Date;

  /**
   * Original Android SMS sender/address.
   */
  address: string | null;

  /**
   * Original SMS body after safe whitespace
   * normalization.
   */
  rawMessage: string;

  /**
   * Native Android SMS timestamp.
   */
  smsDate: number;

  /**
   * Bank SMS status.
   *
   * Currently only confirmed transactions are supported.
   */
  status: "confirmed";
};

/* =========================================================
   ERRORS
========================================================= */

export class SmsParseError extends Error {
  constructor(message: string) {
    super(message);

    this.name =
      "SmsParseError";
  }
}

/* =========================================================
   HELPERS
========================================================= */

/**
 * Require a usable SMS body.
 */
function requireSmsBody(
  body: unknown
): string {
  if (
    typeof body !== "string" ||
    !body.trim()
  ) {
    throw new SmsParseError(
      "SMS body is empty."
    );
  }

  return body.trim();
}

/**
 * Normalize whitespace without altering the actual
 * words/content of the bank message.
 */
function normalizeWhitespace(
  value: string
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize bank reference.
 */
function normalizeReference(
  value: string
): string {
  return normalizeWhitespace(
    value
  ).toUpperCase();
}

/**
 * Normalize sender name.
 *
 * We deliberately do not alter the name beyond
 * Unicode/whitespace normalization.
 *
 * Exact member matching is handled later.
 */
function normalizeName(
  value: string
): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u2018\u2019\u201A\u0060]/g,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/**
 * Normalize bank account number.
 */
function normalizeAccountNumber(
  value: string
): string {
  return value.trim();
}

/**
 * Parse positive monetary amount.
 *
 * Financial values are rounded to cents before being
 * converted back to a number.
 */
function parseAmount(
  value: string
): number {
  const normalized =
    value
      .replace(/,/g, "")
      .trim();

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new SmsParseError(
      "SMS contains an invalid transaction amount."
    );
  }

  const cents =
    Math.round(
      amount * 100
    );

  if (
    !Number.isSafeInteger(
      cents
    )
  ) {
    throw new SmsParseError(
      "Transaction amount is outside the supported financial range."
    );
  }

  return cents / 100;
}

/* =========================================================
   REFERENCE
========================================================= */

/**
 * Extract:
 *
 * UHTHY4Z1PL
 *
 * from:
 *
 * UHTHY4Z1PL Confirmed. KES 1,400.00 ...
 */
function parseReference(
  body: string
): string {
  const match =
    body.match(
      /^([A-Z0-9]+)\s+Confirmed\./i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank transaction reference."
    );
  }

  const reference =
    normalizeReference(
      match[1]
    );

  if (!reference) {
    throw new SmsParseError(
      "Bank transaction reference is empty."
    );
  }

  return reference;
}

/* =========================================================
   AMOUNT
========================================================= */

/**
 * Extract:
 *
 * KES 1,400.00
 */
function parseAmountFromBody(
  body: string
): number {
  const match =
    body.match(
      /\bKES\s*([\d,]+(?:\.\d{1,2})?)\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the transaction amount."
    );
  }

  return parseAmount(
    match[1]
  );
}

/* =========================================================
   SENDER NAME
========================================================= */

/**
 * Extract:
 *
 * FRANCIS MWANGI KAMAU
 *
 * from:
 *
 * received from FRANCIS MWANGI KAMAU for account...
 */
function parseSenderName(
  body: string
): string {
  const match =
    body.match(
      /\breceived\s+from\s+(.+?)\s+for\s+account\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the sender name."
    );
  }

  const name =
    normalizeName(
      match[1]
    );

  if (!name) {
    throw new SmsParseError(
      "Sender name is empty."
    );
  }

  return name;
}

/* =========================================================
   BANK ACCOUNT NUMBER
========================================================= */

/**
 * Extract:
 *
 * 2650821
 *
 * from:
 *
 * for account 2650821 on...
 *
 * IMPORTANT:
 *
 * This is the BANK collection account.
 *
 * It is NOT the GEO-SHUA savings account.
 */
function parseAccountNumber(
  body: string
): string {
  const match =
    body.match(
      /\bfor\s+account\s+([0-9]+)\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank account number."
    );
  }

  const accountNumber =
    normalizeAccountNumber(
      match[1]
    );

  if (!accountNumber) {
    throw new SmsParseError(
      "Bank account number is empty."
    );
  }

  return accountNumber;
}

/* =========================================================
   TRANSACTION DATE
========================================================= */

/**
 * Parse supported bank format:
 *
 * 31/08/26 at 09:17 AM
 *
 * 29/08/26 at 11:43 PM
 *
 * The resulting Date is explicitly constructed using
 * Africa/Nairobi (+03:00) semantics.
 */
function parseTransactionDate(
  body: string
): Date {
  const match =
    body.match(
      /\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i
    );

  if (!match) {
    throw new SmsParseError(
      "Could not identify the transaction date."
    );
  }

  const [
    ,
    dayText,
    monthText,
    yearText,
    hourText,
    minuteText,
    meridiemText,
  ] = match;

  const day =
    Number(dayText);

  const month =
    Number(monthText);

  let year =
    Number(yearText);

  let hour =
    Number(hourText);

  const minute =
    Number(minuteText);

  const meridiem =
    meridiemText.toUpperCase();

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new SmsParseError(
      "Invalid transaction date."
    );
  }

  if (
    year < 100
  ) {
    year += 2000;
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new SmsParseError(
      "Transaction date contains invalid values."
    );
  }

  /**
   * Convert 12-hour time to 24-hour time.
   */
  if (
    meridiem === "AM"
  ) {
    if (hour === 12) {
      hour = 0;
    }
  } else if (
    meridiem === "PM"
  ) {
    if (hour !== 12) {
      hour += 12;
    }
  } else {
    throw new SmsParseError(
      "Transaction time must specify AM or PM."
    );
  }

  /**
   * Build an explicit Kenya-local ISO timestamp.
   *
   * This avoids depending on the timezone configured on
   * Vercel/Node.
   *
   * Africa/Nairobi = UTC+03:00.
   */
  const iso =
    `${String(year).padStart(4, "0")}-` +
    `${String(month).padStart(2, "0")}-` +
    `${String(day).padStart(2, "0")}T` +
    `${String(hour).padStart(2, "0")}:` +
    `${String(minute).padStart(2, "0")}:00+03:00`;

  const date =
    new Date(iso);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new SmsParseError(
      "Transaction date is invalid."
    );
  }

  /**
   * Validate calendar values independently.
   *
   * We use UTC getters because the Date has already been
   * converted from the explicit +03:00 representation.
   */
  const kenyaEquivalent =
    new Date(
      date.getTime() +
        3 * 60 * 60 * 1000
    );

  if (
    kenyaEquivalent.getUTCFullYear() !==
      year ||
    kenyaEquivalent.getUTCMonth() !==
      month - 1 ||
    kenyaEquivalent.getUTCDate() !==
      day ||
    kenyaEquivalent.getUTCHours() !==
      hour ||
    kenyaEquivalent.getUTCMinutes() !==
      minute
  ) {
    throw new SmsParseError(
      "Transaction date is not a valid calendar date."
    );
  }

  return date;
}

/* =========================================================
   STATUS
========================================================= */

function parseStatus(
  body: string
): "confirmed" {
  if (
    !/\bConfirmed\./i.test(
      body
    )
  ) {
    throw new SmsParseError(
      "SMS is not a confirmed bank transaction."
    );
  }

  return "confirmed";
}

/* =========================================================
   MAIN PARSER
========================================================= */

/**
 * Parse a single Android SMS.
 *
 * Example input:
 *
 * {
 *   address: "BANK",
 *   body: "UHTHY4Z1PL Confirmed. KES 1,400.00 received from ...",
 *   date: 1788041580000
 * }
 *
 * The parser does not query MongoDB.
 *
 * The parser does not create transactions.
 *
 * The parser does not determine savings/loan routing.
 */
export function parseBankSms(
  sms: SmsMessage
): ParsedBankSms {
  if (
    !sms ||
    typeof sms !== "object"
  ) {
    throw new SmsParseError(
      "Invalid SMS object."
    );
  }

  /**
   * Native Android timestamp is authoritative for
   * identifying the SMS itself.
   */
  if (
    typeof sms.date !== "number" ||
    !Number.isFinite(
      sms.date
    )
  ) {
    throw new SmsParseError(
      "SMS timestamp is invalid."
    );
  }

  const body =
    requireSmsBody(
      sms.body
    );

  /**
   * Normalize once before extraction.
   *
   * This makes line-wrapped Android SMS content easier
   * to parse without changing meaningful characters.
   */
  const normalizedBody =
    normalizeWhitespace(
      body
    );

  const reference =
    parseReference(
      normalizedBody
    );

  const amount =
    parseAmountFromBody(
      normalizedBody
    );

  const senderName =
    parseSenderName(
      normalizedBody
    );

  const accountNumber =
    parseAccountNumber(
      normalizedBody
    );

  const transactionDate =
    parseTransactionDate(
      normalizedBody
    );

  const status =
    parseStatus(
      normalizedBody
    );

  /**
   * IMPORTANT:
   *
   * The parser intentionally does not determine:
   *
   * loan
   * savings
   *
   * That is the classifier's responsibility.
   */
  const transactionType:
    BankPaymentType =
    "unknown";

  return {
    reference,

    amount,

    senderName,

    accountNumber,

    transactionType,

    transactionDate,

    address:
      typeof sms.address ===
        "string"
        ? sms.address.trim() ||
          null
        : null,

    rawMessage:
      normalizedBody,

    smsDate:
      sms.date,

    status,
  };
}

/* =========================================================
   BATCH PARSER
========================================================= */

export type ParseSmsResult =
  | {
      success: true;

      sms: SmsMessage;

      parsed: ParsedBankSms;
    }
  | {
      success: false;

      sms: SmsMessage;

      error: string;
    };

/**
 * Parse multiple SMS messages safely.
 *
 * One malformed or unrelated SMS never stops the
 * remaining inbox messages from being evaluated.
 */
export function parseBankSmsBatch(
  messages: SmsMessage[]
): ParseSmsResult[] {
  if (!Array.isArray(messages)) {
    throw new SmsParseError(
      "SMS messages must be an array."
    );
  }

  return messages.map(
    (sms) => {
      try {
        return {
          success: true,

          sms,

          parsed:
            parseBankSms(
              sms
            ),
        };
      } catch (error) {
        return {
          success: false,

          sms,

          error:
            error instanceof Error
              ? error.message
              : "Unable to parse SMS.",
        };
      }
    }
  );
}
