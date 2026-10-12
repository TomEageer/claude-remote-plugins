// 表格预览：SheetJS 解析 xlsx / xls / xlsm / ods / csv，渲染为 HTML 表格，多工作表切换
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const grid = $('grid');
  const tabs = $('tabs');
  const notice = $('notice');

  const MAX_ROWS = 5000;      // 每个工作表最多显示的行数
  const MAX_COLS = 256;       // 最多显示的列数
  const MAX_CELLS = 300000;   // 行 × 列 上限，防止超宽表格卡死

  let wb = null;
  let current = -1;
  let extraNote = '';

  // 文本解码：BOM / 合法 UTF-8 优先，否则按 GB18030（兼容 GBK）
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (_) { /* 不是 UTF-8 */ }
    extraNote = '已按 GBK/GB18030 编码读取。';
    return new TextDecoder('gb18030').decode(u8);
  }

  function readWorkbook(msg) {
    const ext = String(msg.ext || '').toLowerCase();
    const u8 = new Uint8Array(msg.data);
    const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
    const isCfb = u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0; // 加密的 xlsx 是 OLE 容器
    const opts = { cellText: true, cellDates: false, cellNF: false, cellStyles: false, sheetStubs: true, sheetRows: MAX_ROWS };
    if (ext === 'csv') {
      // csv 一律按文本读：不把长数字（身份证号、订单号）转成科学计数法
      return XLSX.read(decodeText(msg.data), { ...opts, type: 'string', raw: true });
    }
    if ((ext === 'xlsx' || ext === 'xlsm' || ext === 'ods') && !isZip && !isCfb) {
      throw CR.userError('文件已损坏，或不是有效的表格文件。');
    }
    return XLSX.read(u8, { ...opts, type: 'array' });
  }

  function describeError(err) {
    const m = String((err && err.message) || err || '');
    if (/password/i.test(m)) return '该表格设置了密码保护，暂不支持预览。';
    if (/zip|corrupt|invalid|unexpected/i.test(m)) return '文件已损坏，或不是有效的表格文件。';
    if (/unsupported/i.test(m)) return '暂不支持这种表格格式。';
    return '文件已损坏，或不是有效的表格文件。';
  }

  async function openFile(msg) {
    CR.showState('loading', '正在加载…');
    grid.textContent = '';
    tabs.hidden = true;
    notice.hidden = true;
    extraNote = '';
    wb = null;
    if (!msg.data || !msg.data.byteLength) throw CR.userError('文件内容为空。');
    // 先让加载动画画出来，再做可能耗时的解析
    await new Promise((r) => setTimeout(r, 16));
    try {
      wb = readWorkbook(msg);
    } catch (err) {
      if (err && err.userMessage) throw err;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { userMessage: describeError(err) });
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw CR.userError('文件中没有工作表。');
    buildTabs(String(msg.ext || '').toLowerCase() !== 'csv' || wb.SheetNames.length > 1);
    // 默认打开第一个可见工作表
    const hidden = (wb.Workbook && wb.Workbook.Sheets) || [];
    let first = wb.SheetNames.findIndex((_, i) => !(hidden[i] && hidden[i].Hidden));
    if (first < 0) first = 0;
    showSheet(first);
    CR.showState('hide');
    CR.done();
  }

  function buildTabs(visible) {
    tabs.textContent = '';
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    wb.SheetNames.forEach((name, i) => {
      if (meta[i] && meta[i].Hidden) return; // 隐藏的工作表不显示标签
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = name;
      b.title = name;
      b.addEventListener('click', () => showSheet(i));
      b.dataset.index = String(i);
      tabs.appendChild(b);
    });
    tabs.hidden = !visible;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cellText(cell) {
    if (!cell) return '';
    // 'z' 是没有值的占位格：可能带一个没有缓存结果的公式（程序生成、从未在 Excel 中保存过）
    if (cell.t === 'z') return cell.f ? '=' + cell.f : '';
    if (cell.w !== undefined && cell.w !== null && cell.w !== '') return cell.w;
    if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
      if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
      return String(cell.v);
    }
    if (cell.f) return '=' + cell.f;
    return '';
  }

  function showSheet(index) {
    current = index;
    for (const t of tabs.children) t.classList.toggle('active', Number(t.dataset.index) === index);
    const ws = wb.Sheets[wb.SheetNames[index]];
    viewer.scrollTop = 0;
    viewer.scrollLeft = 0;
    const notes = [];
    if (extraNote) notes.push(extraNote);
    if (!ws || !ws['!ref']) {
      grid.innerHTML = '<div class="empty">此工作表为空</div>';
      setNotice(notes);
      return;
    }
    const range = XLSX.utils.decode_range(ws['!ref']);
    const full = ws['!fullref'] ? XLSX.utils.decode_range(ws['!fullref']) : range;
    const totalRows = full.e.r + 1;
    const totalCols = full.e.c + 1;
    const cols = Math.min(range.e.c + 1, MAX_COLS);
    const rows = Math.min(range.e.r + 1, MAX_ROWS, Math.max(1, Math.floor(MAX_CELLS / cols)));
    if (totalRows > rows) notes.push(`共 ${totalRows.toLocaleString()} 行，只显示前 ${rows.toLocaleString()} 行。`);
    if (totalCols > cols) notes.push(`共 ${totalCols.toLocaleString()} 列，只显示前 ${cols.toLocaleString()} 列。`);
    setNotice(notes);

    // 合并单元格：左上角记录跨度，其余格子跳过
    const span = new Map();
    const covered = new Set();
    for (const m of ws['!merges'] || []) {
      if (m.s.r >= rows || m.s.c >= cols) continue;
      const rs = Math.min(m.e.r, rows - 1) - m.s.r + 1;
      const cs = Math.min(m.e.c, cols - 1) - m.s.c + 1;
      span.set(m.s.r * 100000 + m.s.c, [rs, cs]);
      for (let r = m.s.r; r < m.s.r + rs; r++) {
        for (let c = m.s.c; c < m.s.c + cs; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r * 100000 + c);
      }
    }

    const dense = Array.isArray(ws['!data']) ? ws['!data'] : null;
    const out = ['<table class="sheet"><thead><tr><th class="corner"></th>'];
    for (let c = 0; c < cols; c++) out.push('<th>' + XLSX.utils.encode_col(c) + '</th>');
    out.push('</tr></thead><tbody>');
    for (let r = 0; r < rows; r++) {
      out.push('<tr><th>' + (r + 1) + '</th>');
      for (let c = 0; c < cols; c++) {
        const key = r * 100000 + c;
        if (covered.has(key)) continue;
        const cell = dense ? (dense[r] && dense[r][c]) : ws[XLSX.utils.encode_cell({ r, c })];
        const text = cellText(cell);
        let cls = cell ? cell.t : '';
        if (text.includes('\n')) cls += ' wrap';
        const sp = span.get(key);
        const attrs = (cls ? ` class="${cls}"` : '') + (sp ? `${sp[0] > 1 ? ` rowspan="${sp[0]}"` : ''}${sp[1] > 1 ? ` colspan="${sp[1]}"` : ''}` : '');
        out.push('<td' + attrs + '>' + esc(text) + '</td>');
      }
      out.push('</tr>');
    }
    out.push('</tbody></table>');
    grid.innerHTML = out.join('');
    makeTablesResizable(grid);
  }

  function setNotice(notes) {
    notice.textContent = notes.join(' ');
    notice.hidden = !notes.length;
  }

  document.addEventListener('keydown', (e) => {
    if (!wb || tabs.hidden) return;
    // Ctrl+PageUp / Ctrl+PageDown 切换工作表（与 Excel 一致）
    if (!e.ctrlKey || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
    const visible = [...tabs.children].map((t) => Number(t.dataset.index));
    const pos = visible.indexOf(current);
    const next = visible[pos + (e.key === 'PageDown' ? 1 : -1)];
    if (next !== undefined) showSheet(next);
    e.preventDefault();
  });

  CR.start({ onFile: openFile });
})();
