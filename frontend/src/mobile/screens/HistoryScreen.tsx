import { HistoryList } from "../../components/HistoryList";
import { usePracticeSession } from "../../usePracticeSession";

type PracticeSessionState = ReturnType<typeof usePracticeSession>;

type HistoryScreenProps = {
  session: PracticeSessionState;
  onOpenPractice: () => void;
};

export default function HistoryScreen({ session, onOpenPractice }: HistoryScreenProps) {
  async function restoreSession(item: PracticeSessionState["sessions"][number]) {
    await session.loadSession(item);
    onOpenPractice();
  }

  return (
    <section className="m-screen" aria-labelledby="m-history-title">
      <header className="m-screen-header">
        <h1 id="m-history-title">History</h1>
        <p>{session.sessions.length} practice sessions</p>
      </header>
      <div className="m-screen-scroll">
        <div className="m-component-surface m-history-content">
          <HistoryList
            sessions={session.sessions}
            onSelect={(item) => void restoreSession(item)}
          />
        </div>
      </div>
    </section>
  );
}
