import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type SidebarSectionProps = {
  id: string;
  title: string;
  icon: ReactNode;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function SidebarSection({
  id,
  title,
  icon,
  count,
  isExpanded,
  onToggle,
  actions,
  children
}: SidebarSectionProps) {
  const contentId = `${id}-content`;

  return (
    <section className={`sidebar-section ${isExpanded ? "is-expanded" : ""}`}>
      <div className="sidebar-section-header">
        <button
          type="button"
          className="sidebar-section-toggle"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span className="sidebar-section-title">
            {icon}
            <span>{title}</span>
          </span>
          <span className="sidebar-section-meta">
            <span className="sidebar-section-count">{count}</span>
            <ChevronDown className="sidebar-chevron" size={16} />
          </span>
        </button>
        {isExpanded && actions ? <div className="sidebar-section-actions">{actions}</div> : null}
      </div>
      {isExpanded ? (
        <div className="sidebar-section-body" id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
