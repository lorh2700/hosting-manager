import type { SupplyRequest } from '@/lib/types';

export default function SupplyRequestContent({ request }: { request: Pick<SupplyRequest, 'requestText' | 'items'> }) {
  if (request.requestText !== undefined) {
    return <p className="whitespace-pre-wrap break-words text-base leading-7 text-stone-800">{request.requestText}</p>;
  }

  return (
    <div className="space-y-2">
      {request.items.map((item, index) => (
        <div key={index}>
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 break-words text-stone-700">{item.name}</span>
            <span className="shrink-0 text-stone-600">{item.quantity}{item.unit || '개'}</span>
          </div>
          {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-500">{item.note}</p>}
        </div>
      ))}
    </div>
  );
}
