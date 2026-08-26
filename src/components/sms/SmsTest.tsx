'use client';

import { useState } from 'react';
import SmsReader, { SmsMessage } from '@/lib/sms/SmsReader';

export default function SmsTest() {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkSms = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await SmsReader.readInbox();
      setMessages(result.messages);
    } catch (err) {
      console.error(err);
      setError('Unable to read SMS messages.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={checkSms}>
        {loading ? 'Reading SMS...' : 'Check SMS'}
      </button>

      {error && <p>{error}</p>}

      <p>Messages found: {messages.length}</p>
    </div>
  );
}
