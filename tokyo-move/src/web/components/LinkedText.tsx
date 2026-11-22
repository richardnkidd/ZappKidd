import { Fragment } from 'react';
import { safeHref } from '../lib/format';

const URL_RE = /(https?:\/\/[^\s)]+[^\s).,;])/g;

/**
 * Text with web addresses turned into short links ("example.org"), opened in a new tab. Only http(s) addresses become
 * links; everything else stays text. Never HTML.
 */
export function LinkedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        const href = i % 2 === 1 ? safeHref(part) : null;
        if (!href) return <Fragment key={i}>{part}</Fragment>;
        let host = part;
        try {
          host = new URL(href).hostname.replace(/^www\./, '');
        } catch {
          /* keep the address as written */
        }
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer">
            {host}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        );
      })}
    </>
  );
}
