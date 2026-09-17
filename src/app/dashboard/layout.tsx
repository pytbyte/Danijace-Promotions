import type { ReactNode } from "react";

import { AppLockProvider } from "@/components/security/AppLockProvider";
import { SmsInboxProvider } from "@/components/sms/SmsInboxProvider";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AppLockProvider>
      <SmsInboxProvider>
        {children}
      </SmsInboxProvider>
    </AppLockProvider>
  );
}