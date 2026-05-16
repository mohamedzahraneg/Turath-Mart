'use client';

import React, { memo, useMemo } from 'react';
import AppIcon from './AppIcon';
import AppImage from './AppImage';

interface AppLogoProps {
  /** Image source override. Defaults to the bundled Turath wordmark. */
  src?: string;
  /** Icon name when no image. */
  iconName?: string;
  /** Height in pixels for the rendered logo. Width is derived from the
   *  natural aspect ratio of the source asset (~2.72:1 for the Turath
   *  wordmark, so a height of 56 → ~152px wide). */
  size?: number;
  /** Additional classes appended to the container. */
  className?: string;
  /** Click handler — adds cursor/hover styles when set. */
  onClick?: () => void;
}

// Natural aspect ratio of /public/assets/images/turath_logo.png
// (875 × 322 — the transparent wordmark + Arabic tagline).
const LOGO_ASPECT = 875 / 322;

const AppLogo = memo(function AppLogo({
  src,
  iconName = 'SparklesIcon',
  size = 56,
  className = '',
  onClick,
}: AppLogoProps) {
  const finalSrc = useMemo(() => src ?? '/assets/images/turath_logo.png', [src]);

  const containerClassName = useMemo(() => {
    const classes = ['flex items-center'];
    if (onClick) classes.push('cursor-pointer hover:opacity-80 transition-opacity');
    if (className) classes.push(className);
    return classes.join(' ');
  }, [onClick, className]);

  const height = size;
  const width = Math.round(size * LOGO_ASPECT);

  return (
    <div className={containerClassName} onClick={onClick}>
      {finalSrc ? (
        <AppImage
          src={finalSrc}
          alt="Turath"
          width={width}
          height={height}
          className="flex-shrink-0 object-contain"
          priority={true}
          unoptimized={finalSrc.endsWith('.svg')}
        />
      ) : (
        <AppIcon name={iconName} size={size} className="flex-shrink-0" />
      )}
    </div>
  );
});

export default AppLogo;
