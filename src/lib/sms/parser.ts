/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PARSER
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * This file ONLY parses and normalizes an incoming Android
 * bank SMS.
 *
 * It does NOT:
 *
 * - query MongoDB
 * - query members
 * - query savings accounts
 * - query loans
 * - create financial transactions
 * - modify balances
 * - classify loan vs savings
 * - resolve a member
 *
 * PIPELINE
 * ---------------------------------------------------------
 *
 * Android SmsMessage
 *      ↓
 * parser.ts
 *      ↓
 * ParsedBankSms
 *      ↓
 * processor.ts
 *      ↓
 * bank destination classification
 *      ↓
 * loan / savings / unknown
 *      ↓
 * member resolution
 *      ↓
 * savings service / loan service
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * The account number contained in the bank SMS is a BANK
 * COLLECTION / DESTINATION ACCOUNT.
 *
 * It is NOT:
 *
 * - a GEO-SHUA member ID
 * - a GEO-SHUA savings account ID
 * - a GEO-SHUA loan ID
 * - a GEO-SHUA loan number
 *
 * The destination account is used by processor.ts to decide
 * whether the payment is:
 *
 *   082083  → loan
 *   2650821 → savings
 *
 * The sender name is then used to resolve the GEO-SHUA
 * member.
 *
 * Example:
 *
 * UHTHY4Z1PL Confirmed. KES 1,400.00 received from
 * FRANCIS MWANGI KAMAU for account 2650821 on
 * 31/08/26 at 09:17 AM.
 *
 * Parser output:
 *
 * {
 *   reference: "UHTHY4Z1PL",
 *   amount: 1400,
 *   senderName: "FRANCIS MWANGI KAMAU",
 *   destinationAccountNumber: "2650821",
 *   transactionType: "unknown",
 *   transactionDate: Date,
 *   address: "BANK",
 *   rawMessage: "...",
 *   smsDate: 1788167820000,
 *   status: "confirmed"
 * }
 *
 * processor.ts is responsible for changing:
 *
 *   "unknown"
 *
 * into:
 *
 *   "savings"
 *   "loan"
 *   "unknown"
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
 * At parser level transactionType is ALWAYS "unknown".
 *
 * Classification is intentionally delegated to
 * processor.ts.
 */
export type ParsedBankSms = {
  /**
   * Bank transaction/reference code.
   *
   * Example:
   *
   * UHTHY4Z1PL
   */
  reference: string;

  /**
   * Positive transaction amount.
   *
   * Example:
   *
   * 1400
   */
  amount: number;

  /**
   * Sender/member name supplied by the bank SMS.
   *
   * Example:
   *
   * FRANCIS MWANGI KAMAU
   */
  senderName: string;

  /**
   * BANK collection/destination account number appearing
   * in the SMS.
   *
   * IMPORTANT:
   *
   * This is a routing value.
   *
   * It is NOT a GEO-SHUA member financial account.
   *
   * Example:
   *
   * 082083
   * 2650821
   */
  destinationAccountNumber: string;

  /**
   * Financial destination.
   *
   * ALWAYS "unknown" at parser level.
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
   * Original SMS body after safe whitespace normalization.
   */
  rawMessage: string;

  /**
   * Native Android SMS timestamp.
   *
   * This identifies the Android inbox message itself.
   */
  smsDate: number;

  /**
   * Bank SMS status.
   *
   * Currently only confirmed messages are supported.
   */
  status: "confirmed";
};

/* =========================================================
   ERROR
========================================================= */

export class SmsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsParseError";
  }
}

/* =========================================================
   BASIC HELPERS
========================================================= */

/**
 * Require a usable SMS body.
 */
function requireSmsBody(
  body: unknown,
): string {
  if (
    typeof body !== "string" ||
    body.trim().length === 0
  ) {
    throw new SmsParseError(
      "SMS body is empty.",
    );
  }

  return body.trim();
}

/**
 * Normalize whitespace.
 *
 * Bank SMS messages can arrive with line breaks,
 * tabs or repeated spaces.
 */
function normalizeWhitespace(
  value: string,
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize bank reference.
 */
function normalizeReference(
  value: string,
): string {
  return normalizeWhitespace(
    value,
  ).toUpperCase();
}

/**
 * Normalize sender name.
 *
 * We do not attempt fuzzy matching or name guessing.
 */
function normalizeName(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u2018\u2019\u201A\u0060]/g,
      "'",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

/**
 * Normalize bank destination account number.
 *
 * IMPORTANT:
 *
 * We preserve the value as a STRING.
 *
 * This is critical because:
 *
 *   082083
 *
 * must NOT become:
 *
 *   82083
 *
 * Leading zeroes are part of the bank routing value.
 */
function normalizeDestinationAccountNumber(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, "");
}

/* =========================================================
   MONEY
========================================================= */

/**
 * Parse a positive monetary value.
 *
 * Examples:
 *
 * 1,400
 * 1400
 * 1,400.00
 * 1400.5
 */
function parseAmount(
  value: string,
): number {
  const normalized =
    value
      .replace(/,/g, "")
      .trim();

  if (
    !/^\d+(?:\.\d{1,2})?$/.test(
      normalized,
    )
  ) {
    throw new SmsParseError(
      "SMS contains an invalid transaction amount.",
    );
  }

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new SmsParseError(
      "SMS contains an invalid transaction amount.",
    );
  }

  /**
   * Keep financial precision to cents.
   *
   * We use integer cents for the safety check.
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
    throw new SmsParseError(
      "Transaction amount is outside the supported financial range.",
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
  body: string,
): string {
  const match =
    body.match(
      /^([A-Z0-9]+)\s+Confirmed\./i,
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank transaction reference.",
    );
  }

  const reference =
    normalizeReference(
      match[1],
    );

  if (
    reference.length === 0
  ) {
    throw new SmsParseError(
      "Bank transaction reference is empty.",
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
  body: string,
): number {
  const match =
    body.match(
      /\bKES\s+([\d,]+(?:\.\d{1,2})?)\b/i,
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the transaction amount.",
    );
  }

  return parseAmount(
    match[1],
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
  body: string,
): string {
  const match =
    body.match(
      /\breceived\s+from\s+(.+?)\s+for\s+account\b/i,
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the sender name.",
    );
  }

  const name =
    normalizeName(
      match[1],
    );

  if (
    name.length === 0
  ) {
    throw new SmsParseError(
      "Sender name is empty.",
    );
  }

  return name;
}

/* =========================================================
   BANK DESTINATION ACCOUNT NUMBER
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
 * This is the BANK COLLECTION / DESTINATION ACCOUNT.
 *
 * It is NOT a GEO-SHUA savings account.
 *
 * It is NOT a GEO-SHUA loan account.
 *
 * processor.ts decides:
 *
 *   2650821 → savings
 *   082083  → loan
 */
function parseDestinationAccountNumber(
  body: string,
): string {
  const match =
    body.match(
      /\bfor\s+account\s+([0-9]+)\b/i,
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank destination account number.",
    );
  }

  const destinationAccountNumber =
    normalizeDestinationAccountNumber(
      match[1],
    );

  if (
    destinationAccountNumber.length === 0
  ) {
    throw new SmsParseError(
      "Bank destination account number is empty.",
    );
  }

  if (
    !/^\d+$/.test(
      destinationAccountNumber,
    )
  ) {
    throw new SmsParseError(
      "Bank destination account number contains invalid characters.",
    );
  }

  return destinationAccountNumber;
}

/* =========================================================
   TRANSACTION DATE
========================================================= */

/**
 * Parse supported bank formats:
 *
 * 31/08/26 at 09:17 AM
 * 29/08/26 at 11:43 PM
 *
 * Supports both two-digit and four-digit years.
 *
 * The resulting Date explicitly represents Kenya time:
 *
 * Africa/Nairobi = UTC+03:00
 */
function parseTransactionDate(
  body: string,
): Date {
  const match =
    body.match(
      /\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i,
    );

  if (!match) {
    throw new SmsParseError(
      "Could not identify the transaction date.",
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
      "Invalid transaction date.",
    );
  }

  /**
   * Convert two-digit years.
   *
   * 26 -> 2026
   */
  if (
    year >= 0 &&
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
      "Transaction date contains invalid values.",
    );
  }

  /**
   * Convert 12-hour clock to 24-hour clock.
   */
  if (
    meridiem === "AM"
  ) {
    if (
      hour === 12
    ) {
      hour = 0;
    }
  } else if (
    meridiem === "PM"
  ) {
    if (
      hour !== 12
    ) {
      hour += 12;
    }
  } else {
    throw new SmsParseError(
      "Transaction time must specify AM or PM.",
    );
  }

  /**
   * Validate the calendar date independently before
   * constructing the final timestamp.
   */
  const calendarCheck =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        0,
        0,
      ),
    );

  if (
    calendarCheck.getUTCFullYear() !==
      year ||
    calendarCheck.getUTCMonth() !==
      month - 1 ||
    calendarCheck.getUTCDate() !==
      day ||
    calendarCheck.getUTCHours() !==
      hour ||
    calendarCheck.getUTCMinutes() !==
      minute
  ) {
    throw new SmsParseError(
      "Transaction date is not a valid calendar date.",
    );
  }

  /**
   * Construct explicit Kenya-local timestamp.
   *
   * Example:
   *
   * 31/08/26 09:17 AM
   *
   * becomes:
   *
   * 2026-08-31T09:17:00+03:00
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
      date.getTime(),
    )
  ) {
    throw new SmsParseError(
      "Transaction date is invalid.",
    );
  }

  return date;
}

/* =========================================================
   STATUS
========================================================= */

/**
 * Only confirmed bank transactions are currently accepted.
 */
function parseStatus(
  body: string,
): "confirmed" {
  if (
    !/\bConfirmed\./i.test(
      body,
    )
  ) {
    throw new SmsParseError(
      "SMS is not a confirmed bank transaction.",
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
 * Example:
 *
 * {
 *   address: "BANK",
 *   body:
 *     "UHTHY4Z1PL Confirmed. KES 1,400.00 received from FRANCIS MWANGI KAMAU for account 2650821 on 31/08/26 at 09:17 AM.",
 *   date: 1788167820000
 * }
 *
 * IMPORTANT:
 *
 * This function does NOT:
 *
 * - classify savings vs loan
 * - query members
 * - query financial accounts
 * - write to MongoDB
 */
export function parseBankSms(
  sms: SmsMessage,
): ParsedBankSms {
  if (
    !sms ||
    typeof sms !== "object"
  ) {
    throw new SmsParseError(
      "Invalid SMS object.",
    );
  }

  /**
   * Android timestamp is required.
   */
  if (
    typeof sms.date !== "number" ||
    !Number.isFinite(
      sms.date,
    ) ||
    sms.date < 0
  ) {
    throw new SmsParseError(
      "SMS timestamp is invalid.",
    );
  }

  /**
   * Require and normalize body.
   */
  const body =
    requireSmsBody(
      sms.body,
    );

  const normalizedBody =
    normalizeWhitespace(
      body,
    );

  /**
   * Parse immutable bank fields.
   */
  const reference =
    parseReference(
      normalizedBody,
    );

  const amount =
    parseAmountFromBody(
      normalizedBody,
    );

  const senderName =
    parseSenderName(
      normalizedBody,
    );

  const destinationAccountNumber =
    parseDestinationAccountNumber(
      normalizedBody,
    );

  const transactionDate =
    parseTransactionDate(
      normalizedBody,
    );

  const status =
    parseStatus(
      normalizedBody,
    );

  /**
   * IMPORTANT:
   *
   * Parser does NOT classify the destination.
   *
   * processor.ts owns:
   *
   *   loan
   *   savings
   *   unknown
   */
  const transactionType:
    BankPaymentType =
    "unknown";

  return {
    reference,

    amount,

    senderName,

    destinationAccountNumber,

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
 * One malformed/unrelated SMS never stops processing
 * of the remaining inbox messages.
 */
export function parseBankSmsBatch(
  messages: SmsMessage[],
): ParseSmsResult[] {
  if (
    !Array.isArray(
      messages,
    )
  ) {
    throw new SmsParseError(
      "SMS messages must be an array.",
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
              sms,
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
    },
  );
}