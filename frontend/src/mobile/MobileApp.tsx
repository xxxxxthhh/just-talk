import { useEffect, useRef, useState } from "react";

import { usePracticeRun } from "../hooks/usePracticeRun";
import type { RunLength } from "../types";
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

  // My words entry: its length, pending start and error live here, above Words and Practice, so they
  // survive tab changes. An accepted start opens Practice; Cancel abandons it and any late result.
  const [wordsLength, setWordsLength] = useState<RunLength>(6);
  // The most recent run accepted from anywhere. A Words-entry failure belongs to the moment it
  // happened: once a newer run has started, the old failure no longer describes the bank.
  const runId = run.state?.runId ?? null;
  const [latestRun, setLatestRun] = useState<string | null>(null);
  if (runId !== null && runId !== latestRun) setLatestRun(runId);
  const [wordsFailure, setWordsFailure] = useState<{ message: string; afterRun: string | null } | null>(null);
  const wordsError = wordsFailure !== null && wordsFailure.afterRun === latestRun ? wordsFailure.message : null;
  const wordsAttempt = useRef(0);
  function startWords(length: RunLength) {
    const id = ++wordsAttempt.current;
    const afterRun = latestRun;
    setWordsFailure(null);
    // Called within the tap, so the controller unlocks run audio inside the gesture.
    run.startWords(length).then(
      () => {
        if (wordsAttempt.current === id) setTab("practice");
      },
      (error: unknown) => {
        if (wordsAttempt.current !== id) return;
        setWordsFailure({
          message: error instanceof Error && error.message ? error.message : "Couldn't start the run. Try again.",
          afterRun
        });
      }
    );
  }
  function cancelWords() {
    wordsAttempt.current += 1;
    run.exit();
  }

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
          <WordsScreen
            session={session}
            onOpenPractice={openPractice}
            confirmLeaveRun={confirmLeaveRun}
            wordsRun={{
              availability: run.wordsEntry,
              length: wordsLength,
              onLengthChange: setWordsLength,
              starting: run.starting,
              error: wordsError,
              onStart: startWords,
              onCancel: cancelWords
            }}
          />
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

      {/* A run is immersive from the accepted Start (its deck may still be loading), through
          paused, summary and review, until Done or exit. */}
      {run.state || run.starting ? null : (
        <MobileTabBar
          activeTab={tab}
          dueCount={session.dueWordCount}
          onTabChange={selectTab}
        />
      )}
    </main>
  );
}
