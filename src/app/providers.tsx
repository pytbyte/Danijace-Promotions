"use client";

import { SessionProvider } from "next-auth/react";
import CapacitorAuthListener from "@/components/auth/CapacitorAuthListener";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <CapacitorAuthListener />
      {children}
    </SessionProvider>
  );
}