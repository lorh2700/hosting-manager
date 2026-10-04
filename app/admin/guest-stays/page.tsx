'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode';
import { ArrowUpRight, Check, Copy, Download, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Tablet, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { guestStayTransitions, guestStayPhase, type GuestStayRequestStatus, type GuestStayRequestDTO } from '@/lib/guest-stay';
import styles from './GuestStaysAdmin.module.css';

type RequestStatus = GuestStayRequestStatus;
type Property = { id: string; slug: string; name: string };
type Stay = { kind: 'event' | 'booking'; id: string; propertyId: string; propertyName: string; slug: string; guestName: string; checkIn: string; checkOut: string; guests: number | null; access: { id: string; issuedAt: string; expiresAt: string } | null };
type RequestRow = GuestStayRequestDTO & { propertyId: string; propertyName: string; guestName: string; internalNote?: string };
type Device = { id: string; propertyId: string; label: string; pairedAt: string | null; pairingExpiresAt?: string; expiresAt: string; revokedAt: string | null };
type ListData = { properties: Property[]; stays: Stay[]; requests: RequestRow[]; devices: Device[]; nextCursor: string | null; truncated?: boolean };
type Access = { accessId: string; code: string; expiresAt: string; path: string; privatePath: string };
type Share = { title: string; url: string; code?: string; expiresAt?: string; image: string };
const statuses: Record<RequestStatus, string> = { requested: '접수', reviewing: '확인 중', confirmed: '확정', cancelled: '취소', completed: '완료' };
const kinds = { tour: '투어·체험', taxi: '택시', help: '숙소 문의' };
const transitions = guestStayTransitions;
const detailLabels: Record<string, string> = { tourId: '상품 번호', tourSlug: '상품', tourTitle: '투어', course: '코스', date: '희망 날짜', time: '희망 시간', requestDate: '희망 날짜', requestTime: '희망 시간', guests: '인원', passengers: '탑승 인원', luggage: '수하물', destination: '목적지', pickupDate: '출발 날짜', pickupTime: '출발 시간', terminal: '터미널', message: '요청 내용', note: '요청 사항', notes: '요청 사항', category: '문의 분류', title: '문의 제목', contact: '연락 방법', phone: '연락처', email: '이메일', language: '언어' };
function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
function plusDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function dateTime(value: string) { return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
async function read<T>(response: Response): Promise<T> { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error || '처리하지 못했습니다. 다시 시도해 주세요.'); return data as T; }
function detailText(value: unknown): string { if (typeof value === 'string') return ({ supplies: '비품 요청', issue: '불편사항', other: '기타 문의' } as Record<string, string>)[value] || value; if (typeof value === 'number') return String(value); if (typeof value === 'boolean') return value ? '예' : '아니오'; if (Array.isArray(value)) return value.map(detailText).filter(Boolean).join(', '); return ''; }

function RequestCard({ row, onSaved }: { row: RequestRow; onSaved: () => void }) {
  const [status, setStatus] = useState(row.status);
  const [reply, setReply] = useState(row.publicReply || '');
  const [note, setNote] = useState(row.internalNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = status !== row.status || reply !== (row.publicReply || '') || note !== (row.internalNote || '');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await read(await fetch(`/api/guest-stays/requests/${encodeURIComponent(row.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, publicReply: reply, internalNote: note, version: row.version }) }));
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <article className={styles.requestCard}>
    <div className={styles.cardTop}><div><p className={styles.eyebrow}>{row.propertyName} · {row.source === 'pad' ? '객실 패드' : '휴대폰'} · {dateTime(row.createdAt)}</p><h2>{row.guestName} <span>{kinds[row.kind]}</span></h2></div><span className={styles.status} data-status={row.status}>{statuses[row.status]}</span></div>
    <dl className={styles.details}>{row.tourTitle && <div><dt>투어·체험</dt><dd>{row.tourTitle}</dd></div>}{row.durationTitle && <div><dt>코스</dt><dd>{row.durationTitle}</dd></div>}{Object.entries(row.details || {}).filter(([key, value]) => !['tourId', 'durationOptionId', 'ticketCounts', 'tourSnapshot'].includes(key) && detailText(value)).map(([key, value]) => <div key={key}><dt>{detailLabels[key] || '신청 내용'}</dt><dd>{detailText(value)}</dd></div>)}{row.tourSnapshot?.ticketSelections?.length ? <div><dt>티켓 종류</dt><dd>{row.tourSnapshot.ticketSelections.map(item => `${item.label} ${item.count}명`).join(' · ')}</dd></div> : null}{row.tourSnapshot?.price != null && <div><dt>신청 시 안내 금액</dt><dd>{row.tourSnapshot.price.toLocaleString()}원{row.tourSnapshot.pricingBasis === 'tickets' ? ' (티켓 합계)' : row.tourSnapshot.pricingBasis === 'course' ? ' (코스 기준)' : ' (참고 금액)'}</dd></div>}</dl>
    <fieldset className={styles.editor} disabled={busy}>
      <label>게스트에게 보여줄 안내<textarea value={reply} onChange={e => setReply(e.target.value)} maxLength={2000} rows={3} placeholder="확인한 일정·차량·요금 등을 알려 주세요."/><small>게스트의 ‘내 신청’ 화면에 표시됩니다. 문자나 플랫폼 메시지를 자동 발송하지 않습니다.</small></label>
      <label>담당자 메모<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={2} placeholder="내부에서만 확인할 내용"/><small>게스트에게 표시되지 않습니다.</small></label>
      <div className={styles.actions}><label>처리 상태<select value={status} onChange={e => setStatus(e.target.value as RequestStatus)}>{[row.status, ...transitions[row.status]].map(value => <option key={value} value={value}>{statuses[value]}</option>)}</select></label><button disabled={busy || !dirty} onClick={() => void save()}>{busy ? <Loader2 className={styles.spin} size={16}/> : <Check size={16}/>}변경 저장</button></div>
    </fieldset>{error && <p role="alert" className={styles.error}>{error} {error.includes('다른') || error.includes('변경') ? <button onClick={onSaved}>최신 내용 불러오기</button> : null}</p>}
  </article>;
}

export default function GuestStaysAdmin() {
  const { user, profile, loading: authLoading } = useAuth();
  const allowed = !!user && (profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'manager');
  const [tab, setTab] = useState<'requests' | 'access' | 'devices'>('requests');
  const [propertyId, setPropertyId] = useState('');
  const [from, setFrom] = useState(() => plusDays(today(), -7));
  const [to, setTo] = useState(() => plusDays(today(), 30));
  const [data, setData] = useState<ListData>({ properties: [], stays: [], requests: [], devices: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState('');
  const [share, setShare] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; propertyName: string } | null>(null);
  const [deviceProperty, setDeviceProperty] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('객실 웰컴패드');
  const request = useRef<AbortController | null>(null);
  const modal = useRef<HTMLElement | null>(null);
  const account = user?.id;
  const liveAccount = useRef<string | null>(null);

  useEffect(() => { liveAccount.current = allowed ? account || null : null; setData({ properties: [], stays: [], requests: [], devices: [], nextCursor: null }); setPropertyId(''); setDeviceProperty(''); setShare(null); setPairing(null); setNotice(''); setError(''); return () => { liveAccount.current = null; request.current?.abort(); }; }, [allowed, account]);
  const load = useCallback(async () => {
    if (!allowed) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from, to }); if (propertyId) params.set('propertyId', propertyId);
      const result = await read<ListData>(await fetch(`/api/guest-stays?${params}`, { signal: controller.signal, cache: 'no-store' }));
      if (!controller.signal.aborted && liveAccount.current === account) setData(previous => ({ ...result, properties: propertyId ? [...previous.properties.filter(item => !result.properties.some(next => next.id === item.id)), ...result.properties] : result.properties }));
    } catch (e) { if (!controller.signal.aborted && liveAccount.current === account) setError((e as Error).message); } finally { if (!controller.signal.aborted && liveAccount.current === account) setLoading(false); }
  }, [allowed, account, propertyId, from, to]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  useEffect(() => {
    if (!share && !pairing) return;
    const opener = document.activeElement as HTMLElement | null;
    modal.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShare(null); setPairing(null); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keys); return () => { window.removeEventListener('keydown', keys); opener?.focus(); };
  }, [share, pairing]);

  async function qr(title: string, path: string, code?: string, expiresAt?: string) {
    const url = new URL(path, window.location.origin).href;
    const image = await QRCode.toDataURL(url, { width: 900, margin: 4, errorCorrectionLevel: 'M' });
    if (liveAccount.current !== account) return;
    setCopied(false); setShare({ title, url, image, code, expiresAt });
  }
  async function issue(stay: Stay) {
    if (stay.access && !window.confirm('이용 코드를 새로 발급하면 이전 코드와 해당 코드로 로그인한 휴대폰은 사용할 수 없습니다. 새로 발급할까요?')) return;
    setBusy(stay.id); setError('');
    try { const result = await read<Access>(await fetch('/api/guest-stays/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: stay.kind, id: stay.id }) })); await qr(`${stay.propertyName} · ${stay.guestName}`, result.privatePath, result.code, result.expiresAt); void load(); }
    catch (e) { if (liveAccount.current === account) setError((e as Error).message); } finally { setBusy(''); }
  }
  async function revoke(type: 'access' | 'devices', id: string) {
    if (!window.confirm(type === 'access' ? '이 예약의 이용 코드와 해당 코드로 로그인한 휴대폰을 해제할까요?' : '이 패드의 연결을 해제할까요? 예약별 QR과 통합 신청 기능을 더 이상 사용할 수 없습니다.')) return;
    setBusy(id); setError('');
    try { await read(await fetch(`/api/guest-stays/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' })); if (liveAccount.current !== account) return; setNotice('연결이 해제되었습니다.'); void load(); } catch (e) { if (liveAccount.current === account) setError((e as Error).message); } finally { setBusy(''); }
  }
  async function pair() {
    const property = data.properties.find(item => item.id === (deviceProperty || propertyId));
    if (!property) { setError('연결할 숙소를 선택해 주세요.'); return; }
    setBusy('pair'); setError('');
    try { const result = await read<{ pairingCode: string; expiresAt: string }>(await fetch('/api/guest-stays/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: property.id, label: deviceLabel }) })); if (liveAccount.current !== account) return; setPairing({ code: result.pairingCode, expiresAt: result.expiresAt, propertyName: property.name }); void load(); } catch (e) { if (liveAccount.current === account) setError((e as Error).message); } finally { setBusy(''); }
  }

  if (authLoading || !user) return <p role="status">로그인 확인 중…</p>;
  if (!allowed) return <p>관리 권한이 필요합니다.</p>;
  const upcomingStays = data.stays.filter(stay => guestStayPhase(stay.checkIn.slice(0, 10), stay.checkOut.slice(0, 10)));
  const rows = data.requests.filter(row => (!status || row.status === status) && (!kind || row.kind === kind));
  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>GUEST EXPERIENCE</p><h1>게스트 웹앱</h1><p>휴대폰과 객실 패드에서 접수한 신청을 확인하고, 예약별 이용 코드와 패드 연결을 관리합니다.</p></div><button onClick={() => void load()} disabled={loading} aria-label="게스트 웹앱 새로고침"><RefreshCw size={17} className={loading ? styles.spin : ''}/>새로고침</button></header>
    <nav className={styles.tabs} aria-label="게스트 웹앱 관리"><button aria-current={tab === 'requests' ? 'page' : undefined} onClick={() => setTab('requests')}><Smartphone size={17}/>신청함{data.requests.some(row => row.status === 'requested') && <span>{data.requests.filter(row => row.status === 'requested').length}</span>}</button><button aria-current={tab === 'access' ? 'page' : undefined} onClick={() => setTab('access')}><QrCode size={17}/>QR·이용 코드</button><button aria-current={tab === 'devices' ? 'page' : undefined} onClick={() => setTab('devices')}><Tablet size={17}/>패드 연결</button></nav>
    <section className={styles.filters} aria-label="숙소와 기간"><label>숙소<select value={propertyId} onChange={e => setPropertyId(e.target.value)}><option value="">전체 숙소</option>{data.properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>조회 시작일<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>조회 종료일<input type="date" min={from} value={to} onChange={e => setTo(e.target.value)}/></label></section>
    {error && <div className={styles.error} role="alert">{error}</div>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <div className={styles.empty} role="status"><Loader2 size={24} className={styles.spin}/>신청과 예약을 불러오는 중…</div> : <>
      {tab === 'requests' && <><div className={styles.requestFilters}><label>처리 상태<select value={status} onChange={e => setStatus(e.target.value)}><option value="">전체 상태</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>신청 종류<select value={kind} onChange={e => setKind(e.target.value)}><option value="">전체 종류</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>{rows.length}건 · 접수 날짜 기준</p></div>{rows.length ? rows.map(row => <RequestCard key={`${row.id}:${row.version}`} row={row} onSaved={() => void load()}/>) : <div className={styles.empty}><Smartphone size={26}/><h2>아직 접수된 신청이 없습니다.</h2><p>게스트가 웹앱이나 연결된 패드에서 신청하면 이곳에 표시됩니다.</p></div>}</>}
      {tab === 'access' && <><section className={styles.info}><ShieldCheck size={20}/><div><h2>객실 고정 QR과 예약별 QR</h2><p>고정 QR은 예약자 이름과 이용 코드로 로그인합니다. 예약별 QR은 예약자 이름으로 확인하며 체크아웃 후 개인 서비스 접근이 종료됩니다. 이용 코드는 발급 직후만 표시됩니다.</p></div></section><div className={styles.properties}>{data.properties.filter(item => !propertyId || item.id === propertyId).map(item => <article key={item.id}><h3>{item.name}</h3><p>객실에 비치하는 고정 QR</p><button onClick={() => void qr(`${item.name} · 게스트 웹앱`, `/stay/${item.slug}`)}><QrCode size={16}/>고정 QR 보기</button><Link href={`/stay/${item.slug}`} target="_blank">게스트 화면<ArrowUpRight size={15}/></Link></article>)}</div><h2 className={styles.sectionTitle}>현재·예정 예약 <span>{upcomingStays.length}건</span></h2>{upcomingStays.length ? <div className={styles.stays}>{upcomingStays.map(stay => <article key={`${stay.kind}:${stay.id}`}><div><p className={styles.eyebrow}>{stay.propertyName}</p><h3>{stay.guestName}</h3><p>{stay.checkIn.slice(0, 10)} → {stay.checkOut.slice(0, 10)}{stay.guests == null ? '' : ` · ${stay.guests}명`}</p><small>{stay.access ? `이용 코드 발급됨 · ${dateTime(stay.access.expiresAt)}까지` : '이용 코드 미발급'}</small></div><div className={styles.actions}><button disabled={!!busy} onClick={() => void issue(stay)}><QrCode size={16}/>{busy === stay.id ? '발급 중…' : stay.access ? '코드 새로 발급' : 'QR·코드 발급'}</button>{stay.access && <button className={styles.danger} disabled={!!busy} onClick={() => void revoke('access', stay.access!.id)}>해제</button>}</div></article>)}</div> : <div className={styles.empty}>선택한 기간에 현재·예정 예약이 없습니다.</div>}</>}
      {tab === 'devices' && <><section className={styles.info}><Tablet size={20}/><div><h2>패드에서 예약별 QR을 안전하게 표시합니다.</h2><p>이곳에서 연결 코드를 발급한 뒤 해당 객실 패드의 관리자 화면에 입력하세요. 코드는 10분 동안 한 번만 사용할 수 있습니다. 연결되지 않은 패드는 고정 QR과 기존 신청 기능을 이용합니다.</p></div></section><form className={styles.pairForm} onSubmit={e => { e.preventDefault(); void pair(); }}><label>연결할 숙소<select required value={deviceProperty || propertyId} onChange={e => setDeviceProperty(e.target.value)}><option value="">숙소 선택</option>{data.properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>패드 이름<input required maxLength={80} value={deviceLabel} onChange={e => setDeviceLabel(e.target.value)}/></label><button disabled={!!busy} type="submit">{busy === 'pair' ? '발급 중…' : '패드 연결 코드 발급'}</button></form><div className={styles.stays}>{data.devices.filter(device => !propertyId || device.propertyId === propertyId).map(device => <article key={device.id}><div><p className={styles.eyebrow}>{data.properties.find(item => item.id === device.propertyId)?.name || '숙소'}</p><h3>{device.label}</h3><p>{device.revokedAt ? '연결 해제됨' : device.pairedAt ? `연결됨 · ${dateTime(device.pairedAt)}` : '패드에서 연결 코드 입력 대기'}</p>{!device.revokedAt && <small>{device.pairedAt ? `이 패드 연결은 ${dateTime(device.expiresAt)}까지` : `연결 코드: ${dateTime(device.pairingExpiresAt || device.expiresAt)}까지`}</small>}</div>{!device.revokedAt && <button disabled={!!busy} className={styles.danger} onClick={() => void revoke('devices', device.id)}>연결 해제</button>}</article>)}</div>{data.devices.length === 0 && <div className={styles.empty}>연결된 패드가 없습니다.</div>}</>}
      {(data.truncated || data.stays.length >= 100 || data.requests.length >= 100 || data.devices.length >= 100) && <p className={styles.limit}>최대 100건을 표시합니다. 숙소나 조회 기간을 좁혀 확인하세요.</p>}
    </>}
    {share && <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) setShare(null); }}><section ref={modal} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="guestShareTitle"><button className={styles.close} onClick={() => setShare(null)} aria-label="QR 닫기"><X size={22}/></button><p className={styles.eyebrow}>VOID ANCHAE · GUEST APP</p><h2 id="guestShareTitle">{share.title}</h2><Image src={share.image} alt={`${share.title} QR 코드`} width={240} height={240} unoptimized/>{share.code && <div className={styles.code}><small>예약자 이름과 함께 사용하는 이용 코드</small><strong>{share.code}</strong></div>}<p>{share.expiresAt ? `예약별 링크 · ${dateTime(share.expiresAt)}까지` : '객실 고정 QR · 예약자 이름과 이용 코드 필요'}</p><div className={styles.actions}><a href={share.image} download="void-anchae-guest-qr.png"><Download size={16}/>QR 저장</a><button onClick={async () => { try { await navigator.clipboard.writeText(share.code ? `게스트 웹앱: ${share.url}\n이용 코드: ${share.code}` : share.url); setCopied(true); } catch { setError('복사하지 못했습니다. 아래 주소를 직접 복사해 주세요.'); } }}><Copy size={16}/>{copied ? '복사됨' : '링크·코드 복사'}</button></div><a href={share.url} target="_blank" rel="noreferrer" className={styles.shareUrl}>게스트 화면 열기<ArrowUpRight size={14}/></a></section></div>}
    {pairing && <div className={styles.backdrop}><section ref={modal} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="guestPairTitle"><button className={styles.close} onClick={() => setPairing(null)} aria-label="연결 코드 닫기"><X size={22}/></button><Tablet size={30}/><h2 id="guestPairTitle">{pairing.propertyName} 패드 연결</h2><p>해당 패드의 관리자 화면 → 게스트 웹앱 연결에 입력하세요.</p><div className={styles.code}><strong>{pairing.code}</strong></div><p>{dateTime(pairing.expiresAt)}까지 · 한 번만 사용 가능</p><p className={styles.eyebrow}>게스트에게 전달하는 이용 코드와 다릅니다.</p></section></div>}
  </div>;
}
