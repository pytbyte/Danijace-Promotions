"use client";

import { useState } from "react";
import { loginWithAndroidGoogle } from "@/lib/auth/androidGoogle";

export default function AndroidGoogleTest() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleLogin() {
    try {
      setLoading(true);
      setMessage("");

      const result = await loginWithAndroidGoogle();

      console.log("GOOGLE LOGIN RESULT:", result);

      const idToken =
        "idToken" in result.result
          ? result.result.idToken
          : undefined;

      if (!idToken) {
        setMessage("Google login succeeded but no ID token was returned.");
        return;
      }

      setMessage("Google authentication succeeded. ID token received.");
    } catch (error) {
      console.error("ANDROID GOOGLE LOGIN ERROR:", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Google authentication failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={handleLogin}
        disabled={loading}
        className="rounded-lg border px-4 py-3"
      >
        {loading ? "Signing in..." : "Sign in with Google"}
      </button>

      {message && (
        <p className="mt-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}