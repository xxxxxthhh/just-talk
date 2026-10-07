import { useEffect, useRef, useState } from "react";

import { usePracticeRun } from "../hooks/usePracticeRun";
import { usePracticeSession } from "../usePracticeSession";
import MobileTabBar from "./MobileTabBar";
import "./mobile.css";
import HistoryScreen from "./screens/HistoryScreen";
import InsightsScreen from "./screens/InsightsScreen";
import PracticeScreen from "./screens/PracticeScreen";
import WordsScreen from "./screens/WordsScreen";

export type MobileTab = "practice" | "words" | "history" | "insights";

export default function MobileApp() {
  const session = usePracticeSession();
  // Lives above the conditionally mounted screens so a tab switch pauses the
  // run instead of losing it.
  const run = usePracticeRun(session);
  const [tab, setTab] = useState<MobileTab>("practice");

  // Leaving the practice tab or backgrounding the page discards any
  // unsubmitted capture; already-submitted scoring settles while paused.
  function pauseRun() {
    if (run.state) run.pause();
  }
  const pauseRunRef = useRef(pauseRun);
  useEffect(() => {
    pauseRunRef.current = pauseRun;
  });

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") pauseRunRef.current();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  function selectTab(nextTab: MobileTab) {
    if (tab === "practice" && nextTab !== "practice") pauseRun();
    setTab(nextTab);
    if (nextTab === "insights") {
      void session.insights.loadStats();
      void session.activity.loadActivityStats();
    }
  }

  const openPractice = () => setTab("practice");

  // Practice entries on other tabs ask before touching the shared session; a
  // plain tab switch never ends a run.
  function confirmLeaveRun(): boolean {
    if (!run.state) return true;
    if (!window.confirm("Leave this run? Its results won't be shown again.")) return false;
    run.exit();
    return true;
  }

  return (
    <main className="m-app">
      <div className="m-screen-slot">
        {tab === "practice" ? <PracticeScreen session={session} run={run} /> : null}
        {tab === "words" ? (
          <WordsScreen session={session} onOpenPractice={openPractice} confirmLeaveRun={confirmLeaveRun} />
        ) : null}
        {tab === "history" ? (
          <HistoryScreen session={session} onOpenPractice={openPractice} confirmLeaveRun={confirmLeaveRun} />
        ) : null}
        {tab === "insights" ? (
          <InsightsScreen session={session} onOpenPractice={openPractice} confirmLeaveRun={confirmLeaveRun} />
        ) : null}
      </div>

      {session.error ? (
        <div className="m-global-notice" role="alert">
          {session.error}
        </div>
      ) : null}

      <MobileTabBar
        activeTab={tab}
        dueCount={session.dueWordCount}
        onTabChange={selectTab}
      />
    </main>
  );
}
