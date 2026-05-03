import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { BRAND_GRADIENT_STOPS, COLORS } from '../constants/theme';

interface SigilMarkProps {
  size?: number;
  variant?: 'gradient' | 'solid';
  solidColor?: string;
}

const PATH_D =
  'M 165 55 Q 165 30 125 30 L 75 30 Q 35 30 35 65 L 35 80 ' +
  'Q 35 110 80 110 L 120 110 Q 145 110 145 125 Q 145 140 120 140 ' +
  'L 40 140 L 40 170 L 120 170 Q 170 170 170 135 L 170 120 ' +
  'Q 170 90 120 90 L 80 90 Q 55 90 55 75 L 55 70 Q 55 55 80 55 L 165 55 Z';

export function SigilMark({
  size = 96,
  variant = 'gradient',
  solidColor = COLORS.accentPrimary,
}: SigilMarkProps): React.JSX.Element {
  const gradientId = 'sigil-mark-gradient';
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {variant === 'gradient' && (
        <Defs>
          <LinearGradient id={gradientId} x1="20" y1="20" x2="180" y2="200" gradientUnits="userSpaceOnUse">
            {BRAND_GRADIENT_STOPS.map((stop) => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
            ))}
          </LinearGradient>
        </Defs>
      )}
      <Path d={PATH_D} fill={variant === 'gradient' ? `url(#${gradientId})` : solidColor} />
    </Svg>
  );
}
