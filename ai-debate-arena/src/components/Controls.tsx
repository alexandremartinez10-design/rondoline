'use client';

import type { DebateMessage, ParticipantConfig } from '@/lib/types';
import { toJSON, toMarkdown, downloadTextFile } from '@/lib/utils/export';

interface ControlsProps {
  status: 'idle' | 'running' | 'paused' | 'finished' | 'error';
  currentTurn: number;
  maxTurns: number;
  topic: string;
  mode: string;
  participants: ParticipantConfig[];
  history: DebateMessage[];
  /** Synthèse finale, stockée à part de l'historique — mais exportée avec lui. */
  synthesis: DebateMessage | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onNew: () => void;
}

const STATUS_LABEL: Record<ControlsProps['status'], string> = {
  idle: 'En attente',
  running: 'En cours',
  paused: 'En pause',
  finished: 'Terminé',
  error: 'Erreur',
};

export function Controls({
  status,
  currentTurn,
  maxTurns,
  topic,
  mode,
  participants,
  history,
  synthesis,
  onPause,
  onResume,
  onStop,
  onNew,
}: ControlsProps) {
  const hasContent = history.length > 0;

  // La synthèse vit dans un état séparé de l'historique : sans cette
  // concaténation, elle serait absente de tous les exports.
  const exportable = synthesis ? [...history, synthesis] : history;

  function exportMarkdown() {
    downloadTextFile(
      `debat-${Date.now()}.md`,
      toMarkdown(topic, mode, participants, exportable),
      'text/markdown'
    );
  }

  function exportJSON() {
    downloadTextFile(
      `debat-${Date.now()}.json`,
      toJSON({ topic, mode: mode as never, participants }, exportable),
      'application/json'
    );
  }

  return (
    <div className="controls">
      <div className="controls__status">
        <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
        <span className="controls__status-label">{STATUS_LABEL[status]}</span>
        {maxTurns > 0 && (
          <span className="controls__turn-counter">
            tour {Math.min(currentTurn, maxTurns)} / {maxTurns}
          </span>
        )}
      </div>

      <div className="controls__actions">
        {status === 'running' && (
          <button type="button" className="btn btn--secondary" onClick={onPause}>
            ⏸ Pause
          </button>
        )}
        {status === 'paused' && hasContent && (
          <button type="button" className="btn btn--primary" onClick={onResume}>
            ▶ Reprendre
          </button>
        )}
        {(status === 'running' || status === 'paused') && (
          <button type="button" className="btn btn--danger" onClick={onStop}>
            ■ Arrêter
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onNew}>
          Nouvelle conversation
        </button>
        {hasContent && (
          <div className="controls__export">
            <button type="button" className="btn btn--ghost btn--small" onClick={exportMarkdown}>
              Export .md
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={exportJSON}>
              Export .json
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
