/**
 * Deterministic generator for the /vs/ comparison pages.
 *
 *   node scripts/generate-compare-pages.mjs
 *
 * Runs inside `npm run build` right after scripts/generate-seo-pages.mjs (which writes the sitemap,
 * the manifest and seo/i18n.pairs.json), and before make-zh-dictionary.mjs, which reads the pairs this
 * script appends. It is deliberately a SEPARATE generator from the tool pages: a comparison page has no
 * tool panel, no upload zone and no `data-tool`, so it must not go near the landing-page model.
 *
 * Outputs (repo root, so Vite builds them as extra MPA entries — the manifest below is what vite.config
 * reads). Nested slugs work: `vs/smallpdf/index.html` lands at `dist/vs/smallpdf/index.html` because
 * Vite derives the output path from the input file's path relative to the project root.
 *
 *   vs/index.html               the hub, listing both comparisons
 *   vs/smallpdf/index.html      MusePDF vs Smallpdf
 *   vs/ilovepdf/index.html      MusePDF vs iLovePDF
 *   zh/vs/…                     the same three pages in Simplified Chinese
 *
 * House rules this file keeps (see the task that created it):
 *   - capability rows only, each one checkable on the page it came from;
 *   - no "better / best / faster", no competitor logos, no invented features;
 *   - every outbound competitor link is rel="nofollow noopener";
 *   - one dated honesty line on every page: "Facts checked November 2026…".
 *
 * Bilingual by construction: `t(en, zh)` returns the English string AND registers the pair, so the
 * EN → 中文 dictionary is built at the emission site exactly like the tool pages do it, and
 * make-zh-dictionary.mjs finds a Chinese value for every English text node it extracts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p, fallback = null) => {
  const abs = path.join(ROOT, p);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : fallback;
};
const write = (p, content) => {
  const abs = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
};

const cfg = read('seo/site.config.json');
const meta = read('seo/pages.meta.json', []);
const SITE = cfg.siteUrl.replace(/\/$/, '');
const YEAR = new Date().getFullYear();
/** Distinct tool ids: two pages may share one workbench, so the page count is NOT the tool count. */
const TOOL_COUNT = new Set(meta.map((m) => m.id)).size;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = esc;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ EN → 中文 pairs */

const PAIRS = new Map();
const ATTR_PAIRS = new Map();

/**
 * Emit `en` (and register its Chinese). An English string that two call sites share must get the same
 * Chinese at both, or the dictionary would have one key with two values — a build error there, a
 * silently wrong translation on the page. So a mismatch throws here instead.
 */
function t(en, zh) {
  const key = norm(en);
  const previous = PAIRS.get(key);
  if (previous !== undefined && previous !== zh) {
    throw new Error(`compare i18n: two Chinese translations for one English string:\n  ${key}\n  A: ${previous}\n  B: ${zh}`);
  }
  PAIRS.set(key, zh);
  return en;
}
function tAttr(en, zh) {
  const key = norm(en);
  const previous = ATTR_PAIRS.get(key);
  if (previous !== undefined && previous !== zh) {
    throw new Error(`compare i18n: two Chinese translations for one attribute:\n  ${key}`);
  }
  ATTR_PAIRS.set(key, zh);
  return en;
}

/* ------------------------------------------------------------------ shared copy */

const L = (en, zh) => ({ en: t(en, zh), zh });

const SITE_NAME = 'MusePDF';
const BRAND = L('Smallpdf', 'Smallpdf');
const BRAND2 = L('iLovePDF', 'iLovePDF');

const CHECKED = L(
  'Facts checked November 2026. Competitor plans and limits change; verify on their site.',
  '事实核对时间：2026 年 11 月。竞品的套餐和限额会改变，请以对方网站为准。',
);

/** The one thing every page repeats, in each language, because it is the whole reason this exists. */
const CORE = {
  upload: {
    label: L('Upload required', '需要上传文件'),
    us: L('No — the file is opened in your browser tab', '不需要 —— 文件在你的浏览器标签页里打开'),
  },
  processed: {
    label: L('Where the file is processed', '文件在哪里处理'),
    us: L('Your own device, with JavaScript and WebAssembly', '你自己的设备上，用 JavaScript 和 WebAssembly'),
  },
  account: {
    label: L('Account needed', '需要账号吗'),
    us: L('No account, no email, no card', '不用账号、不留邮箱、不用绑卡'),
  },
  limits: {
    label: L('Limits on the free tier', '免费版有额度限制吗'),
    us: L('None — no daily cap and no file-count cap', '没有 —— 不限每日次数，也不限文件数量'),
  },
  watermark: {
    label: L('Watermark on the free tier', '免费版会加水印吗'),
    us: L('None', '无'),
  },
  price: {
    label: L('Paid tier', '付费套餐'),
    us: L('None — the tools are free, and the source is Apache-2.0', '没有 —— 工具免费，源码以 Apache-2.0 发布'),
  },
  offline: {
    label: L('Works offline', '断网还能用吗'),
    us: L('Yes, once the page has loaded', '能，页面加载完就可以离线使用'),
  },
  source: {
    label: L('Source code available', '源码公开吗'),
    us: L('Yes — Apache-2.0, in a public repository', '公开 —— Apache-2.0，代码在公开仓库里'),
  },
  tools: {
    label: L('Tools covered', '覆盖哪些工具'),
    us: L(
      `All ${TOOL_COUNT} local tools: merge, split, convert, edit, annotate, organise, optimise and secure`,
      `全部 ${TOOL_COUNT} 个本地工具：合并、拆分、转换、编辑、批注、整理、优化和安全`,
    ),
  },
};

/* ------------------------------------------------------------------ competitors */

const COMPETITORS = [
  {
    slug: 'smallpdf',
    name: BRAND,
    url: 'https://smallpdf.com/',
    pricingUrl: 'https://smallpdf.com/pricing',
    rows: {
      upload: L('Yes — tools take the file over HTTP', '需要 —— 工具通过 HTTP 接收文件'),
      processed: L('On Smallpdf servers', '在 Smallpdf 的服务器上'),
      account: L('A free plan and a 7-day Pro trial; the paid plans are account-based', '有免费版和 7 天 Pro 试用；付费套餐按账号开通'),
      limits: L('The free plan is limited; Pro is sold as unlimited processing', '免费版有额度限制；Pro 按「不限次数」出售'),
      watermark: L('Not stated on their pricing page', '对方定价页未说明'),
      price: L(
        'Pro, monthly or annual, after a 7-day free trial. The price shown depends on region, so it is not repeated here — see their pricing page.',
        'Pro 按月或按年订阅，先有 7 天免费试用。价格按地区显示，因此这里不转述具体数字 —— 请以对方定价页为准。',
      ),
      offline: L('No — the file has to reach their servers', '不能 —— 文件必须传到对方服务器'),
      source: L('No', '不公开'),
      tools: L('A hosted set of PDF tools; their site lists the current ones', '一套托管式 PDF 工具，具体清单以对方网站为准'),
    },
    checked: L(
      'We read smallpdf.com/pricing and the tool list on smallpdf.com on 20 November 2026. Smallpdf quotes a 7-day free trial and monthly or annual billing on that page.',
      '我们在 2026 年 11 月 20 日查看了 smallpdf.com/pricing 和 smallpdf.com 上的工具清单。该页面写明提供 7 天免费试用，以及按月或按年计费。',
    ),
    fit: L(
      'A hosted service can do work a browser tab cannot: very large documents, server-side processing queues and shared team storage. If that is what you need, compare their plans on their site — this page only records what differs and leaves the choice to you.',
      '托管服务能做浏览器标签页做不到的事：特别大的文档、服务器端的处理队列、团队共享存储。如果你需要的正是这些，请直接到对方网站比较套餐 —— 本页只记录差异，选择权留给你。',
    ),
  },
  {
    slug: 'ilovepdf',
    name: BRAND2,
    url: 'https://www.ilovepdf.com/',
    pricingUrl: 'https://www.ilovepdf.com/pricing',
    rows: {
      upload: L('Yes — tools take the file over HTTP', '需要 —— 工具通过 HTTP 接收文件'),
      processed: L('On iLovePDF servers', '在 iLovePDF 的服务器上'),
      account: L('Free (Basic), Premium and Business accounts', '分 Free（Basic）、Premium 和 Business 三种账号'),
      limits: L('The free plan allows limited document processing', '免费版只允许有限次数的文档处理'),
      watermark: L('Not stated on their pricing page', '对方定价页未说明'),
      price: L(
        'Premium: US$5 per month billed annually (US$60 a year), or US$9 billed monthly — read on their pricing page on 20 November 2026. Prices change, so check before you buy.',
        'Premium：按年计费时 US$5/月（全年 US$60），按月计费时 US$9/月 —— 2026 年 11 月 20 日读取自对方定价页。价格会变，购买前请再确认。',
      ),
      offline: L('No — the file has to reach their servers', '不能 —— 文件必须传到对方服务器'),
      source: L('No', '不公开'),
      tools: L('A hosted tool set that includes compress, convert, edit, sign and OCR', '托管式工具集，包含压缩、转换、编辑、签名和 OCR'),
    },
    checked: L(
      'We read ilovepdf.com/pricing on 20 November 2026: three account types, a free plan with limited document processing, and Premium at US$5 per month billed annually or US$9 billed monthly.',
      '我们在 2026 年 11 月 20 日查看了 ilovepdf.com/pricing：三种账号类型，免费版只允许有限次数的文档处理，Premium 按年计费为 US$5/月、按月计费为 US$9/月。',
    ),
    fit: L(
      'A hosted service can do work a browser tab cannot: very large documents, server-side processing queues and shared team storage. If that is what you need, compare their plans on their site — this page only records what differs and leaves the choice to you.',
      '托管服务能做浏览器标签页做不到的事：特别大的文档、服务器端的处理队列、团队共享存储。如果你需要的正是这些，请直接到对方网站比较套餐 —— 本页只记录差异，选择权留给你。',
    ),
  },
];

/* ------------------------------------------------------------------ head / chrome */

const GA_ID = String(cfg.analytics?.ga4MeasurementId || '').trim();
const GTM_ID = String(cfg.analytics?.gtmContainerId || '').trim();
const CONSENT_MODE = String(cfg.analytics?.consentMode || 'cookieless').trim();
const GA_PLACEHOLDER = /^G-X+$/.test(GA_ID);
const GA_META = GA_PLACEHOLDER
  ? '<!-- seo:analytics -->'
  : `<!-- seo:analytics -->
    <meta name="gtm-container-id" content="${attr(GTM_ID)}">
    <meta name="ga4-measurement-id" content="${attr(GA_ID)}">
    <meta name="analytics-consent-mode" content="${attr(CONSENT_MODE)}">
    <!-- Google tag (gtag.js) — official snippet, in <head> so it is visible in view-source -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${attr(GA_ID)}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${attr(GA_ID)}');
      window.__musepdfGaHead = true;
    </script>`;

const GA_BOOT = `    <!-- seo:analytics-boot -->
    <script>
    (function () {
      function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? (m.getAttribute('content') || '').trim() : ''; }
      var gtm = meta('gtm-container-id');
      var ga4 = meta('ga4-measurement-id');
      var hasGtm = gtm && !/^GTM-X+$/i.test(gtm);
      var hasGa4 = ga4 && !/^G-X+$/i.test(ga4);
      if (!hasGtm && !hasGa4) return; // nothing configured → nothing is even fetched
      var done = false;
      function wake() {
        if (done) return;
        done = true;
        var src = '/assets/analytics-v2.js'; // a variable: Vite inlines LITERAL import()s in classic scripts
        try { import(src).catch(function () {}); } catch (error) { /* no analytics is a valid outcome */ }
      }
      var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 2500); };
      addEventListener('load', function () { idle(wake); }, { once: true });
      addEventListener('pointerdown', wake, { once: true, passive: true });
      addEventListener('keydown', wake, { once: true });
    })();
    </script>`;

const ICONS = `<!-- seo:icons -->
    <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

/** Table styles: the shared CSS has no table rules, so the comparison carries its own four lines. */
const VS_STYLE = `    <style>
        .vs-table { width: 100%; border-collapse: collapse; margin: 24px 0 8px; font-size: 15px; }
        .vs-table th, .vs-table td { text-align: left; padding: 12px 14px; vertical-align: top; border-bottom: 1px solid rgba(128, 128, 128, 0.35); }
        .vs-table thead th { font-weight: 600; }
        .vs-table tbody th { font-weight: 600; width: 24%; }
        .vs-note { font-size: 14px; opacity: 0.78; }
    </style>`;

function head({ lang, title, description, canonical, enUrl, zhUrl, jsonLd }) {
  const isZh = lang === 'zh';
  return `<meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${attr(description)}">
    <link rel="canonical" href="${attr(canonical)}">
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
    <meta name="theme-color" content="${attr(cfg.themeColor)}">
    ${GA_META}
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${attr(SITE_NAME)}">
    <meta property="og:title" content="${attr(title)}">
    <meta property="og:description" content="${attr(description)}">
    <meta property="og:url" content="${attr(canonical)}">
    <meta property="og:image" content="${attr(SITE + cfg.ogImage)}">
    <meta property="og:locale" content="${isZh ? 'zh_CN' : 'en_US'}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="${attr(cfg.twitter)}">
    <meta name="twitter:title" content="${attr(title)}">
    <meta name="twitter:description" content="${attr(description)}">
    ${ICONS}
    <!-- seo:hreflang -->
    <link rel="alternate" hreflang="en" href="${attr(enUrl)}">
    <link rel="alternate" hreflang="zh-CN" href="${attr(zhUrl)}">
    <link rel="alternate" hreflang="x-default" href="${attr(enUrl)}">
    <!-- /seo:hreflang -->
    <link href="/src/css/theme.css" rel="stylesheet">
${VS_STYLE}
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

/** Root-relative path of a site page, on the side of the language the page is written in. */
const pageHref = (lang, slug) => (lang === 'zh' ? `/zh/${slug}/` : `/${slug}/`);

function langSwitch(lang, { en, zh }) {
  const current = (side) => (side === lang ? ' aria-current="page"' : '');
  return `<div class="lang-switch" data-lang-switch role="group" aria-label="${attr(tAttr('Language', '语言'))}">
                    <a class="lang-switch-btn" data-lang="en" href="${attr(en)}"${current('en')}>EN</a>
                    <a class="lang-switch-btn" data-lang="zh" href="${attr(zh)}"${current('zh')}>中文</a>
                </div>`;
}

function nav(lang, paths) {
  const home = lang === 'zh' ? '/zh/' : '/';
  return `<a class="hp-skip" href="#compare">${esc(t('Skip to the comparison', '跳到对比表格'))}</a>
    <header class="hp-nav">
        <nav class="hp-container hp-nav-row" aria-label="${attr(tAttr('Main', '主导航'))}">
            <a class="hp-brand" href="${home}" aria-label="${attr(tAttr(`${SITE_NAME} home`, `${SITE_NAME} 首页`))}">
                <img src="/images/favicon.svg" alt="" width="28" height="28">
                <span>${esc(SITE_NAME)}</span>
            </a>
            <div class="hp-nav-links">
                <a href="${home}">${esc(t('Home', '首页'))}</a>
                <a href="${pageHref(lang, 'vs')}">${esc(t('Compare', '对比'))}</a>
            </div>
            <div class="hp-nav-tools">
                ${langSwitch(lang, paths)}
                <a class="hp-btn hp-btn-ghost" href="${home}#all-tools">${esc(t('All tools', '全部工具'))}</a>
            </div>
        </nav>
    </header>`;
}

function footer(lang) {
  const home = lang === 'zh' ? '/zh/' : '/';
  const links = [
    [`/${lang === 'zh' ? 'zh/about/' : 'about.html'}`, t('About', '关于')],
    [`/${lang === 'zh' ? 'zh/faq/' : 'faq.html'}`, t('FAQ', '常见问题')],
    [pageHref(lang, 'vs'), t('Compare', '对比')],
    [`/${lang === 'zh' ? 'zh/privacy/' : 'privacy.html'}`, t('Privacy', '隐私')],
    [`/${lang === 'zh' ? 'zh/terms/' : 'terms.html'}`, t('Terms', '条款')],
  ]
    .map(([href, label]) => `<li><a href="${attr(href)}">${esc(label)}</a></li>`)
    .join('\n                    ');
  return `<footer class="hp-footer">
        <div class="hp-container">
            <div class="hp-footer-bottom">
                <span class="hp-footer-legal">${esc(t(`© ${YEAR} ${SITE_NAME}.`, `© ${YEAR} ${SITE_NAME}。`))}</span>
                <ul>
                    ${links}
                </ul>
            </div>
        </div>
    </footer>`;
}

/* ------------------------------------------------------------------ table */

/**
 * One comparison table. `rows` is a list of { label, cells: [{html, lang}] } — every cell is either a
 * plain string (escaped) or an anchor the caller already built.
 */
function table({ lang, columns, rows, caption }) {
  const headCells = columns
    .map((c) => `                    <th scope="col">${esc(c.label)}</th>`)
    .join('\n');
  const body = rows
    .map((row) => `                <tr>
                    <th scope="row">${esc(row.label)}</th>
${row.cells.map((cell) => `                    <td>${cell}</td>`).join('\n')}
                </tr>`)
    .join('\n');
  return `<table class="vs-table">
            <caption class="vs-note" style="text-align:left;padding-bottom:8px">${esc(caption)}</caption>
            <thead>
                <tr>
                    <th scope="col"></th>
${headCells}
                </tr>
            </thead>
            <tbody>
${body}
            </tbody>
        </table>`;
}

/** An outbound competitor link: always nofollow + noopener, never a logo, label always the domain. */
function outbound(url, label) {
  return `<a href="${attr(url)}" rel="nofollow noopener" target="_blank">${esc(label)}</a>`;
}

/* ------------------------------------------------------------------ pages */

/** The three-column summary used on the hub. */
function hubRows() {
  const rows = [];
  const add = (key) => {
    rows.push({
      label: CORE[key].label.en,
      cells: [
        CORE[key].us.en,
        COMPETITORS[0].rows[key].en,
        COMPETITORS[1].rows[key].en,
      ],
    });
  };
  ['processed', 'upload', 'account', 'limits', 'watermark', 'price', 'tools', 'offline', 'source'].forEach(add);
  return rows;
}

function hubZhRows() {
  const rows = [];
  const add = (key) => {
    rows.push({
      label: CORE[key].label.zh,
      cells: [
        CORE[key].us.zh,
        COMPETITORS[0].rows[key].zh,
        COMPETITORS[1].rows[key].zh,
      ],
    });
  };
  ['processed', 'upload', 'account', 'limits', 'watermark', 'price', 'tools', 'offline', 'source'].forEach(add);
  return rows;
}

const HUB = {
  en: {
    title: 'MusePDF compared with Smallpdf and iLovePDF',
    description:
      'How MusePDF, Smallpdf and iLovePDF differ on uploads, accounts, limits and price — checked against their own public pages in November 2026.',
    h1: 'How MusePDF compares with hosted PDF services',
    lead:
      'Before any feature list, two things differ: where your file goes, and what the free tier allows. The table below records those points for MusePDF, Smallpdf and iLovePDF.',
    caption: 'What each service does with a file, and what its free tier allows.',
    detail: 'Read the detail',
    detailCards: [
      ['smallpdf', 'MusePDF vs Smallpdf', 'Uploads, the free plan, the Pro trial and where the price is published.'],
      ['ilovepdf', 'MusePDF vs iLovePDF', 'Uploads, the free plan, and the two Premium prices quoted on their page.'],
    ],
    methodH:
      'What this table is, and what it is not',
    method:
      'Every cell describes a capability that can be checked on the service’s own public pages. Where a figure could not be confirmed there, the cell says so instead of guessing — and nothing here is a judgement about which service suits a particular job.',
    toolH: 'Check it against a real document',
    tool:
      'The most direct comparison is to open a tool and watch where the file goes: with MusePDF the page never makes an upload request, and you can watch that in your browser’s network panel.',
    toolLinks: [
      ['edit-text-in-pdf', 'Edit text in a PDF'],
      ['merge-pdf', 'Merge PDF'],
    ],
    jsonLdName: 'MusePDF compared with Smallpdf and iLovePDF',
    nav: 'Compare',
  },
  zh: {
    title: 'MusePDF 与 Smallpdf、iLovePDF 的对比',
    description:
      'MusePDF、Smallpdf 和 iLovePDF 在是否上传、账号、额度与价格上的差别 —— 2026 年 11 月按对方公开页面核对。',
    h1: 'MusePDF 和在线 PDF 服务有什么不同',
    lead:
      '在比较功能之前，先看两点：文件去了哪里，免费版允许做什么。下表记录 MusePDF、Smallpdf 和 iLovePDF 在这两点上的差别。',
    caption: '各家怎么处理文件，免费版允许做什么。',
    detail: '看详细对比',
    detailCards: [
      ['smallpdf', 'MusePDF 与 Smallpdf 对比', '上传、免费版、Pro 试用，以及价格公布在哪里。'],
      ['ilovepdf', 'MusePDF 与 iLovePDF 对比', '上传、免费版，以及对方页面上写明的两档 Premium 价格。'],
    ],
    methodH: '这张表是什么，不是什么',
    method:
      '每一格都是可以在对方公开页面上核对的能力。核不到具体数字的格子里写的是「未说明」，而不是猜一个数；这里也不判断哪家更适合某件具体的事。',
    toolH: '拿一份真实文档试一下',
    tool:
      '最直接的对比方式是自己打开一个工具，看文件去了哪里：用 MusePDF 时页面不会发出上传请求，你在浏览器的网络面板里就能看到。',
    toolLinks: [
      ['edit-text-in-pdf', '修改 PDF 文字'],
      ['merge-pdf', '合并 PDF'],
    ],
    jsonLdName: 'MusePDF 与 Smallpdf、iLovePDF 的对比',
    nav: '对比',
  },
};

function hubPage(lang) {
  const c = HUB[lang];
  const isZh = lang === 'zh';
  const canonical = `${SITE}${pageHref(lang, 'vs')}`;
  const enUrl = `${SITE}/vs/`;
  const zhUrl = `${SITE}/zh/vs/`;
  const rows = isZh ? hubZhRows() : hubRows();
  const columns = [
    { label: SITE_NAME },
    { label: BRAND[lang] },
    { label: BRAND2[lang] },
  ];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: c.jsonLdName,
      url: canonical,
      description: c.description,
      inLanguage: isZh ? 'zh-CN' : 'en',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      inLanguage: isZh ? 'zh-CN' : 'en',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: isZh ? '首页' : 'Home', item: `${SITE}${isZh ? '/zh/' : '/'}` },
        { '@type': 'ListItem', position: 2, name: c.nav, item: canonical },
      ],
    },
  ];
  const cards = c.detailCards
    .map(([slug, title, desc]) => `                <a class="hp-card" href="${attr(pageHref(lang, `vs/${slug}`))}">
                    <span class="hp-card-body">
                        <span class="hp-card-name">${esc(title)}</span>
                        <span class="hp-card-desc">${esc(desc)}</span>
                    </span>
                </a>`)
    .join('\n');
  const toolLinks = c.toolLinks
    .map(([slug, label]) => `<a href="${attr(pageHref(lang, slug))}">${esc(label)}</a>`)
    .join(' <span data-i18n-skip>·</span> ');

  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}" data-page-lang="${isZh ? 'zh' : 'en'}">
<head>
    ${head({ lang, title: c.title, description: c.description, canonical, enUrl, zhUrl, jsonLd })}
</head>
<body class="hp">
    ${nav(lang, { en: '/vs/', zh: '/zh/vs/' })}
    <main id="compare">
        <section class="hp-section">
            <div class="hp-container">
                <h1>${esc(c.h1)}</h1>
                <p class="hp-lead">${esc(c.lead)}</p>
                ${table({ lang, columns, rows, caption: c.caption })}
                <p class="vs-note">${esc(CHECKED[lang])}</p>
            </div>
        </section>

        <section class="hp-section">
            <div class="hp-container">
                <h2>${esc(c.detail)}</h2>
                <div class="hp-grid">
${cards}
                </div>
            </div>
        </section>

        <section class="hp-section">
            <div class="hp-container">
                <h2>${esc(c.methodH)}</h2>
                <p class="hp-section-lead">${esc(c.method)}</p>
                <h3>${esc(c.toolH)}</h3>
                <p class="hp-section-lead">${esc(c.tool)}</p>
                <p class="hp-section-lead">${toolLinks}</p>
            </div>
        </section>
    </main>
    ${footer(lang)}
    ${GA_BOOT}
</body>
</html>
`;
}

const DETAIL = {
  smallpdf: {
    en: {
      title: 'MusePDF vs Smallpdf — uploads, limits and price',
      description:
        'Side by side: where each service processes your PDF, what the free tier allows, how the Pro trial works and where Smallpdf publishes its price.',
      h1: 'MusePDF vs Smallpdf',
      lead:
        'Smallpdf is a hosted service: the file is uploaded, processed on their servers and downloaded again. MusePDF runs the same kind of job inside your browser tab. This page records that difference and the plan details that follow from it.',
      caption: 'MusePDF and Smallpdf, row by row.',
      back: 'All comparisons',
    },
    zh: {
      title: 'MusePDF 与 Smallpdf 对比：上传、额度与价格',
      description:
        '逐项对比：两边分别在哪里处理 PDF、免费版允许做什么、Pro 试用怎么算，以及 Smallpdf 把价格公布在哪里。',
      h1: 'MusePDF 与 Smallpdf 对比',
      lead:
        'Smallpdf 是托管服务：文件先上传，在对方服务器上处理，再下载回来。MusePDF 把同类操作放在你的浏览器标签页里完成。本页记录这个差别，以及由此产生的套餐细节。',
      caption: 'MusePDF 与 Smallpdf 逐行对比。',
      back: '全部对比',
    },
  },
  ilovepdf: {
    en: {
      title: 'MusePDF vs iLovePDF — uploads, limits and price',
      description:
        'Side by side: where each service processes your PDF, what the free plan allows, and the two Premium prices iLovePDF publishes on its own pricing page.',
      h1: 'MusePDF vs iLovePDF',
      lead:
        'iLovePDF is a hosted service: the file is uploaded, processed on their servers and downloaded again. MusePDF does the same kind of job in your browser tab. This page records that difference and the plan details that follow from it.',
      caption: 'MusePDF and iLovePDF, row by row.',
      back: 'All comparisons',
    },
    zh: {
      title: 'MusePDF 与 iLovePDF 对比：上传、额度与价格',
      description:
        '逐项对比：两边分别在哪里处理 PDF、免费版允许做什么，以及 iLovePDF 在自家定价页上写明的两档 Premium 价格。',
      h1: 'MusePDF 与 iLovePDF 对比',
      lead:
        'iLovePDF 是托管服务：文件先上传，在对方服务器上处理，再下载回来。MusePDF 把同类操作放在浏览器标签页里完成。本页记录这个差别，以及由此产生的套餐细节。',
      caption: 'MusePDF 与 iLovePDF 逐行对比。',
      back: '全部对比',
    },
  },
};

function detailPage(competitor, lang) {
  const isZh = lang === 'zh';
  const c = DETAIL[competitor.slug][lang];
  const slug = `vs/${competitor.slug}`;
  const canonical = `${SITE}${pageHref(lang, slug)}`;
  const enUrl = `${SITE}/vs/${competitor.slug}/`;
  const zhUrl = `${SITE}/zh/vs/${competitor.slug}/`;
  const name = competitor.name[lang];
  const keys = ['processed', 'upload', 'account', 'limits', 'watermark', 'price', 'tools', 'offline', 'source'];
  const rows = keys.map((key) => ({
    label: CORE[key].label[lang],
    cells: [CORE[key].us[lang], competitor.rows[key][lang]],
  }));
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: c.h1,
      url: canonical,
      description: c.description,
      inLanguage: isZh ? 'zh-CN' : 'en',
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE },
      about: [
        { '@type': 'SoftwareApplication', name: SITE_NAME, applicationCategory: 'UtilitiesApplication' },
        { '@type': 'SoftwareApplication', name, applicationCategory: 'UtilitiesApplication' },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      inLanguage: isZh ? 'zh-CN' : 'en',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: isZh ? '首页' : 'Home', item: `${SITE}${isZh ? '/zh/' : '/'}` },
        { '@type': 'ListItem', position: 2, name: isZh ? '对比' : 'Compare', item: `${SITE}${pageHref(lang, 'vs')}` },
        { '@type': 'ListItem', position: 3, name: c.h1, item: canonical },
      ],
    },
  ];
  const checkedLabel = competitor.checked[lang];

  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}" data-page-lang="${isZh ? 'zh' : 'en'}">
<head>
    ${head({ lang, title: c.title, description: c.description, canonical, enUrl, zhUrl, jsonLd })}
</head>
<body class="hp">
    ${nav(lang, { en: '/vs/' + competitor.slug + '/', zh: '/zh/vs/' + competitor.slug + '/' })}
    <main id="compare">
        <section class="hp-section">
            <div class="hp-container">
                <nav class="hp-breadcrumb" aria-label="${attr(tAttr('Breadcrumb', '面包屑导航'))}">
                    <ol>
                        <li><a href="${isZh ? '/zh/' : '/'}">${esc(t('Home', '首页'))}</a></li>
                        <li><a href="${attr(pageHref(lang, 'vs'))}">${esc(t('Compare', '对比'))}</a></li>
                        <li aria-current="page">${esc(name)}</li>
                    </ol>
                </nav>
                <h1>${esc(c.h1)}</h1>
                <p class="hp-lead">${esc(c.lead)}</p>
                ${table({
                  lang,
                  columns: [{ label: SITE_NAME }, { label: name }],
                  rows,
                  caption: c.caption,
                })}
                <p class="vs-note">${esc(CHECKED[lang])}</p>
            </div>
        </section>

        <section class="hp-section">
            <div class="hp-container">
                <h2>${esc(t('What we checked', '我们核对了什么'))}</h2>
                <p class="hp-section-lead">${esc(checkedLabel)}</p>
                <p class="hp-section-lead">${outbound(competitor.pricingUrl, t('Their pricing page', '对方定价页'))} <span data-i18n-skip>·</span> ${outbound(competitor.url, t('Their home page', '对方首页'))}</p>
                <h2>${esc(t('When hosted processing is the right choice', '什么时候该用托管服务'))}</h2>
                <p class="hp-section-lead">${esc(competitor.fit[lang])}</p>
                <p class="hp-section-lead"><a href="${attr(pageHref(lang, 'vs'))}">${esc(t('All comparisons', '全部对比'))}</a></p>
            </div>
        </section>
    </main>
    ${footer(lang)}
    ${GA_BOOT}
</body>
</html>
`;
}

/* ------------------------------------------------------------------ pairs for the page copy */

/**
 * The HUB / DETAIL copy is authored as {en, zh} objects, so the pair has to be registered explicitly —
 * make-zh-dictionary.mjs extracts every English text node from these pages and fails the build on one
 * with no Chinese. Walking the two trees keeps that true without wrapping every sentence in `t()`.
 */
function registerTree(en, zh) {
  if (typeof en === 'string' && typeof zh === 'string') {
    t(en, zh);
    return;
  }
  if (Array.isArray(en) && Array.isArray(zh)) {
    en.forEach((value, i) => registerTree(value, zh[i]));
    return;
  }
  if (en && zh && typeof en === 'object' && typeof zh === 'object') {
    for (const key of Object.keys(en)) registerTree(en[key], zh[key]);
  }
}
registerTree(HUB.en, HUB.zh);
for (const slug of Object.keys(DETAIL)) registerTree(DETAIL[slug].en, DETAIL[slug].zh);

/* ------------------------------------------------------------------ output */

const OUT = [];
const emit = (file, html) => {
  write(file, html);
  OUT.push(file);
};

const HUB_FILES = [
  ['vs/index.html', 'vs', hubPage('en')],
  ['zh/vs/index.html', 'zh-vs', hubPage('zh')],
];
for (const [file, name, html] of HUB_FILES) emit(file, html);

for (const competitor of COMPETITORS) {
  emit(`vs/${competitor.slug}/index.html`, detailPage(competitor, 'en'));
  emit(`zh/vs/${competitor.slug}/index.html`, detailPage(competitor, 'zh'));
}

/* ------------------------------------------------------------- manifest inputs */
const manifestPath = 'seo/pages.manifest.json';
const manifest = read(manifestPath, { inputs: {} });
const inputs = { ...manifest.inputs };
inputs.vs = 'vs/index.html';
inputs['vs-smallpdf'] = 'vs/smallpdf/index.html';
inputs['vs-ilovepdf'] = 'vs/ilovepdf/index.html';
inputs['zh-vs'] = 'zh/vs/index.html';
inputs['zh-vs-smallpdf'] = 'zh/vs/smallpdf/index.html';
inputs['zh-vs-ilovepdf'] = 'zh/vs/ilovepdf/index.html';
write(manifestPath, JSON.stringify({ inputs }, null, 2) + '\n');

/* ------------------------------------------------------------- sitemap */
const SITEMAP_PATH = 'public/sitemap.xml';
if (fs.existsSync(path.join(ROOT, SITEMAP_PATH))) {
  const sm = fs.readFileSync(path.join(ROOT, SITEMAP_PATH), 'utf8');
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [
    ['/vs/', '/zh/vs/', 'monthly', '0.7'],
    ['/vs/smallpdf/', '/zh/vs/smallpdf/', 'monthly', '0.6'],
    ['/vs/ilovepdf/', '/zh/vs/ilovepdf/', 'monthly', '0.6'],
  ];
  const rows = urls.flatMap(([en, zh, changefreq, priority]) =>
    [en, zh].map(
      (p) => `<url>\n<loc>${SITE}${p}</loc>\n<lastmod>${lastmod}</lastmod>\n<changefreq>${changefreq}</changefreq>\n<priority>${priority}</priority>\n</url>`,
    ),
  );
  const next = sm.replace(/<\/urlset>\s*$/, `${rows.join('\n')}\n</urlset>\n`);
  if (next === sm) throw new Error('sitemap.xml: could not find </urlset> to append the /vs/ URLs');
  write(SITEMAP_PATH, next);
} else {
  throw new Error('public/sitemap.xml is missing — run scripts/generate-seo-pages.mjs first');
}

/* ------------------------------------------------------------- EN → 中文 pairs */
const pairsPath = 'seo/i18n.pairs.json';
if (!fs.existsSync(path.join(ROOT, pairsPath))) {
  throw new Error('seo/i18n.pairs.json is missing — run scripts/generate-seo-pages.mjs first');
}
const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, pairsPath), 'utf8'));
const conflicts = [];
for (const [en, zh] of PAIRS) {
  const previous = pairs.strings[en];
  if (previous !== undefined && previous !== zh) conflicts.push(`${en}\n    had: ${previous}\n    new: ${zh}`);
}
if (conflicts.length) {
  throw new Error(`compare i18n: the dictionary already translates these differently:\n  ${conflicts.join('\n  ')}`);
}
for (const [en, zh] of PAIRS) pairs.strings[en] = zh;
for (const [en, zh] of ATTR_PAIRS) pairs.attrs[en] = zh;
const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const stillMissing = new Set(PAIRS.keys());
pairs.strings = sorted(pairs.strings);
pairs.attrs = sorted(pairs.attrs);
pairs.missing = (pairs.missing ?? []).filter((row) => !stillMissing.has(row.en));
write(pairsPath, JSON.stringify(pairs, null, 2) + '\n');

console.log(`generated ${OUT.length} comparison pages (${COMPETITORS.length} competitors + hub, en + zh)`);
console.log(`  ${OUT.join('\n  ')}`);
console.log(`comparison strings paired with Chinese: ${PAIRS.size} (+${ATTR_PAIRS.size} attributes)`);
