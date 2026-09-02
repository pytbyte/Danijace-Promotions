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
  error?: string;
  [key: string]: unknown;
}

export interface SmsReaderResult {
  messages: SmsMessage[];
  diagnostic?: SmsReaderDiagnostic;
}

export interface SmsReaderPlugin {
  readInbox(): Promise<SmsReaderResult>;
}

const SmsReader =
  registerPlugin<SmsReaderPlugin>("SmsReader");

export default SmsReader;