/**
 * WCAG 2.2 AA contrast check for every colour pair Kadode's CSS uses.
 * Reads the real tokens.css so a changed value that breaks contrast fails the build.
 * (File is .tsx only because vitest.config.ts includes tests/web/**\/*.test.tsx.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/web/styles/tokens.css'), 'utf8');

function parseBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

function themes(): { light: Record<string, string>; dark: Record<string, string>; forcedDark: Record<string, string> } {
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  expect(darkStart).toBeGreaterThan(0);
  const forcedStart = css.indexOf(":root[data-theme='dark']");
  expect(forcedStart).toBeGreaterThan(darkStart);
  const forcedEnd = css.indexOf(":root[data-theme='light']");
  const light = parseBlock(css.slice(0, darkStart));
  const dark = { ...light, ...parseBlock(css.slice(darkStart, forcedStart)) };
  const forcedDark = { ...light, ...parseBlock(css.slice(forcedStart, forcedEnd)) };
  return { light, dark, forcedDark };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = { fg: string; bg: string[]; min: number; use: string };

const TEXT = 4.5;
const UI = 3;
const PAIRS: Pair[] = [
  { fg: 'ink', bg: ['paper', 'surface', 'surface-2', 'ai-soft', 'stone-soft', 'kin-soft', 'kaki-soft', 'matcha-soft'], min: TEXT, use: 'primary text' },
  { fg: 'ink-2', bg: ['paper', 'surface', 'surface-2', 'ai-soft', 'stone-soft'], min: TEXT, use: 'secondary text' },
  { fg: 'ink-3', bg: ['paper', 'surface', 'surface-2', 'stone-soft'], min: TEXT, use: 'tertiary text' },
  { fg: 'ai', bg: ['paper', 'surface', 'surface-2', 'ai-soft'], min: TEXT, use: 'links, selected chips, focus ring text' },
  { fg: 'on-ai', bg: ['ai'], min: TEXT, use: 'primary button label' },
  { fg: 'matcha', bg: ['paper', 'surface', 'surface-2', 'matcha-soft'], min: TEXT, use: 'done / ready text' },
  { fg: 'kaki', bg: ['paper', 'surface', 'surface-2', 'kaki-soft'], min: TEXT, use: 'blocked / legal text' },
  { fg: 'kin', bg: ['paper', 'surface', 'surface-2', 'kin-soft'], min: TEXT, use: 'due soon text' },
  // Status glyphs drawn on a solid timeline bar (blocked, finished): non-text, so 3:1.
  { fg: 'on-ai', bg: ['kaki', 'ink-3'], min: UI, use: 'icon on a solid blocked or finished timeline bar' },
  // Non-text: input borders, focus ring, icons that carry meaning.
  { fg: 'line-strong', bg: ['paper', 'surface', 'surface-2'], min: UI, use: 'input and control boundaries' },
  { fg: 'ai', bg: ['paper', 'surface', 'surface-2', 'ai-soft'], min: UI, use: 'focus ring' },
  // Buttons (see .btn--* in components.css), in every theme.
  { fg: 'ink', bg: ['surface'], min: TEXT, use: 'secondary button label' },
  { fg: 'line-strong', bg: ['paper', 'surface', 'surface-2'], min: UI, use: 'secondary button boundary against the page and against a card (WCAG 1.4.11)' },
  { fg: 'ai', bg: ['surface'], min: TEXT, use: 'secondary button label on hover' },
  { fg: 'ai', bg: ['paper', 'surface'], min: UI, use: 'secondary and quiet button boundary or label on hover' },
  { fg: 'kaki', bg: ['surface', 'kaki-soft'], min: TEXT, use: 'danger button label, at rest and on hover' },
  { fg: 'kaki', bg: ['paper', 'surface'], min: UI, use: 'danger button boundary (WCAG 1.4.11)' },
];

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

/** What a colour looks like after CSS `filter: brightness(k)` (each sRGB channel times k, clamped). */
function brighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.min(255, Math.round(v * k));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** `fg` shown at `alpha` opacity over `under`. */
function blend(fg: string, under: string, alpha: number): string {
  const a = parseInt(fg.slice(1), 16);
  const b = parseInt(under.slice(1), 16);
  const mix = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha));
  return `#${[mix((a >> 16) & 255, (b >> 16) & 255), mix((a >> 8) & 255, (b >> 8) & 255), mix(a & 255, b & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('theme blocks', () => {
  it('a theme forced to dark in Settings uses exactly the same values as the system dark theme', () => {
    const t = themes();
    expect(t.forcedDark).toEqual(t.dark);
  });
});

describe('design tokens meet WCAG 2.2 AA', () => {
  const t = themes();
  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      const tokens = t[theme];
      for (const pair of PAIRS) {
        for (const bg of pair.bg) {
          it(`${pair.fg} on ${bg} (${pair.use}) >= ${pair.min}:1`, () => {
            const fg = tokens[pair.fg];
            const back = tokens[bg];
            expect(fg, `token --${pair.fg} missing`).toBeTruthy();
            expect(back, `token --${bg} missing`).toBeTruthy();
            const ratio = contrast(fg!, back!);
            expect(ratio, `${fg} on ${back} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(pair.min);
          });
        }
      }
    });
  }
});

describe('button states keep their contrast in light and dark', () => {
  const t = themes();
  for (const theme of ['light', 'dark'] as const) {
    const tokens = t[theme];
    it(`${theme}: the primary button label stays readable on hover (filter: brightness(1.08) lightens the whole button)`, () => {
      const ratio = contrast(brighten(tokens['on-ai']!, 1.08), brighten(tokens.ai!, 1.08));
      expect(ratio).toBeGreaterThanOrEqual(TEXT);
    });
    it(`${theme}: the primary button label stays readable while it is busy (the button is shown at 80% opacity)`, () => {
      const ratio = contrast(blend(tokens['on-ai']!, tokens.paper!, 0.8), blend(tokens.ai!, tokens.paper!, 0.8));
      expect(ratio).toBeGreaterThanOrEqual(TEXT);
    });
    it(`${theme}: the primary button is a clear shape against the page and against a card (WCAG 1.4.11)`, () => {
      expect(contrast(tokens.ai!, tokens.paper!)).toBeGreaterThanOrEqual(UI);
      expect(contrast(tokens.ai!, tokens.surface!)).toBeGreaterThanOrEqual(UI);
    });
  }
});
