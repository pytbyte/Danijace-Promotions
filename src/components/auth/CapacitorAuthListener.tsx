"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

const FRESH_LAUNCH_KEY =
  "geoshua_native_session_initialized";

export default function CapacitorAuthListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let listener: {
      remove: () => Promise<void>;
    } | null = null;

    let cancelled = false;

    const setup = async () => {
      /*
       * =========================================================
       * FRESH NATIVE APP LAUNCH
       * =========================================================
       *
       * sessionStorage belongs to the current WebView session.
       *
       * When GEO-SHUA is running normally, this flag prevents
       * repeated sign-outs during navigation or component
       * re-renders.
       *
       * When the Android app is fully terminated and a new
       * WebView session is created, the flag is absent again.
       *
       * Therefore:
       *
       * fresh app launch
       *      ↓
       * existing NextAuth session
       *      ↓
       * sign out
       *      ↓
       * sign-in screen
       */
      let freshLaunch = false;

      try {
        freshLaunch =
          sessionStorage.getItem(
            FRESH_LAUNCH_KEY,
          ) !== "true";

        if (freshLaunch) {
          sessionStorage.setItem(
            FRESH_LAUNCH_KEY,
            "true",
          );
        }
      } catch (error) {
        /*
         * If sessionStorage is unavailable, fail safely.
         *
         * We do NOT sign the user out repeatedly because of
         * a storage failure.
         */
        console.warn(
          "[CapacitorAuthListener] Unable to access sessionStorage:",
          error,
        );
      }

      /*
       * =========================================================
       * FORCE AUTHENTICATION ON FRESH LAUNCH
       * =========================================================
       *
       * Only run this on a genuinely fresh native session.
       *
       * redirect:false prevents NextAuth from performing its
       * own browser redirect while we control navigation with
       * the Next.js router.
       */
      if (freshLaunch) {
        try {
          console.log(
            "[CapacitorAuthListener] Fresh GEO-SHUA launch detected. Clearing authentication session.",
          );

          await signOut({
            redirect: false,
          });

          if (cancelled) {
            return;
          }

          console.log(
            "[CapacitorAuthListener] Authentication cleared. Redirecting to sign-in.",
          );

          router.replace("/");
        } catch (error) {
          console.error(
            "[CapacitorAuthListener] Failed to clear authentication session:",
            error,
          );

          if (!cancelled) {
            router.replace("/");
          }
        }
      }

      /*
       * =========================================================
       * OAUTH DEEP LINK
       * =========================================================
       *
       * Keep the existing Capacitor OAuth behavior.
       *
       * Once the app has already initialized, receiving:
       *
       * geoshua://auth...
       *
       * takes the authenticated user to the dashboard.
       */
      listener =
        await App.addListener(
          "appUrlOpen",
          ({ url }) => {
            console.log(
              "[CapacitorAuthListener] URL:",
              url,
            );

            if (
              !url.startsWith(
                "geoshua://auth",
              )
            ) {
              return;
            }

            console.log(
              "[CapacitorAuthListener] OAuth deep link received",
            );

            router.replace(
              "/dashboard",
            );
          },
        );
    };

    void setup();

    return () => {
      cancelled = true;

      if (listener) {
        void listener.remove();
        listener = null;
      }
    };
  }, [router]);

  return null;
}