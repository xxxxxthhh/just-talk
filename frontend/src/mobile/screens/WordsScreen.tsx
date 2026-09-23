import { useState } from "react";

import { WordBankPanel, type WordBankTab } from "../../components/WordBankPanel";
import { usePracticeSession } from "../../usePracticeSession";

type PracticeSessionState = ReturnType<typeof usePracticeSession>;

type WordsScreenProps = {
  session: PracticeSessionState;
  onOpenPractice: () => void;
};

export default function WordsScreen({ session, onOpenPractice }: WordsScreenProps) {
  const [wordTab, setWordTab] = useState<WordBankTab>("active");

  return (
    <section className="m-screen" aria-labelledby="m-words-title">
      <header className="m-screen-header">
        <h1 id="m-words-title">Word Bank</h1>
        <p>{session.dueWordCount > 0 ? `${session.dueWordCount} due for review` : "All caught up"}</p>
      </header>
      <div className="m-screen-scroll">
        <div className="m-component-surface m-words-content">
          <WordBankPanel
            vocabulary={session.vocabulary}
            tab={wordTab}
            onTabChange={setWordTab}
            requiredSuccesses={session.requiredSuccesses}
            isSaving={session.isSavingWords}
            onAddWord={session.addManualWord}
            onPracticeWord={(item) => {
              session.practiceVocabularyWord(item);
              onOpenPractice();
            }}
            onDeleteWord={(wordId) => void session.removeVocabularyWord(wordId)}
            onStartReview={() => {
              session.startReview();
              onOpenPractice();
            }}
          />
        </div>
      </div>
    </section>
  );
}
