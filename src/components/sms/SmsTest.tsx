'use client';

import { useState } from 'react';
import SmsReader, { SmsMessage } from '@/lib/sms/SmsReader';

export default function SmsTest() {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Not started');
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});

  const checkSms = async () => {
    setLoading(true);
    setError('');
    setMessages([]);
    setDiagnostics({});
    setStatus('Calling SmsReader.readInbox()...');

    try {
      console.log('[SMS TEST] Calling native plugin...');

      const result = await SmsReader.readInbox();

      console.log('[SMS TEST] Native plugin returned:', result);

      setStatus('Native plugin returned successfully.');

      setDiagnostics({
        pluginCalled: true,
        pluginReturned: true,
        resultKeys: Object.keys(result),
        messageCount: result.messages?.length ?? 0,
        nativeDiagnostic: result.diagnostic ?? null,
      });

      setMessages(result.messages ?? []);
    } catch (err) {
      console.error('[SMS TEST] ERROR:', err);

      const message =
        err instanceof Error
          ? err.message
          : String(err);

      setStatus('Native plugin threw an error.');
      setError(message);

      setDiagnostics({
        pluginCalled: true,
        pluginReturned: false,
        errorType: typeof err,
        errorMessage: message,
        rawError: String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 900,
        margin: '0 auto',
        fontFamily: 'monospace',
      }}
    >
      <h2>SMS Reader Diagnostic</h2>

      <button
        onClick={checkSms}
        disabled={loading}
        style={{
          padding: '12px 20px',
          fontSize: 16,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Reading SMS...' : 'Check SMS'}
      </button>

      <hr />

      <h3>Status</h3>
      <p>{status}</p>

      {error && (
        <>
          <h3>Error</h3>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#300',
              color: '#fff',
              padding: 15,
              borderRadius: 8,
            }}
          >
            {error}
          </pre>
        </>
      )}

      <h3>Diagnostics</h3>

      <pre
        style={{
          whiteSpace: 'pre-wrap',
          background: '#eee',
          color: '#111',
          padding: 15,
          borderRadius: 8,
          overflowX: 'auto',
        }}
      >
        {Object.keys(diagnostics).length > 0
          ? JSON.stringify(diagnostics, null, 2)
          : 'No diagnostics yet.'}
      </pre>

      <h3>Messages found: {messages.length}</h3>

      {messages.length === 0 && !loading && (
        <p>No SMS messages returned.</p>
      )}

      {messages.map((message, index) => (
        <div
          key={`${message.date}-${index}`}
          style={{
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 15,
            marginBottom: 10,
          }}
        >
          <p>
            <strong>Message #{index + 1}</strong>
          </p>

          <p>
            <strong>Sender:</strong>{' '}
            {message.address ?? 'Unknown'}
          </p>

          <p>
            <strong>Date:</strong>{' '}
            {new Date(message.date).toLocaleString()}
          </p>

          <p>
            <strong>Timestamp:</strong> {message.date}
          </p>

          <p>
            <strong>Body:</strong>
          </p>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#f5f5f5',
              padding: 10,
              borderRadius: 5,
            }}
          >
            {message.body}
          </pre>
        </div>
      ))}
    </div>
  );
}