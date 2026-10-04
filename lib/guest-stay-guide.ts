import guideData from './guest-stay-guide-data.json' with { type: 'json' };

export type GuestStayGuideSection = {
  id: string; title: string; paragraphs: string[]; images?: { url: string; alt: string }[];
};
type GuideLanguage = keyof typeof guideData;
const drain: Record<GuideLanguage, GuestStayGuideSection> = {
  ko: { id: 'shower', title: '샤워실 배수구', paragraphs: ['샤워 후에는 냄새가 올라오지 않도록 배수구 덮개를 닫아 주세요.'] },
  en: { id: 'shower', title: 'Shower drain', paragraphs: ['Please close the shower drain cover after use to prevent odors.'] },
  ja: { id: 'shower', title: 'シャワーの排水口', paragraphs: ['においを防ぐため、シャワーの使用後は排水口のカバーを閉めてください。'] },
  zh: { id: 'shower', title: '淋浴排水口', paragraphs: ['淋浴后请盖好排水口盖板，以防异味。'] },
};

/** Reviewed plain-text room instructions from the welcome pad, without credentials or raw HTML.
 * The API must check a live, currently staying reservation before returning these sections.
 */
export function getGuestStayGuide(slug: string, language: string): { sections: GuestStayGuideSection[] } {
  const lang: GuideLanguage = language in guideData ? language as GuideLanguage : 'en';
  const localized = guideData[lang];
  let sections: GuestStayGuideSection[];
  if (slug === 'byulha' || slug === 'byeolha') {
    // The original Byeolhajae manual has the same waste and boiler instructions.
    sections = localized.anon.filter(section => ['rules', 'waste', 'heating'].includes(section.id));
  } else if (slug === 'anon' || slug === 'unwadang' || slug === 'hwayeonjae') {
    sections = localized[slug];
  } else {
    // Do not invent equipment instructions for properties without a reviewed manual.
    sections = localized.hwayeonjae.filter(section => section.id === 'rules');
  }
  return { sections: [...sections, ...(slug === 'unwadang' ? [drain[lang]] : [])].map(section => ({ ...section, paragraphs: [...section.paragraphs] })) };
}
