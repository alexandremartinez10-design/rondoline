// -----------------------------------------------------------------------------
// Types partagés entre le frontend, l'API route et le moteur de débat.
// -----------------------------------------------------------------------------

export const PROVIDER_IDS = ['anthropic', 'google', 'openai', 'demo'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type DebateMode = 'debate' | 'collaboration' | 'devil' | 'expert';

/** Un participant configuré par l'utilisateur avant de lancer le débat. */
export interface ParticipantConfig {
  /** Identifiant local unique (généré côté client), pas l'id du provider. */
  id: string;
  /** Nom affiché ("Claude", "Gemini", ou un nom personnalisé en mode expert). */
  displayName: string;
  provider: ProviderId;
  /** Nom exact du modèle à appeler (ex: "claude-sonnet-5"). */
  model: string;
  /** Couleur d'accent (hex) utilisée pour les bulles de ce participant. */
  color: string;
  /** Rôle/personnage assigné, surtout utilisé en mode "expert". */
  role?: string;
  /** Instructions supplémentaires libres, injectées dans le system prompt. */
  customInstructions?: string;
}

export interface DebateRequest {
  topic: string;
  mode: DebateMode;
  participants: ParticipantConfig[];
  maxTurns: number;
  /** Participant chargé de produire la synthèse finale (id). */
  synthesizerId?: string;
  /** Si true, une synthèse finale est générée après le dernier tour. */
  produceSynthesis: boolean;
  /**
   * Historique déjà produit (tours complets uniquement). Fourni lors d'une
   * reprise après pause : le moteur reprend au tour suivant plutôt que de
   * redémarrer à zéro. Vide/absent pour un nouveau débat.
   */
  history?: DebateMessage[];
  /** Si true, la requête ne doit produire QUE la synthèse (reprise après le dernier tour). */
  synthesisOnly?: boolean;
  /**
   * Numéro du premier tour à jouer. Fourni lors d'une reprise : il est calculé
   * par le client à partir des tours réussis ET des tours en échec, pour que la
   * rotation des participants ne se décale pas quand un tour a échoué.
   * Absent = démarrer après le dernier tour présent dans `history`.
   */
  startTurn?: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Un message unique dans l'historique de la conversation. */
export interface DebateMessage {
  id: string;
  turn: number;
  participantId: string;
  role: 'participant' | 'synthesis' | 'system';
  content: string;
  startedAt: number;
  finishedAt?: number;
  usage?: TokenUsage;
  error?: string;
}

// -----------------------------------------------------------------------------
// Évènements SSE envoyés par /api/debate/stream
// -----------------------------------------------------------------------------

export type DebateEvent =
  | { type: 'debate_start'; totalTurns: number }
  | { type: 'turn_start'; turn: number; participantId: string; displayName: string }
  | { type: 'token'; turn: number; participantId: string; delta: string }
  | {
      type: 'turn_end';
      turn: number;
      participantId: string;
      content: string;
      usage?: TokenUsage;
      durationMs: number;
    }
  | { type: 'turn_error'; turn: number; participantId: string; message: string }
  | { type: 'synthesis_start'; participantId: string }
  | { type: 'synthesis_token'; delta: string }
  | { type: 'synthesis_end'; content: string; usage?: TokenUsage }
  | { type: 'debate_end' }
  | { type: 'fatal_error'; message: string };

// -----------------------------------------------------------------------------
// Interface commune à tous les providers d'IA
// -----------------------------------------------------------------------------

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendMessageOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Signal d'annulation (pause/stop côté utilisateur). */
  signal?: AbortSignal;
}

export interface StreamChunk {
  /** Texte incrémental à ajouter à la réponse en cours. */
  delta: string;
}

export interface StreamResult {
  content: string;
  usage?: TokenUsage;
}

/**
 * Interface commune que doit implémenter chaque provider (Anthropic, Google,
 * OpenAI, ou tout futur provider). Le moteur de débat ne connaît que cette
 * interface, jamais les SDK spécifiques.
 */
export interface AIProvider {
  readonly id: ProviderId;
  /** Vrai si la clé API nécessaire est configurée côté serveur. */
  isConfigured(): boolean;
  /**
   * Envoie une conversation au modèle et retourne un flux de fragments de
   * texte au fur et à mesure qu'ils sont générés, puis le résultat final.
   */
  streamMessage(
    messages: ProviderMessage[],
    systemPrompt: string,
    options: SendMessageOptions
  ): AsyncGenerator<StreamChunk, StreamResult, unknown>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: ProviderId) {
    super(`Le provider "${provider}" n'est pas configuré (clé API manquante).`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderRequestError extends Error {
  constructor(provider: ProviderId, message: string, public readonly cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderRequestError';
  }
}
