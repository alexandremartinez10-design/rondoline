'use client';

import type { DebateMode, ParticipantConfig, ProviderId } from '@/lib/types';
import { PROVIDERS } from '@/lib/config/models';
import type { ProviderStatus } from '@/hooks/useDebate';

interface ParticipantConfigCardProps {
  participant: ParticipantConfig;
  index: number;
  mode: DebateMode;
  providers: ProviderStatus[];
  onChange: (next: ParticipantConfig) => void;
  onRemove: () => void;
  removable: boolean;
}

export function ParticipantConfigCard({
  participant,
  index,
  mode,
  providers,
  onChange,
  onRemove,
  removable,
}: ParticipantConfigCardProps) {
  const configuredIds = new Set(providers.filter((p) => p.configured).map((p) => p.id));
  const providerId = participant.provider;
  const isConfigured = configuredIds.size === 0 || configuredIds.has(providerId);

  function set<K extends keyof ParticipantConfig>(key: K, value: ParticipantConfig[K]) {
    onChange({ ...participant, [key]: value });
  }

  function setProvider(next: ProviderId) {
    onChange({
      ...participant,
      provider: next,
      model: PROVIDERS[next].suggestedModels[0] ?? '',
      color: PROVIDERS[next].defaultColor,
    });
  }

  return (
    <div className="participant-card">
      <div className="participant-card__row">
        <span
          className="participant-card__swatch"
          style={{ background: participant.color }}
          aria-hidden="true"
        />
        <input
          className="input input--name"
          value={participant.displayName}
          onChange={(e) => set('displayName', e.target.value)}
          aria-label={`Nom du participant ${index + 1}`}
          maxLength={40}
        />
        <input
          type="color"
          className="color-input"
          value={participant.color}
          onChange={(e) => set('color', e.target.value)}
          aria-label={`Couleur du participant ${index + 1}`}
        />
        {removable && (
          <button
            type="button"
            className="icon-btn"
            onClick={onRemove}
            aria-label="Retirer ce participant"
            title="Retirer"
          >
            ✕
          </button>
        )}
      </div>

      <div className="participant-card__row">
        <select
          className="input"
          value={providerId}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {providers.length > 0 && !configuredIds.has(p.id) ? ' (non configuré)' : ''}
            </option>
          ))}
        </select>

        <input
          className="input"
          list={`models-${providerId}`}
          value={participant.model}
          onChange={(e) => set('model', e.target.value)}
          placeholder="nom du modèle"
          aria-label={`Modèle pour ${participant.displayName}`}
        />
        <datalist id={`models-${providerId}`}>
          {PROVIDERS[providerId].suggestedModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {!isConfigured && (
        <p className="participant-card__warning">
          ⚠ Clé {PROVIDERS[providerId].apiKeyEnvVar} absente côté serveur — ce participant échouera.
        </p>
      )}

      {(mode === 'expert' || mode === 'devil') && (
        <input
          className="input"
          value={participant.role || ''}
          onChange={(e) => set('role', e.target.value)}
          placeholder={
            mode === 'expert' ? 'Rôle (ex : économiste, juriste, ingénieur…)' : 'proposeur ou critique'
          }
        />
      )}

      <textarea
        className="input input--textarea"
        value={participant.customInstructions || ''}
        onChange={(e) => set('customInstructions', e.target.value)}
        placeholder="Instructions supplémentaires pour ce participant (optionnel)"
        rows={2}
        maxLength={1000}
      />
    </div>
  );
}
