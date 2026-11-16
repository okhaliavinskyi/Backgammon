// Ctrl V autofocuses its secret card after rendering a scene. On a short phone
// this scrolls the timer and topic out of view before the player can read them.
const app = document.getElementById('app');
if (app) {
  let scene = '';
  const restoreSceneStart = () => {
    const next = app.dataset.screen + ':' + app.dataset.phase;
    if (next === scene) return;
    scene = next;
    if (matchMedia('(max-width: 950px)').matches) requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  new MutationObserver(restoreSceneStart).observe(app, { attributes: true, attributeFilter: ['data-screen', 'data-phase'] });
  restoreSceneStart();
}
