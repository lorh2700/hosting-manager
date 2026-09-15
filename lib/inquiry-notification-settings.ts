import { z } from 'zod';

export const MAX_INQUIRY_RECIPIENTS = 10;

// Accept Korean mobile numbers and +82 notation; reject arbitrary characters.
const phoneSchema = z.string().trim().max(40)
  .regex(/^(?:\+82|0)[0-9 ()-]+$/, '휴대폰 번호를 확인해 주세요.')
  .transform(value => {
    const digits = value.replace(/\D/g, '');
    return value.startsWith('+82') ? `0${digits.slice(2)}` : digits;
  })
  .pipe(z.string().regex(/^010\d{8}$/, '010으로 시작하는 휴대폰 번호를 입력해 주세요.'));

export const inquiryNotificationSettingsSchema = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.object({
    name: z.string().trim().min(1, '수신자 이름을 입력해 주세요.').max(50, '이름은 50자 이내로 입력해 주세요.'),
    phone: phoneSchema,
  }).strict()).max(MAX_INQUIRY_RECIPIENTS, `수신자는 최대 ${MAX_INQUIRY_RECIPIENTS}명까지 등록할 수 있습니다.`),
}).strict().superRefine((settings, ctx) => {
  if (settings.enabled && settings.recipients.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: '알림을 받으려면 수신자를 한 명 이상 등록해 주세요.' });
  }
  const seen = new Set<string>();
  settings.recipients.forEach((recipient, index) => {
    if (seen.has(recipient.phone)) ctx.addIssue({ code: 'custom', path: ['recipients', index, 'phone'], message: '같은 휴대폰 번호가 중복되어 있습니다.' });
    seen.add(recipient.phone);
  });
});

export type InquiryNotificationSettingsInput = z.infer<typeof inquiryNotificationSettingsSchema>;
export type InquiryRecipient = InquiryNotificationSettingsInput['recipients'][number];
