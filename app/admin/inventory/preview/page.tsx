import { notFound } from 'next/navigation';
import OperationsRecordWorkspace from '@/components/OperationsRecordWorkspace';

export default async function InventoryPreviewPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; mode?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const params = await searchParams;
  const mode = params.mode === 'send' || params.mode === 'receive' || params.mode === 'supplies' ? params.mode : 'stock';
  return <div className="max-w-3xl mx-auto"><OperationsRecordWorkspace preview initialMode={mode} initialPropertyId={params.propertyId} /></div>;
}
