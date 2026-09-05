'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, Save, Link as LinkIcon, CheckCircle2, XCircle, Copy, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { toast, confirmDialog } from '@/components/ui';

interface Property {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
}

interface ChannelConnection {
  id: string;       // doc ID = channel name
  importUrl: string;
  exportUrl: string;
  isActive: boolean;
  createdAt: string;
}

export default function ChannelsPage() {
  const { id } = useParams() as { id: string };
  const pathname = usePathname();
  const { user } = useAuth();
  const [property, setProperty] = useState<Property | null>(null);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelImportUrl, setNewChannelImportUrl] = useState('');

  const fetchChannels = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/properties/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const channelsMap: Record<string, object> = data?.channels ?? {};
      const channelsList = Object.entries(channelsMap).map(([name, ch]) => ({ id: name, ...(ch as object) })) as ChannelConnection[];
      setChannels(channelsList);
    } catch (error) {
      console.error('Failed to fetch channels', error);
    }
  }, [id, user]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/properties/${id}`);
        if (res.ok) {
          const data = await res.json();
          setProperty(data);
        }
        await fetchChannels();
      } catch (error) {
        console.error('Error fetching data', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, user, fetchChannels]);

  const handleAddChannel = async () => {
    if (!newChannelName.trim() || !newChannelImportUrl.trim()) {
      toast.info('채널 이름과 링크를 모두 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const token = crypto.randomUUID();
      const name = newChannelName.trim();
      await fetch(`/api/properties/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`channels.${name}`]: {
            importUrl: newChannelImportUrl,
            exportUrl: `/api/export/${token}.ics`,
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        }),
      });
      await fetchChannels();
      setNewChannelName('');
      setNewChannelImportUrl('');
      toast.success('채널이 추가되었습니다.');
    } catch (error) {
      console.error('Failed to add channel', error);
      toast.error('채널 추가에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, string | boolean> = {};
      for (const ch of channels) {
        updates[`channels.${ch.id}.importUrl`] = ch.importUrl;
        updates[`channels.${ch.id}.isActive`] = !!ch.importUrl.trim();
      }
      await fetch(`/api/properties/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await fetchChannels();
      toast.success('채널 설정이 저장되었습니다.');
    } catch (error) {
      console.error('Failed to save channels', error);
      toast.error('채널 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChannel = async (channelName: string) => {
    if (!(await confirmDialog(`"${channelName}" 채널을 삭제하시겠습니까?`))) return;
    try {
      await fetch(`/api/properties/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`channels.${channelName}`]: '__delete__',
        }),
      });
      setChannels((prev) => prev.filter(c => c.id !== channelName));
    } catch (error) {
      console.error('Failed to delete channel', error);
      toast.error('채널 삭제에 실패했습니다');
    }
  };

  const updateChannelUrl = (channelId: string, url: string) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, importUrl: url } : c))
    );
  };

  if (loading) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">불러오는 중...</div>;
  if (!property) return <div className="text-center py-24 text-stone-500 font-light tracking-widest text-[11px]">숙소를 찾을 수 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col gap-6 md:flex-row md:justify-between md:items-end border-b border-stone-200 pb-8">
        <div>
          <Link href="/admin/properties" className="text-stone-500 hover:text-stone-900 text-[10px] tracking-widest font-medium flex items-center gap-2 mb-6 transition-colors">
            <ArrowLeft size={14} /> 숙소 목록으로 돌아가기
          </Link>
          <h1 className="text-4xl font-light tracking-tight text-stone-900">{property.name}</h1>
          <p className="text-stone-500 mt-2 text-sm font-light tracking-wide">시간대: {property.timezone}</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white px-6 py-3 text-[11px] tracking-widest font-semibold uppercase flex items-center gap-3 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </header>

      {/* Sub-menu Tabs */}
      <div className="flex border-b border-stone-200 mb-8">
        <Link href={`/admin/properties/${id}`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          캘린더
        </Link>
        <Link href={`/admin/properties/${id}/channels`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/channels` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          채널 연결
        </Link>
        <Link href={`/admin/properties/${id}/settings`} className={`px-6 py-4 text-[11px] tracking-widest font-semibold border-b-2 transition-colors ${pathname === `/admin/properties/${id}/settings` ? 'border-[var(--brand)] text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-900 hover:border-stone-300'}`}>
          숙소 설정
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left Column: Add New Channel Form */}
        <div className="bg-white border border-stone-200 p-8 flex flex-col sticky top-6">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-4">새 캘린더 연결</h2>
          <p className="text-stone-500 text-sm mb-8 font-light leading-relaxed">
            iCal 링크를 사용하여 에어비앤비, 부킹닷컴 등 다른 플랫폼과 숙소를 연결하고 예약 가능 여부를 자동으로 동기화하세요.
          </p>

          {/* 1단계 */}
          <h3 className="text-[11px] tracking-widest font-medium text-stone-900 mb-2">1단계</h3>
          <p className="text-stone-500 text-sm font-light mb-8">채널을 추가하면 내보내기 URL이 자동으로 생성됩니다. 추가 후 우측 목록에서 복사하세요.</p>

          {/* 2단계 */}
          <h3 className="text-[11px] tracking-widest font-medium text-stone-900 mb-2">2단계</h3>
          <p className="text-stone-500 text-sm font-light mb-4">다른 플랫폼의 가져오기 링크를 여기에 붙여넣으세요.</p>

          <div className="border border-stone-300 bg-white overflow-hidden mb-8 flex flex-col focus-within:border-[var(--brand)] transition-colors">
            <div className="relative border-b border-stone-200">
              <input
                type="url"
                value={newChannelImportUrl}
                onChange={(e) => setNewChannelImportUrl(e.target.value)}
                placeholder="가져오기 URL (예: https://...ics)"
                className="w-full px-4 py-4 outline-none text-stone-900 text-sm bg-transparent placeholder:text-stone-400 font-light"
              />
            </div>
            <div className="relative">
              <input
                type="text"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="채널 이름 (예: 에어비앤비)"
                className="w-full px-4 py-4 outline-none text-stone-900 text-sm bg-transparent placeholder:text-stone-400 font-light"
              />
            </div>
          </div>

          <div className="mt-auto">
            <button
              onClick={handleAddChannel}
              disabled={saving || !newChannelImportUrl.trim() || !newChannelName.trim()}
              className={`w-full py-4 text-[11px] tracking-widest font-semibold uppercase transition-colors ${
                newChannelImportUrl.trim() && newChannelName.trim()
                  ? 'bg-[var(--brand)] hover:bg-[var(--brand-dark)] text-white'
                  : 'bg-stone-100 text-stone-400 cursor-not-allowed'
              }`}
            >
              {saving ? '추가 중...' : '캘린더 추가'}
            </button>
          </div>
        </div>

        {/* Right Column: Connected Channels List */}
        <div className="space-y-6">
          <h2 className="text-sm tracking-widest font-medium text-stone-900 mb-6 px-2">연결된 채널</h2>
          {channels.length === 0 ? (
            <div className="bg-white border border-stone-200 p-8 text-center text-stone-500 font-light text-sm">
              아직 연결된 채널이 없습니다. 양식을 사용하여 추가하세요.
            </div>
          ) : (
            channels.map((channel) => (
              <div key={channel.id} className="bg-white border border-stone-200 p-8 flex flex-col gap-6 relative group hover:border-stone-300 transition-colors">
                <button
                  onClick={() => handleDeleteChannel(channel.id)}
                  className="absolute top-6 right-6 p-2 text-stone-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  title="채널 삭제"
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>

                <div className="flex items-center gap-4 pr-12">
                  <div className={`p-2 ${channel.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>
                    {channel.isActive ? <CheckCircle2 size={20} strokeWidth={1.5} /> : <XCircle size={20} strokeWidth={1.5} />}
                  </div>
                  <span className="font-light text-stone-900 text-xl px-1">{channel.id}</span>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-[10px] tracking-widest font-medium text-stone-500 mb-2">가져오기 URL</label>
                    <input
                      type="url"
                      value={channel.importUrl || ''}
                      onChange={(e) => updateChannelUrl(channel.id, e.target.value)}
                      placeholder="https://..."
                      className="w-full px-4 py-3 border border-stone-200 bg-stone-50 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 outline-none transition-colors font-mono text-xs text-stone-700 font-light"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] tracking-widest font-medium text-stone-500 mb-2">내보내기 URL</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        readOnly
                        value={typeof window !== 'undefined' ? `${window.location.origin}${channel.exportUrl}` : ''}
                        className="w-full px-4 py-3 border border-stone-200 bg-transparent outline-none font-mono text-xs text-stone-500 font-light"
                      />
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}${channel.exportUrl}`;
                          navigator.clipboard.writeText(url);
                          toast.success('클립보드에 복사되었습니다!');
                        }}
                        className="p-3 text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors shrink-0 border border-stone-200"
                        title="URL 복사"
                      >
                        <Copy size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
