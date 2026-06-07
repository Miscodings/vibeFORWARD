"use client";

import { CaseDesk } from "@/components/CaseDesk";
import { AccessGate } from "@/components/auth/AccessGate";

export default function WorkbenchPage() {
  return (
    <AccessGate>
      <CaseDesk />
    </AccessGate>
  );
}
