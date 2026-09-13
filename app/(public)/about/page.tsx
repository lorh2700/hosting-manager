'use client';

import { useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarDays, CreditCard, MessageCircle, Tablet, Brush, ChartNoAxesCombined, ShieldCheck, Package, Workflow } from 'lucide-react';
import { usePublicLanguage } from '@/components/PublicLanguage';
import { Logo } from '@/components/Logo';

const services = [
  { icon: CalendarDays, ko: '예약 관리', en: 'Reservations', desc: '여러 예약 채널의 일정과 숙소별 예약 현황을 한곳에서 확인합니다.', english: 'View booking schedules and reservations across your connected channels.' },
  { icon: ShieldCheck, ko: '더블부킹 방지', en: 'Double-booking prevention', desc: '연결된 채널의 예약과 잔여 객실 정보를 동기화해 중복 예약 위험을 줄입니다.', english: 'Sync reservations and availability across connected channels to reduce the risk of double bookings.' },
  { icon: CreditCard, ko: '직접 예약과 결제', en: 'Direct bookings & payments', desc: '숙소 소개부터 날짜 선택, 온라인 결제까지 하나의 예약 흐름으로 연결합니다.', english: 'Connect your stay listing, date selection and online payment in one booking flow.' },
  { icon: MessageCircle, ko: '게스트 안내', en: 'Guest communication', desc: '체크인과 체크아웃에 필요한 정보를 전달하고 게스트 문의를 관리합니다.', english: 'Share arrival and departure information and manage guest enquiries.' },
  { icon: Tablet, ko: '객실 웰컴패드', en: 'In-room welcome pad', desc: '숙소 이용법과 주변 정보를 객실 안에서 편하게 확인할 수 있도록 안내합니다.', english: 'Help guests find house instructions and local information from their room.' },
  { icon: Brush, ko: '청소와 현장 관리', en: 'Housekeeping', desc: '퇴실 확인, 청소 일정과 현장 상태를 함께 살펴봅니다.', english: 'Keep track of departures, cleaning schedules and property condition.' },
  { icon: Package, ko: '비품 관리', en: 'Supplies management', desc: '숙소별 비품 현황과 보충 요청을 확인해 필요한 물품을 제때 준비합니다.', english: 'Track property supplies and replenishment requests to keep essentials ready for each stay.' },
  { icon: Workflow, ko: '운영 자동화', en: 'Operational automation', desc: '예약 일정에 맞춘 안내 메시지와 반복 업무를 자동화해 매일의 운영 부담을 덜어줍니다.', english: 'Automate scheduled guest messages and recurring tasks to simplify daily operations.' },
  { icon: ChartNoAxesCombined, ko: '운영 현황', en: 'Operations overview', desc: '예약과 매출 현황을 확인하며 숙소 운영을 점검합니다.', english: 'Review reservations and revenue to stay informed about your operation.' },
];
const steps = [
  ['상담 신청', '숙소와 운영 계획을 알려주세요.', 'Get in touch', 'Tell us about your property and plans.'],
  ['공간 검토', '공간의 특성과 현재 운영 상황을 함께 살펴봅니다.', 'Property review', 'We review the character of your space and its current operation.'],
  ['운영 협의', '필요한 지원 범위와 입점 조건을 협의합니다.', 'Agree on support', 'We discuss the services you need and partnership terms.'],
  ['입점 준비', '숙소 정보와 예약 환경을 정리하고 운영을 시작합니다.', 'Prepare to launch', 'We prepare your listing and booking setup for launch.'],
];

export default function AboutPage() {
  const { language } = usePublicLanguage();
  const en = language === 'en';
  const [draftOpened, setDraftOpened] = useState(false);
  function prepareEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = [
      `${en ? 'Property' : '숙소명'}: ${data.get('property')}`,
      `${en ? 'Location' : '위치'}: ${data.get('location')}`,
      `${en ? 'Contact person' : '담당자'}: ${data.get('name')}`,
      `${en ? 'Contact details' : '연락처'}: ${data.get('contact')}`,
      '', String(data.get('message') || ''),
    ].join('\n');
    window.location.href = `mailto:unwadang@gmail.com?subject=${encodeURIComponent(en ? 'VOID ANCHAE partnership enquiry' : 'VOID ANCHAE 입점 상담 문의')}&body=${encodeURIComponent(body)}`;
    setDraftOpened(true);
  }
  const fieldClass = 'w-full min-h-12 border-b border-stone-400 bg-transparent py-3 text-stone-900 outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900 rounded-none';
  return <div className="min-h-screen bg-[#171b18] text-stone-50">
    <main>
      <section className="max-w-[1200px] mx-auto px-6 md:px-12 pt-24 md:pt-36 pb-20 md:pb-28">
        <p className="text-xs uppercase tracking-[0.25em] text-[#d8c3a4] mb-8">Partner with us</p>
        <h1 className="brand-serif text-4xl md:text-6xl leading-tight max-w-4xl">{en ? <>Your space,<br />with VOID ANCHAE.</> : <>당신의 공간을<br />VOID ANCHAE와 함께.</>}</h1>
        <p className="mt-8 max-w-xl text-stone-300 leading-8">{en ? 'A good stay takes thoughtful care. Let’s find the right support for your property, from reservations to the guest experience.' : '좋은 공간이 오래 사랑받을 수 있도록. 예약을 받는 일부터 게스트를 맞이하는 일까지, 숙소에 맞는 운영 방식을 함께 찾습니다.'}</p>
        <a href="#contact" className="inline-flex items-center gap-8 bg-[#eee8dc] text-stone-900 px-6 py-4 mt-10 min-h-12">{en ? 'Discuss your property' : '입점 상담 신청'}<ArrowUpRight size={18} aria-hidden="true" /></a>
      </section>

      <section aria-labelledby="services-title" className="border-t border-white/15 px-6 md:px-12 py-20 max-w-[1200px] mx-auto">
        <p className="text-xs tracking-[0.2em] uppercase text-[#d8c3a4] mb-5">Our support</p>
        <h2 id="services-title" className="brand-serif text-3xl md:text-4xl">{en ? 'Support for the everyday.' : '매일의 운영을 돕는 일.'}</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12 mt-12">
          {services.map(({ icon: Icon, ko, en: title, desc, english }) => <article key={ko} className="stay-reveal border-t border-white/15 pt-6">
            <Icon size={24} strokeWidth={1.3} className="text-[#d8c3a4] mb-6" aria-hidden="true" />
            <h3 className="text-lg mb-3">{en ? title : ko}</h3><p className="text-sm leading-7 text-stone-400">{en ? english : desc}</p>
          </article>)}
        </div>
        <p className="text-xs text-stone-400 mt-10">{en ? 'Services and operating arrangements are agreed during consultation.' : '지원 서비스와 운영 범위는 상담을 통해 숙소별로 협의합니다.'}</p>
      </section>

      <section aria-labelledby="process-title" className="bg-[#eee8dc] text-stone-900 px-6 md:px-12 py-20">
        <div className="max-w-[1104px] mx-auto">
          <h2 id="process-title" className="brand-serif text-3xl md:text-4xl">{en ? 'How we begin.' : '함께 시작하는 과정.'}</h2>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mt-12">
            {steps.map(([title, desc, english, detail], i) => <li key={title} className="border-t border-stone-400 pt-5"><span className="text-xs text-stone-500">0{i + 1}</span><h3 className="text-lg mt-5 mb-3">{en ? english : title}</h3><p className="text-sm leading-7 text-stone-600">{en ? detail : desc}</p></li>)}
          </ol>
        </div>
      </section>

      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-24 px-6 md:px-12 py-20 md:py-28 max-w-[1200px] mx-auto grid lg:grid-cols-2 gap-12 lg:gap-20">
        <div>
          <h2 id="contact-title" className="brand-serif text-3xl md:text-4xl">{en ? 'Tell us about your space.' : '어떤 공간인지 들려주세요.'}</h2>
          <p className="text-stone-300 leading-8 mt-6">{en ? 'Share your property details and the support you’re looking for. We’ll discuss the next steps together.' : '숙소의 위치와 현재 운영 상황, 필요한 도움을 알려주세요. 함께할 수 있는 방법을 이야기하겠습니다.'}</p>
          <a href="mailto:unwadang@gmail.com" className="inline-block underline underline-offset-4 text-stone-300 py-3 mt-5">unwadang@gmail.com</a>
          <p className="text-sm text-stone-400 leading-7 mt-4">{en ? 'This form prepares a draft in your email app. Review and send it there to submit your enquiry.' : '아래 내용을 작성하면 이메일 앱에 문의 초안이 열립니다. 내용을 확인하고 이메일을 보내주시면 상담을 접수합니다.'}</p>
        </div>
        <form onSubmit={prepareEmail} className="bg-[#f4f0e8] text-stone-800 p-6 md:p-8 space-y-5">
          {[
            ['property', en ? 'Property name' : '숙소명', 'organization'],
            ['location', en ? 'Property location' : '숙소 위치', 'off'],
            ['name', en ? 'Contact person' : '담당자', 'name'],
            ['contact', en ? 'Email or phone number' : '연락처 (이메일 또는 전화번호)', 'off'],
          ].map(([name, label, autoComplete]) => <div key={name}><label htmlFor={`partner-${name}`} className="text-sm">{label}</label><input id={`partner-${name}`} name={name} required maxLength={200} autoComplete={autoComplete} className={fieldClass} /></div>)}
          <div><label htmlFor="partner-message" className="text-sm">{en ? 'Your enquiry' : '문의 내용'}</label><textarea id="partner-message" name="message" required maxLength={2000} rows={4} className={fieldClass} /></div>
          <button type="submit" className="w-full min-h-12 bg-[#354b3b] text-white px-5 py-4 flex items-center justify-between hover:bg-[#253b2b] focus-visible:outline-2 focus-visible:outline-offset-4">{en ? 'Prepare enquiry email' : '상담 이메일 작성'}<ArrowUpRight size={18} aria-hidden="true" /></button>
          {draftOpened && <p role="status" className="text-sm leading-6">{en ? 'Please send the draft in your email app. If it did not open, email us at unwadang@gmail.com. Your enquiry has not been sent from this page.' : '이메일 앱에서 초안을 확인하고 전송해주세요. 앱이 열리지 않으면 unwadang@gmail.com으로 문의해주세요. 이 페이지에서 자동 전송되지는 않습니다.'}</p>}
        </form>
      </section>
    </main>
    <footer className="border-t border-white/15 px-6 md:px-12 py-10"><div className="max-w-[1104px] mx-auto flex flex-col sm:flex-row justify-between gap-6"><Logo width={120} /><p className="text-xs text-stone-400">© {new Date().getFullYear()} VOID ANCHAE. All rights reserved.</p></div></footer>
  </div>;
}
