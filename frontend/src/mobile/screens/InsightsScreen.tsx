import { lazy, Suspense } from "react";

import { usePracticeSession } from "../../usePracticeSession";

const InsightsPanel = lazy(() =>
  import("../../components/InsightsPanel").then((module) => ({
    default: module.InsightsPanel,
  })),
);

type PracticeSessionState = ReturnType<typeof usePracticeSession>;

type InsightsScreenProps = {
  session: PracticeSessionState;
  onOpenPractice: () => void;
};

export default function InsightsScreen({ session, onOpenPractice }: InsightsScreenProps) {
  const { activity, health, insights } = session;

  function refreshInsights() {
    void insights.loadStats();
    void activity.loadActivityStats();
  }

  return (
    <section className="m-screen" aria-labelledby="m-insights-title">
      <header className="m-screen-header">
        <h1 id="m-insights-title">Phoneme Insights</h1>
        <p>Fixed sound map with a quick weakest-sounds view</p>
      </header>
      <div className="m-screen-scroll">
        <div className="m-component-surface m-insights-content">
          <Suspense fallback={<p className="m-screen-loading">Loading…</p>}>
            <InsightsPanel
              stats={insights.stats}
              loading={insights.loading}
              error={insights.error}
              expandedPhoneme={insights.expandedPhoneme}
              setExpandedPhoneme={insights.setExpandedPhoneme}
              onDrill={(word) => {
                session.startDrillFromInsights(word);
                onOpenPractice();
              }}
              onPlayWord={session.playWord}
              speakingText={session.speakingText}
              speechStatus={session.speechStatus}
              onRefresh={refreshInsights}
              drillsEnabled={Boolean(health?.passage_check_configured)}
              generatingPhoneme={insights.generatingPhoneme}
              drillError={insights.drillError}
              onGenerateDrill={(phoneme) => void insights.generateDrill(phoneme)}
              activityStats={activity.activityStats}
              activityLoading={activity.activityLoading}
              activityError={activity.activityError}
            />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
