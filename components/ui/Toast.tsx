'use client';

/**
 * 토스트. alert() 대체.
 *  - 컴포넌트/훅 어디서나: import { toast } from '@/components/ui'; toast.success('저장했습니다.');
 *  - 상단 중앙에 쌓이고 자동으로 사라진다 (오류는 조금 더 오래). 탭하면 바로 닫힌다.
 * ToastProvider 는 루트 레이아웃(AppProviders)에 한 번만 둔다.
 */
import { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem { id: number; kind: ToastKind; message: string; duration: number }

// 모듈 스토어: 훅 없이도 어디서나 toast.* 를 부를 수 있다.
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];
const emit = () => listeners.forEach(l => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => items;
const getServerSnapshot = () => EMPTY;

function show(kind: ToastKind, message: string, duration?: number) {
  const id = ++seq;
  const item: ToastItem = { id, kind, message, duration: duration ?? (kind === 'error' ? 5000 : 2800) };
  items = [...items.slice(-2), item];
  emit();
  setTimeout(() => dismiss(id), item.duration);
  return id;
}

function dismiss(id: number) {
  if (!items.some(i => i.id === id)) return;
  items = items.filter(i => i.id !== id);
  emit();
}

export const toast = {
  success: (message: string, duration?: number) => show('success', message, duration),
  error: (message: string, duration?: number) => show('error', message, duration),
  info: (message: string, duration?: number) => show('info', message, duration),
  dismiss,
};

const STYLE: Record<ToastKind, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'bg-stone-900 text-white' },
  error: { icon: AlertTriangle, cls: 'bg-red-600 text-white' },
  info: { icon: Info, cls: 'bg-stone-900 text-white' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      {children}
      <div
        aria-live="polite"
        className="fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pointer-events-none"
        style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}
      >
        {list.map(t => {
          const { icon: Icon, cls } = STYLE[t.kind];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => dismiss(t.id)}
              className={`pointer-events-auto animate-toast-in w-full max-w-md flex items-start gap-3 px-4 py-3 shadow-xl shadow-black/15 text-left ${cls}`}
            >
              <Icon size={18} className="shrink-0 mt-0.5" />
              <span className="t-body flex-1 whitespace-pre-line">{t.message}</span>
              <X size={16} className="shrink-0 mt-0.5 opacity-70" />
            </button>
          );
        })}
      </div>
    </>
  );
}
