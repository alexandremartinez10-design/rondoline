'use client';

import { useEffect, useRef } from 'react';
import type { DebateMessage, ParticipantConfig } from '@/lib/types';
import { MessageBubble, participantColor } from './MessageBubble';
import type { LiveTurn, TurnError } from '@/hooks/useDebate';

interface ConversationViewProps {
  topic: string;
  history: DebateMessage[];
  participants: ParticipantConfig[];
  liveTurn: LiveTurn | null;
  liveSynthesis: string | null;
  synthesis: DebateMessage | null;
  turnErrors: TurnError[];
}

export function ConversationView({
  topic,
  history,
  participants,
  liveTurn,
  liveSynthesis,
  synthesis,
  turnErrors,
}: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, liveTurn?.partialContent, liveSynthesis, synthesis]);

  const nameById = new Map(participants.map((p) => [p.id, p.displayName]));

  if (!topic && history.length === 0) {
    return (
      <div className="conversation conversation--empty">
        <div className="empty-state">
          <p className="empty-state__title">Aucun débat en cours</p>
          <p className="empty-state__hint">
            Configurez un sujet et des participants dans le panneau, puis lancez le débat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation">
      <div className="conversation__topic">
        <span className="conversation__topic-label">Sujet</span>
        <p>{topic}</p>
      </div>

      {history.map((msg) => {
        // Correspondance sur le tour ET le participant : deux participants
        // peuvent occuper le même numéro de tour après une reprise.
        const err = turnErrors.find(
          (e) => e.turn === msg.turn && e.participantId === msg.participantId
        );
        return (
          <MessageBubble
            key={msg.id}
            turn={msg.turn}
            displayName={nameById.get(msg.participantId) || msg.participantId}
            color={participantColor(participants, msg.participantId)}
            content={msg.content}
            durationMs={msg.finishedAt && msg.startedAt ? msg.finishedAt - msg.startedAt : undefined}
            usage={msg.usage}
            isError={Boolean(err)}
          />
        );
      })}

      {turnErrors
        .filter((e) => !history.some((m) => m.turn === e.turn))
        .map((e, i) => (
          <div key={`err-${e.turn}-${i}`} className="turn-error">
            <strong>{e.turn > 0 ? `Tour ${e.turn}` : 'Synthèse'} :</strong> {e.message}
          </div>
        ))}

      {liveTurn && (
        <MessageBubble
          turn={liveTurn.turn}
          displayName={liveTurn.displayName}
          color={participantColor(participants, liveTurn.participantId)}
          content={liveTurn.partialContent}
          isStreaming
        />
      )}

      {(liveSynthesis !== null || synthesis) && (
        <MessageBubble
          turn={-1}
          displayName="Synthèse finale"
          color="#c9a13b"
          content={synthesis ? synthesis.content : liveSynthesis || ''}
          isStreaming={liveSynthesis !== null && !synthesis}
          isSynthesis
          usage={synthesis?.usage}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
