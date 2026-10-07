import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fetchTutorial, finishTutorial } from "../api";
import "./PracticeTutorial.css";
const VERSION = 1;
const TutorialContext = createContext({ open: false, busy: false, start: () => {}, setBusy: (_busy: boolean) => {} });
export function useTutorial() { return useContext(TutorialContext); }
export function TutorialHelp() {
  const tutorial = useTutorial();
  return <button type="button" className="secondary-button compact tutorial-help" disabled={tutorial.busy} onClick={tutorial.start}>Tutorial</button>;
}
export function TutorialProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsTutorial, setNeedsTutorial] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const interacted = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    fetchTutorial().then((preferences) => {
      if (!cancelled && !interacted.current && preferences.completed_version < VERSION) setNeedsTutorial(true);
    }).catch(() => { /* Help stays available when preferences cannot be loaded. */ });
    return () => { cancelled = true; alive.current = false; };
  }, []);
  useEffect(() => {
    if (busy) setOpen(false);
    else if (needsTutorial && !interacted.current) setOpen(true);
  }, [needsTutorial, busy]);
  function start() { if (busy) return; interacted.current = true; setOpen(true); }
  async function save() {
    try { await finishTutorial(VERSION); if (alive.current) setSaveFailed(false); }
    catch { if (alive.current) setSaveFailed(true); }
  }
  function dismiss() { interacted.current = true; setOpen(false); void save(); }
  return <TutorialContext.Provider value={{ open, start, busy, setBusy }}>
    {children}
    {saveFailed ? <div className="tutorial-save-notice" role="status">Couldn’t save your tutorial preference.<button type="button" onClick={() => void save()}>Retry</button></div> : null}
    {open ? <PracticeTutorial onDismiss={dismiss} /> : null}
  </TutorialContext.Provider>;
}
const steps = [
  { target: "practice", title: "Choose a passage", body: "Type a short English sentence in Passage." },
  { target: "listen", title: "Listen to the example", body: "Click Play to hear the passage." },
  { target: "record", title: "Record your voice", body: "Press Record and read the passage aloud." },
  { target: "record", title: "Finish recording", body: "When recording, press Stop to finish." },
  { target: "score", title: "Get your score", body: "When you have a recording, press Score." },
  { target: "feedback", title: "Explore your feedback", body: "After scoring, click a colored word for sound feedback." }
];
function PracticeTutorial({ onDismiss }: { onDismiss: () => void }) {
  const [index, setIndex] = useState(0);
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const step = steps[index];
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    nextRef.current?.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const candidate = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
    candidate?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    function measure() {
      const target = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
      setBounds(target?.getClientRects().length ? target.getBoundingClientRect() : null);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setCardHeight(cardRef.current?.getBoundingClientRect().height ?? 200);
    }
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (cardRef.current) resizeObserver?.observe(cardRef.current);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resizeObserver?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);
  const margin = 16;
  const width = Math.min(340, viewport.width - margin * 2);
  const left = bounds ? Math.max(margin, Math.min(bounds.left, viewport.width - width - margin)) : (viewport.width - width) / 2;
  const top = bounds && viewport.height - bounds.bottom > cardHeight + margin * 2 ? bounds.bottom + margin
    : bounds && bounds.top > cardHeight + margin * 2 ? bounds.top - cardHeight - margin
    : Math.max(margin, (viewport.height - cardHeight) / 2);
  const mobile = Boolean(document.querySelector(".m-app"));
  const body = !bounds
    ? "Return to Practice to find this control."
    : mobile && index === 1
      ? "Tap Play example to hear the passage."
      : mobile && index === steps.length - 1
        ? "After scoring, tap the score badge to open your feedback."
        : step.body;
  return <dialog ref={dialogRef} className="practice-tutorial" aria-labelledby="tutorial-title" aria-describedby="tutorial-body" lang="en"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    {bounds ? <div className="tutorial-highlight" aria-hidden="true" style={{ left: Math.max(4, bounds.left - 5), top: Math.max(4, bounds.top - 5), width: Math.min(bounds.width + 10, viewport.width - 8), height: Math.min(bounds.height + 10, viewport.height - 8) }} /> : null}
    <div ref={cardRef} className="tutorial-card" style={{ left, top, width }}>
      <div className="tutorial-topline"><span aria-live="polite">Tutorial · {index + 1} of {steps.length}</span><button type="button" className="tutorial-close" aria-label="Close tutorial" onClick={onDismiss}>×</button></div>
      <h2 id="tutorial-title">{step.title}</h2><p id="tutorial-body">{body}</p>
      <div className="tutorial-actions"><button type="button" className="tutorial-skip" onClick={onDismiss}>Skip</button><button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button><button ref={nextRef} type="button" className="primary-button" onClick={() => index === steps.length - 1 ? onDismiss() : setIndex(index + 1)}>{index === steps.length - 1 ? "Done" : "Next"}</button></div>
    </div>
  </dialog>;
}
