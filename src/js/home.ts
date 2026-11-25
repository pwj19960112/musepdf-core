/**
 * Homepage behaviour: tool search + "drop a file, pick a tool" helper.
 *
 * Deliberately tiny and dependency-free (no lucide, no framework): the homepage must stay near-zero
 * JS so first paint is not blocked. Files are only inspected for their extension — nothing is read
 * into memory beyond the name, nothing is uploaded. The imports are the handoff store, shared with the
 * workbench's consumer (src/js/editor/handoff.ts) and pulling in nothing itself, and the language
 * runtime (src/js/i18n/init.ts), which is what the EN/中文 control in the header calls into.
 */
import { RUNTIME_STRINGS } from './i18n/runtime-strings.js';
import { apply, ensureDict, getLang, initI18n, tr } from './i18n/init.js';

initI18n();

/** The dictionary is only worth waiting for when the page is already in Chinese. */
const dictReady = (): Promise<void> => (getLang() === 'zh' ? ensureDict() : Promise.resolve());

/**
 * Both page sets exist, and the homepage is served in both (`/` and `/zh/`). Every link this module
 * builds at runtime therefore has to stay inside the set the visitor is reading — read from the page
 * itself (`<html data-page-lang>`, declared by the generator), never from a preference.
 */
const LANG_BASE = getLang() === 'zh' ? '/zh' : '';

const searchInput = document.getElementById('hp-search') as HTMLInputElement | null;
const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>('.hp-card'));

/**
 * Match normalisation: lower-case, then strip every space and punctuation mark, so "转 Word", "转word" and
 * "转/word" all collapse to one key. Letters, digits and CJK are kept — that is what makes the match
 * case-, whitespace- and punctuation-tolerant in both languages.
 */
const normaliseTerm = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Match tiers: an exact hit beats a prefix, which beats a plain substring hit. */
const MATCH_EXACT = 3;
const MATCH_PREFIX = 2;
const MATCH_SUBSTRING = 1;

function scoreField(value: string, q: string): number {
  const v = normaliseTerm(value);
  if (!v) return 0;
  if (v === q) return MATCH_EXACT;
  if (v.startsWith(q)) return MATCH_PREFIX;
  return v.includes(q) ? MATCH_SUBSTRING : 0;
}

/**
 * Best match tier for one tool against the already-normalised query. The English and 中文 name and group are
 * tried first, then every keyword/alias in the index row; only the highest tier counts, so the field order
 * does not matter.
 */
function matchScore(tool: ToolEntry, q: string): number {
  let best = Math.max(
    scoreField(tool.name, q),
    scoreField(tool.nameZh ?? '', q),
    scoreField(tool.group, q),
    scoreField(tool.groupZh ?? '', q),
  );
  for (const term of tool.terms ?? []) best = Math.max(best, scoreField(term, q));
  return best;
}

/**
 * Filter the on-page cards. Each card carries its slug, so it reuses the same bilingual index the dropdown
 * uses — typing 编辑 hides every card whose localised name, group, keyword or alias does not match.
 */
function filterCards(term: string) {
  const q = normaliseTerm(term);
  for (const card of cards) {
    const entry = card.dataset.slug ? toolIndexBySlug.get(card.dataset.slug) : undefined;
    const hit = entry ? matchScore(entry, q) > 0 : normaliseTerm(card.textContent || '').includes(q);
    card.classList.toggle('is-hidden', q.length > 0 && !hit);
  }
  // hide group sections whose grid has nothing left
  for (const grid of document.querySelectorAll<HTMLElement>('.hp-grid[data-group]')) {
    const visible = grid.querySelectorAll('.hp-card:not(.is-hidden)').length;
    const section = grid.closest('section');
    if (section) section.classList.toggle('is-hidden', visible === 0 && q.length > 0);
  }
  const heading = document.getElementById('all-tools');
  if (heading) heading.classList.toggle('is-hidden', false);
}

/* -------------------------------------------------- live tool suggestions (dropdown) */

type ToolEntry = { slug: string; name: string; group: string; nameZh?: string; groupZh?: string; terms?: string[] };

/**
 * The bilingual search index the generator emits as `<script id="hp-tools">`: one row per tool page with the
 * English and 中文 name and group plus that page's chosen keywords and the curated aliases. Reading the
 * page's own data keeps a single source of truth — no second, hand-maintained list of tool names to drift — and
 * the match sees both languages at once while `apply()` still renders each suggestion in the active one.
 */
function loadToolIndex(): ToolEntry[] {
  const node = document.getElementById('hp-tools');
  try {
    const parsed = node ? JSON.parse(node.textContent || '[]') : [];
    return Array.isArray(parsed) ? (parsed as ToolEntry[]) : [];
  } catch {
    return [];
  }
}

const toolIndex = loadToolIndex();
const toolIndexBySlug = new Map(toolIndex.map((tool) => [tool.slug, tool]));
const suggestBox = document.getElementById('hp-suggest-box');
const suggestList = document.getElementById('hp-suggest-list');
const suggestEmpty = document.getElementById('hp-suggest-empty');
let activeIndex = -1;

function closeSuggest() {
  if (suggestBox) suggestBox.hidden = true;
  if (suggestList) suggestList.textContent = '';
  activeIndex = -1;
  searchInput?.setAttribute('aria-expanded', 'false');
}

function suggestItems(): HTMLAnchorElement[] {
  return suggestList ? Array.from(suggestList.querySelectorAll<HTMLAnchorElement>('.hp-suggest-item')) : [];
}

/** Move the keyboard highlight, wrapping at both ends, and keep it in view. */
function setActive(index: number) {
  const items = suggestItems();
  if (!items.length) return;
  activeIndex = (index + items.length) % items.length;
  items.forEach((item, i) => item.classList.toggle('is-active', i === activeIndex));
  items[activeIndex].scrollIntoView({ block: 'nearest' });
}

/** Rank the index for the term: exact beats prefix beats substring, ties keep card order, top 12 shown. */
function rankTools(q: string): ToolEntry[] {
  return toolIndex
    .map((tool, order) => ({ tool, order, score: matchScore(tool, q) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 12)
    .map((hit) => hit.tool);
}

/** Rebuild the suggestion list for the current term. No term closes it; no hit shows the generated empty line. */
function renderSuggest(term: string) {
  const q = normaliseTerm(term);
  if (!suggestBox || !suggestList) return;
  if (!q) {
    closeSuggest();
    return;
  }
  const hits = rankTools(q);
  suggestList.textContent = '';
  activeIndex = -1;
  const open = () => {
    suggestBox.hidden = false;
    searchInput?.setAttribute('aria-expanded', 'true');
  };
  if (!hits.length) {
    if (suggestEmpty) suggestEmpty.hidden = false;
    open();
    return;
  }
  if (suggestEmpty) suggestEmpty.hidden = true;
  for (const tool of hits) {
    const item = document.createElement('a');
    item.className = 'hp-suggest-item';
    item.href = `${LANG_BASE}/${tool.slug}/`;
    item.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'hp-suggest-name';
    name.textContent = tool.name;
    const group = document.createElement('span');
    group.className = 'hp-suggest-group';
    group.textContent = tool.group;
    item.append(name, group);
    suggestList.append(item);
  }
  // Same seam the drop chips use: the name and group are English source strings the dictionary already holds,
  // so `apply` renders them 中文 in place while 中文 is active.
  apply(suggestList);
  open();
}

searchInput?.addEventListener('input', () => {
  const term = searchInput.value;
  filterCards(term);
  renderSuggest(term);
});

searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSuggest();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActive(activeIndex + 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActive(activeIndex - 1);
    return;
  }
  if (event.key === 'Enter') {
    const items = suggestItems();
    const target = activeIndex >= 0 ? items[activeIndex] : items[0];
    if (target) {
      event.preventDefault();
      window.location.assign(target.href);
    }
  }
});

// A click outside the field or the list dismisses it; a click on an item is left to the link itself.
document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target.closest('#hp-suggest-list') || target === searchInput)) return;
  closeSuggest();
});

/* ---------------------------------------------------------------- drop helper */

type Suggestion = { slug: string; name: string };

function loadSuggestions(): Record<string, Suggestion[]> {
  const node = document.getElementById('hp-suggest');
  try {
    return node ? JSON.parse(node.textContent || '{}') : {};
  } catch {
    return {};
  }
}

function kindOf(file: File): string {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|heic|heif|svg|gif)$/.test(name)) return 'image';
  if (/\.(docx?|rtf|odt)$/.test(name) || type.includes('word')) return 'docx';
  if (/\.(txt|md|markdown|csv|log)$/.test(name) || type.startsWith('text/')) return 'text';
  return 'other';
}

function describeFile(file: File): string {
  const kind = kindOf(file);
  const labels: Record<string, string> = {
    pdf: RUNTIME_STRINGS.labelPdf,
    image: RUNTIME_STRINGS.labelImage,
    docx: RUNTIME_STRINGS.labelWord,
    text: RUNTIME_STRINGS.labelText,
    other: RUNTIME_STRINGS.labelFile,
  };
  return labels[kind] || RUNTIME_STRINGS.labelFile;
}

/**
 * Hand a dropped/selected PDF to the workbench.
 *
 * The file itself goes into IndexedDB (a real `File` survives structured clone; sessionStorage could
 * only carry a string), then this page navigates to the text-editing workbench, which consumes the
 * record and opens the document — no second click, no upload. The handoff module is a dynamic import
 * so the homepage stays near-zero JS.
 */
function converterFor(name: string): { slug: string; label: string } | null {
  const n = name.toLowerCase();
  const table: [RegExp, string, string][] = [
    [/\.docx?$|\.[r]?tf$|\.odt$/, 'word-to-pdf', 'Word to PDF'],
    [/\.[m]d$|\.[m]arkdown$/, 'markdown-to-pdf', 'Markdown to PDF'],
    [/\.txt$|\.log$/, 'txt-to-pdf', 'Text to PDF'],
    [/\.heic$|\.heif$/, 'heic-to-pdf', 'HEIC to PDF'],
    [/\.jpe?g$/, 'jpg-to-pdf', 'JPG to PDF'],
    [/\.png$/, 'png-to-pdf', 'PNG to PDF'],
    [/\.webp$/, 'webp-to-pdf', 'WebP to PDF'],
    [/\.bmp$/, 'bmp-to-pdf', 'BMP to PDF'],
    [/\.tiff?$/, 'tiff-to-pdf', 'TIFF to PDF'],
    [/\.svg$/, 'svg-to-pdf', 'SVG to PDF'],
  ];
  for (const [re, slug, label] of table) if (re.test(n)) return { slug, label };
  return null;
}

/** Send a convertible file straight into the matching tool page — same IndexedDB hand-off as the workbench. */
async function handOffToTool(
  file: File,
  chips: HTMLElement,
  target: { slug: string; label: string },
): Promise<void> {
  const note = document.createElement('p');
  note.className = 'hp-card-desc';
  note.style.margin = '0 0 8px';
  note.textContent = tr(RUNTIME_STRINGS.openingTool)
    .replace('{name}', file.name)
    .replace('{tool}', target.label);
  chips.textContent = '';
  chips.hidden = false;
  chips.append(note);
  try {
    window.location.assign(`${LANG_BASE}/${target.slug}/`);
  } catch (error) {
    console.warn('[bentopdf] could not hand the file to the tool', error);
    note.textContent = tr(RUNTIME_STRINGS.editorUnavailable).replace('{name}', file.name);
  }
}

/** No converter exists for this format: say so, and offer a next step instead of silence. */
function renderUnsupported(file: File, chips: HTMLElement): void {
  const title = document.createElement('p');
  title.className = 'hp-card-desc';
  title.style.margin = '0 0 6px';
  title.style.fontWeight = '600';
  title.textContent = tr(RUNTIME_STRINGS.unsupportedTitle).replace('{name}', file.name);

  const body = document.createElement('p');
  body.className = 'hp-card-desc';
  body.style.margin = '0 0 10px';
  body.textContent = tr(RUNTIME_STRINGS.unsupportedBody);

  chips.textContent = '';
  chips.hidden = false;
  chips.append(title, body);
  for (const [href, label] of [
    [`${LANG_BASE}/word-to-pdf/`, 'Word to PDF'],
    [`${LANG_BASE}/image-to-pdf/`, 'Image to PDF'],
    // The count comes from the page's own index — the same list the cards and the search render from.
    [`${LANG_BASE}/`, tr(RUNTIME_STRINGS.linkAllTools).replace('{n}', String(toolIndex.length))],
  ] as [string, string][]) {
    const a = document.createElement('a');
    a.className = 'hp-chip';
    a.href = href;
    a.textContent = label;
    chips.append(a);
  }
  apply(chips);
}

async function showSuggestions(files: FileList | null) {
  const chips = document.getElementById('hp-drop-chips');
  const drop = document.getElementById('hp-drop');
  if (!chips || !drop || !files || !files.length) return;

  const first = files[0];
  const kind = kindOf(first);

  // SIZE GUARD on the homepage too. The single-PDF handoff stashes the file and navigates, so the
  // hint has to appear HERE before that happens (checking after the jump would be too late — the
  // editor page is where the read occurs). `reviewed` records that the visitor has already been
  // shown the tier and, if it was a warn, confirmed it, so the editor page does not ask twice. A
  // block-tier file never reaches the stash: nothing is read, nothing is handed over.
  const { guardFilesWithUi } = await import('./fileGuardUi.js');
  if (!(await guardFilesWithUi(files))) return;
  const reviewed = true;

  // PRIMARY BEHAVIOUR: one PDF → straight into the workbench with that document already open.
  // The file is stashed for the next page (IndexedDB, see src/js/editor/handoff.ts) and consumed by
  // the workbench entry, so there is no second click and nothing is uploaded.

  // Non-PDF drops: send convertible formats straight into the matching converter, and explain the
  // formats we cannot read in-browser instead of silently doing nothing.
  if (files.length === 1) {
    const target = converterFor(first.name);
    if (target) {
      drop.classList.add('is-over');
      void handOffToTool(first, chips, target);
      return;
    }
    if (kind === 'other') {
      drop.classList.add('is-over');
      renderUnsupported(first, chips);
      return;
    }
  }

  const suggestions = loadSuggestions()[kind] || loadSuggestions().other || [];

  const name = document.createElement('p');
  name.className = 'hp-card-desc';
  name.style.margin = '0 0 8px';

  chips.textContent = '';
  chips.hidden = false;
  chips.append(name);

  if (files.length > 1) {
    name.textContent = tr(RUNTIME_STRINGS.manyFiles).replace('{n}', String(files.length));
  } else {
    name.textContent = tr(RUNTIME_STRINGS.oneFile).replace('{label}', tr(describeFile(first)));
  }

  for (const suggestion of suggestions.slice(0, 6)) {
    const a = document.createElement('a');
    a.className = 'hp-chip';
    a.href = `${LANG_BASE}/${suggestion.slug}/`;
    a.textContent = suggestion.name;
    chips.append(a);
  }
  // The chips reuse the tool names the page already lists, so the dictionary covers them too.
  apply(chips);
  drop.classList.add('is-over');
}

const dropzone = document.getElementById('hp-drop');
const fileInput = document.getElementById('hp-drop-input') as HTMLInputElement | null;

dropzone?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('.hp-chip')) return;
  fileInput?.click();
});

for (const evt of ['dragenter', 'dragover'] as const) {
  dropzone?.addEventListener(evt, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
}
for (const evt of ['dragleave', 'drop'] as const) {
  dropzone?.addEventListener(evt, () => dropzone.classList.remove('is-over'));
}
dropzone?.addEventListener('drop', (event) => {
  event.preventDefault();
  void dictReady().then(() => showSuggestions((event as DragEvent).dataTransfer?.files ?? null));
});
fileInput?.addEventListener('change', () => {
  void dictReady().then(() => showSuggestions(fileInput.files));
});
