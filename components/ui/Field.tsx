'use client';

/**
 * 입력 필드. 라벨 12px, 입력 15px(터치 기기 16px), 높이 44px.
 *   <Field label="이름" hint="…" error={err}><Input … /></Field>
 */
import { forwardRef } from 'react';

const BASE = 'w-full bg-white border border-stone-300 px-4 min-h-[44px] t-body text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors disabled:bg-stone-50 disabled:text-stone-500';

export function Field({ label, hint, error, children, className = '' }: {
  label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="block t-label text-stone-500 mb-2">{label}</span>}
      {children}
      {error ? <span className="block t-caption text-red-600 mt-1.5">{error}</span>
        : hint ? <span className="block t-caption text-stone-400 mt-1.5">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`${BASE} ${className}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', children, ...rest }, ref) {
  return <select ref={ref} className={`${BASE} ${className}`} {...rest}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`${BASE} py-3 resize-none ${className}`} {...rest} />;
});

/** 여러 선택지 중 고르기 — 셀렉트 대신 큰 칩. 모바일에서 드롭다운보다 빠르다. */
export function ChipGroup<T extends string>({ options, value, onChange, multiple = false, className = '' }: {
  options: { value: T; label: React.ReactNode }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  multiple?: boolean;
  className?: string;
}) {
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role={multiple ? 'group' : 'radiogroup'}>
      {options.map(o => {
        const active = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[40px] px-4 t-caption border transition-colors active:scale-[0.98] ${
              active ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
