/** 'next/headers' 스텁 — 테스트에는 요청 컨텍스트가 없으므로 빈 쿠키 저장소를 돌려준다. */
export async function cookies() {
  const store = new Map<string, string>();
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => { store.set(name, value); },
    delete: (name: string) => { store.delete(name); },
  };
}
