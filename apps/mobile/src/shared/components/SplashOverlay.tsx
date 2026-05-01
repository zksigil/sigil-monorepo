import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SigilMark } from './SigilMark';
import { SigilWordmark } from './SigilWordmark';

interface SplashOverlayProps {
  onDone: () => void;
}

const ENTER_MS = 360;
const HOLD_MS = 690;
const EXIT_MS = 300;

export function SplashOverlay({ onDone }: SplashOverlayProps): React.JSX.Element {
  const translateX = useSharedValue(48);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateX.value = withSequence(
      withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(HOLD_MS, withTiming(-48, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) })),
    );

    opacity.value = withSequence(
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(
        HOLD_MS,
        withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) {
            runOnJS(onDone)();
          }
        }),
      ),
    );
  }, [opacity, translateX, onDone]);

  const lockupStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 bg-canvas items-center justify-center z-50"
    >
      <Animated.View className="items-center justify-center" style={lockupStyle}>
        <SigilMark size={96} variant="gradient" />
        <View className="h-4" />
        <SigilWordmark size={34} />
      </Animated.View>
    </View>
  );
}
