(() => {
  const demoSignatures = new Set(['RamazanTM|19:24', 'Masha|19:25', 'Alex|19:27']);
  const removeDemoContent = () => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (demoSignatures.has(`${messages[index][1]}|${messages[index][4]}`)) messages.splice(index, 1);
    }
  };
  removeDemoContent();
  people.splice(0, people.length);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  let replyTarget = null;
  let filterTerm = '';
  let selfId = '';
  let communityMembers = [];
  let selectedMentionIds = new Set();
  // Messages used to be stamped with the literal string "сейчас", so every
  // message in the feed showed the same fake time. Stamp the real local time
  // in the same HH:MM format the Forge bridge already uses.
  const messageTime = () => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  window.radmincraft.getPublicIdentity?.().then(identity => { selfId = identity.deviceId; window.radmincraftRenderOnline?.(); });
  const ensureSelfId = async () => selfId || (selfId = (await window.radmincraft.getPublicIdentity()).deviceId);
  const visibleName = (id, originalName) => {
    if (id && selfId && id === selfId) return originalName;
    const preference = id && settings?.contactAliases?.[id];
    return preference?.useAlias && preference.alias?.trim() ? preference.alias.trim() : originalName;
  };
  window.radmincraftVisibleName = visibleName;
  const renderOnline = () => {
    const online = $('#online-list'); if (!online) return;
    online.replaceChildren();
    people.forEach(([avatar, name, type, text, avatarImage, role, voiceJoined, id, voiceDeafened, micEnabled, mcNickname]) => {
      const displayName = visibleName(id, name);
      const isSelf = Boolean(id && selfId && id === selfId) || (!selfId && name === settings?.displayName && role === settings?.mode);
      const item = make(isSelf ? 'div' : 'button', `person person-button${isSelf ? ' is-self' : ''}`);
      if (!isSelf) { item.type = 'button'; item.title = `Открыть профиль ${displayName}`; }
      const picture = make('b', 'avatar', avatar);
      window.RadminCraftAvatars?.paint(picture, avatar);
      const info = make('span'); const label = make('strong', '', displayName);
      if (role === 'host') label.append(make('em', 'host-badge', 'Host'));
      if (role === 'temporary-host') label.append(make('em', 'host-badge temporary', 'Временный Host'));
      const status = make('small', type === 'game' ? 'game-status' : type === 'launcher' ? 'launcher-status' : 'network', `● ${text}`);
      info.append(label, status); item.append(picture, info);
      if (!isSelf) item.addEventListener('click', () => openRemoteProfile({ id, avatar, name, avatarImage, role, text, mcNickname }));
      online.append(item);
    });
  };
  window.radmincraftRenderOnline = renderOnline;
  const profilePopup = make('div', 'remote-profile'); profilePopup.hidden = true;
  const closeRemoteProfile = () => { profilePopup.hidden = true; };
  const openRemoteProfile = person => {
    if (!person.id || person.id === selfId) return;
    profilePopup.replaceChildren();
    const card = make('section', 'remote-profile-card');
    const close = make('button', 'remote-profile-close', '×'); close.type = 'button'; close.title = 'Закрыть'; close.addEventListener('click', closeRemoteProfile);
    const picture = make('b', 'avatar remote-profile-avatar', person.avatar);
    window.RadminCraftAvatars?.paint(picture, person.avatar);
    const preference = settings?.contactAliases?.[person.id] || { alias: '', useAlias: false };
    const title = make('h2', '', visibleName(person.id, person.name));
    if (person.role === 'host') title.append(make('em', 'host-badge', 'Host'));
    if (person.role === 'temporary-host') title.append(make('em', 'host-badge temporary', 'Временный Host'));
    const original = make('p', 'remote-profile-original', `Исходное имя: ${person.name}`);
    const minecraft = person.mcNickname
      ? make('p', 'remote-profile-minecraft', `Minecraft: ${person.mcNickname}`)
      : make('p', 'remote-profile-minecraft is-empty', 'Minecraft: не привязан');
    const aliasLabel = make('label', 'remote-alias-label', 'Моё имя для этого игрока');
    const aliasInput = document.createElement('input'); aliasInput.maxLength = 20; aliasInput.placeholder = 'Например, Дима'; aliasInput.value = String(preference.alias || '').slice(0, 20);
    const aliasMeta = make('span', 'remote-alias-meta'); const aliasError = make('small', 'remote-alias-error'); aliasError.setAttribute('aria-live', 'polite'); const aliasCount = make('small', 'remote-alias-count', `${aliasInput.value.length}/20`); aliasMeta.append(aliasError, aliasCount); aliasLabel.append(aliasInput, aliasMeta);
    let useAlias = Boolean(preference.useAlias);
    const mode = make('label', 'remote-alias-mode'); const modeCopy = make('span'); const modeToggle = document.createElement('input'); modeToggle.type = 'checkbox'; modeToggle.checked = useAlias; mode.append(modeCopy, modeToggle);
    const updateMode = () => { useAlias = modeToggle.checked; modeCopy.textContent = useAlias ? 'Показывать моё имя' : 'Показывать исходный ник'; mode.classList.toggle('is-custom', useAlias); };
    modeToggle.addEventListener('change', updateMode); updateMode();
    aliasInput.addEventListener('input', () => { aliasInput.value = aliasInput.value.slice(0, 20); aliasCount.textContent = `${aliasInput.value.length}/20`; aliasError.textContent = ''; aliasInput.removeAttribute('aria-invalid'); });
    const save = make('button', 'remote-alias-save', 'Сохранить для меня'); save.type = 'button';
    save.addEventListener('click', async () => {
      const alias = aliasInput.value.trim().replace(/\s+/g, ' ').slice(0, 20);
      if (useAlias && !alias) { aliasError.textContent = 'Сначала введите имя.'; aliasInput.setAttribute('aria-invalid', 'true'); aliasInput.focus(); return; }
      const aliases = { ...(settings.contactAliases || {}) };
      aliases[person.id] = { alias, useAlias: useAlias && Boolean(alias) };
      settings = await window.radmincraft.saveSettings({ contactAliases: aliases });
      save.disabled = true; save.textContent = 'Сохранено'; save.classList.add('is-saved'); render();
      window.setTimeout(closeRemoteProfile, 450);
    });
    card.append(close, picture, title, original, minecraft, make('p', 'muted', `● ${person.text}`), aliasLabel, mode, save); profilePopup.append(card); profilePopup.hidden = false;
  };
  profilePopup.addEventListener('click', event => { if (event.target === profilePopup) closeRemoteProfile(); }); document.body.append(profilePopup);
  const mentionsEveryone = text => /(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(text || ''));
  const appendMessageText = (target, text) => {
    const names = ['all', ...people.flatMap(person => [person[1], visibleName(person[7], person[1])]), settings?.displayName].filter((name, index, all) => name && all.indexOf(name) === index);
    const pattern = new RegExp(`(@(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))(?![\\p{L}\\p{N}_])`, 'giu');
    let index = 0; String(text).replace(pattern, (match, mention, offset) => { target.append(document.createTextNode(String(text).slice(index, offset))); target.append(make('span', 'mention', mention)); index = offset + mention.length; return match; });
    target.append(document.createTextNode(String(text).slice(index)));
  };
  const sticker = id => {
    const element = make('span', 'minecraft-sticker');
    const index = Math.max(0, Math.min(49, Number(String(id).replace('mc-', '')) || 0));
    const image = document.createElement('img');
    image.src = `assets/stickers/static/mc-${String(index).padStart(2, '0')}.png`;
    image.alt = '';
    image.draggable = false;
    element.append(image);
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', 'Minecraft-стикер');
    return element;
  };
  render = () => {
    removeDemoContent();
    const online = $('#online-list');
    renderOnline();
    const onlineCount = online?.closest('.card')?.querySelector('.row em');
    if (onlineCount) onlineCount.textContent = String(people.length);
    const feed = $('#feed');
    // Keep the feed pinned to the newest message unless the user has
    // deliberately scrolled up to read history.
    const wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    feed.replaceChildren();
    messages.forEach(([avatar, name, origin, text, time, reply, id, authorId, mentionIds], index) => {
      const resolvedAuthorId = authorId || people.find(person => person[1] === name)?.[7] || '';
      const livePerson = resolvedAuthorId ? people.find(person => person[7] === resolvedAuthorId) : null;
      const knownMember = resolvedAuthorId ? communityMembers.find(person => person.id === resolvedAuthorId) : null;
      const currentAvatar = livePerson?.[0] || knownMember?.avatar || avatar;
      const currentOriginalName = livePerson?.[1] || knownMember?.name || name;
      const currentMinecraftName = livePerson?.[10] || knownMember?.mcNickname || '';
      const currentName = visibleName(resolvedAuthorId, currentOriginalName);
      if (filterTerm && !`${currentName} ${currentOriginalName} ${text}`.toLocaleLowerCase().includes(filterTerm)) return;
      const message = make('div', 'message');
      if (id) message.dataset.messageId = id;
      const canOpenProfile = Boolean(resolvedAuthorId && resolvedAuthorId !== selfId && !String(resolvedAuthorId).startsWith('mc:'));
      const messageAvatar = make(canOpenProfile ? 'button' : 'b', `avatar${canOpenProfile ? ' message-profile-trigger' : ''}`, currentAvatar);
      if (canOpenProfile) {
        messageAvatar.type = 'button';
        messageAvatar.title = `Открыть профиль ${currentName}`;
        messageAvatar.addEventListener('click', () => openRemoteProfile({
          id: resolvedAuthorId,
          avatar: currentAvatar,
          name: currentOriginalName,
          role: livePerson?.[5] || knownMember?.role || 'client',
          text: livePerson?.[3] || 'участник сообщества',
          mcNickname: currentMinecraftName
        }));
      }
      window.RadminCraftAvatars?.paint(messageAvatar, currentAvatar); message.append(messageAvatar);
      const content = make('div', 'message-content'); const meta = make('div', 'meta');
      const authorName = make(canOpenProfile ? 'button' : 'strong', canOpenProfile ? 'message-author-button' : '', currentName);
      if (canOpenProfile) {
        authorName.type = 'button';
        authorName.addEventListener('click', () => messageAvatar.click());
      }
      meta.append(authorName);
      if (origin === 'game') meta.append(make('em', 'game', 'Из игры'));
      if (origin === 'host') meta.append(make('em', 'host-message', 'Host'));
      meta.append(make('small', '', time));
      const ownMessage = resolvedAuthorId ? resolvedAuthorId === selfId : name === settings?.displayName;
      if (!ownMessage) {
        const reply = make('button', 'message-reply', 'Ответить');
        reply.type = 'button'; reply.title = `Ответить ${currentName}`;
        reply.addEventListener('click', () => {
          const input = $('#chat-input');
          if (!input) return;
          replyTarget = { name: currentName, originalName: currentOriginalName, text: String(text).slice(0, 120) };
          updateReplyPreview();
          input.value = `@${currentOriginalName} `;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        });
        meta.append(reply);
      }
      if (ownMessage && (origin === 'app' || origin === 'host' || origin === 'sticker')) {
        const remove = make('button', 'message-delete', 'Удалить');
        remove.type = 'button'; remove.addEventListener('click', () => { messages.splice(index, 1); render(); window.radmincraft.saveMessages(messages); if (id) window.dispatchEvent(new CustomEvent('radmincraft:message-delete', { detail: id })); }); meta.append(remove);
      }
      const body = make('div', 'message-text');
      if (reply?.name) {
        const context = make('div', 'reply-context');
        context.append(make('strong', '', reply.name), make('span', '', reply.text));
        body.append(context);
      }
      if (origin === 'sticker') body.append(sticker(text));
      else { const textNode = make('span', 'message-body'); appendMessageText(textNode, text); body.append(textNode); }
      content.append(meta, body); message.append(content); feed.append(message);
    });
    if (!feed.childElementCount) {
      const empty = make('div', 'feed-empty');
      empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/></svg>';
      const title = make('strong', '', filterTerm ? 'Ничего не найдено' : 'Пока сообщений нет');
      const hint = make('span', '', filterTerm ? 'Попробуйте изменить запрос.' : 'Напишите первым — увидят все, кто в сети.');
      empty.append(title, hint);
      feed.append(empty);
    }
    if (wasAtBottom) feed.scrollTop = feed.scrollHeight;
  };
  const input = $('#chat-input'); const form = $('#chat-form');
  if (!input || !form) return;
  const replyPreview = make('div', 'chat-reply-preview'); replyPreview.hidden = true;
  const updateReplyPreview = () => {
    replyPreview.replaceChildren(); replyPreview.hidden = !replyTarget;
    if (!replyTarget) return;
    replyPreview.append(make('span', '', `Ответ ${replyTarget.name}: ${replyTarget.text}`));
    const cancel = make('button', '', '×'); cancel.type = 'button'; cancel.title = 'Отменить ответ';
    cancel.addEventListener('click', () => { replyTarget = null; updateReplyPreview(); input.focus(); }); replyPreview.append(cancel);
  };
  form.parentNode.insertBefore(replyPreview, form);
  const pickerButton = (icon, label) => { const button = make('button', 'compose-picker-button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); const image = document.createElement('img'); image.src = `icons/${icon}.svg`; image.alt = ''; button.append(image); return button; };
  const stickerButton = pickerButton('sticker', 'Стикеры');
  const emojiButton = pickerButton('smile', 'Смайлы');
  const stickerPanel = make('div', 'sticker-panel'); stickerPanel.hidden = true;
  Array.from({ length: 50 }, (_, index) => index).forEach(index => {
    const button = make('button', 'sticker-choice'); button.type = 'button'; button.title = `Стикер ${index + 1}`; button.append(sticker(`mc-${index}`));
    button.addEventListener('click', async () => {
      const sentMessage = [avatar, settings.displayName, 'sticker', `mc-${index}`, messageTime(), null, crypto.randomUUID(), await ensureSelfId(), []];
      messages.push(sentMessage); stickerPanel.hidden = true; render();
      window.dispatchEvent(new CustomEvent('radmincraft:message-sent', { detail: sentMessage }));
      window.radmincraftSounds?.messageOutgoing();
    });
    stickerPanel.append(button);
  });
  const emojiPanel = make('div', 'emoji-panel'); emojiPanel.hidden = true;
  const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','😉','😍','🥰','😘','😎','🤔','🙄','😴','😢','😭','😡','🤯','🥳','😱','👍','👎','👏','🙏','💪','🤝','❤️','💜','🔥','✨','🎉','✅','❌','🎮','⛏️','🧱','💎','🐺','🐼','🐷','🐝','👀','💬','🔊'];
  emojis.forEach(emoji => {
    const button = make('button', 'emoji-choice', emoji); button.type = 'button'; button.title = emoji;
    button.addEventListener('click', () => {
      const start = input.selectionStart ?? input.value.length; const end = input.selectionEnd ?? start;
      input.setRangeText(emoji, start, end, 'end'); emojiPanel.hidden = true; input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    emojiPanel.append(button);
  });
  const closePickers = () => { stickerPanel.hidden = true; emojiPanel.hidden = true; };
  stickerButton.addEventListener('click', event => { event.stopPropagation(); const open = stickerPanel.hidden; closePickers(); stickerPanel.hidden = !open; });
  emojiButton.addEventListener('click', event => { event.stopPropagation(); const open = emojiPanel.hidden; closePickers(); emojiPanel.hidden = !open; });
  document.addEventListener('pointerdown', event => {
    if (!stickerPanel.contains(event.target) && !emojiPanel.contains(event.target) && event.target !== stickerButton && event.target !== emojiButton) closePickers();
  });
  form.insertBefore(emojiButton, input); form.insertBefore(stickerButton, emojiButton); form.parentNode.insertBefore(stickerPanel, form); form.parentNode.insertBefore(emojiPanel, form);
  form.onsubmit = async event => {
    event.preventDefault(); const value = input.value.trim();
    if (!value) return;
    const authorId = await ensureSelfId();
    if (mentionsEveryone(value)) {
      [...people.map(person => person[7]), ...communityMembers.map(person => person.id)]
        .filter(id => id && id !== authorId)
        .forEach(id => selectedMentionIds.add(id));
    }
    const sentMessage = [avatar, settings.displayName, settings.mode === 'host' ? 'host' : 'app', value, messageTime(), replyTarget, crypto.randomUUID(), authorId, [...selectedMentionIds]];
    messages.push(sentMessage);
    input.value = ''; selectedMentionIds.clear(); replyTarget = null; updateReplyPreview(); render();
    window.dispatchEvent(new CustomEvent('radmincraft:message-sent', { detail: sentMessage }));
    window.radmincraftSounds?.messageOutgoing();
    requestAnimationFrame(() => { $('#feed').scrollTop = $('#feed').scrollHeight; });
  };
  const chatRow = document.querySelector('#chat .card > .row');
  const search = document.createElement('input'); search.type = 'search'; search.className = 'chat-search'; search.placeholder = 'Поиск в чате'; search.setAttribute('aria-label', 'Поиск в чате'); chatRow?.append(search);
  search.addEventListener('input', () => { filterTerm = search.value.trim().toLocaleLowerCase(); render(); });
  const jump = make('button', 'chat-jump', 'К новым сообщениям'); jump.type = 'button'; jump.hidden = true;
  form.parentNode.insertBefore(jump, form);
  const feed = $('#feed');
  feed.addEventListener('scroll', () => { jump.hidden = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80; });
  jump.addEventListener('click', () => feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }));
  form.classList.add('compose');
  const box = make('div', 'mention-suggestions'); box.hidden = true; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', 'Упоминания участников'); form.append(box);
  let options = [], selected = 0;
  const close = () => { box.hidden = true; options = []; selected = 0; };
  const select = option => {
    input.value = input.value.replace(/@[^\s@]*$/, `@${option.original} `);
    if (option.id) selectedMentionIds.add(option.id);
    input.focus(); close();
  };
  const position = () => {
    const formRect = form.getBoundingClientRect(); const inputRect = input.getBoundingClientRect();
    box.style.left = `${Math.max(0, inputRect.left - formRect.left)}px`;
    box.style.width = `${Math.max(210, Math.min(inputRect.width, 360))}px`;
    box.style.maxHeight = `${Math.max(120, Math.min(260, formRect.top - 24))}px`;
  };
  const show = () => {
    const match = input.value.match(/@([^\s@]*)$/); if (!match) return close();
    const query = match[1].toLocaleLowerCase();
    const active = people.map(person => ({ id: person[7], original: person[1], display: visibleName(person[7], person[1]) }));
    const offline = communityMembers.map(person => ({ id: person.id, original: person.name, display: visibleName(person.id, person.name) }));
    const memberOptions = active.concat(offline).filter((option, index, all) =>
      option.id && option.id !== selfId && !String(option.id).startsWith('mc:') && option.original &&
      all.findIndex(item => item.id === option.id) === index &&
      (option.original.toLocaleLowerCase().startsWith(query) || option.display.toLocaleLowerCase().startsWith(query))
    );
    const everyoneOption = 'all'.startsWith(query)
      ? [{ id: '', original: 'all', display: 'Все участники', everyone: true }]
      : [];
    options = everyoneOption.concat(memberOptions).slice(0, 12);
    if (!options.length) return close();
    box.replaceChildren(); options.forEach((option, index) => { const label = option.everyone ? '@all · Все участники' : option.display === option.original ? `@${option.original}` : `${option.display} · @${option.original}`; const button = make('button', index === selected ? 'is-selected' : '', label); button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === selected)); button.addEventListener('click', () => select(option)); box.append(button); }); position(); box.hidden = false;
  };
  input.addEventListener('input', () => { selected = 0; show(); });
  input.addEventListener('keydown', event => { if (box.hidden) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; show(); } else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); select(options[selected]); } else if (event.key === 'Escape') close(); });
  document.addEventListener('pointerdown', event => { if (!box.hidden && !form.contains(event.target)) close(); });
  window.addEventListener('resize', () => { if (!box.hidden) position(); });
  const refreshCommunityMembers = () => window.radmincraft.getLanMembers?.().then(result => {
    if (result?.ok) { communityMembers = result.members || []; render(); }
  });
  refreshCommunityMembers();
  window.setInterval(refreshCommunityMembers, 15000);
  render();
  window.radmincraft.saveMessages(messages);
})();

(() => {
  const nav = document.querySelector('.nav[data-page="chat"]');
  const header = document.querySelector('#chat .card > .row');
  const feed = document.querySelector('#feed');
  if (!nav || !header || !feed) return;
  const badge = document.createElement('span');
  badge.className = 'mention-nav-badge'; badge.hidden = true; nav.append(badge);
  const jump = document.createElement('button');
  jump.type = 'button'; jump.className = 'mention-inbox-button'; jump.hidden = true; header.append(jump);
  let mentionSelfId = ''; let readMentionIds = new Set(); let unreadMentions = []; let mentionStateLoaded = false;
  const isMention = message => {
    if (!message?.[6] || message[7] === mentionSelfId) return false;
    if (Array.isArray(message[8]) && message[8].includes(mentionSelfId)) return true;
    if (/(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(message[3] || ''))) return true;
    const nick = String(settings?.displayName || '').trim();
    if (!nick) return false;
    const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(String(message[3] || ''));
  };
  const updateMentionInbox = async () => {
    if (!mentionStateLoaded) {
      const [identity, stored] = await Promise.all([window.radmincraft.getPublicIdentity(), window.radmincraft.loadSettings()]);
      mentionSelfId = identity.deviceId;
      readMentionIds = new Set(Array.isArray(stored.readMentionIds) ? stored.readMentionIds : []);
      mentionStateLoaded = true;
    }
    unreadMentions = messages.filter(message => isMention(message) && !readMentionIds.has(message[6]));
    const count = unreadMentions.length;
    badge.hidden = jump.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    jump.textContent = count ? `Упоминания · ${count}` : '';
  };
  jump.addEventListener('click', async () => {
    const message = unreadMentions[0]; if (!message) return;
    nav.click();
    const element = feed.querySelector(`[data-message-id="${CSS.escape(message[6])}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.classList.add('mention-highlight');
    setTimeout(() => element?.classList.remove('mention-highlight'), 1800);
    readMentionIds.add(message[6]);
    await window.radmincraft.saveSettings({ readMentionIds: [...readMentionIds].slice(-1000) });
    updateMentionInbox();
  });
  new MutationObserver(updateMentionInbox).observe(feed, { childList: true });
  updateMentionInbox();
})();

(() => {
  if (!window.radmincraft?.getLanStatus) return;
  const stripDemo = () => {
    const signatures = new Set(['RamazanTM|19:24', 'Masha|19:25', 'Alex|19:27']);
    for (let index = messages.length - 1; index >= 0; index--) {
      if (signatures.has(`${messages[index][1]}|${messages[index][4]}`)) messages.splice(index, 1);
    }
  };
  const headerStatus = document.querySelector('#chat header .online');
  const vpnNotice = document.createElement('section');
  vpnNotice.className = 'radmin-vpn-notice'; vpnNotice.hidden = true;
  vpnNotice.innerHTML = '<strong>Radmin VPN не запущен</strong><span>Откройте Radmin VPN и подключитесь к вашей сети. Без него чат, голос и Host недоступны.</span>';
  document.querySelector('main')?.prepend(vpnNotice);
  let lastFingerprint = '';
  let initialHistoryLoaded = false;
  let sentProfileFingerprint = '';
  let unreadCount = 0;
  let knownGamePeople = null;
  let refreshRunning = false;
  // A single timed-out poll used to wipe the whole online list, so participants
  // blinked in and out every few seconds. Only clear after several consecutive
  // failures, which means the connection is genuinely down rather than slow.
  let statusFailures = 0;
  const failuresBeforeClearing = 3;
  // Recently-seen participants, id -> { seenAt, row }. Smooths over polls that
  // momentarily miss someone so the online list stops flickering.
  const presenceCache = new Map();
  const PRESENCE_HOLD = 90000;
  let nameConflictShown = false;
  const resetUnread = () => { unreadCount = 0; document.title = 'RadminCraft'; };
  window.addEventListener('focus', resetUnread);
  // A message counts as a mention when it addresses this player by their real
  // nickname, which is what @-autocomplete always inserts.
  // Mirrors mentionsNick() in electron/protocol.js, which is covered by tests.
  // The Unicode lookahead matters here: \b would never match Cyrillic nicknames.
  const mentionsMe = (text, myName) => {
    if (/(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(text || ''))) return true;
    const nick = String(myName || '').trim();
    if (!nick) return false;
    const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(String(text || ''));
  };
  const announceMessage = (message, settingsSnapshot) => {
    const myName = settingsSnapshot?.displayName;
    if (settingsSnapshot?.notificationsEnabled === false) return;
    window.radmincraftSounds?.messageIncoming();
    const author = window.radmincraftVisibleName?.(message[7], message[1]) || message[1];
    const text = message[2] === 'sticker' ? 'Прислал стикер' : String(message[3]).slice(0, 120);
    if (mentionsMe(message[3], myName)) {
      window.radmincraftNotify?.({ kind: 'mention', title: `${author} упомянул вас`, body: text, page: 'chat', setting: 'notifyMentions' });
    } else {
      window.radmincraftNotify?.({ kind: 'message', title: author, body: text, page: 'chat', setting: 'notifyChatAll' });
    }
  };
  const setStatus = status => {
    if (!headerStatus) return;
    if (!status.ok && status.mode === 'host') {
      headerStatus.classList.add('is-offline');
      headerStatus.textContent = status.reason === 'radmin-vpn-unavailable' ? '● Host не запущен · проверьте Radmin VPN' : status.reason === 'firewall-unavailable' ? '● Host не запущен · Windows не открыла доступ' : status.reason === 'port-in-use' ? '● Порт Host занят другим приложением' : '● Не удалось запустить Host';
      return;
    }
    headerStatus.classList.toggle('is-offline', !status.ok);
    headerStatus.classList.toggle('is-temporary', status.ok && status.hostRole === 'temporary');
    headerStatus.textContent = status.ok
      ? (status.hostRole === 'temporary'
          ? `● Временный Host · ${status.serverName || status.address}`
          : status.mode === 'host' ? `● Host запущен · ${status.address}` : `● Подключено · ${status.serverName || status.address}`)
      : status.reason === 'radmin-vpn-unavailable'
        ? '● Radmin VPN не запущен'
        : status.reason === 'failover-waiting' ? '● Основной Host недоступен · выбираем временный' : '● Нет подключения к Host';
  };
  const versionBadge = document.querySelector('#chat header h1 em');
  const setServerVersion = version => { if (versionBadge && version) versionBadge.textContent = version; };
  const refreshVpnStatus = async () => {
    const vpn = await window.radmincraft.getRadminVpnStatus?.();
    if (!vpn) return;
    vpnNotice.hidden = vpn.detected;
    vpnNotice.classList.toggle('is-ready', vpn.detected);
  };
  const refresh = async () => {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
    await refreshVpnStatus();
    const status = await window.radmincraft.getLanStatus(); setStatus(status);
    if (status.serverName) {
      window.setServerName?.(status.serverName);
      const currentSettings = await window.radmincraft.loadSettings();
      if (status.mode === 'client' && currentSettings.serverName !== status.serverName) await window.radmincraft.saveSettings({ serverName: status.serverName });
    }
    if (status.mcVersion) {
      setServerVersion(status.mcVersion);
      if (status.mode === 'client') { const currentSettings = await window.radmincraft.loadSettings(); if (currentSettings.mcVersion !== status.mcVersion) await window.radmincraft.saveSettings({ mcVersion: status.mcVersion }); }
    }
    if (!status.ok) {
      statusFailures += 1;
      if (statusFailures >= failuresBeforeClearing) {
        people.splice(0, people.length);
        knownGamePeople = null;
        window.radmincraft.setWidgetState?.({ online: 0, inGame: 0, serverName: status.serverName || settings?.serverName || 'RadminCraft' });
        window.radmincraftRenderOnline?.();
      }
      return;
    }
    statusFailures = 0;
    const notificationSettings = await window.radmincraft.loadSettings();
    const identity = await window.radmincraft.getPublicIdentity();
    const launcher = await window.radmincraft.getLauncherStatus?.();
    const profileFingerprint = `${notificationSettings.displayName}|${notificationSettings.avatar}|${notificationSettings.avatarImage || ''}|${notificationSettings.mode}`;
    const presence = { id: identity.deviceId, name: notificationSettings.displayName, avatar: notificationSettings.avatar, mcNickname: notificationSettings.mcNickname || '', status: launcher?.active ? 'launcher' : 'network', role: notificationSettings.mode, voiceJoined: Boolean(window.__radmincraftVoiceJoined), voiceSpeaking: Boolean(window.__radmincraftVoiceSpeaking), voiceDeafened: Boolean(window.__radmincraftVoiceDeafened), micEnabled: window.__radmincraftMicEnabled !== false };
    presence.avatarImage = notificationSettings.avatarImage || '';
    sentProfileFingerprint = profileFingerprint;
    const presenceResult = await window.radmincraft.sendLanPresence(presence);
    if (!presenceResult.ok && presenceResult.reason === 'name-taken') {
      if (!nameConflictShown) {
        nameConflictShown = true;
        document.querySelector('.nav[data-page="profile"]')?.click();
        const field = document.querySelector('#display-name'); const error = document.querySelector('#profile-name-error');
        if (error) error.textContent = 'Этот ник уже занят другим участником. Выберите другой.';
        field?.setAttribute('aria-invalid', 'true'); field?.focus();
      }
      return;
    }
    if (presenceResult.ok) nameConflictShown = false;
    const livePeople = await window.radmincraft.getLanPeople();
    if (livePeople.ok) {
      const currentGamePeople = new Set(livePeople.people.filter(person => person.status === 'game').map(person => person.id));
      if (knownGamePeople) {
        // "Joined" means joined the hosted Minecraft server, not merely opened
        // RadminCraft — that distinction is the whole point of the notice.
        const newlyJoined = livePeople.people.filter(person => person.status === 'game' && !knownGamePeople.has(person.id) && person.id !== identity.deviceId);
        if (newlyJoined.length) {
          window.radmincraftSounds?.gameJoined();
          newlyJoined.slice(0, 2).forEach(person => window.radmincraftNotify?.({
            kind: 'join',
            title: `${window.radmincraftVisibleName?.(person.id, person.name) || person.name} зашёл на сервер`,
            body: status.serverName || notificationSettings.serverName || 'Сервер',
            page: 'chat',
            setting: 'notifyPlayerJoin'
          }));
        }
      }
      knownGamePeople = currentGamePeople;
      // Smoothing: a single poll that misses someone (a peer briefly aging past
      // the host's 20s presence timeout on a slow link) used to drop them from
      // the list, then they reappeared next poll — the flicker seen on screen.
      // Instead keep everyone seen within the last PRESENCE_HOLD ms. Map keeps
      // insertion order, so the list also stops reshuffling between polls.
      const now = Date.now();
      livePeople.people.forEach(person => {
        presenceCache.set(String(person.id), {
          seenAt: now,
          row: [person.avatar, person.name, person.status, person.status === 'game' ? 'в игре' : person.status === 'launcher' ? 'в лаунчере' : 'в сети', person.avatarImage || '', person.role || 'client', Boolean(person.voiceJoined), person.id, Boolean(person.voiceDeafened), person.micEnabled !== false, person.mcNickname || '']
        });
      });
      for (const [id, entry] of presenceCache) if (now - entry.seenAt > PRESENCE_HOLD) presenceCache.delete(id);
      const rows = [...presenceCache.values()].map(entry => entry.row);
      people.splice(0, people.length, ...rows);
      window.radmincraft.setWidgetState?.({ online: rows.length, inGame: rows.filter(row => row[2] === 'game').length, serverName: status.serverName || notificationSettings.serverName });
      window.radmincraftRenderOnline?.();
    }
    const remote = await window.radmincraft.getLanMessages();
    if (!remote.ok) { stripDemo(); return; }
    const fingerprint = JSON.stringify(remote.messages);
    if (fingerprint === lastFingerprint) return;
    if (initialHistoryLoaded) {
      const known = new Set(messages.map(message => message[6]).filter(Boolean));
      const incoming = remote.messages.filter(message => message[6] && !known.has(message[6]) && message[1] !== notificationSettings.displayName);
      if (incoming.length) {
        const latest = incoming[incoming.length - 1];
        announceMessage(latest, notificationSettings);
        if (!document.hasFocus()) { unreadCount += incoming.length; document.title = `(${unreadCount}) RadminCraft`; }
      }
    }
    lastFingerprint = fingerprint;
    messages.splice(0, messages.length, ...remote.messages); stripDemo();
    await window.radmincraft.saveMessages(messages);
    initialHistoryLoaded = true;
    render();
    } finally {
      refreshRunning = false;
    }
  };
  window.addEventListener('radmincraft:message-sent', async event => {
    const result = await window.radmincraft.sendLanMessage(event.detail);
    if (!result.ok) await window.radmincraft.saveMessages(messages);
    await refresh();
  });
  window.addEventListener('radmincraft:message-delete', async event => {
    await window.radmincraft.deleteLanMessage(event.detail);
    await refresh();
  });
  // The Host wiped the shared history: drop the local copy immediately instead
  // of waiting for the next poll, so the feed does not briefly show stale text.
  window.addEventListener('radmincraft:chat-cleared', async () => {
    messages.splice(0, messages.length);
    lastFingerprint = '';
    render();
    await refresh();
  });
  const settingsPanel = document.querySelector('.settings');
  if (settingsPanel) {
    const connection = document.createElement('section'); connection.className = 'connection-info';
    connection.innerHTML = '<div class="connection-copy"><div><strong>Подключение к сообществу</strong><em data-role>Роль</em></div><span data-status>Проверяем связь с Host…</span></div><div class="connection-actions"><button type="button" data-refresh>Обновить</button><button type="button" data-copy hidden>Скопировать адрес</button></div>';
    const updateConnection = async () => {
      const [status, current] = await Promise.all([window.radmincraft.getLanStatus(), window.radmincraft.loadSettings()]);
      connection.querySelector('[data-role]').textContent = status.hostRole === 'temporary'
        ? (status.mode === 'temporary-host' ? 'Временный Host' : 'Подключён к временному Host')
        : current.mode === 'host' ? 'Host' : 'Обычный игрок';
      connection.querySelector('[data-role]').classList.toggle('is-host', current.mode === 'host' || status.hostRole === 'temporary');
      connection.classList.toggle('is-online', status.ok);
      connection.querySelector('[data-copy]').hidden = !status.ok || status.mode !== 'host';
      if (!status.ok && status.mode === 'host') {
        connection.querySelector('[data-status]').textContent = status.reason === 'radmin-vpn-unavailable' ? 'Host не запущен: откройте Radmin VPN и подключитесь к своей сети.' : status.reason === 'firewall-unavailable' ? 'Host не запущен: Windows не подтвердила доступ к порту 18483. Перезапустите мастер подключения и подтвердите системный запрос.' : status.reason === 'port-in-use' ? 'Порт 18483 занят другим приложением.' : 'Host не удалось запустить. Перезапустите RadminCraft.';
        return;
      }
      connection.querySelector('[data-status]').textContent = status.ok
        ? (status.hostRole === 'temporary'
            ? 'Основной Host недоступен. Чат и голосовая связь работают через временный компьютер.'
            : status.mode === 'host' ? `Ваш адрес для друзей: ${status.address}` : `Подключено к: ${status.serverName || status.address}`)
        : status.reason === 'radmin-vpn-unavailable'
          ? 'Radmin VPN не запущен. Откройте его и повторите подключение.'
          : status.reason === 'failover-waiting' ? 'Основной Host недоступен. Выбираем временный Host…' : 'Host недоступен. Проверьте адрес Radmin VPN и подключение.';
    };
    connection.querySelector('[data-refresh]').addEventListener('click', updateConnection);
    connection.querySelector('[data-copy]').addEventListener('click', async event => {
      const status = await window.radmincraft.getLanStatus();
      if (!status.ok || status.mode !== 'host') return;
      await window.radmincraftCopyFeedback(event.currentTarget, status.address, 'Скопировать адрес');
    });
    settingsPanel.append(connection); updateConnection();
  }
  window.addEventListener('radmincraft:connection-changed', refresh);
  refresh(); window.setInterval(refresh, 5000);
})();
