import type {
  AIProvider,
  ProviderMessage,
  SendMessageOptions,
  StreamChunk,
  StreamResult,
} from '@/lib/types';
import { ProviderRequestError } from '@/lib/types';

/**
 * Provider de démonstration : ne contacte AUCUNE API et ne nécessite aucune
 * clé. Il génère localement une réponse plausible et la diffuse mot à mot,
 * avec la même interface `AIProvider` que les vrais providers.
 *
 * Raison d'être : permettre de lancer l'application et de voir l'intégralité
 * du parcours (streaming, tours, pause/reprise, erreurs, synthèse, export)
 * sans facturation ni configuration. Les textes produits sont générés à
 * partir de gabarits — ce sont des ARGUMENTS FACTICES, jamais des faits.
 *
 * Il est toujours "configuré" : c'est le seul provider utilisable tel quel
 * après un `git clone`.
 */
export class DemoProvider implements AIProvider {
  readonly id = 'demo' as const;

  isConfigured(): boolean {
    return true;
  }

  async *streamMessage(
    messages: ProviderMessage[],
    systemPrompt: string,
    options: SendMessageOptions
  ): AsyncGenerator<StreamChunk, StreamResult, unknown> {
    const context = readContext(systemPrompt, messages);
    const text = context.isSynthesis
      ? buildSynthesisText(context)
      : buildTurnText(context, options.model);

    // On diffuse par petits groupes de mots pour imiter un vrai flux SSE.
    const tokens = text.match(/\S+\s*/g) ?? [text];
    let emitted = '';

    for (const token of tokens) {
      if (options.signal?.aborted) {
        throw new ProviderRequestError('demo', 'Requête annulée.');
      }
      await delay(demoDelayMs(), options.signal);
      emitted += token;
      yield { delta: token };
    }

    return {
      content: emitted,
      // Approximation volontairement grossière (~4 caractères par token) :
      // le mode démo n'appelle aucune API, il n'y a pas d'usage réel à rapporter.
      usage: {
        inputTokens: Math.round(estimateChars(systemPrompt, messages) / 4),
        outputTokens: Math.round(emitted.length / 4),
      },
    };
  }
}

function demoDelayMs(): number {
  const configured = Number(process.env.DEMO_TOKEN_DELAY_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 18;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new ProviderRequestError('demo', 'Requête annulée.'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function estimateChars(systemPrompt: string, messages: ProviderMessage[]): number {
  return systemPrompt.length + messages.reduce((n, m) => n + m.content.length, 0);
}

// -----------------------------------------------------------------------------
// Lecture du contexte : le provider ne reçoit que du texte, on en extrait de
// quoi produire une réponse cohérente avec le tour en cours.
// -----------------------------------------------------------------------------

interface DemoContext {
  speaker: string;
  topic: string;
  mode: string;
  turn: number;
  totalTurns: number;
  previousSpeaker: string | null;
  previousExcerpt: string | null;
  isSynthesis: boolean;
}

function readContext(systemPrompt: string, messages: ProviderMessage[]): DemoContext {
  const transcript = messages.map((m) => m.content).join('\n\n');

  const speaker = /Tu es "([^"]+)"/.exec(systemPrompt)?.[1] ?? 'Participant';
  const turnMatch = /C'est le tour (\d+) sur (\d+)/.exec(systemPrompt);
  const topicMatch = /SUJET INITIAL DE LA DISCUSSION[^\n]*\n"""\n([\s\S]*?)\n"""/.exec(
    systemPrompt
  );
  const modeMatch = /MODE : ([A-ZÀ-Ÿ' ]+)\./.exec(systemPrompt);

  // Dernier intervenant du transcript : "[Tour 3 — Gemini]".
  const speakerBlocks = [...transcript.matchAll(/\[Tour (-?\d+) — ([^\]]+)\]\n([\s\S]*?)(?=\n\n---\n\n|$)/g)];
  const last = speakerBlocks.at(-1);

  return {
    speaker,
    topic: topicMatch?.[1]?.trim() || 'le sujet proposé',
    mode: modeMatch?.[1]?.trim().toLowerCase() || 'débat',
    turn: Number(turnMatch?.[1] ?? 1),
    totalTurns: Number(turnMatch?.[2] ?? 1),
    previousSpeaker: last?.[2]?.trim() ?? null,
    previousExcerpt: last?.[3] ? extractClaim(last[3]) : null,
    isSynthesis: /synthèse finale/i.test(systemPrompt),
  };
}

/**
 * Extrait la thèse du message précédent, pour pouvoir la citer.
 *
 * On vise en priorité la ligne « Ma position : … » : citer la première phrase
 * reprendrait la citation que l'intervenant précédent faisait lui-même du
 * tour d'avant, et les guillemets s'imbriqueraient de tour en tour.
 */
function extractClaim(text: string): string {
  const claim = /Ma position\s*:\*{0,2}\s*([^\n]+)/.exec(text)?.[1];
  const source = claim ?? stripQuotedSpans(text);
  const cleaned = source.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  const cut = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;
  const trimmed = cut.replace(/[.\s]+$/, '');
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

/** Retire les passages déjà entre guillemets, pour ne pas les re-citer. */
function stripQuotedSpans(text: string): string {
  return text.replace(/«[^»]*»/g, '').replace(/\s+/g, ' ').trim();
}

/** Raccourcit le sujet pour pouvoir l'insérer dans une phrase. */
function shortTopic(topic: string): string {
  const oneLine = topic.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
  return oneLine.length > 90 ? `${oneLine.slice(0, 87)}…` : oneLine;
}

// -----------------------------------------------------------------------------
// Gabarits de réponse
// -----------------------------------------------------------------------------

const ANGLES = [
  {
    claim: "le principal facteur de réussite est la vitesse d'apprentissage, pas la justesse du plan initial",
    because:
      "un plan détaillé encode des hypothèses qui n'ont pas encore été confrontées au réel ; sa précision donne une fausse impression de maîtrise",
    caveat:
      "cet argument s'effondre dès que le coût d'une erreur est irréversible — dans ce cas, itérer vite revient à se tromper vite",
  },
  {
    claim: 'la contrainte dominante est la distribution, pas la qualité de ce qui est produit',
    because:
      "on peut mesurer l'écart : à qualité comparable, les écarts de résultat entre acteurs s'expliquent bien mieux par l'accès au canal que par la finition",
    caveat:
      'reste que sans un minimum de qualité, un bon canal accélère surtout la constatation du problème',
  },
  {
    claim: "il faut séparer ce qui est réversible de ce qui ne l'est pas et n'appliquer de la rigueur qu'au second",
    because:
      "traiter toutes les décisions avec le même niveau d'exigence consomme le budget d'attention là où il ne rapporte rien",
    caveat:
      "la difficulté pratique est que la réversibilité est souvent surestimée : beaucoup de choix « réversibles » créent des dépendances qui, elles, ne le sont pas",
  },
  {
    claim: 'le vrai risque est de confondre un problème de demande avec un problème d\'exécution',
    because:
      "les deux produisent les mêmes symptômes visibles, mais appellent des réponses opposées : l'un demande de changer de cible, l'autre de persévérer",
    caveat:
      "distinguer les deux demande des données que l'on n'a généralement pas au moment où la décision se pose",
  },
];

function buildTurnText(ctx: DemoContext, model: string): string {
  const angle = ANGLES[(ctx.turn - 1) % ANGLES.length]!;
  const topic = shortTopic(ctx.topic);
  const parts: string[] = [];

  if (ctx.previousSpeaker && ctx.previousExcerpt) {
    const verb = ctx.mode.includes('collaboration')
      ? `Je pars de ce que ${ctx.previousSpeaker} vient de poser`
      : `Je prends au sérieux la thèse de ${ctx.previousSpeaker}`;
    const objection = ctx.mode.includes('collaboration')
      ? 'et je la prolonge sur un point qui reste ouvert'
      : "mais elle saute une étape qu'il faut expliciter";
    parts.push(`${verb} — « ${ctx.previousExcerpt} » — ${objection}.`);
  } else {
    parts.push(
      `Sur « ${topic} », je commence par écarter la formulation la plus courante, qui me semble mal posée.`
    );
  }

  parts.push(`**Ma position :** ${angle.claim}.`);
  parts.push(`Pourquoi : ${angle.because}.`);

  if (ctx.mode.includes('avocat')) {
    parts.push(
      `**Là où ça casse :**\n- le raisonnement suppose des conditions stables, ce qui n'est presque jamais le cas ;\n- il n'existe pas de test simple permettant de savoir si l'on s'est trompé ;\n- le coût d'un échec n'est pas symétrique entre les parties concernées.`
    );
  } else if (ctx.mode.includes('collaboration')) {
    parts.push(
      `**Ce que je garde :** le cadrage général.\n**Ce que j'affine :** le critère de décision.\n**Ce que j'ajoute :** une manière de vérifier, en quelques jours, laquelle des deux hypothèses tient.`
    );
  } else {
    parts.push(
      `**Contre-argument que j'anticipe :** ${angle.caveat}. Je ne crois pas que cela invalide la position, mais cela en réduit nettement le domaine de validité.`
    );
  }

  if (ctx.turn > 2) {
    parts.push(
      `Correction sur mon tour précédent : j'ai présenté cette lecture comme générale alors qu'elle ne vaut que dans le cas où le coût d'entrée est faible. Je la restreins à ce cas.`
    );
  }

  parts.push(
    `_(Réponse générée hors ligne par le provider de démonstration « ${model} ». Aucun appel API n'a été effectué ; le contenu est illustratif et ne doit pas être pris pour une analyse réelle.)_`
  );

  return parts.join('\n\n');
}

function buildSynthesisText(ctx: DemoContext): string {
  const topic = shortTopic(ctx.topic);
  return [
    `## Points d'accord`,
    `Les participants convergent sur un point : « ${topic} » ne se tranche pas par un principe général, mais par la nature du coût d'une erreur dans le cas particulier considéré.`,
    `## Points de désaccord`,
    `Le désaccord porte sur l'ordre des priorités — vitesse d'itération contre solidité du cadrage initial. Aucun des deux camps n'a produit de critère permettant de trancher sans données supplémentaires.`,
    `## Arguments les plus solides`,
    `La distinction entre décisions réversibles et irréversibles : c'est le seul argument avancé qui reste opérationnel quand on change de contexte.`,
    `## Faiblesses détectées`,
    `- Plusieurs affirmations sont présentées comme générales alors qu'elles dépendent d'hypothèses non explicitées.\n- Le débat n'a produit aucune manière de vérifier empiriquement laquelle des positions est correcte.`,
    `## Conclusion et recommandation finale`,
    `La position la plus défendable est la seconde, mais pour une raison qui n'a pas été mise en avant : elle est la seule à rester falsifiable. Prochaine étape utile : définir à l'avance le signal qui ferait changer d'avis.`,
    `_(Synthèse générée hors ligne par le provider de démonstration — aucun appel API. Contenu illustratif.)_`,
  ].join('\n\n');
}
