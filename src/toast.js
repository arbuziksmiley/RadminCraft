// Renderer for the notification overlay window.
//
// Owns its own queue: at most three toasts are on screen, the rest wait. After
// every change it reports the stack height to the main process, which resizes
// the overlay window to fit and hides it once nothing is left.
(() => {
  const bridge = window.radmincraftToast;
  const stack = document.getElementById('stack');
  if (!bridge || !stack) return;

  const DURATION = 6000;
  const MAX_VISIBLE = 3;
  const queue = [];

  const icons = {
    join: '<path d="m9 4-6 2.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z"/><path d="M9 4v13M15 7v13"/>',
    mention: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    voice: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/>'
  };

  // The window is sized to the content; an empty stack hides it entirely so no
  // invisible click-catching rectangle is left floating over the desktop.
  const reportLayout = () => {
    if (!stack.childElementCount) { bridge.reportEmpty(); return; }
    const height = Math.ceil(stack.getBoundingClientRect().height) + 4;
    bridge.reportHeight(height);
  };

  const pump = () => {
    while (stack.childElementCount < MAX_VISIBLE && queue.length) render(queue.shift());
    reportLayout();
  };

  const render = toast => {
    const element = document.createElement('div');
    element.className = `toast ${toast.kind}`;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[toast.kind] || icons.message}</svg>`;

    const copy = document.createElement('span');
    copy.className = 'copy';
    const title = document.createElement('b'); title.textContent = toast.title;
    const body = document.createElement('small'); body.textContent = toast.body || '';
    copy.append(title, body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.title = 'Закрыть';
    close.setAttribute('aria-label', 'Закрыть уведомление');
    close.innerHTML = `<svg class="ring" viewBox="0 0 30 30" aria-hidden="true">
        <circle class="bg" cx="15" cy="15" r="12"/>
        <circle class="fg" cx="15" cy="15" r="12"/>
      </svg><span class="x" aria-hidden="true">×</span>`;

    element.append(icon, copy, close);

    const fg = close.querySelector('.fg');
    fg.style.animationDuration = `${DURATION}ms`;

    let timer;
    let remaining = DURATION;
    let startedAt = Date.now();
    let closed = false;

    const dismiss = () => {
      if (closed) return;
      closed = true;
      window.clearTimeout(timer);
      element.classList.add('is-leaving');
      const remove = () => { if (element.isConnected) { element.remove(); pump(); } };
      element.addEventListener('animationend', remove, { once: true });
      window.setTimeout(remove, 400);
    };
    const start = () => { startedAt = Date.now(); timer = window.setTimeout(dismiss, remaining); };

    // Hovering holds the toast open so a long message can be read.
    element.addEventListener('mouseenter', () => {
      window.clearTimeout(timer);
      remaining = Math.max(600, remaining - (Date.now() - startedAt));
      element.classList.add('is-paused');
    });
    element.addEventListener('mouseleave', () => { element.classList.remove('is-paused'); start(); });

    close.addEventListener('click', event => { event.stopPropagation(); dismiss(); });
    element.addEventListener('click', () => { bridge.open(toast.page); dismiss(); });

    stack.append(element);
    start();
  };

  bridge.onAdd(toast => { queue.push(toast); pump(); });
  reportLayout();
})();
