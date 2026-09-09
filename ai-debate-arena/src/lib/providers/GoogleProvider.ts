import { GoogleGenAI } from '@google/genai';
import type {
  AIProvider,
  ProviderMessage,
  SendMessageOptions,
  StreamChunk,
  StreamResult,
} from '@/lib/types';
import { ProviderNotConfiguredError, ProviderRequestError } from '@/lib/types';

export class GoogleProvider implements AIProvider {
  readonly id = 'google' as const;
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('google');
    }
    if (!this.client) {
      // GOOGLE_BASE_URL permet de viser un proxy d'entreprise, un point de
      // terminaison compatible, ou un serveur simulé dans les tests. Les SDK
      // Anthropic et OpenAI lisent nativement leur équivalent ; celui de
      // Google demande de le passer explicitement.
      const baseUrl = process.env.GOOGLE_BASE_URL?.trim();
      this.client = new GoogleGenAI({
        apiKey: process.env.GOOGLE_API_KEY,
        ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_API_KEY);
  }

  async *streamMessage(
    messages: ProviderMessage[],
    systemPrompt: string,
    options: SendMessageOptions
  ): AsyncGenerator<StreamChunk, StreamResult, unknown> {
    const client = this.getClient();

    // Gemini utilise les rôles "user" / "model" (pas "assistant").
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    let stream;
    try {
      stream = await client.models.generateContentStream({
        model: options.model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: options.maxTokens ?? 2048,
          temperature: options.temperature,
          abortSignal: options.signal,
        },
      });
    } catch (err) {
      throw toProviderError(err);
    }

    let fullText = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      for await (const chunk of stream) {
        if (options.signal?.aborted) {
          throw new ProviderRequestError('google', 'Requête annulée.');
        }
        const delta = chunk.text ?? '';
        if (delta) {
          fullText += delta;
          yield { delta };
        }
        // Certains chunks (notamment le dernier) transportent usageMetadata.
        const usage = chunk.usageMetadata;
        if (usage) {
          inputTokens = usage.promptTokenCount ?? inputTokens;
          outputTokens = usage.candidatesTokenCount ?? outputTokens;
        }
      }
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err;
      throw toProviderError(err);
    }

    if (!fullText.trim()) {
      throw new ProviderRequestError(
        'google',
        'Réponse vide reçue du modèle (possiblement bloquée par les filtres de sécurité).'
      );
    }

    return { content: fullText, usage: { inputTokens, outputTokens } };
  }
}

function toProviderError(err: unknown): ProviderRequestError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('api key') || lower.includes('401') || lower.includes('permission')) {
    return new ProviderRequestError('google', 'Clé API invalide ou non autorisée.', err);
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('rate')) {
    return new ProviderRequestError(
      'google',
      'Limite de débit (rate limit) ou quota atteint. Réessayez plus tard.',
      err
    );
  }
  if (lower.includes('500') || lower.includes('503') || lower.includes('unavailable')) {
    return new ProviderRequestError('google', 'Le service Gemini est indisponible.', err);
  }
  if (lower.includes('abort')) {
    return new ProviderRequestError('google', 'Requête annulée.', err);
  }
  return new ProviderRequestError('google', message, err);
}
