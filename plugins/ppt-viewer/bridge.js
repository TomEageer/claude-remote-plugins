// ---- 公共：与主软件的消息桥（各插件各自带一份，保持插件自包含） ----
const CR = {
  post(msg) { try { window.parent.postMessage(msg, '*'); } catch (_) { /* 宿主不在时忽略 */ } },
  setTheme(theme) { document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'; },
  stateEl() { return document.getElementById('state'); },
  // kind: 'loading' | 'error' | 'hide'
  showState(kind, title, detail) {
    const el = CR.stateEl();
    if (kind === 'hide') { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'state' + (kind === 'error' ? ' error' : '');
    el.textContent = '';
    if (kind === 'loading') { const s = document.createElement('div'); s.className = 'spinner'; el.appendChild(s); }
    const t = document.createElement('div'); t.className = 'title'; t.textContent = title; el.appendChild(t);
    if (detail) { const d = document.createElement('div'); d.className = 'detail'; d.textContent = detail; el.appendChild(d); }
  },
  rendered: false,
  done() { if (!CR.rendered) { CR.rendered = true; CR.post({ type: 'cr:rendered' }); } },
  // message：给普通用户看的中文说明
  fail(message, err) {
    if (err) console.warn('[plugin] 无法预览:', err);   // 已处理的情况，用 warn 而不是 error
    CR.showState('error', '无法预览此文件', message);
    CR.post({ type: 'cr:error', message });
  },
  // onFile(msg) 可以是 async；抛出的异常统一转成 cr:error
  start({ onFile, onTheme }) {
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'cr:file') {
        CR.setTheme(m.theme);
        CR.rendered = false;
        Promise.resolve().then(() => onFile(m)).catch((err) => CR.fail(CR.describe(err), err));
      } else if (m.type === 'cr:theme') {
        CR.setTheme(m.theme);
        if (onTheme) onTheme(m.theme);
      }
    });
    CR.post({ type: 'cr:ready' });
  },
  describe(err) {
    return (err && err.userMessage) || '文件可能已损坏，或格式不受支持。';
  },
  userError(message) { const e = new Error(message); e.userMessage = message; return e; },
};
