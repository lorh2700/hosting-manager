'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Camera, Check, ChevronDown, ChevronRight, PawPrint, RefreshCw, Search, Wrench } from 'lucide-react';
import { NavigationLink as Link } from '@/components/NavigationFeedback';
import { Logo } from '@/components/Logo';
import type { OpsProperty, OpsReservation } from '@/app/api/ops/today/route';
import { needsOpsCleaning, opsCleaningLabel, opsDeliveryLabel, opsNextAction } from '@/lib/ops-attention';
import styles from './TodayBoard.module.css';

interface TodayData {
  today: string;
  detailsLoaded?: boolean;
  properties: OpsProperty[];
  cleaners: { id: string; name: string }[];
}
interface TodayBoardProps {
  data: TodayData | null;
  loading: boolean;
  refreshing: boolean;
  updatedAt: Date | null;
  loadError: string;
  detailsError: string;
  detailsReady: boolean;
  actionsBlocked: boolean;
  busy: string | null;
  delivery: Record<string, string>;
  assign: Record<string, string>;
  onRefresh: () => void;
  onAssignChange: (propertyId: string, cleanerId: string) => void;
  onAssign: (property: OpsProperty) => void;
  onCheckout: (property: OpsProperty) => void;
  onComplete: (property: OpsProperty) => void;
  onSendReady: (property: OpsProperty, reservation: OpsReservation) => void;
  onCamera: (propertyId: string) => void;
  onMaintenance: () => void;
  renderGuest: (reservation: OpsReservation, statusLine?: ReactNode, action?: ReactNode) => ReactNode;
}

function CleaningStatus({ property, ready }: { property: OpsProperty; ready: boolean }) {
  const label = opsCleaningLabel(property, ready);
  const tone = label === '완료' ? styles.good : label === '미배정' || label === '확인 필요' ? styles.warn : label === '배정 완료' ? styles.info : '';
  return <span className={`${styles.badge} ${tone}`}>{label}</span>;
}

function ReservationSummary({ reservations, checkin = false }: { reservations: OpsReservation[]; checkin?: boolean }) {
  if (!reservations.length) return <span className={styles.muted}>없음</span>;
  return <div className={styles.reservations}>{reservations.map(reservation => <div key={reservation.id}>
    <span className={styles.guest}>{reservation.guestName}</span>
    <span className={styles.caption}>{reservation.guests != null ? `${reservation.guests}인 · ` : ''}{reservation.channel}</span>
    {checkin && reservation.pets != null && reservation.pets > 0 && <span className={`${styles.badge} ${styles.warn}`}><PawPrint size={12} aria-hidden="true"/>반려견 {reservation.pets}마리</span>}
  </div>)}</div>;
}

function PropertyDetails({ property: p, board, context }: { property: OpsProperty; board: TodayBoardProps; context: string }) {
  const done = p.cleaning?.status === 'done';
  const disabled = !!board.busy || board.actionsBlocked;
  const canClean = needsOpsCleaning(p);
  const checkoutLine = !board.detailsReady ? <p className={styles.warning}>퇴실 상태 확인 필요</p> : p.checkoutStatus?.confirmed
    ? <p className={styles.confirmed}><Check size={14} aria-hidden="true"/>{p.checkoutStatus.confirmedBy === 'guest_pad' ? '게스트가 패드에서 퇴실 확인' : '퇴실 확인됨'}{p.checkoutStatus.confirmedAt ? ` · ${format(new Date(p.checkoutStatus.confirmedAt), 'HH:mm')}` : ''}</p>
    : <p className={styles.muted}>아직 퇴실 확인 전 · 필요하면 카메라에서 확인해 주세요.</p>;
  return <div id={`${context}-detail-${p.id}`} className={styles.details} role="region" aria-label={`${p.name} 오늘 업무 상세`}>
    <div className={styles.detailHeading}><h2>{p.name} · 오늘 업무</h2><button type="button" className={styles.button} onClick={() => board.onCamera(p.id)}><Camera size={16} aria-hidden="true"/>복도 카메라</button></div>
    <div className={styles.detailGrid}>
      <div className={styles.detailColumn}>
        {p.checkouts.length > 0 && <section className={styles.detailSection}><h3>퇴실</h3>{p.checkouts.map(reservation => <div key={reservation.id}>{board.renderGuest(reservation, checkoutLine,
          !p.checkoutStatus?.confirmed ? <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={() => board.onCheckout(p)}>{board.busy === `checkout:${p.id}` ? '확인 중…' : '퇴실 확인'}</button> : undefined
        )}</div>)}</section>}
        <section className={styles.detailSection}><h3>청소</h3><p className={styles.statusLine}><CleaningStatus property={p} ready={board.detailsReady}/>{p.cleaning?.cleanerName && <span>{p.cleaning.cleanerName}</span>}</p>
          {!canClean ? <p className={styles.muted}>오늘 청소 일정이 없습니다. 입실 안내는 별도로 확인할 수 있습니다.</p> : <>
            {(p.cleaning?.supplies || p.cleaning?.notes) && <p>{[p.cleaning.supplies, p.cleaning.notes].filter(Boolean).join(' · ')}</p>}
            {!done && !p.cleaning?.cleanerId && <div className={styles.assignment}><label className={styles.srOnly} htmlFor={`${context}-cleaner-${p.id}`}>청소 담당자</label><select id={`${context}-cleaner-${p.id}`} value={board.assign[p.id] ?? ''} disabled={disabled} onChange={event => board.onAssignChange(p.id, event.target.value)}><option value="">담당자 선택</option>{board.data?.cleaners.map(cleaner => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}</select><button type="button" className={styles.button} disabled={disabled || !board.assign[p.id]} onClick={() => board.onAssign(p)}>{board.busy === `assign:${p.id}` ? '배정 중…' : '배정'}</button></div>}
            {!done && <div><button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={() => board.onComplete(p)}>{board.busy === `done:${p.id}` ? '처리 중…' : '청소 완료'}</button></div>}
          </>}
        </section>
      </div>
      <div className={styles.detailColumn}>
        <section className={styles.detailSection}><h3>입실</h3>{p.checkins.length ? p.checkins.map(reservation => <div key={reservation.id}>{board.renderGuest(reservation)}</div>) : <p className={styles.muted}>오늘 입실 없음</p>}</section>
        {p.checkins.some(reservation => reservation.hasChat) && <section className={styles.detailSection}><h3>입실 안내 · 청소 기록과 별도</h3><details className={styles.messagePreview}><summary>안내 내용 보기</summary><p>{p.readyMessage}</p></details>
          {p.checkins.filter(reservation => reservation.hasChat).map(reservation => {
            const state = board.delivery[reservation.id] ?? reservation.readyDelivery;
            return <div key={reservation.id} className={styles.delivery}><p>{reservation.guestName} · <span className={state && !['sent','sending','pending','queued'].includes(state) ? styles.warning : styles.muted}>{opsDeliveryLabel(state)}</span></p>{state === 'sent' && <p className={styles.caption}>게스트 플랫폼 도착 여부는 대화에서 확인해 주세요.</p>}{state && !['sent','sending','pending','queued','failed','local_only'].includes(state) && <p className={styles.warning}>{state}</p>}<div className={styles.actions}>{state !== 'sent' && <button type="button" className={styles.button} disabled={disabled} onClick={() => board.onSendReady(p, reservation)}>{state === 'sending' ? '전송 중…' : '입실 안내 보내기'}</button>}<Link className={styles.textLink} href={`/admin/messages?eventId=${encodeURIComponent(reservation.id)}&guestName=${encodeURIComponent(reservation.guestName)}&propertyId=${encodeURIComponent(p.id)}`}>{reservation.channel} 대화 확인<ChevronRight size={14} aria-hidden="true"/></Link></div></div>;
          })}
        </section>}
      </div>
    </div>
  </div>;
}

export default function TodayBoard(board: TodayBoardProps) {
  const [filter, setFilter] = useState<'all' | 'attention' | 'checkin'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const properties = useMemo(() => [...(board.data?.properties ?? [])].sort((a,b) => Number(!!opsNextAction(b, board.detailsReady, board.delivery)) - Number(!!opsNextAction(a, board.detailsReady, board.delivery)) || Number(b.hasWork) - Number(a.hasWork) || a.name.localeCompare(b.name, 'ko')), [board.data, board.detailsReady, board.delivery]);
  const attention = properties.filter(property => opsNextAction(property, board.detailsReady, board.delivery)).length;
  const visible = properties.filter(property => (filter === 'all' || filter === 'attention' && !!opsNextAction(property, board.detailsReady, board.delivery) || filter === 'checkin' && property.checkins.length > 0) && property.name.includes(query.trim()));
  const toggle = (id: string) => setExpanded(current => current === id ? null : id);
  const date = board.data?.today ? new Date(`${board.data.today}T12:00:00+09:00`) : new Date();
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><h1>오늘</h1><p>{format(date, 'M월 d일 EEEE', { locale: ko })} · 숙소별 운영 현황</p></div><button type="button" className={styles.button} disabled={board.refreshing} onClick={board.onRefresh}><RefreshCw size={16} className={board.refreshing ? styles.spinning : ''} aria-hidden="true"/>{board.refreshing && board.data ? '확인 중…' : '새로고침'}</button></header>
    {board.loadError && <div className={styles.alert} role="alert"><p>{board.loadError}</p><button type="button" className={styles.button} disabled={board.refreshing} onClick={board.onRefresh}>다시 불러오기</button></div>}
    {board.detailsError && <div className={styles.alert} role="alert"><p>{board.detailsError}</p><button type="button" className={styles.button} disabled={board.refreshing} onClick={board.onRefresh}>다시 불러오기</button></div>}
    <div className={styles.toolbar}><div className={styles.filters} aria-label="오늘 숙소 필터">{([
      ['all','전체 숙소',properties.length],['attention','처리할 숙소',attention],['checkin','입실 준비',properties.filter(p=>p.checkins.length).length],
    ] as const).map(([key,label,count]) => <button type="button" key={key} className={styles.filter} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}<span>{board.loading && !board.data ? '…' : count}</span></button>)}</div><label className={styles.search}><Search size={16} aria-hidden="true"/><input type="search" aria-label="숙소 검색" value={query} placeholder="숙소 검색" onChange={event=>setQuery(event.target.value)}/></label></div>
    {board.loading && !board.data ? <div role="status" aria-live="polite" aria-label="오늘 숙소 현황을 불러오는 중" className={styles.loading}><div className={styles.loadingLabel}><Logo variant="black" width={125}/><span>오늘 일정을 확인하고 있습니다.</span></div>{Array.from({length:4},(_,i)=><div className={styles.skeletonRow} key={i}><span/><span/><span/></div>)}</div> : <>
      <div className={styles.meta}><span>{visible.length}개 숙소</span><span role="status">{board.refreshing ? '최신 정보 확인 중…' : board.updatedAt ? `마지막 확인 ${format(board.updatedAt,'HH:mm')}` : '아래로 당겨 새로고침'}</span></div>
      <div className={styles.desktop}><table className={styles.table}><thead><tr><th scope="col">숙소</th><th scope="col">퇴실</th><th scope="col">입실</th><th scope="col">청소</th><th scope="col">필요한 행동</th></tr></thead><tbody>{visible.map(p=>{
        const action=opsNextAction(p,board.detailsReady,board.delivery);
        return <Fragment key={p.id}><tr><th scope="row"><button type="button" className={styles.propertyName} aria-expanded={expanded===p.id} aria-controls={`today-table-detail-${p.id}`} onClick={()=>toggle(p.id)}>{p.name}<ChevronDown size={14} className={expanded===p.id?styles.rotated:''} aria-hidden="true"/></button></th><td><ReservationSummary reservations={p.checkouts}/>{p.checkouts.length>0&&p.checkoutStatus?.confirmed&&<span className={`${styles.badge} ${styles.good}`}>퇴실 확인</span>}</td><td><ReservationSummary reservations={p.checkins} checkin/></td><td><CleaningStatus property={p} ready={board.detailsReady}/>{p.cleaning?.cleanerName&&<span className={styles.caption}>{p.cleaning.cleanerName}</span>}</td><td>{action?<button type="button" className={`${styles.button} ${action.tone==='danger'?styles.danger:''}`} aria-expanded={expanded===p.id} aria-controls={`today-table-detail-${p.id}`} onClick={()=>toggle(p.id)}>{action.label}</button>:<button type="button" className={styles.textLink} aria-expanded={expanded===p.id} aria-controls={`today-table-detail-${p.id}`} onClick={()=>toggle(p.id)}>{p.hasWork?'상세 보기':'오늘 일정 없음'}</button>}</td></tr><tr hidden={expanded!==p.id}><td colSpan={5} className={styles.detailCell}>{expanded===p.id&&<PropertyDetails property={p} board={board} context="today-table"/>}</td></tr></Fragment>;
      })}</tbody></table></div>
      <div className={styles.mobile}>{visible.map(p=>{const action=opsNextAction(p,board.detailsReady,board.delivery);const pets=p.checkins.reduce((sum,r)=>sum+(r.pets??0),0);return <article className={styles.mobileProperty} key={p.id}><div className={styles.mobileHeading}><button type="button" className={styles.propertyName} aria-expanded={expanded===p.id} aria-controls={`today-mobile-detail-${p.id}`} onClick={()=>toggle(p.id)}>{p.name}<ChevronDown size={14} className={expanded===p.id?styles.rotated:''} aria-hidden="true"/></button><CleaningStatus property={p} ready={board.detailsReady}/></div><p className={styles.mobileEvents}><span>퇴실 <strong>{p.checkouts.length?`${p.checkouts.length}건`:'없음'}</strong></span><span aria-hidden="true">→</span><span>입실 <strong>{p.checkins.length?`${p.checkins.length}건`:'없음'}</strong></span>{pets>0&&<span className={`${styles.badge} ${styles.warn}`}><PawPrint size={12} aria-hidden="true"/>반려견 {pets}마리</span>}</p><div className={styles.mobileAction}><span className={styles.muted}>{p.cleaning?.cleanerName||(!p.hasWork?'오늘 일정 없음':action?.tone==='danger'?'안내 전송 확인 필요':opsCleaningLabel(p,board.detailsReady))}</span><button type="button" className={`${styles.button} ${action?.tone==='danger'?styles.danger:''}`} aria-expanded={expanded===p.id} aria-controls={`today-mobile-detail-${p.id}`} onClick={()=>toggle(p.id)}>{action?.label||'상세 보기'}<ChevronRight size={14} aria-hidden="true"/></button></div>{expanded===p.id&&<PropertyDetails property={p} board={board} context="today-mobile"/>}</article>;})}</div>
      {!visible.length&&<p className={styles.empty}>{properties.length?'조건에 맞는 숙소가 없습니다.':'관리하는 숙소가 없습니다.'}</p>}
      <footer className={styles.footer}><button type="button" className={styles.textLink} onClick={board.onMaintenance}><Wrench size={15} aria-hidden="true"/>객실 정비 등록</button><Link href="/admin/cleaning-report" className={styles.textLink}>청소 정산 내역<ChevronRight size={14} aria-hidden="true"/></Link></footer>
    </>}
  </div>;
}
