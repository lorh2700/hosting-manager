import OperationsSettingsClient from '@/app/admin/settings/operations/OperationsSettingsClient';

/** Sample data only. This page cannot read or change operational settings. */
export default function OperationsSettingsPreviewPage() {
  return <main className="min-h-dvh bg-stone-50 px-4 py-8 sm:px-8 sm:py-10"><OperationsSettingsClient preview /></main>;
}
