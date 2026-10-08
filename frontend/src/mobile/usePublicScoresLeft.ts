import { useEffect, useState } from "react";

import { fetchQuota } from "../api";
import { PUBLIC_MODE, USAGE_CHANGED_EVENT } from "../publicMode";

// Score requests left today in public mode: the tightest of the visitor, daily and monthly
// allowances. Null outside public mode, while loading, or when the quota can't be read.
export function usePublicScoresLeft(): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!PUBLIC_MODE) return;
    let active = true;
    const refresh = () => {
      fetchQuota().then(
        (quota) => {
          if (!active) return;
          const windows = [quota.score.visitor_day, quota.score.global_day, quota.score.global_month];
          setLeft(Math.min(...windows.map((window) => Math.max(window.attempts_limit - window.attempts_used, 0))));
        },
        () => {
          if (active) setLeft(null);
        }
      );
    };
    refresh();
    window.addEventListener(USAGE_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(USAGE_CHANGED_EVENT, refresh);
    };
  }, []);

  return left;
}
