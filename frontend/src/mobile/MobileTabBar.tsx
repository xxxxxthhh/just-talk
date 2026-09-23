import { BookMarked, History, Mic, Sparkles } from "lucide-react";

import type { MobileTab } from "./MobileApp";

type MobileTabBarProps = {
  activeTab: MobileTab;
  dueCount: number;
  onTabChange: (tab: MobileTab) => void;
};

const tabs = [
  { id: "practice", label: "Practice", icon: Mic },
  { id: "words", label: "Words", icon: BookMarked },
  { id: "history", label: "History", icon: History },
  { id: "insights", label: "Insights", icon: Sparkles },
] satisfies { id: MobileTab; label: string; icon: typeof Mic }[];

export default function MobileTabBar({
  activeTab,
  dueCount,
  onTabChange,
}: MobileTabBarProps) {
  return (
    <nav className="m-tab-bar" aria-label="Main navigation" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = activeTab === id;
        const tabLabel = id === "words" && dueCount > 0
          ? `${label}, ${dueCount} due for review`
          : label;

        return (
          <button
            className={`m-tab ${isActive ? "m-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-label={tabLabel}
            aria-selected={isActive}
            key={id}
            onClick={() => onTabChange(id)}
          >
            <span className="m-tab-icon">
              <Icon size={21} strokeWidth={isActive ? 2.5 : 2} />
              {id === "words" && dueCount > 0 ? (
                <span className="m-tab-badge" aria-hidden="true">
                  {dueCount > 99 ? "99+" : dueCount}
                </span>
              ) : null}
            </span>
            <span className="m-tab-label" aria-hidden="true">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
