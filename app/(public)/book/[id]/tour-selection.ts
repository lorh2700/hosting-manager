import type { StayTour, StayTourSelectionInput } from '@/lib/stay-tour-types';

export function tourSelectionsForSubmission(selections: StayTourSelectionInput[]): StayTourSelectionInput[] {
  return selections.map(selection => ({ ...selection,
    ...(selection.tickets ? { tickets: selection.tickets.filter(ticket => ticket.count !== 0).map(ticket => ({ ...ticket })) } : {}),
  }));
}

export function tourInquiryReceiptSignature(input: { propertyId: string; checkIn: string; checkOut: string; name: string; phone: string; email?: string; tourSelections: StayTourSelectionInput[] }): string {
  return JSON.stringify({ propertyId: input.propertyId, checkIn: input.checkIn, checkOut: input.checkOut,
    name: input.name.trim(), phone: input.phone.trim(), tourSelections: tourSelectionsForSubmission(input.tourSelections),
  });
}

export function tourSelectionIssue(selections: StayTourSelectionInput[], checkIn: string, checkOut: string, guests: number, english: boolean): string | null {
  if (!selections.length) return null;
  if (!checkIn || !checkOut) return english ? 'Choose your stay dates to request a tour.' : '투어 신청을 위해 숙박 날짜를 선택해 주세요.';
  if (selections.some(item => !item.requestedDate || item.requestedDate < checkIn || item.requestedDate > checkOut)) return english ? 'Choose a tour date within your stay, including check-out day.' : '투어 날짜를 체크인일부터 체크아웃일 사이로 선택해 주세요.';
  if (selections.some(item => !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.requestedTime))) return english ? 'Enter the preferred time for each tour.' : '각 투어의 희망 시간을 입력해 주세요.';
  if (selections.some(item => !Number.isInteger(item.guests) || item.guests < 1 || item.guests > guests)) return english ? 'Tour participants must be within the number of staying guests.' : '투어 인원을 숙박 인원 이내로 선택해 주세요.';
  if (selections.some(item => item.tickets?.length && item.tickets.reduce((sum, ticket) => sum + ticket.count, 0) !== item.guests)) return english ? 'The total ticket quantity must match the tour participants.' : '티켓 수량의 합계를 투어 인원과 맞춰 주세요.';
  return null;
}

export function estimatedTourPrice(tour: StayTour, selection: StayTourSelectionInput): number | null {
  if (tour.ticketTiers.length) {
    return (selection.tickets ?? []).reduce((sum, ticket) => sum + (tour.ticketTiers.find(tier => tier.id === ticket.tierId)?.price ?? 0) * ticket.count, 0);
  }
  const unitPrice = tour.durationOptions.find(option => option.id === selection.durationOptionId)?.price ?? tour.basePrice;
  return unitPrice === null ? null : unitPrice * selection.guests;
}
