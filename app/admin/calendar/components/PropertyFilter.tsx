'use client';

import { type Property, hexToRgba } from '../types';

interface PropertyFilterProps {
  properties: Property[];
  activeProps: Set<string>;
  toggleProp: (propId: string) => void;
}

export function PropertyFilter({ properties, activeProps, toggleProp }: PropertyFilterProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-stone-500 mr-1">숙소</span>
        {properties.map(p => {
          const on = activeProps.has(p.id);
          return (
            <button key={p.id} onClick={() => toggleProp(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                backgroundColor: on ? hexToRgba(p.color, 0.18) : 'rgb(245,245,244)',
                color: on ? '#1c1917' : 'rgb(120,113,108)',
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? p.color : 'rgb(214,211,209)' }} />
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-stone-500">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          전체 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          일부 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          예약 불가
        </div>
        <span className="w-px h-3 bg-stone-200 hidden sm:block" />
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 bg-emerald-500" />
          정비 완료
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 bg-white ring-1 ring-stone-300" />
          정비 대기
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 ring-[1.5px] ring-dashed ring-amber-500" />
          미배정
        </div>
      </div>
    </>
  );
}
