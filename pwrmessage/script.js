const API_URL = "https://api.teampwr.dev";
const WS_URL = "wss://api.teampwr.dev";
let socket, db, currentUser, activeChat;
let onlineUsers = [];
const notifySound = new Audio('./message.mp3');

function checkAuth() {
    const token = localStorage.getItem('pwr_token');
    currentUser = localStorage.getItem('pwr_user');

    if (token && currentUser) {
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        initIndexedDB();
        initSocket(token);
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
}

window.handleAuth = async function(mode) {
    const user = document.getElementById('auth-user').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();
    if (!user || !pass) return showToast("Enter credentials");

    try {
        const resp = await fetch(`${API_URL}/api/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });
        const data = await resp.json();

        if (resp.ok) {
            if (mode === 'login') {
                localStorage.setItem('pwr_token', data.token);
                localStorage.setItem('pwr_user', data.user);
                checkAuth();
            } else {
                showToast("Registered! Please login.");
            }
        } else {
            showToast(data.error || "Auth failed");
        }
    } catch (e) {
        showToast("Server unreachable");
    }
};

function initSocket(token) {
    socket = io(WS_URL, { 
        auth: { token: `Bearer ${token}` },
        transports: ['websocket'] 
    });

    socket.on('connect', () => console.log("Socket Connected"));

    socket.on('user_list', (users) => {
        onlineUsers = users;
        loadSidebar(); 
        updateInputState();
    });

    socket.on('msg', (data) => {
        handleIncomingMessage(data);
    });

    socket.on('connect_error', (err) => {
        if (err.message === "Auth error") wipeAndLogout();
    });
}

function handleIncomingMessage(data) {
    const tx = db.transaction(['blocked', 'chats', 'messages'], 'readwrite');
    const blockCheck = tx.objectStore('blocked').get(data.from);
    
    blockCheck.onsuccess = () => {
        if (blockCheck.result) return; 
        
        const isUnread = activeChat !== data.from;
        tx.objectStore('chats').put({ username: data.from, unread: isUnread });
        tx.objectStore('messages').add({ 
            chatWith: data.from, 
            text: data.text, 
            type: data.type || 'received', 
            time: Date.now() 
        });
        
        tx.oncomplete = () => {
            if (!isUnread) {
                displayMessages();
            } else {
                showToast(`New message from ${data.from}`);
                notifySound.play().catch(() => {});
            }
            
            if (document.hidden && Notification.permission === "granted") {
                new Notification(data.from, { body: data.type === 'image' ? "Sent an image" : data.text });
            }
            loadSidebar();
        };
    };
}

function initIndexedDB() {
    const req = indexedDB.open("pwrmessage", 6);
    req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'username' });
        if (!d.objectStoreNames.contains('messages')) d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('blocked')) d.createObjectStore('blocked', { keyPath: 'username' });
    };
    req.onsuccess = (e) => { 
        db = e.target.result; 
        loadSidebar(); 
    };
}

window.handleImageUpload = function(input) {
    const file = input.files[0];
    if (!file || !activeChat) return;

    if (!onlineUsers.includes(activeChat)) {
        showToast(`${activeChat} is offline. Cannot send images.`);
        input.value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast("Image too large (Max 5MB)");
        input.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Data = e.target.result;
        
        socket.emit('direct_message', { 
            to: activeChat, 
            text: base64Data, 
            type: 'image' 
        });

        const tx = db.transaction(['messages'], 'readwrite');
        tx.objectStore('messages').add({ 
            chatWith: activeChat, 
            text: base64Data, 
            type: 'sent_image', 
            time: Date.now() 
        });
        
        tx.oncomplete = () => { 
            displayMessages(); 
            input.value = ""; 
        };
    };
    reader.readAsDataURL(file);
};

function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !activeChat) return;

    if (!onlineUsers.includes(activeChat)) {
        showToast(`${activeChat} is offline.`);
        return;
    }

    socket.emit('direct_message', { to: activeChat, text: text, type: 'text' });

    const tx = db.transaction(['messages'], 'readwrite');
    tx.objectStore('messages').add({ 
        chatWith: activeChat, 
        text: text, 
        type: 'sent', 
        time: Date.now() 
    });
    
    tx.oncomplete = () => { 
        displayMessages(); 
        input.value = ""; 
    };
}

function updateInputState() {
    const msgInput = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendBtn');
    const headerStatus = document.getElementById('headerStatus');
    const headerName = document.getElementById('headerName');
    
    if (!activeChat) {
        if (msgInput) msgInput.disabled = true;
        if (headerStatus) headerStatus.innerText = "";
        if (headerName) headerName.innerText = "Select a contact";
        return;
    }

    const isOnline = onlineUsers.includes(activeChat);

    if (headerStatus) {
        headerStatus.innerText = isOnline ? "Online" : "Offline";
        headerStatus.className = "text-xs font-medium " + (isOnline ? "text-green-500" : "text-gray-400");
    }

    if (msgInput) {
        msgInput.disabled = !isOnline;
        msgInput.placeholder = isOnline ? "Type a message..." : "User is offline";
    }

    if (sendBtn) {
        sendBtn.disabled = !isOnline;
        sendBtn.style.opacity = isOnline ? "1" : "0.5";
    }
}

function loadSidebar() {
    const list = document.getElementById('userList');
    if (!list || !db) return;
    list.innerHTML = "";
    
    const tx = db.transaction(['chats', 'blocked'], 'readonly');
    const blockStore = tx.objectStore('blocked');
    const chatStore = tx.objectStore('chats');

    blockStore.getAll().onsuccess = (be) => {
        const blockedUsers = be.target.result.map(b => b.username);
        
        chatStore.getAll().onsuccess = (ce) => {
            ce.target.result.forEach(contact => {
                const isBlocked = blockedUsers.includes(contact.username);
                renderChatItem(contact, list, isBlocked);
            });
        };
    };
}

function renderChatItem(contact, container, isBlocked) {
    const div = document.createElement('div');
    const blockedClasses = isBlocked ? "opacity-40 grayscale pointer-events-none" : "hover:bg-gray-50 cursor-pointer";
    const activeClass = (activeChat === contact.username) ? 'active-chat' : '';
    
    div.className = `chat-item relative flex items-center justify-between p-4 mb-1 rounded-xl font-medium transition ${activeClass} ${blockedClasses}`;
    
    if (!isBlocked) {
        div.onclick = () => { 
            activeChat = contact.username; 
            document.getElementById('headerName').innerText = activeChat; 
            const tx = db.transaction('chats', 'readwrite');
            tx.objectStore('chats').put({ username: contact.username, unread: false });
            tx.oncomplete = () => {
                displayMessages(); 
                loadSidebar();
                updateInputState();
            };
        };
    }

    const nameWrapper = document.createElement('div');
    nameWrapper.className = "flex items-center gap-2";
    nameWrapper.innerHTML = `<span>${contact.username} ${isBlocked ? '(Blocked)' : ''}</span>`;
    
    if (contact.unread && !isBlocked) {
        nameWrapper.innerHTML += `<div class="w-2 h-2 bg-black rounded-full"></div>`;
    }

    const menuId = `menu-${contact.username.replace(/\s+/g, '-')}`;
    div.innerHTML = `
        <div class="dot-btn" style="pointer-events: auto;" onclick="toggleMenu(event, '${menuId}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5">
                <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
        </div>
        <div id="${menuId}" class="menu-dropdown shadow-lg border bg-white" style="pointer-events: auto; display:none; position:absolute; right:10px; top:40px; z-index:100;">
            ${isBlocked 
                ? `<div class="menu-item p-2 hover:bg-gray-100" onclick="uiUnblockUser('${contact.username}')">Unblock User</div>`
                : `<div class="menu-item p-2 hover:bg-gray-100" onclick="uiBlockUser('${contact.username}')">Block User</div>`
            }
            <div class="menu-item p-2 hover:bg-red-50 text-red-600 font-bold" onclick="uiDeleteChat('${contact.username}')">Delete Chat</div>
        </div>`;
    
    div.prepend(nameWrapper);
    container.appendChild(div);
}

function displayMessages() {
    const display = document.getElementById('messageDisplay');
    if (!display || !activeChat || !db) return;
    display.innerHTML = "";
    
    db.transaction('messages').objectStore('messages').getAll().onsuccess = (e) => {
        e.target.result
            .filter(m => m.chatWith === activeChat)
            .forEach(m => {
                const div = document.createElement('div');
                div.className = `message-bubble ${m.type.includes('sent') ? 'sent' : 'received'}`;
                
                if (m.type.includes('image')) {
                    const img = document.createElement('img');
                    img.src = m.text;
                    img.className = "max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition";
                    img.onclick = () => window.open(m.text, '_blank');
                    div.appendChild(img);
                } else {
                    div.textContent = m.text;
                }
                display.appendChild(div);
            });
        display.scrollTop = display.scrollHeight;
    };
}

window.openModal = function(options) {
    const modal = document.getElementById('customModal');
    const mInput = document.getElementById('modalInput');
    const mConfirm = document.getElementById('modalConfirm');
    
    document.getElementById('modalTitle').innerText = options.title;
    document.getElementById('modalDesc').innerText = options.desc || "";
    mInput.value = "";
    modal.style.display = 'flex';
    mInput.focus();

    const newConfirm = mConfirm.cloneNode(true);
    mConfirm.parentNode.replaceChild(newConfirm, mConfirm);

    const runConfirm = () => {
        const val = mInput.value.trim();
        if (val) { options.onConfirm(val); closeModal(); }
    };

    newConfirm.onclick = runConfirm;
    mInput.onkeydown = (e) => { if (e.key === "Enter") runConfirm(); };
};

window.closeModal = () => document.getElementById('customModal').style.display = 'none';

window.toggleMenu = (event, menuId) => {
    event.stopPropagation();
    document.querySelectorAll('.menu-dropdown').forEach(m => m.style.display = 'none');
    const menu = document.getElementById(menuId);
    if (menu) menu.style.display = 'block';
};

window.showToast = (text) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.innerText = text;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
};

window.uiCreateChat = () => {
    window.openModal({
        title: "New Chat",
        onConfirm: async (val) => {
            if (val === currentUser) return showToast("Can't chat with yourself.");
            try {
                const token = localStorage.getItem('pwr_token');
                const resp = await fetch(`${API_URL}/api/user/${val}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) {
                    const tx = db.transaction(['chats'], 'readwrite');
                    tx.objectStore('chats').put({ username: val, unread: false });
                    tx.oncomplete = () => loadSidebar();
                } else {
                    showToast("User not found.");
                }
            } catch (e) { showToast("Connection error."); }
        }
    });
};

window.uiBlockUser = (username) => {
    const tx = db.transaction(['blocked'], 'readwrite');
    tx.objectStore('blocked').put({ username });
    tx.oncomplete = () => {
        if (activeChat === username) {
            activeChat = null;
            document.getElementById('messageDisplay').innerHTML = "";
        }
        loadSidebar();
        updateInputState();
        showToast("User blocked.");
    };
};

window.uiUnblockUser = (username) => {
    const tx = db.transaction(['blocked'], 'readwrite');
    tx.objectStore('blocked').delete(username);
    tx.oncomplete = () => {
        loadSidebar();
        showToast("User unblocked.");
    };
};

window.uiDeleteChat = (username) => {
    window.openModal({
        title: "Delete Chat?",
        desc: `Type "CONFIRM" to delete history with ${username}`,
        onConfirm: (val) => {
            if (val !== "CONFIRM") return;
            const tx = db.transaction(['chats', 'messages'], 'readwrite');
            tx.objectStore('chats').delete(username);
            const msgStore = tx.objectStore('messages');
            msgStore.openCursor().onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.chatWith === username) cursor.delete();
                    cursor.continue();
                }
            };
            tx.oncomplete = () => {
                if (activeChat === username) {
                    activeChat = null;
                    document.getElementById('messageDisplay').innerHTML = "";
                }
                loadSidebar();
                updateInputState();
            };
        }
    });
};

window.requestNotifs = async () => {
    const permission = await Notification.requestPermission();
    showToast(permission === 'granted' ? "Notifications enabled!" : "We don't have permission to send notifications");
};

window.wipeAndLogout = () => {
    localStorage.clear();
    indexedDB.deleteDatabase("pwrmessage");
    location.reload();
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('msgInput')?.addEventListener('keydown', e => { if (e.key === "Enter") sendMessage(); });
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('logoutBtn').onclick = wipeAndLogout;
    checkAuth();
});

window.onclick = () => {
    document.querySelectorAll('.menu-dropdown').forEach(m => m.style.display = 'none');
};