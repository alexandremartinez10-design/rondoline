import { beforeAll, describe, expect, it } from 'vitest';
import { DemoProvider } from '@/lib/providers/DemoProvider';
import { buildSystemPrompt, buildSynthesisPrompt } from '@/lib/debate/prompts';
import type { ParticipantConfig, StreamChunk, StreamResult } from '@/lib/types';

beforeAll(() => {
  // Aucune attente entre les fragments : les tests ne doivent pas dépendre
  // de la temporisation de confort du mode démonstration.
  process.env.DEMO_TOKEN_DELAY_MS = '0';
});

const alpha: ParticipantConfig = {
  id: 'p1',
  displayName: 'Alpha',
  provider: 'demo',
  model: 'demo-orateur',
  color: '#111111',
};
const beta: ParticipantConfig = { ...alpha, id: 'p2', displayName: 'Beta' };

const TOPIC = 'Faut-il déployer le vendredi ?';

async function drain(gen: AsyncGenerator<StreamChunk, StreamResult, unknown>) {
  const deltas: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    deltas.push(next.value.delta);
    next = await gen.next();
  }
  return { deltas, result: next.value };
}

function systemPromptFor(turn: number, self = alpha) {
  return buildSystemPrompt({
    topic: TOPIC,
    mode: 'debate',
    self,
    others: [self.id === alpha.id ? beta : alpha],
    turn,
    totalTurns: 4,
  });
}

describe('DemoProvider', () => {
  it('est toujours considéré comme configuré', () => {
    expect(new DemoProvider().isConfigured()).toBe(true);
  });

  it('diffuse plusieurs fragments dont le cumul égale le contenu final', async () => {
    const { deltas, result } = await drain(
      new DemoProvider().streamMessage(
        [{ role: 'user', content: 'Aucun échange précédent.' }],
        systemPromptFor(1),
        { model: 'demo-orateur' }
      )
    );
    expect(deltas.length).toBeGreaterThan(10);
    expect(deltas.join('')).toBe(result.content);
  });

  it('indique explicitement qu\'aucun appel API n\'a eu lieu', async () => {
    const { result } = await drain(
      new DemoProvider().streamMessage([{ role: 'user', content: '' }], systemPromptFor(1), {
        model: 'demo-orateur',
      })
    );
    expect(result.content).toMatch(/aucun appel api/i);
  });

  it('reprend le sujet réel au premier tour', async () => {
    const { result } = await drain(
      new DemoProvider().streamMessage(
        [{ role: 'user', content: "Aucun échange précédent. C'est le premier tour" }],
        systemPromptFor(1),
        { model: 'demo-orateur' }
      )
    );
    expect(result.content).toContain('déployer le vendredi');
  });

  it('cite la thèse du tour précédent, sans imbriquer les citations', async () => {
    const previous =
      "[Tour 1 — Alpha]\nJe prends au sérieux la thèse de Beta — « une thèse antérieure » — mais elle saute une étape.\n\n**Ma position :** la contrainte dominante est la distribution.";

    const { result } = await drain(
      new DemoProvider().streamMessage([{ role: 'user', content: previous }], systemPromptFor(2, beta), {
        model: 'demo-analyste',
      })
    );

    const opening = result.content.split('\n')[0]!;
    expect(opening).toContain('la contrainte dominante est la distribution');
    // La citation que le tour précédent faisait lui-même ne doit pas être
    // reprise : sinon les guillemets s'imbriquent de tour en tour.
    expect(opening).not.toContain('une thèse antérieure');
    expect(opening.split('«').length - 1).toBe(1);
  });

  it('produit une synthèse structurée selon les sections demandées', async () => {
    const { result } = await drain(
      new DemoProvider().streamMessage(
        [{ role: 'user', content: '[Tour 1 — Alpha]\nUn argument.' }],
        buildSynthesisPrompt(TOPIC, [alpha, beta]),
        { model: 'demo-orateur' }
      )
    );
    for (const section of [
      "## Points d'accord",
      '## Points de désaccord',
      '## Arguments les plus solides',
      '## Faiblesses détectées',
      '## Conclusion et recommandation finale',
    ]) {
      expect(result.content).toContain(section);
    }
  });

  it('varie l\'angle d\'un tour à l\'autre', async () => {
    const contents: string[] = [];
    for (const turn of [1, 2, 3, 4]) {
      const { result } = await drain(
        new DemoProvider().streamMessage([{ role: 'user', content: '' }], systemPromptFor(turn), {
          model: 'demo-orateur',
        })
      );
      contents.push(result.content);
    }
    expect(new Set(contents).size).toBe(4);
  });

  it('s\'interrompt lorsque le signal est déclenché', async () => {
    process.env.DEMO_TOKEN_DELAY_MS = '5';
    const controller = new AbortController();
    const gen = new DemoProvider().streamMessage(
      [{ role: 'user', content: '' }],
      systemPromptFor(1),
      { model: 'demo-orateur', signal: controller.signal }
    );

    await gen.next();
    controller.abort();
    await expect(gen.next()).rejects.toThrow(/annulée/i);
    process.env.DEMO_TOKEN_DELAY_MS = '0';
  });
});
