(() => {
  const count = 150;
  const clamp = value => Math.max(0, Math.min(count - 1, Number(String(value || '').replace('head-', '')) || 0));
  const id = value => `head-${String(clamp(value)).padStart(3, '0')}`;
  const normalize = value => /^head-\d{3}$/.test(String(value || '')) ? id(value) : id(0);
  const paint = (element, avatarId) => {
    if (!element) return element;
    const index = clamp(avatarId);
    element.classList.add('voxel-avatar');
    element.textContent = '';
    element.style.setProperty('--avatar-image', `url('assets/avatars/head-${String(index).padStart(3, '0')}.png')`);
    delete element.dataset.avatarVariant;
    element.dataset.avatarId = id(index);
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', `Голова персонажа ${index + 1}`);
    return element;
  };
  const create = (avatarId, className = '') => {
    const element = document.createElement('span');
    element.className = className;
    return paint(element, avatarId);
  };
  window.RadminCraftAvatars = { count, id, paint, create, normalize };
})();
