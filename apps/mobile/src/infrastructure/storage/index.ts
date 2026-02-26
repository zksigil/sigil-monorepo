import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  ONBOARDING_COMPLETE: '@zkid/onboarding_complete',
  LAST_VERIFIED_CHAIN: '@zkid/last_verified_chain',
} as const;

export async function getOnboardingComplete(): Promise<boolean> {
  const value = await AsyncStorage.getItem(KEYS.ONBOARDING_COMPLETE);
  return value === 'true';
}

export async function setOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(KEYS.ONBOARDING_COMPLETE, 'true');
}

export async function clearAllStorage(): Promise<void> {
  await AsyncStorage.clear();
}
