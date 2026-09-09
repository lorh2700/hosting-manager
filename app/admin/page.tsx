'use client';

import { useAdminMode } from '@/lib/adminMode';
import TodayWorkspace from './_components/TodayWorkspace';
import TourDashboard from './_components/TourDashboard';

export default function Dashboard() {
  const { mode } = useAdminMode();
  return mode === 'tour' ? <TourDashboard /> : <TodayWorkspace />;
}
