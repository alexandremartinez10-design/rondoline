/**
 * Limiteur de débit en mémoire, par IP, sur une fenêtre glissante.
 *
 * Objectif : empêcher qu'une instance déployée publiquement ne laisse
 * n'importe quel visiteur consommer le quota API de l'hébergeur. Un débat de
 * 20 tours peut représenter un coût non négligeable ; sans garde-fou, la
 * route est une facture ouverte.
 *
 * LIMITE CONNUE : l'état vit dans la mémoire du process. En déploiement
 * multi-instance (serverless notamment), chaque instance compte séparément.
 * Pour une protection réelle en production, adossez ce module à un store
 * partagé (Redis, Upstash…) ou au rate limiting de la plateforme.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  /** Nombre maximum de débats lancés par fenêtre. */
  max: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
}

export function getRateLimitConfig(): RateLimitConfig {
  const max = Number(process.env.RATE_LIMIT_MAX);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 60_000,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Secondes à attendre avant de réessayer (uniquement si refusé). */
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, config = getRateLimitConfig()): RateLimitResult {
  const now = Date.now();
  const cutoff = now - config.windowMs;

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= config.max) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Purge opportuniste : évite que la Map ne grossisse indéfiniment sur une
  // instance longue durée recevant beaucoup d'IP distinctes.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }

  return { allowed: true, remaining: config.max - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Extrait une clé d'identification depuis les en-têtes de la requête. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') || 'unknown';
}

/** Réinitialise l'état — utilisé par les tests. */
export function resetRateLimit() {
  buckets.clear();
}
