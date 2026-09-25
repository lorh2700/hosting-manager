/** Bounded, abortable retries for reads only. Never retry a mutation here. */
export async function readOps<T>(url: string, signal: AbortSignal, timeoutMs = 12000): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
      if (response.status === 401) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      if (response.status === 403) throw new Error('조회 권한이 없습니다. 관리자에게 문의해 주세요.');
      if (response.status >= 500 && attempt === 0) continue;
      if (!response.ok) throw new Error('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      const transient = error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
      if (transient && attempt === 0) continue;
      if (transient) throw new Error('서버 연결이 지연되고 있습니다. 다시 불러오기를 눌러주세요.');
      throw error;
    }
  }
  throw new Error('정보를 불러오지 못했습니다.');
}
