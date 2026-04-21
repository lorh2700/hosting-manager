import Image from 'next/image';

type LogoVariant = 'white' | 'black';

interface LogoProps {
  className?: string;
  /** Width in pixels. The logo maintains its natural aspect ratio (~8.67:1). */
  width?: number;
  /** 'white' for dark backgrounds (default), 'black' for light backgrounds. */
  variant?: LogoVariant;
  priority?: boolean;
}

const SOURCES: Record<LogoVariant, string> = {
  white: '/voidanche_fin_white.png',
  black: '/voidanche_fin_black.png',
};

export function Logo({ className = '', width = 160, variant = 'white', priority = false }: LogoProps) {
  const height = Math.round(width / 8.67);
  return (
    <Image
      src={SOURCES[variant]}
      alt="void anchae"
      width={width}
      height={height}
      priority={priority}
      className={className}
      style={{ width, height: 'auto' }}
    />
  );
}
