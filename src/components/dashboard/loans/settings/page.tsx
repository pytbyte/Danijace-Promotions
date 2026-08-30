"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* =========================================================
   LOAN SETTINGS ROUTE
========================================================= */

export default function LoanSettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/loans");
  }, [router]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#050505] text-white">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-yellow-500" />

        <p className="text-sm text-white/40">
          Opening loan management...
        </p>
      </div>
    </main>
  );
}