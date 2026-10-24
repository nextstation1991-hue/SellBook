window.addEventListener('DOMContentLoaded', () => {
  if (!window.matchMedia('(max-width: 640px)').matches) return;
  document.documentElement.dataset.device = 'mobile';
});
