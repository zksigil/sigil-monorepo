import React from 'react';
import { Text } from 'react-native';

interface SigilWordmarkProps {
  size?: number;
}

export function SigilWordmark({ size = 34 }: SigilWordmarkProps): React.JSX.Element {
  return (
    <Text
      className="text-text-primary font-bold"
      style={{ fontSize: size, lineHeight: size * 1.18, letterSpacing: -0.5 }}
    >
      Sigil
    </Text>
  );
}
