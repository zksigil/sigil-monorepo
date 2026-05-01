export const COLORS = {
  canvas: '#282a36',
  surface: '#373947',
  elevated: '#44475a',
  textPrimary: '#f8f8f2',
  textSecondary: '#c8cad6',
  textMuted: '#8a92b2',
  borderSubtle: 'rgba(98,114,164,0.25)',
  accentPrimary: '#bd93f9',
  accentSuccess: '#50fa7b',
  accentDanger: '#ff5555',
  accentWarning: '#ffb86c',
} as const;

export interface GradientStop {
  offset: string;
  color: string;
}

export const BRAND_GRADIENT_STOPS: readonly GradientStop[] = [
  { offset: '0%', color: '#C18BFB' },
  { offset: '30%', color: '#7CB7FF' },
  { offset: '55%', color: '#7BE5DA' },
  { offset: '80%', color: '#B7F58E' },
  { offset: '100%', color: '#FFB57A' },
] as const;
