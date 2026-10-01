import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchTutorial, finishTutorial } from "../api";
import "./PracticeTutorial.css";
const VERSION = 1;
const TutorialContext = createContext({ open: false, busy: false, start: () => {}, setBusy: (_busy: boolean) => {} });
export function useTutorial() { return useContext(TutorialContext); }
export function TutorialHelp() {
  const tutorial = useTutorial();
  return <button type="button" className="secondary-button compact tutorial-help" disabled={tutorial.busy} onClick={tutorial.start}>使用引导</button>;
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
    {saveFailed ? <div className="tutorial-save-notice" role="status">引导偏好未保存，下次登录可能再次显示。<button type="button" onClick={() => void save()}>重试保存</button></div> : null}
    {open ? <PracticeTutorial onDismiss={dismiss} /> : null}
  </TutorialContext.Provider>;
}
const steps = [
  { target: "practice", title: "从一小段英文开始", body: "这里是练习区。在 Passage 输入英文，或从 Materials / Change 选择材料。先用 Short Drill 练一句，再尝试 Long Passage。" },
  { target: "listen", title: "先听示范，再跟读", body: "点 Play / Play example 听标准发音，再点一次暂停。留意重音和节奏，然后自己跟读。正式试听会使用 Listening 额度；引导本身不会播放声音。" },
  { target: "record", title: "录下自己的发音", body: "准备好后点 Record，首次使用时允许麦克风权限。照着文本朗读，再点 Stop 结束；到时长上限也会停止。引导不会开启麦克风。" },
  { target: "score", title: "提交录音，获取评分", body: "录完后可以回听自己的录音，再点 Score 提交评分。没有录音时按钮是灰色的。评分会使用 Recording 额度；停止录音不会自动提交。" },
  { target: "feedback", title: "找到需要练习的发音", body: "评分后会出现发音、流利度等分数。点击彩色单词，查看该词的音素评分，再针对较低分的声音练习。现在没有结果也没关系：完成一次录音评分就能看到真实反馈。" }
];
function PracticeTutorial({ onDismiss }: { onDismiss: () => void }) {
  const [index, setIndex] = useState(0);
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(310);
  const step = steps[index];
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    nextRef.current?.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const candidate = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
    candidate?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    function measure() {
      const target = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
      setBounds(target?.getClientRects().length ? target.getBoundingClientRect() : null);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setCardHeight(cardRef.current?.getBoundingClientRect().height ?? 310);
    }
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);
  const margin = 16;
  const width = Math.min(380, viewport.width - margin * 2);
  const left = bounds ? Math.max(margin, Math.min(bounds.left, viewport.width - width - margin)) : (viewport.width - width) / 2;
  const top = bounds && viewport.height - bounds.bottom > cardHeight + margin * 2 ? bounds.bottom + margin
    : bounds && bounds.top > cardHeight + margin * 2 ? bounds.top - cardHeight - margin
    : Math.max(margin, (viewport.height - cardHeight) / 2);
  const mobile = Boolean(document.querySelector(".m-app"));
  const body = index === 4 && mobile ? "评分后，录音区旁会出现 Score 分数入口。点它打开详情，再点彩色单词查看音素评分。没有结果时入口还不会出现；完成一次录音评分就能看到真实反馈。" : step.body;
  return <dialog ref={dialogRef} className="practice-tutorial" aria-labelledby="tutorial-title" aria-describedby="tutorial-body" lang="zh-CN"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }} onKeyDown={(event) => event.stopPropagation()}
    onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    {bounds ? <div className="tutorial-highlight" aria-hidden="true" style={{ left: Math.max(4, bounds.left - 5), top: Math.max(4, bounds.top - 5), width: Math.min(bounds.width + 10, viewport.width - 8), height: Math.min(bounds.height + 10, viewport.height - 8) }} /> : null}
    <div ref={cardRef} className="tutorial-card" style={{ left, top, width }}>
      <div className="tutorial-topline"><span aria-live="polite">使用引导 · {index + 1} / {steps.length}</span><button type="button" className="tutorial-close" aria-label="关闭引导" onClick={onDismiss}>×</button></div>
      <h2 id="tutorial-title">{step.title}</h2><p id="tutorial-body">{body}</p>
      {!bounds ? <p className="tutorial-hint">当前页面未显示这个区域。回到 Practice 后，可以通过“使用引导”再查看。</p> : null}
      <p className="tutorial-hint">只看提示，不会录音、播放或消耗额度。可随时从“使用引导”重新打开。</p>
      <div className="tutorial-actions"><button type="button" className="tutorial-skip" onClick={onDismiss}>跳过</button><button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一步</button><button ref={nextRef} type="button" className="primary-button" onClick={() => index === steps.length - 1 ? onDismiss() : setIndex(index + 1)}>{index === steps.length - 1 ? "开始练习" : "下一步"}</button></div>
    </div>
  </dialog>;
}
