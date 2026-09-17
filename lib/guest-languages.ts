export const guestLanguages = ['ko', 'en', 'zh', 'ja'] as const;
export type GuestLanguage = typeof guestLanguages[number];
export const guestLanguageNames: Record<GuestLanguage, string> = {
  ko: '한국어', en: 'English', zh: '简体中文', ja: '日本語',
};
export const guestLanguageAdminNames: Record<string, string> = {
  ko: '한국어', en: '영어', zh: '중국어(간체)', ja: '일본어',
};
export function guestLanguage(value?: string): GuestLanguage {
  if (value === 'zh-CN' || value === 'zh-Hans') return 'zh';
  return guestLanguages.find(language => language === value) ?? 'en';
}
