/**
 * Copy render check over CDP — proves the new "local by default" lines actually render in BOTH
 * languages on the pages the round changed.
 *
 *   node scripts/verify-copy.mjs --cdp 9445
 *
 * Attaches to a Chrome you started yourself (see scripts/verify-gtm.mjs for the recipe) and needs the
 * preview server on http://localhost:4173. For each page it reads the visible text in English, then
 * clicks the EN/中文 control and reads it again in 中文, asserting every expected line is present.
 */
const args = process.argv.slice(2);
const argValue = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const PORT = Number(argValue('--cdp', '9445'));
const BASE = argValue('--base', 'http://localhost:4173');

const { Cdp } = await import('./cdp-lib.mjs');
const { setTimeout: sleep } = await import('node:timers/promises');

const results = [];
const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
};

const PAGES = [
    {
        path: '/',
        en: [
            '61 PDF tools that run in your browser — local by default',
            'Local mode is the default: no upload, no account, no watermark.',
            'Local by default',
            'Local by default, on your device',
            'Two modes, one site',
            'Local mode — the default',
            'Cloud mode — optional, metered',
            'The 61 local tools are free with no signup, no watermark and no daily limit.',
            'For the 61 local tools, no — they run in your browser and your file stays on your device.',
            'What happens to my file when I use a cloud feature?',
            'Free, private PDF tools that run in your browser. 61 tools, local by default, no account.',
        ],
        zh: [
            '61 个 PDF 工具，直接在浏览器里运行 —— 默认本地处理',
            '默认就是本地模式：不上传、不需注册、不加水印。',
            '默认本地处理',
            '默认本地，在你的设备上',
            '两种模式，一个站点',
            '云端模式 —— 可选、按量计费',
            '这 61 个本地工具免费，不用注册、不加水印、没有每日次数限制。',
            '使用云端功能时，我的文件会怎样？',
            '免费、私密的 PDF 工具，直接在浏览器里运行。61 个工具，默认本地处理，不用账号。',
        ],
    },
    {
        path: '/merge-pdf/',
        en: [
            'Merge PDF',
            'no upload, no signup, no watermark.',
            'for this tool, nothing is sent to a server.',
        ],
        zh: ['合并 PDF', '不上传、不注册、不加不印水印。', '这个工具不会把内容发送到服务器。'],
    },
    {
        path: '/privacy.html',
        en: [
            'For the local tools we do not and cannot view, access, store or share your documents',
            'The local tools do not upload your files to a server for processing.',
            'Because the local tools run client-side, we are technically incapable of collecting',
            'Files used with the local tools are not transmitted over the internet to our servers',
        ],
        zh: [
            '我们无法查看、访问、存储或分享你的文档',
            '本地工具不会把你的文件上传到服务器处理。',
            '由于本地工具在客户端运行，我们在技术上无法收集以下信息：',
            '本地工具处理的文件不会通过网络传输到我们的服务器',
        ],
    },
    {
        path: '/terms.html',
        en: ['For the local tools, no files or data are uploaded to or stored on our servers: they execute entirely within your web browser.'],
        zh: ['对本地工具而言，不会把任何文件或数据上传到我们的服务器，也不会在其中存储：它们完全在你的浏览器内执行。'],
    },
    {
        path: '/faq.html',
        en: [
            'The 61 local tools are completely free, with no hidden fees, no subscription and no usage limits.',
            'For the local tools there is no artificial cap on file size or usage',
            'inside your browser, so for these tools your data stays on your machine.',
            'What happens to my file when I use a cloud feature?',
        ],
        zh: [
            '这 61 个本地工具完全免费：没有隐藏费用、没有订阅、也没有使用次数限制。',
            '本地工具不设人为的文件大小或使用次数上限',
            '使用云端功能时，我的文件会怎样？',
        ],
    },
    {
        path: '/about.html',
        en: ['keeps its core tools free', 'Local mode is our default: the 61 core tools process everything in your browser', 'Completely Free Core', 'No Account for Local Tools'],
        zh: ['核心工具完全免费', '本地工具不用账号', '本地模式是我们的默认项：61 个核心工具全部在你的浏览器里处理'],
    },
];

/**
 * The expected copy carries the tool COUNT, which moves with seo/pages.meta.json. Rewriting "61" here
 * keeps the assertions about wording rather than about a number that is derived elsewhere (the
 * generator's TOOL_COUNT, asserted at build time).
 */
const TOOL_COUNT = JSON.parse(fs.readFileSync('seo/pages.meta.json', 'utf8')).length;
const withCount = (text) => text.replace(/\b61\b/g, String(TOOL_COUNT));
for (const target of PAGES) {
    target.en = target.en.map(withCount);
    target.zh = target.zh.map(withCount);
}

const cdp = await Cdp.attachPage(PORT, { url: 'about:blank' });
await cdp.send('Page.enable');
await cdp.send('Network.enable');

/**
 * All visible-or-hidden copy in the page, whitespace-collapsed. `textContent` (not `innerText`) so a
 * collapsed `<details>` answer is still checked — the i18n runtime swaps text nodes regardless of
 * visibility, which is exactly what we want to prove.
 */
const text = async () =>
    cdp.eval(
        `(() => {
            const clone = document.body.cloneNode(true);
            clone.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
            return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
        })()`,
    );
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

for (const page of PAGES) {
    const url = `${BASE}${page.path}`;
    await cdp.goto(url);
    await sleep(600);
    const en = await text();
    for (const line of page.en) {
        check(`EN  ${page.path}: "${line.slice(0, 48)}${line.length > 48 ? '…' : ''}"`, en.includes(norm(line)));
    }

    // Switch to 中文 via the page's own control, then read the swapped copy.
    const clicked = await cdp.eval(`(() => { const b = document.querySelector('[data-lang="zh"]'); if (!b) return 'none'; b.click(); return 'ok'; })()`);
    if (clicked !== 'ok') {
        check(`ZH  ${page.path}: language control present`, false, clicked);
        continue;
    }
    await cdp.waitFor('document.documentElement.lang.startsWith("zh")', { timeoutMs: 15000, label: 'zh switch' });
    await sleep(1200);
    const zh = await text();
    for (const line of page.zh) {
        check(`ZH  ${page.path}: "${line.slice(0, 44)}${line.length > 44 ? '…' : ''}"`, zh.includes(norm(line)));
    }
    // Restore English so the next page starts clean.
    await cdp.eval(`(() => { const b = document.querySelector('[data-lang="en"]'); if (b) b.click(); return 'ok'; })()`);
    await sleep(400);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILURES:\n${failed.map((f) => `  - ${f.label} ${f.detail}`).join('\n')}` : ''}`);
await cdp.close();
process.exit(failed.length ? 1 : 0);
