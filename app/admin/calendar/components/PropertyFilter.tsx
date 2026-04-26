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
        <span className="text-xs text-white/45 mr-1">숙소</span>
        {properties.map(p => {
          const on = activeProps.has(p.id);
          return (
            <button key={p.id} onClick={() => toggleProp(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: on ? hexToRgba(p.color, 0.18) : 'rgba(255,255,255,0.04)',
                color: on ? '#fff' : 'rgba(255,255,255,0.45)',
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? p.color : 'rgba(255,255,255,0.2)' }} />
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/55">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          전체 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          일부 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          예약 불가
        </div>
        <span className="w-px h-3 bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm bg-emerald-500/85" />
          정비 완료
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm ring-1 ring-white/20" style={{ background: 'rgba(0,0,0,0.5)' }} />
          정비 대기
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm ring-[1.5px] ring-dashed ring-amber-400" />
          미배정
        </div>
      </div>
    </>
  );
}
