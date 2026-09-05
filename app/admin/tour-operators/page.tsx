'use client';

import { useState, useEffect } from 'react';
import { Briefcase, Plus, Trash2, Save, Phone, Mail, MessageCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toast, confirmDialog } from '@/components/ui';

interface TourOperator {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  email: string | null;
  notifyChannel: string;
  publicToken: string | null;
  notes: string | null;
  tourCount: number;
}

const NOTIFY_OPTIONS = [
  { value: 'kakao', label: '카카오 알림톡' },
  { value: 'email', label: '이메일' },
  { value: 'both', label: '둘 다' },
  { value: 'none', label: '미발송' },
];

export default function TourOperatorsPage() {
  const { user } = useAuth();
  const [operators, setOperators] = useState<TourOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const fetchOperators = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/tour-operators');
      if (!res.ok) throw new Error('Failed to fetch operators');
      setOperators(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOperators();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    try {
      const res = await fetch('/api/tour-operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          contactPhone: newPhone.trim() || null,
          email: newEmail.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setNewName(''); setNewPhone(''); setNewEmail('');
      await fetchOperators();
    } catch (err) {
      console.error(err);
      toast.error('업체 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (op: TourOperator) => {
    setSaving(op.id);
    try {
      const res = await fetch('/api/tour-operators', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: op.id,
          name: op.name,
          contactName: op.contactName,
          contactPhone: op.contactPhone,
          email: op.email,
          notifyChannel: op.notifyChannel,
          notes: op.notes,
        }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch (err) {
      console.error(err);
      toast.error('수정에 실패했습니다.');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog('이 업체를 삭제하시겠습니까? 연결된 투어 상품은 운영업체 미지정 상태가 됩니다.'))) return;
    try {
      const res = await fetch(`/api/tour-operators?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setOperators(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error(err);
      toast.error('삭제에 실패했습니다.');
    }
  };

  const updateLocal = <K extends keyof TourOperator>(id: string, field: K, value: TourOperator[K]) => {
    setOperators(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-[var(--brand)] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
      <header className="border-b border-stone-200 pb-6 sm:pb-7">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] mb-2 font-medium">투어 호스팅</p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">투어 운영업체</h1>
        <p className="text-stone-500 mt-2 text-sm">
          예약이 들어왔을 때 알림을 보낼 운영업체를 등록합니다.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* 새 업체 추가 */}
        <div className="bg-white border border-stone-200 p-5 sm:p-8 lg:sticky lg:top-6">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-6">새 업체 추가</h2>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">업체명 *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="예) 북촌 한복여행사"
                className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">담당자 연락처</label>
              <input
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">이메일</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="contact@operator.com"
                className="w-full bg-white border border-stone-200 px-4 py-3 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className={`w-full py-4 text-[11px] tracking-widest font-semibold uppercase flex items-center justify-center gap-2 transition-colors ${
              newName.trim() ? 'bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]' : 'bg-stone-100 text-stone-400 cursor-not-allowed'
            }`}
          >
            <Plus size={14} />
            {adding ? '추가 중...' : '업체 추가'}
          </button>
        </div>

        {/* 업체 목록 */}
        <div className="space-y-4">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-4">
            등록된 업체
            <span className="ml-3 text-stone-400 font-light">{operators.length}곳</span>
          </h2>

          {operators.length === 0 ? (
            <div className="bg-white border border-stone-200 p-12 text-center flex flex-col items-center text-stone-400">
              <Briefcase size={32} className="mb-4 opacity-50" />
              <p className="text-sm">등록된 업체가 없습니다.</p>
              <p className="text-xs mt-2 text-stone-400">왼쪽 양식으로 업체를 추가하세요.</p>
            </div>
          ) : (
            operators.map(op => (
              <div key={op.id} className="bg-white border border-stone-200 p-5 sm:p-6 group hover:border-stone-300 transition-colors">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">업체명</label>
                    <input
                      type="text"
                      value={op.name}
                      onChange={e => updateLocal(op.id, 'name', e.target.value)}
                      className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">담당자명</label>
                      <input
                        type="text"
                        value={op.contactName ?? ''}
                        onChange={e => updateLocal(op.id, 'contactName', e.target.value || null)}
                        className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2 flex items-center gap-1.5">
                        <Phone size={11} /> 연락처
                      </label>
                      <input
                        type="tel"
                        value={op.contactPhone ?? ''}
                        onChange={e => updateLocal(op.id, 'contactPhone', e.target.value || null)}
                        className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2 flex items-center gap-1.5">
                      <Mail size={11} /> 이메일
                    </label>
                    <input
                      type="email"
                      value={op.email ?? ''}
                      onChange={e => updateLocal(op.id, 'email', e.target.value || null)}
                      className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2 flex items-center gap-1.5">
                      <MessageCircle size={11} /> 알림 수단
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {NOTIFY_OPTIONS.map(o => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => updateLocal(op.id, 'notifyChannel', o.value)}
                          className={`text-xs px-3 py-1.5 border tracking-wide transition-colors ${
                            op.notifyChannel === o.value
                              ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                              : 'bg-transparent text-stone-700 border-stone-300 hover:border-stone-400'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-stone-500 mb-2">메모</label>
                    <textarea
                      value={op.notes ?? ''}
                      onChange={e => updateLocal(op.id, 'notes', e.target.value || null)}
                      rows={2}
                      className="w-full bg-white border border-stone-200 px-4 py-2.5 text-sm text-stone-900 focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 transition-colors resize-none"
                    />
                  </div>

                  <p className="text-[10px] text-stone-400 tracking-wide">
                    연결된 투어 {op.tourCount}건
                  </p>
                </div>

                <div className="flex justify-end gap-3 mt-5">
                  <button
                    onClick={() => handleDelete(op.id)}
                    className="p-2 text-stone-400 hover:text-red-600 transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={16} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleUpdate(op)}
                    disabled={saving === op.id}
                    className="flex items-center gap-2 bg-stone-100 hover:bg-[var(--brand)] hover:text-white text-stone-900 px-4 py-2 text-[10px] tracking-widest font-semibold uppercase transition-colors disabled:opacity-50"
                  >
                    <Save size={13} />
                    {saving === op.id ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
