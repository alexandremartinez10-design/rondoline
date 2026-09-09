import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AIProvider, StreamChunk, StreamResult } from '@/lib/types';
import { ProviderRequestError } from '@/lib/types';
import {
  anthropicStream,
  googleStream,
  openaiStream,
  startMockApiServer,
  type MockApiServer,
} from './helpers/mockApiServer';

/**
 * Tests de contrat des trois adaptateurs réels.
 *
 * Le mode démonstration valide le moteur mais ne traverse jamais ce code : il
 * ne s'exécute qu'au premier débat facturé. On fait donc pointer chaque SDK
 * vers un serveur local pour vérifier, sans clé ni coût, ce que l'adaptateur
 * envoie et ce qu'il fait de ce qu'il reçoit.
 */

let server: MockApiServer;

beforeAll(async () => {
  server = await startMockApiServer();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.GOOGLE_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = server.url;
  process.env.OPENAI_BASE_URL = server.url;
  process.env.GOOGLE_BASE_URL = server.url;
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  server.requests.length = 0;
});

/** Consomme entièrement un flux de provider : fragments + résultat final. */
async function drain(
  gen: AsyncGenerator<StreamChunk, StreamResult, unknown>
): Promise<{ deltas: string[]; result: StreamResult }> {
  const deltas: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    deltas.push(next.value.delta);
    next = await gen.next();
  }
  return { deltas, result: next.value };
}

const OPTIONS = { model: 'modele-test', maxTokens: 512 };
const MESSAGES = [{ role: 'user' as const, content: 'Bonjour, quel est ton avis ?' }];
const SYSTEM = 'Tu es un participant à un débat.';

// -----------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  async function provider(): Promise<AIProvider> {
    const { AnthropicProvider } = await import('@/lib/providers/AnthropicProvider');
    return new AnthropicProvider();
  }

  it('diffuse les fragments de texte et agrège le contenu complet', async () => {
    server.respondWith(anthropicStream(['Bon', 'jour', ' !']));
    const { deltas, result } = await drain(
      (await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS)
    );
    expect(deltas).toEqual(['Bon', 'jour', ' !']);
    expect(result.content).toBe('Bonjour !');
  });

  it('remonte l\'usage de jetons', async () => {
    server.respondWith(anthropicStream(['ok']));
    const { result } = await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('envoie le system prompt à part et non dans les messages', async () => {
    server.respondWith(anthropicStream(['ok']));
    await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));

    const body = server.requests[0]!.body;
    expect(body.system).toBe(SYSTEM);
    expect(body.model).toBe('modele-test');
    expect(body.max_tokens).toBe(512);
    expect(body.messages).toEqual([{ role: 'user', content: MESSAGES[0]!.content }]);
  });

  it('traduit un 401 en message explicite sur la clé API', async () => {
    server.respondWithError(401, { error: { type: 'authentication_error', message: 'nope' } });
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(/clé api invalide/i);
  });

  it('traduit un 429 en message de limite de débit', async () => {
    server.respondWithError(429, { error: { type: 'rate_limit_error', message: 'slow down' } });
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(/limite de débit/i);
  });

  it('traduit un 500 en service indisponible', async () => {
    server.respondWithError(500, { error: { type: 'api_error', message: 'boom' } });
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(/indisponible/i);
  });

  it('signale une réponse vide plutôt que de renvoyer une chaîne vide', async () => {
    server.respondWith(anthropicStream([]));
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(ProviderRequestError);
  });
});

// -----------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  async function provider(): Promise<AIProvider> {
    const { OpenAIProvider } = await import('@/lib/providers/OpenAIProvider');
    return new OpenAIProvider();
  }

  it('diffuse les fragments et agrège le contenu', async () => {
    server.respondWith(openaiStream(['Bon', 'jour']));
    const { deltas, result } = await drain(
      (await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS)
    );
    expect(deltas).toEqual(['Bon', 'jour']);
    expect(result.content).toBe('Bonjour');
  });

  it('remonte l\'usage de jetons', async () => {
    server.respondWith(openaiStream(['ok']));
    const { result } = await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('place le system prompt en tête des messages', async () => {
    server.respondWith(openaiStream(['ok']));
    await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));

    expect(server.requests[0]!.body.messages).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: MESSAGES[0]!.content },
    ]);
  });

  it('envoie max_completion_tokens et jamais max_tokens', async () => {
    // `max_tokens` est déprécié et REFUSÉ par les modèles de raisonnement, que
    // l'interface permet de saisir librement. Ce test verrouille la correction.
    server.respondWith(openaiStream(['ok']));
    await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));

    const body = server.requests[0]!.body;
    expect(body.max_completion_tokens).toBe(512);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('demande explicitement l\'usage dans le flux', async () => {
    server.respondWith(openaiStream(['ok']));
    await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));
    expect(server.requests[0]!.body.stream).toBe(true);
    expect(server.requests[0]!.body.stream_options).toEqual({ include_usage: true });
  });

  it('traduit les erreurs HTTP en messages explicites', async () => {
    for (const [status, pattern] of [
      [401, /clé api invalide/i],
      [429, /limite de débit|quota/i],
      [503, /indisponible/i],
    ] as const) {
      server.respondWithError(status, { error: { message: 'erreur', type: 'x' } });
      await expect(
        drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
      ).rejects.toThrow(pattern);
    }
  });

  it('signale une réponse vide', async () => {
    server.respondWith(['data: [DONE]\n\n']);
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(ProviderRequestError);
  });
});

// -----------------------------------------------------------------------------

describe('GoogleProvider', () => {
  async function provider(): Promise<AIProvider> {
    const { GoogleProvider } = await import('@/lib/providers/GoogleProvider');
    return new GoogleProvider();
  }

  it('diffuse les fragments et agrège le contenu', async () => {
    server.respondWith(googleStream(['Bon', 'jour']));
    const { deltas, result } = await drain(
      (await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS)
    );
    expect(deltas).toEqual(['Bon', 'jour']);
    expect(result.content).toBe('Bonjour');
  });

  it('remonte l\'usage lu dans usageMetadata', async () => {
    server.respondWith(googleStream(['ok']));
    const { result } = await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('traduit le rôle "assistant" en "model", attendu par Gemini', async () => {
    server.respondWith(googleStream(['ok']));
    await drain(
      (await provider()).streamMessage(
        [
          { role: 'user', content: 'question' },
          { role: 'assistant', content: 'réponse' },
        ],
        SYSTEM,
        OPTIONS
      )
    );

    const contents = server.requests[0]!.body.contents as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model']);
  });

  it('transmet le system prompt comme systemInstruction', async () => {
    server.respondWith(googleStream(['ok']));
    await drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS));

    const body = server.requests[0]!.body;
    const instruction = JSON.stringify(body.systemInstruction ?? body);
    expect(instruction).toContain(SYSTEM);
  });

  it('signale une réponse vide en évoquant les filtres de sécurité', async () => {
    server.respondWith(googleStream(['']));
    await expect(
      drain((await provider()).streamMessage(MESSAGES, SYSTEM, OPTIONS))
    ).rejects.toThrow(/vide/i);
  });
});
