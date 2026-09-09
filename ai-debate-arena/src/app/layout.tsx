import type { Metadata } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

// Polices auto-hébergées au moment du build par next/font : pas de requête
// vers un domaine tiers au chargement de la page (un `@import` CSS vers
// fonts.googleapis.com bloque le rendu, fuite l'IP du visiteur, et casse
// l'affichage hors ligne). Les variables CSS sont consommées par globals.css.
const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-loaded',
  display: 'swap',
});

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-loaded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Debate Arena',
  description: 'Faites dialoguer plusieurs IA entre elles : débat, collaboration ou avocat du diable.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${displayFont.variable} ${monoFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
