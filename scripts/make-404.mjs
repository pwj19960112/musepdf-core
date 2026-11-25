// Generates a real-404 page for Cloudflare Pages: public/404.html (English) + public/zh/404.html (Chinese).
// Self-contained on purpose (inline CSS + inline brand mark + embedded tool list) because a 404 page must not
// depend on the hashed /assets/* bundle. Runs inside `npm run build` after the page generator, before Vite.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/pages.meta.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/zh.pages.json'), 'utf8'));

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo/site.config.json'), 'utf8'));
const GA = (cfg.analytics && cfg.analytics.ga4MeasurementId) || '';
const GA_SNIPPET = !GA || /^G-X+$/.test(GA) ? '' : `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA}');</script>`;

const mark = fs
  .readFileSync(path.join(ROOT, 'public/images/brand-mark-current.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<svg /, '<svg width="26" height="26" aria-hidden="true" ');

const enName = (slug) => {
  try {
    const html = fs.readFileSync(path.join(ROOT, slug, 'index.html'), 'utf8');
    const t = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
    return t.split('—')[0].trim() || slug;
  } catch {
    return slug.replace(/-/g, ' ');
  }
};

const tools = meta.map((p) => ({
  slug: p.slug,
  group: p.group,
  en: enName(p.slug),
  zh: (zh.tools?.[p.slug]?.term || p.slug).trim(),
}));

/** The count in the 404 copy comes from the page list — never typed (see scripts/generate-seo-pages.mjs). */
const TOOL_COUNT = meta.length;

const HOT = ['merge-pdf', 'compress-pdf', 'pdf-to-word', 'heic-to-pdf', 'jpg-to-pdf', 'ocr-pdf'];
const hotLinks = (pre) =>
  HOT.filter((s) => tools.some((x) => x.slug === s)).map((s) => {
    const t = tools.find((x) => x.slug === s);
    return `<a class="t" href="${pre}${s}/">${pre ? t.zh : t.en}</a>`;
  }).join('\n      ');

const COPY = {
  en: {
    lang: 'en',
    title: 'Page not found — MusePDF',
    h1: '404 — we could not find that page',
    lead: 'The link may be outdated, or the address has a typo. Everything below works.',
    label: `Search the ${TOOL_COUNT} tools`,
    ph: 'merge, compress, heic, ocr…',
    hot: 'Popular tools',
    all: `All ${TOOL_COUNT} tools`,
    allHref: '/#all-tools',
    switchHref: '/zh/',
    switchLabel: '中文',
    none: 'No tool matches that.',
  },
  zh: {
    lang: 'zh',
    title: '页面不存在 — MusePDF',
    h1: '404 —— 没有找到这个页面',
    lead: '链接可能过期了，或者地址打错了。下面都能用。',
    label: `搜索 ${TOOL_COUNT} 个工具`,
    ph: '合并、压缩、HEIC、OCR…',
    hot: '常用工具',
    all: `全部 ${TOOL_COUNT} 个工具`,
    allHref: '/zh/',
    switchHref: '/',
    switchLabel: 'EN',
    none: '没有匹配的工具。',
  },
};

function page({ lang, pathPrefix, canonicalPrefix }) {
  const c = COPY[lang];
  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}" data-page-lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${c.title}</title>
<meta name="theme-color" content="#006DFF">
<link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<style>
  :root{--ink:#272E62;--blue:#006DFF;--card:#F1EDFF;--band:#E7F1FF}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:var(--ink);font:16px/1.6 "DM Sans",-apple-system,"Segoe UI","Noto Sans SC",system-ui,sans-serif}
  a{color:var(--blue);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{max-width:820px;margin:0 auto;padding:0 20px}
  header{padding:18px 0;border-bottom:1px solid #eef0f6}
  .brand{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--ink)}
  .btn{display:inline-block;padding:9px 16px;border-radius:10px;background:var(--blue);color:#fff;font-weight:600}
  .btn:hover{text-decoration:none;filter:brightness(1.05)}
  main{padding:56px 0 40px}
  h1{font-size:clamp(26px,5vw,40px);line-height:1.2;margin:0 0 12px}
  .lead{margin:0 0 28px;max-width:60ch}
  .code{color:var(--blue);font-weight:700}
  label{display:block;font-weight:600;margin:0 0 8px}
  .search{display:flex;gap:10px;flex-wrap:wrap}
  input[type=search]{flex:1 1 260px;padding:13px 15px;border:1px solid #d9dee9;border-radius:12px;font:inherit;background:#fff}
  input[type=search]:focus{outline:2px solid var(--band);border-color:var(--blue)}
  ul.results{list-style:none;margin:10px 0 0;padding:0;border:1px solid #eef0f6;border-radius:12px;overflow:hidden;display:none}
  ul.results.on{display:block}
  ul.results li+li{border-top:1px solid #f4f6fb}
  ul.results a{display:flex;justify-content:space-between;gap:14px;padding:11px 14px;color:var(--ink)}
  ul.results small{color:#6b7391}
  .empty{display:none;margin:10px 0 0;color:#6b7391}
  .empty.on{display:block}
  section.hot{margin:34px 0 0}
  h2{font-size:17px;margin:0 0 12px}
  .links{display:flex;flex-wrap:wrap;gap:10px}
  .t{background:var(--card);border-radius:12px;padding:10px 14px;color:var(--ink);font-weight:500}
  .t:hover{text-decoration:none;background:var(--band)}
  footer{margin-top:44px;padding:22px 0;border-top:1px solid #eef0f6;color:#6b7391;font-size:14px}
</style>${GA_SNIPPET}
</head>
<body>
<header><div class="wrap"><a class="brand" href="/">${mark}<span>MusePDF</span></a></div></header>
<div class="wrap">
  <main>
    <h1><span class="code">404</span> — ${c.h1.replace(/^404 — |^404 —— /, '')}</h1>
    <p class="lead">${c.lead}</p>
    <label for="q">${c.label}</label>
    <div class="search">
      <input id="q" type="search" placeholder="${c.ph}" autocomplete="off" aria-describedby="hint">
      <a class="btn" href="${c.allHref}">${c.all}</a>
    </div>
    <ul class="results" id="out"></ul>
    <p class="empty" id="none">${c.none}</p>
    <section class="hot">
      <h2>${c.hot}</h2>
      <div class="links">
      ${hotLinks(canonicalPrefix)}
      </div>
    </section>
    <footer>
      <a href="${c.switchHref}">${c.switchLabel}</a> · <a href="/about.html">About</a> · <a href="/faq.html">FAQ</a> · <a href="/licenses.txt">Licences</a>
    </footer>
  </main>
</div>
<script type="application/json" id="tools">${JSON.stringify(tools)}</script>
<script>
(function(){
  var data=[],prefix=${JSON.stringify(canonicalPrefix)},lang=${JSON.stringify(lang)};
  try{data=JSON.parse(document.getElementById('tools').textContent)}catch(e){}
  var input=document.getElementById('q'),out=document.getElementById('out'),none=document.getElementById('none');
  function norm(s){return (s||'').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu,'')}
  function render(list){
    out.innerHTML='';
    if(!list.length){out.classList.remove('on');none.classList.add('on');return}
    none.classList.remove('on');
    list.slice(0,8).forEach(function(t){
      var li=document.createElement('li'),a=document.createElement('a');
      a.href=prefix+t.slug+'/';
      a.innerHTML='<span>'+(["en"].indexOf(lang)>=0?t.en:t.zh)+'</span><small>'+(lang==='zh'?t.group:'')+'</small>';
      li.appendChild(a);out.appendChild(li);
    });
    out.classList.add('on');
  }
  input.addEventListener('input',function(){
    var q=norm(input.value);
    if(!q){out.classList.remove('on');none.classList.remove('on');return}
    render(data.filter(function(t){return [t.en,t.zh,t.slug,t.group].some(function(f){return norm(f).indexOf(q)>=0})}));
  });
})();
</script>
</body>
</html>
`;
}

// English 404 (also the one Cloudflare serves for unknown paths anywhere, so it self-adapts to /zh/ requests)
const en = page({ lang: 'en', pathPrefix: '', canonicalPrefix: '/' }).replace(
  '</head>',
  `<script>if(location.pathname.indexOf('/zh/')===0){var z=${JSON.stringify(
    page({ lang: 'zh', pathPrefix: '/zh/', canonicalPrefix: '/zh/' }),
  )};document.open();document.write(z);document.close();}</script>\n</head>`,
);

fs.mkdirSync(path.join(ROOT, 'public/zh'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public/404.html'), en, 'utf8');
fs.writeFileSync(path.join(ROOT, 'public/zh/404.html'), page({ lang: 'zh', pathPrefix: '/zh/', canonicalPrefix: '/zh/' }), 'utf8');
console.log(`make-404: wrote public/404.html + public/zh/404.html (${tools.length} tools indexed)`);
