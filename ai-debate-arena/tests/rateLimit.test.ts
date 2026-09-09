import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, clientKey, resetRateLimit } from '@/lib/security/rateLimit';

const CONFIG = { max: 3, windowMs: 1000 };

beforeEach(() => resetRateLimit());

describe('checkRateLimit', () => {
  it('autorise jusqu\'à la limite puis refuse', () => {
    for (let i = 0; i < CONFIG.max; i++) {
      expect(checkRateLimit('ip-a', CONFIG).allowed).toBe(true);
    }
    expect(checkRateLimit('ip-a', CONFIG).allowed).toBe(false);
  });

  it('décompte correctement les tentatives restantes', () => {
    expect(checkRateLimit('ip-a', CONFIG).remaining).toBe(2);
    expect(checkRateLimit('ip-a', CONFIG).remaining).toBe(1);
    expect(checkRateLimit('ip-a', CONFIG).remaining).toBe(0);
  });

  it('compte chaque clé séparément', () => {
    for (let i = 0; i < CONFIG.max; i++) checkRateLimit('ip-a', CONFIG);
    expect(checkRateLimit('ip-a', CONFIG).allowed).toBe(false);
    // Une autre adresse ne doit pas hériter du blocage de la première.
    expect(checkRateLimit('ip-b', CONFIG).allowed).toBe(true);
  });

  it('indique un délai d\'attente strictement positif quand il refuse', () => {
    for (let i = 0; i < CONFIG.max; i++) checkRateLimit('ip-a', CONFIG);
    const refused = checkRateLimit('ip-a', CONFIG);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(Math.ceil(CONFIG.windowMs / 1000));
  });

  it('réautorise une fois la fenêtre écoulée', async () => {
    const shortWindow = { max: 2, windowMs: 60 };
    expect(checkRateLimit('ip-a', shortWindow).allowed).toBe(true);
    expect(checkRateLimit('ip-a', shortWindow).allowed).toBe(true);
    expect(checkRateLimit('ip-a', shortWindow).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, shortWindow.windowMs + 20));
    expect(checkRateLimit('ip-a', shortWindow).allowed).toBe(true);
  });

  it('glisse : une requête ancienne libère une place sans réinitialiser tout le compteur', async () => {
    const window = { max: 2, windowMs: 80 };
    checkRateLimit('ip-a', window);
    await new Promise((r) => setTimeout(r, 60));
    checkRateLimit('ip-a', window);
    expect(checkRateLimit('ip-a', window).allowed).toBe(false);

    // La toute première requête sort de la fenêtre : une place se libère,
    // mais la deuxième y est toujours — donc une seule.
    await new Promise((r) => setTimeout(r, 40));
    expect(checkRateLimit('ip-a', window).allowed).toBe(true);
    expect(checkRateLimit('ip-a', window).allowed).toBe(false);
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
