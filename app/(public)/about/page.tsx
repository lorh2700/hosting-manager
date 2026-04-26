'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion, useScroll, useSpring } from 'motion/react';
import { Menu, X, ArrowRight, Calendar, Brush, Inbox, BarChart3, Layers, Sparkles, Check, RefreshCw, ChevronLeft, ChevronRight, Languages, ConciergeBell, Plane, UtensilsCrossed, Lock, QrCode, Send } from 'lucide-react';
import { Logo } from '@/components/Logo';

const NAV_LINKS = [
  { href: '/#spaces', label: '공간' },
  { href: '/about', label: '호스팅 지원 플랫폼' },
];

const SECONDARY_LINKS = [
  { href: 'https://lab.voidanchae.com', label: 'Lab', external: true },
  { href: '/admin', label: '호스트', external: false },
];

const PLATFORM_FEATURES = [
  { icon: Layers,    label: '멀티 채널 통합',     desc: 'Airbnb · Booking.com · 아고다 · 직접예약을 한 화면에' },
  { icon: Calendar,  label: '통합 캘린더',          desc: '숙소별 점유율과 더블부킹 실시간 방어' },
  { icon: Brush,     label: '청소 오케스트레이션', desc: '체크아웃 즉시 인력 배정 · 비품 워크플로' },
  { icon: Inbox,     label: '게스트 메시지 인박스', desc: '채널별 대화 통합 + 자동 응답 템플릿' },
  { icon: BarChart3, label: '운영 리포트',          desc: '청소 단가, 채널별 매출, 점유율 한눈에' },
];

const WELCOMEPAD_FEATURES = [
  { icon: Languages,       label: '4개국어 지원',     desc: 'English · 한국어 · 日本語 · 中文 — 게스트가 직접 전환' },
  { icon: ConciergeBell,   label: '컨시어지 메뉴',     desc: 'Guide · Dining · Delivery · Tour · Taxi — 한 화면에서 호출' },
  { icon: Plane,           label: '공항 택시 예약',    desc: '터미널 선택 · 픽업 시간 · 정찰 요금. 호스트 컨펌으로 마무리' },
  { icon: UtensilsCrossed, label: '음식 배달 QR',      desc: '큐레이션된 로컬 레스토랑을 폰 카메라로 즉시 연결' },
  { icon: Lock,            label: '호스트 PIN 보호',    desc: '운영 메뉴는 핀패드 뒤로. 게스트 화면은 게스트만의 것' },
];

// Property palette mirrors the actual admin (matches stay-name → color)
const PROPS = [
  { id: 'h',  name: '청림재', color: '#6b7d8f' },
  { id: 'd',  name: '백송재', color: '#a08665' },
  { id: 'a',  name: '다온재', color: '#859485' },
  { id: 'u',  name: '운설당', color: '#a47670' },
];

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

type CleanState = 'done' | 'pending';
type EventBar = {
  start: number;   // 1..7 (col-start)
  end: number;     // exclusive col-end (col-end-{n})
  guest?: string;
  showLabel?: boolean;
  badgeRight?: { state: CleanState; name: string };
};

// Two-week sample: 19–25 then 26–2 (today = 27)
const WEEK_1 = {
  daysLabel: ['19', '20', '21', '22', '23', '24', '25'],
  weekendIdx: { 0: 'rose', 6: 'sky' } as const,
};
const WEEK_2 = {
  daysLabel: ['26', '27', '28', '29', '30', '1', '2'],
  todayIdx: 1,
  outsideMonth: [5, 6],
  availability: [
    { col: 0, dot: 'rose',  text: '0/3' },
    { col: 1, dot: 'amber', text: '1/3' },
    { col: 2, dot: 'amber', text: '1/3' },
    { col: 3, dot: 'rose',  text: '0/3' },
  ],
};

// Events laid out per property per week
const W1_EVENTS: Record<string, EventBar[]> = {
  h: [
    { start: 1, end: 4, guest: 'Sarah Williams', showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
    { start: 4, end: 8, guest: 'David Chen',      showLabel: true, badgeRight: { state: 'done', name: '윤나' } },
  ],
  d: [
    { start: 1, end: 3, guest: '박지훈',     showLabel: true, badgeRight: { state: 'done', name: '도영' } },
    { start: 3, end: 5, guest: '이준호',     showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
    { start: 5, end: 8, guest: 'Emma Brown', showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
  ],
  a: [
    { start: 1, end: 4, guest: 'Alex Petrov',  showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
    { start: 4, end: 8, guest: 'Sarah Miller', showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
  ],
  u: [
    { start: 1, end: 3, guest: 'John Smith',  showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
    { start: 5, end: 8, guest: 'Lisa Garcia', showLabel: true },
  ],
};

const W2_EVENTS: Record<string, EventBar[]> = {
  h: [
    { start: 1, end: 3, guest: 'Yuki TANAKA', showLabel: true, badgeRight: { state: 'pending', name: '윤나' } },
    { start: 3, end: 6, guest: 'Mike Wong',    showLabel: true, badgeRight: { state: 'pending', name: '민들레' } },
    { start: 6, end: 8, guest: 'Anna Kim',     showLabel: true },
  ],
  d: [
    { start: 1, end: 4, guest: 'Maria Santos', showLabel: true, badgeRight: { state: 'pending', name: '민들레' } },
  ],
  a: [
    { start: 1, end: 4, guest: 'Sarah Miller', showLabel: true, badgeRight: { state: 'done', name: '민들레' } },
    { start: 5, end: 8, guest: '정수민',       showLabel: true },
  ],
  u: [
    { start: 1, end: 3, guest: 'Lisa Garcia',  showLabel: true },
    { start: 4, end: 6, guest: 'Tania Lopez',   showLabel: true, badgeRight: { state: 'pending', name: '민들레' } },
    { start: 6, end: 8, guest: 'Susan Park',    showLabel: true },
  ],
};

function PropertyLane({ prop, events, weekendCols = [0, 6] }: { prop: typeof PROPS[number]; events: EventBar[]; weekendCols?: number[]; }) {
  return (
    <div className="flex border-b border-stone-200 last:border-b-0" style={{ height: '24px' }}>
      <div className="w-[44px] sm:w-[64px] shrink-0 border-r-2 border-stone-300 flex items-center gap-1 px-1.5 bg-white">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: prop.color }} />
        <span className="text-[8px] sm:text-[9px] text-stone-700 font-medium truncate hidden sm:inline">{prop.name}</span>
      </div>
      <div className="flex-1 grid grid-cols-7 relative">
        {/* weekend tint cells (background only) */}
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className={`relative ${i < 6 ? 'border-r border-black/15' : ''}`}
            style={{
              backgroundColor:
                weekendCols.includes(i) && i === 0 ? 'rgba(244,63,94,0.025)' :
                weekendCols.includes(i) && i === 6 ? 'rgba(14,165,233,0.025)' :
                rgba(prop.color, 0.025),
            }}
          />
        ))}
        {/* events overlay */}
        {events.map((ev, idx) => (
          <div
            key={idx}
            className="absolute top-0 h-full flex items-center overflow-hidden"
            style={{
              backgroundColor: prop.color,
              left: `${((ev.start - 1) / 7) * 100}%`,
              width: `${((ev.end - ev.start) / 7) * 100}%`,
            }}
          >
            {ev.showLabel && ev.guest && (
              <span className="px-1.5 text-[8px] sm:text-[9px] font-semibold text-white truncate leading-none">
                {ev.guest}
              </span>
            )}
            {ev.badgeRight && (
              <span
                className={`absolute right-0.5 top-1/2 -translate-y-1/2 text-[7px] leading-none px-1 py-0.5 font-semibold whitespace-nowrap inline-flex items-center gap-0.5 ${
                  ev.badgeRight.state === 'done'
                    ? 'bg-emerald-500 text-white ring-1 ring-emerald-600/30'
                    : 'bg-white text-stone-800 ring-1 ring-stone-300'
                }`}
              >
                {ev.badgeRight.state === 'done' ? <Check size={7} strokeWidth={3} /> : <Sparkles size={6} strokeWidth={2.5} />}
                {ev.badgeRight.name}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AboutPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-50 selection:bg-[var(--brand)]/30 font-sans">
      {/* Top scroll progress bar */}
      <motion.div
        style={{ scaleX, transformOrigin: '0% 50%' }}
        className="fixed top-0 left-0 right-0 h-[2px] bg-[var(--brand)] z-[60] origin-left"
      />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-stone-950/55 backdrop-blur-md border-b border-white/[0.06]">
        <div className="flex justify-between items-center px-6 md:px-8 h-16 md:h-[72px]">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity" aria-label="void anchae 홈" onClick={() => setMobileOpen(false)}>
            <Logo width={140} priority />
          </Link>

          <div className="hidden md:flex items-center gap-7 text-xs uppercase tracking-widest font-medium text-stone-300">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} className="hover:text-white transition-colors min-h-[44px] inline-flex items-center">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            {SECONDARY_LINKS.map(link => (
              link.external ? (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                  className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 transition-colors min-h-[44px] inline-flex items-center"
                >{link.label}</a>
              ) : (
                <Link key={link.href} href={link.href}
                  className="text-xs uppercase tracking-widest font-medium text-stone-200 bg-white/5 hover:bg-white/15 px-4 py-3 transition-colors min-h-[44px] inline-flex items-center"
                >{link.label}</Link>
              )
            ))}
          </div>

          <div className="md:hidden flex items-center gap-2">
            <button type="button" onClick={() => setMobileOpen(v => !v)}
              aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={mobileOpen}
              className="p-3 -mr-2 text-stone-200 hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-stone-950/95 backdrop-blur-lg px-6 py-4 space-y-1">
            {NAV_LINKS.map(link => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                className="block py-3 text-sm uppercase tracking-widest text-stone-200 hover:text-white min-h-[44px]"
              >{link.label}</Link>
            ))}
            <div className="border-t border-white/[0.06] pt-2 mt-2 space-y-1">
              {SECONDARY_LINKS.map(link => (
                link.external ? (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}
                    className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]"
                  >{link.label}</a>
                ) : (
                  <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                    className="block py-3 text-sm uppercase tracking-widest text-stone-300 hover:text-white min-h-[44px]"
                  >{link.label}</Link>
                )
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="pt-32 md:pt-40 pb-16 md:pb-20 px-6 md:px-12 max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-6">Void Anchae · Hosting Platform</p>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.1] mb-8">
            호스트 운영을 위한,<br />단 하나의 화면.
          </h1>
          <p className="text-stone-300 text-base md:text-lg font-light tracking-wide max-w-2xl leading-relaxed">
            Airbnb · Booking.com · 아고다 · 직접예약 — 흩어진 채널을 한 캘린더에 묶고,
            <br className="hidden md:block" />
            청소 인력과 게스트 메시지까지 같은 화면에서 다룹니다.
          </p>
        </motion.div>
      </section>

      {/* Platform Mockup — full bleed */}
      <section className="px-4 sm:px-6 md:px-12 pb-24 md:pb-32">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[1400px] mx-auto bg-white shadow-2xl shadow-black/60 ring-1 ring-stone-300 text-stone-900 flex overflow-hidden"
        >
          {/* Sidebar */}
          <aside className="hidden sm:flex flex-col w-[110px] md:w-[140px] shrink-0 border-r border-stone-200 bg-white py-5 px-2 md:px-3">
            <div className="px-2 md:px-3 mb-4">
              <p className="text-[8px] md:text-[9px] tracking-[0.18em] uppercase text-stone-900 font-semibold leading-tight">VOID ANCHAE</p>
              <p className="text-[7px] md:text-[8px] text-stone-400 mt-1">예약 포털 →</p>
            </div>
            <div className="space-y-px">
              {[
                { label: '대시보드' },
                { label: '숙소 관리' },
                { label: '캘린더', active: true },
                { label: '예약' },
                { label: '메시지' },
                { label: '청소 담당자' },
                { label: '청소 보고서' },
                { label: '유저 관리' },
                { label: '프로필' },
              ].map(item => (
                <div
                  key={item.label}
                  className={`relative pl-3 pr-2 py-1.5 text-[9px] md:text-[10px] ${
                    item.active
                      ? 'bg-stone-50 text-stone-900 font-medium before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]'
                      : 'text-stone-500'
                  }`}
                >
                  {item.label}
                </div>
              ))}
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 p-4 sm:p-5 md:p-6 min-w-0">
            {/* Page header */}
            <div className="flex items-start justify-between gap-3 pb-4 mb-4 border-b border-stone-200">
              <div>
                <p className="text-[9px] uppercase tracking-[0.25em] text-[var(--brand)] mb-1 font-medium">캘린더</p>
                <h3 className="text-base sm:text-xl font-semibold text-stone-900 tracking-tight">통합 캘린더</h3>
                <p className="text-[10px] text-stone-500 mt-0.5">모든 숙소의 투숙 및 청소 일정</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="p-1.5 text-stone-500 bg-stone-100"><ChevronLeft size={11} /></button>
                <span className="text-[10px] tabular-nums font-semibold text-stone-900 px-2 min-w-[80px] text-center">2026년 4월</span>
                <button className="p-1.5 text-stone-500 bg-stone-100"><ChevronRight size={11} /></button>
                <button className="ml-1 px-2 py-1.5 text-[9px] font-medium text-stone-700 bg-stone-100 uppercase tracking-widest">오늘</button>
                <button className="ml-1 px-2 py-1.5 text-[9px] font-medium text-stone-700 bg-stone-100 uppercase tracking-widest hidden md:inline-flex items-center gap-1">
                  <RefreshCw size={9} /> 동기화
                </button>
              </div>
            </div>

            {/* Property filter */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-[9px] text-stone-500 mr-1">숙소</span>
              {PROPS.map(p => (
                <span
                  key={p.id}
                  className="px-2 py-0.5 text-[9px] font-medium inline-flex items-center gap-1.5"
                  style={{ backgroundColor: rgba(p.color, 0.18), color: '#1c1917' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                </span>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-stone-500 mb-3">
              <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 전체 예약 가능</div>
              <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 일부 예약 가능</div>
              <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> 예약 불가</div>
              <span className="w-px h-2.5 bg-stone-200" />
              <div className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-emerald-500" /> 정비 완료</div>
              <div className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-white ring-1 ring-stone-300" /> 정비 대기</div>
            </div>

            {/* Calendar grid */}
            <div className="bg-white border border-stone-200 overflow-hidden">
              {/* Day-of-week header */}
              <div className="flex border-b border-stone-200 bg-stone-50">
                <div className="w-[44px] sm:w-[64px] shrink-0 border-r-2 border-stone-300 py-1.5 text-center">
                  <span className="text-[8px] font-semibold text-stone-500">숙소</span>
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                    <div
                      key={d}
                      className={`py-1.5 text-center text-[9px] font-semibold ${
                        i === 0 ? 'text-rose-500' : i === 6 ? 'text-sky-600' : 'text-stone-700'
                      } ${i < 6 ? 'border-r border-stone-200' : ''}`}
                    >
                      {d}
                    </div>
                  ))}
                </div>
              </div>

              {/* === Week 1 (19–25) === */}
              <div className="border-b border-stone-200">
                <div className="flex border-b border-stone-200">
                  <div className="w-[44px] sm:w-[64px] shrink-0 border-r-2 border-stone-300" />
                  <div className="flex-1 grid grid-cols-7">
                    {WEEK_1.daysLabel.map((d, i) => (
                      <div
                        key={d}
                        className={`py-1.5 px-1.5 flex items-center justify-end text-[9px] font-medium tabular-nums ${
                          i === 0 ? 'text-rose-500 font-semibold bg-rose-50/40' :
                          i === 6 ? 'text-sky-600 font-semibold bg-sky-50/40' :
                          'text-stone-900'
                        } ${i < 6 ? 'border-r border-stone-200' : ''}`}
                      >
                        {d}
                      </div>
                    ))}
                  </div>
                </div>
                {PROPS.map(p => (
                  <PropertyLane key={p.id} prop={p} events={W1_EVENTS[p.id] || []} />
                ))}
              </div>

              {/* === Week 2 (26–2) with today highlight === */}
              <div>
                <div className="flex border-b border-stone-200">
                  <div className="w-[44px] sm:w-[64px] shrink-0 border-r-2 border-stone-300" />
                  <div className="flex-1 grid grid-cols-7">
                    {WEEK_2.daysLabel.map((d, i) => {
                      const isToday = i === WEEK_2.todayIdx;
                      const isOutside = WEEK_2.outsideMonth.includes(i);
                      const avail = WEEK_2.availability.find(a => a.col === i);
                      return (
                        <div
                          key={d + '-' + i}
                          className={`py-1.5 px-1.5 flex items-center justify-between gap-1 text-[9px] font-medium tabular-nums ${
                            isToday ? 'bg-[var(--brand-tint)]' :
                            i === 0 ? 'bg-rose-50/40' :
                            i === 6 ? 'bg-sky-50/40' :
                            ''
                          } ${i < 6 ? 'border-r border-stone-200' : ''}`}
                        >
                          {avail && (
                            <span className="inline-flex items-center gap-0.5">
                              <span className={`w-1 h-1 rounded-full ${avail.dot === 'rose' ? 'bg-rose-500' : avail.dot === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                              <span className="text-[7px] hidden sm:inline">{avail.text}</span>
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center justify-center w-5 h-5 ${
                              isToday ? 'bg-[var(--brand)] text-white font-bold' :
                              isOutside ? 'text-stone-300' :
                              i === 0 ? 'text-rose-500 font-semibold' :
                              i === 6 ? 'text-sky-600 font-semibold' :
                              'text-stone-900'
                            }`}
                          >
                            {d}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {PROPS.map(p => (
                  <PropertyLane key={p.id} prop={p} events={W2_EVENTS[p.id] || []} />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="border-t border-stone-800 px-6 md:px-12 py-20 md:py-28">
        <div className="max-w-[1200px] mx-auto">
          <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-4">What it does</p>
          <h2 className="text-3xl md:text-5xl font-light tracking-tight leading-tight mb-12 max-w-3xl">
            흩어진 운영을<br />한 화면으로 묶어냅니다.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-stone-800 border-y border-stone-800">
            {PLATFORM_FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.6, delay: i * 0.06 }}
                  className="bg-[#0C0A09] flex flex-col gap-4 p-6 md:p-8 min-h-[160px]"
                >
                  <Icon size={20} className="text-[var(--brand)]" />
                  <div>
                    <p className="text-stone-50 text-base font-medium tracking-tight mb-1.5">{f.label}</p>
                    <p className="text-stone-400 text-sm font-light leading-relaxed">{f.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Messages mockup — second platform surface */}
      <section className="border-t border-stone-800 px-4 sm:px-6 md:px-12 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto">
          <div className="mb-10 md:mb-12 px-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-3">Inbox</p>
            <h2 className="text-2xl md:text-4xl font-light tracking-tight leading-tight max-w-3xl">
              모든 채널의 게스트 메시지를<br />한 인박스에서.
            </h2>
            <p className="text-stone-400 text-sm font-light mt-4 max-w-2xl">
              Airbnb · Booking.com · 아고다 — 채널마다 다른 인박스를 오갈 필요가 없습니다.
              예약 정보와 함께 같은 화면에서 응답합니다.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white shadow-2xl shadow-black/60 ring-1 ring-stone-300 text-stone-900 flex overflow-hidden"
          >
            {/* Sidebar */}
            <aside className="hidden sm:flex flex-col w-[110px] md:w-[140px] shrink-0 border-r border-stone-200 bg-white py-5 px-2 md:px-3">
              <div className="px-2 md:px-3 mb-4">
                <p className="text-[8px] md:text-[9px] tracking-[0.18em] uppercase text-stone-900 font-semibold leading-tight">VOID ANCHAE</p>
                <p className="text-[7px] md:text-[8px] text-stone-400 mt-1">예약 포털 →</p>
              </div>
              <div className="space-y-px">
                {[
                  { label: '대시보드' },
                  { label: '숙소 관리' },
                  { label: '캘린더' },
                  { label: '예약' },
                  { label: '메시지', active: true },
                  { label: '청소 담당자' },
                  { label: '청소 보고서' },
                  { label: '유저 관리' },
                  { label: '프로필' },
                ].map(item => (
                  <div
                    key={item.label}
                    className={`relative pl-3 pr-2 py-1.5 text-[9px] md:text-[10px] ${
                      item.active
                        ? 'bg-stone-50 text-stone-900 font-medium before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]'
                        : 'text-stone-500'
                    }`}
                  >
                    {item.label}
                  </div>
                ))}
              </div>
            </aside>

            {/* Main */}
            <div className="flex-1 p-4 sm:p-5 md:p-6 min-w-0">
              {/* Page header */}
              <div className="flex items-start justify-between gap-3 pb-4 mb-4 border-b border-stone-200">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.25em] text-[var(--brand)] mb-1 font-medium">대화</p>
                  <h3 className="text-base sm:text-xl font-semibold text-stone-900 tracking-tight">메시지</h3>
                  <p className="text-[10px] text-stone-500 mt-0.5">게스트와의 대화를 관리합니다</p>
                </div>
                <button className="px-2 py-1.5 text-[9px] font-medium text-stone-700 bg-stone-100 uppercase tracking-widest inline-flex items-center gap-1 shrink-0">
                  <RefreshCw size={9} /> Beds24 동기화
                </button>
              </div>

              {/* 2-column body */}
              <div className="flex gap-3 sm:gap-4">
                {/* Conversation list */}
                <div className="w-[160px] sm:w-[200px] md:w-[240px] shrink-0 border-r border-stone-200 pr-2 sm:pr-3">
                  <p className="text-[9px] text-stone-500 uppercase tracking-widest mb-2 px-1 font-semibold">대화 목록</p>
                  <div className="space-y-px">
                    {[
                      { name: 'Sarah Miller',  prop: '다온재', date: '2026-04-25', preview: 'Your stay at Daon is ready! You can...', time: '어제', active: true },
                      { name: 'Yuki TANAKA',   prop: '청림재', date: '2026-04-25', preview: 'See you next week!', time: '4월 16일' },
                      { name: 'Marco Rossi',   prop: '청림재', date: '2026-04-24', preview: 'Grazie', time: '5일 전' },
                      { name: '정민호',        prop: '청림재', date: '2026-04-23', preview: '에어팟 찾았습니다 감사해요', time: '5일 전' },
                      { name: 'Alex Petrov',   prop: '다온재', date: '2026-04-23', preview: 'Your stay at Daon is ready! You ca...', time: '3일 전' },
                      { name: 'David Chen',    prop: '청림재', date: '2026-04-22', preview: '객실 정비가 완료되었습니다. 체크인 준...', time: '4일 전' },
                      { name: 'Emma Brown',    prop: '다온재', date: '2026-04-21', preview: '네! 창고는 이곳에 위치해 있습니다. [네...', time: '4일 전' },
                      { name: 'John Smith',    prop: '청림재', date: '2026-04-20', preview: 'John 님, 안녕하세요. 편안하게 지내...', time: '4일 전' },
                    ].map((c, i) => (
                      <div key={i} className={`relative px-2 py-2 ${c.active ? 'bg-[var(--brand-tint)] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[var(--brand)]' : ''}`}>
                        <div className="flex justify-between items-baseline gap-1">
                          <p className={`text-[10px] truncate ${c.active ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'}`}>{c.name}</p>
                          <span className="text-[8px] text-stone-400 shrink-0">{c.time}</span>
                        </div>
                        <p className="text-[8px] text-stone-500 mb-0.5 mt-0.5">{c.prop} <span className="tabular-nums">{c.date}</span></p>
                        <p className="text-[8px] text-stone-400 truncate leading-tight">{c.preview}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Active conversation */}
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Conversation header */}
                  <div className="pb-3 mb-3 border-b border-stone-200">
                    <p className="text-sm font-semibold text-stone-900">Sarah Miller</p>
                    <p className="text-[10px] text-stone-500 mt-0.5">
                      다온재 <span className="text-stone-300 mx-1">·</span> <span className="tabular-nums">2026-04-25 → 2026-04-28</span>
                    </p>
                  </div>

                  {/* Booking info card */}
                  <div className="bg-stone-50 p-3 mb-4 text-[10px] text-stone-700 leading-relaxed">
                    <p className="font-semibold text-stone-900 mb-1.5">예약 정보</p>
                    <p>게스트: Sarah Miller</p>
                    <p>이메일: smiller.482395@guest.booking.com</p>
                    <p>연락처: <span className="tabular-nums">+1 555 0123 4567</span></p>
                    <p>인원: 성인 1명</p>
                    <p>채널: booking</p>
                  </div>

                  {/* Host message bubble */}
                  <div className="flex justify-end mb-3">
                    <div className="bg-[var(--brand)] text-white px-4 py-3 max-w-[85%] text-[10px] leading-relaxed space-y-2">
                      <p>Your stay at Daon is ready!</p>
                      <p>You can check in starting from now.</p>
                      <p>
                        Door Lock Password: 1234*<br />
                        Location: <span className="underline">https://naver.me/example</span>
                      </p>
                      <p>Please make sure to use Naver Map to find the exact location, as other maps can sometimes be inaccurate in this area.</p>
                      <p>To activate the keypad, you must touch the pad once with your entire palm. Then, enter the password followed by the asterisk (*).</p>
                      <p>We look forward to having you with us!</p>
                      <p className="text-[8px] text-white/70 pt-1">어제</p>
                    </div>
                  </div>

                  {/* Composer */}
                  <div className="mt-auto flex items-center gap-2 border border-stone-200 px-3 py-2">
                    <span className="flex-1 text-[10px] text-stone-400">메시지를 입력하세요...</span>
                    <button className="w-6 h-6 bg-[var(--brand-tint)] flex items-center justify-center text-[var(--brand)]" aria-label="전송">
                      <Send size={11} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* WelcomePad — included service of the platform */}
      <section className="border-t border-stone-800 px-6 md:px-12 py-20 md:py-28 bg-stone-950/40">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          {/* Text */}
          <div className="lg:col-span-5 order-2 lg:order-1">
            <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-4">Included Service · 객실 컨시어지</p>
            <h2 className="text-3xl md:text-5xl font-light tracking-tight leading-tight mb-6">
              객실 안에는,<br />WelcomePad.
            </h2>
            <p className="text-stone-300 text-base font-light leading-relaxed mb-10 max-w-xl">
              호스팅 플랫폼은 데스크에서 끝나지 않습니다. 객실에 비치된 패드 한 대가
              가이드 · 다이닝 · 배달 · 투어 · 택시까지 게스트의 손에서 바로 처리합니다.
              새벽 두 시 메신저 알림이 줄어듭니다.
            </p>
            <ul className="space-y-px bg-stone-800 border-y border-stone-800">
              {WELCOMEPAD_FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <motion.li
                    key={f.label}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{ duration: 0.5, delay: i * 0.06 }}
                    className="bg-[#0C0A09] flex items-start gap-4 px-5 py-4"
                  >
                    <Icon size={18} className="text-[var(--brand)] mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-stone-50 text-sm font-medium tracking-tight">{f.label}</p>
                      <p className="text-stone-400 text-xs font-light mt-1 leading-relaxed">{f.desc}</p>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          </div>

          {/* Mockup — landscape pad UI matching real JAZZ device */}
          <div className="lg:col-span-7 order-1 lg:order-2">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="w-full aspect-[16/10] ring-[6px] ring-stone-900 shadow-2xl shadow-black/60 relative overflow-hidden text-stone-50"
              style={{ background: 'radial-gradient(ellipse at center, #14223c 0%, #050810 75%)' }}
            >
              {/* status dot */}
              <span className="absolute top-2.5 left-3 w-1.5 h-1.5 rounded-full bg-emerald-500" />

              {/* top-right languages + property */}
              <div className="absolute top-3 right-4 sm:top-4 sm:right-5 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[8px] sm:text-[9px] uppercase tracking-widest mb-1">
                  <span className="text-stone-50">English</span>
                  <span className="text-stone-700">·</span>
                  <span className="text-stone-400">한국어</span>
                  <span className="text-stone-700">·</span>
                  <span className="text-stone-400">日本語</span>
                  <span className="text-stone-700">·</span>
                  <span className="text-stone-400">中文</span>
                </div>
                <p className="text-[8px] sm:text-[9px] uppercase tracking-[0.3em] text-[var(--brand)] font-medium">Cheongrim</p>
              </div>

              {/* left vertical menu */}
              <div className="absolute left-4 sm:left-7 top-1/2 -translate-y-1/2">
                <p className="text-[7px] sm:text-[8px] uppercase tracking-[0.3em] text-stone-500 mb-2 sm:mb-4">Menu</p>
                <ul className="space-y-2 sm:space-y-3">
                  {['Guide', 'Dining', 'Delivery', 'Tour', 'Taxi'].map(item => (
                    <li key={item} className="flex items-center gap-2 sm:gap-3">
                      <span className="w-1 h-1 rounded-full bg-[var(--brand)] shrink-0" />
                      <span className="text-[9px] sm:text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] font-light">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* center hero */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center text-center px-12">
                <p className="text-[7px] sm:text-[9px] uppercase tracking-[0.5em] text-[var(--brand)] mb-2 sm:mb-3">Welcome</p>
                <h3 className="font-serif text-2xl sm:text-4xl text-stone-50 tracking-tight mb-2 sm:mb-4 italic font-light leading-none whitespace-nowrap">
                  Yuki TANAKA
                </h3>
                <p className="text-[8px] sm:text-[10px] uppercase tracking-[0.3em] text-[var(--brand)] mb-0.5">Cheongrim</p>
                <p className="text-[7px] sm:text-[9px] tabular-nums text-stone-300 mb-2 sm:mb-3">Apr 25 – Apr 27, 2026</p>
                <div className="w-px h-3 sm:h-5 bg-stone-600 mb-2 sm:mb-3" />
                <p className="text-[7px] sm:text-[10px] text-stone-300 italic">Wishing you a peaceful and comfortable stay.</p>
              </div>

              {/* WiFi QR card bottom-right */}
              <div className="absolute bottom-7 sm:bottom-9 right-3 sm:right-4 bg-stone-950/70 ring-1 ring-white/10 backdrop-blur-sm px-2 py-1.5 sm:px-2.5 sm:py-2 flex items-center gap-2 sm:gap-2.5">
                <QrCode size={28} className="text-stone-50 shrink-0" strokeWidth={1.2} />
                <div className="leading-tight">
                  <p className="text-[6px] sm:text-[7px] uppercase tracking-[0.25em] text-[var(--brand)] mb-0.5">Wi-Fi</p>
                  <p className="text-[7px] sm:text-[8px] text-stone-100 font-medium">KT_GiGA_5G</p>
                  <p className="text-[6px] sm:text-[7px] text-stone-400 font-mono tabular-nums">PW : cheongrim2026</p>
                  <p className="text-[5px] sm:text-[6px] uppercase tracking-widest text-stone-500 mt-0.5">Scan to Connect</p>
                </div>
              </div>

              {/* bottom row */}
              <p className="absolute bottom-2 left-3 sm:left-4 text-[7px] sm:text-[8px] text-stone-500 tabular-nums">Sun, April 27, 2026</p>
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[7px] sm:text-[9px] uppercase tracking-[0.3em] text-stone-500 font-light">WelcomePad</p>
              <p className="absolute bottom-1 right-3 sm:right-4 text-base sm:text-2xl text-[var(--brand)] tabular-nums font-light leading-none">23:28</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-t border-stone-800 px-6 md:px-12 py-20 md:py-28">
        <div className="max-w-[900px] mx-auto">
          <p className="text-[11px] uppercase tracking-[0.3em] text-stone-500 mb-6">Why void anchae</p>
          <h2 className="text-3xl md:text-4xl font-light tracking-tight leading-snug mb-8">
            &ldquo;운영을 직접 합니다.<br />
            <span className="text-stone-500">그래서 호스트의 하루를 압니다.&rdquo;</span>
          </h2>
          <div className="space-y-5 text-stone-300 text-base font-light leading-relaxed max-w-2xl">
            <p>
              플랫폼은 우리 자신이 매일 쓰는 도구입니다.
              매일의 운영에서 검증되지 않은 기능은 밖으로 내보내지 않습니다.
              우리가 쓰지 않는 도구는 권하지 않습니다.
            </p>
            <p>
              대행 업체는 KPI를 답합니다. 우리는 호스트를 답합니다.
              청소 인력의 손목 통증부터 게스트 한 명의 새벽 메시지까지 — 운영의 결을 압니다.
            </p>
          </div>
        </div>
      </section>

      {/* CTA — slim */}
      <section id="contact" className="border-t border-stone-800 px-6 md:px-12 py-16 md:py-20">
        <div className="max-w-[1100px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-2">Contact</p>
            <h2 className="text-2xl md:text-3xl font-light tracking-tight leading-tight">도입 문의</h2>
          </div>
          <a
            href="mailto:unwadang@gmail.com?subject=Void Anchae 호스팅 플랫폼 도입 문의"
            className="inline-flex items-center justify-between gap-6 bg-stone-50 hover:bg-white text-stone-950 px-6 py-4 text-xs uppercase tracking-widest font-semibold transition-colors min-h-[44px] shrink-0"
          >
            unwadang@gmail.com
            <ArrowRight size={16} />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-12 px-6 md:px-12">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="opacity-80">
            <Logo width={120} />
          </div>
          <div className="text-xs uppercase tracking-widest text-stone-400">
            © {new Date().getFullYear()} void anchae. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
