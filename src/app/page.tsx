"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { loginWithAndroidGoogle } from "@/lib/auth/androidGoogle";

/* =========================================================
   TYPES
========================================================= */

type GoogleUser = {
  email: string;
  name: string;
  picture: string;
};

/* =========================================================
   SAFE GOOGLE JWT PAYLOAD DECODER
========================================================= */

function decodeGoogleIdToken(
  idToken: string,
): GoogleUser {
  const tokenParts =
    idToken.split(".");

  if (tokenParts.length !== 3) {
    throw new Error(
      "Invalid Google ID token.",
    );
  }

  const payloadPart =
    tokenParts[1];

  if (!payloadPart) {
    throw new Error(
      "Google ID token payload is missing.",
    );
  }

  try {
    const base64 =
      payloadPart
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const paddedBase64 =
      base64 +
      "=".repeat(
        (4 -
          (base64.length % 4)) %
          4,
      );

    const json =
      atob(paddedBase64);

    const payload =
      JSON.parse(json) as {
        email?: unknown;
        name?: unknown;
        picture?: unknown;
        email_verified?: unknown;
      };

    const email =
      typeof payload.email ===
      "string"
        ? payload.email.trim()
        : "";

    const name =
      typeof payload.name ===
      "string"
        ? payload.name.trim()
        : "";

    const picture =
      typeof payload.picture ===
      "string"
        ? payload.picture.trim()
        : "";

    if (!email) {
      throw new Error(
        "Google authentication succeeded, but no email address was returned.",
      );
    }

    return {
      email,
      name,
      picture,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "no email address was returned",
      )
    ) {
      throw error;
    }

    throw new Error(
      "Unable to read Google account information.",
    );
  }
}

/* =========================================================
   HOME / LOGIN PAGE
========================================================= */

export default function Home() {
  const [loading, setLoading] =
    useState(false);

  const router =
    useRouter();

  /* =======================================================
     GOOGLE LOGIN
  ======================================================= */

  const handleGoogleLogin =
    async () => {
      if (loading) {
        return;
      }

      setLoading(true);

      try {
        /* =================================================
           ANDROID / CAPACITOR
        ================================================= */

        if (
          Capacitor.isNativePlatform()
        ) {
          const result =
            await loginWithAndroidGoogle();

          console.log(
            "ANDROID GOOGLE LOGIN RESULT:",
            result,
          );

          /* -----------------------------------------------
             GET GOOGLE ID TOKEN
          ----------------------------------------------- */

          const idToken =
            "idToken" in
            result.result
              ? result.result.idToken
              : undefined;

          if (!idToken) {
            throw new Error(
              "Google authentication succeeded, but no ID token was returned.",
            );
          }

          /* -----------------------------------------------
             DECODE PROFILE FOR UI ONLY
          ----------------------------------------------- */

          const googleUser =
            decodeGoogleIdToken(
              idToken,
            );

          console.log(
            "ANDROID GOOGLE USER:",
            {
              email:
                googleUser.email,
              name:
                googleUser.name,
            },
          );

          /* -----------------------------------------------
             CREATE REAL NEXTAUTH SESSION
          ----------------------------------------------- */

          const sessionResult =
            await signIn(
              "android-google",
              {
                idToken,
                redirect: false,
              },
            );

          console.log(
            "ANDROID NEXTAUTH SESSION RESULT:",
            sessionResult,
          );

          if (
            !sessionResult ||
            sessionResult.error
          ) {
            throw new Error(
              sessionResult?.error ||
                "Unable to create the application session.",
            );
          }

          /* -----------------------------------------------
             SAVE PROFILE FOR TOPBAR
          ----------------------------------------------- */

          localStorage.setItem(
            "android_google_user",
            JSON.stringify(
              googleUser,
            ),
          );

          localStorage.setItem(
            "android_google_authenticated",
            "true",
          );

          /* -----------------------------------------------
             ALLOW SESSION COOKIE TO PERSIST
          ----------------------------------------------- */

          await new Promise<void>(
            (resolve) => {
              window.setTimeout(
                resolve,
                150,
              );
            },
          );

          /* -----------------------------------------------
             DASHBOARD
          ----------------------------------------------- */

          router.replace(
            "/dashboard",
          );

          return;
        }

        /* =================================================
           WEB BROWSER
        ================================================= */

        await signIn("google", {
          callbackUrl:
            "/dashboard",
        });
      } catch (error) {
        console.error(
          "Google sign-in error:",
          error,
        );

        const message =
          error instanceof Error
            ? error.message
            : "Google authentication failed.";

        alert(message);

        setLoading(false);
      }
    };

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#eef7ff] text-black">
      {/* =================================================
          SUBTLE LIGHT BACKGROUND
      ================================================= */}

     <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-[55%] rounded-full bg-sky-400/[0.08] blur-[120px]" />

        <div className="absolute -left-32 -top-32 h-72 w-72 rounded-full bg-sky-300/[0.08] blur-[100px]" />

        <div className="absolute -bottom-32 -right-32 h-72 w-72 rounded-full bg-sky-400/[0.08] blur-[100px]" />
      </div>

      {/* =================================================
          MAIN CONTENT
      ================================================= */}

      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-6">
        <div className="flex w-full max-w-md flex-col items-center text-center">

          {/* =================================================
              LOGO
          ================================================= */}

          <div className="relative mb-8">
            <div className="absolute inset-0 scale-75 rounded-full bg-yellow-400/[0.08] blur-3xl" />

            <img
              src="/logo.png"
              alt="DANIJACE PROMOTIONS Company"
              className="
                relative
                h-auto
                w-[210px]
                object-contain
                drop-shadow-[0_8px_25px_rgba(0,0,0,0.08)]
                sm:w-[240px]
              "
            />
          </div>

          {/* =================================================
              WELCOME TEXT
          ================================================= */}

          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-black sm:text-3xl">
              Welcome
            </h1>

            <p className="mt-2 text-sm leading-6 text-black/50 sm:text-base">
              Sign in to continue to your account
            </p>
          </div>

          {/* =================================================
              GOOGLE LOGIN BUTTON
          ================================================= */}

          <button
            type="button"
            onClick={
              handleGoogleLogin
            }
            disabled={loading}
            className="
              group
              flex
              h-14
              w-full
              max-w-[340px]
              items-center
              justify-center
              gap-3
              rounded-xl
              border
              border-black/10
              bg-white
              px-6
              text-[15px]
              font-semibold
              text-black
              shadow-[0_8px_30px_rgba(0,0,0,0.08)]
              transition-all
              duration-200
              hover:-translate-y-0.5
              hover:border-black/15
              hover:shadow-[0_12px_35px_rgba(0,0,0,0.12)]
              active:translate-y-0
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {!loading ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0"
              >
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.51 5.51 0 0 1-2.39 3.61v3h3.87c2.27-2.09 3.56-5.17 3.56-8.64Z"
                />

                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.43 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.09A12 12 0 0 0 12 24Z"
                />

                <path
                  fill="#FBBC05"
                  d="M5.27 14.29A7.23 7.23 0 0 1 4.89 12c0-.79.14-1.56.38-2.29V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.09Z"
                />

                <path
                  fill="#EA4335"
                  d="M12 4.76c1.77 0 3.36.61 4.61 1.81l3.46-3.46C17.95 1.18 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.87 8.87 4.76 12 4.76Z"
                />
              </svg>
            ) : (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            )}

            <span>
              {loading
                ? "Signing you in..."
                : "Continue with Google"}
            </span>
          </button>

          {/* =================================================
              SECURITY MESSAGE
          ================================================= */}

          <div className="mt-6 flex items-center gap-2 text-xs text-black/40">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect
                x="4"
                y="10"
                width="16"
                height="11"
                rx="2"
              />

              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>

            <span>
              Secure sign-in with Google
            </span>
          </div>

          {/* =================================================
              FOOTER
          ================================================= */}

          <p className="mt-12 text-[11px] uppercase tracking-[0.25em] text-black/25">
            DANIJACE PROMOTIONS COMPANY
          </p>
        </div>
      </div>
    </main>
  );
}