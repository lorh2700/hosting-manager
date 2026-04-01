export const ADMIN_EMAILS = [
  'unwadang@gmail.com',
  'lorh2700@gmail.com',
  'alsemffp67@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes(email ?? '');
}
