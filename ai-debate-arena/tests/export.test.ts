import { describe, expect, it } from 'vitest';
import { toJSON, toMarkdown } from '@/lib/utils/export';
import type { DebateMessage, ParticipantConfig } from '@/lib/types';

const participants: ParticipantConfig[] = [
  { id: 'p1', displayName: 'Alpha', provider: 'anthropic', model: 'modele-a', color: '#111111' },
  { id: 'p2', displayName: 'Beta', provider: 'google', model: 'modele-b', color: '#222222' },
];

const history: DebateMessage[] = [
  {
    id: 'm1',
    turn: 1,
    participantId: 'p1',
    role: 'participant',
    content: 'Premier argument.',
    startedAt: 1_000,
    finishedAt: 3_500,
  },
  {
    id: 'm2',
    turn: 2,
    participantId: 'p2',
    role: 'participant',
    content: 'Contre-argument.',
    startedAt: 4_000,
    finishedAt: 6_000,
  },
];

const synthesis: DebateMessage = {
  id: 'synthesis',
  turn: -1,
  participantId: 'synthesis',
  role: 'synthesis',
  content: '## Points d\'accord\nUn accord.',
  startedAt: 7_000,
  finishedAt: 8_000,
};

describe('toMarkdown', () => {
  it('reprend le sujet, le mode et les participants en en-tête', () => {
    const md = toMarkdown('Un sujet', 'debate', participants, history);
    expect(md).toContain('# Débat IA : Un sujet');
    expect(md).toContain('**Mode :** debate');
    expect(md).toContain('Alpha (anthropic/modele-a)');
    expect(md).toContain('Beta (google/modele-b)');
  });

  it('titre chaque tour avec son numéro et le nom de l\'intervenant', () => {
    const md = toMarkdown('Un sujet', 'debate', participants, history);
    expect(md).toContain('## Tour 1 — Alpha');
    expect(md).toContain('## Tour 2 — Beta');
  });

  it('indique le temps de réponse', () => {
    expect(toMarkdown('Un sujet', 'debate', participants, history)).toContain('2.5s');
  });

  it('inclut la synthèse quand elle est fournie dans les messages', () => {
    // Régression : la synthèse vit dans un état séparé de l'historique et
    // était absente de tous les exports.
    const md = toMarkdown('Un sujet', 'debate', participants, [...history, synthesis]);
    expect(md).toContain('## Synthèse finale');
    expect(md).toContain('Un accord.');
  });

  it('se rabat sur l\'identifiant si le participant est introuvable', () => {
    const orphan = { ...history[0]!, participantId: 'disparu' };
    expect(toMarkdown('Un sujet', 'debate', participants, [orphan])).toContain('disparu');
  });
});

describe('toJSON', () => {
  it('produit un JSON valide contenant les métadonnées et l\'historique', () => {
    const parsed = JSON.parse(
      toJSON({ topic: 'Un sujet', mode: 'debate', participants }, history)
    );
    expect(parsed.topic).toBe('Un sujet');
    expect(parsed.mode).toBe('debate');
    expect(parsed.participants).toHaveLength(2);
    expect(parsed.history).toHaveLength(2);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('inclut la synthèse quand elle est fournie', () => {
    const parsed = JSON.parse(
      toJSON({ topic: 'Un sujet', mode: 'debate', participants }, [...history, synthesis])
    );
    expect(parsed.history.some((m: DebateMessage) => m.role === 'synthesis')).toBe(true);
  });
});
