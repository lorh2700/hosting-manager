import { getPropertyDisplay, propertyImagePaths } from './property-display';

export function optimizedPropertyImages(slug: string | null | undefined, images: string[]): string[] {
  const display = slug ? getPropertyDisplay(slug) : null;
  if (!display) return images;
  const originals = new Map(propertyImagePaths(display).map(image => [image.src, image.webp]));
  return images.map(image => originals.get(image) ?? image);
}
