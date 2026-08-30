/**
 * Regenerates src/data/wikiArticles.ts from the markdown in wiki/.
 *
 * The in-app wiki viewer needs the documentation as JavaScript strings, because the browser
 * cannot read the repository. That file used to be a hand-copied snapshot of wiki/, and it had
 * drifted: it still carried sensitivity claims and a "+4.0 dB advantage over FT8" long after
 * those were corrected in the markdown, so the app confidently showed readers numbers the
 * project had already retracted.
 *
 * `npm run build` runs this first, so what the app displays is what the repository says.
 *
 * Usage: node scripts/generate_wiki_articles.mjs [--check]
 *   --check exits non-zero if the generated file is out of date, for CI.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const wikiDir = join(repoRoot, 'wiki');
const outputPath = join(repoRoot, 'src', 'data', 'wikiArticles.ts');

/**
 * Article metadata. `file` names the markdown in wiki/ that supplies the body; everything else
 * is presentation the markdown does not carry (ordering, category, search tags). `slug` is the
 * app's routing key and must stay stable - in-app links are built from it.
 */
const ARTICLES = [
  {
    id: "home",
    file: "Home.md",
    slug: "Home",
    title: "Wiki Home & Overview",
    category: "Getting Started",
    description: "Master index, system overview, and quick navigation matrix for z-30.",
    tags: ['overview', 'index', 'navigation', 'summary', 'introduction'],
  },
  {
    id: "first-steps",
    file: "01-New-User-Guide-&-First-Steps.md",
    slug: "01-New-User-Guide-&-First-Steps",
    title: "01. New User Guide & First Steps",
    category: "Getting Started",
    description: "Step-by-step onboarding for new operators: setup wizard, audio calibration, time sync, and first QSO.",
    tags: ['new user', 'first steps', 'tutorial', 'qso', 'wizard', 'beginner', 'audio setup'],
  },
  {
    id: "developer-setup",
    file: "02-Developer-Setup-&-Contributing.md",
    slug: "02-Developer-Setup-&-Contributing",
    title: "02. Developer Setup & Contributing",
    category: "Developer Guide",
    description: "Development environment configuration, test suites, architecture, and contribution guidelines.",
    tags: ['developer', 'contributing', 'build', 'tests', 'setup', 'git', 'pull request', 'architecture'],
  },
  {
    id: "dsp-spec",
    file: "03-DSP-&-Physical-Layer-Specification.md",
    slug: "03-DSP-&-Physical-Layer-Specification",
    title: "03. DSP & Physical Layer Specification",
    category: "Protocol & DSP",
    description: "Complete physical layer mathematical specifications: 16-MFSK, 50 Hz bandwidth, 75-symbol frame, and Costas sync.",
    tags: ['dsp', 'physics', 'modulation', '16-mfsk', 'costas', 'frequency', 'snr', 'awgn'],
  },
  {
    id: "ldpc-fec",
    file: "04-Forward-Error-Correction-&-LDPC.md",
    slug: "04-Forward-Error-Correction-&-LDPC",
    title: "04. Forward Error Correction & LDPC",
    category: "Protocol & DSP",
    description: "63-bit Radix-37/27 message packing, CRC-14 polynomial, and Systematic Rate-0.356 IRA LDPC (216, 77) Belief Propagation decoder.",
    tags: ['ldpc', 'fec', 'crc', 'radix-37', 'belief propagation', 'min-sum', 'tanner graph'],
  },
  {
    id: "sic-engine",
    file: "05-Successive-Interference-Cancellation-(SIC).md",
    slug: "05-Successive-Interference-Cancellation-(SIC)",
    title: "05. Successive Interference Cancellation (SIC)",
    category: "Protocol & DSP",
    description: "3-Pass Successive Interference Cancellation engine for recovering buried weak DX signals under co-channel kilowatt signals.",
    tags: ['sic', 'interference cancellation', 'co-channel', 'collision recovery', 'subtraction', 'dx'],
  },
  {
    id: "cat-ptt-wiring",
    file: "06-Transceiver-CAT-Control-&-PTT-Wiring.md",
    slug: "06-Transceiver-CAT-Control-&-PTT-Wiring",
    title: "06. Transceiver CAT Control & PTT Wiring",
    category: "Hardware & Rig Control",
    description: "Hamlib rigctld setup, serial configurations, and comprehensive wiring diagrams for 9 supported PTT keying methods.",
    tags: ['cat', 'hamlib', 'ptt', 'wiring', 'digirig', 'signalink', 'gpio', 'raspberry pi', 'winkeyer', 'tci'],
  },
  {
    id: "rf-time-sync",
    file: "07-RF-Time-Synchronization-Engine.md",
    slug: "07-RF-Time-Synchronization-Engine",
    title: "07. RF Time Synchronization Engine",
    category: "Hardware & Rig Control",
    description: "Sub-millisecond radio frequency time synchronization against international standards (WWV, CHU, DCF77, MSF, WWVB, JJY).",
    tags: ['time sync', 'wwv', 'chu', 'dcf77', 'msf', 'jjy', 'clock drift', 'fir filter', 'field ops'],
  },
  {
    id: "web-pwa",
    file: "08-Web-&-PWA-Architecture.md",
    slug: "08-Web-&-PWA-Architecture",
    title: "08. Web & PWA Architecture",
    category: "Advanced & Packaging",
    description: "Frontend internals: React 19, TypeScript, Web Audio API 12/48 kHz DSP, 60 FPS HTML5 Canvas waterfall, and PWA caching.",
    tags: ['react', 'typescript', 'web audio', 'canvas', 'waterfall', 'pwa', 'service worker'],
  },
  {
    id: "packaging",
    file: "09-Cross-Platform-Build-&-Packaging.md",
    slug: "09-Cross-Platform-Build-&-Packaging",
    title: "09. Cross-Platform Build & Packaging",
    category: "Advanced & Packaging",
    description: "Packaging and build instructions for Ubuntu, Arch Linux PKGBUILD, Windows .bat / .exe, Android Termux, and Raspberry Pi.",
    tags: ['packaging', 'ubuntu', 'arch linux', 'pkgbuild', 'windows', 'android', 'termux', 'raspberry pi', 'digipi'],
  },
  {
    id: "troubleshooting",
    file: "10-Troubleshooting-&-FAQ.md",
    slug: "10-Troubleshooting-&-FAQ",
    title: "10. Troubleshooting & FAQ",
    category: "Getting Started",
    description: "Frequently asked questions, common audio soundcard setup issues, Windows Python PATH fixes, CAT permission fixes, and ALC level calibration.",
    tags: ['faq', 'troubleshooting', 'errors', 'windows', 'python', 'audio', 'alc', 'permissions', 'dialout', 'linux'],
  },
  {
    id: "physics-vs-ft8",
    file: "11-Physics-&-Comparative-Analysis-z30-vs-FT8.md",
    slug: "11-Physics-&-Comparative-Analysis-z30-vs-FT8",
    title: "11. Physics & Comparative Analysis: z-30 vs. FT8",
    category: "Protocol & DSP",
    description: "Communication physics, the Shannon limit, 16-MFSK against 8-MFSK, and an honest account of what z-30's benchmark does and does not measure.",
    tags: ['physics', 'ft8', 'shannon', 'snr', 'link budget', 'rf engineers', 'advanced', '16-mfsk', 'ldpc', 'sic', 'polar flutter', 'coherence'],
  },
  {
    id: "github-updates",
    file: "12-Software-Updates-&-GitHub-Sync.md",
    slug: "10-Software-Updates-&-GitHub-Sync",
    title: "10. Software Updates & GitHub Upstream Sync",
    category: "Advanced & Packaging",
    description: "How to check for updates, sync upstream git commits from themantas1994/z-30, and perform zero-downtime updates across Linux, Windows, Android, and Web PWA.",
    tags: ['update', 'github', 'git', 'sync', 'upgrade', 'releases', 'pwa', 'termux', 'ubuntu', 'arch'],
  },
];

/** Escapes markdown for embedding in a TypeScript template literal. */
function escapeForTemplateLiteral(text) {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function generate() {
  const missing = ARTICLES.filter((a) => !existsSync(join(wikiDir, a.file)));
  if (missing.length > 0) {
    console.error(`Missing wiki source files: ${missing.map((a) => a.file).join(', ')}`);
    process.exit(1);
  }

  const body = ARTICLES.map((article) => {
    const markdown = readFileSync(join(wikiDir, article.file), 'utf8');
    return `  {
    id: ${JSON.stringify(article.id)},
    slug: ${JSON.stringify(article.slug)},
    title: ${JSON.stringify(article.title)},
    category: ${JSON.stringify(article.category)},
    description: ${JSON.stringify(article.description)},
    tags: ${JSON.stringify(article.tags)},
    markdown: \`${escapeForTemplateLiteral(markdown)}\`,
  },`;
  }).join('\n');

  return `/**
 * Wiki articles for the in-app documentation viewer.
 *
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Edit the markdown under wiki/ instead, then regenerate with: npm run generate:wiki
 *
 * The browser cannot read the repository, so the viewer needs the documentation as strings.
 * This is produced from wiki/ at build time; it used to be a hand-copied snapshot that had
 * drifted from the markdown it mirrored.
 */

export interface WikiArticle {
  /** Stable identifier. */
  id: string;
  /** Routing key used by in-app links; matches the GitHub wiki page name. */
  slug: string;
  /** Display title. */
  title: string;
  /** Grouping in the article list. */
  category: 'Getting Started' | 'Developer Guide' | 'Protocol & DSP' | 'Hardware & Rig Control' | 'Advanced & Packaging';
  /** One-line summary shown in the index. */
  description: string;
  /** Verbatim contents of the corresponding file in wiki/. */
  markdown: string;
  /** Free-text search keywords. */
  tags: string[];
}

export const WIKI_ARTICLES: WikiArticle[] = [
${body}
];
`;
}

const generated = generate();

if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== generated) {
    console.error('src/data/wikiArticles.ts is out of date. Run: npm run generate:wiki');
    process.exit(1);
  }
  console.log('src/data/wikiArticles.ts is up to date.');
} else {
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`Wrote ${outputPath}`);
}
