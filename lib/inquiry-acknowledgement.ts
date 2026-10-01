/** Deliberately narrow: confirmations such as "yes" may accept a booking offer. */
export function isSimpleInquiryThanks(text: string): boolean {
  if (text.length > 120 || /[?？]/u.test(text)) return false;
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/[.!。,，！\s\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, ' ').trim().replace(/\s+/g, ' ');
  return new Set(['thank you', 'thanks', 'thank you so much', 'thanks so much',
    '감사합니다', '고맙습니다', '감사해요', '고마워요', 'merci', 'merci beaucoup',
    'ありがとうございます', 'ありがとうございました', '謝謝', '谢谢']).has(normalized);
}
