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

      <div className="flex items-center gap-5 text-[10px] text-white/40 tracking-wide">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
          전체 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400/60" />
          일부 예약 가능
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400/50" />
          예약 불가
        </div>
      </div>
    </>
  );
}
