'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, ArrowRight } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isBefore, startOfToday, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { doc, getDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getPropertyImage } from '@/lib/propertyImages';
import type { PropertyData } from '@/lib/types';

export default function BookPage() {
  const { id } = useParams() as { id: string };
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(startOfToday());
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);

  const [guests, setGuests] = useState(2);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const fetchPropertyAndBookings = async () => {
      try {
        const docRef = doc(db, 'properties', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const propertyData = docSnap.data();

          // Fetch bookings for this property
          const q = query(collection(db, 'bookings'), where('propertyId', '==', id), where('status', '==', 'confirmed'));
          const bookingSnaps = await getDocs(q);

          const bookedDates = bookingSnaps.docs.map(b => ({
            start: b.data().checkIn,
            end: b.data().checkOut,
            type: 'booking'
          }));

          setProperty({
            id: docSnap.id,
            name: propertyData.name,
            timezone: propertyData.timezone,
            permit: propertyData.permit ?? null,
            ownerId: propertyData.ownerId ?? '',
            bookedDates
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPropertyAndBookings();
  }, [id]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const isDateBooked = (date: Date) => {
    if (!property) return false;
    return property.bookedDates.some(b => {
      const start = parseISO(b.start);
      const end = parseISO(b.end);
      return date >= start && date < end; // end is checkout day, so it's available for checkin
    });
  };

  const handleDateClick = (date: Date) => {
    if (isBefore(date, startOfToday()) || isDateBooked(date)) return;

    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(date);
      setCheckOut(null);
    } else if (checkIn && !checkOut) {
      if (isBefore(date, checkIn)) {
        setCheckIn(date);
      } else {
        // Check if there are booked dates between checkIn and selected date
        const interval = eachDayOfInterval({ start: checkIn, end: date });
        const hasBooked = interval.some(d => isDateBooked(d) && !isSameDay(d, date));

        if (hasBooked) {
          setCheckIn(date);
        } else {
          setCheckOut(date);
        }
      }
    }
  };

  const isDateSelected = (date: Date) => {
    if (checkIn && isSameDay(date, checkIn)) return true;
    if (checkOut && isSameDay(date, checkOut)) return true;
    if (checkIn && checkOut && date > checkIn && date < checkOut) return true;
    return false;
  };

  const isDateInRange = (date: Date) => {
    if (checkIn && checkOut && date > checkIn && date < checkOut) return true;
    return false;
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkIn || !checkOut || !name || !email) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'bookings'), {
        propertyId: id,
        checkIn: format(checkIn, 'yyyy-MM-dd'),
        checkOut: format(checkOut, 'yyyy-MM-dd'),
        guests,
        name,
        email,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      });
      setIsSuccess(true);
    } catch (error) {
      console.error(error);
      alert('예약에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 border-t-2 border-white rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white font-serif text-2xl">
        숙소를 찾을 수 없습니다.
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] text-white p-8">
        <h1 className="font-serif text-5xl md:text-7xl font-light mb-6 tracking-tight">예약 확인</h1>
        <p className="text-white/60 text-lg mb-12 font-light tracking-wide">예약이 성공적으로 완료되었습니다. 이메일을 확인해주세요.</p>
        <button
          onClick={() => setIsSuccess(false)}
          className="px-8 py-4 border border-white/30 rounded-full text-sm uppercase tracking-widest hover:bg-white hover:text-black transition-colors duration-500"
        >
          돌아가기
        </button>
      </div>
    );
  }

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/20">
      {/* Hero Section */}
      <div className="relative h-[60vh] md:h-[70vh] w-full overflow-hidden">
        <Image
          src={getPropertyImage(property.name)}
          alt={property.name}
          fill
          className="object-cover opacity-40 mix-blend-luminosity scale-105 hover:scale-100 transition-transform duration-[20s] ease-out"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050505]/50 to-[#050505]"></div>

        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-white/60 mb-6 font-semibold">void anchae 컬렉션</p>
          <h1 className="font-serif text-6xl md:text-8xl lg:text-[120px] font-light tracking-tighter leading-none mb-4">
            {property.name}
          </h1>
          <div className="w-px h-16 bg-white/20 mt-8"></div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-24 grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-24">

        {/* Left: Calendar */}
        <div className="lg:col-span-7 space-y-12">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">날짜 선택</h2>
            <p className="text-white/50 text-sm font-light tracking-wide">원하시는 숙박 일정을 선택해주세요.</p>
          </div>

          <div className="bg-[#0A0A0A] border border-white/10 rounded-3xl p-8 md:p-10">
            <div className="flex justify-between items-center mb-10">
              <h3 className="font-serif text-2xl font-light tracking-wide">
                {format(currentMonth, 'yyyy년 M월', { locale: ko })}
              </h3>
              <div className="flex gap-2">
                <button onClick={prevMonth} className="p-3 border border-white/10 rounded-full hover:bg-white/5 transition-colors">
                  <ChevronLeft size={18} className="text-white/70" />
                </button>
                <button onClick={nextMonth} className="p-3 border border-white/10 rounded-full hover:bg-white/5 transition-colors">
                  <ChevronRight size={18} className="text-white/70" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-6 gap-x-2 text-center mb-6">
              {['일', '월', '화', '수', '목', '금', '토'].map(day => (
                <div key={day} className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-2 gap-x-2 text-center">
              {emptyDays.map(i => (
                <div key={`empty-${i}`} className="h-12"></div>
              ))}
              {daysInMonth.map(date => {
                const isPast = isBefore(date, startOfToday());
                const isBooked = isDateBooked(date);
                const isSelected = isDateSelected(date);
                const inRange = isDateInRange(date);
                const isStart = checkIn && isSameDay(date, checkIn);
                const isEnd = checkOut && isSameDay(date, checkOut);
                const isOnlyStart = isStart && !checkOut;

                return (
                  <button
                    key={date.toString()}
                    onClick={() => handleDateClick(date)}
                    disabled={isPast || isBooked}
                    className={`
                      relative h-12 w-full flex items-center justify-center text-sm font-light transition-all duration-300
                      ${isPast || isBooked ? 'text-white/20 cursor-not-allowed line-through decoration-white/20' : 'hover:bg-white/10'}
                      ${isSelected ? 'text-black font-medium' : 'text-white/80'}
                      ${inRange ? 'bg-white/10 text-white' : ''}
                      ${isOnlyStart ? 'bg-white rounded-full' : ''}
                      ${isStart && !isOnlyStart ? 'bg-white rounded-l-full' : ''}
                      ${isEnd ? 'bg-white rounded-r-full' : ''}
                      ${!isSelected && !inRange && !isPast && !isBooked ? 'rounded-full' : ''}
                    `}
                  >
                    <span className="relative z-10">{format(date, 'd')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Booking Form */}
        <div className="lg:col-span-5">
          <div className="sticky top-12 space-y-12">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl font-light mb-2">예약</h2>
              <p className="text-white/50 text-sm font-light tracking-wide">예약 정보를 입력해주세요.</p>
            </div>

            <form onSubmit={handleBooking} className="space-y-8">
              {/* Date Summary */}
              <div className="flex items-center justify-between py-6 border-y border-white/10">
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">체크인</p>
                  <p className="font-serif text-xl">{checkIn ? format(checkIn, 'yyyy년 MM월 dd일') : '날짜 선택'}</p>
                </div>
                <ArrowRight size={16} className="text-white/20 mx-4" />
                <div className="flex-1 text-right">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">체크아웃</p>
                  <p className="font-serif text-xl">{checkOut ? format(checkOut, 'yyyy년 MM월 dd일') : '날짜 선택'}</p>
                </div>
              </div>

              {/* Guests */}
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-widest text-white/40">인원</label>
                <div className="flex items-center justify-between border border-white/20 rounded-full p-2 bg-white/5">
                  <button
                    type="button"
                    onClick={() => setGuests(Math.max(1, guests - 1))}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-xl font-light"
                  >-</button>
                  <span className="font-serif text-xl">{guests}</span>
                  <button
                    type="button"
                    onClick={() => setGuests(guests + 1)}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-xl font-light"
                  >+</button>
                </div>
              </div>

              {/* Guest Info */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">이름</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent border-b border-white/20 py-3 text-white font-light focus:outline-none focus:border-white transition-colors placeholder:text-white/20"
                    placeholder="홍길동"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-white/40">이메일 주소</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent border-b border-white/20 py-3 text-white font-light focus:outline-none focus:border-white transition-colors placeholder:text-white/20"
                    placeholder="example@email.com"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!checkIn || !checkOut || isSubmitting}
                className={`
                  w-full py-5 rounded-full text-sm uppercase tracking-widest font-medium transition-all duration-500
                  ${checkIn && checkOut
                    ? 'bg-white text-black hover:bg-white/90 shadow-[0_0_40px_rgba(255,255,255,0.1)]'
                    : 'bg-white/10 text-white/30 cursor-not-allowed'}
                `}
              >
                {isSubmitting ? '처리 중...' : '예약하기'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Legal Footer */}
      {property.permit && (
        <div className="border-t border-white/10 py-8 px-6 text-center">
          <p className="text-[10px] text-white/30 tracking-widest font-light">
            {property.permit}
          </p>
        </div>
      )}
    </div>
  );
}
