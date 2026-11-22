/**
 * Porter stemmer (M.F. Porter, "An algorithm for suffix stripping", 1980).
 * Port of the reference JavaScript implementation from
 * https://tartarus.org/martin/PorterStemmer/
 *
 * Input must already be lowercase. Words shorter than 3 characters are
 * returned unchanged.
 */

const STEP2: Record<string, string> = {
  ational: 'ate',
  tional: 'tion',
  enci: 'ence',
  anci: 'ance',
  izer: 'ize',
  bli: 'ble',
  alli: 'al',
  entli: 'ent',
  eli: 'e',
  ousli: 'ous',
  ization: 'ize',
  ation: 'ate',
  ator: 'ate',
  alism: 'al',
  iveness: 'ive',
  fulness: 'ful',
  ousness: 'ous',
  aliti: 'al',
  iviti: 'ive',
  biliti: 'ble',
  logi: 'log',
};

const STEP3: Record<string, string> = {
  icate: 'ic',
  ative: '',
  alize: 'al',
  iciti: 'ic',
  ical: 'ic',
  ful: '',
  ness: '',
};

const c = '[^aeiou]'; // consonant
const v = '[aeiouy]'; // vowel
const C = c + '[^aeiouy]*'; // consonant sequence
const V = v + '[aeiou]*'; // vowel sequence

const MGR0 = new RegExp('^(' + C + ')?' + V + C); // m > 0
const MEQ1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$'); // m = 1
const MGR1 = new RegExp('^(' + C + ')?' + V + C + V + C); // m > 1
const S_V = new RegExp('^(' + C + ')?' + v); // stem contains a vowel
const CVC = new RegExp('^' + C + v + '[^aeiouwxy]$'); // ends consonant-vowel-consonant

const STEP1A_SSES_IES = /^(.+?)(ss|i)es$/;
const STEP1A_S = /^(.+?)([^s])s$/;
const STEP1B_EED = /^(.+?)eed$/;
const STEP1B_ED_ING = /^(.+?)(ed|ing)$/;
const STEP1B_AT_BL_IZ = /(at|bl|iz)$/;
const STEP1B_DOUBLE = /([^aeiouylsz])\1$/;
const STEP1C = /^(.+?)y$/;
const STEP2_RE =
  /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
const STEP3_RE = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
const STEP4_RE =
  /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
const STEP4_ION = /^(.+?)(s|t)(ion)$/;
const STEP5_E = /^(.+?)e$/;

export function porterStem(word: string): string {
  if (word.length < 3) return word;

  let w = word;
  let m: RegExpExecArray | null;

  // A leading 'y' is a consonant; uppercase it so the vowel patterns skip it.
  const firstIsY = w[0] === 'y';
  if (firstIsY) w = 'Y' + w.slice(1);

  // Step 1a: plurals
  if (STEP1A_SSES_IES.test(w)) w = w.replace(STEP1A_SSES_IES, '$1$2');
  else if (STEP1A_S.test(w)) w = w.replace(STEP1A_S, '$1$2');

  // Step 1b: -eed, -ed, -ing
  if ((m = STEP1B_EED.exec(w))) {
    if (MGR0.test(m[1])) w = w.slice(0, -1);
  } else if ((m = STEP1B_ED_ING.exec(w))) {
    const stem = m[1];
    if (S_V.test(stem)) {
      w = stem;
      if (STEP1B_AT_BL_IZ.test(w)) w += 'e';
      else if (STEP1B_DOUBLE.test(w)) w = w.slice(0, -1);
      else if (CVC.test(w)) w += 'e';
    }
  }

  // Step 1c: y -> i
  if ((m = STEP1C.exec(w))) {
    const stem = m[1];
    if (S_V.test(stem)) w = stem + 'i';
  }

  // Step 2: double suffixes
  if ((m = STEP2_RE.exec(w))) {
    const [, stem, suffix] = m;
    if (MGR0.test(stem)) w = stem + STEP2[suffix];
  }

  // Step 3
  if ((m = STEP3_RE.exec(w))) {
    const [, stem, suffix] = m;
    if (MGR0.test(stem)) w = stem + STEP3[suffix];
  }

  // Step 4: strip single suffixes when m > 1
  if ((m = STEP4_RE.exec(w))) {
    if (MGR1.test(m[1])) w = m[1];
  } else if ((m = STEP4_ION.exec(w))) {
    const stem = m[1] + m[2];
    if (MGR1.test(stem)) w = stem;
  }

  // Step 5a: trailing e
  if ((m = STEP5_E.exec(w))) {
    const stem = m[1];
    if (MGR1.test(stem) || (MEQ1.test(stem) && !CVC.test(stem))) w = stem;
  }

  // Step 5b: -ll -> -l when m > 1
  if (/ll$/.test(w) && MGR1.test(w)) w = w.slice(0, -1);

  if (firstIsY) w = 'y' + w.slice(1);
  return w;
}
