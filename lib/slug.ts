import { randomBytes } from 'crypto';

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return base || randomBytes(4).toString('hex');
}

export function uniqueSlug(input: string): string {
  return `${slugify(input)}-${randomBytes(3).toString('hex')}`;
}
