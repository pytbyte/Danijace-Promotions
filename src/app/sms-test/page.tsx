"use client";

import { useState } from "react";
import SmsSender from "@/lib/sms/SmsSender";

type Subscription = {
  subscriptionId: number;
  simSlotIndex: number;
  carrierName?: string;
};

export default function SmsTestPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    "GEO-SHUA SMS test. If you received this, Android SMS sending is working."
  );

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState("");

  const [status, setStatus] = useState("Ready.");
  const [busy, setBusy] = useState(false);

  async function checkPermission() {
    try {
      const result = await SmsSender.checkPermission();

      setStatus(
        result.granted
          ? "SEND_SMS permission is granted."
          : "SEND_SMS permission is NOT granted."
      );
    } catch (error) {
      console.error(error);
      setStatus(`Permission check failed: ${String(error)}`);
    }
  }

  async function requestPermission() {
    try {
      const result = await SmsSender.requestPermission();

      setStatus(
        result.granted
          ? "SEND_SMS permission granted."
          : "SEND_SMS permission was denied."
      );
    } catch (error) {
      console.error(error);
      setStatus(`Permission request failed: ${String(error)}`);
    }
  }

  async function loadSubscriptions() {
    try {
      setBusy(true);
      setStatus("Reading SIM subscriptions...");

      const result = await SmsSender.getSubscriptions();

      setSubscriptions(result.subscriptions ?? []);

      if ((result.subscriptions ?? []).length === 0) {
        setStatus("No active SIM subscriptions found.");
      } else {
        setStatus(
          `Found ${result.subscriptions.length} active SIM subscription(s).`
        );
      }
    } catch (error) {
      console.error(error);
      setStatus(`Could not read SIMs: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTestSms() {
    if (!phone.trim()) {
      setStatus("Enter a phone number.");
      return;
    }

    if (!message.trim()) {
      setStatus("Enter a message.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Sending SMS...");

      const result = await SmsSender.send({
        phone: phone.trim(),
        message: message.trim(),
        ...(selectedSubscription
          ? {
              subscriptionId: Number(selectedSubscription),
            }
          : {}),
      });

      console.log("SMS SEND RESULT:", result);

      if (result.success) {
            setStatus(
                result.multipart
                ? `SMS sent successfully (${result.parts} parts).`
                : "SMS sent successfully."
            );
            } else {
            setStatus("SMS failed.");
            }
            } catch (error) {
            console.error("SMS SEND ERROR:", error);
            setStatus(`SMS failed: ${String(error)}`);
            } finally {
            setBusy(false);
            }
        }

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            GEO-SHUA SMS Test
          </h1>

          <p className="mt-1 text-sm text-white/60">
            Temporary native Android SMS test.
          </p>
        </div>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-medium">1. SMS Permission</h2>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={checkPermission}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm"
            >
              Check
            </button>

            <button
              type="button"
              onClick={requestPermission}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm"
            >
              Request Permission
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">2. SIMs</h2>

            <button
              type="button"
              onClick={loadSubscriptions}
              disabled={busy}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm disabled:opacity-50"
            >
              Load SIMs
            </button>
          </div>

          {subscriptions.length > 0 && (
            <select
              value={selectedSubscription}
              onChange={(event) =>
                setSelectedSubscription(event.target.value)
              }
              className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm"
            >
              <option value="">Default SIM</option>

              {subscriptions.map((subscription) => (
                <option
                  key={subscription.subscriptionId}
                  value={subscription.subscriptionId}
                >
                  SIM {subscription.simSlotIndex + 1} —{" "}
                  {subscription.carrierName || "Unknown carrier"}{" "}
                  (ID {subscription.subscriptionId})
                </option>
              ))}
            </select>
          )}

          {subscriptions.length > 0 && (
            <pre className="overflow-auto rounded-xl bg-black/50 p-3 text-xs text-white/70">
              {JSON.stringify(subscriptions, null, 2)}
            </pre>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-medium">3. Send SMS</h2>

          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0712345678"
            inputMode="tel"
            className="w-full rounded-xl border border-white/10 bg-black px-3 py-3 text-sm outline-none"
          />

          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-xl border border-white/10 bg-black px-3 py-3 text-sm outline-none"
          />

          <button
            type="button"
            onClick={sendTestSms}
            disabled={busy}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium disabled:opacity-50"
          >
            {busy ? "Sending..." : "Send Test SMS"}
          </button>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs uppercase tracking-wider text-white/40">
            Status
          </div>

          <div className="mt-2 break-words text-sm">
            {status}
          </div>
        </section>
      </div>
    </main>
  );
}
