# AI Debate Arena

Application web qui fait dialoguer plusieurs IA (Claude, Gemini, OpenAI) entre elles sur un sujet donné : débat contradictoire, collaboration, avocat du diable, ou panel d'experts — avec streaming en temps réel et synthèse finale.

Ce n'est pas une maquette : quand une clé API est configurée, l'application appelle réellement le provider correspondant, et aucune réponse n'est simulée.

## Essayer immédiatement, sans clé API

```bash
npm install
npm run dev
```

Sans aucune configuration, l'application démarre en **mode démonstration** : un
provider local (`src/lib/providers/DemoProvider.ts`) joue le débat sans appeler
la moindre API et sans coût. Tout le parcours est réel — streaming tour par
tour, pause/reprise, gestion d'erreur, synthèse finale, export — seul le
contenu des réponses est généré à partir de gabarits. **Ces arguments sont
factices et n'ont aucune valeur d'analyse** ; chaque message le rappelle
explicitement.

Renseignez ensuite une clé dans `.env.local` (voir plus bas) pour des débats
réels : le mode démonstration s'efface dès qu'un vrai provider est disponible.

---

## ⚠️ Important — à lire avant de commencer

**Un abonnement Claude.ai (Pro/Max), Gemini Advanced (Google One) ou ChatGPT Plus/Pro ne donne PAS accès aux API respectives.**

Les API Anthropic, Google Gemini et OpenAI sont facturées **séparément**, à l'usage (au token), via une console développeur distincte de l'abonnement grand public :

| Fournisseur | Où créer une clé API | Facturation |
|---|---|---|
| Anthropic (Claude) | https://console.anthropic.com/settings/keys | À l'usage, séparée de Claude.ai. Nécessite d'ajouter un moyen de paiement dans la console. |
| Google (Gemini) | https://aistudio.google.com/apikey | Palier gratuit limité (quotas bas), puis facturation à l'usage au-delà. Séparée de Google One/Gemini Advanced. |
| OpenAI (GPT) | https://platform.openai.com/api-keys | À l'usage, séparée de ChatGPT Plus/Pro. Nécessite un moyen de paiement dans la console. |

Vous n'êtes pas obligé de configurer les trois : un provider sans clé apparaît simplement comme indisponible dans l'interface, et vous pouvez lancer un débat avec seulement 2 providers (ex. Claude ↔ Gemini).

---

## Architecture

```
Frontend (React, App Router)
  ConfigPanel  →  construit une DebateConfig (sujet, mode, tours, participants)
  useDebate    →  POST /api/debate/stream, parse le flux SSE, gère pause/reprise/stop
  ConversationView / MessageBubble  →  affichage temps réel

Backend (route API Next.js, streaming SSE)
  /api/debate/stream (POST)
    validateDebateRequest()   →  validation + neutralisation basique d'injection
    runDebate() [DebateEngine]
      pour chaque tour :
        buildSystemPrompt() + buildConversationContext()  [prompts.ts]
        providerFactory.get(providerId).streamMessage(...)
      puis, si demandé : synthèse finale
    → chaque évènement (turn_start, token, turn_end, turn_error, synthesis_*, debate_end)
      est encodé en trame SSE et streamé au client

Providers (abstraction commune AIProvider)
  AnthropicProvider  → @anthropic-ai/sdk (messages.stream)
  GoogleProvider     → @google/genai (generateContentStream)
  OpenAIProvider     → openai (chat.completions.create, stream: true)
  DemoProvider       → aucun appel réseau ; toujours disponible
  ProviderFactory    → point d'entrée unique, clés lues côté serveur uniquement
```

**Aucune clé API n'atteint jamais le navigateur** : les providers sont instanciés et appelés exclusivement dans la route API (`runtime = 'nodejs'`), qui lit `process.env.*`.

### Limites et valeurs par défaut : une seule source de vérité

Un piège spécifique à Next.js : dans un bundle **client**, toute variable
d'environnement non préfixée `NEXT_PUBLIC_` vaut `undefined`. Si l'interface
lisait `process.env.MAX_TURNS_LIMIT` directement, elle appliquerait toujours la
valeur par défaut pendant que le serveur appliquerait la vôtre — le formulaire
accepterait alors des valeurs que l'API rejette en 400.

Les limites sont donc calculées côté serveur (`getServerLimits()`) et
transmises au client par `GET /api/debate/stream`, avec les modèles par défaut
effectifs. `DEFAULT_LIMITS` ne contient que des constantes, sûres des deux
côtés.

### Pourquoi une seule route SSE plutôt que WebSocket ?

Un débat est une séquence de tours strictement séquentielle (chaque IA attend la précédente). Un flux SSE unidirectionnel par requête suffit donc, et simplifie beaucoup l'infrastructure (pas de serveur WebSocket à gérer). Pour "Pause", le client annule simplement le `fetch` en cours (`AbortController`) ; pour "Reprendre", il rappelle la même route en renvoyant l'historique déjà produit — le moteur reprend exactement au tour suivant.

### Ajouter un nouveau provider

1. Créez `src/lib/providers/MonProvider.ts` implémentant l'interface `AIProvider` (`src/lib/types.ts`).
2. Enregistrez-le dans `src/lib/providers/ProviderFactory.ts`.
3. Ajoutez ses métadonnées (modèles suggérés, couleur, variable d'env) dans `src/lib/config/models.ts`.
4. Ajoutez la variable d'environnement correspondante dans `.env.example`.

Aucune autre partie de l'application (UI, moteur de débat) n'a besoin d'être modifiée.

---

## Modes de débat

- **Débat** : chaque IA critique la réponse précédente (affirmations discutables, logique, contre-arguments) avant de proposer la sienne.
- **Collaboration** : les IA complètent progressivement une réponse commune plutôt que de s'opposer.
- **Avocat du diable** : une IA propose une solution, les autres cherchent activement les failles (rôle configurable par participant : `proposeur` / critique).
- **Panel d'experts** : chaque IA reçoit un rôle différent (ex. "économiste", "juriste") et analyse le sujet sous cet angle.

Dans les 4 modes, chaque IA reçoit systématiquement : son rôle, le sujet initial, la liste des autres participants, l'historique complet, le numéro du tour en cours, et des règles générales (ne pas être d'accord par complaisance, corriger ses propres erreurs, ne pas halluciner de faits).

---

## Gestion des erreurs

- **Clé API absente** : le participant concerné est signalé dans l'UI (badge "non configuré") ; si vous lancez malgré tout, son tour est ignoré avec un message d'erreur visible, et le débat continue avec les autres participants.
- **Erreur API / limite de débit / réponse vide / modèle indisponible** : capturée par provider, transformée en message clair, affichée sous forme de bandeau d'erreur pour ce tour — le débat n'est pas interrompu.
- **Timeout** : chaque appel provider (tour ou synthèse) est borné par `PROVIDER_TIMEOUT_MS`, appliqué dans le moteur de débat via un signal d'annulation combiné — l'expiration produit un message distinct d'une annulation volontaire. Un filet de sécurité global couvre en plus l'ensemble de la requête au niveau de la route API.
- **Perte de connexion / arrêt manuel** : le client annule le `fetch` (`AbortController`), qui propage l'annulation jusqu'à l'appel provider en cours ; l'historique déjà produit est conservé et vous pouvez reprendre.

---

## Sécurité

- Clés API lues uniquement côté serveur (`process.env`), jamais envoyées au navigateur, jamais loguées.
- Validation stricte de toutes les entrées (`src/lib/security/sanitize.ts`) : longueur du sujet, nombre de tours, nombre de participants, format des couleurs, etc.
- Protection basique contre l'injection de prompt : le sujet et les messages sont toujours encadrés par des délimiteurs explicites et présentés au modèle comme des *données*, jamais comme des instructions système — avec neutralisation des tentatives de faux balisage (`<system>`, etc.). Ce n'est pas une garantie absolue (aucune sanitization ne l'est), mais cela réduit la surface d'attaque la plus commune.
- La neutralisation s'applique au sujet **et** aux rôles, instructions personnalisées et à l'historique renvoyé par le client lors d'une reprise — ce dernier n'est pas plus fiable que le reste puisqu'il transite par le navigateur.
- Limites configurables sur la taille des messages et le nombre de tours (`MAX_TURNS_LIMIT`, `MAX_TOPIC_LENGTH`).
- **Rate limiting** par IP sur le lancement d'un débat (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`). Indispensable dès qu'une instance est publique : un débat consomme des tokens facturés. Le compteur vit en mémoire du process — en déploiement multi-instance, chaque instance compte séparément ; adossez-le à un store partagé (Redis…) pour une vraie protection en production.
- Le contenu renvoyé par les modèles est rendu via un composant React dédié (`Markdown.tsx`) qui construit des éléments React et n'utilise jamais `dangerouslySetInnerHTML` : aucun HTML produit par un modèle ne peut s'exécuter dans la page.

---

## Installation

### Prérequis
- Node.js ≥ 20
- npm

### 1. Créer vos clés API (optionnel)

> Vous pouvez sauter cette étape et les deux suivantes : sans clé, l'application
> tourne en mode démonstration (voir tout en haut).

Suivez les liens de la section "⚠️ Important" ci-dessus pour le(s) fournisseur(s) de votre choix. Pour un premier essai Claude ↔ Gemini, vous avez besoin de :
- une clé Anthropic sur https://console.anthropic.com/settings/keys
- une clé Google AI Studio sur https://aistudio.google.com/apikey (le palier gratuit suffit pour tester)

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env.local
```

Ouvrez `.env.local` et collez vos clés :

```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

Laissez `OPENAI_API_KEY` vide si vous ne l'utilisez pas encore — le participant OpenAI apparaîtra juste comme non configuré dans l'UI.

### 3. Installer les dépendances

```bash
npm install
```

### 4. Lancer l'application

```bash
npm run dev
```

Ouvrez http://localhost:3000

### 5. Lancer un premier débat Claude ↔ Gemini

1. Dans le panneau de gauche, saisissez un sujet, ex : *"Quelle est la meilleure stratégie pour lancer cette startup ?"*
2. Laissez le mode sur **Débat**, et le nombre de tours sur 6 (par ex.).
3. Vérifiez que le participant 1 est bien sur **Anthropic (Claude)** et le participant 2 sur **Google (Gemini)** (c'est la configuration par défaut).
4. Cliquez sur **Lancer le débat**.
5. Les réponses s'affichent en temps réel, tour par tour, avec le nom, la couleur et le temps de réponse de chaque IA.
6. Utilisez **Pause** / **Reprendre** / **Arrêter** à tout moment.
7. À la fin, la synthèse se génère automatiquement si l'option est cochée.
8. Exportez la conversation en `.md` ou `.json` via les boutons en haut à droite.

---

## Scripts disponibles

```bash
npm run dev        # serveur de développement
npm run build      # build de production
npm run start      # démarre le build de production
npm run typecheck  # vérification TypeScript sans build
npm run lint       # ESLint
npm test           # suite de tests (Vitest)
npm run test:watch # tests en mode surveillance
```

## Tests

`npm test` s'exécute **sans aucune clé API et sans appel facturé**.

Les tests de contrat (`tests/providers.test.ts`) méritent une mention : ils
dirigent chaque SDK vers un serveur HTTP local (`tests/helpers/mockApiServer.ts`)
via son URL de base, et vérifient à la fois ce que l'adaptateur *envoie* et ce
qu'il fait des trames qu'il *reçoit*.

C'est le seul moyen de couvrir ce code sans clé — et il en avait besoin : le
mode démonstration valide le moteur mais ne traverse aucun des trois
adaptateurs réels, qui ne s'exécutent qu'au premier débat facturé. Trois
défauts y dormaient, dont l'envoi de `max_tokens`, déprécié et refusé par les
modèles de raisonnement que l'interface permet pourtant de saisir.

## Déploiement

Trois points à régler avant d'exposer une instance publiquement.

**1. Durée maximale de la fonction.** Un débat se compte en minutes. La route
déclare `maxDuration = 300` (secondes), mais cette valeur est plafonnée par
votre plan d'hébergement. Si le plafond est plus bas, abaissez `MAX_TURNS_LIMIT`
en conséquence — sinon le flux est coupé en plein débat, et l'utilisateur voit
la conversation s'arrêter sans message d'erreur.

**2. Rate limiting partagé.** Le store par défaut vit dans la mémoire du
process. En serverless, chaque instance froide repart d'un compteur vide et la
plateforme en démarre autant que nécessaire : **ce n'est pas une protection
sérieuse**. Branchez un store partagé au démarrage :

```ts
import { setRateLimitStore } from '@/lib/security/rateLimit';

setRateLimitStore({
  async hit(key, now, config) {
    // Dans UNE transaction (ou un script Lua) :
    //   1. purger la fenêtre    ZREMRANGEBYSCORE key 0 (now - config.windowMs)
    //   2. compter              ZCARD key
    //   3. n'ajouter QUE si le compte est sous config.max
    // Sans atomicité, deux requêtes simultanées passent ensemble.
    return { count, oldest, recorded };
  },
  async reset() {},
});
```

Le store décide lui-même d'enregistrer ou non, et **n'enregistre pas une
tentative refusée** : compter les refus transformerait la fenêtre glissante en
peine plancher, un client qui martèle la route ne voyant jamais son compteur
redescendre.

**3. Variables d'environnement.** Reportez le contenu de `.env.example` dans la
configuration de votre hébergeur. Les clés sont lues côté serveur uniquement et
ne sont jamais exposées au navigateur.

Une intégration continue (`.github/workflows/ci.yml`) enchaîne types, lint,
tests et build à chaque push — sans clé API, là encore.

## Reprise après pause : pourquoi `startTurn`

À la reprise, le client envoie explicitement le numéro du prochain tour, calculé
à partir des tours **déjà tentés** — réussis comme échoués.

Déduire ce numéro du seul historique ne suffit pas : un tour en erreur n'y
figure pas, il serait donc rejoué. Et comme le participant d'un tour est choisi
par `participants[(turn - 1) % n]`, rejouer un tour décale toute la rotation
suivante — un débat à deux voix se met à alterner de travers après le premier
échec.

## Limites connues / pistes d'amélioration

- Pas de base de données : l'historique vit dans `localStorage` du navigateur (un seul débat actif à la fois, effacé si vous videz le stockage local).
- Le comptage de tokens dépend de ce que chaque API expose en streaming ; Gemini n'expose pas toujours l'usage exact en mode stream. En mode démonstration, l'usage affiché est une approximation locale (~4 caractères par token), pas une mesure.
- "Pause" annule la requête réseau en cours ; si elle survient au milieu d'un tour, ce tour est refait entièrement à la reprise (le texte partiel n'est pas conservé, et la bulle partielle est retirée de l'affichage pour éviter un doublon).
- Le store de rate limiting par défaut est en mémoire : voir la section Déploiement.
- Les tests de contrat vérifient la forme des échanges avec chaque fournisseur, pas le comportement réel de leurs API. Une évolution de format côté fournisseur ne sera visible qu'au premier débat réel.
- L'interface n'est pas couverte par des tests : le parcours (streaming, pause, reprise, arrêt, synthèse) a été validé manuellement au navigateur, pas automatiquement.
