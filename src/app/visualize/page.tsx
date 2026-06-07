"use client";

import { Visualize } from "@/components/Visualize";
import { AccessGate } from "@/components/auth/AccessGate";

export default function VisualizePage() {
  return (
    <AccessGate>
      <Visualize />
    </AccessGate>
  );
}
