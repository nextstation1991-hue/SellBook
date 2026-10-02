window.addEventListener('DOMContentLoaded', () => {
  if (!window.matchMedia('(min-width: 641px)').matches) return;
  document.documentElement.dataset.device = 'desktop';
});
