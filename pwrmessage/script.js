const API_URL = 'https://api.teampwr.dev';
const WS_URL = 'https://api.teampwr.dev';
const CLIENT_ID = 'web';

let socket, db, currentUser, currentIsAdmin, activeChat;
let onlineUsers = [];
let myGroups = {};
const blockedCache = new Set();
let typingTimeout = null;
let lastTypingEmit = 0;

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isGroupId(id) {
    return typeof id === 'string' && id.startsWith('pwrgc-');
}

window.showToast = (text, isError) => {
    const t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.innerText = text;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3500);
};

window.togglePasswordVisibility = (inputId, btn) => {
    const input = document.getElementById(inputId);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.innerText = showing ? 'SHOW' : 'HIDE';
};

let registerMode = false;

window.toggleRegisterMode = () => {
    registerMode = !registerMode;
    document.getElementById('auth-confirm-wrap').classList.toggle('hidden', !registerMode);
    document.getElementById('auth-submit-login').innerText = registerMode ? 'Create Account' : 'Login';
    document.getElementById('auth-submit-register').innerText = registerMode ? 'Back to Login' : 'Sign Up';
    document.getElementById('auth-submit-login').onclick = registerMode
        ? () => handleAuth('register')
        : () => handleAuth('login');
    document.getElementById('auth-submit-register').onclick = () => window.toggleRegisterMode();
};

async function checkAuth() {
    const token = localStorage.getItem('pwr_token');
    currentUser = localStorage.getItem('pwr_user');
    currentIsAdmin = localStorage.getItem('pwr_is_admin') === 'true';

    if (token && currentUser) {
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        document.getElementById('settingsAdminRow').classList.toggle('hidden', !currentIsAdmin);
        initIndexedDB();
        initSocket(token);
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
}

window.handleAuth = async function (mode) {
    const user = document.getElementById('auth-user').value.trim();
    const pass = document.getElementById('auth-pass').value;

    if (!user || !pass) return showToast('Enter a username and password.', true);

    if (mode === 'register') {
        const confirm = document.getElementById('auth-confirm').value;
        if (pass !== confirm) return showToast('Passwords do not match.', true);
    }

    try {
        const resp = await fetch(`${API_URL}/api/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass }),
        });
        const data = await resp.json();

        if (resp.ok) {
            if (mode === 'login') {
                localStorage.setItem('pwr_token', data.token);
                localStorage.setItem('pwr_user', data.user);
                localStorage.setItem('pwr_is_admin', data.isAdmin ? 'true' : 'false');
                checkAuth();
            } else {
                showToast('Account created! Please log in.');
                window.toggleRegisterMode();
            }
        } else {
            showToast(data.error || 'Something went wrong.', true);
        }
    } catch (e) {
        showToast('Server unreachable.', true);
    }
};

window.openPasswordModal = () => {
    closeSettingsModal();
    document.getElementById('pwModal').style.display = 'flex';
};
window.closePasswordModal = () => {
    document.getElementById('pwModal').style.display = 'none';
    ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => document.getElementById(id).value = '');
};
window.submitPasswordChange = async () => {
    const currentPass = document.getElementById('pwCurrent').value;
    const newPass = document.getElementById('pwNew').value;
    const confirm = document.getElementById('pwConfirm').value;
    if (newPass !== confirm) return showToast('New passwords do not match.', true);

    try {
        const resp = await fetch(`${API_URL}/api/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('pwr_token')}`,
            },
            body: JSON.stringify({ currentPass, newPass }),
        });
        const data = await resp.json();
        if (resp.ok) {
            localStorage.setItem('pwr_token', data.token);
            showToast('Password updated.');
            closePasswordModal();
        } else {
            showToast(data.error || 'Could not update password.', true);
        }
    } catch (e) {
        showToast('Server unreachable.', true);
    }
};

function initSocket(token) {
    socket = io(WS_URL, {
        auth: { token: `Bearer ${token}`, clientId: CLIENT_ID },
        transports: ['websocket'],
    });

    socket.on('force_logout', () => wipeAndLogout());

    socket.on('connect_error', (err) => {
        if (err.message === 'Auth error') wipeAndLogout();
        else showToast('Connection error.', true);
    });

    socket.on('user_list', (users) => {
        onlineUsers = Array.isArray(users) ? users : [];
        loadSidebar();
        updateInputState();
    });

    socket.on('groups_list', (groups) => {
        myGroups = {};
        (groups || []).forEach(g => { myGroups['pwrgc-' + g.id] = { ...g, id: 'pwrgc-' + g.id }; });
        cacheGroups(Object.values(myGroups));
        ensureGroupChats(Object.values(myGroups));
        loadSidebar();
        updateInputState();
    });

    socket.on('group_updated', (g) => {
        const fullId = 'pwrgc-' + g.id;
        myGroups[fullId] = { ...g, id: fullId };
        cacheGroups([myGroups[fullId]]);
        ensureGroupChats([myGroups[fullId]]);
        loadSidebar();
        if (activeChat === fullId) updateInputState();
    });

    socket.on('group_removed', ({ id }) => {
        delete myGroups[id];
        loadSidebar();
        if (activeChat === id) {
            activeChat = null;
            document.getElementById('messageDisplay').innerHTML = '';
            updateInputState();
        }
        showToast('You are no longer in that group.');
    });

    socket.on('msg', (data) => handleIncomingMessage(data));

    socket.on('feedback_received', (data) => {
        showToast(`Feedback from ${data.from}`);
    });

    socket.on('typing', (data) => {
        if (data.to !== activeChat) return;
        const el = document.getElementById('typing-indicator');
        el.innerText = `${data.from} is typing...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { el.innerText = ''; }, 3000);
    });

    socket.on('error_toast', (data) => showToast(data.message, true));
    socket.on('admin_result', (data) => showToast(data.message));
}

function handleIncomingMessage(data) {
    const chatWith = data.to || data.from;
    const tx = db.transaction(['blocked', 'chats', 'messages'], 'readwrite');
    const blockCheck = tx.objectStore('blocked').get(data.from);

    blockCheck.onsuccess = () => {
        if (blockCheck.result && !isGroupId(chatWith)) return;

        const isUnread = activeChat !== chatWith;
        tx.objectStore('chats').put({ username: chatWith, unread: isUnread });
        tx.objectStore('messages').add({
            chatWith,
            fromUser: data.from,
            text: data.text,
            type: data.type || 'text',
            time: data.ts || Date.now(),
        });

        tx.oncomplete = () => {
            if (!isUnread) {
                displayMessages();
            } else {
                const label = isGroupId(chatWith) ? (myGroups[chatWith]?.name || 'a group') : data.from;
                showToast(`New message ${isGroupId(chatWith) ? 'in' : 'from'} ${label}`);
            }
            if (document.hidden && Notification.permission === 'granted') {
                const label = isGroupId(chatWith) ? (myGroups[chatWith]?.name || 'Group') : data.from;
                new Notification(label, { body: data.type === 'image' ? 'Sent an image' : data.text });
            }
            loadSidebar();
        };
    };
}

function initIndexedDB() {
    const req = indexedDB.open('pwrmessage', 7);
    req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'username' });
        if (!d.objectStoreNames.contains('messages')) d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('blocked')) d.createObjectStore('blocked', { keyPath: 'username' });
        if (!d.objectStoreNames.contains('groups')) d.createObjectStore('groups', { keyPath: 'id' });
    };
    req.onsuccess = (e) => {
        db = e.target.result;
        db.transaction('blocked').objectStore('blocked').getAll().onsuccess = (ev) => {
            blockedCache.clear();
            ev.target.result.forEach(b => blockedCache.add(b.username));
        };
        db.transaction('groups').objectStore('groups').getAll().onsuccess = (ev) => {
            ev.target.result.forEach(g => { myGroups[g.id] = g; });
            loadSidebar();
        };
        loadSidebar();
    };
}

function cacheGroups(groups) {
    if (!db) return;
    const tx = db.transaction('groups', 'readwrite');
    groups.forEach(g => tx.objectStore('groups').put(g));
}

function ensureGroupChats(groups) {
    if (!db) return;
    const tx = db.transaction('chats', 'readwrite');
    const store = tx.objectStore('chats');
    groups.forEach(g => {
        store.get(g.id).onsuccess = (e) => {
            if (!e.target.result) store.put({ username: g.id, unread: false });
        };
    });
}

function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !activeChat) return;

    const target = activeChat === 'Send Feedback' ? 'pwrsystem-feedback' : activeChat;

    if (!isGroupId(target) && target !== 'pwrsystem-feedback') {
        const isOnline = onlineUsers.some(u => u && u.user === target);
        if (!isOnline) return showToast(`${target} is offline.`, true);
    }

    socket.emit('direct_message', { to: target, text, type: 'text' });

    const tx = db.transaction(['messages', 'chats'], 'readwrite');
    tx.objectStore('chats').put({ username: activeChat, unread: false });
    tx.objectStore('messages').add({
        chatWith: activeChat, fromUser: currentUser, text, type: 'sent', time: Date.now(),
    });
    tx.oncomplete = () => { displayMessages(); input.value = ''; };
}

window.handleImageUpload = function (input) {
    const file = input.files[0];
    if (!file || !activeChat) return;

    if (activeChat === 'Send Feedback') {
        showToast('Cannot send images in the feedback channel.', true);
        input.value = '';
        return;
    }

    const target = activeChat;
    if (!isGroupId(target)) {
        const isOnline = onlineUsers.some(u => u && u.user === target);
        if (!isOnline) {
            showToast(`${target} is offline. Cannot send images.`, true);
            input.value = '';
            return;
        }
    }

    if (!file.type.startsWith('image/')) {
        showToast('Only image files are supported.', true);
        input.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image is over 5MB, cannot send.', true);
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Data = e.target.result;
        socket.emit('direct_message', { to: target, text: base64Data, type: 'image' });

        const tx = db.transaction(['messages', 'chats'], 'readwrite');
        tx.objectStore('chats').put({ username: activeChat, unread: false });
        tx.objectStore('messages').add({
            chatWith: activeChat, fromUser: currentUser, text: base64Data, type: 'sent_image', time: Date.now(),
        });
        tx.oncomplete = () => { displayMessages(); input.value = ''; };
    };
    reader.readAsDataURL(file);
};

function emitTyping() {
    if (!activeChat || activeChat === 'Send Feedback') return;
    const now = Date.now();
    if (now - lastTypingEmit < 1500) return;
    lastTypingEmit = now;
    socket.emit('typing', { to: activeChat });
}

function updateInputState() {
    const msgInput = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendBtn');
    const headerStatus = document.getElementById('headerStatus');
    const headerName = document.getElementById('headerName');
    const headerInfoBtn = document.getElementById('headerInfoBtn');
    const imageBtn = document.querySelector('[onclick*="imageInput"]');

    if (!activeChat) {
        msgInput.disabled = true;
        headerStatus.innerText = '';
        headerName.innerText = 'Select a contact';
        headerInfoBtn.classList.add('hidden');
        return;
    }

    if (activeChat === 'Send Feedback') {
        headerName.innerText = 'Send Feedback';
        headerStatus.innerText = '';
        headerInfoBtn.classList.add('hidden');
        msgInput.disabled = false;
        msgInput.placeholder = 'Write a message...';
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        if (imageBtn) imageBtn.style.display = 'none';
        return;
    }

    if (imageBtn) imageBtn.style.display = '';

    if (isGroupId(activeChat)) {
        const group = myGroups[activeChat];
        headerName.innerText = group ? group.name : 'Group';
        const onlineCount = group ? group.members.filter(m => onlineUsers.some(u => u.user === m)).length : 0;
        headerStatus.innerText = group ? `${group.members.length} members - ${onlineCount} online` : '';
        headerStatus.className = 'text-xs font-medium text-gray-400';
        headerInfoBtn.classList.remove('hidden');
        msgInput.disabled = false;
        msgInput.placeholder = 'Message the group...';
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        return;
    }

    headerInfoBtn.classList.add('hidden');
    const isOnline = onlineUsers.some(u => u && u.user === activeChat);
    headerName.innerText = activeChat;
    headerStatus.innerText = isOnline ? 'Online' : 'Offline';
    headerStatus.className = `text-xs font-medium ${isOnline ? 'text-green-500' : 'text-gray-400'}`;
    msgInput.disabled = !isOnline;
    msgInput.placeholder = isOnline ? 'Type a message...' : 'User is offline';
    sendBtn.disabled = !isOnline;
    sendBtn.style.opacity = isOnline ? '1' : '0.5';
}

function loadSidebar() {
    const list = document.getElementById('userList');
    if (!list) return;
    list.innerHTML = '';
    renderFeedbackChatItem(list);
    if (!db) return;

    const tx = db.transaction(['chats', 'blocked'], 'readonly');
    tx.objectStore('blocked').getAll().onsuccess = (be) => {
        const blocked = be.target.result.map(b => b.username);
        tx.objectStore('chats').getAll().onsuccess = (ce) => {
            ce.target.result
                .filter(c => c.username !== 'Send Feedback' && c.username !== 'pwrsystem-feedback')
                .forEach(contact => {
                    if (isGroupId(contact.username)) {
                        renderGroupItem(contact, list);
                    } else {
                        renderChatItem(contact, list, blocked.includes(contact.username));
                    }
                });
        };
    };
}

function renderFeedbackChatItem(container) {
    const div = document.createElement('div');
    const isActive = activeChat === 'Send Feedback';
    div.className = `chat-item relative flex items-center justify-between p-4 mb-1 rounded-xl font-medium transition ${isActive ? 'active-chat' : ''} hover:bg-gray-50 cursor-pointer`;
    div.onclick = () => selectChat('Send Feedback');
    div.innerHTML = `<div class="flex items-center gap-2"><span>Send Feedback</span></div>`;
    container.appendChild(div);
}

function renderChatItem(contact, container, isBlocked) {
    const div = document.createElement('div');
    const blockedClasses = isBlocked ? 'opacity-40 grayscale pointer-events-none' : 'hover:bg-gray-50 cursor-pointer';
    const activeClass = activeChat === contact.username ? 'active-chat' : '';
    div.className = `chat-item relative flex items-center justify-between p-4 mb-1 rounded-xl font-medium transition ${activeClass} ${blockedClasses}`;

    if (!isBlocked) div.onclick = () => selectChat(contact.username);

    const isOnline = onlineUsers.some(u => u && u.user === contact.username);
    const dotColor = isOnline ? 'bg-green-500' : 'bg-gray-300';
    const menuId = `menu-${contact.username.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'flex items-center gap-2';
    nameWrapper.innerHTML = `<div class="w-2 h-2 ${dotColor} rounded-full" style="flex-shrink:0"></div>` +
        `<span>${escapeHtml(contact.username)}${isBlocked ? ' (Blocked)' : ''}</span>` +
        (contact.unread && !isBlocked ? `<div class="w-2 h-2 bg-black rounded-full"></div>` : '');

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'menu-dropdown shadow-lg border bg-white';
    menu.style.cssText = 'pointer-events:auto; display:none; position:absolute; right:10px; top:40px; z-index:100;';
    menu.innerHTML = isBlocked
        ? `<div class="menu-item p-2 hover:bg-gray-100" data-action="unblock">Unblock User</div>`
        : `<div class="menu-item p-2 hover:bg-gray-100" data-action="block">Block User</div>`;
    menu.innerHTML += `<div class="menu-item p-2 hover:bg-red-50 text-red-600 font-bold" data-action="delete">Delete Chat</div>`;
    menu.querySelectorAll('[data-action]').forEach(el => {
        el.onclick = () => {
            const action = el.dataset.action;
            if (action === 'unblock') uiUnblockUser(contact.username);
            if (action === 'block') uiBlockUser(contact.username);
            if (action === 'delete') uiDeleteChat(contact.username);
        };
    });

    const dotBtn = document.createElement('div');
    dotBtn.className = 'dot-btn';
    dotBtn.style.pointerEvents = 'auto';
    dotBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
    dotBtn.onclick = (ev) => toggleMenu(ev, menuId);

    div.appendChild(nameWrapper);
    div.appendChild(dotBtn);
    div.appendChild(menu);
    container.appendChild(div);
}

function renderGroupItem(contact, container) {
    const group = myGroups[contact.username];
    const activeClass = activeChat === contact.username ? 'active-chat' : '';
    const div = document.createElement('div');
    div.className = `chat-item relative flex items-center justify-between p-4 mb-1 rounded-xl font-medium transition ${activeClass} hover:bg-gray-50 cursor-pointer`;
    div.onclick = () => selectChat(contact.username);

    const name = group ? group.name : 'Group';
    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'flex items-center gap-2';
    nameWrapper.innerHTML = `<span class="group-badge">G</span><span>${escapeHtml(name)}</span>` +
        (contact.unread ? `<div class="w-2 h-2 bg-black rounded-full"></div>` : '');

    const menuId = `menu-${contact.username}`;
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'menu-dropdown shadow-lg border bg-white';
    menu.style.cssText = 'pointer-events:auto; display:none; position:absolute; right:10px; top:40px; z-index:100;';
    menu.innerHTML = `<div class="menu-item p-2 hover:bg-gray-100" data-action="info">Group Info</div>` +
        `<div class="menu-item p-2 hover:bg-red-50 text-red-600 font-bold" data-action="delete">Delete Local History</div>`;
    menu.querySelectorAll('[data-action]').forEach(el => {
        el.onclick = () => {
            if (el.dataset.action === 'info') openGroupInfoModal(contact.username);
            if (el.dataset.action === 'delete') uiDeleteChat(contact.username);
        };
    });

    const dotBtn = document.createElement('div');
    dotBtn.className = 'dot-btn';
    dotBtn.style.pointerEvents = 'auto';
    dotBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
    dotBtn.onclick = (ev) => toggleMenu(ev, menuId);

    div.appendChild(nameWrapper);
    div.appendChild(dotBtn);
    div.appendChild(menu);
    container.appendChild(div);
}

function selectChat(id) {
    activeChat = id;
    const tx = db.transaction('chats', 'readwrite');
    tx.objectStore('chats').put({ username: id, unread: false });
    tx.oncomplete = () => { displayMessages(); loadSidebar(); updateInputState(); };
}

function displayMessages() {
    const display = document.getElementById('messageDisplay');
    if (!display || !activeChat) return;
    display.innerHTML = '';

    if (activeChat === 'Send Feedback') {
        const banner = document.createElement('div');
        banner.className = 'message-bubble received';
        banner.textContent = 'Use this chat to send feedback for pwRMessage. Spam or troll feedback can result in account suspension.';
        display.appendChild(banner);
    }
    if (!db) return;

    db.transaction('messages').objectStore('messages').getAll().onsuccess = (e) => {
        e.target.result
            .filter(m => m.chatWith === activeChat || (activeChat === 'Send Feedback' && m.chatWith === 'pwrsystem-feedback'))
            .forEach(m => {
                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                wrapper.style.alignItems = m.type.includes('sent') ? 'flex-end' : 'flex-start';

                if (isGroupId(activeChat) && !m.type.includes('sent')) {
                    const meta = document.createElement('div');
                    meta.className = 'message-meta';
                    meta.textContent = m.fromUser || '';
                    wrapper.appendChild(meta);
                }

                const div = document.createElement('div');
                div.className = `message-bubble ${m.type.includes('sent') ? 'sent' : 'received'}`;

                if (m.type.includes('image')) {
                    const img = document.createElement('img');
                    img.src = m.text;
                    img.className = 'max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition';
                    img.onclick = () => window.open(m.text, '_blank');
                    div.appendChild(img);
                } else {
                    div.textContent = m.text;
                }
                wrapper.appendChild(div);
                display.appendChild(wrapper);
            });
        display.scrollTop = display.scrollHeight;
    };
}

window.openModal = function (options) {
    const modal = document.getElementById('customModal');
    const mInput = document.getElementById('modalInput');
    const mConfirm = document.getElementById('modalConfirm');

    document.getElementById('modalTitle').innerText = options.title;
    document.getElementById('modalDesc').innerText = options.desc || '';
    mInput.value = '';
    modal.style.display = 'flex';
    mInput.focus();

    const newConfirm = mConfirm.cloneNode(true);
    mConfirm.parentNode.replaceChild(newConfirm, mConfirm);

    const runConfirm = () => {
        const val = mInput.value.trim();
        if (val) { options.onConfirm(val); closeModal(); }
    };
    newConfirm.onclick = runConfirm;
    mInput.onkeydown = (e) => { if (e.key === 'Enter') runConfirm(); };
};
window.closeModal = () => { document.getElementById('customModal').style.display = 'none'; };

window.toggleMenu = (event, menuId) => {
    event.stopPropagation();
    document.querySelectorAll('.menu-dropdown').forEach(m => m.style.display = 'none');
    const menu = document.getElementById(menuId);
    if (menu) menu.style.display = 'block';
};

window.openNewChatModal = (tab) => {
    document.getElementById('dmUserInput').value = '';
    populateGroupMemberList();
    switchNewChatTab(tab || 'dm');
    document.getElementById('newChatModal').style.display = 'flex';
};
window.closeNewChatModal = () => { document.getElementById('newChatModal').style.display = 'none'; };

window.switchNewChatTab = (tab) => {
    const isDM = tab === 'dm';
    document.getElementById('tabBtnDM').classList.toggle('active', isDM);
    document.getElementById('tabBtnGroup').classList.toggle('active', !isDM);
    document.getElementById('newChatPanelDM').classList.toggle('hidden', !isDM);
    document.getElementById('newChatPanelGroup').classList.toggle('hidden', isDM);
};

window.submitStartChat = async () => {
    const val = document.getElementById('dmUserInput').value.trim();
    if (!val) return showToast('Enter a username.', true);
    if (val === currentUser) return showToast("Can't chat with yourself.", true);
    try {
        const resp = await fetch(`${API_URL}/api/user/${encodeURIComponent(val)}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('pwr_token')}` },
        });
        if (resp.ok) {
            const tx = db.transaction(['chats'], 'readwrite');
            tx.objectStore('chats').put({ username: val, unread: false });
            tx.oncomplete = () => { loadSidebar(); closeNewChatModal(); };
        } else {
            showToast('User not found.', true);
        }
    } catch (e) { showToast('Connection error.', true); }
};

window.uiBlockUser = (username) => {
    const tx = db.transaction(['blocked'], 'readwrite');
    tx.objectStore('blocked').put({ username });
    tx.oncomplete = () => {
        blockedCache.add(username);
        if (activeChat === username) { activeChat = null; document.getElementById('messageDisplay').innerHTML = ''; }
        loadSidebar(); updateInputState(); showToast('User blocked.');
    };
};

window.uiUnblockUser = (username) => {
    const tx = db.transaction(['blocked'], 'readwrite');
    tx.objectStore('blocked').delete(username);
    tx.oncomplete = () => { blockedCache.delete(username); loadSidebar(); showToast('User unblocked.'); };
};

window.uiDeleteChat = (id) => {
    window.openModal({
        title: 'Delete Chat History?',
        desc: 'Type "CONFIRM" to delete this local history. This only affects your device.',
        onConfirm: (val) => {
            if (val !== 'CONFIRM') return;
            const tx = db.transaction(['chats', 'messages'], 'readwrite');
            tx.objectStore('chats').delete(id);
            const msgStore = tx.objectStore('messages');
            msgStore.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) { if (cursor.value.chatWith === id) cursor.delete(); cursor.continue(); }
            };
            tx.oncomplete = () => {
                if (activeChat === id) { activeChat = null; document.getElementById('messageDisplay').innerHTML = ''; }
                loadSidebar(); updateInputState();
            };
        },
    });
};

function populateGroupMemberList() {
    const list = document.getElementById('groupMemberList');
    list.innerHTML = '';
    document.getElementById('groupNameInput').value = '';
    if (!db) return;

    db.transaction('chats').objectStore('chats').getAll().onsuccess = (e) => {
        const candidates = e.target.result
            .map(c => c.username)
            .filter(u => u !== 'Send Feedback' && u !== 'pwrsystem-feedback' && !isGroupId(u) && !blockedCache.has(u));
        if (!candidates.length) {
            list.innerHTML = `<p class="text-sm text-gray-400">No contacts found. Try starting a DM!</p>`;
        } else {
            candidates.forEach(u => {
                const row = document.createElement('label');
                row.className = 'member-row';
                row.innerHTML = `<input type="checkbox" value="${escapeHtml(u)}"> <span>${escapeHtml(u)}</span>`;
                list.appendChild(row);
            });
        }
    };
}

window.submitCreateGroup = () => {
    const name = document.getElementById('groupNameInput').value.trim();
    if (!name) return showToast('Enter a group name.', true);
    const members = Array.from(document.querySelectorAll('#groupMemberList input[type=checkbox]:checked')).map(c => c.value);
    if (!members.length) return showToast('Select at least one member.', true);
    socket.emit('create_group', { name, members });
    closeNewChatModal();
};

window.uiOpenActiveGroupInfo = () => { if (isGroupId(activeChat)) openGroupInfoModal(activeChat); };

window.openGroupInfoModal = (groupId) => {
    const group = myGroups[groupId];
    if (!group) return;
    document.getElementById('groupInfoTitle').innerText = group.name;

    const membersEl = document.getElementById('groupInfoMembers');
    membersEl.innerHTML = '';
    group.members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'member-row justify-between';
        const isOwner = m === group.owner;
        const canRemove = group.owner === currentUser && !isOwner;
        row.innerHTML = `<span>${escapeHtml(m)}${isOwner ? ' (owner)' : ''}</span>`;
        if (canRemove) {
            const btn = document.createElement('button');
            btn.className = 'text-xs font-bold text-red-500 hover:text-red-700';
            btn.innerText = 'Remove';
            btn.onclick = () => socket.emit('update_group_members', { groupId, action: 'remove', username: m });
            row.appendChild(btn);
        }
        membersEl.appendChild(row);
    });

    const ownerControls = document.getElementById('groupInfoOwnerControls');
    ownerControls.innerHTML = '';
    if (group.owner === currentUser) {
        ownerControls.innerHTML = `
            <div class="flex gap-2">
                <input id="addMemberInput" type="text" placeholder="Add username"
                    class="flex-grow bg-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-black text-sm">
                <button id="addMemberBtn" class="bg-black text-white px-4 rounded-xl font-bold text-sm">Add</button>
            </div>`;
        document.getElementById('addMemberBtn').onclick = () => {
            const username = document.getElementById('addMemberInput').value.trim();
            if (username) socket.emit('update_group_members', { groupId, action: 'add', username });
        };
    }

    const dangerBtn = document.getElementById('groupInfoDangerBtn');
    if (group.owner === currentUser) {
        dangerBtn.innerText = 'Delete Group';
        dangerBtn.onclick = () => {
            if (confirm(`Delete "${group.name}" for everyone? This cannot be undone.`)) {
                socket.emit('delete_group', { groupId });
                closeGroupInfoModal();
            }
        };
    } else {
        dangerBtn.innerText = 'Leave Group';
        dangerBtn.onclick = () => {
            if (confirm(`Leave "${group.name}"?`)) {
                socket.emit('leave_group', { groupId });
                closeGroupInfoModal();
            }
        };
    }

    document.getElementById('groupInfoModal').style.display = 'flex';
};
window.closeGroupInfoModal = () => { document.getElementById('groupInfoModal').style.display = 'none'; };

window.openAdminModal = () => {
    closeSettingsModal();
    document.getElementById('adminModal').style.display = 'flex';
};
window.closeAdminModal = () => {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('adminTarget').value = '';
    document.getElementById('adminValue').value = '';
};

document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'adminCmd') {
        document.getElementById('adminValue').classList.toggle('hidden', e.target.value !== 'resetPassword');
    }
});

window.submitAdminCommand = () => {
    const selectVal = document.getElementById('adminCmd').value;
    const target = document.getElementById('adminTarget').value.trim();
    const value = document.getElementById('adminValue').value;
    if (!target && selectVal !== 'logoutAll') return showToast('Enter a target username.', true);

    let cmd = selectVal;
    let payloadValue = value;
    if (selectVal === 'revokeAdmin') { cmd = 'setAdmin'; payloadValue = false; }
    if (selectVal === 'setAdmin') { payloadValue = true; }

    socket.emit('admin_command', { cmd, target, value: payloadValue });
    closeAdminModal();
};

function refreshNotifStatus() {
    const statusEl = document.getElementById('notifStatusText');
    const btn = document.getElementById('notifActionBtn');
    if (!('Notification' in window)) {
        statusEl.innerText = 'Not supported in this browser';
        btn.classList.add('hidden');
        return;
    }
    const perm = Notification.permission;
    statusEl.innerText = perm === 'granted' ? 'Enabled' : perm === 'denied' ? 'Blocked in browser settings' : 'Not enabled';
    btn.classList.toggle('hidden', perm !== 'default');
}

window.openSettingsModal = () => {
    refreshNotifStatus();
    document.getElementById('settingsModal').style.display = 'flex';
};
window.closeSettingsModal = () => { document.getElementById('settingsModal').style.display = 'none'; };

window.requestNotifs = async () => {
    if (!('Notification' in window)) return showToast('Notifications are not supported in this browser.', true);
    const permission = await Notification.requestPermission();
    showToast(permission === 'granted' ? 'Notifications enabled!' : "We don't have permission to send notifications.");
    refreshNotifStatus();
};

window.wipeAndLogout = () => {
    localStorage.clear();
    indexedDB.deleteDatabase('pwrmessage');
    location.reload();
};

document.addEventListener('DOMContentLoaded', () => {
    const msgInput = document.getElementById('msgInput');
    msgInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
    msgInput?.addEventListener('input', emitTyping);
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('logoutBtn').onclick = wipeAndLogout;
    checkAuth();
});

window.onclick = () => document.querySelectorAll('.menu-dropdown').forEach(m => m.style.display = 'none');
