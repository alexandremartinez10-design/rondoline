'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Rendu Markdown minimal, suffisant pour ce que produisent les modèles dans
 * une discussion : titres, listes, citations, gras/italique/code inline.
 *
 * Volontairement écrit à la main plutôt qu'avec une dépendance : le besoin est
 * étroit, et surtout ce rendu construit des éléments React — il n'utilise
 * jamais `dangerouslySetInnerHTML`. Le texte affiché provient d'un modèle,
 * donc d'une source qu'on ne contrôle pas : aucun HTML qu'il produirait ne
 * doit pouvoir s'exécuter dans la page.
 */
export function Markdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];

  let listBuffer: string[] = [];
  let listOrdered = false;
  let codeBuffer: string[] | null = null;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((item, i) => <li key={i}>{renderInline(item)}</li>);
    blocks.push(
      listOrdered ? (
        <ol key={`list-${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`list-${blocks.length}`}>{items}</ul>
      )
    );
    listBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    // Bloc de code délimité par ```
    if (/^\s*```/.test(line)) {
      if (codeBuffer === null) {
        flushList();
        codeBuffer = [];
      } else {
        blocks.push(
          <pre key={`code-${blocks.length}`}>
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = null;
      }
      continue;
    }
    if (codeBuffer !== null) {
      codeBuffer.push(rawLine);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1]!.length;
      const content = renderInline(heading[2]!);
      const key = `h-${blocks.length}`;
      blocks.push(
        level <= 2 ? (
          <h3 key={key} className="md-heading">
            {content}
          </h3>
        ) : (
          <h4 key={key} className="md-heading md-heading--small">
            {content}
          </h4>
        )
      );
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const nextOrdered = Boolean(ordered);
      if (listBuffer.length > 0 && nextOrdered !== listOrdered) flushList();
      listOrdered = nextOrdered;
      listBuffer.push((bullet?.[1] ?? ordered?.[1])!);
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push(
        <blockquote key={`q-${blocks.length}`}>{renderInline(quote[1]!)}</blockquote>
      );
      continue;
    }

    if (line.trim() === '') {
      flushList();
      continue;
    }

    flushList();
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
  }

  flushList();
  if (codeBuffer !== null && codeBuffer.length > 0) {
    // Bloc de code jamais refermé (fréquent pendant le streaming).
    blocks.push(
      <pre key={`code-${blocks.length}`}>
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  return blocks;
}

/** Gras, italique et code inline. Tokenisation simple, sans imbrication. */
function renderInline(text: string): ReactNode {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\n]+\*(?!\w)|_[^_\n]+_)/g;
  const parts = text.split(pattern).filter((p) => p !== undefined && p !== '');

  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
