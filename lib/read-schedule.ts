/** Retry reads only; applications must never be submitted twice automatically. */
export async function readSchedule(url: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (response.ok) return await response.json();
      if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      if (response.status === 403) throw new Error('일정을 조회할 권한이 없습니다. 관리자에게 문의해 주세요.');
      if (response.status >= 500 && attempt === 0) continue;
      throw new Error('일정을 불러오지 못했습니다. 잠시 후 다시 불러오기를 눌러주세요.');
    } catch (error) {
      const transient = error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
      if (transient && attempt === 0) continue;
      if (transient) throw new Error('서버 연결이 지연되고 있습니다. 잠시 후 다시 불러오기를 눌러주세요.');
      throw error;
    }
  }
}
