import { registerPlugin } from "@capacitor/core";

export interface SmsMessage {
  id?: string | null;
  address: string | null;
  body: string;
  date: number;
}

export interface SmsReaderDiagnostic {
  stage?: string;
  permission?: string;

  count?: number;

  windowHours?: number;

  fromTimestamp?: number;
  toTimestamp?: number;

  skippedEmptyBody?: number;
  skippedInvalidDate?: number;
  skippedFutureDate?: number;
  skippedInvalidRow?: number;

  error?: string;
  exception?: string;
  message?: string;

  [key: string]: unknown;
}

export interface SmsReaderResult {
  messages: SmsMessage[];
  diagnostic?: SmsReaderDiagnostic;
}

export interface SmsReaderPlugin {
  /**
   * Reads SMS messages currently available in the
   * Android inbox from the previous 36 hours.
   *
   * The native plugin does not perform financial
   * processing or server communication.
   */
  readInbox(): Promise<SmsReaderResult>;
}

const SmsReader =
  registerPlugin<SmsReaderPlugin>("SmsReader");

export default SmsReader;

