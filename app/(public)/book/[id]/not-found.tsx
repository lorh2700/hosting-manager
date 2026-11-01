import Link from 'next/link';

export default function BookingNotFound() {
  return <main className="min-h-screen bg-stone-950 px-5 pb-20 pt-32 text-stone-100">
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-serif text-2xl">숙소를 찾을 수 없습니다. / Stay not found.</h1>
      <Link href="/" className="inline-flex min-h-12 items-center underline underline-offset-4">숙소 목록으로 / View stays</Link>
    </div>
  </main>;
}
