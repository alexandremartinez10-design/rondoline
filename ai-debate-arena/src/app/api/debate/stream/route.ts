import { NextRequest } from 'next/server';
import { runDebate } from '@/lib/debate/DebateEngine';
import { validateDebateRequest, ValidationError } from '@/lib/security/sanitize';
import { encodeSSE } from '@/lib/utils/sse';
import { getServerLimits } from '@/lib/config/models';
import { checkRateLimit, clientKey } from '@/lib/security/rateLimit';

// Le SDK Anthropic/OpenAI/Google fonctionnent tous très bien côté Node.js.
// On force explicitement ce runtime (plutôt que "edge") et on désactive le
// cache : chaque débat est une conversation vivante, jamais une réponse figée.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Garde-fou anti-abus : un débat coûte de l'argent (tokens facturés).
  // Sans cela, une instance publique laisse n'importe qui vider le quota.
  const rate = checkRateLimit(clientKey(request.headers));
  if (!rate.allowed) {
    return jsonError(
      `Trop de débats lancés depuis cette adresse. Réessayez dans ${rate.retryAfterSeconds} secondes.`,
      429,
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Corps de requête JSON invalide.', 400);
  }

  let debateRequest;
  try {
    debateRequest = validateDebateRequest(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonError(err.message, 400);
    }
    return jsonError('Requête invalide.', 400);
  }

  const encoder = new TextEncoder();

  // Le signal d'abandon du fetch côté client (bouton Pause/Arrêter, ou
  // simple fermeture de l'onglet) doit interrompre proprement le moteur de
  // débat, y compris au milieu d'un appel provider en cours.
  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => abortController.abort());

  // Filet de sécurité supplémentaire : timeout global généreux pour éviter
  // qu'un débat ne tourne indéfiniment en cas de comportement inattendu d'un
  // provider (au-delà des timeouts par appel déjà géré par chaque provider).
  const limits = getServerLimits();
  const globalTimeoutMs = limits.providerTimeoutMs * (debateRequest.maxTurns + 2);
  const timeoutId = setTimeout(() => abortController.abort(), globalTimeoutMs);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runDebate(debateRequest, abortController.signal)) {
          controller.enqueue(encoder.encode(encodeSSE(event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur interne inattendue.';
        try {
          controller.enqueue(encoder.encode(encodeSSE({ type: 'fatal_error', message })));
        } catch {
          // le contrôleur peut déjà être fermé si le client s'est déconnecté
        }
      } finally {
        clearTimeout(timeoutId);
        try {
          controller.close();
        } catch {
          // déjà fermé (ex: client déconnecté) — rien à faire
        }
      }
    },
    cancel() {
      abortController.abort();
      clearTimeout(timeoutId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// GET utilitaire : indique quels providers sont configurés côté serveur,
// pour que l'UI puisse désactiver/avertir sur les participants sans clé.
export async function GET() {
  const { providerFactory } = await import('@/lib/providers/ProviderFactory');
  const { PROVIDERS, getDefaultModelForProvider } = await import('@/lib/config/models');
  const status = Object.values(PROVIDERS).map((meta) => ({
    id: meta.id,
    label: meta.label,
    configured: providerFactory.isConfigured(meta.id),
    // Modèle par défaut effectif (surchargé par variable d'env côté serveur) :
    // c'est ainsi que ANTHROPIC_DEFAULT_MODEL & co. atteignent l'UI.
    defaultModel: getDefaultModelForProvider(meta.id),
  }));
  // Les limites sont calculées côté serveur puis transmises au client : l'UI
  // ne peut pas lire process.env, et doit refléter les mêmes bornes que la
  // validation, sans quoi le formulaire accepte ce que le serveur refuse.
  return new Response(JSON.stringify({ providers: status, limits: getServerLimits() }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
