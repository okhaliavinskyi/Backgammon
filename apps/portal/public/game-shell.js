const frame = document.getElementById('game-frame');
const area = document.getElementById('game-area');
const expand = document.getElementById('expand');
frame.addEventListener('load', () => document.getElementById('loading').hidden = true);
// Local multi-host proxy exercises the same upstream paths as production.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  frame.src = `${location.protocol}//${frame.dataset.slug}.localhost:${location.port}/`;
} else frame.src = frame.dataset.src;
expand.addEventListener('click', async () => {
  if (area.requestFullscreen) {
    try { await area.requestFullscreen(); return; } catch { /* iPhone uses the viewport fallback. */ }
  }
  document.body.classList.add('expanded');
  history.pushState({ expanded: true }, '');
});
window.addEventListener('popstate', () => document.body.classList.remove('expanded'));

document.getElementById('collapse').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (document.body.classList.contains('expanded')) history.back();
});
