import OpenAI from 'openai';
import type {
  AIProvider,
  ProviderMessage,
  SendMessageOptions,
  StreamChunk,
  StreamResult,
} from '@/lib/types';
import { ProviderNotConfiguredError, ProviderRequestError } from '@/lib/types';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('openai');
    }
    if (!this.client) {
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async *streamMessage(
    messages: ProviderMessage[],
    systemPrompt: string,
    options: SendMessageOptions
  ): AsyncGenerator<StreamChunk, StreamResult, unknown> {
    const client = this.getClient();

    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model: options.model,
          // `max_completion_tokens` et non `max_tokens` : ce dernier est
          // déprécié et surtout REFUSÉ par les modèles de raisonnement. Comme
          // l'interface laisse saisir librement un nom de modèle, un
          // utilisateur peut parfaitement y entrer un tel modèle.
          max_completion_tokens: options.maxTokens ?? 2048,
          temperature: options.temperature,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        { signal: options.signal }
      );
    } catch (err) {
      throw toProviderError(err);
    }

    let fullText = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          yield { delta };
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }
    } catch (err) {
      throw toProviderError(err);
    }

    if (!fullText.trim()) {
      throw new ProviderRequestError('openai', 'Réponse vide reçue du modèle.');
    }

    return { content: fullText, usage: { inputTokens, outputTokens } };
  }
}

function toProviderError(err: unknown): ProviderRequestError {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401 || err.status === 403) {
      return new ProviderRequestError('openai', 'Clé API invalide ou non autorisée.', err);
    }
    if (err.status === 429) {
      return new ProviderRequestError(
        'openai',
        'Limite de débit (rate limit) ou quota atteint. Réessayez plus tard.',
        err
      );
    }
    if (err.status && err.status >= 500) {
      return new ProviderRequestError('openai', 'Le service OpenAI est indisponible.', err);
    }
    return new ProviderRequestError('openai', err.message, err);
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new ProviderRequestError('openai', 'Requête annulée.', err);
  }
  return new ProviderRequestError(
    'openai',
    err instanceof Error ? err.message : 'Erreur inconnue.',
    err
  );
}
