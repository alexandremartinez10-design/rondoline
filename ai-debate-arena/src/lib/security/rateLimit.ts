/**
 * Limiteur de débit sur une fenêtre glissante, par IP.
 *
 * Objectif : empêcher qu'une instance déployée publiquement ne laisse
 * n'importe quel visiteur consommer le quota API de l'hébergeur. Un débat de
 * 20 tours représente un coût réel ; sans garde-fou, la route est une facture
 * ouverte.
 *
 * Le stockage est extrait derrière `RateLimitStore` parce que le choix par
 * défaut — la mémoire du process — ne protège quasiment rien en déploiement
 * serverless : chaque instance froide repart d'un compteur vide, et la
 * plateforme en démarre autant que nécessaire. Voir `setRateLimitStore()` pour
 * brancher un store partagé en production.
 */

export interface RateLimitConfig {
  /** Nombre maximum de débats lancés par fenêtre. */
  max: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Secondes à attendre avant de réessayer (0 si autorisé). */
  retryAfterSeconds: number;
}

export interface StoreResult {
  /** Tentatives valides dans la fenêtre, après application de cette requête. */
  count: number;
  /** Horodatage de la plus ancienne tentative encore valide. */
  oldest: number;
  /** Faux si la limite était déjà atteinte : la tentative n'a pas été retenue. */
  recorded: boolean;
}

/**
 * Contrat minimal d'un stockage de compteurs.
 *
 * `hit` enregistre une tentative pour `key` — mais SEULEMENT si la limite
 * n'est pas déjà atteinte. Compter les tentatives refusées transformerait la
 * fenêtre glissante en peine plancher : un client qui martèle la route ne
 * verrait jamais son compteur redescendre, puisque chaque refus repousserait
 * lui-même l'échéance.
 *
 * La décision appartient donc au store, et non à l'appelant : c'est la seule
 * façon pour une implémentation partagée (Redis…) de rendre l'ensemble
 * lecture-décision-écriture atomique.
 */
export interface RateLimitStore {
  hit(key: string, now: number, config: RateLimitConfig): StoreResult | Promise<StoreResult>;
  reset(): void | Promise<void>;
}

/**
 * Store par défaut : en mémoire du process.
 *
 * Convient au développement local et à un déploiement mono-instance à état
 * durable. En serverless, il ne constitue PAS une protection sérieuse.
 */
export function createMemoryStore(): RateLimitStore {
  const buckets = new Map<string, number[]>();

  return {
    hit(key, now, config) {
      const cutoff = now - config.windowMs;
      const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

      const recorded = hits.length < config.max;
      if (recorded) hits.push(now);
      buckets.set(key, hits);

      // Purge opportuniste : évite que la Map ne grossisse indéfiniment sur
      // une instance longue durée voyant passer beaucoup d'IP distinctes.
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) {
          if (v.every((t) => t <= cutoff)) buckets.delete(k);
        }
      }

      return { count: hits.length, oldest: hits[0] ?? now, recorded };
    },
    reset() {
      buckets.clear();
    },
  };
}

let store: RateLimitStore = createMemoryStore();

/**
 * Remplace le stockage des compteurs — à appeler au démarrage.
 *
 * En production serverless, branchez ici un store partagé (Redis, Upstash…)
 * dont `hit` est atomique : purger la fenêtre, compter, puis n'ajouter la
 * tentative que si la limite n'est pas atteinte, le tout dans une même
 * transaction (ZREMRANGEBYSCORE + ZCARD + ZADD conditionnel, ou un script
 * Lua). Sans atomicité, deux requêtes simultanées peuvent passer ensemble.
 */
export function setRateLimitStore(next: RateLimitStore) {
  store = next;
}

export function getRateLimitConfig(): RateLimitConfig {
  const max = Number(process.env.RATE_LIMIT_MAX);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 60_000,
  };
}

export async function checkRateLimit(
  key: string,
  config = getRateLimitConfig()
): Promise<RateLimitResult> {
  const now = Date.now();
  const { count, oldest, recorded } = await store.hit(key, now, config);

  if (!recorded) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)),
    };
  }

  return { allowed: true, remaining: Math.max(0, config.max - count), retryAfterSeconds: 0 };
}

/** Extrait une clé d'identification depuis les en-têtes de la requête. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') || 'unknown';
}

/** Réinitialise l'état — utilisé par les tests. */
export async function resetRateLimit() {
  await store.reset();
}
