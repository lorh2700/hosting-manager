'use client';

import { useEffect, useRef } from 'react';
import { guestFieldMessage, type GuestFieldErrors, type GuestFormField } from '@/lib/guest-form-errors';
import type { GuestLanguage } from '@/lib/guest-languages';

export function guestFieldProps(prefix: string, field: GuestFormField, errors: GuestFieldErrors) {
  return { id: `${prefix}-${field}`, 'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${prefix}-${field}-error` : undefined };
}
export function GuestFieldError({ prefix, field, errors, language }: { prefix: string; field: GuestFormField; errors: GuestFieldErrors; language: GuestLanguage }) {
  return errors[field] ? <span id={`${prefix}-${field}-error`} className="mt-2 block text-sm text-red-800">{guestFieldMessage(language, field, errors[field])}</span> : null;
}
export function GuestFormErrors({ errors, language, labels, prefix, message }: {
  errors: GuestFieldErrors; language: GuestLanguage; labels: Partial<Record<GuestFormField, string>>; prefix: string; message: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [errors, message]);
  if (!message) return null;
  return <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 outline-offset-4">
    <p>{message}</p>
    <ul>{Object.entries(errors).map(([key, reason]) => {
      const field = key as GuestFormField;
      return <li key={field}><button type="button" className="min-h-11 py-2 text-left underline underline-offset-4"
        onClick={() => document.getElementById(`${prefix}-${field}`)?.focus()}>{labels[field] || labels.message || ''}: {guestFieldMessage(language, field, reason)}</button></li>;
    })}</ul>
  </div>;
}
