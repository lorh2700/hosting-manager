import type { GuestLanguage } from './guest-languages';

const fields = ['guestName', 'email', 'phone', 'arrivalDate', 'arrivalTime', 'flightNumber', 'passengers', 'luggage', 'message', 'consent', 'date', 'time', 'destination', 'guests', 'tourId', 'durationOptionId', 'ticketCounts', 'category', 'note'] as const;
export type GuestFormField = typeof fields[number];
export type GuestFieldErrors = Partial<Record<GuestFormField, 'invalid' | 'date_unavailable' | 'selection_unavailable'>>;
const isField = (value: unknown): value is GuestFormField => typeof value === 'string' && (fields as readonly string[]).includes(value);

/** Only public identifiers cross the API boundary, never schema messages or input values. */
export function guestValidationFields(issues: readonly { path: readonly PropertyKey[] }[]): GuestFieldErrors {
  const result: GuestFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0] === 'details' ? issue.path[1] : issue.path[0];
    if (isField(field)) result[field] = 'invalid';
  }
  return result;
}
export function readGuestFieldErrors(value: unknown): GuestFieldErrors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([field, reason]) => isField(field) && typeof reason === 'string' && ['invalid', 'date_unavailable', 'selection_unavailable'].includes(reason))) as GuestFieldErrors;
}
export function guestFieldMessage(lang: GuestLanguage, field: GuestFormField, reason: GuestFieldErrors[GuestFormField]): string {
  const index = ['ko', 'en', 'ja', 'zh'].indexOf(lang);
  const copy = reason === 'date_unavailable' ? ['투숙 기간 안의 신청 가능한 미래 날짜와 시간을 선택해 주세요.', 'Choose an eligible future date and time within your stay.', '滞在期間内の申請可能な未来の日付と時間を選択してください。', '请选择住宿期间可申请的未来日期和时间。']
    : reason === 'selection_unavailable' ? ['현재 가능한 상품·코스·인원을 다시 선택해 주세요.', 'Choose an available programme, course or number of guests.', '現在利用可能な商品・コース・人数を選択してください。', '请重新选择可提供的项目、课程或人数。']
    : field === 'email' ? ['이메일 주소 형식을 확인해 주세요.', 'Enter a valid email address.', '有効なメールアドレスを入力してください。', '请输入有效的电子邮箱地址。']
    : field === 'phone' ? ['국가번호와 전화번호를 숫자로 입력해 주세요.', 'Enter your country code and phone number using digits.', '国番号と電話番号を数字で入力してください。', '请使用数字输入国家代码和电话号码。']
    : field === 'flightNumber' ? ['KE902처럼 항공사 코드와 항공편 번호를 입력해 주세요.', 'Enter the airline code and flight number, for example KE902.', 'KE902のように航空会社コードと便名を入力してください。', '请输入航空公司代码和航班号，例如KE902。']
    : field === 'consent' ? ['개인정보 제공에 동의해 주세요.', 'Please agree to the privacy consent.', '個人情報の提供に同意してください。', '请同意隐私授权。']
    : ['이 항목의 입력값을 확인해 주세요.', 'Please check this field.', 'この項目の入力内容をご確認ください。', '请检查此项填写内容。'];
  return copy[index < 0 ? 1 : index];
}
