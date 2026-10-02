import OperationsRecordWorkspace from '@/components/OperationsRecordWorkspace';

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; mode?: string }> }) {
  const params = await searchParams;
  const mode = params.mode === 'send' || params.mode === 'receive' || params.mode === 'supplies' ? params.mode : 'stock';
  return <div className="max-w-3xl mx-auto"><OperationsRecordWorkspace initialMode={mode} initialPropertyId={params.propertyId} /></div>;
}
