// ---- 公共：文档内查找（⌘F / Ctrl+F）。各插件各自带一份（构建时从 scripts/shared/find.js 拷过去，保持插件自包含）----
// 在插件自己的页面里找文字：命中的地方用 CSS Custom Highlight 标出来（不改页面内容），回车下一个、Shift+回车上一个、Esc 关闭。
// 只找看得见的文字（折叠起来、隐藏的不算）；命中超过 5000 处只标前 5000 处
(() => {
  if (!(window.CSS && CSS.highlights && typeof Highlight === 'function')) return;
  const MAX = 5000;
  let bar = null, input = null, count = null;
  let ranges = [], cur = -1, timer = null, dirty = true, observer = null;

  const style = document.createElement('style');
  style.textContent = `
    ::highlight(cr-find) { background: #ffe58a; color: #1f1f1d; }
    ::highlight(cr-find-cur) { background: #ff9632; color: #1f1f1d; }
    #cr-find { position: fixed; top: 8px; right: 14px; z-index: 2147483000; display: flex; align-items: center; gap: 4px; padding: 4px 6px;
      background: var(--panel, #f2f0e8); color: var(--fg, #2b2a27); border: 1px solid var(--line, #e4e0d5); border-radius: 8px;
      box-shadow: 0 4px 14px rgba(0,0,0,.18); font: 13px var(--font, system-ui, sans-serif); }
    #cr-find[hidden] { display: none; }
    #cr-find input { width: 170px; height: 24px; padding: 0 6px; border: 1px solid var(--line, #e4e0d5); border-radius: 5px; outline: 0;
      background: var(--bg, #faf9f5); color: inherit; font: inherit; }
    #cr-find input:focus { border-color: var(--accent, #c96442); }
    #cr-find .n { min-width: 56px; text-align: center; color: var(--muted, #77746b); font-size: 12px; }
    #cr-find button { width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; }
    #cr-find button:hover { background: var(--hover, #ebe8df); }
  `;
  document.head.appendChild(style);

  function mount() {
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'cr-find';
    bar.hidden = true;
    bar.innerHTML = '<input type="text" placeholder="查找" spellcheck="false" autocomplete="off" /><span class="n"></span><button type="button" class="p" title="上一个（Shift+回车）">↑</button><button type="button" class="x" title="下一个（回车）">↓</button><button type="button" class="c" title="关闭（Esc）">✕</button>';
    document.body.appendChild(bar);
    input = bar.querySelector('input');
    count = bar.querySelector('.n');
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(), 80); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    bar.querySelector('.p').onclick = () => go(-1);
    bar.querySelector('.x').onclick = () => go(1);
    bar.querySelector('.c').onclick = close;
    observer = new MutationObserver((muts) => { if (muts.some((m) => !bar.contains(m.target))) dirty = true; });
  }

  function clear() {
    ranges = [];
    cur = -1;
    CSS.highlights.delete('cr-find');
    CSS.highlights.delete('cr-find-cur');
    if (count) count.textContent = '';
  }

  function search() {
    dirty = false;
    clear();
    const q = input.value.toLowerCase();
    if (!q) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) {
          if (n === bar || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
          if (n.hidden || (n.checkVisibility && !n.checkVisibility())) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    let over = false;
    while ((n = walker.nextNode()) && !over) {
      const text = n.nodeValue.toLowerCase();
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
        if (ranges.length >= MAX) { over = true; break; }
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        ranges.push(r);
      }
    }
    CSS.highlights.set('cr-find', new Highlight(...ranges));
    if (!ranges.length) { count.textContent = '无结果'; return; }
    cur = -1;
    go(1);
    if (over) count.textContent = count.textContent.replace(/ \/ \d+$/, ' / ' + MAX + '+');
  }

  function go(dir) {
    if (dirty && input.value) { search(); return; }
    if (!ranges.length) return;
    cur = (cur + dir + ranges.length) % ranges.length;
    const r = ranges[cur];
    CSS.highlights.set('cr-find-cur', new Highlight(r));
    count.textContent = `${cur + 1} / ${ranges.length}`;
    const el = r.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function open() {
    mount();
    bar.hidden = false;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const sel = String(window.getSelection() || '').trim();
    if (sel && sel.length < 80 && !sel.includes('\n')) input.value = sel;
    input.focus();
    input.select();
    search();
  }

  function close() {
    if (!bar || bar.hidden) return;
    bar.hidden = true;
    observer.disconnect();
    clear();
  }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.altKey || e.shiftKey) return;
    e.preventDefault();
    open();
  }, true);
})();
