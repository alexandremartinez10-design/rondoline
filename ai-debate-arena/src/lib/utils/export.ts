import type { DebateMessage, DebateRequest, ParticipantConfig } from '@/lib/types';

export function toMarkdown(
  topic: string,
  mode: string,
  participants: ParticipantConfig[],
  history: DebateMessage[]
): string {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const lines: string[] = [];

  lines.push(`# Débat IA : ${topic}`);
  lines.push('');
  lines.push(`**Mode :** ${mode}`);
  lines.push(
    `**Participants :** ${participants.map((p) => `${p.displayName} (${p.provider}/${p.model})`).join(', ')}`
  );
  lines.push(`**Date d'export :** ${new Date().toLocaleString('fr-FR')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of history) {
    if (msg.role === 'synthesis') {
      lines.push(`## Synthèse finale`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      continue;
    }
    const name = byId.get(msg.participantId)?.displayName || msg.participantId;
    lines.push(`## Tour ${msg.turn} — ${name}`);
    if (msg.finishedAt && msg.startedAt) {
      lines.push(`*Temps de réponse : ${((msg.finishedAt - msg.startedAt) / 1000).toFixed(1)}s*`);
    }
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

export function toJSON(request: Partial<DebateRequest>, history: DebateMessage[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      topic: request.topic,
      mode: request.mode,
      participants: request.participants,
      history,
    },
    null,
    2
  );
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
