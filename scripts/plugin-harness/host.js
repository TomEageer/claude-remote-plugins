// 宿主页：模拟主软件的插件加载流程（iframe + postMessage 协议）
(async () => {
  const job = await window.harness.getJob();
  const frame = document.createElement('iframe');
  frame.src = 'crplugin://' + job.plugin + '/index.html';
  document.body.appendChild(frame);
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    window.harness.report({ type: m.type, message: m.message, t: Date.now() });
    if (m.type === 'cr:ready') {
      const data = job.data.buffer.slice(job.data.byteOffset, job.data.byteOffset + job.data.byteLength);
      frame.contentWindow.postMessage({
        type: 'cr:file', name: job.name, ext: job.ext, size: data.byteLength, mime: job.mime, theme: job.theme, data,
      }, '*', [data]);
    }
  });
  window.harness.onCommand((cmd) => {
    if (cmd.type === 'theme') frame.contentWindow.postMessage({ type: 'cr:theme', theme: cmd.theme }, '*');
  });
})();
