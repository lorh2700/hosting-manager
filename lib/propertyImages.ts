export const PROPERTY_IMAGES: Record<string, string> = {
  '운와당': '/images/unwa/main.jpg',
  '화연재': '/images/hwayeon/main.jpg',
  '안온': '/images/anon/main.jpg',
  '도원': '/images/dowon/main.jpeg',
};

export function getPropertyImage(name: string): string {
  return PROPERTY_IMAGES[name] ?? '/images/main_yard.jpg';
}
