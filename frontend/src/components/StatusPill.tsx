import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { Health } from "../types";

export function StatusPill({ health }: { health: Health | null }) {
  if (!health) {
    return <span className="status-pill neutral">Checking connection</span>;
  }
  if (health.azure_configured) {
    return (
      <span className="status-pill good">
        <CheckCircle2 size={15} />
        Ready to practice
      </span>
    );
  }
  return (
    <span className="status-pill warn">
      <AlertCircle size={15} />
      Practice unavailable
    </span>
  );
}
