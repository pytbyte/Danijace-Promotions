import { registerPlugin } from '@capacitor/core';

export interface SmsMessage {
  address: string | null;
  body: string;
  date: number;
}

export interface SmsReaderPlugin {
  readInbox(): Promise<{
    messages: SmsMessage[];
    diagnostic?: Record<string, unknown>;
  }>;
}

const SmsReader = registerPlugin<SmsReaderPlugin>('SmsReader');

export default SmsReader;