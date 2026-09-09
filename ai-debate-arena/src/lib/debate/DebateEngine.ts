import { providerFactory } from '@/lib/providers/ProviderFactory';
import { getServerLimits } from '@/lib/config/models';
import {
  ProviderNotConfiguredError,
  ProviderRequestError,
  type DebateEvent,
  type DebateMessage,
  type DebateRequest,
  type ParticipantConfig,
} from '@/lib/types';
import { buildConversationContext, buildSynthesisPrompt, buildSystemPrompt } from './prompts';

/**
 * Génère la suite d'évènements d'un débat, tour par tour. C'est un async
 * generator : le consommateur (la route API) itère dessus et transforme
 * chaque évènement en trame SSE. L'exécution s'arrête proprement si
 * `signal` est déclenché (bouton "Arrêter"/"Pause" côté client, qui
 * annule le fetch).
 */
export async function* runDebate(
  request: DebateRequest,
  signal: AbortSignal
): AsyncGenerator<DebateEvent> {
  const { topic, mode, participants, maxTurns, produceSynthesis, synthesisOnly } = request;
  const limits = getServerLimits();
  const totalTurns = Math.min(maxTurns, limits.maxTurns);
  const history: DebateMessage[] = [...(request.history ?? [])];
  const participantsById = new Map<string, ParticipantConfig>(participants.map((p) => [p.id, p]));

  // Vérifie en amont que tous les providers utilisés sont bien configurés,
  // pour donner une erreur claire avant de commencer plutôt qu'en plein débat.
  const misconfigured = participants.filter((p) => !providerFactory.isConfigured(p.provider));
  if (misconfigured.length === participants.length) {
    yield {
      type: 'fatal_error',
      message:
        "Aucun des providers sélectionnés n'est configuré. Vérifiez vos clés API dans .env.local.",
    };
    return;
  }

  // Le client fournit `startTurn` lors d'une reprise. Il le calcule à partir des
  // tours réussis ET des tours en échec : sans cela, un tour échoué (absent de
  // l'historique) serait rejoué et décalerait la rotation des participants.
  const completedTurns = history.filter((m) => m.role === 'participant').length;
  const firstTurn = request.startTurn ?? completedTurns + 1;

  if (!synthesisOnly) {
    yield { type: 'debate_start', totalTurns };

    for (let turn = firstTurn; turn <= totalTurns; turn++) {
      if (signal.aborted) return;

      const participant = participants[(turn - 1) % participants.length]!;
      const others = participants.filter((p) => p.id !== participant.id);

      yield {
        type: 'turn_start',
        turn,
        participantId: participant.id,
        displayName: participant.displayName,
      };

      if (!providerFactory.isConfigured(participant.provider)) {
        yield {
          type: 'turn_error',
          turn,
          participantId: participant.id,
          message: `Provider "${participant.provider}" non configuré (clé API manquante). Ce tour est ignoré.`,
        };
        continue;
      }

      const systemPrompt = buildSystemPrompt({
        topic,
        mode,
        self: participant,
        others,
        turn,
        totalTurns,
      });
      const userContext = buildConversationContext(history, participantsById);

      const startedAt = Date.now();
      let content = '';

      // Timeout PAR APPEL, en plus du filet de sécurité global de la route.
      // Le signal combiné se déclenche soit sur l'action utilisateur
      // (pause/arrêt), soit sur l'expiration du délai de ce tour.
      const turnTimeout = withTimeout(signal, limits.providerTimeoutMs);

      try {
        const provider = providerFactory.get(participant.provider);
        const gen = provider.streamMessage(
          [{ role: 'user', content: userContext }],
          systemPrompt,
          { model: participant.model, signal: turnTimeout.signal }
        );

        let result: { content: string; usage?: DebateMessage['usage'] } | undefined;
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            result = value;
            break;
          }
          content += value.delta;
          yield { type: 'token', turn, participantId: participant.id, delta: value.delta };
        }

        const durationMs = Date.now() - startedAt;
        const message: DebateMessage = {
          id: `${participant.id}-turn-${turn}`,
          turn,
          participantId: participant.id,
          role: 'participant',
          content: result?.content ?? content,
          startedAt,
          finishedAt: Date.now(),
          usage: result?.usage,
        };
        history.push(message);

        yield {
          type: 'turn_end',
          turn,
          participantId: participant.id,
          content: message.content,
          usage: message.usage,
          durationMs,
        };
      } catch (err) {
        // Arrêt demandé par l'utilisateur : on sort sans signaler d'erreur.
        if (signal.aborted) return;
        yield {
          type: 'turn_error',
          turn,
          participantId: participant.id,
          message: turnTimeout.timedOut
            ? `Délai dépassé (${Math.round(limits.providerTimeoutMs / 1000)}s) pour ce tour. Ce tour est ignoré.`
            : describeError(err),
        };
        // On continue le débat malgré l'échec d'un tour : un participant en
        // panne ne doit pas bloquer les autres.
      } finally {
        turnTimeout.dispose();
      }
    }

    yield { type: 'debate_end' };
  }

  if (produceSynthesis && !signal.aborted) {
    yield* runSynthesis(request, history, participantsById, signal);
  }
}

async function* runSynthesis(
  request: DebateRequest,
  history: DebateMessage[],
  participantsById: Map<string, ParticipantConfig>,
  signal: AbortSignal
): AsyncGenerator<DebateEvent> {
  const { topic, participants, synthesizerId } = request;
  const synthesizer =
    participants.find((p) => p.id === synthesizerId) ?? participants[0];

  if (!synthesizer) return;

  if (!providerFactory.isConfigured(synthesizer.provider)) {
    yield {
      type: 'turn_error',
      turn: -1,
      participantId: synthesizer.id,
      message: `Impossible de générer la synthèse : provider "${synthesizer.provider}" non configuré.`,
    };
    return;
  }

  yield { type: 'synthesis_start', participantId: synthesizer.id };

  const systemPrompt = buildSynthesisPrompt(topic, participants);
  const userContext = buildConversationContext(history, participantsById);

  const limits = getServerLimits();
  const synthesisTimeout = withTimeout(signal, limits.providerTimeoutMs);

  let content = '';
  try {
    const provider = providerFactory.get(synthesizer.provider);
    const gen = provider.streamMessage([{ role: 'user', content: userContext }], systemPrompt, {
      model: synthesizer.model,
      signal: synthesisTimeout.signal,
      maxTokens: 3000,
    });

    let result: { content: string; usage?: DebateMessage['usage'] } | undefined;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      content += value.delta;
      yield { type: 'synthesis_token', delta: value.delta };
    }

    yield { type: 'synthesis_end', content: result?.content ?? content, usage: result?.usage };
  } catch (err) {
    if (signal.aborted) return;
    yield {
      type: 'turn_error',
      turn: -1,
      participantId: synthesizer.id,
      message: `Échec de la synthèse : ${
        synthesisTimeout.timedOut
          ? `délai dépassé (${Math.round(limits.providerTimeoutMs / 1000)}s).`
          : describeError(err)
      }`,
    };
  } finally {
    synthesisTimeout.dispose();
  }
}

/**
 * Combine le signal d'annulation utilisateur avec un délai maximum pour un
 * appel provider. `timedOut` permet à l'appelant de distinguer une expiration
 * de délai d'une annulation volontaire, afin d'afficher le bon message.
 */
function withTimeout(
  userSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; timedOut: boolean; dispose: () => void } {
  const controller = new AbortController();
  const state = {
    signal: controller.signal,
    timedOut: false,
    dispose: () => {
      clearTimeout(timer);
      userSignal.removeEventListener('abort', onUserAbort);
    },
  };

  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);

  function onUserAbort() {
    controller.abort();
  }

  if (userSignal.aborted) onUserAbort();
  else userSignal.addEventListener('abort', onUserAbort, { once: true });

  return state;
}

function describeError(err: unknown): string {
  if (err instanceof ProviderNotConfiguredError) return err.message;
  if (err instanceof ProviderRequestError) return err.message;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Requête annulée.';
    return err.message;
  }
  return 'Erreur inconnue.';
}
