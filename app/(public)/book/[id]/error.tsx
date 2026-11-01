'use client';

export default function BookingError({ reset }: { reset: () => void }) {
  return <main className="min-h-screen bg-stone-950 px-5 pb-20 pt-32 text-stone-100">
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-serif text-2xl">숙소 정보를 불러오지 못했습니다.</h1>
      <p className="text-stone-300">잠시 후 다시 시도해 주세요. / Please try again shortly.</p>
      <button onClick={reset} className="min-h-12 border border-stone-400 px-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">다시 불러오기 / Retry</button>
    </div>
  </main>;
}
