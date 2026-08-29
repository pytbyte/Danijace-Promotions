"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";

export default function CapacitorAuthListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let listener: { remove: () => Promise<void> } | null = null;

    const setup = async () => {
      listener = await App.addListener("appUrlOpen", ({ url }) => {
        console.log("[CapacitorAuthListener] URL:", url);

        if (!url.startsWith("geoshua://auth")) {
          return;
        }

        console.log(
          "[CapacitorAuthListener] OAuth deep link received"
        );

        router.replace("/dashboard");
      });
    };

    void setup();

    return () => {
      if (listener) {
        void listener.remove();
      }
    };
  }, [router]);

  return null;
}
