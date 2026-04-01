'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Save, Phone } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

interface Cleaner {
  id: string;
  name: string;
  phone: string;
  ownerId: string;
}

export default function CleanersPage() {
  const { user } = useAuth();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchCleaners = async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'cleaners'), where('ownerId', '==', user.uid));
      const snapshot = await getDocs(q);
      setCleaners(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Cleaner)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCleaners();
  }, [user]);

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    try {
      await addDoc(collection(db, 'cleaners'), {
        name: newName.trim(),
        phone: newPhone.trim(),
        ownerId: user.uid,
        createdAt: new Date().toISOString(),
      });
      setNewName('');
      setNewPhone('');
      await fetchCleaners();
    } catch (err) {
      console.error(err);
      alert('담당자 추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (cleaner: Cleaner) => {
    setSaving(cleaner.id);
    try {
      await updateDoc(doc(db, 'cleaners', cleaner.id), {
        name: cleaner.name,
        phone: cleaner.phone,
      });
    } catch (err) {
      console.error(err);
      alert('수정에 실패했습니다.');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (cleanerId: string) => {
    if (!confirm('이 담당자를 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'cleaners', cleanerId));
      setCleaners(prev => prev.filter(c => c.id !== cleanerId));
    } catch (err) {
      console.error(err);
      alert('삭제에 실패했습니다.');
    }
  };

  const updateLocal = (id: string, field: keyof Cleaner, value: string) => {
    setCleaners(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <header className="border-b border-white/10 pb-8">
        <p className="text-[10px] tracking-[0.3em] text-white/50 mb-4">설정</p>
        <h1 className="text-3xl md:text-4xl font-light tracking-tight text-white">청소 담당자 관리</h1>
        <p className="text-white/50 mt-4 text-sm font-light tracking-wide">
          청소 담당자를 등록하고 청소 일정에 배정하세요.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* 새 담당자 추가 폼 */}
        <div className="bg-[#111] border border-white/10 p-8 lg:sticky lg:top-6">
          <h2 className="text-sm tracking-widest font-medium text-white mb-6">새 담당자 추가</h2>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이름 *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="담당자 이름"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">연락처</label>
              <input
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="010-0000-0000"
                className="w-full bg-black/50 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className={`w-full py-4 text-[11px] tracking-widest font-semibold flex items-center justify-center gap-2 transition-colors ${
              newName.trim() ? 'bg-white text-black hover:bg-white/90' : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
          >
            <Plus size={14} />
            {adding ? '추가 중...' : '담당자 추가'}
          </button>
        </div>

        {/* 담당자 목록 */}
        <div className="space-y-4">
          <h2 className="text-sm tracking-widest font-medium text-white mb-4">
            등록된 담당자
            <span className="ml-3 text-white/30 font-light">{cleaners.length}명</span>
          </h2>

          {cleaners.length === 0 ? (
            <div className="bg-[#111] border border-white/10 p-12 text-center flex flex-col items-center text-white/40">
              <Users size={32} className="mb-4 opacity-50" />
              <p className="text-sm">등록된 담당자가 없습니다.</p>
              <p className="text-xs mt-2 text-white/30">왼쪽 양식으로 담당자를 추가하세요.</p>
            </div>
          ) : (
            cleaners.map(cleaner => (
              <div key={cleaner.id} className="bg-[#111] border border-white/10 p-6 group hover:border-white/30 transition-colors">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">이름</label>
                    <input
                      type="text"
                      value={cleaner.name}
                      onChange={e => updateLocal(cleaner.id, 'name', e.target.value)}
                      className="w-full bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">연락처</label>
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-white/30 shrink-0" />
                      <input
                        type="tel"
                        value={cleaner.phone}
                        onChange={e => updateLocal(cleaner.id, 'phone', e.target.value)}
                        placeholder="연락처 없음"
                        className="flex-1 bg-black/50 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-5">
                  <button
                    onClick={() => handleDelete(cleaner.id)}
                    className="p-2 text-white/30 hover:text-red-400 transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={16} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleUpdate(cleaner)}
                    disabled={saving === cleaner.id}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white hover:text-black text-white px-4 py-2 text-[10px] tracking-widest font-semibold transition-colors disabled:opacity-50"
                  >
                    <Save size={13} />
                    {saving === cleaner.id ? '저장 중...' : '저장'}
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
