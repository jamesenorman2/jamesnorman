/* ↑ ↑ ↓ ↓ ← → ← → B A : everything white goes rainbow for one bar, then snaps back. */
(() => {
  const code = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
  let pos = 0, busy = false;
  const style = document.createElement('style');
  style.textContent = `
    .jn-konami{position:fixed;inset:0;z-index:2147483646;pointer-events:none;mix-blend-mode:multiply;
      background:linear-gradient(90deg,#ff004c,#ff9a00,#f6ff00,#2bff00,#00f0ff,#3d5cff,#c400ff,#ff004c);
      background-size:200% 100%;animation:jnKonami 2s linear forwards}
    @keyframes jnKonami{0%{opacity:0;background-position:0 0}8%{opacity:1}88%{opacity:1}100%{opacity:0;background-position:-200% 0}}`;
  document.head.appendChild(style);

  addEventListener('keydown', e => {
    const k = (e.key || '').toLowerCase();
    pos = k === code[pos] ? pos + 1 : (k === code[0] ? 1 : 0);
    if (pos < code.length) return;
    pos = 0;
    if (busy) return;
    busy = true;
    const veil = document.createElement('div');
    veil.className = 'jn-konami';
    document.body.appendChild(veil);
    dispatchEvent(new CustomEvent('konami'));
    // one bar at 120 bpm = 2 seconds
    setTimeout(() => { veil.remove(); busy = false; }, 2000);
  });
})();
