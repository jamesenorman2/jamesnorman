/* Music across the site.
   - Inside the homepage's shell (a page opened over the player while music plays): the Home link goes
     back to the player instead of loading a second one, and links to other websites open in a new tab
     so the music isn't interrupted.
   - On a page opened on its own: a small play button in the corner opens the site through the
     homepage player, with this page on show, ready to play. */
(function () {
  if (/^\/admin/.test(location.pathname)) return;
  let shell = null;
  try { shell = window.parent !== window && window.parent.JN_SHELL ? window.parent.JN_SHELL : null; } catch (e) { shell = null; }

  if (shell) {
    document.documentElement.classList.add('in-shell');
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      let url; try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) { if (!a.target) { a.target = '_blank'; a.rel = 'noopener'; } return; }
      if (url.pathname === '/') { e.preventDefault(); shell.home(); }
    }, true);
    return;
  }
  if (location.pathname === '/') return;                 // the homepage has the player itself

  const css = document.createElement('style');
  css.textContent = `.jn-play{position:fixed;left:1rem;bottom:1rem;z-index:50;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.55);
    background:#000;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform .2s,border-color .2s}
    .jn-play:hover,.jn-play:focus-visible{transform:scale(1.08);border-color:#fff}
    .jn-play svg{width:20px;height:20px;margin-left:3px}
    @media print{.jn-play{display:none}}`;
  document.head.appendChild(css);
  const b = document.createElement('button');
  b.className = 'jn-play'; b.type = 'button';
  b.title = 'Play music while you look round the site'; b.setAttribute('aria-label', 'Play music');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
  b.addEventListener('click', () => { location.href = '/?then=' + encodeURIComponent(location.pathname + location.search + location.hash); });
  (document.readyState === 'loading' ? addEventListener.bind(window, 'DOMContentLoaded') : f => f())(() => document.body.appendChild(b));
})();
