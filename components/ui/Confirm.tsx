'use client';

/**
 * 확인 시트. confirm() 대체.
 *   import { confirmDialog } from '@/components/ui';
 *   if (!(await confirmDialog({ title: '삭제할까요?', message: '되돌릴 수 없습니다.', danger: true }))) return;
 * ConfirmProvider 는 루트 레이아웃(AppProviders)에 한 번만 둔다.
 */
import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 삭제처럼 되돌리기 어려운 동작이면 빨간 버튼 */
  danger?: boolean;
}

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void };
let setPending: ((p: Pending | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  if (!setPending) {
    // Provider 가 아직 없으면(테스트 등) 브라우저 기본 확인창으로 폴백
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(o.message ?? o.title ?? '') : false);
  }
  return new Promise<boolean>(resolve => setPending!({ opts: o, resolve }));
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, set] = useState<Pending | null>(null);
  useEffect(() => {
    setPending = set;
    return () => { setPending = null; };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    set(null);
  };

  const o = pending?.opts ?? {};
  return (
    <>
      {children}
      <Sheet
        open={!!pending}
        onClose={() => close(false)}
        title={o.title ?? '확인'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" full onClick={() => close(false)}>{o.cancelLabel ?? '취소'}</Button>
            <Button variant={o.danger ? 'danger-solid' : 'primary'} full onClick={() => close(true)} autoFocus>
              {o.confirmLabel ?? '확인'}
            </Button>
          </>
        }
      >
        {o.message && <p className="t-body text-stone-700 whitespace-pre-line">{o.message}</p>}
      </Sheet>
    </>
  );
}
