/**
 * The 24 solar terms (二十四節気). Start dates are APPROXIMATE (they drift by a day between years) and are used
 * only for a quiet decorative line on Home. Never treat this as data.
 */
export interface SolarTerm {
  kanji: string;
  romaji: string;
  gloss: string;
  month: number; // 1-12
  day: number;
}

export const SOLAR_TERMS: readonly SolarTerm[] = [
  { kanji: '小寒', romaji: 'Shōkan', gloss: 'Lesser cold', month: 1, day: 5 },
  { kanji: '大寒', romaji: 'Daikan', gloss: 'Greater cold', month: 1, day: 20 },
  { kanji: '立春', romaji: 'Risshun', gloss: 'Spring begins', month: 2, day: 4 },
  { kanji: '雨水', romaji: 'Usui', gloss: 'Rain water', month: 2, day: 19 },
  { kanji: '啓蟄', romaji: 'Keichitsu', gloss: 'Insects awaken', month: 3, day: 6 },
  { kanji: '春分', romaji: 'Shunbun', gloss: 'Spring equinox', month: 3, day: 21 },
  { kanji: '清明', romaji: 'Seimei', gloss: 'Clear and bright', month: 4, day: 5 },
  { kanji: '穀雨', romaji: 'Kokuu', gloss: 'Grain rain', month: 4, day: 20 },
  { kanji: '立夏', romaji: 'Rikka', gloss: 'Summer begins', month: 5, day: 6 },
  { kanji: '小満', romaji: 'Shōman', gloss: 'Grain fills', month: 5, day: 21 },
  { kanji: '芒種', romaji: 'Bōshu', gloss: 'Grain in ear', month: 6, day: 6 },
  { kanji: '夏至', romaji: 'Geshi', gloss: 'Summer solstice', month: 6, day: 21 },
  { kanji: '小暑', romaji: 'Shōsho', gloss: 'Lesser heat', month: 7, day: 7 },
  { kanji: '大暑', romaji: 'Taisho', gloss: 'Greater heat', month: 7, day: 23 },
  { kanji: '立秋', romaji: 'Risshū', gloss: 'Autumn begins', month: 8, day: 8 },
  { kanji: '処暑', romaji: 'Shosho', gloss: 'Heat subsides', month: 8, day: 23 },
  { kanji: '白露', romaji: 'Hakuro', gloss: 'White dew', month: 9, day: 8 },
  { kanji: '秋分', romaji: 'Shūbun', gloss: 'Autumn equinox', month: 9, day: 23 },
  { kanji: '寒露', romaji: 'Kanro', gloss: 'Cold dew', month: 10, day: 8 },
  { kanji: '霜降', romaji: 'Sōkō', gloss: 'Frost descends', month: 10, day: 23 },
  { kanji: '立冬', romaji: 'Rittō', gloss: 'Winter begins', month: 11, day: 7 },
  { kanji: '小雪', romaji: 'Shōsetsu', gloss: 'Lesser snow', month: 11, day: 22 },
  { kanji: '大雪', romaji: 'Taisetsu', gloss: 'Greater snow', month: 12, day: 7 },
  { kanji: '冬至', romaji: 'Tōji', gloss: 'Winter solstice', month: 12, day: 22 },
];

/** The solar term in effect on a civil date 'YYYY-MM-DD' (approximate). */
export function solarTermFor(civil: string): SolarTerm {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  const month = m ? Number(m[2]) : 1;
  const day = m ? Number(m[3]) : 1;
  const key = month * 100 + day;
  let current = SOLAR_TERMS[SOLAR_TERMS.length - 1] as SolarTerm; // before Jan 5 => winter solstice
  for (const term of SOLAR_TERMS) {
    if (term.month * 100 + term.day <= key) current = term;
  }
  return current;
}

export function solarTermLine(civil: string): string {
  const t = solarTermFor(civil);
  return `${t.kanji} ${t.romaji} · ${t.gloss}`;
}
