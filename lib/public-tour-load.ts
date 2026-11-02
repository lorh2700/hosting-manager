export async function loadPublicTours<T>(url: string, options: { detail?: boolean; signal?: AbortSignal } = {}): Promise<T | null> {
  const response = await fetch(url, { signal: options.signal, cache: 'no-store' });
  if (options.detail && response.status === 404) return null;
  if (!response.ok) throw new Error('tour_load_failed');
  const value: unknown = await response.json();
  if (options.detail ? !value || typeof value !== 'object' || !('id' in value) : !Array.isArray(value)) throw new Error('tour_load_invalid');
  return value as T;
}
