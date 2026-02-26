/// <reference types="nativewind/types" />

// Inline augmentation — ensures className prop is available on React Native components.
// This is needed because react-native-css-interop lives in the monorepo root's
// node_modules while TypeScript compiles from apps/mobile.
declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface ImageProps {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
  }
  interface TouchableOpacityProps {
    className?: string;
  }
}

// The export makes this a module file, turning the declarations above into
// module augmentations (not replacements).
export {};
