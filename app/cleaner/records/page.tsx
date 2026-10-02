import OperationsRecordWorkspace from '@/components/OperationsRecordWorkspace';

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; mode?: string }> }) {
  const params = await searchParams;
  const mode = params.mode === 'send' || params.mode === 'receive' || params.mode === 'supplies' ? params.mode : 'stock';
  return <OperationsRecordWorkspace initialMode={mode} initialPropertyId={params.propertyId} />;
}
