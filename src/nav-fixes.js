(() => {
  document.querySelectorAll('.side nav .nav').forEach(button => {
    const page = button.dataset.page;
    const labels = { chat: 'Общий чат', voice: 'Голосовой чат', map: 'Карта', settings: 'Настройки' };
    const icon = document.createElement('span'); icon.className = 'nav-icon';
    const image = document.createElement('img'); image.alt = ''; image.src = `icons/${page}.svg`; icon.append(image);
    const label = document.createElement('span'); label.className = 'nav-label'; label.textContent = labels[page] || button.textContent.trim();
    button.replaceChildren(icon, label);
  });
  const brand = document.querySelector('.brand');
  if (brand) { const image = document.createElement('img'); image.src = 'assets/app-icon.png'; image.alt = ''; const label = document.createElement('span'); label.textContent = 'RadminCraft'; brand.replaceChildren(image, label); }
})();
