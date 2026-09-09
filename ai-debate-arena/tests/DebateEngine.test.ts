import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebateEvent, DebateRequest } from '@/lib/types';

/**
 * Le moteur est testé à travers un faux provider injecté dans la factory :
 * on contrôle ainsi précisément l'échec d'un tour, la lenteur d'un appel ou
 * un flux vide, ce qui est impossible avec de vrais appels réseau.
 */
const scriptedBehaviour = {
  failOnTurns: new Set<number>(),
  hangOnTurns: new Set<number>(),
  calls: [] as { model: string; systemPrompt: string; userContent: string }[],
  turnCounter: 0,
};

vi.mock('@/lib/providers/ProviderFactory', () => ({
  providerFactory: {
    isConfigured: (id: string) => id !== 'openai',
    get: () => ({
      id: 'demo',
      isConfigured: () => true,
      async *streamMessage(
        messages: { content: string }[],
        systemPrompt: string,
        options: { model: string; signal?: AbortSignal }
      ) {
        scriptedBehaviour.turnCounter += 1;
        const turn = scriptedBehaviour.turnCounter;
        scriptedBehaviour.calls.push({
          model: options.model,
          systemPrompt,
          userContent: messages[0]?.content ?? '',
        });

        if (scriptedBehaviour.failOnTurns.has(turn)) {
          throw new Error('panne simulée du provider');
        }
        if (scriptedBehaviour.hangOnTurns.has(turn)) {
          // Ne se termine jamais de lui-même : seul le timeout doit y mettre fin.
          await new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        }

        yield { delta: 'réponse ' };
        yield { delta: `du tour ${turn}` };
        return { content: `réponse du tour ${turn}`, usage: { outputTokens: 3 } };
      },
    }),
  },
}));

const { runDebate } = await import('@/lib/debate/DebateEngine');

function request(overrides: Partial<DebateRequest> = {}): DebateRequest {
  return {
    topic: 'Un sujet de test',
    mode: 'debate',
    maxTurns: 4,
    produceSynthesis: false,
    participants: [
      { id: 'p1', displayName: 'Alpha', provider: 'anthropic', model: 'modele-a', color: '#111111' },
      { id: 'p2', displayName: 'Beta', provider: 'google', model: 'modele-b', color: '#222222' },
    ],
    ...overrides,
  };
}

async function collect(req: DebateRequest, signal = new AbortController().signal) {
  const events: DebateEvent[] = [];
  for await (const event of runDebate(req, signal)) events.push(event);
  return events;
}

const turnsOf = (events: DebateEvent[]) =>
  events
    .filter((e): e is Extract<DebateEvent, { type: 'turn_start' }> => e.type === 'turn_start')
    .map((e) => ({ turn: e.turn, participantId: e.participantId }));

beforeEach(() => {
  scriptedBehaviour.failOnTurns.clear();
  scriptedBehaviour.hangOnTurns.clear();
  scriptedBehaviour.calls.length = 0;
  scriptedBehaviour.turnCounter = 0;
  delete process.env.PROVIDER_TIMEOUT_MS;
});

afterEach(() => {
  delete process.env.PROVIDER_TIMEOUT_MS;
});

describe('runDebate — déroulement nominal', () => {
  it('alterne les participants tour après tour', async () => {
    expect(turnsOf(await collect(request()))).toEqual([
      { turn: 1, participantId: 'p1' },
      { turn: 2, participantId: 'p2' },
      { turn: 3, participantId: 'p1' },
      { turn: 4, participantId: 'p2' },
    ]);
  });

  it('émet les jetons puis un turn_end porteur du contenu complet', async () => {
    const events = await collect(request({ maxTurns: 1 }));
    expect(events.filter((e) => e.type === 'token')).toHaveLength(2);
    const end = events.find((e) => e.type === 'turn_end');
    expect(end).toMatchObject({ turn: 1, participantId: 'p1', content: 'réponse du tour 1' });
  });

  it('termine par debate_end', async () => {
    const events = await collect(request({ maxTurns: 2 }));
    expect(events.at(-1)?.type).toBe('debate_end');
  });

  it('transmet à chaque participant le modèle qui lui est propre', async () => {
    await collect(request({ maxTurns: 2 }));
    expect(scriptedBehaviour.calls.map((c) => c.model)).toEqual(['modele-a', 'modele-b']);
  });

  it('donne au tour 2 le contenu du tour 1 dans son contexte', async () => {
    await collect(request({ maxTurns: 2 }));
    expect(scriptedBehaviour.calls[1]?.userContent).toContain('réponse du tour 1');
    expect(scriptedBehaviour.calls[1]?.userContent).toContain('Alpha');
  });

  it('borne le nombre de tours par la limite serveur', async () => {
    process.env.MAX_TURNS_LIMIT = '2';
    const events = await collect(request({ maxTurns: 4 }));
    expect(turnsOf(events)).toHaveLength(2);
    delete process.env.MAX_TURNS_LIMIT;
  });
});

describe('runDebate — échec d\'un tour', () => {
  it('signale l\'erreur et poursuit le débat', async () => {
    scriptedBehaviour.failOnTurns.add(2);
    const events = await collect(request());

    const errors = events.filter((e) => e.type === 'turn_error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ turn: 2, participantId: 'p2' });
    // Le débat n'est pas interrompu : les tours 3 et 4 ont bien lieu.
    expect(turnsOf(events)).toHaveLength(4);
    expect(events.at(-1)?.type).toBe('debate_end');
  });

  it('n\'ajoute pas le tour échoué à l\'historique transmis au tour suivant', async () => {
    scriptedBehaviour.failOnTurns.add(1);
    await collect(request({ maxTurns: 2 }));
    expect(scriptedBehaviour.calls[1]?.userContent).not.toContain('réponse du tour 1');
  });

  it('ignore le tour d\'un provider non configuré sans arrêter le débat', async () => {
    const events = await collect(
      request({
        maxTurns: 2,
        participants: [
          { id: 'p1', displayName: 'Alpha', provider: 'anthropic', model: 'm', color: '#111111' },
          { id: 'p2', displayName: 'Beta', provider: 'openai', model: 'm', color: '#222222' },
        ],
      })
    );
    const error = events.find((e) => e.type === 'turn_error');
    expect(error).toMatchObject({ turn: 2, participantId: 'p2' });
    expect((error as { message: string }).message).toMatch(/non configuré/i);
  });

  it('abandonne d\'emblée si aucun provider n\'est configuré', async () => {
    const events = await collect(
      request({
        participants: [
          { id: 'p1', displayName: 'A', provider: 'openai', model: 'm', color: '#111111' },
          { id: 'p2', displayName: 'B', provider: 'openai', model: 'm', color: '#222222' },
        ],
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('fatal_error');
  });
});

describe('runDebate — reprise (startTurn)', () => {
  it('reprend au tour demandé et conserve la rotation', async () => {
    const events = await collect(
      request({
        startTurn: 3,
        history: [
          { id: 'h1', turn: 1, participantId: 'p1', role: 'participant', content: 'a', startedAt: 1 },
          { id: 'h2', turn: 2, participantId: 'p2', role: 'participant', content: 'b', startedAt: 2 },
        ],
      })
    );
    expect(turnsOf(events)).toEqual([
      { turn: 3, participantId: 'p1' },
      { turn: 4, participantId: 'p2' },
    ]);
  });

  it('ne décale pas la rotation quand un tour précédent a échoué', async () => {
    // Deux tours tentés, mais un seul réussi : sans startTurn, le moteur
    // reprendrait au tour 2 et donnerait le tour 3 au mauvais participant.
    const events = await collect(
      request({
        startTurn: 3,
        history: [
          { id: 'h1', turn: 1, participantId: 'p1', role: 'participant', content: 'a', startedAt: 1 },
        ],
      })
    );
    expect(turnsOf(events)[0]).toEqual({ turn: 3, participantId: 'p1' });
  });

  it('sans startTurn, se replie sur le nombre de tours présents dans l\'historique', async () => {
    const events = await collect(
      request({
        history: [
          { id: 'h1', turn: 1, participantId: 'p1', role: 'participant', content: 'a', startedAt: 1 },
        ],
      })
    );
    expect(turnsOf(events)[0]).toEqual({ turn: 2, participantId: 'p2' });
  });
});

describe('runDebate — synthèse', () => {
  it('produit une synthèse quand elle est demandée', async () => {
    const events = await collect(request({ maxTurns: 2, produceSynthesis: true }));
    expect(events.some((e) => e.type === 'synthesis_start')).toBe(true);
    expect(events.some((e) => e.type === 'synthesis_end')).toBe(true);
  });

  it('confie la synthèse au participant désigné', async () => {
    const events = await collect(
      request({ maxTurns: 1, produceSynthesis: true, synthesizerId: 'p2' })
    );
    expect(events.find((e) => e.type === 'synthesis_start')).toMatchObject({ participantId: 'p2' });
  });

  it('ne produit que la synthèse en mode synthesisOnly', async () => {
    const events = await collect(
      request({ produceSynthesis: true, synthesisOnly: true, history: [] })
    );
    expect(events.some((e) => e.type === 'turn_start')).toBe(false);
    expect(events.some((e) => e.type === 'synthesis_end')).toBe(true);
  });
});

describe('runDebate — annulation et délai', () => {
  it('s\'interrompt sans émettre d\'erreur quand l\'utilisateur annule', async () => {
    const controller = new AbortController();
    const events: DebateEvent[] = [];

    for await (const event of runDebate(request(), controller.signal)) {
      events.push(event);
      if (event.type === 'turn_end' && event.turn === 1) controller.abort();
    }

    expect(events.some((e) => e.type === 'turn_error')).toBe(false);
    expect(events.some((e) => e.type === 'debate_end')).toBe(false);
    expect(turnsOf(events)).toHaveLength(1);
  });

  it('applique PROVIDER_TIMEOUT_MS à un appel qui ne rend jamais la main', async () => {
    process.env.PROVIDER_TIMEOUT_MS = '50';
    scriptedBehaviour.hangOnTurns.add(1);

    const events = await collect(request({ maxTurns: 1 }));
    const error = events.find((e) => e.type === 'turn_error');
    expect(error).toBeDefined();
    // Le message doit distinguer une expiration d'une panne quelconque.
    expect((error as { message: string }).message).toMatch(/délai dépassé/i);
  });
});
