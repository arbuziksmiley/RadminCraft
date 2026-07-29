const people = [['R', 'RamazanTM', 'game', 'в игре'], ['M', 'Masha', 'game', 'в игре'], ['A', 'Alex', 'launcher', 'в лаунчере'], ['V', 'Vlad', 'network', 'в сети']];
const messages = [['R', 'RamazanTM', 'game', 'Привет! Кто пойдёт в шахту?', '19:24'], ['M', 'Masha', 'game', 'Я уже у деревни, собираю еду.', '19:25'], ['A', 'Alex', 'app', 'Через пять минут буду в игре ✨', '19:27']];
let settings;
let avatar = 'head-000';
const $ = selector => document.querySelector(selector);

function person([initial, name, type, text]) {
  const statusClass = type === 'game' ? 'game-status' : type === 'launcher' ? 'launcher-status' : 'network';
  return `<div class="person"><b class="avatar">${initial}</b><span><strong>${name}</strong><small class="${statusClass}">● ${text}</small></span></div>`;
}

function render() {
  $('#online-list').innerHTML = people.map(person).join('');
  $('#voice-list').innerHTML = people.filter(([, name]) => name === 'RamazanTM' || name === 'Masha').map(([initial, name]) => `<div class="voice-person"><b class="avatar">${initial}</b> <strong>${name}</strong> <small class="${name === 'RamazanTM' ? 'game-status' : 'silent'}">● ${name === 'RamazanTM' ? 'говорит' : 'молчит'}</small></div>`).join('');
  $('#feed').innerHTML = messages.map(([initial, name, origin, text, time]) => `<div class="message"><b class="avatar">${initial}</b><div><div class="meta"><strong>${name}</strong>${origin === 'game' ? '<em class="game">Из игры</em>' : ''}<small>${time}</small></div>${text}</div></div>`).join('');
}

function updateRange(range) {
  range?.style.setProperty('--range-value', `${range.value}%`);
}

function apply(saved) {
  settings = { ...saved, theme: 'soft' };
  document.body.dataset.theme = 'soft';
  $('#self-name').textContent = saved.displayName;
  window.RadminCraftAvatars?.paint($('#self-avatar'), saved.avatar);
  window.RadminCraftAvatars?.paint($('#profile-avatar'), saved.avatar);
  $('#profile-title').textContent = saved.displayName;
  $('#display-name').value = saved.displayName;
  $('#profile-name-count').textContent = `${saved.displayName.length}/20`;
  $('#profile-name-error').textContent = '';
  $('#launcher-path').value = saved.launcherPath;
  $('#volume').value = saved.volume;
  $('#volume-out').textContent = `${saved.volume}%`;
  updateRange($('#volume'));
  $('#notify').checked = saved.notificationsEnabled;
}

document.querySelectorAll('.nav').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('.nav,.page').forEach(element => element.classList.remove('active'));
    button.classList.add('active');
    $(`#${button.dataset.page}`).classList.add('active');
  };
});

$('#chat-form').onsubmit = event => {
  event.preventDefault();
  const value = $('#chat-input').value.trim();
  if (!value) return;
  messages.push([avatar, settings.displayName, 'app', value, 'сейчас']);
  $('#chat-input').value = '';
  render();
};
$('#mic').onclick = event => {
  const on = event.currentTarget.textContent.includes('включён');
  event.currentTarget.textContent = on ? 'Микрофон выключен' : 'Микрофон включён';
};
$('#volume').oninput = event => {
  $('#volume-out').textContent = `${event.target.value}%`;
  updateRange(event.target);
};
$('#display-name').oninput = event => {
  event.target.value = event.target.value.slice(0, 20);
  $('#profile-name-count').textContent = `${event.target.value.length}/20`;
  $('#profile-name-error').textContent = '';
  event.target.removeAttribute('aria-invalid');
  $('#rebind').hidden = true;
};
$('#avatars').onclick = event => {
  const button = event.target.closest?.('[data-avatar]');
  if (!button) return;
  avatar = button.dataset.avatar;
  window.RadminCraftAvatars?.paint($('#profile-avatar'), avatar);
};
$('#save-profile').onclick = async () => {
  const previousName = settings.displayName;
  const identity = await window.radmincraft.getPublicIdentity();
  const nextName = $('#display-name').value.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!nextName) {
    $('#profile-name-error').textContent = 'Введите имя.';
    $('#display-name').setAttribute('aria-invalid', 'true');
    $('#display-name').focus();
    return;
  }
  const nameCheck = await window.radmincraft.checkDisplayName({ id: identity.deviceId, name: nextName });
  if (!nameCheck.ok || !nameCheck.available) {
    $('#profile-name-error').textContent = nameCheck.reason === 'name-taken' || nameCheck.ok ? 'Этот ник уже занят.' : 'Не удалось проверить ник.';
    $('#display-name').setAttribute('aria-invalid', 'true');
    $('#display-name').focus();
    return;
  }
  const saved = await window.radmincraft.saveSettings({
    displayName: nextName,
    avatar,
    mcNickname: settings.mcNickname || ''
  });
  messages.forEach(message => {
    const ownOrigin = ['app', 'host', 'sticker'].includes(message[2]);
    if (message[7] === identity.deviceId || (!message[7] && ownOrigin && message[1] === previousName)) {
      message[0] = saved.avatar; message[1] = saved.displayName; message[7] = identity.deviceId;
    }
  });
  await window.radmincraft.saveMessages(messages);
  await window.radmincraft.updateMessageProfile?.({
    id: identity.deviceId,
    previousName,
    name: saved.displayName,
    avatar: saved.avatar,
    clearMinecraftLink: false
  });
  apply(saved); render();
  window.radmincraftMarkSaved?.($('#save-profile'));
};
$('#save-settings').onclick = async () => {
  apply(await window.radmincraft.saveSettings({ launcherPath: $('#launcher-path').value.trim(), volume: Number($('#volume').value), notificationsEnabled: $('#notify').checked, theme: 'soft' }));
  window.radmincraftMarkSaved?.($('#save-settings'));
};
$('#launch').onclick = async () => {
  const result = await window.radmincraft.openLauncher(settings.launcherPath);
  if (!result.ok) alert(result.reason === 'not-configured' ? 'Укажите путь к лаунчеру в настройках.' : `Не удалось открыть лаунчер: ${result.reason}`);
};

window.radmincraft.loadSettings().then(saved => { apply(saved); avatar = saved.avatar; render(); });
