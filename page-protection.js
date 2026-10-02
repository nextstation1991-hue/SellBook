(() => {
  const interactiveTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  document.addEventListener('contextmenu', (event) => {
    if (!interactiveTags.has(event.target.tagName)) event.preventDefault();
  });

  document.addEventListener('dragstart', (event) => {
    if (event.target.tagName === 'IMG') event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const isDevToolsShortcut =
      event.key === 'F12' ||
      (event.ctrlKey && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
      (event.metaKey && event.altKey && ['i', 'j'].includes(key)) ||
      (event.ctrlKey && ['u', 's', 'p'].includes(key));

    if (isDevToolsShortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
})();
