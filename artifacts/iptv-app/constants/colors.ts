/**
 * StreamVault IPTV - Dark-first design tokens.
 * Both light/dark are set to the same dark IPTV palette because
 * userInterfaceStyle is forced to "dark" in app.json.
 */
const DARK = {
  text: '#F2F2F2',
  tint: '#3B82F6',

  background: '#0A0A0F',
  foreground: '#F2F2F2',

  card: '#13131E',
  cardForeground: '#F2F2F2',

  primary: '#3B82F6',
  primaryForeground: '#FFFFFF',

  secondary: '#1A1A28',
  secondaryForeground: '#C8C8C8',

  muted: '#1A1A28',
  mutedForeground: '#6B7280',

  accent: '#3B82F6',
  accentForeground: '#FFFFFF',

  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',

  border: '#252538',
  input: '#1A1A28',
};

const colors = {
  light: DARK,
  dark: DARK,
  radius: 10,
};

export default colors;
