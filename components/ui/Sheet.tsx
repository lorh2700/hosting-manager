'use client';

/**
 * 하단 시트. 폰에서는 아래에서 올라오고, sm 이상에서는 중앙 다이얼로그가 된다.
 *   <Sheet open={open} onClose={close} title="담당자 배정" footer={<Button …/>}>…</Sheet>
 * 배경 탭·Esc 로 닫힌다. 열려 있는 동안 body 스크롤을 막는다.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** sm 이상에서의 최대 폭 */
  size?: 'sm' | 'md' | 'lg';
  /** 배경 탭으로 닫기 허용 (기본 true) */
  dismissible?: boolean;
}

const SIZE = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl' } as const;

export function Sheet({ open, onClose, title, description, children, footer, size = 'md', dismissible = true }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissible]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-stone-950/45 backdrop-blur-[2px] flex items-end sm:items-center justify-center"
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className={`animate-sheet-up bg-white w-full ${SIZE[size]} max-h-[92dvh] flex flex-col shadow-2xl sm:border sm:border-stone-200`}
      >
        {(title || dismissible) && (
          <div className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="flex-1 min-w-0">
              {title && <h2 className="t-title text-stone-900">{title}</h2>}
              {description && <p className="t-caption text-stone-500 mt-1">{description}</p>}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label="닫기" className="tap -mr-3 -mt-2 flex items-center justify-center text-stone-500 hover:text-stone-900">
                <X size={22} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="px-5 pt-3 border-t border-stone-200 flex gap-2 safe-bottom" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
            {footer}
          </div>
        )}
        {!footer && <div className="safe-bottom" />}
      </div>
    </div>,
    document.body,
  );
}
