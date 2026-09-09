import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  clientKey,
  createMemoryStore,
  resetRateLimit,
  setRateLimitStore,
  type RateLimitStore,
} from '@/lib/security/rateLimit';

const CONFIG = { max: 3, windowMs: 1000 };

beforeEach(async () => {
  setRateLimitStore(createMemoryStore());
  await resetRateLimit();
});

describe('checkRateLimit', () => {
  it('autorise jusqu\'à la limite puis refuse', async () => {
    for (let i = 0; i < CONFIG.max; i++) {
      expect((await checkRateLimit('ip-a', CONFIG)).allowed).toBe(true);
    }
    expect((await checkRateLimit('ip-a', CONFIG)).allowed).toBe(false);
  });

  it('décompte correctement les tentatives restantes', async () => {
    expect((await checkRateLimit('ip-a', CONFIG)).remaining).toBe(2);
    expect((await checkRateLimit('ip-a', CONFIG)).remaining).toBe(1);
    expect((await checkRateLimit('ip-a', CONFIG)).remaining).toBe(0);
  });

  it('compte chaque clé séparément', async () => {
    for (let i = 0; i < CONFIG.max; i++) await checkRateLimit('ip-a', CONFIG);
    expect((await checkRateLimit('ip-a', CONFIG)).allowed).toBe(false);
    // Une autre adresse ne doit pas hériter du blocage de la première.
    expect((await checkRateLimit('ip-b', CONFIG)).allowed).toBe(true);
  });

  it('indique un délai d\'attente strictement positif quand il refuse', async () => {
    for (let i = 0; i < CONFIG.max; i++) await checkRateLimit('ip-a', CONFIG);
    const refused = await checkRateLimit('ip-a', CONFIG);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(CONFIG.windowMs / 1000));
  });

  it('réautorise une fois la fenêtre écoulée', async () => {
    const window = { max: 2, windowMs: 60 };
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(true);
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(true);
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, window.windowMs + 30));
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(true);
  });

  it('ne compte pas les tentatives refusées, sinon le blocage ne retomberait jamais', async () => {
    const window = { max: 2, windowMs: 10_000 };
    await checkRateLimit('ip-a', window);
    await checkRateLimit('ip-a', window);

    // Trois refus successifs ne doivent pas repousser l'échéance.
    const first = await checkRateLimit('ip-a', window);
    await checkRateLimit('ip-a', window);
    const third = await checkRateLimit('ip-a', window);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
  });

  it('glisse : une tentative ancienne libère une place, sans tout réinitialiser', async () => {
    const window = { max: 2, windowMs: 100 };
    await checkRateLimit('ip-a', window);
    await new Promise((r) => setTimeout(r, 70));
    await checkRateLimit('ip-a', window);
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(false);

    // La première tentative sort de la fenêtre : une seule place se libère,
    // la deuxième y étant toujours.
    await new Promise((r) => setTimeout(r, 50));
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(true);
    expect((await checkRateLimit('ip-a', window)).allowed).toBe(false);
  });
});

describe('setRateLimitStore', () => {
  it('délègue le comptage au store fourni', async () => {
    const calls: { key: string; windowMs: number }[] = [];
    const alwaysOverLimit: RateLimitStore = {
      hit(key, now, config) {
        calls.push({ key, windowMs: config.windowMs });
        return { count: 999, oldest: now, recorded: false };
      },
      reset() {},
    };
    setRateLimitStore(alwaysOverLimit);

    const result = await checkRateLimit('ip-a', CONFIG);
    expect(result.allowed).toBe(false);
    expect(calls).toEqual([{ key: 'ip-a', windowMs: CONFIG.windowMs }]);
  });

  it('accepte un store asynchrone, comme le serait un store partagé', async () => {
    let count = 0;
    setRateLimitStore({
      async hit(_key, now, config) {
        const recorded = count < config.max;
        if (recorded) count += 1;
        return { count, oldest: now, recorded };
      },
      async reset() {
        count = 0;
      },
    });

    expect((await checkRateLimit('ip-a', { max: 1, windowMs: 1000 })).allowed).toBe(true);
    expect((await checkRateLimit('ip-a', { max: 1, windowMs: 1000 })).allowed).toBe(false);
  });
});

describe('clientKey', () => {
  it('retient la première adresse de x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' });
    expect(clientKey(headers)).toBe('203.0.113.9');
  });

  it('se rabat sur x-real-ip', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });

  it('renvoie une clé de repli quand aucun en-tête n\'est présent', () => {
    expect(clientKey(new Headers())).toBe('unknown');
  });
});
