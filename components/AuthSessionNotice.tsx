'use client';

import { useState } from 'react';

export default function AuthSessionNotice({ error, onRetry }: { error: string; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  return <div className="min-h-dvh grid place-items-center bg-stone-50 p-5">
    <section role="alert" className="w-full max-w-md border border-stone-200 bg-white p-7 text-center">
      <h1 className="text-lg font-semibold text-stone-900">계정 정보를 확인하지 못했습니다.</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">{error}</p>
      <button type="button" disabled={retrying} onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }} className="mt-5 min-h-11 border border-stone-300 px-5 text-sm disabled:opacity-50">{retrying ? '확인 중…' : '다시 불러오기'}</button>
    </section>
  </div>;
}
