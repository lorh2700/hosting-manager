import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPublicBookingProperty } from '@/lib/public-booking-property';
import { HttpError } from '@/lib/core/errors';
import BookingContent from './BookingContent';
import Loading from './loading';

export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = await getPublicBookingProperty(id).catch(error => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  return <Suspense fallback={<Loading />}><BookingContent key={property.id} property={property} /></Suspense>;
}
