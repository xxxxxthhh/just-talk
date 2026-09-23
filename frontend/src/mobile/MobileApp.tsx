import { useState } from "react";

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
  const [tab, setTab] = useState<MobileTab>("practice");

  function selectTab(nextTab: MobileTab) {
    setTab(nextTab);
    if (nextTab === "insights") {
      void session.insights.loadStats();
      void session.activity.loadActivityStats();
    }
  }

  const openPractice = () => setTab("practice");

  return (
    <main className="m-app">
      <div className="m-screen-slot">
        {tab === "practice" ? <PracticeScreen session={session} /> : null}
        {tab === "words" ? (
          <WordsScreen session={session} onOpenPractice={openPractice} />
        ) : null}
        {tab === "history" ? (
          <HistoryScreen session={session} onOpenPractice={openPractice} />
        ) : null}
        {tab === "insights" ? (
          <InsightsScreen session={session} onOpenPractice={openPractice} />
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
