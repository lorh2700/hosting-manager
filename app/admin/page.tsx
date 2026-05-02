'use client';

import { useAdminMode } from '@/lib/adminMode';
import HostDashboard from './_components/HostDashboard';
import TourDashboard from './_components/TourDashboard';

export default function Dashboard() {
  const { mode } = useAdminMode();
  return mode === 'tour' ? <TourDashboard /> : <HostDashboard />;
}
