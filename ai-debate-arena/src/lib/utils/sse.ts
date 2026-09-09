import type { DebateEvent } from '@/lib/types';

/** Encode un évènement en trame SSE (`data: {...}\n\n`). */
export function encodeSSE(event: DebateEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
