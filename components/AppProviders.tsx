'use client';

import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Confirm';

/** 루트 레이아웃에 한 번만. 토스트·확인 시트를 앱 어디서나 쓸 수 있게 한다. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
