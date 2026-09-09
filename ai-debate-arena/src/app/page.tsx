'use client';

import './app.css';
import { useDebate } from '@/hooks/useDebate';
import { ConfigPanel } from '@/components/ConfigPanel';
import { Controls } from '@/components/Controls';
import { ConversationView } from '@/components/ConversationView';

export default function Home() {
  const {
    providers,
    limits,
    config,
    history,
    synthesis,
    liveTurn,
    liveSynthesis,
    status,
    error,
    turnErrors,
    start,
    resume,
    pause,
    stop,
    newConversation,
  } = useDebate();

  const isSetupLocked = status === 'running' || status === 'paused' || status === 'finished';
  const currentTurn = liveTurn?.turn ?? history.filter((m) => m.role === 'participant').length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-header__title">
          AI Debate <span>Arena</span>
        </h1>
      </header>

      <Controls
        status={status}
        currentTurn={currentTurn}
        maxTurns={config?.maxTurns ?? 0}
        topic={config?.topic ?? ''}
        mode={config?.mode ?? 'debate'}
        participants={config?.participants ?? []}
        history={history}
        synthesis={synthesis}
        onPause={pause}
        onResume={resume}
        onStop={stop}
        onNew={newConversation}
      />

      <div className="app-body">
        <aside className="app-sidebar">
          <ConfigPanel
            providers={providers}
            limits={limits}
            disabled={isSetupLocked}
            onLaunch={start}
            initialConfig={config}
          />
        </aside>

        <main className="app-main">
          {error && (
            <div className="turn-error" style={{ margin: '1rem 1.25rem 0' }}>
              <strong>Erreur :</strong> {error}
            </div>
          )}
          <div className="app-main__conversation">
            <ConversationView
              topic={config?.topic ?? ''}
              history={history}
              participants={config?.participants ?? []}
              liveTurn={liveTurn}
              liveSynthesis={liveSynthesis}
              synthesis={synthesis}
              turnErrors={turnErrors}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
