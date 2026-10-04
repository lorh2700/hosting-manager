interface InvitationFlow {
  token: string;
  email: string;
  role: string;
  password?: string;
  signedInEmail?: string | null;
  request?: typeof fetch;
}

/** A login is not evidence of accepting the invitation's role and business. */
export async function completeInvitation(input: InvitationFlow): Promise<{ role: string }> {
  const request = input.request || fetch;
  const call = async (url: string, body?: object) => {
    const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };
  const claim = async () => {
    const { response, data } = await call(`/api/invitations/${encodeURIComponent(input.token)}/accept`);
    if (!response.ok || data.success !== true) throw new Error(data.error || '초대를 수락하지 못했습니다. 소속과 권한은 변경되지 않았습니다.');
    return { role: data.profile?.role || input.role };
  };
  if (input.signedInEmail) {
    if (input.signedInEmail.trim().toLowerCase() !== input.email.trim().toLowerCase()) throw new Error('초대받은 이메일로 로그인해 주세요.');
    return claim();
  }
  if (!input.password || input.password.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.');
  const registered = await call('/api/auth/register', { email: input.email, password: input.password, displayName: input.email, invitationToken: input.token });
  if (registered.response.ok) return { role: registered.data.profile?.role || input.role };
  if (registered.response.status !== 409) throw new Error(registered.data.error || '계정을 만들지 못했습니다.');
  const loggedIn = await call('/api/auth/login', { email: input.email, password: input.password });
  if (!loggedIn.response.ok) throw new Error(loggedIn.data.error || '이미 계정이 있습니다. 기존 로그인 비밀번호를 입력해 주세요.');
  return claim();
}
