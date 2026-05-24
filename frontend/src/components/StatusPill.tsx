import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { Health } from "../types";

export function StatusPill({ health }: { health: Health | null }) {
  if (!health) {
    return <span className="status-pill neutral">Checking backend</span>;
  }
  if (health.azure_configured) {
    return (
      <span className="status-pill good">
        <CheckCircle2 size={15} />
        Azure ready
      </span>
    );
  }
  return (
    <span className="status-pill warn">
      <AlertCircle size={15} />
      Add Azure key
    </span>
  );
}
