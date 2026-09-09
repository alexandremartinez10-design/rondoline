import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  ProviderMessage,
  SendMessageOptions,
  StreamChunk,
  StreamResult,
} from '@/lib/types';
import { ProviderNotConfiguredError, ProviderRequestError } from '@/lib/types';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('anthropic');
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async *streamMessage(
    messages: ProviderMessage[],
    systemPrompt: string,
    options: SendMessageOptions
  ): AsyncGenerator<StreamChunk, StreamResult, unknown> {
    const client = this.getClient();

    let stream;
    try {
      stream = client.messages.stream(
        {
          model: options.model,
          max_tokens: options.maxTokens ?? 2048,
          temperature: options.temperature,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        },
        { signal: options.signal }
      );
    } catch (err) {
      throw toProviderError(err);
    }

    let fullText = '';
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          fullText += delta;
          yield { delta };
        }
      }
    } catch (err) {
      throw toProviderError(err);
    }

    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage
      ? {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        }
      : undefined;

    if (!fullText.trim()) {
      throw new ProviderRequestError('anthropic', 'Réponse vide reçue du modèle.');
    }

    return { content: fullText, usage };
  }
}

function toProviderError(err: unknown): ProviderRequestError {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) {
      return new ProviderRequestError('anthropic', 'Clé API invalide ou non autorisée.', err);
    }
    if (err.status === 429) {
      return new ProviderRequestError(
        'anthropic',
        'Limite de débit (rate limit) atteinte. Réessayez dans quelques instants.',
        err
      );
    }
    if (err.status && err.status >= 500) {
      return new ProviderRequestError('anthropic', 'Le service Anthropic est indisponible.', err);
    }
    return new ProviderRequestError('anthropic', err.message, err);
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new ProviderRequestError('anthropic', 'Requête annulée.', err);
  }
  return new ProviderRequestError(
    'anthropic',
    err instanceof Error ? err.message : 'Erreur inconnue.',
    err
  );
}
