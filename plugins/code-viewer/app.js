// 代码与文本预览：highlight.js 语法高亮 + 行号；Markdown 默认渲染为文档（marked + DOMPurify），可切换看源码
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const LIMIT = 2 * 1024 * 1024; // 只显示前 2MB
  const HIGHLIGHT_LIMIT = 1024 * 1024; // 超过 1MB 的内容不做语法高亮（高亮 2MB 约需 2 秒，会卡住界面）

  const LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', go: 'go', rs: 'rust',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', bat: 'dos', sql: 'sql',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini',
    xml: 'xml', html: 'xml', vue: 'xml', css: 'css', scss: 'scss', kt: 'kotlin', swift: 'swift',
    md: 'markdown', txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
  };
  const LANG_NAME = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', go: 'Go', rust: 'Rust',
    c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP', bash: 'Shell', powershell: 'PowerShell',
    dos: '批处理', sql: 'SQL', json: 'JSON', yaml: 'YAML', ini: '配置文件', xml: 'XML / HTML', css: 'CSS',
    scss: 'SCSS', kotlin: 'Kotlin', swift: 'Swift', markdown: 'Markdown', plaintext: '纯文本',
  };

  let state = null; // { text, lang, isMd, view: 'doc' | 'src', srcReady, mdReady }

  // 文本解码：BOM / 合法 UTF-8 优先，否则按 GB18030（兼容 GBK）
  function decodeText(u8, truncated) {
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), enc: 'UTF-8' };
    if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), enc: 'UTF-16' };
    if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), enc: 'UTF-16' };
    // 截断处可能切开一个多字节字符：最多回退 3 个字节再试
    for (let cut = 0; cut <= (truncated ? 3 : 0); cut++) {
      try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(0, u8.length - cut)), enc: 'UTF-8' }; } catch (_) { /* 继续 */ }
    }
    return { text: new TextDecoder('gb18030').decode(u8), enc: 'GBK' };
  }

  function looksBinary(u8) {
    if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return false;
    const n = Math.min(u8.length, 8000);
    for (let i = 0; i < n; i++) if (u8[i] === 0) return true;
    return false;
  }

  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  async function openFile(msg) {
    CR.showState('loading', '正在加载…');
    $('toolbar').hidden = true;
    $('notice').hidden = true;
    $('code').hidden = true;
    $('md').hidden = true;
    $('src').textContent = '';
    $('gutter').textContent = '';
    $('md').textContent = '';
    const ext = String(msg.ext || '').toLowerCase();
    const all = new Uint8Array(msg.data || new ArrayBuffer(0));
    const truncated = all.length > LIMIT;
    const u8 = truncated ? all.subarray(0, LIMIT) : all;
    if (looksBinary(u8)) throw CR.userError('该文件包含二进制内容，无法作为文本预览。');
    const { text, enc } = decodeText(u8, truncated);
    const lang = LANG[ext] || 'plaintext';
    const isMd = ext === 'md';
    state = { text, lang, isMd, view: isMd ? 'doc' : 'src', srcReady: false, mdReady: false };

    const lines = countLines(text);
    $('info').textContent = [LANG_NAME[lang] || lang, lines.toLocaleString() + ' 行', enc, fmtSize(all.length)].join('  ·  ');
    const notes = [];
    if (truncated) notes.push(`文件较大（${fmtSize(all.length)}），只显示前 2 MB 的内容。`);
    state.plain = u8.length > HIGHLIGHT_LIMIT && lang !== 'plaintext';
    if (state.plain) notes.push('内容超过 1 MB，源码视图已关闭语法高亮。');
    $('notice').textContent = notes.join(' ');
    $('notice').hidden = !notes.length;
    $('mdSwitch').hidden = !isMd;
    $('toolbar').hidden = false;
    // 先让加载动画画出来，再做可能耗时的高亮
    await new Promise((r) => setTimeout(r, 16));
    show(state.view);
    CR.showState('hide');
    CR.done();
  }

  function countLines(text) {
    let n = 1;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
    if (text.endsWith('\n')) n--;
    return Math.max(1, n);
  }

  function show(view) {
    state.view = view;
    $('viewDoc').classList.toggle('active', view === 'doc');
    $('viewSrc').classList.toggle('active', view === 'src');
    if (view === 'doc') {
      if (!state.mdReady) renderMarkdown();
      $('code').hidden = true;
      $('md').hidden = false;
    } else {
      if (!state.srcReady) renderSource();
      $('md').hidden = true;
      $('code').hidden = false;
    }
    viewer.scrollTop = 0;
  }

  function renderSource() {
    const { text, lang } = state;
    const n = countLines(text);
    const nums = new Array(n);
    for (let i = 0; i < n; i++) nums[i] = i + 1;
    $('gutter').textContent = nums.join('\n');
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    if (state.plain || lang === 'plaintext' || !hljs.getLanguage(lang)) {
      $('src').textContent = body;
    } else {
      try {
        $('src').innerHTML = hljs.highlight(body, { language: lang, ignoreIllegals: true }).value;
      } catch (err) {
        console.warn('[code-viewer] 高亮失败，按纯文本显示', err);
        $('src').textContent = body;
      }
    }
    state.srcReady = true;
  }

  function renderMarkdown() {
    const html = marked.parse(state.text, { gfm: true, breaks: false, async: false });
    const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form'] });
    // 先在 <template>（惰性文档，不会发起图片请求）里处理，再挂到页面上
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    const md = tpl.content;
    // 插件不能联网也读不到同目录其他文件：除 data: 外的图片换成占位文字，避免无意义的请求
    md.querySelectorAll('img, picture source, video, audio').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) return;
      const ph = document.createElement('span');
      ph.className = 'img-placeholder';
      ph.textContent = '图片：' + (img.getAttribute('alt') || src || '未命名');
      ph.title = src;
      img.replaceWith(ph);
    });
    md.querySelectorAll('pre code').forEach((el) => {
      const m = /language-([\w-]+)/.exec(el.className);
      const lang = m && (hljs.getLanguage(m[1]) ? m[1] : LANG[m[1]]);
      if (!lang || !hljs.getLanguage(lang)) return;
      try { el.innerHTML = hljs.highlight(el.textContent, { language: lang, ignoreIllegals: true }).value; el.classList.add('hljs'); } catch (_) { /* 保持原样 */ }
    });
    md.querySelectorAll('a[href]').forEach((a) => { a.title = a.getAttribute('href'); });
    $('md').textContent = '';
    $('md').appendChild(md);
    state.mdReady = true;
  }

  // 链接不能在插件内打开：外链阻止跳转，页内锚点滚动到目标
  $('md').addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') && href.length > 1) {
      const id = decodeURIComponent(href.slice(1));
      const target = document.getElementById(id) || $('md').querySelector(`[name="${CSS.escape(id)}"]`);
      if (target) target.scrollIntoView({ block: 'start' });
    }
  });
  $('viewDoc').addEventListener('click', () => state && show('doc'));
  $('viewSrc').addEventListener('click', () => state && show('src'));

  CR.start({ onFile: openFile });
})();
