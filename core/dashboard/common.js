let botData = null;
let selectedFiles = new Set();
let currentFilePath = '';

function attachBotProfilePhoto(host, className = 'ri-brand-avatar-photo') {
    if (!host) return null;
    const avatar = document.createElement('img');
    avatar.className = className;
    avatar.alt = '';
    avatar.addEventListener('error', () => avatar.remove(), { once: true });
    avatar.addEventListener('load', () => {
        if (!avatar.naturalWidth) avatar.remove();
    }, { once: true });
    avatar.src = '/api/bot-avatar';
    host.prepend(avatar);
    return avatar;
}

document.querySelectorAll('.ri-brand-mark').forEach(mark => {
    attachBotProfilePhoto(mark);
});

async function loadBotData() {
    try {
        const response = await fetch('/api/bot-info');
        if (response.status === 401) {
            window.location.replace('/');
            return;
        }
        if (!response.ok) throw new Error(`Bot information request failed (${response.status}).`);
        botData = await response.json();
    } catch (error) {
        console.error('Failed to load bot data:', error);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.style.opacity = '1';
        overlay.style.visibility = 'visible';
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } else {
        closeSidebar();
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    sidebar.classList.add('-translate-x-full');
    overlay.style.opacity = '0';
    overlay.style.visibility = 'hidden';
    setTimeout(() => overlay.classList.add('hidden'), 300);
    document.body.style.overflow = '';
}

async function restartBot() {
    if (!confirm('Are you sure you want to restart the bot? This will stop all current operations.')) return;

    try {
        const response = await fetch('/api/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        showNotification(data.message);
        // Optionally, disable UI or show loading
    } catch (error) {
        alert('Error restarting bot: ' + error.message);
    }
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'ri-toast';
    notification.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'ri-toast-icon';
    icon.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
    const text = document.createElement('span');
    text.textContent = String(message);
    notification.append(icon, text);
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 400);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateActiveNav(currentPage) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('bg-purple-600/20', 'text-purple-400', 'is-active');
        link.removeAttribute('aria-current');
        if (link.getAttribute('data-page') === currentPage) {
            link.classList.add('bg-purple-600/20', 'text-purple-400', 'is-active');
            link.setAttribute('aria-current', 'page');
        }
    });

    const titles = {
        dashboard: 'Dashboard',
        commands: 'Commands',
        events: 'Events',
        tokens: 'Bot Tokens'
    };
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.textContent = titles[currentPage] || 'Dashboard';
    }

    const sidebarTitle = document.querySelector('.sidebar h1');
    if (sidebarTitle) {
        sidebarTitle.textContent = titles[currentPage] || 'Dashboard';
    }
}

// Hide context menu on click outside
document.addEventListener('click', (e) => {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
        contextMenu.classList.add('hidden');
    }
});