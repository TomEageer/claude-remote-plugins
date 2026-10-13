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
    state = { text, raw: text, lang, isMd, view: isMd ? 'doc' : 'src', srcReady: false, mdReady: false };
    // JSON：解析成功默认显示格式化，失败标出出错位置
    state.isJson = ext === 'json' && !truncated;
    if (state.isJson) {
      try {
        state.json = JSON.parse(text.replace(/^\uFEFF/, ''));
        state.jv = 'pretty';
        state.text = JSON.stringify(state.json, null, 2);
      } catch (err) {
        state.jsonError = describeJsonError(err, text);
        state.jv = 'raw';
      }
    }

    const lines = countLines(state.text);
    $('info').textContent = [LANG_NAME[lang] || lang, lines.toLocaleString() + ' 行', enc, fmtSize(all.length)].join('  ·  ');
    const notes = [];
    if (truncated) notes.push(`文件较大（${fmtSize(all.length)}），只显示前 2 MB 的内容。`);
    state.plain = state.text.length > HIGHLIGHT_LIMIT && lang !== 'plaintext';
    if (state.plain) notes.push('内容超过 1 MB，源码视图已关闭语法高亮。');
    if (state.jsonError) notes.push(`JSON 格式有误：${state.jsonError.text}`);
    $('notice').textContent = notes.join(' ');
    $('notice').hidden = !notes.length;
    $('notice').classList.toggle('err', !!state.jsonError);
    $('mdSwitch').hidden = !isMd;
    $('jsonSwitch').hidden = !state.isJson || !!state.jsonError;
    $('copyBtn').hidden = false;
    $('treeTools').hidden = true;
    $('tree').hidden = true;
    if (state.isJson && !state.jsonError) markJsonView();
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
      $('tree').hidden = true;
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
    if (state.jsonError && state.jsonError.line) {
      const g = $('gutter').textContent.split('\n');
      g[state.jsonError.line - 1] = '▶ ' + g[state.jsonError.line - 1];
      $('gutter').textContent = g.join('\n');
      $('code').style.setProperty('--err-line', state.jsonError.line);
      $('code').classList.add('has-err');
    } else {
      $('code').classList.remove('has-err');
    }
    state.srcReady = true;
  }

  // ---------- JSON ----------
  // JSON.parse 的报错在新版 Chromium 里不带位置，自己扫一遍找出第一个出错的位置
  function findJsonErrorPos(t) {
    let i = 0;
    const ws = () => { while (i < t.length && ' \t\n\r'.includes(t[i])) i++; };
    const fail = (why) => { const e = new Error(why); e.pos = i; throw e; };
    const lit = (w) => { if (t.startsWith(w, i)) i += w.length; else fail('无法识别的值'); };
    const str = () => {
      i++;
      while (i < t.length) {
        const c = t[i];
        if (c === '"') { i++; return; }
        if (c === '\\') { i += 2; continue; }
        if (c < ' ') fail('字符串里有未转义的换行或控制字符');
        i++;
      }
      fail('字符串缺少结尾的引号');
    };
    const num = () => { const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i, i + 400)); if (!m || !m[0]) fail('数字格式不对'); i += m[0].length; };
    const val = () => {
      ws();
      const c = t[i];
      if (c === '{') {
        i++; ws();
        if (t[i] === '}') { i++; return; }
        for (;;) {
          ws(); if (t[i] !== '"') fail('这里应该是用双引号括起来的字段名'); str(); ws();
          if (t[i] !== ':') fail('字段名后面缺少冒号'); i++; val(); ws();
          if (t[i] === ',') { i++; continue; }
          if (t[i] === '}') { i++; return; }
          fail('缺少逗号或右花括号 }');
        }
      }
      if (c === '[') {
        i++; ws();
        if (t[i] === ']') { i++; return; }
        for (;;) {
          val(); ws();
          if (t[i] === ',') { i++; continue; }
          if (t[i] === ']') { i++; return; }
          fail('缺少逗号或右方括号 ]');
        }
      }
      if (c === '"') return str();
      if (c === 't') return lit('true');
      if (c === 'f') return lit('false');
      if (c === 'n') return lit('null');
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      if (i >= t.length) fail('内容不完整，结尾缺少括号或引号');
      fail(c === ',' ? '这里多了一个逗号' : `这里不应该出现「${c}」`);
    };
    try {
      if (t.charCodeAt(0) === 0xfeff) i = 1;
      val(); ws();
      if (i < t.length) fail('JSON 已经结束，后面还有多余的内容');
      return null;
    } catch (e) {
      return { pos: e.pos, why: e.message };
    }
  }

  function describeJsonError(err, text) {
    const found = findJsonErrorPos(text);
    if (!found) return { line: null, col: null, text: String(err && err.message || err) };
    const before = text.slice(0, found.pos);
    const line = before.split('\n').length;
    const col = found.pos - before.lastIndexOf('\n');
    return { line, col, text: `第 ${line} 行第 ${col} 列，${found.why}` };
  }

  function markJsonView() {
    document.querySelectorAll('#jsonSwitch .btn').forEach((b) => b.classList.toggle('active', b.dataset.jv === state.jv));
  }

  function setJsonView(v) {
    if (!state || !state.isJson || state.jsonError) return;
    state.jv = v;
    markJsonView();
    $('treeTools').hidden = v !== 'tree';
    if (v === 'tree') {
      if (!state.treeReady) { $('tree').textContent = ''; $('tree').appendChild(treeNode(null, state.json, 0)); state.treeReady = true; }
      $('code').hidden = true;
      $('tree').hidden = false;
    } else {
      state.text = v === 'pretty' ? JSON.stringify(state.json, null, 2) : v === 'min' ? JSON.stringify(state.json) : state.raw;
      state.srcReady = false;
      $('tree').hidden = true;
      show('src');
    }
    viewer.scrollTop = 0;
  }

  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  // 树形视图：子节点在第一次展开时才渲染，大文件也不卡
  function treeNode(key, val, depth) {
    const t = typeOf(val);
    const row = document.createElement('div');
    row.className = 'jn';
    const head = document.createElement('div');
    head.className = 'jh';
    const k = key == null ? '' : `<span class="jk">${escapeHtml(String(key))}</span><span class="jp">: </span>`;
    if (t === 'object' || t === 'array') {
      const n = t === 'array' ? val.length : Object.keys(val).length;
      head.innerHTML = `<span class="jt">▸</span>${k}<span class="jb">${t === 'array' ? '[' : '{'}</span><span class="jc">${n} ${t === 'array' ? '项' : '个字段'}</span><span class="jb">${t === 'array' ? ']' : '}'}</span>`;
      head.classList.add('jx');
      const kids = document.createElement('div');
      kids.className = 'jk-kids';
      kids.hidden = true;
      row.append(head, kids);
      const open = (yes) => {
        if (yes && !kids.dataset.ready) {
          const entries = t === 'array' ? val.map((v, i) => [i, v]) : Object.entries(val);
          const frag = document.createDocumentFragment();
          const MAX = 5000;
          entries.slice(0, MAX).forEach(([kk, vv]) => frag.appendChild(treeNode(kk, vv, depth + 1)));
          if (entries.length > MAX) { const more = document.createElement('div'); more.className = 'jmore'; more.textContent = `还有 ${entries.length - MAX} 项未显示`; frag.appendChild(more); }
          kids.appendChild(frag);
          kids.dataset.ready = '1';
        }
        kids.hidden = !yes;
        row.classList.toggle('open', yes);
      };
      row._open = open;
      head.addEventListener('click', () => open(kids.hidden));
      if (depth < 2) open(true);
    } else {
      const shown = t === 'string' ? JSON.stringify(val) : String(val);
      head.innerHTML = `<span class="jt sp"></span>${k}<span class="jv ${t}">${escapeHtml(shown.length > 2000 ? shown.slice(0, 2000) + '…' : shown)}</span>`;
      row.appendChild(head);
    }
    return row;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 全部展开最多处理 3000 个节点，避免超大 JSON 卡住
  function expandAll(yes) {
    let budget = 3000;
    const walk = (row) => {
      if (!row._open || budget-- <= 0) return;
      row._open(yes);
      if (yes) row.querySelectorAll(':scope > .jk-kids > .jn').forEach(walk);
    };
    if (yes) $('tree').querySelectorAll(':scope > .jn').forEach(walk);
    else $('tree').querySelectorAll('.jn').forEach((r) => r._open && r._open(false));
  }

  // 复制当前视图的内容（跨源 iframe 里剪贴板 API 可能被拒，回退到 execCommand）
  async function copyText() {
    const text = state.isJson && state.jv === 'tree' ? JSON.stringify(state.json, null, 2) : state.text;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
    }
    const b = $('copyBtn');
    b.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => (b.textContent = '复制'), 1200);
  }

  // 对中文友好的两条规则（和主界面一致）：单个 ~ 不当删除线（「7/1~8/13」「6~9 月」不被吞掉），
  // ** 只要成对就加粗（「**结论。**后面的话」不再原样显示星号）
  marked.use({
    tokenizer: {
      del(src) {
        const m = /^~~(?=\S)([\s\S]*?\S)~~(?!~)/.exec(src);
        if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
        return undefined;
      },
    },
    extensions: [{
      name: 'cjkStrong',
      level: 'inline',
      start(src) { const i = src.indexOf('**'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\*\*(?![\s*])([^*\n]*?[^\s*])\*\*(?!\*)/.exec(src);
        if (m) return { type: 'strong', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
        return undefined;
      },
    }],
  });

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
    // 表格外包一层横向滚动，列宽可以拖动
    md.querySelectorAll('table').forEach((t) => {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.replaceWith(wrap);
      wrap.appendChild(t);
      makeTableResizable(t);
    });
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
  document.querySelectorAll('#jsonSwitch .btn').forEach((b) => b.addEventListener('click', () => setJsonView(b.dataset.jv)));
  $('expandAll').addEventListener('click', () => expandAll(true));
  $('collapseAll').addEventListener('click', () => expandAll(false));
  $('copyBtn').addEventListener('click', () => state && copyText());
  $('viewDoc').addEventListener('click', () => state && show('doc'));
  $('viewSrc').addEventListener('click', () => state && show('src'));

  CR.start({ onFile: openFile });
})();
