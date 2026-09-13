'use client';

import { useAdminMode } from '@/lib/adminMode';
import TodayWorkspace from './_components/TodayWorkspace';
import dynamic from 'next/dynamic';
const TourDashboard = dynamic(() => import('./_components/TourDashboard'), { loading: () => <p role="status">투어 현황을 불러오는 중…</p> });

export default function Dashboard() {
  const { mode } = useAdminMode();
  return mode === 'tour' ? <TourDashboard /> : <TodayWorkspace />;
}
