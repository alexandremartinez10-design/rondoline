'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DebateEvent,
  DebateMessage,
  DebateMode,
  DebateRequest,
  ParticipantConfig,
} from '@/lib/types';
import { loadSession, saveSession, clearSession } from '@/lib/store/localStorage';
import { DEFAULT_LIMITS, type AppLimits } from '@/lib/config/models';

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Modèle par défaut effectif côté serveur (peut venir d'une variable d'env). */
  defaultModel?: string;
}

export interface TurnError {
  turn: number;
  participantId: string;
  message: string;
}

export interface LiveTurn {
  turn: number;
  participantId: string;
  displayName: string;
  partialContent: string;
  startedAt: number;
}

export interface DebateConfig {
  topic: string;
  mode: DebateMode;
  maxTurns: number;
  participants: ParticipantConfig[];
  synthesizerId?: string;
  produceSynthesis: boolean;
}

type Status = 'idle' | 'running' | 'paused' | 'finished' | 'error';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export function useDebate() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  // Limites effectives, fournies par le serveur (le client ne peut pas lire
  // process.env). On part des valeurs par défaut le temps du chargement.
  const [limits, setLimits] = useState<AppLimits>({ ...DEFAULT_LIMITS });
  const [config, setConfig] = useState<DebateConfig | null>(null);
  const [history, setHistory] = useState<DebateMessage[]>([]);
  const [synthesis, setSynthesis] = useState<DebateMessage | null>(null);
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null);
  const [liveSynthesis, setLiveSynthesis] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [turnErrors, setTurnErrors] = useState<TurnError[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  // Distingue un arrêt définitif ("Arrêter") d'une pause : les deux annulent
  // le même fetch, seul ce drapeau permet de savoir dans quel état retomber.
  const stopRequestedRef = useRef(false);
  const configRef = useRef<DebateConfig | null>(null);
  configRef.current = config;

  // Charge le statut des providers et les limites effectives côté serveur.
  useEffect(() => {
    fetch('/api/debate/stream')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers ?? []);
        if (data.limits) setLimits({ ...DEFAULT_LIMITS, ...data.limits });
      })
      .catch(() => setProviders([]));
  }, []);

  // Restaure une session précédente depuis localStorage au montage.
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setConfig({
        topic: saved.topic,
        mode: saved.mode,
        maxTurns: saved.maxTurns,
        participants: saved.participants,
        synthesizerId: saved.synthesizerId,
        produceSynthesis: saved.produceSynthesis,
      });
      setHistory(saved.history);
      setSynthesis(saved.synthesis ?? null);
      if (saved.history.length > 0) setStatus('paused');
    }
  }, []);

  // Persiste à chaque changement significatif.
  useEffect(() => {
    if (!config) return;
    saveSession({
      ...config,
      history,
      synthesis: synthesis ?? undefined,
      updatedAt: Date.now(),
    });
  }, [config, history, synthesis]);

  const runStream = useCallback(
    async (payload: DebateRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;
      stopRequestedRef.current = false;
      setStatus('running');
      setError(null);

      try {
        const res = await fetch('/api/debate/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Erreur serveur (${res.status}).`);
        }
        if (!res.body) throw new Error('Le serveur n\'a pas renvoyé de flux.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            let event: DebateEvent;
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }
            handleEvent(event);
          }
        }

        setStatus((prev) => (prev === 'running' ? 'finished' : prev));
      } catch (err) {
        if (controller.signal.aborted) {
          // Le tour en cours a été interrompu : son texte partiel n'est pas
          // conservé côté serveur, on le retire de l'affichage pour ne pas
          // laisser une bulle orpheline qui serait dupliquée à la reprise.
          setLiveTurn(null);
          setLiveSynthesis(null);
          setStatus(stopRequestedRef.current ? 'finished' : 'paused');
          return;
        }
        const message = err instanceof Error ? err.message : 'Erreur réseau inattendue.';
        setError(message);
        setStatus('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleEvent(event: DebateEvent) {
    switch (event.type) {
      case 'debate_start':
        break;
      case 'turn_start': {
        setLiveTurn({
          turn: event.turn,
          participantId: event.participantId,
          displayName: event.displayName,
          partialContent: '',
          startedAt: Date.now(),
        });
        break;
      }
      case 'token': {
        setLiveTurn((prev) =>
          prev && prev.turn === event.turn
            ? { ...prev, partialContent: prev.partialContent + event.delta }
            : prev
        );
        break;
      }
      case 'turn_end': {
        setLiveTurn(null);
        // Un tour réussi efface une éventuelle erreur laissée par une tentative
        // précédente sur ce même numéro de tour.
        setTurnErrors((prev) => prev.filter((e) => e.turn !== event.turn));
        setHistory((prev) => [
          ...prev.filter((m) => m.turn !== event.turn),
          {
            id: `${event.participantId}-turn-${event.turn}`,
            turn: event.turn,
            participantId: event.participantId,
            role: 'participant',
            content: event.content,
            startedAt: Date.now() - event.durationMs,
            finishedAt: Date.now(),
            usage: event.usage,
          },
        ]);
        break;
      }
      case 'turn_error': {
        setLiveTurn(null);
        setTurnErrors((prev) => [
          // Une reprise peut rejouer un tour : on remplace l'erreur précédente
          // du même tour plutôt que d'empiler des doublons.
          ...prev.filter((e) => e.turn !== event.turn),
          { turn: event.turn, participantId: event.participantId, message: event.message },
        ]);
        break;
      }
      case 'synthesis_start':
        setLiveSynthesis('');
        break;
      case 'synthesis_token':
        setLiveSynthesis((prev) => (prev ?? '') + event.delta);
        break;
      case 'synthesis_end': {
        setLiveSynthesis(null);
        setSynthesis({
          id: 'synthesis',
          turn: -1,
          participantId: 'synthesis',
          role: 'synthesis',
          content: event.content,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          usage: event.usage,
        });
        break;
      }
      case 'debate_end':
        break;
      case 'fatal_error':
        setError(event.message);
        setStatus('error');
        break;
    }
  }

  const start = useCallback(
    (newConfig: DebateConfig) => {
      setConfig(newConfig);
      setHistory([]);
      setSynthesis(null);
      setTurnErrors([]);
      setLiveTurn(null);
      setLiveSynthesis(null);
      runStream({ ...newConfig, history: [], synthesisOnly: false, startTurn: 1 });
    },
    [runStream]
  );

  const resume = useCallback(() => {
    const current = configRef.current;
    if (!current) return;
    // Le prochain tour se déduit du plus grand numéro DÉJÀ TENTÉ, réussite ou
    // échec. Compter seulement les tours réussis rejouerait un tour en erreur
    // et décalerait la rotation des participants (tour N ↔ participant N % k).
    const attempted = [
      ...history.filter((m) => m.role === 'participant').map((m) => m.turn),
      ...turnErrors.filter((e) => e.turn > 0).map((e) => e.turn),
    ];
    const lastAttempted = attempted.length > 0 ? Math.max(...attempted) : 0;
    const synthesisOnly = lastAttempted >= current.maxTurns && !synthesis;
    runStream({ ...current, history, synthesisOnly, startTurn: lastAttempted + 1 });
  }, [history, runStream, synthesis, turnErrors]);

  const pause = useCallback(() => {
    stopRequestedRef.current = false;
    abortRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    // L'abort rejette la lecture du flux au microtask suivant : c'est ce
    // drapeau, et non un setStatus ici, qui décide de l'état final — sinon
    // le gestionnaire d'erreur repasserait aussitôt en "paused".
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    setStatus('finished');
  }, []);

  const newConversation = useCallback(() => {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
    clearSession();
    setConfig(null);
    setHistory([]);
    setSynthesis(null);
    setLiveTurn(null);
    setLiveSynthesis(null);
    setTurnErrors([]);
    setError(null);
    setStatus('idle');
  }, []);

  const updateTopic = useCallback((topic: string) => {
    setConfig((prev) => (prev ? { ...prev, topic } : prev));
  }, []);

  return {
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
    updateTopic,
  };
}

export { newId };
