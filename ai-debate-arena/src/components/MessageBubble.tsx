'use client';

import type { ParticipantConfig } from '@/lib/types';
import { Markdown } from './Markdown';

interface MessageBubbleProps {
  turn: number;
  displayName: string;
  color: string;
  content: string;
  isStreaming?: boolean;
  isSynthesis?: boolean;
  isError?: boolean;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export function MessageBubble({
  turn,
  displayName,
  color,
  content,
  isStreaming,
  isSynthesis,
  isError,
  durationMs,
  usage,
}: MessageBubbleProps) {
  return (
    <article
      className={`bubble${isSynthesis ? ' bubble--synthesis' : ''}${isError ? ' bubble--error' : ''}`}
      style={{ '--participant-color': color } as React.CSSProperties}
    >
      <header className="bubble__header">
        <span className="bubble__avatar" aria-hidden="true">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="bubble__name">{displayName}</span>
        {!isSynthesis && <span className="bubble__turn">tour {turn}</span>}
        {isStreaming && <span className="bubble__live">en train d&apos;écrire…</span>}
        {typeof durationMs === 'number' && (
          <span className="bubble__meta">{(durationMs / 1000).toFixed(1)}s</span>
        )}
        {usage?.outputTokens && (
          <span className="bubble__meta">{usage.outputTokens} tokens</span>
        )}
      </header>
      <div className="bubble__content">
        <Markdown text={content} />
        {isStreaming && <span className="bubble__cursor" aria-hidden="true" />}
      </div>
    </article>
  );
}

export function participantColor(participants: ParticipantConfig[], id: string): string {
  return participants.find((p) => p.id === id)?.color || '#888888';
}
