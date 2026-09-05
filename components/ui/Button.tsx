'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 가로 꽉 채움 */
  full?: boolean;
  icon?: React.ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]',
  secondary: 'bg-white border border-stone-300 text-stone-800 hover:border-stone-400',
  ghost: 'text-stone-600 hover:text-stone-900 hover:bg-stone-100',
  danger: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
  'danger-solid': 'bg-red-600 text-white hover:bg-red-700',
};

// 터치 목표 44px. sm 은 목록 안 보조 동작에만 쓴다.
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 t-caption',
  md: 'min-h-[44px] px-4 t-body',
  lg: 'min-h-[52px] px-5 t-lead',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, full = false, icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold tracking-wide transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});
