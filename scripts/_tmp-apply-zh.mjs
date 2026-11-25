/**
 * One-off: apply this round's EN→中文 dictionary mutations to seo/i18n.zh.json and
 * seo/i18n.tools.json. Deleted after use (the durable writers are generate-seo-pages.mjs +
 * make-zh-dictionary.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZH_PATH = path.join(ROOT, 'seo/i18n.zh.json');
const TOOLS_PATH = path.join(ROOT, 'seo/i18n.tools.json');
const zh = JSON.parse(fs.readFileSync(ZH_PATH, 'utf8'));
const tools = JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf8'));

const log = { added: 0, replaced: 0, removed: 0, toolsKeys: 0 };

/* ------------------------------------------------------------------ strings: remove (retired) */
const REMOVE_STRINGS = [
  // Replaced sentences (page copy that moved to a "local by default" phrasing).
  'Merge, split, compress, sign, convert and edit PDFs right here in your browser. Nothing is sent to a server, nothing needs an account, and nothing is watermarked.',
  'Every tool runs with JavaScript and WebAssembly in your own browser tab. There is no upload step, no server-side copy and nothing left behind to delete.',
  'No account, no trial, no watermark and no daily cap. The project is open source under Apache-2.0, so you can read every line of what runs.',
  'Your document is read locally by the browser. Nothing is uploaded, so confidential files stay confidential.',
  'Your files stay on your device',
  'Yes. Every tool is free with no signup, no watermark and no daily limit.',
  'No. All processing happens in your browser, so your files never leave your device.',
  'To provide the most comprehensive PDF toolbox that respects your privacy and never asks for payment. We believe essential document tools should be accessible to everyone, everywhere, without barriers.',
  'In an era where data is a commodity, we take a different approach. All processing for MusePDF tools happens locally in your browser. This means your files never touch our servers, we never see your documents, and we don\'t track what you do. Your documents remain completely and unequivocally private. It\'s not just a feature; it\'s our foundation.',
  'No trials, no subscriptions, no hidden fees, and no "premium" features held hostage. We believe powerful PDF tools should be a public utility, not a profit center.',
  'Start using any tool immediately. We don\'t need your email, a password, or any personal information. Your workflow should be frictionless and anonymous.',
  'Completely Free',
  'No Account Required',
  'This is the most important feature of MusePDF. All processing happens 100% locally in your web browser. Your files are never uploaded to any server, which means we—or anyone else—can never see them. Your privacy is guaranteed.',
  'Yes, it\'s completely free, and there\'s no catch. There are no hidden fees, no subscription plans, no usage limits, and no premium-only features. We believe essential tools should be accessible to everyone.',
  'No, we do not impose any artificial limits on file size, the number of files, or how many times you can use a tool. The only practical limitation is the processing power and memory of your own computer, as very large or complex files may take longer to process.',
  'that are compiled to run efficiently in your browser via WebAssembly. This allows for powerful, server-like processing without your data ever leaving your machine.',
  'We care about your privacy. MusePDF uses Google Analytics 4 to count anonymous visits and see which tools are used — never personal information. Analytics loads only after the page has finished loading, starts with consent denied (no cookies, no identifier), and never receives a file name, file content or search text. You can allow or deny it at any time from the link in the footer.',
  '. We do not and cannot view, access, store, or share your documents. All PDF processing occurs entirely on your own computer, within your web browser (client-side).',
  'Unlike other online PDF services, MusePDF does not upload your files to a server for processing. The tools you use are powered by JavaScript and WebAssembly libraries that run directly on your device. This means your data never leaves your computer, providing you with the highest level of privacy and security.',
  'Because of our client-side architecture, we are technically incapable of collecting the following information:',
  'We use Google Analytics 4 (GA4) to count anonymous visits and see which tools are used. It is loaded only after the page has finished loading, and it starts with analytics consent denied: until you allow it, GA4 sets no cookies and receives no identifier for you. No file name, file content, page text or search text is ever sent. You can allow or deny analytics at any time from the link in the footer of every page.',
  'Since your files are never transmitted over the internet to our servers, you are protected from potential data breaches during transit or storage on a server. The security of your documents is in your hands and protected by the security of your own computer and web browser.',
  'MusePDF provides a suite of client-side tools for processing and manipulating Portable Document Format (PDF) files. All operations performed by the Service are executed locally within your web browser.',
  'No files or data are uploaded to or stored on our servers.',
  // The retired consent control + its copy.
  'Analytics: off',
  'Analytics: on',
  'Google Analytics 4 — anonymous visit counts only. No cookie and no identifier until you allow it.',
  // Dead keys (doc §E): absolutes left over from the pre-redesign homepage.
  '100% client-side, your files never leave your device.',
  'All tools, no trials, no paywalls.',
  'Forever Free',
  'Fast, Secure and Forever Free.',
  'Start Using - Forever Free',
  'No Limits',
  'Unlimited Use',
  'No Uploads',
  'Handle unlimited PDFs in one go.',
  'Your data never leaves your device',
];
for (const key of REMOVE_STRINGS) {
  if (key in zh.strings) {
    delete zh.strings[key];
    log.removed += 1;
  }
}

/* ------------------------------------------------------------------ strings: add / replace */
const ADD_STRINGS = {
  'Local by default': '默认本地处理',
  'Merge, split, compress, sign, convert and edit PDFs right here in your browser. Local mode is the default: no upload, no account, no watermark.': '直接在浏览器里合并、拆分、压缩、签名、转换和编辑 PDF。默认就是本地模式：不上传、不需注册、不加水印。',
  'Local by default, on your device': '默认本地，在你的设备上',
  'Every one of the 61 tools runs with JavaScript and WebAssembly in your own browser tab. In local mode there is no upload step and no server-side copy. Cloud features — only the ones you choose — are the single labelled exception.': '全部 61 个工具都在你自己的浏览器标签页里用 JavaScript 和 WebAssembly 运行。本地模式下没有上传环节，也不会产生服务器副本。唯一的例外是云端功能 —— 而且只有你主动选择时才会用到，各自的页面会写清楚。',
  'No account, no trial, no watermark and no daily cap for the 61 local tools. The project is open source under Apache-2.0, so you can read every line of what runs.': '这 61 个本地工具不用注册、没有试用期、不加水印，也没有每日次数上限。项目基于 Apache-2.0 开源，运行的每一行代码你都能查阅。',
  'Your document is read locally in your browser. In local mode nothing is uploaded, so confidential files stay confidential.': '文件由浏览器在本地读取。本地模式下不上传，所以机密文件依然机密。',
  'Two modes, one site': '两种模式，一个站点',
  'Local mode — the default': '本地模式 —— 默认',
  'All 61 tools run in your browser with JavaScript and WebAssembly. Your file is opened on your device and not sent anywhere: free, unlimited, no account. Nothing to install.': '全部 61 个工具都在你的浏览器里用 JavaScript 和 WebAssembly 运行。文件在你本机打开，不发送到任何地方：免费、不限次、无需账号。也不用安装任何东西。',
  'Cloud mode — optional, metered': '云端模式 —— 可选、按量计费',
  'Some features will need more power than a browser tab can give — talking to a PDF, translation, table extraction, OCR, PDF to PowerPoint, and very large files. When you choose one of those, the file (or the part of its text that step needs) is uploaded for that step only. They are labelled and metered, and they only ever run when you pick them.': '有些功能需要浏览器标签页给不了的算力 —— 与 PDF 对话、翻译、表格提取、OCR、PDF 转 PPT，以及超大文件。当你选择其中一项时，文件（或那一步需要的那部分文本）会为该步骤上传。它们都会明确标注、按用量计费，而且只在你主动选择时才会运行。',
  'The 61 local tools are free with no signup, no watermark and no daily limit. Optional cloud features cost server time, so they are metered and some will be paid.': '这 61 个本地工具免费，不用注册、不加水印、没有每日次数限制。可选的云端功能会消耗服务器资源，因此按用量计费，部分会收费。',
  'For the 61 local tools, no — they run in your browser and your file stays on your device. Optional cloud features (AI, very large files) upload the file, or the text they need, for that step only.': '这 61 个本地工具不会上传 —— 它们在浏览器里运行，文件留在你的设备上。可选的云端功能（AI、超大文件）会为该步骤上传文件或它需要的文本。',
  'What happens to my file when I use a cloud feature?': '使用云端功能时，我的文件会怎样？',
  'It is used only to produce your result for that one step, and cloud steps are always opt-in.': '它只用于完成那一步的结果，而且云端步骤始终由你主动触发。',
  'It is used only to produce your result for that one step, and cloud steps are always opt-in. A cloud feature uploads the file, or the part of its text it needs, for that step only — and it never runs unless you choose it.': '它只用于完成那一步的结果，而且云端步骤始终由你主动触发。云端功能会为该步骤上传文件或它需要的文本 —— 只有你主动选择时才会运行。',
  'To provide the most comprehensive PDF toolbox that respects your privacy and keeps its core tools free. We believe essential document tools should be accessible to everyone, everywhere, without barriers.': '提供最全面的 PDF 工具箱，尊重你的隐私，并让核心工具保持免费。我们认为常用的文档工具应该人人可用、随处可用，没有任何门槛。',
  'In an era where data is a commodity, we take a different approach. Local mode is our default: the 61 core tools process everything in your browser, so for those tools your files stay on your device and are not sent to a server. Cloud features, when you choose them, are the labelled exception.': '在数据被当成商品的年代，我们选择另一条路。本地模式是我们的默认项：61 个核心工具全部在你的浏览器里处理，文件留在你的设备上，不会发送到服务器。云端功能是你主动选择时才出现的例外，并且会明确标注。',
  'Completely Free Core': '核心工具完全免费',
  'No trials, no subscriptions and no hidden fees for the 61 core tools. They are a public utility, not a profit center.': '61 个核心工具没有试用期、没有订阅、没有隐藏费用。它们是公共设施，不是赚钱机器。',
  'No Account for Local Tools': '本地工具不用账号',
  'Start using any of the 61 local tools immediately — no email, no password, no personal information.': '打开即用这 61 个本地工具 —— 不用邮箱、不用密码、不要任何个人信息。',
  'This is the most important feature of MusePDF. The 61 local tools run 100% in your browser, so your file is processed on your device and is not uploaded. A few optional cloud features (AI, very large files) send the file, or the text they need, to our servers for that step only; they are labelled, they run only when you pick them, and nothing is uploaded until you do.': '这是 灵犀PDF 最重要的特性。61 个本地工具 100% 在你的浏览器里运行，文件在你的设备上处理，不会被上传。少数可选的云端功能（AI、超大文件）会为该步骤把文件或它需要的文本发送到我们的服务器；这些功能都会明确标注、只在你主动选择时运行，你不选就不会有任何上传。',
  'The 61 local tools are completely free, with no hidden fees, no subscription and no usage limits. Optional cloud features consume server time, so they are metered by usage — some will be paid once they launch.': '这 61 个本地工具完全免费：没有隐藏费用、没有订阅、也没有使用次数限制。可选的云端功能会消耗服务器资源，因此按用量计费 —— 上线后部分会收费。',
  "For the local tools there is no artificial cap on file size or usage — the only practical limit is your own computer's memory, so very large files take longer. If a file is too large for your browser to handle, the tool tells you before it starts.": '本地工具不设人为的文件大小或使用次数上限 —— 唯一的实际限制是你自己电脑的内存，所以超大文件会更慢。如果文件大到浏览器处理不了，工具会在开始前提示你。',
  'that are compiled to run efficiently in your browser via WebAssembly. This allows for powerful, server-like processing inside your browser, so for these tools your data stays on your machine.': '这类 JavaScript 库通过 WebAssembly 编译后在浏览器里高效运行，让浏览器内也能有接近服务器的处理能力 —— 对这些工具来说，数据留在你自己的电脑上。',
  'We care about your privacy. MusePDF uses Google Analytics (through Google Tag Manager) to count anonymous visits and see which tools are used — no personal information. Analytics loads only after the page has finished loading and runs in cookieless mode (no cookie, no identifier), and it does not receive a file name, file content or search text.': '我们重视你的隐私。MusePDF 通过 Google Tag Manager 使用 Google Analytics 统计匿名访问量、了解哪些工具被使用 —— 不涉及个人信息。分析代码只在页面加载完成后才载入，并以无 Cookie 模式运行（不写 Cookie、不含标识符），也不会收到文件名、文件内容或搜索文本。',
  '. For the local tools we do not and cannot view, access, store or share your documents; all processing happens on your own computer, within your web browser (client-side). Optional cloud features are described in section 4.': '。对本地工具而言，我们无法查看、访问、存储或分享你的文档；所有处理都在你自己的电脑、你的浏览器里完成（客户端处理）。云端功能见第 4 节。',
  'The local tools do not upload your files to a server for processing. They are powered by JavaScript and WebAssembly that run directly on your device, so for these tools your data stays on your computer. Optional cloud features — AI, very large files — send the file, or the text they need, to our servers for that step only.': '本地工具不会把你的文件上传到服务器处理。它们由直接在你设备上运行的 JavaScript 和 WebAssembly 驱动，所以对这些工具来说，数据留在你的电脑上。可选的云端功能（AI、超大文件）会为该步骤把文件或它需要的文本发送到我们的服务器。',
  'Because the local tools run client-side, we are technically incapable of collecting the following information:': '由于本地工具在客户端运行，我们在技术上无法收集以下信息：',
  'We use Google Analytics (through Google Tag Manager) to count anonymous visits and see which tools are used. It is loaded only after the page has finished loading, and it runs in cookieless mode: GA4 writes no cookie and receives no identifier that survives your visit. No file name, file content, page text or search text is sent.': '我们通过 Google Tag Manager 使用 Google Analytics 统计匿名访问量、了解哪些工具被使用。它只有在页面加载完成之后才会被载入，并以无 Cookie 模式运行：GA4 不写 Cookie，也不会收到任何能延续到你这次访问之外的标识符。文件名、文件内容、页面文本和搜索文本都不会被发送。',
  'Files used with the local tools are not transmitted over the internet to our servers, so you are protected from potential data breaches in transit or in storage. The security of your documents is in your hands and protected by the security of your own computer and web browser.': '本地工具处理的文件不会通过网络传输到我们的服务器，因此你不必担心传输或存储环节的数据泄露。文档的安全掌握在你自己手里，由你自己的电脑和浏览器的安全性来保障。',
  'MusePDF provides a suite of client-side tools for processing and manipulating Portable Document Format (PDF) files. For the local tools, no files or data are uploaded to or stored on our servers: they execute entirely within your web browser. Any optional cloud features are the only exception, and they only run when you choose them.': '灵犀PDF 提供一套客户端工具，用于处理和操作 PDF（便携式文档格式）文件。对本地工具而言，不会把任何文件或数据上传到我们的服务器，也不会在其中存储：它们完全在你的浏览器内执行。任何可选的云端功能是唯一的例外，且仅在你主动选择时运行。',
};
for (const [key, value] of Object.entries(ADD_STRINGS)) {
  if (key in zh.strings) log.replaced += 1;
  else log.added += 1;
  zh.strings[key] = value;
}

/* ------------------------------------------------------------------ templates */
if (zh.templates) {
  zh.templates.homeH1 = '{n} 个 PDF 工具，直接在浏览器里运行 —— 默认本地处理';
  zh.templates.bandPrivacy = '文件在本地用 JavaScript 和 WebAssembly 读取 —— 这个工具不会把内容发送到服务器。';
  zh.templates.footerTagline = '免费、私密的 PDF 工具，直接在浏览器里运行。{n} 个工具，默认本地处理，不用账号。';
}

/* ------------------------------------------------------------------ faq variant 0 privacy answer */
if (zh.faq?.variants?.[0]) {
  zh.faq.variants[0].privacyA =
    '不会。{nameZh} 完全在你的浏览器里用 JavaScript 和 WebAssembly 运行，文件在你的设备上处理，这个工具不会上传。合同、发票、证件以及任何受保密协议约束的文件都适用。';
}

/* ------------------------------------------------------------------ runtime */
if (zh.runtime) {
  delete zh.runtime['Opening the PDF editor with “{name}” — nothing is uploaded.'];
  delete zh.runtime['{label} — pick the tool you need. Nothing has been uploaded.'];
  zh.runtime['Opening the PDF editor with “{name}” — this tool does not upload.'] =
    '正在用“{name}”打开 PDF 编辑器 —— 这个工具不会上传。';
  zh.runtime['{label} — pick the tool you need. Nothing has been uploaded for this tool.'] =
    '{label} —— 挑一个你要用的工具。这个工具没有收到任何上传。';
}

/* ------------------------------------------------------------------ keepEnglish (drop the §E absolutes) */
if (Array.isArray(zh.keepEnglish)) {
  const DROP = new Set([
    'No. We never store, track, or log your files. Everything you do on MusePDF happens in your browser memory and disappears once you close the page. There are no uploads, no history logs, and no servers involved.',
    'Your files are as secure as possible because they **never leave your computer**. All processing happens directly in your web browser (client-side). We never upload your files to a server, so you maintain complete privacy and control over your documents.',
  ]);
  zh.keepEnglish = zh.keepEnglish.filter((key) => !DROP.has(key));
}

fs.writeFileSync(ZH_PATH, JSON.stringify(zh, null, 2) + '\n', 'utf8');

/* ------------------------------------------------------------------ i18n.tools.json */
const TOOLS_REMOVE = [
  'Your files never leave your device.',
  'Only the lines you change are rewritten: the rest of the file is untouched, the layout does not reflow, and everything runs in your browser — your file is never uploaded.',
];
for (const key of TOOLS_REMOVE) {
  if (key in tools.strings) {
    delete tools.strings[key];
    log.toolsKeys += 1;
  }
}
tools.strings['Your files stay on your device for this tool.'] = '文件留在你的设备上，这个工具不会上传。';
tools.strings['Only the lines you change are rewritten: the rest of the file is untouched, the layout does not reflow, and everything runs in your browser — this tool does not upload your file.'] =
  '只会重写你改动过的那些行：文件其余部分原封不动，版面不会重排，全部在你的浏览器里运行 —— 这个工具不会上传你的文件。';
log.toolsKeys += 2;
fs.writeFileSync(TOOLS_PATH, JSON.stringify(tools, null, 2) + '\n', 'utf8');

console.log(`zh strings: +${log.added} added, ~${log.replaced} replaced, -${log.removed} removed`);
console.log(`tools keys touched: ${log.toolsKeys}`);
console.log(`zh strings total: ${Object.keys(zh.strings).length}`);
