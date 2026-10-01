export function inquiryReplyDestination(source?: string | null): string {
  const key = source?.trim().toLowerCase().replace(/[\s._-]/g, '');
  if (key === 'booking' || key === 'bookingcom') return 'Booking.com 예약 메시지';
  if (key === 'airbnb') return 'Airbnb 예약 메시지';
  if (key === 'agoda') return 'Agoda 예약 메시지';
  if (key === 'tripcom' || key === 'ctrip' || key === 'trip') return 'Trip.com 예약 메시지';
  if (key === 'direct' || key === 'manualreservation') return '직접 예약 · Beds24에서 연락 경로 확인';
  return '플랫폼 미확인 · Beds24에서 예약 채널 확인';
}
