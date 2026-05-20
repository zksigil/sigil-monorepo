import React from 'react';
import { View, Text } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { SigilMark } from '../../../shared/components/SigilMark';
import { COLORS } from '../../../shared/constants/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface Step {
  icon: FeatherName;
  title: string;
  description: string;
}

const STEPS: readonly Step[] = [
  {
    icon: 'smartphone',
    title: 'Tap your passport',
    description: 'Hold the page near your phone for a few seconds',
  },
  {
    icon: 'lock',
    title: 'Generate a proof on-device',
    description: 'Your phone does the math, nothing is uploaded',
  },
  {
    icon: 'check-circle',
    title: 'Sigilize your address',
    description: 'One on-chain mark — protocols verify you',
  },
] as const;

function StepRow({ step }: { step: Step }): React.JSX.Element {
  return (
    <View className="flex-row items-start gap-3">
      <View
        className="w-8 h-8 rounded-full items-center justify-center"
        style={{ backgroundColor: 'rgba(189,147,249,0.12)' }}
      >
        <Feather name={step.icon} size={18} color={COLORS.accentPrimary} />
      </View>
      <View className="flex-1">
        <Text className="text-text-primary text-[15px] leading-[22px] font-medium">{step.title}</Text>
        <Text className="text-text-muted text-[13px] leading-[18px] mt-0.5">{step.description}</Text>
      </View>
    </View>
  );
}

export function PreConnectInfo(): React.JSX.Element {
  return (
    <View className="items-stretch">
      <View className="items-center">
        <SigilMark size={56} variant="gradient" />
        <Text className="text-text-primary text-center font-bold mt-4" style={{ fontSize: 28, lineHeight: 34, letterSpacing: -0.4 }}>
          Proof of personhood{'\n'}for your address.
        </Text>
        <Text className="text-text-secondary text-[15px] leading-[22px] text-center mt-3 px-2">
          Backed by your passport, verified on-device with zero-knowledge proofs.
        </Text>
      </View>

      <View className="border-t border-border-subtle my-6" />

      <View className="gap-y-4">
        {STEPS.map((step) => (
          <StepRow key={step.icon} step={step} />
        ))}
      </View>

      <View className="border-t border-border-subtle my-6" />

      <Text className="text-text-muted text-[13px] leading-[18px] text-center italic">
        Your passport never leaves your phone.
      </Text>
    </View>
  );
}
