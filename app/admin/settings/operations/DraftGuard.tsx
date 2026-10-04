'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import styles from './OperationsSettings.module.css';

interface Draft {
  label: string;
  dirty: boolean;
  save?: () => Promise<void>;
  discard: () => void;
}
interface DraftGuard {
  register: (id: string, draft: () => Draft) => () => void;
  changed: () => void;
  transition: (work: () => void) => void;
}
const DraftContext = createContext<DraftGuard | null>(null);

/** Keep a draft in its editor until the user explicitly saves or discards it. */
export function DraftGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const drafts = useRef(new Map<string, () => Draft>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [pending, setPending] = useState<{ work: () => void; drafts: Draft[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const dirtyDrafts = useCallback(() => [...drafts.current.values()].map(get => get()).filter(draft => draft.dirty), []);
  const changed = useCallback(() => setDirtyCount(dirtyDrafts().length), [dirtyDrafts]);
  const register = useCallback((id: string, get: () => Draft) => {
    drafts.current.set(id, get); changed();
    return () => { drafts.current.delete(id); changed(); };
  }, [changed]);
  const transition = useCallback((work: () => void) => {
    const current = dirtyDrafts();
    if (!current.length) { work(); return; }
    setError(''); setPending({ work, drafts: current });
  }, [dirtyDrafts]);
  const value = useMemo(() => ({ register, changed, transition }), [register, changed, transition]);

  useEffect(() => {
    if (!dirtyCount) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const beforeNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.download || link.target && link.target !== '_self') return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin || target.pathname === window.location.pathname && target.search === window.location.search) return;
      event.preventDefault(); event.stopImmediatePropagation();
      transition(() => router.push(target.pathname + target.search + target.hash));
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigation, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeNavigation, true); };
  }, [dirtyCount, router, transition]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (pending && !element.open) element.showModal();
    else if (!pending && element.open) element.close();
  }, [pending]);

  async function saveAndContinue() {
    if (!pending || saving) return;
    setSaving(true); setError('');
    try {
      // Read the current editors again: a successful prior save may have remounted one.
      for (const draft of dirtyDrafts()) {
        if (!draft.save) throw new Error(`${draft.label}은 현재 화면에서 먼저 완료해 주세요.`);
        await draft.save();
      }
      const work = pending.work; setPending(null); work();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 변경 내용은 그대로 유지됩니다.'); }
    finally { setSaving(false); }
  }
  return <DraftContext.Provider value={value}>
    {children}
    <dialog ref={dialog} className={styles.draftDialog} aria-labelledby="draft-dialog-title" onCancel={event => { if (saving) event.preventDefault(); else setPending(null); }}>
      <div className={styles.dialogBody}>
        <h2 id="draft-dialog-title">저장하지 않은 변경사항이 있습니다</h2>
        <p>변경 내용을 저장하고 이동하거나, 버리고 이동할 수 있습니다. 계속 편집하면 입력한 내용이 유지됩니다.</p>
        <ul>{pending?.drafts.map((draft, index) => <li key={`${draft.label}:${index}`}>{draft.label}</li>)}</ul>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" disabled={saving} onClick={() => setPending(null)}>계속 편집</button>
          <button type="button" className={styles.danger} disabled={saving} onClick={() => { if (!pending) return; for (const draft of dirtyDrafts()) draft.discard(); const work = pending.work; setPending(null); work(); }}>변경 버리고 이동</button>
          {pending?.drafts.every(draft => !!draft.save) && <button type="button" className={styles.primary} disabled={saving} onClick={() => void saveAndContinue()}>{saving ? '저장 중…' : '저장하고 이동'}</button>}
        </div>
      </div>
    </dialog>
  </DraftContext.Provider>;
}

export function useDraftGuard(draft: Draft) {
  const guard = useContext(DraftContext);
  const id = useId();
  const current = useRef(draft);
  useLayoutEffect(() => { current.current = draft; });
  useEffect(() => guard?.register(id, () => current.current), [guard, id]);
  useEffect(() => { guard?.changed(); }, [guard, draft.dirty]);
}

export function useDraftTransition() {
  const guard = useContext(DraftContext);
  return guard?.transition || ((work: () => void) => work());
}
