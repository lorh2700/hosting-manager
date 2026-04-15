'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Package, Plus, Trash2, Send } from 'lucide-react';
import type { SupplyRequest, SupplyItem, IssueUrgency } from '@/lib/types';
import { SUPPLY_STATUS_CONFIG, URGENCY_LABELS } from '@/lib/constants';

const URGENCY: { value: IssueUrgency; label: string }[] = (
  Object.entries(URGENCY_LABELS) as [IssueUrgency, { label: string }][]
).map(([value, { label }]) => ({ value, label }));

export default function CleanerSuppliesPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<(SupplyRequest & { propertyName: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [urgency, setUrgency] = useState<IssueUrgency>('normal');
  const [items, setItems] = useState<SupplyItem[]>([{ name: '', quantity: 1 }]);

  useEffect(() => {
    if (!user || !profile) return;
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]);

  const loadData = async () => {
    if (!user || !profile) return;
    try {
      // Fetch properties
      const propsRes = await fetch('/api/properties');
      const propsData = await propsRes.json();
      const propNames: Record<string, string> = {};
      const propList: { id: string; name: string }[] = [];
      for (const p of propsData) {
        propNames[p.id] = p.name;
        propList.push({ id: p.id, name: p.name });
      }
      setProperties(propList);
      if (propList.length > 0 && !selectedProperty) setSelectedProperty(propList[0].id);

      // Fetch supply requests
      const propertyIds = propList.map(p => p.id);
      const reqRes = await fetch(`/api/supply-requests?propertyIds=${propertyIds.join(',')}`);
      const reqData = await reqRes.json();

      // Filter to only requests by current user
      const myRequests = reqData.filter((r: Record<string, unknown>) => r.requestedBy === user.id);

      const result = myRequests.map((r: Record<string, unknown>) => ({
        ...r,
        propertyName: propNames[r.propertyId as string] ?? '알 수 없는 숙소',
      })).sort((a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt));

      setRequests(result as (SupplyRequest & { propertyName: string })[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => setItems([...items, { name: '', quantity: 1 }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof SupplyItem, value: string | number) => {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  };

  const handleSubmit = async () => {
    if (!user || !profile || !selectedProperty) return;
    const validItems = items.filter(i => i.name.trim());
    if (validItems.length === 0) { alert('품목을 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/supply-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: selectedProperty,
          requestedBy: user.id,
          requestedByName: profile.displayName || user.email || 'unknown',
          items: validItems.map(i => ({ name: i.name.trim(), quantity: i.quantity, note: i.note || null })),
          urgency,
          status: 'pending',
        }),
      });
      if (!res.ok) throw new Error('Failed to create request');

      setItems([{ name: '', quantity: 1 }]);
      setUrgency('normal');
      setShowForm(false);
      await loadData();
    } catch (err) {
      console.error(err);
      alert('요청 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-white/10 pb-6 mt-4 flex items-end justify-between">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-white/50 mb-2">비품 관리</p>
          <h1 className="text-2xl font-light tracking-tight text-white">비품 요청</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="border border-white/20 text-white px-4 py-2.5 text-[10px] uppercase tracking-widest font-semibold hover:bg-white/5 transition-colors flex items-center gap-1.5"
        >
          <Plus size={14} /> 새 요청
        </button>
      </header>

      {/* New Request Form */}
      {showForm && (
        <div className="border border-white/10 bg-[#111] p-5 space-y-4">
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">비품 요청 등록</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">숙소</label>
              <select
                value={selectedProperty}
                onChange={e => setSelectedProperty(e.target.value)}
                className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">긴급도</label>
              <select
                value={urgency}
                onChange={e => setUrgency(e.target.value as IssueUrgency)}
                className="w-full bg-black/50 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {URGENCY.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest text-white/40">품목</label>
            {items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateItem(i, 'name', e.target.value)}
                  placeholder="품목명 (예: 수건)"
                  className="flex-1 bg-black/50 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                />
                <input
                  type="number"
                  value={item.quantity}
                  onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)}
                  min={1}
                  className="w-16 bg-black/50 border border-white/10 px-2 py-2 text-sm text-white text-center focus:outline-none focus:border-white/30"
                />
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} className="text-white/30 hover:text-red-400 p-2">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            <button onClick={addItem} className="text-white/30 hover:text-white text-[10px] uppercase tracking-widest mt-1">
              + 품목 추가
            </button>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-white text-black py-3 text-[11px] uppercase tracking-widest font-semibold hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <><Send size={14} /> 요청</>
            )}
          </button>
        </div>
      )}

      {/* Requests List */}
      <section className="space-y-3">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center text-white/40 py-12">
            <Package size={28} className="mb-3 opacity-50" />
            <p className="text-sm">비품 요청 내역이 없습니다.</p>
          </div>
        ) : (
          requests.map(req => {
            const st = SUPPLY_STATUS_CONFIG[req.status] ?? SUPPLY_STATUS_CONFIG.pending;
            return (
              <div key={req.id} className="border border-white/10 bg-[#111] p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-white font-medium text-sm">{req.propertyName}</p>
                    <p className="text-white/30 text-[10px] mt-0.5">
                      {format(parseISO(req.createdAt), 'M월 d일', { locale: ko })}
                    </p>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 tracking-wider ${st.bg} ${st.color}`}>{st.label}</span>
                </div>
                <div className="space-y-1">
                  {req.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-white/60">{item.name}</span>
                      <span className="text-white/30">{item.quantity}개</span>
                    </div>
                  ))}
                </div>
                {req.statusNote && (
                  <p className="text-white/40 text-xs mt-3 pt-3 border-t border-white/5">메모: {req.statusNote}</p>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
