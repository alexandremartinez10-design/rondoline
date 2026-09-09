'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DebateMode, ParticipantConfig, ProviderId } from '@/lib/types';
import { DEFAULT_LIMITS, PROVIDERS, type AppLimits } from '@/lib/config/models';
import type { DebateConfig, ProviderStatus } from '@/hooks/useDebate';
import { ParticipantConfigCard } from './ParticipantConfigCard';

const MODE_INFO: Record<DebateMode, { label: string; description: string }> = {
  debate: {
    label: 'Débat',
    description: 'Chaque IA critique la réponse précédente avant de proposer la sienne.',
  },
  collaboration: {
    label: 'Collaboration',
    description: 'Les IA construisent ensemble, progressivement, la meilleure réponse.',
  },
  devil: {
    label: "Avocat du diable",
    description: "Une IA propose, l'autre cherche activement les failles.",
  },
  expert: {
    label: 'Panel d\'experts',
    description: 'Chaque IA reçoit un rôle/angle différent sur le sujet.',
  },
};

/**
 * Crée un participant par défaut. `available` = providers réellement utilisables
 * côté serveur : on préfère toujours proposer quelque chose qui fonctionne
 * plutôt qu'un participant condamné à échouer faute de clé API.
 */
function makeParticipant(idx: number, available: ProviderId[]): ParticipantConfig {
  const pool = available.length > 0 ? available : (Object.keys(PROVIDERS) as ProviderId[]);
  const provider = pool[idx % pool.length]!;
  const meta = PROVIDERS[provider];
  return {
    id: `p-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    displayName:
      pool.length === 1 && provider === 'demo'
        ? `${meta.defaultDisplayName} ${idx + 1}`
        : meta.defaultDisplayName,
    provider,
    model: meta.suggestedModels[idx % meta.suggestedModels.length] ?? '',
    color: meta.defaultColor,
  };
}

interface ConfigPanelProps {
  providers: ProviderStatus[];
  /** Limites effectives fournies par le serveur (jamais lues depuis process.env ici). */
  limits: AppLimits;
  disabled: boolean;
  onLaunch: (config: DebateConfig) => void;
  initialConfig: DebateConfig | null;
}

export function ConfigPanel({
  providers,
  limits,
  disabled,
  onLaunch,
  initialConfig,
}: ConfigPanelProps) {
  const [topic, setTopic] = useState(initialConfig?.topic ?? '');
  const [mode, setMode] = useState<DebateMode>(initialConfig?.mode ?? 'debate');
  const [maxTurns, setMaxTurns] = useState(initialConfig?.maxTurns ?? 6);

  // Les limites arrivent après le premier rendu : on ramène la valeur dans les
  // bornes du serveur plutôt que de laisser le formulaire proposer un nombre
  // de tours qui sera refusé en 400.
  useEffect(() => {
    setMaxTurns((prev) => Math.min(Math.max(prev, limits.minTurns), limits.maxTurns));
  }, [limits.minTurns, limits.maxTurns]);
  const [participants, setParticipants] = useState<ParticipantConfig[]>(
    initialConfig?.participants ?? [makeParticipant(0, []), makeParticipant(1, [])]
  );
  // Vrai une fois que l'utilisateur a touché à la sélection : on cesse alors
  // d'appliquer les valeurs par défaut venues du serveur.
  const [participantsTouched, setParticipantsTouched] = useState(Boolean(initialConfig));
  const [produceSynthesis, setProduceSynthesis] = useState(
    initialConfig?.produceSynthesis ?? true
  );
  const [synthesizerId, setSynthesizerId] = useState(
    initialConfig?.synthesizerId ?? participants[0]?.id
  );

  const availableProviders = useMemo(
    () => providers.filter((p) => p.configured).map((p) => p.id as ProviderId),
    [providers]
  );

  // Quand le serveur a répondu, on aligne les participants par défaut sur ce
  // qui est réellement disponible (et sur les modèles par défaut configurés en
  // variables d'env). Sans clé, cela sélectionne le provider de démonstration
  // pour que l'application soit utilisable immédiatement.
  useEffect(() => {
    if (participantsTouched || availableProviders.length === 0) return;
    setParticipants((prev) =>
      prev.map((p, idx) => {
        if (availableProviders.includes(p.provider)) {
          const defaultModel = providers.find((s) => s.id === p.provider)?.defaultModel;
          return defaultModel ? { ...p, model: defaultModel } : p;
        }
        return makeParticipant(idx, availableProviders);
      })
    );
  }, [availableProviders, providers, participantsTouched]);

  function updateParticipant(idx: number, next: ParticipantConfig) {
    setParticipantsTouched(true);
    setParticipants((prev) => prev.map((p, i) => (i === idx ? next : p)));
  }

  function addParticipant() {
    if (participants.length >= limits.maxParticipants) return;
    setParticipantsTouched(true);
    setParticipants((prev) => [...prev, makeParticipant(prev.length, availableProviders)]);
  }

  function removeParticipant(idx: number) {
    if (participants.length <= limits.minParticipants) return;
    setParticipantsTouched(true);
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
  }

  const onlyDemoAvailable =
    availableProviders.length === 1 && availableProviders[0] === 'demo';

  const canLaunch = topic.trim().length > 0 && participants.length >= limits.minParticipants;

  function handleLaunch() {
    if (!canLaunch) return;
    onLaunch({
      topic: topic.trim(),
      mode,
      maxTurns,
      participants,
      produceSynthesis,
      synthesizerId: synthesizerId ?? participants[0]?.id,
    });
  }

  return (
    <div className="config-panel">
      {onlyDemoAvailable && (
        <div className="demo-banner">
          <strong>Mode démonstration</strong>
          <p>
            Aucune clé API n&apos;est configurée. Le débat sera joué par un provider local
            qui n&apos;appelle aucune API : le parcours complet est fonctionnel, mais les
            arguments sont générés à partir de gabarits et n&apos;ont aucune valeur
            d&apos;analyse. Renseignez une clé dans <code>.env.local</code> pour un débat réel.
          </p>
        </div>
      )}

      <div className="config-panel__section">
        <label className="label" htmlFor="topic">
          Sujet / question
        </label>
        <textarea
          id="topic"
          className="input input--textarea"
          rows={4}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Ex : Quelle est la meilleure stratégie pour lancer cette startup ?"
          maxLength={limits.maxTopicLength}
          disabled={disabled}
        />
      </div>

      <div className="config-panel__section">
        <label className="label" htmlFor="mode">
          Mode
        </label>
        <select
          id="mode"
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value as DebateMode)}
          disabled={disabled}
        >
          {Object.entries(MODE_INFO).map(([key, info]) => (
            <option key={key} value={key}>
              {info.label}
            </option>
          ))}
        </select>
        <p className="hint">{MODE_INFO[mode].description}</p>
      </div>

      <div className="config-panel__section config-panel__row">
        <div>
          <label className="label" htmlFor="turns">
            Nombre de tours
          </label>
          <input
            id="turns"
            type="number"
            className="input input--number"
            min={limits.minTurns}
            max={limits.maxTurns}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={produceSynthesis}
            onChange={(e) => setProduceSynthesis(e.target.checked)}
            disabled={disabled}
          />
          Synthèse finale
        </label>
      </div>

      {produceSynthesis && (
        <div className="config-panel__section">
          <label className="label" htmlFor="synthesizer">
            IA chargée de la synthèse
          </label>
          <select
            id="synthesizer"
            className="input"
            value={synthesizerId}
            onChange={(e) => setSynthesizerId(e.target.value)}
            disabled={disabled}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="config-panel__section">
        <div className="config-panel__section-header">
          <span className="label">Participants</span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={addParticipant}
            disabled={disabled || participants.length >= limits.maxParticipants}
          >
            + Ajouter
          </button>
        </div>
        {participants.map((p, idx) => (
          <ParticipantConfigCard
            key={p.id}
            participant={p}
            index={idx}
            mode={mode}
            providers={providers}
            onChange={(next) => updateParticipant(idx, next)}
            onRemove={() => removeParticipant(idx)}
            removable={participants.length > limits.minParticipants}
          />
        ))}
      </div>

      <button
        type="button"
        className="btn btn--primary btn--launch"
        onClick={handleLaunch}
        disabled={disabled || !canLaunch}
      >
        Lancer le débat
      </button>
      {!canLaunch && (
        <p className="hint hint--center">
          Saisissez un sujet et gardez au moins {limits.minParticipants} participants.
        </p>
      )}
    </div>
  );
}
