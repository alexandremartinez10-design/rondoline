import type { ProviderId } from '@/lib/types';

/**
 * Configuration centralisée des modèles.
 *
 * Objectif : ne JAMAIS écrire un nom de modèle en dur dans un composant ou
 * une route. Cette liste sert de suggestions dans l'UI (menu déroulant +
 * champ libre), mais l'utilisateur peut toujours saisir un nom de modèle
 * personnalisé — utile quand un fournisseur sort un nouveau modèle avant
 * qu'on ait mis à jour cette liste.
 *
 * Les noms de modèles changent régulièrement : vérifiez la documentation
 * officielle de chaque fournisseur avant de vous fier à cette liste.
 *   - Anthropic : https://docs.claude.com/en/docs/about-claude/models
 *   - Google    : https://ai.google.dev/gemini-api/docs/models
 *   - OpenAI    : https://platform.openai.com/docs/models
 */

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /**
   * Nom de la variable d'env contenant la clé API (pour messages d'erreur).
   * Chaîne vide pour les providers qui n'en demandent pas (mode démo).
   */
  apiKeyEnvVar: string;
  /** Modèles suggérés dans l'UI. Liste non exhaustive et modifiable. */
  suggestedModels: string[];
  /** Couleur d'accent par défaut pour ce provider. */
  defaultColor: string;
  /** Nom par défaut proposé pour un participant utilisant ce provider. */
  defaultDisplayName: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    suggestedModels: [
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-haiku-4-5-20251001',
      'claude-fable-5-1',
    ],
    defaultColor: '#C77B5C',
    defaultDisplayName: 'Claude',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultColor: '#5B8DEF',
    defaultDisplayName: 'Gemini',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    defaultColor: '#4FBF8F',
    defaultDisplayName: 'GPT',
  },
  demo: {
    id: 'demo',
    label: 'Démo (hors ligne, sans clé API)',
    apiKeyEnvVar: '',
    suggestedModels: ['demo-orateur', 'demo-analyste', 'demo-sceptique'],
    defaultColor: '#8B7FD4',
    defaultDisplayName: 'Démo',
  },
};

/**
 * Limites par défaut de l'application.
 *
 * IMPORTANT : cet objet ne lit PAS `process.env`. Il est importé aussi bien
 * par des composants client que par le serveur, et dans un bundle client
 * Next.js toute variable d'environnement non préfixée `NEXT_PUBLIC_` vaut
 * `undefined` — l'UI et le serveur auraient alors des limites différentes.
 * Le serveur surcharge ces valeurs via `getServerLimits()` ; le client
 * récupère les limites effectives via `GET /api/debate/stream`.
 */
export const DEFAULT_LIMITS = {
  maxTurns: 20,
  minTurns: 1,
  maxTopicLength: 4000,
  maxParticipants: 6,
  minParticipants: 2,
  providerTimeoutMs: 90_000,
} as const;

export type AppLimits = { -readonly [K in keyof typeof DEFAULT_LIMITS]: number };

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Limites effectives côté serveur, surchargeables par variables d'env.
 * À n'appeler QUE depuis du code serveur (route API, moteur, validation).
 */
export function getServerLimits(): AppLimits {
  return {
    ...DEFAULT_LIMITS,
    maxTurns: envInt('MAX_TURNS_LIMIT', DEFAULT_LIMITS.maxTurns),
    maxTopicLength: envInt('MAX_TOPIC_LENGTH', DEFAULT_LIMITS.maxTopicLength),
    providerTimeoutMs: envInt('PROVIDER_TIMEOUT_MS', DEFAULT_LIMITS.providerTimeoutMs),
  };
}

/**
 * Modèle par défaut d'un provider, surchargeable par variable d'env.
 * Serveur uniquement — exposé au client via `GET /api/debate/stream`.
 */
export function getDefaultModelForProvider(provider: ProviderId): string {
  const fromEnv: Partial<Record<ProviderId, string | undefined>> = {
    anthropic: process.env.ANTHROPIC_DEFAULT_MODEL,
    google: process.env.GOOGLE_DEFAULT_MODEL,
    openai: process.env.OPENAI_DEFAULT_MODEL,
  };
  const value = fromEnv[provider]?.trim();
  return value || PROVIDERS[provider].suggestedModels[0] || '';
}
