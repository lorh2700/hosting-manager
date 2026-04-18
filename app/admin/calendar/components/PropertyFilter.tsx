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
        <span className="text-[10px] text-white/30 tracking-widest font-medium mr-1">숙소</span>
        {properties.map(p => {
          const on = activeProps.has(p.id);
          return (
            <button key={p.id} onClick={() => toggleProp(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-medium tracking-wide transition-all"
              style={{
                borderColor: on ? p.color : 'rgba(255,255,255,0.1)',
                backgroundColor: on ? hexToRgba(p.color, 0.13) : 'transparent',
                color: on ? '#fff' : 'rgba(255,255,255,0.3)',
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? p.color : 'rgba(255,255,255,0.15)' }} />
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-white/50 tracking-wide">
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
          <span className="inline-block w-4 h-2.5 rounded-sm bg-emerald-500/85 ring-1 ring-emerald-300/40" />
          정비 완료
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm ring-1 ring-white/30" style={{ background: 'rgba(0,0,0,0.5)' }} />
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
