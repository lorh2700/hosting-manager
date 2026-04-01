'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/FirebaseProvider';

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
  description?: string;
  basePrice?: number;
  maxGuests?: number;
  beds24PropId?: string;
}

export default function PropertySettingsPage() {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [description, setDescription] = useState('');
  const [basePrice, setBasePrice] = useState<number | ''>('');
  const [maxGuests, setMaxGuests] = useState<number | ''>('');
  const [beds24PropId, setBeds24PropId] = useState('');

  useEffect(() => {
    if (!user) return;

    const fetchProperty = async () => {
      try {
        const propDoc = await getDoc(doc(db, 'properties', id));
        if (propDoc.exists()) {
          const data = propDoc.data() as Property;
          setProperty({ ...data, id: propDoc.id });
          setName(data.name || '');
          setTimezone(data.timezone || 'Asia/Seoul');
          setDescription(data.description || '');
          setBasePrice(data.basePrice || '');
          setMaxGuests(data.maxGuests || '');
          setBeds24PropId(data.beds24PropId || '');
        }
      } catch (error) {
        console.error('Error fetching property', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProperty();
  }, [id, user]);

  const handleSave = async () => {
    if (!user || !property) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'properties', id), {
        name,
        timezone,
        description,
        basePrice: basePrice === '' ? null : Number(basePrice),
        maxGuests: maxGuests === '' ? null : Number(maxGuests),
        beds24PropId: beds24PropId.trim() || null,
        updatedAt: new Date().toISOString()
      });
      alert('숙소 설정이 저장되었습니다.');
    } catch (error) {
      console.error('Error saving property', error);
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!user || !property) return;
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    try {
      // Delete channels
      const channelSnap = await getDocs(query(collection(db, 'channels'), where('propertyId', '==', id)));
      await Promise.all(channelSnap.docs.map(d => deleteDoc(d.ref)));

      // Delete events
      const eventSnap = await getDocs(query(collection(db, 'events'), where('propertyId', '==', id)));
      await Promise.all(eventSnap.docs.map(d => deleteDoc(d.ref)));

      // Delete property
      await deleteDoc(doc(db, 'properties', id));
      router.push('/admin/properties');
    } catch (error) {
      console.error('Error deleting property', error);
      alert('삭제에 실패했습니다.');
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  if (loading) return <div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">불러오는 중...</div>;
  if (!property) return <div className="text-center py-24 text-white/50 font-light tracking-widest text-[11px]">숙소를 찾을 수 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-6 md:flex-row md:justify-between md:items-end border-b border-white/10 pb-8">
        <div>
          <Link href="/admin/properties" className="text-white/40 hover:text-white text-[10px] tracking-widest font-medium flex items-center gap-2 mb-6 transition-colors">
            <ArrowLeft size={14} /> 숙소 목록으로 돌아가기
          </Link>
          <h1 className="text-4xl font-light tracking-tight text-white">{property.name}</h1>
          <p className="text-white/50 mt-2 text-sm font-light tracking-wide">숙소의 기본 정보를 관리하세요.</p>
        </div>
        <div className="flex gap-4">
          <Link
            href={`/book/${id}`}
            target="_blank"
            className="bg-transparent border border-white/20 text-white px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-2 hover:bg-white/5 transition-colors"
          >
            예약 페이지 보기
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-white text-black px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-3 hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </header>

      {/* Sub-menu Tabs */}
      <div className="flex border-b border-white/10 mb-8">
        <Link href={`/admin/properties/${id}`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}` ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white hover:border-white/30'}`}>
          캘린더
        </Link>
        <Link href={`/admin/properties/${id}/channels`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/channels` ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white hover:border-white/30'}`}>
          채널 연결
        </Link>
        <Link href={`/admin/properties/${id}/settings`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/settings` ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white hover:border-white/30'}`}>
          숙소 설정
        </Link>
      </div>

      <div className="bg-[#111] border border-white/10 p-8 max-w-3xl">
        <h2 className="text-lg font-light tracking-wide text-white mb-8">기본 정보</h2>
        
        <div className="space-y-6">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">숙소 이름</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">시간대 (Timezone)</label>
            <select 
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
            >
              <option value="Asia/Seoul">Asia/Seoul (한국 표준시)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (일본 표준시)</option>
              <option value="America/New_York">America/New_York (동부 표준시)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (태평양 표준시)</option>
              <option value="Europe/London">Europe/London (그리니치 표준시)</option>
              <option value="Europe/Paris">Europe/Paris (중앙유럽 표준시)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">숙소 설명</label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="게스트에게 보여질 숙소에 대한 설명을 입력하세요."
              className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">Beds24 Property ID</label>
            <input
              type="text"
              value={beds24PropId}
              onChange={(e) => setBeds24PropId(e.target.value)}
              placeholder="예: 12345 (Beds24 숙소 ID)"
              className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors font-mono"
            />
            <p className="text-[11px] text-white/30 mt-2">Beds24 → Properties → 숙소 선택 → Property ID에서 확인</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">기본 1박 요금 (₩)</label>
              <input 
                type="number" 
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 150000"
                className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-2">최대 수용 인원 (명)</label>
              <input 
                type="number" 
                value={maxGuests}
                onChange={(e) => setMaxGuests(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 4"
                className="w-full bg-black/50 border border-white/10 rounded-none px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-red-950/20 border border-red-900/30 p-8 max-w-3xl mt-12">
        <h2 className="text-lg font-light tracking-wide text-red-400 mb-2">위험 구역</h2>
        <p className="text-xs text-red-400/60 mb-6">숙소를 삭제하면 연동된 모든 채널과 예약 정보가 함께 삭제되며 복구할 수 없습니다.</p>
        {deleteConfirm ? (
          <div className="flex items-center gap-4">
            <span className="text-xs text-red-400">정말 삭제하시겠습니까? 채널, 이벤트 포함 모두 삭제됩니다.</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-900 border border-red-700 text-red-200 px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-3 hover:bg-red-800 transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? '삭제 중...' : '확인 — 영구 삭제'}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="text-white/40 hover:text-white text-[11px] tracking-widest transition-colors"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={handleDelete}
            className="bg-transparent border border-red-900/50 text-red-400 px-6 py-3 text-[11px] tracking-widest font-semibold flex items-center gap-3 hover:bg-red-900/30 transition-colors"
          >
            <Trash2 size={16} />
            이 숙소 영구 삭제하기
          </button>
        )}
      </div>
    </div>
  );
}
