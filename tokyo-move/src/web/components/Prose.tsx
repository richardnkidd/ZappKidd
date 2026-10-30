import { Fragment } from 'react';
import { proseTokens } from '../lib/prose';
import { useOptionalSnapshot } from '../state/snapshot';
import { RecordLink } from './RecordLink';

/**
 * Imported or typed prose shown as plain words: record keys become titled links, unknown keys vanish, glued tokens
 * and ISO dates read naturally. Always rendered as text, never as HTML. Line breaks are kept by the caller's CSS.
 */
export function Prose({ text, className }: { text: string | null | undefined; className?: string }) {
  const idx = useOptionalSnapshot()?.idx;
  const tokens = proseTokens(text, idx);
  if (tokens.length === 0) return null;
  return (
    <span className={className}>
      {tokens.map((t, i) =>
        t.kind === 'text' ? (
          <Fragment key={i}>{t.text}</Fragment>
        ) : (
          <RecordLink key={i} id={t.id}>
            {t.title}
          </RecordLink>
        ),
      )}
    </span>
  );
}
