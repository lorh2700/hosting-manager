export function guestInvitationPath(token: string, language: string) {
  if (!/^[A-Za-z0-9_-]{22,1024}$/.test(token)) throw new Error('INVALID_INVITATION_TOKEN');
  const lang = ['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en';
  return `/i/${token}?lang=${lang}`;
}

export function guestInvitationToken(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash) return null;
  return url.pathname.match(/^\/(?:i|guest\/welcome)\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;
}
