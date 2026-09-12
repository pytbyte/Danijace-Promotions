import type { ReactNode } from "react";

import { AppLockProvider } from "@/components/security/AppLockProvider";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AppLockProvider>
      {children}
    </AppLockProvider>
  );
}