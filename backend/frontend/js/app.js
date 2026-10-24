let currentTournament = null;
let notificationRefreshTimer = null;
let knownNotificationIds = null;
let notificationAudioContext = null;
let notificationSoundEnabled = localStorage.getItem('notificationSoundEnabled') !== 'false';
let notificationToastTimer = null;
let supportChatRefreshTimer = null;
let activeSupportChatUserId = null;
let activeSupportChatName = null;
let knownSupportMessageIds = null;
let supportUnreadRefreshTimer = null;
let knownSupportUnreadCount = null;
let playerProfile = null;
let playerProfileLoadRequest = 0;
let teamsLoadRequest = 0;
let applicationModalRequest = 0;
let applicationTeamSize = 0;
let applicationSelectedMemberIds = [];
let applicationRosterSelectionRequired = false;
let applicationRosterSelectionValid = true;
let profileAvatarDraft = null;
let profileCoverDraft = null;
let profileAvatarFrameColorDraft = '#00f0ff';
let profileAvatarFrameStyleDraft = 'neon';
let activeMatchRoom = null;
let matchChatRefreshTimer = null;
let bracketTeamDetailsRequest = 0;
const PRIVACY_NOTICE_VERSION = '2026-10-09';
const PRIVACY_NOTICE_STORAGE_KEY = 'privacyNoticeDismissed';

const gameCategories = [
    {
        id: 'shooters',
        title: 'Шутеры',
        description: 'Тактика, точность и командная игра',
        games: [
            'Counter-Strike 2', 'Valorant', 'Overwatch 2', 'Rainbow Six Siege',
            'Marvel Rivals', 'THE FINALS', 'Call of Duty: Black Ops 7',
            'Call of Duty: Black Ops 6', 'Delta Force', 'Escape from Tarkov',
            'Destiny 2', 'Team Fortress 2'
        ]
    },
    {
        id: 'moba',
        title: 'MOBA',
        description: 'Командные сражения на арене',
        games: ['Dota 2', 'League of Legends', 'Smite 2', 'Honor of Kings']
    },
    {
        id: 'battle-royale',
        title: 'Королевская битва',
        description: 'Один матч — последний выживший',
        games: ['Fortnite', 'PUBG: Battlegrounds', 'Apex Legends', 'Call of Duty: Warzone']
    },
    {
        id: 'sports',
        title: 'Спортивные',
        description: 'Киберспорт на виртуальном поле',
        games: ['EA SPORTS FC 26', 'Rocket League', 'eFootball', 'NBA 2K26', 'Madden NFL 26']
    },
    {
        id: 'fighting',
        title: 'Файтинги',
        description: 'Дуэли один на один',
        games: ['Tekken 8', 'Street Fighter 6', 'Mortal Kombat 1', 'Guilty Gear -Strive-', 'Brawlhalla']
    },
    {
        id: 'strategy',
        title: 'Стратегии',
        description: 'Планирование и контроль карты',
        games: ['StarCraft II', 'Age of Empires IV', 'Civilization VI', 'Warcraft III: Reforged']
    },
    {
        id: 'card-games',
        title: 'Карточные и автобаттлеры',
        description: 'Тактика, колоды и подбор героев',
        games: ['Hearthstone', 'Teamfight Tactics', 'Marvel Snap', 'Dota Underlords']
    },
    {
        id: 'racing',
        title: 'Гонки',
        description: 'Скорость, трассы и соревнования',
        games: ['Forza Horizon 5', 'F1 25', 'Trackmania', 'Gran Turismo 7']
    },
    {
        id: 'survival',
        title: 'Выживание и песочницы',
        description: 'Строй, исследуй и выживай вместе',
        games: ['Minecraft', 'Rust', 'ARK: Survival Ascended', 'DayZ', 'Palworld', 'Valheim', 'Phasmophobia']
    },
    {
        id: 'other',
        title: 'Другие игры',
        description: 'Турниры по остальным дисциплинам',
        games: []
    }
];

const adminRoleLevels = {
    ROLE_ADMIN_JUNIOR: 1,
    ROLE_ADMIN_MIDDLE: 2,
    ROLE_ADMIN_SENIOR: 3,
    ROLE_SUPER_ADMIN: 4
};
const adminRoleLabels = {
    ROLE_USER: 'Пользователь',
    ROLE_ADMIN_JUNIOR: 'Младший администратор',
    ROLE_ADMIN_MIDDLE: 'Средний администратор',
    ROLE_ADMIN_SENIOR: 'Старший администратор',
    ROLE_SUPER_ADMIN: 'Главный системный администратор',
    ROLE_ADMIN: 'Старший администратор'
};
function currentAdminLevel() {
    const user = Auth.getUser();
    if (!user) return 0;
    const role = user.username === 'admin' ? 'ROLE_SUPER_ADMIN' : (user.role || user.roles);
    return adminRoleLevels[role] || (role === 'ROLE_ADMIN' ? 3 : 0);
}
function effectiveUserRole(user) {
    if (!user) return 'ROLE_USER';
    if (user.username === 'admin') return 'ROLE_SUPER_ADMIN';
    return user.role === 'ROLE_ADMIN' ? 'ROLE_ADMIN_SENIOR' : (user.role || user.roles || 'ROLE_USER');
}
const coverPalettes = {
    shooters: ['#00e5ff', '#155eef'],
    moba: ['#bf7bff', '#6538d4'],
    'battle-royale': ['#ffb347', '#ec466f'],
    sports: ['#81f7a4', '#168d76'],
    fighting: ['#ff6384', '#ab1748'],
    strategy: ['#f6df71', '#bd762c'],
    'card-games': ['#ffd477', '#d34b59'],
    racing: ['#ff714a', '#b7215d'],
    survival: ['#78e5a1', '#25705f'],
    other: ['#65d5ff', '#5755d9']
};
const restrictionReasonLabels = {
    unsporting: 'Неспортивное поведение',
    harassment: 'Оскорбления или травля',
    spam: 'Спам',
    rule_violation: 'Нарушение правил',
    other: 'Другое'
};
const gameArtwork = new Map([
    ['counterstrike2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg'],
    ['cs2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg'],
    ['valorant', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Valorant_logo_-_pink_color_version.svg/330px-Valorant_logo_-_pink_color_version.svg.png'],
    ['apexlegends', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1172470/header.jpg'],
    ['marvelrivals', 'https://cdn.cloudflare.steamstatic.com/steam/apps/2767030/header.jpg'],
    ['thefinals', 'https://cdn.cloudflare.steamstatic.com/steam/apps/2073850/header.jpg'],
    ['teamfortress2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg'],
    ['destiny2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1085660/header.jpg'],
    ['smite2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/2437170/header.jpg'],
    ['overwatch2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/2357570/header.jpg'],
    ['rainbowsixsiege', 'https://cdn.cloudflare.steamstatic.com/steam/apps/359550/header.jpg'],
    ['r6', 'https://cdn.cloudflare.steamstatic.com/steam/apps/359550/header.jpg'],
    ['dota2', 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg'],
    ['leagueoflegends', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/League_of_Legends_2019_vector.svg/330px-League_of_Legends_2019_vector.svg.png'],
    ['lol', 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/League_of_Legends_2019_vector.svg/330px-League_of_Legends_2019_vector.svg.png'],
    ['fortnite', 'https://cdn.simpleicons.org/fortnite'],
    ['pubgbattlegrounds', 'https://cdn.cloudflare.steamstatic.com/steam/apps/578080/header.jpg'],
    ['pubg', 'https://cdn.cloudflare.steamstatic.com/steam/apps/578080/header.jpg'],
    ['easportsfc26', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3405690/2d96aa1b06e453cd62dae9029d412f19e61932c3/header.jpg?t=1789751159'],
    ['fc26', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3405690/2d96aa1b06e453cd62dae9029d412f19e61932c3/header.jpg?t=1789751159'],
    ['fifa', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3405690/2d96aa1b06e453cd62dae9029d412f19e61932c3/header.jpg?t=1789751159'],
    ['rocketleague', 'https://cdn.cloudflare.steamstatic.com/steam/apps/252950/header.jpg'],
    ['tekken8', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1778820/header.jpg'],
    ['streetfighter6', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1364780/header.jpg'],
    ['mortalkombat1', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1971870/header.jpg'],
    ['guiltygearstrive', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1384160/header.jpg'],
    ['brawlhalla', 'https://cdn.cloudflare.steamstatic.com/steam/apps/291550/header.jpg'],
    ['ageofempiresiv', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1466860/header.jpg'],
    ['civilizationvi', 'https://cdn.cloudflare.steamstatic.com/steam/apps/289070/header.jpg'],
    ['forzahorizon5', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1551360/header.jpg'],
    ['rust', 'https://cdn.cloudflare.steamstatic.com/steam/apps/252490/header.jpg'],
    ['arksurvivalascended', 'https://cdn.cloudflare.steamstatic.com/steam/apps/2399830/header.jpg'],
    ['dayz', 'https://cdn.cloudflare.steamstatic.com/steam/apps/221100/header.jpg'],
    ['starcraftii', 'https://thumb.wikimedia.org/wikipedia/en/thumb/9/90/StarCraft_II_Logo.webp/330px-StarCraft_II_Logo.webp'],
    ['starcraft2', 'https://thumb.wikimedia.org/wikipedia/en/thumb/9/90/StarCraft_II_Logo.webp/330px-StarCraft_II_Logo.webp']
]);

document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    initializePrivacyNotice();
    document.getElementById('t-game').addEventListener('change', updateCustomGameField);
    document.getElementById('notification-toggle').addEventListener('click', toggleNotifications);
    document.getElementById('notification-close').addEventListener('click', closeNotifications);
    document.getElementById('notification-sound-toggle').addEventListener('click', toggleNotificationSound);
    document.getElementById('notification-sound-toggle').setAttribute('aria-pressed', String(notificationSoundEnabled));
    document.getElementById('notification-sound-toggle').textContent = `Звук: ${notificationSoundEnabled ? 'вкл.' : 'выкл.'}`;
    document.getElementById('support-chat-form').addEventListener('submit', handleSupportChatSubmit);
    document.getElementById('support-chat-input').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            document.getElementById('support-chat-form').requestSubmit();
        }
    });
    document.getElementById('support-chat-resolution-button').addEventListener('click', handleSupportChatResolution);
    document.getElementById('support-chat-sanction-form').addEventListener('submit', handleSupportChatSanction);
    document.getElementById('support-chat-sanction-remove').addEventListener('click', liftSupportChatSanction);
    document.getElementById('support-chat-sanction-permanent').addEventListener('change', updateSanctionDurationField);
    document.getElementById('support-chat-sanction-reason').addEventListener('change', updateSanctionReasonField);
    document.getElementById('admin-user-search-input').addEventListener('input', filterAdminUsers);
    document.getElementById('profile-avatar-file').addEventListener('change', event => previewProfileImage(event, 'avatar'));
    document.getElementById('profile-cover-file').addEventListener('change', event => previewProfileImage(event, 'cover'));
    document.getElementById('profile-avatar-frame-color').addEventListener('change', event => {
        profileAvatarFrameColorDraft = event.currentTarget.value;
        applyProfileAvatarFrame();
    });
    document.getElementById('profile-avatar-frame-style').addEventListener('change', event => {
        profileAvatarFrameStyleDraft = event.currentTarget.value;
        applyProfileAvatarFrame();
    });
    document.getElementById('team-create-form').addEventListener('submit', handleCreateTeam);
    document.getElementById('match-chat-form').addEventListener('submit', handleMatchChatSubmit);
    document.getElementById('match-chat-input').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            document.getElementById('match-chat-form').requestSubmit();
        }
    });
    document.getElementById('match-room-close').addEventListener('click', () => closeMatchRoom());
    document.addEventListener('pointerdown', unlockNotificationAudio, { once: true });
    document.addEventListener('keydown', unlockNotificationAudio, { once: true });
    if (Auth.getUser()) {
        refreshNotifications();
        notificationRefreshTimer = window.setInterval(refreshNotifications, 30000);
        refreshSupportUnreadCount();
        supportUnreadRefreshTimer = window.setInterval(refreshSupportUnreadCount, 15000);
    }
    showPage(new URLSearchParams(window.location.search).has('teamInvite')
        ? 'page-teams'
        : 'page-tournaments');
});

function initializePrivacyNotice() {
    if (localStorage.getItem(PRIVACY_NOTICE_STORAGE_KEY) !== PRIVACY_NOTICE_VERSION) {
        document.getElementById('privacy-notice').hidden = false;
    }
}

function showPrivacyNotice() {
    document.getElementById('privacy-notice').hidden = false;
}

function dismissPrivacyNotice() {
    localStorage.setItem(PRIVACY_NOTICE_STORAGE_KEY, PRIVACY_NOTICE_VERSION);
    document.getElementById('privacy-notice').hidden = true;
}

function clearLocalBrowserData() {
    if (!confirm('Удалить локальные данные BRACKETOFF на этом устройстве? Вы выйдете из аккаунта. Данные, уже сохранённые на сервере, не удалятся.')) return;
    localStorage.removeItem('token');
    localStorage.removeItem('notificationSoundEnabled');
    localStorage.removeItem(PRIVACY_NOTICE_STORAGE_KEY);
    window.location.reload();
}

// Безопасное обновление интерфейса
function updateUI() {
    const user = Auth.getUser();
    const profileButton = document.getElementById('profile-open-button');
    if (profileButton) profileButton.setAttribute('aria-label', user ? 'Открыть личный профиль' : 'Войти или зарегистрироваться');
    if (user) {
        const username = user.username || 'Игрок';
        document.getElementById('user-display').innerText = username;
        document.getElementById('user-avatar-mark').textContent = username.trim().charAt(0).toLocaleUpperCase('ru-RU') || 'И';
        
        // Защита: если бэкенд не прислал роль, ставим дефолтную
        const role = effectiveUserRole(user);
        const roleLevel = adminRoleLevels[role] || 0;
        const auditTab = document.getElementById('admin-audit-tab-button');
        if (auditTab) auditTab.style.display = roleLevel >= 3 ? 'inline-block' : 'none';
        const clearLeaderboardButton = document.getElementById('clear-team-leaderboard');
        if (clearLeaderboardButton) clearLeaderboardButton.hidden = currentAdminLevel() < 3;
        
        const badge = document.getElementById('user-role-badge');
        badge.innerText = role === 'ROLE_USER' ? 'ИГРОК' : (adminRoleLabels[role] || 'АДМИНИСТРАТОР');
        badge.className = `badge ${role}`;
        
        document.getElementById('auth-btn').style.display = 'none';
        document.getElementById('register-nav-btn').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'block';
        document.getElementById('notification-widget').style.display = 'block';
        document.getElementById('chat-open-button').style.display = 'inline-flex';
        
        const subtitle = document.getElementById('bracket-subtitle');
        if (roleLevel > 0) {
            document.getElementById('nav-admin').style.display = 'inline-flex';
            if (subtitle) subtitle.style.display = 'block';
        } else {
            document.getElementById('nav-admin').style.display = 'none';
            if (subtitle) subtitle.style.display = 'none';
        }
        applyAdminPermissions();
    }
}

function applyAdminPermissions() {
    const level = currentAdminLevel();
    const user = Auth.getUser();
    const createTabButton = document.querySelector('#page-admin .admin-tab-btn[onclick*="create"]');
    const createPanel = document.getElementById('admin-tab-create');
    const createPanelWasVisible = createPanel && createPanel.style.display !== 'none';
    if (createTabButton) createTabButton.style.display = level >= 2 ? '' : 'none';
    if (createPanel && level < 2) createPanel.style.display = 'none';
    const userTabButton = document.querySelector('#page-admin .admin-tab-btn[onclick*="users"]');
    if (userTabButton) userTabButton.style.display = level >= 3 ? '' : 'none';
    const userPanel = document.getElementById('admin-tab-users');
    if (userPanel && level < 3) userPanel.style.display = 'none';
    const auditTabButton = document.getElementById('admin-audit-tab-button');
    if (auditTabButton) auditTabButton.style.display = level >= 3 ? '' : 'none';
    const auditPanel = document.getElementById('admin-tab-audit-logs');
    if (auditPanel && level < 3) auditPanel.style.display = 'none';
    if (level < 2 && createPanelWasVisible) {
        const applicationsTab = document.querySelector('#page-admin .admin-tab-btn[onclick*="applications"]');
        if (applicationsTab) switchAdminTab('applications', applicationsTab);
    }
    const sanctionForm = document.getElementById('support-chat-sanction-form');
    if (sanctionForm) sanctionForm.hidden = level < 2;
    const sanctionRemove = document.getElementById('support-chat-sanction-remove');
    if (sanctionRemove) sanctionRemove.hidden = level < 2;
}

function showPage(pageId) {
    if (pageId !== 'page-bracket') closeMatchRoom();
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.nav-links [data-page], #nav-admin').forEach(link => {
        if (link.dataset.page === pageId
            || (pageId === 'page-bracket' && link.dataset.page === 'page-tournaments')) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    const activePage = document.getElementById(pageId);
    activePage.style.display = '';
    if (getComputedStyle(activePage).display === 'none') activePage.style.display = 'block';
    
    if (pageId === 'page-tournaments') {
        loadStats();
        loadTournaments();
    }
    if (pageId === 'page-leaderboard') loadTeamLeaderboard();
    if (pageId === 'page-profile') loadPlayerProfile();
    if (pageId === 'page-teams') loadTeams();
    if (pageId === 'page-admin') loadAdminApplications();
}

async function openPlayerProfile() {
    if (!Auth.getUser()) {
        openAuthPage('login');
        return;
    }
    showPage('page-profile');
}

async function loadPlayerProfile() {
    const requestId = ++playerProfileLoadRequest;
    const container = document.getElementById('profile-teams-list');
    container.textContent = 'Загружаем профиль…';
    try {
        const profile = await API.getProfile();
        if (requestId !== playerProfileLoadRequest) return;
        playerProfile = profile;
        profileAvatarDraft = playerProfile.avatarData || null;
        profileCoverDraft = playerProfile.coverData || null;
        profileAvatarFrameColorDraft = playerProfile.avatarFrameColor || '#00f0ff';
        profileAvatarFrameStyleDraft = playerProfile.avatarFrameStyle || 'neon';
        renderPlayerProfile(playerProfile);
    } catch (error) {
        if (requestId !== playerProfileLoadRequest) return;
        container.textContent = `Не удалось загрузить профиль: ${error.message}`;
        console.error('Ошибка загрузки профиля игрока:', error);
    }
}

function renderPlayerProfile(profile) {
    document.getElementById('profile-username').textContent = profile.username;
    const avatar = document.getElementById('profile-avatar-image');
    const avatarPlaceholder = document.getElementById('profile-avatar-placeholder');
    avatar.hidden = !profile.avatarData;
    avatarPlaceholder.hidden = Boolean(profile.avatarData);
    if (profile.avatarData) avatar.src = profile.avatarData;
    else avatar.removeAttribute('src');

    const coverImage = document.getElementById('profile-cover-image');
    coverImage.hidden = !profile.coverData;
    if (profile.coverData) coverImage.src = profile.coverData;
    else coverImage.removeAttribute('src');
    document.getElementById('profile-avatar-frame-color').value = profile.avatarFrameColor || '#00f0ff';
    document.getElementById('profile-avatar-frame-style').value = profile.avatarFrameStyle || 'neon';
    applyProfileAvatarFrame();
    document.getElementById('profile-rating-points').textContent = String(profile.rating.points);
    document.getElementById('profile-rating-wins').textContent = String(profile.rating.wins);
    document.getElementById('profile-rating-rank').textContent = profile.rating.rank ? `#${profile.rating.rank}` : '—';
    document.getElementById('profile-rating-tournaments').textContent = String(profile.rating.tournaments);
    document.getElementById('profile-rank-label').textContent = profile.rating.rank
        ? `ТОП ${profile.rating.rank} ИГРОК`
        : profile.rating.wins ? 'В РЕЙТИНГЕ ИГРОКОВ' : 'НОВЫЙ ИГРОК';
    renderProfileImagePreviews(profile.avatarData, profile.coverData);
    renderProfileTeams(profile.teams);
}

function renderProfileImagePreviews(avatarData, coverData) {
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const avatarPlaceholder = document.getElementById('profile-avatar-preview-placeholder');
    avatarPreview.hidden = !avatarData;
    avatarPlaceholder.hidden = Boolean(avatarData);
    if (avatarData) avatarPreview.src = avatarData;
    else avatarPreview.removeAttribute('src');

    const coverPreview = document.getElementById('profile-cover-preview');
    const coverPreviewImage = document.getElementById('profile-cover-preview-image');
    const coverPreviewPlaceholder = document.getElementById('profile-cover-preview-placeholder');
    coverPreviewImage.hidden = !coverData;
    coverPreviewPlaceholder.hidden = Boolean(coverData);
    if (coverData) coverPreviewImage.src = coverData;
    else coverPreviewImage.removeAttribute('src');
    coverPreview.classList.toggle('has-cover', Boolean(coverData));
}

function applyProfileAvatarFrame() {
    const frame = document.getElementById('profile-avatar-frame');
    frame.style.setProperty('--avatar-frame-color', profileAvatarFrameColorDraft);
    frame.dataset.frameStyle = profileAvatarFrameStyleDraft;
}

function renderProfileTeams(teams) {
    const container = document.getElementById('profile-teams-list');
    const groupedTeams = new Map();
    teams.forEach(team => {
        const key = team.teamName.trim().toLocaleLowerCase('ru-RU');
        let grouped = groupedTeams.get(key);
        if (!grouped) {
            grouped = { ...team, tournamentNames: new Set(), wins: 0, losses: 0 };
            groupedTeams.set(key, grouped);
        }
        grouped.tournamentNames.add(team.tournamentName);
        grouped.wins += team.wins;
        grouped.losses += team.losses;
        if (team.avatarData) grouped.avatarData = team.avatarData;
    });
    if (!groupedTeams.size) {
        const empty = document.createElement('div');
        empty.className = 'profile-empty-state';
        empty.textContent = 'Здесь пока нет отображаемых составов. Скрытые команды, их заявки и результаты остаются сохранены.';
        container.replaceChildren(empty);
        return;
    }

    const cards = [...groupedTeams.values()].map(team => {
        const card = document.createElement('article');
        card.className = 'profile-team-card';
        const identity = document.createElement('div');
        identity.className = 'profile-team-identity';
        const crest = document.createElement('span');
        crest.className = 'profile-team-crest';
        const nameInitial = team.teamName.trim().charAt(0).toLocaleUpperCase('ru-RU') || '?';
        if (team.avatarData) {
            const image = document.createElement('img');
            image.src = team.avatarData;
            image.alt = '';
            crest.append(image);
        } else {
            crest.textContent = nameInitial;
        }
        const copy = document.createElement('div');
        const name = document.createElement('h3');
        name.textContent = team.teamName;
        const meta = document.createElement('p');
        meta.textContent = `${team.wins} побед · ${team.losses} поражений · ${team.tournamentNames.size} турниров`;
        copy.append(name, meta);
        identity.append(crest, copy);

        const upload = document.createElement('label');
        upload.className = 'profile-team-upload';
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/webp';
        file.setAttribute('aria-label', `Выбрать эмблему команды ${team.teamName}`);
        const uploadText = document.createElement('span');
        uploadText.textContent = 'Загрузить эмблему';
        upload.append(file, uploadText);
        const actions = document.createElement('div');
        actions.className = 'profile-team-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn-ai-small';
        save.textContent = 'Сохранить';
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'action-btn-small';
        clear.textContent = 'Убрать';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'profile-team-remove';
        remove.textContent = 'Удалить из профиля';
        let avatarDraft = team.avatarData || null;
        file.addEventListener('change', async () => {
            if (!file.files || !file.files[0]) return;
            try {
                avatarDraft = await readProfileImage(file.files[0], 512, PROFILE_TEAM_IMAGE_LIMIT);
                crest.replaceChildren();
                const image = document.createElement('img');
                image.src = avatarDraft;
                image.alt = '';
                crest.append(image);
            } catch (error) {
                file.value = '';
                alert(error.message);
            }
        });
        save.addEventListener('click', async () => {
            save.disabled = true;
            try {
                const result = await API.updateTeamProfile(team.teamName, avatarDraft);
                alert(result.message);
                await loadPlayerProfile();
            } catch (error) {
                alert(`Не удалось сохранить эмблему: ${error.message}`);
            } finally {
                save.disabled = false;
            }
        });
        clear.addEventListener('click', async () => {
            clear.disabled = true;
            try {
                const result = await API.updateTeamProfile(team.teamName, null);
                alert(result.message);
                await loadPlayerProfile();
            } catch (error) {
                alert(`Не удалось убрать эмблему: ${error.message}`);
            } finally {
                clear.disabled = false;
            }
        });
        remove.addEventListener('click', async () => {
            if (!confirm(`Скрыть «${team.teamName}» из личного профиля? Заявки на турниры, сетки, результаты и публичный рейтинг останутся без изменений.`)) return;
            remove.disabled = true;
            try {
                const result = await API.hideProfileTeam(team.teamName);
                await loadPlayerProfile();
                alert(result.message);
            } catch (error) {
                alert(`Не удалось скрыть состав: ${error.message}`);
            } finally {
                remove.disabled = false;
            }
        });
        actions.append(save, clear, remove);
        card.append(identity, upload, actions);
        return card;
    });
    container.replaceChildren(...cards);
}

async function loadTeams() {
    const requestId = ++teamsLoadRequest;
    const directory = document.getElementById('teams-directory');
    const ownPanel = document.getElementById('my-team-panel');
    directory.textContent = 'Загружаем команды…';
    ownPanel.textContent = 'Загружаем состав…';
    const user = Auth.getUser();
    let personalData = { membership: null, members: [], pendingRequests: [], requestStatuses: [] };
    try {
        const teams = await API.getTeams();
        if (requestId !== teamsLoadRequest) return;
        if (user) personalData = await API.getMyTeam();
        if (requestId !== teamsLoadRequest) return;
        document.getElementById('team-create-section').hidden = !user || Boolean(personalData.membership);
        renderMyTeam(personalData, Boolean(user));
        renderTeamDirectory(teams, personalData, Boolean(user));
        renderTeamInviteBanner(teams, personalData, Boolean(user));
    } catch (error) {
        if (requestId !== teamsLoadRequest) return;
        directory.textContent = `Не удалось загрузить команды: ${error.message}`;
        ownPanel.textContent = `Не удалось загрузить состав: ${error.message}`;
        console.error('Ошибка загрузки раздела команд:', error);
    }
}

function renderTeamInviteBanner(teams, personalData, isAuthenticated) {
    const banner = document.getElementById('team-invite-banner');
    const inviteId = Number(new URLSearchParams(window.location.search).get('teamInvite'));
    if (!Number.isSafeInteger(inviteId) || inviteId <= 0) {
        banner.hidden = true;
        banner.replaceChildren();
        return;
    }

    banner.hidden = false;
    banner.replaceChildren();
    const team = teams.find(item => Number(item.id) === inviteId);
    const title = document.createElement('h2');
    title.textContent = team ? `Приглашение в команду «${team.name}»` : 'Приглашение в команду';
    const description = document.createElement('p');
    const action = document.createElement('div');
    action.className = 'team-invite-actions';
    if (!team) {
        description.textContent = 'Эта ссылка недействительна или команда уже недоступна.';
    } else {
        description.textContent = `${team.game} · Капитан: ${team.captain_name}`;
        const membership = personalData.membership;
        const requestStatus = personalData.requestStatuses.find(item => Number(item.teamId) === inviteId)?.status;
        if (!isAuthenticated) {
            const login = document.createElement('button');
            login.type = 'button';
            login.className = 'btn-ai-small';
            login.textContent = 'ВОЙТИ, ЧТОБЫ ПОДАТЬ ЗАЯВКУ';
            login.addEventListener('click', () => openAuthPage('login'));
            action.append(login);
        } else if (membership && Number(membership.id) === inviteId) {
            description.textContent += ' · Вы уже состоите в этой команде.';
        } else if (membership) {
            description.textContent += ' · Сначала выйдите из текущей команды.';
        } else if (requestStatus === 'pending') {
            description.textContent += ' · Ваша заявка уже ожидает ответа капитана.';
        } else {
            const join = document.createElement('button');
            join.type = 'button';
            join.className = 'btn-ai-small';
            join.textContent = requestStatus === 'rejected' ? 'ПОДАТЬ ЗАЯВКУ СНОВА' : 'ПОДАТЬ ЗАЯВКУ';
            join.addEventListener('click', () => requestToJoinTeam(team.id, team.name));
            action.append(join);
        }
    }
    banner.append(title, description, action);
}

function renderMyTeam(data, isAuthenticated) {
    const panel = document.getElementById('my-team-panel');
    const membership = data.membership;
    if (!isAuthenticated) {
        const message = document.createElement('p');
        message.textContent = 'Войдите, чтобы создать команду или подать заявку на вступление.';
        const login = document.createElement('button');
        login.type = 'button';
        login.className = 'btn-ai-small';
        login.textContent = 'ВОЙТИ';
        login.addEventListener('click', () => openAuthPage('login'));
        panel.replaceChildren(message, login);
        return;
    }
    if (!membership) {
        panel.textContent = 'Вы пока не состоите в команде. Создайте свою или выберите команду из списка.';
        return;
    }

    const header = document.createElement('div');
    header.className = 'team-own-header';
    const identity = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = membership.name;
    const game = document.createElement('p');
    game.textContent = membership.game;
    identity.append(title, game);
    const role = document.createElement('span');
    role.className = `team-role-badge ${membership.role}`;
    role.textContent = membership.role === 'captain' ? 'КАПИТАН' : 'ИГРОК';
    header.append(identity, role);

    const rosterTitle = document.createElement('h4');
    rosterTitle.textContent = 'Состав команды';
    const roster = document.createElement('ul');
    roster.className = 'team-roster-list';
    data.members.forEach(member => {
        const row = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = member.username;
        const memberRole = document.createElement('small');
        memberRole.textContent = member.role === 'captain' ? 'Капитан' : 'Игрок';
        row.append(name, memberRole);
        if (membership.role === 'captain' && member.role === 'player') {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'action-btn-small';
            remove.textContent = 'Исключить';
            remove.addEventListener('click', () => removeTeamMember(membership.id, member.id, member.username));
            row.append(remove);
        }
        roster.append(row);
    });

    const actions = document.createElement('div');
    actions.className = 'team-management-actions';
    if (membership.role === 'captain') {
        const invite = document.createElement('button');
        invite.type = 'button';
        invite.className = 'btn-ai-small';
        invite.textContent = 'СОЗДАТЬ ССЫЛКУ-ПРИГЛАШЕНИЕ';
        invite.addEventListener('click', () => copyTeamInviteLink(membership.id));
        const dissolve = document.createElement('button');
        dissolve.type = 'button';
        dissolve.className = 'action-btn-small team-danger-action';
        dissolve.textContent = 'Распустить команду';
        dissolve.addEventListener('click', () => dissolveTeam(membership.id, membership.name));
        actions.append(invite, dissolve);
    } else {
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.className = 'action-btn-small';
        leave.textContent = 'Выйти из команды';
        leave.addEventListener('click', leaveTeam);
        actions.append(leave);
    }

    const content = [header, rosterTitle, roster];
    if (membership.role === 'captain') {
        const requestsTitle = document.createElement('h4');
        requestsTitle.textContent = 'Заявки на вступление';
        const requestList = document.createElement('div');
        requestList.className = 'team-requests-list';
        if (!data.pendingRequests.length) {
            const empty = document.createElement('p');
            empty.className = 'team-empty-note';
            empty.textContent = 'Новых заявок пока нет.';
            requestList.append(empty);
        } else {
            data.pendingRequests.forEach(request => {
                const row = document.createElement('div');
                row.className = 'team-request-row';
                const username = document.createElement('strong');
                username.textContent = request.username;
                const buttons = document.createElement('div');
                buttons.className = 'team-request-actions';
                ['accepted', 'rejected'].forEach(status => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = status === 'accepted' ? 'btn-ai-small' : 'action-btn-small';
                    button.textContent = status === 'accepted' ? 'Принять' : 'Отклонить';
                    button.addEventListener('click', () => reviewTeamJoinRequest(membership.id, request.id, status));
                    buttons.append(button);
                });
                row.append(username, buttons);
                requestList.append(row);
            });
        }
        content.push(requestsTitle, requestList);
    }
    content.push(actions);
    panel.replaceChildren(...content);
}

async function copyTeamInviteLink(teamId) {
    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = '';
    inviteUrl.hash = '';
    inviteUrl.searchParams.set('teamInvite', String(teamId));
    try {
        await navigator.clipboard.writeText(inviteUrl.href);
        alert('Ссылка-приглашение скопирована. Игрок отправит по ней заявку, которую нужно будет подтвердить.');
    } catch (error) {
        console.warn('Не удалось автоматически скопировать приглашение:', error);
        window.prompt('Скопируйте ссылку-приглашение:', inviteUrl.href);
    }
}

function renderTeamDirectory(teams, personalData, isAuthenticated) {
    const container = document.getElementById('teams-directory');
    if (!teams.length) {
        container.textContent = 'Команд пока нет. Создайте первую и станьте её капитаном.';
        return;
    }
    const requestStatuses = new Map(personalData.requestStatuses.map(item => [Number(item.teamId), item.status]));
    const membership = personalData.membership;
    const cards = teams.map(team => {
        const card = document.createElement('article');
        card.className = 'team-directory-card';
        const details = document.createElement('div');
        details.className = 'team-directory-details';
        const name = document.createElement('h3');
        name.textContent = team.name;
        const game = document.createElement('p');
        game.textContent = team.game;
        const meta = document.createElement('small');
        meta.textContent = `Капитан: ${team.captain_name} · Игроков: ${team.member_count}`;
        details.append(name, game, meta);
        const action = document.createElement('div');
        action.className = 'team-directory-action';
        if (!isAuthenticated) {
            const login = document.createElement('button');
            login.type = 'button';
            login.className = 'btn-ai-small';
            login.textContent = 'ВОЙТИ ДЛЯ ВСТУПЛЕНИЯ';
            login.addEventListener('click', () => openAuthPage('login'));
            action.append(login);
        } else if (membership && Number(membership.id) === Number(team.id)) {
            const label = document.createElement('span');
            label.className = 'team-directory-status';
            label.textContent = membership.role === 'captain' ? 'Ваша команда' : 'Вы в составе';
            action.append(label);
        } else if (membership) {
            const label = document.createElement('span');
            label.className = 'team-directory-status';
            label.textContent = 'Сначала выйдите из текущей команды';
            action.append(label);
        } else if (requestStatuses.get(Number(team.id)) === 'pending') {
            const label = document.createElement('span');
            label.className = 'team-directory-status pending';
            label.textContent = 'Заявка у капитана';
            action.append(label);
        } else {
            const join = document.createElement('button');
            join.type = 'button';
            join.className = 'btn-ai-small';
            join.textContent = requestStatuses.get(Number(team.id)) === 'rejected' ? 'ПОДАТЬ СНОВА' : 'ВСТУПИТЬ';
            join.addEventListener('click', () => requestToJoinTeam(team.id, team.name));
            action.append(join);
        }
        card.append(details, action);
        return card;
    });
    container.replaceChildren(...cards);
}

async function handleCreateTeam(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await API.createTeam({
            name: document.getElementById('team-create-name').value,
            game: document.getElementById('team-create-game').value
        });
        event.currentTarget.reset();
        await loadTeams();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось создать команду: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

async function requestToJoinTeam(teamId, teamName) {
    try {
        await API.requestToJoinTeam(teamId);
        await loadTeams();
        alert(`Заявка в «${teamName}» отправлена капитану.`);
    } catch (error) {
        alert(`Не удалось подать заявку: ${error.message}`);
    }
}

async function reviewTeamJoinRequest(teamId, requestId, status) {
    try {
        const result = await API.reviewTeamJoinRequest(teamId, requestId, status);
        await loadTeams();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось обработать заявку: ${error.message}`);
    }
}

async function removeTeamMember(teamId, userId, username) {
    if (!confirm(`Исключить игрока ${username} из команды?`)) return;
    try {
        const result = await API.removeTeamMember(teamId, userId);
        await loadTeams();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось исключить игрока: ${error.message}`);
    }
}

async function leaveTeam() {
    if (!confirm('Выйти из команды? После этого можно будет подать заявку в другой состав.')) return;
    try {
        const result = await API.leaveTeam();
        await loadTeams();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось выйти из команды: ${error.message}`);
    }
}

async function dissolveTeam(teamId, teamName) {
    if (!confirm(`Распустить команду «${teamName}»? Все участники и заявки на вступление будут удалены.`)) return;
    try {
        const result = await API.deleteTeam(teamId);
        await loadTeams();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось распустить команду: ${error.message}`);
    }
}

const PROFILE_TEAM_IMAGE_LIMIT = 512 * 1024;

async function previewProfileImage(event, type) {
    const input = event.currentTarget;
    if (!input.files || !input.files[0]) return;
    try {
        const imageData = await readProfileImage(
            input.files[0],
            type === 'cover' ? 1800 : 512,
            type === 'cover' ? 1536 * 1024 : 512 * 1024
        );
        if (type === 'avatar') profileAvatarDraft = imageData;
        else profileCoverDraft = imageData;
        renderProfileImagePreviews(profileAvatarDraft, profileCoverDraft);
        const avatar = document.getElementById('profile-avatar-image');
        const placeholder = document.getElementById('profile-avatar-placeholder');
        avatar.hidden = !profileAvatarDraft;
        placeholder.hidden = Boolean(profileAvatarDraft);
        if (profileAvatarDraft) avatar.src = profileAvatarDraft;
        else avatar.removeAttribute('src');
        const coverImage = document.getElementById('profile-cover-image');
        coverImage.hidden = !profileCoverDraft;
        if (profileCoverDraft) coverImage.src = profileCoverDraft;
        else coverImage.removeAttribute('src');
    } catch (error) {
        input.value = '';
        alert(error.message);
    }
}

async function readProfileImage(file, maxDimension, maxBytes) {
    if (!file.size || file.size > 20 * 1024 * 1024) {
        throw new Error('Исходный файл должен быть не пустым и не превышать 20 МБ.');
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Выбери изображение в формате PNG, JPEG или WebP.');
    }
    const objectUrl = URL.createObjectURL(file);
    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
            image.src = objectUrl;
        });
        if (!image.naturalWidth || !image.naturalHeight) {
            throw new Error('У изображения некорректный размер.');
        }
        let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        let quality = 0.88;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Браузер не смог обработать изображение.');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/webp', quality);
            const payload = imageData.slice(imageData.indexOf(',') + 1);
            const byteLength = Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
            if (byteLength <= maxBytes) return imageData;
            if (quality > 0.5) quality -= 0.1;
            else scale *= 0.8;
        }
        throw new Error('Изображение слишком большое. Выбери файл поменьше.');
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function savePlayerProfile(event) {
    event.preventDefault();
    playerProfileLoadRequest += 1;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await API.updateProfile({
            avatarData: profileAvatarDraft,
            coverData: profileCoverDraft,
            avatarFrameColor: profileAvatarFrameColorDraft,
            avatarFrameStyle: profileAvatarFrameStyleDraft
        });
        playerProfile = {
            ...playerProfile,
            avatarData: profileAvatarDraft,
            coverData: profileCoverDraft,
            avatarFrameColor: profileAvatarFrameColorDraft,
            avatarFrameStyle: profileAvatarFrameStyleDraft
        };
        renderPlayerProfile(playerProfile);
        alert(result.message);
    } catch (error) {
        alert(`Не удалось сохранить профиль: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

async function resetPlayerProfile() {
    playerProfileLoadRequest += 1;
    profileAvatarDraft = null;
    profileCoverDraft = null;
    profileAvatarFrameColorDraft = '#00f0ff';
    profileAvatarFrameStyleDraft = 'neon';
    document.getElementById('profile-avatar-frame-color').value = profileAvatarFrameColorDraft;
    document.getElementById('profile-avatar-frame-style').value = profileAvatarFrameStyleDraft;
    applyProfileAvatarFrame();
    renderProfileImagePreviews(null, null);
    const avatar = document.getElementById('profile-avatar-image');
    avatar.hidden = true;
    avatar.removeAttribute('src');
    document.getElementById('profile-avatar-placeholder').hidden = false;
    const coverImage = document.getElementById('profile-cover-image');
    coverImage.hidden = true;
    coverImage.removeAttribute('src');
    document.getElementById('profile-avatar-file').value = '';
    document.getElementById('profile-cover-file').value = '';
    try {
        const result = await API.updateProfile({
            avatarData: null,
            coverData: null,
            avatarFrameColor: profileAvatarFrameColorDraft,
            avatarFrameStyle: profileAvatarFrameStyleDraft
        });
        playerProfile = {
            ...playerProfile,
            avatarData: null,
            coverData: null,
            avatarFrameColor: profileAvatarFrameColorDraft,
            avatarFrameStyle: profileAvatarFrameStyleDraft
        };
        alert(result.message);
    } catch (error) {
        alert(`Не удалось сбросить оформление: ${error.message}`);
        await loadPlayerProfile();
    }
}

async function loadStats() {
    try {
        const stats = await API.getStats();
        document.getElementById('stat-tournaments').textContent = stats.tournaments;
        document.getElementById('stat-teams').textContent = stats.approvedTeams;
        document.getElementById('stat-users').textContent = stats.users;
        const prizes = Object.entries(stats.prizeByCurrency || {})
            .filter(([, amount]) => amount > 0)
            .map(([currency, amount]) => formatPrize(amount, currency));
        document.getElementById('stat-prize').textContent = prizes.join(' · ') || formatPrize(0, 'USD');
    } catch (e) { console.error('Ошибка статы:', e); }
}

async function loadTeamLeaderboard() {
    const container = document.getElementById('team-leaderboard-list');
    const teamCount = document.getElementById('leaderboard-team-count');
    const winCount = document.getElementById('leaderboard-win-count');
    try {
        const teams = await API.getTeamLeaderboard();
        if (!Array.isArray(teams)) throw new Error('Сервер вернул некорректный формат рейтинга');
        teamCount.textContent = String(teams.length);
        winCount.textContent = String(teams.reduce((total, team) => total + (Number(team.wins) || 0), 0));
        if (!teams.length) {
            const emptyState = document.createElement('div');
            emptyState.className = 'leaderboard-empty';
            emptyState.innerHTML = '<span class="leaderboard-empty-icon" aria-hidden="true">♧</span>';
            const title = document.createElement('h2');
            title.textContent = 'Здесь начинается история';
            const message = document.createElement('p');
            message.textContent = 'Пока в рейтинге нет побед. Завершите первый матч турнира — и команда появится среди лидеров.';
            emptyState.append(title, message);
            container.replaceChildren(emptyState);
            return;
        }

        const podium = document.createElement('div');
        podium.className = `leaderboard-podium podium-count-${Math.min(teams.length, 3)}`;
        [1, 0, 2].forEach(index => {
            const team = teams[index];
            if (!team) return;
            const place = index + 1;
            const card = document.createElement('article');
            card.className = `podium-card podium-place-${place}`;
            const placeLabel = document.createElement('span');
            placeLabel.className = 'podium-place-label';
            placeLabel.textContent = place === 1 ? 'ЧЕМПИОН' : `#${place}`;
            const emblem = document.createElement('span');
            emblem.className = 'podium-emblem';
            emblem.setAttribute('aria-hidden', 'true');
            if (team.avatarData) {
                const image = document.createElement('img');
                image.src = team.avatarData;
                image.alt = '';
                emblem.append(image);
            } else {
                emblem.textContent = place === 1 ? '♛' : place === 2 ? '♜' : '♞';
            }
            const name = document.createElement('h2');
            name.className = 'podium-team-name';
            name.textContent = team.teamName;
            const wins = document.createElement('p');
            wins.className = 'podium-wins';
            const winsCount = document.createElement('strong');
            winsCount.textContent = String(Number(team.wins) || 0);
            wins.append(winsCount, document.createTextNode(' побед'));
            card.append(placeLabel, emblem, name, wins, createLeaderboardTeamDetails(team));
            podium.append(card);
        });

        const standings = document.createElement('div');
        standings.className = 'leaderboard-standings';
        const standingsHeading = document.createElement('div');
        standingsHeading.className = 'leaderboard-section-heading';
        standingsHeading.innerHTML = '<span>РЕЙТИНГ</span><span>СИЛЬНЕЙШИЕ СОСТАВЫ</span>';
        standings.append(standingsHeading);
        teams.slice(3).forEach((team, index) => {
            const row = document.createElement('article');
            row.className = 'leaderboard-row';
            const rank = document.createElement('span');
            rank.className = 'leaderboard-rank';
            rank.textContent = String(index + 4).padStart(2, '0');
            const identity = document.createElement('div');
            identity.className = 'leaderboard-team-identity';
            const crest = document.createElement('span');
            crest.className = 'leaderboard-team-crest';
            if (team.avatarData) {
                const image = document.createElement('img');
                image.src = team.avatarData;
                image.alt = '';
                crest.append(image);
            } else {
                crest.textContent = team.teamName.trim().charAt(0).toLocaleUpperCase('ru-RU') || '?';
            }
            const name = document.createElement('strong');
            name.textContent = team.teamName;
            identity.append(crest, name);
            const tournaments = document.createElement('span');
            tournaments.className = 'leaderboard-tournaments';
            tournaments.textContent = Array.isArray(team.tournaments) && team.tournaments.length
                ? team.tournaments.join(' · ')
                : 'Турниры не указаны';
            const wins = document.createElement('span');
            wins.className = 'leaderboard-row-wins';
            const winsCount = document.createElement('strong');
            winsCount.textContent = String(Number(team.wins) || 0);
            const winsLabel = document.createElement('small');
            winsLabel.textContent = 'ПОБЕД';
            wins.append(winsCount, winsLabel);
            row.append(rank, identity, tournaments, wins, createLeaderboardTeamDetails(team));
            standings.append(row);
        });
        container.replaceChildren(podium);
        if (teams.length > 3) container.append(standings);
    } catch (error) {
        teamCount.textContent = '—';
        winCount.textContent = '—';
        const errorMessage = document.createElement('p');
        errorMessage.className = 'leaderboard-error';
        errorMessage.textContent = `Не удалось загрузить рейтинг команд: ${error.message}`;
        container.replaceChildren(errorMessage);
        console.error('Ошибка загрузки рейтинга команд:', error);
    }
}

function createLeaderboardTeamDetails(team) {
    const details = document.createElement('details');
    details.className = 'leaderboard-team-details';
    const summary = document.createElement('summary');
    const players = Array.isArray(team.players) ? team.players : [];
    summary.textContent = players.length ? `Состав · ${players.length}` : 'Состав';
    details.append(summary);
    const content = document.createElement('div');
    content.className = 'leaderboard-team-details-content';
    if (players.length) {
        const list = document.createElement('ul');
        players.forEach(player => {
            const item = document.createElement('li');
            item.textContent = player;
            list.append(item);
        });
        content.append(list);
    } else {
        const empty = document.createElement('p');
        empty.textContent = 'Состав пока не указан.';
        content.append(empty);
    }
    const tournaments = document.createElement('p');
    tournaments.textContent = Array.isArray(team.tournaments) && team.tournaments.length
        ? `Турниры: ${team.tournaments.join(', ')}`
        : 'Турниры не указаны.';
    content.append(tournaments);
    details.append(content);
    return details;
}

async function clearTeamLeaderboard() {
    if (currentAdminLevel() < 3) {
        alert('Очистить топ может только старший администратор.');
        return;
    }
    if (!confirm('Очистить таблицу топа команд? Сохранённые результаты матчей в рейтинге будут сброшены, турнирные сетки и их победители останутся без изменений. Новые результаты начнут накапливаться дальше.')) return;
    const button = document.getElementById('clear-team-leaderboard');
    button.disabled = true;
    try {
        const result = await API.clearTeamLeaderboard();
        await loadTeamLeaderboard();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось очистить топ команд: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

function formatPrize(amount, currency) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2
    }).format(Number(amount) || 0);
}

function getTournamentStatusLabel(status) {
    return ({ upcoming: 'Скоро', live: 'Идёт', completed: 'Завершён' })[status] || 'Скоро';
}

function formatTournamentDate(date) {
    if (!date) return '';
    const parsedDate = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsedDate.getTime())
        ? ''
        : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(parsedDate);
}

function normalizeGameName(game) {
    return String(game || '').trim().toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, '');
}

function getGameArtworkUrl(game) {
    const normalizedGame = normalizeGameName(game);
    return gameArtwork.get(normalizedGame) || '';
}

function createGameIcon(game, extraClass = '') {
    const icon = document.createElement('span');
    icon.className = `game-icon ${extraClass}`.trim();
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', game ? `Обложка игры: ${game}` : 'Обложка игровой дисциплины');
    const imageUrl = getGameArtworkUrl(game);
    if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
            icon.classList.add('game-icon-unavailable');
            image.remove();
        }, { once: true });
        icon.append(image);
    } else {
        icon.classList.add('game-icon-unavailable');
    }
    return icon;
}

function getGameCategory(game) {
    const normalizedGame = normalizeGameName(game);
    if (!normalizedGame) return gameCategories[gameCategories.length - 1];

    const aliases = {
        shooters: ['cs2', 'csgo', 'counterstrike2', 'counterstrikeglobaloffensive', 'valorant', 'overwatch2', 'rainbowsixsiege', 'r6', 'thefinals'],
        moba: ['dota2', 'leagueoflegends', 'lol', 'smite2'],
        'battle-royale': ['fortnite', 'pubgbattlegrounds', 'pubg', 'apexlegends', 'warzone', 'callofdutywarzone'],
        sports: ['easportsfc26', 'fc26', 'fifa', 'rocketleague', 'efootball'],
        fighting: ['tekken8', 'streetfighter6', 'mortalkombat1', 'brawlhalla'],
        strategy: ['starcraft2', 'starcraftii', 'ageofempiresiv'],
        'card-games': ['hearthstone', 'teamfighttactics', 'tft', 'marvelsnap'],
        racing: ['forzahorizon5', 'f125', 'trackmania', 'granturismo7'],
        survival: ['minecraft', 'rust', 'dayz']
    };
    const category = gameCategories.find(item =>
        item.id !== 'other'
        && (item.games.some(title => normalizeGameName(title) === normalizedGame)
            || aliases[item.id].includes(normalizedGame))
    );
    return category || gameCategories[gameCategories.length - 1];
}

function updateCustomGameField() {
    const customGame = document.getElementById('t-custom-game');
    const isCustomGame = document.getElementById('t-game').value === 'other';
    customGame.style.display = isCustomGame ? 'block' : 'none';
    customGame.required = isCustomGame;
}

function getGameFormValue() {
    const selectedGame = document.getElementById('t-game').value;
    return selectedGame === 'other'
        ? document.getElementById('t-custom-game').value.trim()
        : selectedGame;
}

function setGameFormValue(game) {
    const gameSelect = document.getElementById('t-game');
    const knownGame = [...gameSelect.options].some(option => option.value === game);
    gameSelect.value = knownGame ? game : (game ? 'other' : '');
    document.getElementById('t-custom-game').value = knownGame ? '' : game;
    updateCustomGameField();
}

function createTournamentCover(tournament) {
    const category = getGameCategory(tournament.game);
    const cover = document.createElement('div');
    cover.className = `card-cover cover-${category.id}`;
    cover.style.setProperty('--cover-accent', (coverPalettes[category.id] || coverPalettes.other)[0]);
    cover.style.setProperty('--cover-secondary', (coverPalettes[category.id] || coverPalettes.other)[1]);

    const kicker = document.createElement('span');
    kicker.className = 'cover-kicker';
    kicker.textContent = category.title;
    const game = document.createElement('span');
    game.className = 'cover-game-line';
    const gameName = document.createElement('span');
    gameName.className = 'cover-game';
    gameName.textContent = tournament.game || 'Открытая дисциплина';
    game.append(createGameIcon(tournament.game, 'cover-game-icon'), gameName);
    const title = document.createElement('strong');
    title.className = 'cover-title';
    title.textContent = tournament.name;
    cover.append(kicker, createGameIcon(tournament.game, 'cover-emblem'), game, title);
    return cover;
}

async function loadTournaments() {
    const listEl = document.getElementById('tournament-list');
    try {
        const tournaments = await API.getTournaments();
        const user = Auth.getUser();
        const cardsByCategory = new Map(gameCategories.map(category => [category.id, []]));
        tournaments.forEach(tournament => {
            const card = document.createElement('article');
            card.className = 'tournament-card';

            const cover = createTournamentCover(tournament);
            const body = document.createElement('div');
            body.className = 'card-body';

            const status = document.createElement('span');
            status.className = `tournament-status status-${tournament.status || 'upcoming'}`;
            status.textContent = getTournamentStatusLabel(tournament.status);
            const title = document.createElement('h3');
            title.textContent = tournament.name;
            const details = document.createElement('div');
            details.className = 'tournament-details';
            if (tournament.game) details.append(createTournamentDetail('Игра', tournament.game));
            if (tournament.start_date) details.append(createTournamentDetail('Начало', formatTournamentDate(tournament.start_date)));
            if (Number(tournament.team_size) > 0) {
                details.append(createTournamentDetail('Игроков в команде', String(tournament.team_size)));
            }
            details.append(createTournamentDetail('Призовой фонд', formatPrize(tournament.prize_amount, tournament.prize_currency || 'USD'), 'prize-detail'));
            body.append(status, title, details);

            const winner = getTournamentWinner(tournament.bracket_data);
            if (winner) {
                const winnerPlaque = document.createElement('div');
                winnerPlaque.className = 'winner-plaque card-winner-plaque';
                winnerPlaque.textContent = `Победитель: ${winner}`;
                body.append(winnerPlaque);
            }

            if (tournament.description) {
                const description = document.createElement('p');
                description.className = 'tournament-description';
                description.textContent = tournament.description;
                body.append(description);
            }

            const actions = document.createElement('div');
            actions.className = 'card-actions';
            const bracketButton = document.createElement('button');
            bracketButton.className = 'btn-ai-small';
            bracketButton.textContent = 'СЕТКА';
            bracketButton.addEventListener('click', () => openTournament(tournament.id));
            actions.append(bracketButton);
            if (user && tournament.status === 'upcoming') {
                const applicationButton = document.createElement('button');
                applicationButton.className = 'btn-ai-small';
                applicationButton.textContent = 'ЗАЯВКА';
                applicationButton.addEventListener('click', () => openAppModal(
                    tournament.id, tournament.name, tournament.status, tournament.team_size
                ));
                actions.append(applicationButton);
            } else if (tournament.status !== 'upcoming') {
                const closedLabel = document.createElement('span');
                closedLabel.className = 'registration-closed';
                closedLabel.textContent = 'Набор закрыт';
                actions.append(closedLabel);
            }
            body.append(actions);
            card.append(cover, body);
            cardsByCategory.get(getGameCategory(tournament.game).id).push(card);
        });

        const sections = gameCategories.map(category => {
            const section = document.createElement('section');
            section.className = `game-category-section category-${category.id}`;
            section.id = `category-${category.id}`;

            const header = document.createElement('div');
            header.className = 'game-category-header';
            const heading = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = category.title;
            const description = document.createElement('p');
            description.textContent = category.description;
            heading.append(title, description);
            const count = document.createElement('span');
            const categoryCards = cardsByCategory.get(category.id);
            count.className = 'category-count';
            count.textContent = `${categoryCards.length} ${getTournamentCountLabel(categoryCards.length)}`;
            header.append(heading, count);
            section.append(header);

            if (category.games.length) {
                const games = document.createElement('div');
                games.className = 'popular-games';
                category.games.forEach(gameName => {
                    const gameTag = document.createElement('span');
                    gameTag.className = 'game-tag';
                    gameTag.append(createGameIcon(gameName, 'game-tag-icon'));
                    const gameLabel = document.createElement('span');
                    gameLabel.textContent = gameName;
                    gameTag.append(gameLabel);
                    games.append(gameTag);
                });
                section.append(games);
            }

            if (categoryCards.length) {
                const grid = document.createElement('div');
                grid.className = 'tournaments-grid';
                grid.append(...categoryCards);
                section.append(grid);
            } else {
                const empty = document.createElement('p');
                empty.className = 'category-empty';
                empty.textContent = 'Турниров пока нет — скоро добавим.';
                section.append(empty);
            }
            return section;
        });
        listEl.replaceChildren(...sections);
    } catch (err) { listEl.innerHTML = '<p style="color:red;">Ошибка загрузки</p>'; }
}

function getTournamentCountLabel(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'турниров';
    if (lastDigit === 1) return 'турнир';
    return lastDigit >= 2 && lastDigit <= 4 ? 'турнира' : 'турниров';
}

function createTournamentDetail(label, value, className = '') {
    const detail = document.createElement('div');
    detail.className = `tournament-detail ${className}`.trim();
    const detailLabel = document.createElement('span');
    detailLabel.textContent = label;
    const detailValue = document.createElement('strong');
    detailValue.textContent = value;
    detail.append(detailLabel, detailValue);
    return detail;
}

async function openAppModal(tId, tName, status = 'upcoming', teamSize = 0) {
    if (status !== 'upcoming') {
        alert('Набор на турнир закрыт');
        return;
    }
    const requestId = ++applicationModalRequest;
    const form = document.querySelector('#application-modal form');
    form.reset();
    document.getElementById('app-tournament-id').value = tId;
    document.getElementById('modal-tournament-title').innerText = `Заявка: ${tName}`;
    applicationTeamSize = Number(teamSize) || 0;
    const roster = document.getElementById('app-roster');
    const teamName = document.getElementById('app-team-name');
    const contact = document.getElementById('app-contact');
    const statusText = document.getElementById('app-roster-status');
    const memberList = document.getElementById('app-roster-members');
    const submitButton = document.getElementById('app-submit-button');
    applicationSelectedMemberIds = [];
    applicationRosterSelectionRequired = false;
    applicationRosterSelectionValid = true;
    teamName.readOnly = false;
    roster.readOnly = false;
    memberList.hidden = true;
    memberList.replaceChildren();
    statusText.textContent = applicationTeamSize
        ? `Для турнира требуется ровно ${applicationTeamSize} игроков.`
        : 'Для этого турнира точный размер состава не задан.';
    submitButton.disabled = true;
    document.getElementById('application-modal').style.display = 'flex';
    try {
        const data = await API.getMyTeam();
        if (requestId !== applicationModalRequest) return;
        if (data.membership) {
            const captain = data.members.find(member => member.role === 'captain');
            teamName.value = data.membership.name;
            teamName.readOnly = true;
            roster.readOnly = true;
            if (!contact.value && captain) contact.value = captain.username;
            applicationRosterSelectionRequired = true;
            memberList.hidden = false;
            data.members.forEach((member, index) => {
                const label = document.createElement('label');
                label.className = 'application-roster-member';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = String(member.id);
                checkbox.checked = applicationTeamSize ? index < applicationTeamSize : true;
                checkbox.addEventListener('change', updateApplicationRosterSelection);
                const name = document.createElement('span');
                name.textContent = member.username;
                const role = document.createElement('small');
                role.textContent = member.role === 'captain' ? 'Капитан' : 'Игрок';
                label.append(checkbox, name, role);
                memberList.append(label);
            });
            updateApplicationRosterSelection();
        } else {
            roster.value = '';
            statusText.textContent += ' Вы не состоите в зарегистрированной команде — перечислите игроков по одному в строке.';
            submitButton.disabled = false;
        }
    } catch (error) {
        if (requestId !== applicationModalRequest) return;
        statusText.textContent = `Не удалось загрузить команду: ${error.message}. Состав можно заполнить вручную; сервер всё равно проверит участников зарегистрированной команды.`;
        console.error('Не удалось загрузить команду для заявки на турнир:', error);
        submitButton.disabled = false;
    } finally {
        if (requestId === applicationModalRequest && !applicationRosterSelectionRequired) {
            submitButton.disabled = false;
        }
    }
}

function updateApplicationRosterSelection() {
    const selected = [...document.querySelectorAll('#app-roster-members input[type="checkbox"]:checked')];
    applicationSelectedMemberIds = selected.map(input => Number(input.value));
    document.getElementById('app-roster').value = selected
        .map(input => input.closest('label').querySelector('span').textContent)
        .join('\n');
    const statusText = document.getElementById('app-roster-status');
    if (applicationTeamSize) {
        statusText.textContent = `Выбрано ${selected.length} из ${document.querySelectorAll('#app-roster-members input[type="checkbox"]').length}; для турнира требуется ровно ${applicationTeamSize} игроков.`;
        applicationRosterSelectionValid = selected.length === applicationTeamSize;
    } else {
        statusText.textContent = `Выбрано игроков: ${selected.length}. Точный размер состава для турнира не задан.`;
        applicationRosterSelectionValid = selected.length > 0;
    }
    document.getElementById('app-submit-button').disabled = !applicationRosterSelectionValid;
}

function closeAppModal() {
    applicationModalRequest += 1;
    applicationRosterSelectionRequired = false;
    document.getElementById('application-modal').style.display = 'none';
}

async function handleSendApplication(e) {
    e.preventDefault();
    const submitButton = document.getElementById('app-submit-button');
    if (applicationRosterSelectionRequired && !applicationRosterSelectionValid) {
        alert('Выберите точное количество игроков для турнира.');
        return;
    }
    submitButton.disabled = true;
    try {
        const result = await API.submitApplication({
            tournamentId: document.getElementById('app-tournament-id').value,
            teamName: document.getElementById('app-team-name').value,
            captainContact: document.getElementById('app-contact').value,
            roster: document.getElementById('app-roster').value,
            selectedMemberIds: applicationSelectedMemberIds
        });
        alert(result.message || 'Заявка успешно отправлена!');
        closeAppModal();
    } catch (err) {
        alert(`Не удалось отправить заявку: ${err.message}`);
    } finally {
        if (document.getElementById('application-modal').style.display !== 'none') {
            submitButton.disabled = applicationRosterSelectionRequired && !applicationRosterSelectionValid;
        }
    }
}

// --- СЕТКА ТУРНИРА (БЕЗОПАСНЫЙ РЕНДЕР) ---

async function openTournament(id) {
    try {
        closeMatchRoom();
        currentTournament = await API.getTournamentById(id);
        document.getElementById('bracket-title').innerText = currentTournament.name;
        const winner = getTournamentWinner(currentTournament.bracket_data);
        const winnerPlaque = document.getElementById('bracket-winner');
        winnerPlaque.textContent = winner ? `Победитель турнира: ${winner}` : '';
        winnerPlaque.style.display = winner ? 'block' : 'none';
        const teamDetails = document.getElementById('bracket-team-details');
        teamDetails.hidden = true;
        teamDetails.replaceChildren();
        renderBracket(currentTournament.bracket_data);
        showPage('page-bracket');
    } catch (err) { alert('Ошибка загрузки сетки'); }
}

function renderBracket(data) {
    const container = document.getElementById('bracket-container');
    const user = Auth.getUser();
    const role = user ? effectiveUserRole(user) : 'GUEST';
    const isAdmin = (adminRoleLevels[role] || 0) >= 2;

    let bracket = [];
    try {
        bracket = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
        console.error("Ошибка парсинга сетки:", e);
    }

    if (!bracket || !Array.isArray(bracket) || bracket.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'bracket-empty';
        empty.textContent = 'Сетка еще не сформирована';
        container.replaceChildren(empty);
        return;
    }

    const rounds = bracket.map((round, roundIndex) => {
        const roundElement = document.createElement('div');
        roundElement.className = 'round';
        const title = document.createElement('div');
        title.className = 'round-title';
        title.textContent = `ЭТАП ${roundIndex + 1}`;
        roundElement.append(title);
        if (!Array.isArray(round)) return roundElement;

        round.forEach((match, matchIndex) => {
            if (!match || typeof match !== 'object') return;
            const matchElement = document.createElement('article');
            matchElement.className = 'match';
            const team1 = createBracketTeam(match.team1 || 'TBD', match, isAdmin, roundIndex, matchIndex);
            const team2 = createBracketTeam(match.team2 || 'TBD', match, isAdmin, roundIndex, matchIndex);
            matchElement.append(team1, team2);
            if (currentTournament.status === 'live'
                && match.team1 && match.team2 && match.team1 !== 'TBD' && match.team2 !== 'TBD'
                && !match.winner) {
                const chatButton = document.createElement('button');
                chatButton.type = 'button';
                chatButton.className = 'match-chat-open';
                chatButton.textContent = 'ОБЩИЙ ЧАТ';
                chatButton.addEventListener('click', () => openMatchRoom(roundIndex, matchIndex));
                matchElement.append(chatButton);
            }
            roundElement.append(matchElement);
        });
        return roundElement;
    });
    container.replaceChildren(...rounds);
}

function createBracketTeam(teamName, match, isAdmin, roundIndex, matchIndex) {
    const team = document.createElement('div');
    team.className = 'team';
    if (match.winner === teamName) team.classList.add('winner');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'team-name-button';
    name.textContent = teamName;
    name.disabled = teamName === 'TBD';
    name.setAttribute('aria-label', teamName === 'TBD'
        ? 'Место в сетке пока не занято'
        : `Посмотреть состав команды ${teamName}`);
    if (teamName !== 'TBD') name.addEventListener('click', () => openBracketTeamDetails(teamName));
    team.append(name);
    const canSelectWinner = isAdmin && teamName !== 'TBD' && match.winner !== teamName;
    if (canSelectWinner) {
        const advance = document.createElement('button');
        advance.type = 'button';
        advance.className = 'team-advance-button';
        advance.textContent = 'Продвинуть';
        advance.setAttribute('aria-label', `Продвинуть команду ${teamName}`);
        advance.addEventListener('click', () => advanceTeam(roundIndex, matchIndex, teamName));
        team.append(advance);
    }
    return team;
}

async function openBracketTeamDetails(teamName) {
    const panel = document.getElementById('bracket-team-details');
    const requestId = ++bracketTeamDetailsRequest;
    panel.hidden = false;
    panel.replaceChildren();
    const loading = document.createElement('p');
    loading.textContent = `Загружаем состав «${teamName}»…`;
    panel.append(loading);
    try {
        const result = await API.getTeamByName(teamName);
        if (requestId !== bracketTeamDetailsRequest) return;
        const heading = document.createElement('div');
        heading.className = 'bracket-team-details-heading';
        const identity = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = result.team.name;
        const meta = document.createElement('p');
        meta.textContent = `${result.team.game} · Капитан: ${result.team.captain_name}`;
        identity.append(title, meta);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'action-btn-small';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => {
            bracketTeamDetailsRequest += 1;
            panel.hidden = true;
            panel.replaceChildren();
        });
        heading.append(identity, close);

        const roster = document.createElement('ul');
        roster.className = 'bracket-team-roster';
        result.members.forEach(member => {
            const item = document.createElement('li');
            const username = document.createElement('span');
            username.textContent = member.username;
            const role = document.createElement('small');
            role.textContent = member.role === 'captain' ? 'КАПИТАН' : 'ИГРОК';
            item.append(username, role);
            roster.append(item);
        });
        if (!result.members.length) {
            const empty = document.createElement('p');
            empty.textContent = 'В открытом составе пока нет участников.';
            panel.replaceChildren(heading, empty);
        } else {
            panel.replaceChildren(heading, roster);
        }
    } catch (error) {
        if (requestId !== bracketTeamDetailsRequest) return;
        const message = document.createElement('p');
        message.className = 'bracket-team-details-error';
        message.textContent = `Не удалось загрузить состав: ${error.message}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'action-btn-small';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => {
            bracketTeamDetailsRequest += 1;
            panel.hidden = true;
            panel.replaceChildren();
        });
        panel.replaceChildren(message, close);
    }
}

async function openMatchRoom(roundIndex, matchIndex) {
    if (!Auth.getUser()) {
        openAuthPage('login');
        return;
    }
    let bracket = currentTournament.bracket_data;
    try {
        if (typeof bracket === 'string') bracket = JSON.parse(bracket);
    } catch (error) {
        console.error('Не удалось прочитать сетку для комнаты матча:', error);
        alert('Не удалось прочитать данные матча');
        return;
    }
    const match = Array.isArray(bracket) && Array.isArray(bracket[roundIndex])
        ? bracket[roundIndex][matchIndex]
        : null;
    if (!match || !match.team1 || !match.team2) {
        alert('Матч больше недоступен. Обновите сетку.');
        return;
    }
    closeMatchRoom();
    activeMatchRoom = { tournamentId: currentTournament.id, roundIndex, matchIndex };
    const room = document.getElementById('match-room');
    room.hidden = false;
    document.getElementById('match-room-title').textContent = `${match.team1} vs ${match.team2}`;
    const messages = document.getElementById('match-chat-messages');
    document.getElementById('match-chat-input').disabled = true;
    document.querySelector('#match-chat-form button[type="submit"]').disabled = true;
    messages.textContent = 'Проверяем доступ к чату…';
    const opened = await refreshMatchRoom();
    if (opened && activeMatchRoom) {
        document.getElementById('match-chat-input').disabled = false;
        document.querySelector('#match-chat-form button[type="submit"]').disabled = false;
        matchChatRefreshTimer = window.setInterval(refreshMatchRoom, 5000);
    }
    room.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMatchRoom() {
    if (matchChatRefreshTimer) {
        window.clearInterval(matchChatRefreshTimer);
        matchChatRefreshTimer = null;
    }
    activeMatchRoom = null;
    const room = document.getElementById('match-room');
    if (room) room.hidden = true;
}

async function refreshMatchRoom() {
    if (!activeMatchRoom) return;
    const roomState = activeMatchRoom;
    try {
        const result = await API.getMatchMessages(
            roomState.tournamentId,
            roomState.roundIndex,
            roomState.matchIndex
        );
        if (activeMatchRoom !== roomState) return;
        renderMatchMessages(result.messages);
        return true;
    } catch (error) {
        if (activeMatchRoom !== roomState) return;
        const status = document.createElement('p');
        status.className = 'match-chat-empty match-chat-error';
        status.textContent = error.message;
        document.getElementById('match-chat-messages').replaceChildren(status);
        console.error('Не удалось обновить общий чат матча:', error);
        if (error.message.includes('завершён') || error.message.includes('живого турнира')) {
            closeMatchRoom();
        }
        return false;
    }
}

function renderMatchMessages(messages) {
    const container = document.getElementById('match-chat-messages');
    const shouldScroll = container.scrollHeight - container.scrollTop - container.clientHeight < 70;
    if (!messages.length) {
        const empty = document.createElement('p');
        empty.className = 'match-chat-empty';
        empty.textContent = 'Чат открыт для игроков обеих команд. Начните общение.';
        container.replaceChildren(empty);
        return;
    }
    const currentUserId = Number(Auth.getUser()?.id);
    const items = messages.map(message => {
        const item = document.createElement('article');
        item.className = `match-chat-message ${Number(message.sender_id) === currentUserId ? 'own' : ''}`;
        const metadata = document.createElement('div');
        metadata.className = 'match-chat-message-meta';
        const sender = document.createElement('strong');
        sender.textContent = message.sender_name;
        const time = document.createElement('time');
        const createdAt = new Date(`${message.created_at.replace(' ', 'T')}Z`);
        time.textContent = Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        metadata.append(sender, time);
        const text = document.createElement('p');
        text.textContent = message.message;
        item.append(metadata, text);
        return item;
    });
    container.replaceChildren(...items);
    if (shouldScroll) container.scrollTop = container.scrollHeight;
}

async function handleMatchChatSubmit(event) {
    event.preventDefault();
    if (!activeMatchRoom) return;
    const input = document.getElementById('match-chat-input');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const message = input.value.trim();
    if (!message) return;
    button.disabled = true;
    try {
        const roomState = activeMatchRoom;
        await API.sendMatchMessage(
            roomState.tournamentId,
            roomState.roundIndex,
            roomState.matchIndex,
            message
        );
        if (activeMatchRoom !== roomState) return;
        input.value = '';
        await refreshMatchRoom();
    } catch (error) {
        alert(`Не удалось отправить сообщение: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

function getTournamentWinner(data) {
    let bracket = data;
    if (typeof bracket === 'string') {
        try {
            bracket = JSON.parse(bracket);
        } catch (error) {
            console.error('Ошибка парсинга сетки при поиске победителя:', error);
            return null;
        }
    }
    if (!Array.isArray(bracket)) return null;

    for (let roundIndex = bracket.length - 1; roundIndex >= 0; roundIndex -= 1) {
        const round = bracket[roundIndex];
        if (!Array.isArray(round) || round.length !== 1) continue;

        const finalMatch = round[0];
        const hasTwoTeams = finalMatch.team1 && finalMatch.team1 !== 'TBD'
            && finalMatch.team2 && finalMatch.team2 !== 'TBD';
        const hasWinner = finalMatch.winner
            && (finalMatch.winner === finalMatch.team1 || finalMatch.winner === finalMatch.team2);
        if (!hasTwoTeams || !hasWinner) continue;

        if (roundIndex === bracket.length - 1) return finalMatch.winner;
        const followingRound = bracket[roundIndex + 1];
        const advancedMatch = Array.isArray(followingRound) && followingRound.length === 1
            ? followingRound[0]
            : null;
        if (advancedMatch && [advancedMatch.team1, advancedMatch.team2].includes(finalMatch.winner)
            && (advancedMatch.team1 === 'TBD' || advancedMatch.team2 === 'TBD')) {
            return finalMatch.winner;
        }
    }

    return null;
}

// Продвижение команды (Только Админ)
async function advanceTeam(rIndex, mIndex, teamName) {
    if (teamName === 'TBD') return;
    if (!confirm(`Объявить ${teamName} победителем матча?`)) return;

    let bracket = currentTournament.bracket_data;
    if (typeof bracket === 'string') bracket = JSON.parse(bracket);
    
    bracket[rIndex][mIndex].winner = teamName;
    let nextRIndex = rIndex + 1;
    if (!bracket[nextRIndex]) bracket[nextRIndex] = [];
    
    let nextMIndex = Math.floor(mIndex / 2);
    if (!bracket[nextRIndex][nextMIndex]) {
        bracket[nextRIndex][nextMIndex] = { team1: 'TBD', team2: 'TBD', winner: null };
    }
    
    if (mIndex % 2 === 0) { bracket[nextRIndex][nextMIndex].team1 = teamName; } 
    else { bracket[nextRIndex][nextMIndex].team2 = teamName; }

    try {
        await API.updateTournamentBracket(currentTournament.id, bracket);
        openTournament(currentTournament.id);
    } catch (err) { alert('Ошибка при обновлении сетки'); }
}

// --- АДМИН ПАНЕЛЬ ---
function switchAdminTab(tab, button) {
    const requiredLevel = tab === 'create' ? 2 : tab === 'users' || tab === 'audit-logs' ? 3 : 1;
    if (currentAdminLevel() < requiredLevel || !button) return;
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`admin-tab-${tab}`).style.display = 'block';
    button.classList.add('active');
    
    if(tab === 'tournaments') loadAdminTournaments();
    if(tab === 'applications') loadAdminApplications();
    if(tab === 'accepted-teams') loadAdminAcceptedTeams();
    if(tab === 'users') loadAdminUsers();
    if(tab === 'audit-logs') loadAdminAuditLogs();
}

async function handleCreateTournament(e) {
    e.preventDefault();
    const editId = document.getElementById('tournament-edit-id').value;
    const tournamentData = {
        name: document.getElementById('t-name').value.trim(),
        game: getGameFormValue(),
        startDate: document.getElementById('t-date').value,
        prizeAmount: document.getElementById('t-prize').value,
        prizeCurrency: document.getElementById('t-currency').value,
        teamSize: Number(document.getElementById('t-team-size').value),
        status: document.getElementById('t-status').value,
        description: document.getElementById('t-description').value.trim()
    };

    if (!editId) {
        const teams = document.getElementById('t-teams').value.split('\n').map(team => team.trim()).filter(Boolean);
        const round1 = [];
        for (let i = 0; i < teams.length; i += 2) {
            round1.push({ team1: teams[i], team2: teams[i + 1] || 'TBD', winner: null });
        }
        tournamentData.bracketData = [round1];
    }

    try {
        if (editId) {
            await API.updateTournament(editId, tournamentData);
            alert('Изменения турнира сохранены');
        } else {
            await API.createTournament(tournamentData);
            alert('Турнир создан');
        }
        cancelTournamentEdit();
        await Promise.all([loadStats(), loadTournaments(), loadAdminTournaments()]);
    } catch (err) { alert(err.message); }
}

async function editTournament(id) {
    try {
        const tournament = await API.getTournamentById(id);
        document.getElementById('tournament-edit-id').value = tournament.id;
        document.getElementById('t-name').value = tournament.name || '';
        setGameFormValue(tournament.game || '');
        document.getElementById('t-date').value = tournament.start_date || '';
        document.getElementById('t-prize').value = tournament.prize_amount || 0;
        document.getElementById('t-currency').value = tournament.prize_currency || 'USD';
        document.getElementById('t-team-size').value = tournament.team_size || '';
        document.getElementById('t-status').value = tournament.status || 'upcoming';
        document.getElementById('t-description').value = tournament.description || '';
        document.getElementById('t-teams').disabled = true;
        document.getElementById('t-teams').value = 'Сетка сохранится без изменений.';
        document.getElementById('t-submit-btn').textContent = 'СОХРАНИТЬ ИЗМЕНЕНИЯ';
        document.getElementById('t-cancel-edit').style.display = 'inline-block';
        switchAdminTab('create', document.querySelector('#page-admin .admin-tab-btn'));
    } catch (err) {
        alert(`Не удалось загрузить турнир: ${err.message}`);
    }
}

function cancelTournamentEdit() {
    document.getElementById('tournament-edit-id').value = '';
    document.getElementById('t-name').value = '';
    setGameFormValue('');
    document.getElementById('t-date').value = '';
    document.getElementById('t-prize').value = '0';
    document.getElementById('t-currency').value = 'USD';
    document.getElementById('t-team-size').value = '';
    document.getElementById('t-status').value = 'upcoming';
    document.getElementById('t-description').value = '';
    document.getElementById('t-teams').disabled = false;
    document.getElementById('t-teams').value = '';
    document.getElementById('t-submit-btn').textContent = 'СОЗДАТЬ ТУРНИР';
    document.getElementById('t-cancel-edit').style.display = 'none';
}

async function loadAdminTournaments() {
    const container = document.getElementById('admin-tournaments-list');
    try {
        const tournaments = await API.getTournaments();
        if (!tournaments.length) {
            container.innerHTML = '<p>Турниров нет</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-table';
        table.innerHTML = '<tr><th>Турнир</th><th>Игроков в команде</th><th>Призовой фонд</th><th>Статус</th><th>Действия</th></tr>';

        tournaments.forEach(tournament => {
            const row = table.insertRow();
            const nameCell = row.insertCell();
            nameCell.textContent = tournament.game ? `${tournament.name} · ${tournament.game}` : tournament.name;
            row.insertCell().textContent = Number(tournament.team_size) > 0
                ? String(tournament.team_size)
                : 'Не задано';
            row.insertCell().textContent = formatPrize(tournament.prize_amount, tournament.prize_currency || 'USD');
            row.insertCell().textContent = getTournamentStatusLabel(tournament.status);
            const actionsCell = row.insertCell();
            if (currentAdminLevel() >= 2) {
                const editButton = document.createElement('button');
                editButton.type = 'button';
                editButton.className = 'btn-ai-small';
                editButton.textContent = 'Изменить';
                editButton.addEventListener('click', () => editTournament(tournament.id));
                actionsCell.append(editButton);
            }
            if (currentAdminLevel() >= 3) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'action-btn-small';
                deleteButton.textContent = 'Удалить';
                deleteButton.addEventListener('click', () => deleteTournament(tournament.id, tournament.name));
                actionsCell.append(deleteButton);
            }
            if (!actionsCell.childElementCount) actionsCell.textContent = 'Только просмотр';
        });

        container.replaceChildren(table);
    } catch (err) {
        container.innerHTML = '<p>Ошибка загрузки турниров</p>';
        console.error('Ошибка загрузки турниров в админ-панели:', err);
    }
}

async function deleteTournament(id, name) {
    if (!confirm(`Удалить турнир «${name}»? Это действие нельзя отменить.`)) return;

    try {
        await API.deleteTournament(id);
        if (currentTournament && currentTournament.id === id) currentTournament = null;
        await loadAdminTournaments();
        await Promise.all([loadStats(), loadTournaments()]);
    } catch (err) {
        alert(`Не удалось удалить турнир: ${err.message}`);
    }
}

async function loadAdminApplications() {
    const container = document.getElementById('admin-applications-list');
    try {
        const apps = await API.getApplications();
        if (!apps.length) {
            container.textContent = 'Заявок нет';
            return;
        }
        const table = document.createElement('table');
        table.className = 'admin-table';
        const header = table.insertRow();
        ['Команда', 'Турнир', 'Игроки', 'Состав', 'Статус', 'Действия']
            .forEach(label => {
                const cell = document.createElement('th');
                cell.textContent = label;
                header.append(cell);
            });
        apps.forEach(application => {
            const row = table.insertRow();
            const teamCell = row.insertCell();
            const teamName = document.createElement('strong');
            teamName.textContent = application.team_name;
            const contact = document.createElement('small');
            contact.textContent = application.captain_contact;
            teamCell.append(teamName, document.createElement('br'), contact);
            row.insertCell().textContent = application.tournament_name;

            const playerCount = Number(application.roster_count) || 0;
            const requiredCount = Number(application.team_size) || 0;
            const countCell = row.insertCell();
            countCell.className = requiredCount && playerCount !== requiredCount
                ? 'application-roster-count invalid'
                : 'application-roster-count';
            countCell.textContent = requiredCount
                ? `${playerCount} / ${requiredCount}`
                : `${playerCount} / не задано`;
            if (requiredCount && playerCount !== requiredCount) {
                countCell.title = playerCount > requiredCount
                    ? 'Игроков больше, чем разрешено турниром'
                    : 'Игроков меньше, чем требуется турниром';
            }

            const rosterCell = row.insertCell();
            const rosterNames = typeof application.roster === 'string'
                ? application.roster.split(/[\n,;]+/).map(name => name.trim()).filter(Boolean)
                : [];
            rosterCell.textContent = rosterNames.join(', ');
            row.insertCell().textContent = application.status;
            const actions = row.insertCell();
            if (application.status === 'pending') {
                const approve = document.createElement('button');
                approve.type = 'button';
                approve.className = 'btn-ai-small';
                approve.textContent = 'Одобрить';
                approve.addEventListener('click', () => changeAppStatus(application.id, 'approved'));
                const reject = document.createElement('button');
                reject.type = 'button';
                reject.className = 'action-btn-small';
                reject.textContent = 'Отклонить';
                reject.addEventListener('click', () => changeAppStatus(application.id, 'rejected'));
                actions.append(approve, reject);
            } else {
                actions.textContent = '—';
            }
        });
        container.replaceChildren(table);
    } catch (error) {
        container.textContent = `Ошибка загрузки заявок: ${error.message}`;
        console.error('Ошибка загрузки заявок в админ-панели:', error);
    }
}

async function changeAppStatus(id, status) {
    try {
        await API.updateApplicationStatus(id, status);
        await Promise.all([loadAdminApplications(), loadAdminAcceptedTeams()]);
    }
    catch(e) { alert(e.message); }
}

async function refreshNotifications() {
    if (!Auth.getUser()) return;
    try {
        const notifications = await API.getNotifications();
        const currentIds = new Set(notifications.map(notification => String(notification.id)));
        if (knownNotificationIds) {
            const newNotifications = notifications
                .filter(notification => !knownNotificationIds.has(String(notification.id)))
                .reverse();
            newNotifications.forEach(showNotificationToast);
        }
        knownNotificationIds = currentIds;
        renderNotifications(notifications);
    } catch (error) {
        console.error('Не удалось обновить уведомления:', error);
    }
}

function unlockNotificationAudio() {
    if (!window.AudioContext || notificationAudioContext) return;
    notificationAudioContext = new window.AudioContext();
    if (notificationAudioContext.state === 'suspended') {
        notificationAudioContext.resume().catch(error => {
            console.warn('Не удалось включить звук уведомлений:', error);
        });
    }
}

function playNotificationSound() {
    if (!notificationSoundEnabled || !notificationAudioContext) return;
    if (notificationAudioContext.state === 'suspended') {
        notificationAudioContext.resume().catch(error => {
            console.warn('Не удалось воспроизвести звук уведомления:', error);
        });
    }

    const startAt = notificationAudioContext.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = notificationAudioContext.createOscillator();
        const gain = notificationAudioContext.createGain();
        const noteStart = startAt + index * 0.085;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, noteStart);
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.085, noteStart + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.24);
        oscillator.connect(gain);
        gain.connect(notificationAudioContext.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.25);
    });
}

function toggleNotificationSound() {
    notificationSoundEnabled = !notificationSoundEnabled;
    localStorage.setItem('notificationSoundEnabled', String(notificationSoundEnabled));
    const button = document.getElementById('notification-sound-toggle');
    button.textContent = `Звук: ${notificationSoundEnabled ? 'вкл.' : 'выкл.'}`;
    button.setAttribute('aria-pressed', String(notificationSoundEnabled));
    if (notificationSoundEnabled) {
        unlockNotificationAudio();
        playNotificationSound();
    }
}

function showNotificationToast(notification) {
    const toast = document.getElementById('notification-toast');
    const isRejected = /отклонена|не принята/i.test(`${notification.title} ${notification.message}`);
    toast.classList.toggle('notification-rejected', isRejected);
    toast.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const message = document.createElement('span');
    message.textContent = notification.message;
    toast.append(title, message);
    toast.classList.add('visible');
    playNotificationSound();
    window.clearTimeout(notificationToastTimer);
    notificationToastTimer = window.setTimeout(() => {
        toast.classList.remove('visible');
    }, 6500);
}

function renderNotifications(notifications) {
    const list = document.getElementById('notification-list');
    const count = document.getElementById('notification-count');
    const unreadCount = notifications.filter(notification => !notification.is_read).length;
    count.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    count.style.display = unreadCount ? 'inline-flex' : 'none';

    if (!notifications.length) {
        const empty = document.createElement('p');
        empty.className = 'notification-empty';
        empty.textContent = 'Пока нет уведомлений.';
        list.replaceChildren(empty);
        return;
    }

    const items = notifications.map(notification => {
        const item = document.createElement('article');
        item.className = `notification-item${notification.is_read ? '' : ' unread'}`;
        const title = document.createElement('strong');
        title.textContent = notification.title;
        const message = document.createElement('p');
        message.textContent = notification.message;
        const date = document.createElement('time');
        date.textContent = new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(`${notification.created_at}${notification.created_at.includes('Z') ? '' : 'Z'}`));
        item.append(title, message, date);
        return item;
    });
    list.replaceChildren(...items);
}

async function toggleNotifications() {
    const panel = document.getElementById('notification-panel');
    const isOpening = panel.style.display === 'none';
    panel.style.display = isOpening ? 'block' : 'none';
    document.getElementById('notification-toggle').setAttribute('aria-expanded', String(isOpening));
    if (!isOpening) return;

    await refreshNotifications();
    try {
        await API.markNotificationsRead();
        await refreshNotifications();
    } catch (error) {
        console.error('Не удалось отметить уведомления прочитанными:', error);
    }
}

function closeNotifications() {
    document.getElementById('notification-panel').style.display = 'none';
    document.getElementById('notification-toggle').setAttribute('aria-expanded', 'false');
}

function isAdminUser() {
    return currentAdminLevel() > 0;
}

async function openSupportChat() {
    if (!Auth.getUser()) return;
    const modal = document.getElementById('support-chat-modal');
    modal.querySelector('.support-chat').classList.toggle('admin-chat-mode', isAdminUser());
    modal.style.display = 'flex';
    document.getElementById('support-chat-sidebar').hidden = !isAdminUser();
    document.getElementById('support-chat-title').textContent = isAdminUser()
        ? 'Центр поддержки'
        : 'Напишите нам';
    activeSupportChatUserId = null;
    activeSupportChatName = null;
    knownSupportMessageIds = null;
    setSupportChatPeer(
        isAdminUser() ? 'Выберите диалог' : 'Команда поддержки',
        isAdminUser() ? 'Выберите пользователя слева, чтобы ответить' : 'Обычно отвечаем быстро',
        isAdminUser()
    );
    await refreshSupportChat();
    window.clearInterval(supportChatRefreshTimer);
    supportChatRefreshTimer = window.setInterval(refreshSupportChat, 5000);
    document.getElementById('support-chat-input').focus();
}

function closeSupportChat() {
    document.getElementById('support-chat-modal').style.display = 'none';
    window.clearInterval(supportChatRefreshTimer);
    supportChatRefreshTimer = null;
    activeSupportChatUserId = null;
    activeSupportChatName = null;
    knownSupportMessageIds = null;
}

function setSupportChatPeer(name, status, isAdmin) {
    document.getElementById('support-chat-peer-name').textContent = name;
    document.getElementById('support-chat-peer-status').textContent = status;
    const avatar = document.querySelector('.support-chat-peer-avatar');
    avatar.classList.toggle('admin-peer-avatar', isAdmin);
    avatar.textContent = isAdmin ? String(name || 'U').trim().charAt(0).toUpperCase() : '';
    document.getElementById('support-chat-peer').classList.toggle('peer-selected', Boolean(name && !name.includes('Выберите')));
}

async function refreshSupportUnreadCount() {
    const user = Auth.getUser();
    if (!user) return;
    try {
        let unreadCount = 0;
        if (isAdminUser()) {
            const chats = await API.getAdminChats();
            unreadCount = chats.reduce((total, chat) => total + Number(chat.unread_count || 0), 0);
        } else {
            const result = await API.getUserChatUnreadCount();
            unreadCount = Number(result.count) || 0;
        }
        const badge = document.getElementById('chat-unread-count');
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.style.display = unreadCount ? 'inline-flex' : 'none';
        if (knownSupportUnreadCount !== null && unreadCount > knownSupportUnreadCount) {
            showNotificationToast({
                title: isAdminUser() ? 'Новое сообщение в чате поддержки' : 'Ответ от администратора',
                message: 'Откройте чат, чтобы прочитать новое сообщение.'
            });
        }
        knownSupportUnreadCount = unreadCount;
    } catch (error) {
        console.error('Не удалось обновить счётчик чата поддержки:', error);
    }
}

async function refreshSupportChat() {
    if (document.getElementById('support-chat-modal').style.display === 'none') return;
    const messageContainer = document.getElementById('support-chat-messages');
    try {
        if (isAdminUser()) {
            const chats = await API.getAdminChats();
            renderSupportChatUsers(chats);
            document.getElementById('chat-thread-count').textContent = String(chats.length);
            const unreadTotal = chats.reduce((total, chat) => total + Number(chat.unread_count || 0), 0);
            const unreadBadge = document.getElementById('chat-unread-count');
            unreadBadge.textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
            unreadBadge.style.display = unreadTotal ? 'inline-flex' : 'none';
            knownSupportUnreadCount = unreadTotal;

            if (!activeSupportChatUserId && chats.length) {
                activeSupportChatUserId = String(chats[0].user_id);
                activeSupportChatName = chats[0].username;
                knownSupportMessageIds = null;
                renderSupportChatUsers(chats);
            }
            if (!activeSupportChatUserId) {
                setSupportChatPeer('Выберите диалог', 'Новые обращения появятся здесь', true);
                document.getElementById('support-chat-input').disabled = true;
                document.getElementById('support-chat-send').disabled = true;
                document.getElementById('support-chat-workflow').hidden = true;
                renderSupportChatMessages([], null);
                return;
            }
            const activeChat = chats.find(chat => String(chat.user_id) === activeSupportChatUserId);
            if (!activeChat) {
                activeSupportChatUserId = null;
                activeSupportChatName = null;
                knownSupportMessageIds = null;
                setSupportChatPeer('Выберите диалог', 'Новые обращения появятся здесь', true);
                document.getElementById('support-chat-workflow').hidden = true;
                renderSupportChatMessages([], null);
                return;
            }
            activeSupportChatName = activeChat.username;
            setSupportChatPeer(activeChat.username, 'Обращение пользователя', true);
            const restriction = activeChat.restriction_id ? {
                id: activeChat.restriction_id,
                reason_code: activeChat.restriction_reason,
                reason_details: activeChat.restriction_details,
                expires_at: activeChat.restriction_expires_at
            } : null;
            renderSupportChatWorkflow({
                user_resolved_at: activeChat.user_resolved_at,
                admin_resolved_at: activeChat.admin_resolved_at,
                closed_at: activeChat.closed_at,
                restriction
            }, true);
            updateSupportChatComposer(Boolean(activeChat.closed_at), null, true);
            const messages = await API.getAdminChatMessages(activeSupportChatUserId);
            renderSupportChatMessages(messages, activeSupportChatUserId);
        } else {
            setSupportChatPeer('Команда поддержки', 'Обычно отвечаем быстро', false);
            const [messages, state] = await Promise.all([
                API.getUserChatMessages(),
                API.getUserChatStatus()
            ]);
            renderSupportChatWorkflow(state, false);
            updateSupportChatComposer(Boolean(state.closed_at), state.restriction, false);
            renderSupportChatMessages(messages, null);
        }
    } catch (error) {
        messageContainer.textContent = `Не удалось загрузить чат: ${error.message}`;
        console.error('Не удалось обновить чат поддержки:', error);
    }
}

function renderSupportChatWorkflow(state, isAdmin) {
    const workflow = document.getElementById('support-chat-workflow');
    workflow.hidden = false;
    const userResolved = Boolean(state.user_resolved_at);
    const adminResolved = Boolean(state.admin_resolved_at);
    const closed = Boolean(state.closed_at);
    const ownResolved = isAdmin ? adminResolved : userResolved;
    const title = document.getElementById('support-chat-resolution-title');
    const description = document.getElementById('support-chat-resolution-description');

    if (closed) {
        title.textContent = 'Вопрос закрыт с обеих сторон';
        description.textContent = 'Если вопрос снова актуален, любая сторона может возобновить обращение.';
    } else if (isAdmin ? adminResolved : userResolved) {
        title.textContent = 'Ваше подтверждение получено';
        description.textContent = isAdmin
            ? 'Ожидаем, пока пользователь подтвердит решение.'
            : 'Ожидаем, пока администратор подтвердит решение.';
    } else if (isAdmin ? userResolved : adminResolved) {
        title.textContent = isAdmin
            ? 'Пользователь считает вопрос решённым'
            : 'Администратор считает вопрос решённым';
        description.textContent = 'Подтвердите закрытие или продолжите переписку.';
    } else {
        title.textContent = 'Обращение открыто';
        description.textContent = 'Когда вопрос будет решён, обе стороны подтвердят закрытие.';
    }

    const userStatus = document.getElementById('support-chat-user-confirmation');
    userStatus.textContent = `Пользователь: ${userResolved ? 'подтвердил' : 'ожидается'}`;
    userStatus.classList.toggle('confirmed', userResolved);
    const adminStatus = document.getElementById('support-chat-admin-confirmation');
    adminStatus.textContent = `Администратор: ${adminResolved ? 'подтвердил' : 'ожидается'}`;
    adminStatus.classList.toggle('confirmed', adminResolved);

    const button = document.getElementById('support-chat-resolution-button');
    button.dataset.resolved = String(!ownResolved);
    button.textContent = closed || ownResolved
        ? 'Возобновить обращение'
        : (isAdmin && userResolved ? 'Подтвердить решение' : 'Вопрос решён');
    button.classList.toggle('reopen', closed || ownResolved);

    const restrictionBanner = document.getElementById('support-chat-restriction-banner');
    const restriction = state.restriction;
    restrictionBanner.hidden = !restriction;
    restrictionBanner.replaceChildren();
    if (restriction) {
        const titleNode = document.createElement('strong');
        titleNode.textContent = 'Ограничение активно';
        const reasonNode = document.createElement('span');
        const reason = restrictionReasonLabels[restriction.reason_code] || 'Нарушение правил';
        const duration = restriction.expires_at
            ? `до ${formatRestrictionDate(restriction.expires_at)}`
            : 'бессрочно';
        reasonNode.textContent = `${reason}${restriction.reason_details ? `: ${restriction.reason_details}` : ''} · ${duration}. Заблокированы чат и новые заявки на турниры.`;
        restrictionBanner.append(titleNode, reasonNode);
    }

    const sanctionPanel = document.getElementById('support-chat-sanction-panel');
    sanctionPanel.hidden = !isAdmin;
    document.getElementById('support-chat-sanction-remove').hidden = !restriction;
}

function updateSupportChatComposer(closed, restriction, isAdmin) {
    const blockedForUser = !isAdmin && Boolean(restriction);
    const disabled = closed || blockedForUser;
    document.getElementById('support-chat-input').disabled = disabled;
    document.getElementById('support-chat-send').disabled = disabled;
    const hint = document.querySelector('.support-chat-hint');
    if (blockedForUser) {
        hint.textContent = 'Отправка сообщений и новые заявки заблокированы действующим ограничением.';
    } else if (closed) {
        hint.textContent = 'Обращение закрыто. Возобновите его, если вопрос снова актуален.';
    } else {
        hint.innerHTML = 'Enter — отправить <span>·</span> Shift + Enter — новая строка';
    }
}

function formatRestrictionDate(value) {
    const timestamp = String(value);
    const date = new Date(timestamp.replace(' ', 'T') + (timestamp.endsWith('Z') ? '' : 'Z'));
    return Number.isNaN(date.getTime())
        ? timestamp
        : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function handleSupportChatResolution() {
    const resolved = document.getElementById('support-chat-resolution-button').dataset.resolved === 'true';
    try {
        if (isAdminUser()) {
            if (!activeSupportChatUserId) return;
            await API.setAdminChatResolved(activeSupportChatUserId, resolved);
        } else {
            await API.setUserChatResolved(resolved);
        }
        await refreshSupportChat();
    } catch (error) {
        alert(`Не удалось обновить статус обращения: ${error.message}`);
    }
}

function updateSanctionDurationField() {
    const permanent = document.getElementById('support-chat-sanction-permanent').checked;
    const days = document.getElementById('support-chat-sanction-days');
    days.disabled = permanent;
    days.required = !permanent;
}

function updateSanctionReasonField() {
    const reason = document.getElementById('support-chat-sanction-reason').value;
    const details = document.getElementById('support-chat-sanction-details');
    details.required = reason === 'other';
    details.placeholder = reason === 'other' ? 'Укажите причину (обязательно)' : 'Уточнение причины (необязательно)';
}

async function handleSupportChatSanction(event) {
    event.preventDefault();
    if (!activeSupportChatUserId) return;
    const reasonCode = document.getElementById('support-chat-sanction-reason').value;
    const details = document.getElementById('support-chat-sanction-details').value.trim();
    const permanent = document.getElementById('support-chat-sanction-permanent').checked;
    const durationDays = permanent ? null : Number(document.getElementById('support-chat-sanction-days').value);
    const durationLabel = permanent ? 'бессрочно' : `на ${durationDays} дн.`;
    const reasonLabel = restrictionReasonLabels[reasonCode] || 'Другое';
    if (!confirm(`Применить ограничение «${reasonLabel}» ${durationLabel}? Пользователь не сможет писать в чат и подавать новые заявки. Уже одобренные команды не изменятся.`)) return;

    const submit = document.getElementById('support-chat-sanction-submit');
    submit.disabled = true;
    try {
        const result = await API.restrictChatUser(activeSupportChatUserId, {
            reasonCode,
            reasonDetails: details,
            durationDays
        });
        alert(result.message);
        await refreshSupportChat();
    } catch (error) {
        alert(`Не удалось применить ограничение: ${error.message}`);
    } finally {
        submit.disabled = false;
    }
}

async function liftSupportChatSanction() {
    if (!activeSupportChatUserId || !confirm(`Снять ограничение с пользователя ${activeSupportChatName}?`)) return;
    try {
        const result = await API.liftChatUserRestriction(activeSupportChatUserId);
        alert(result.message);
        await refreshSupportChat();
    } catch (error) {
        alert(`Не удалось снять ограничение: ${error.message}`);
    }
}

function renderSupportChatUsers(chats) {
    const users = document.getElementById('support-chat-users');
    if (!chats.length) {
        const empty = document.createElement('p');
        empty.className = 'chat-sidebar-empty';
        empty.textContent = 'Пока нет обращений. Новые сообщения пользователей появятся здесь.';
        users.replaceChildren(empty);
        return;
    }

    const buttons = chats.map(chat => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `support-chat-user${String(chat.user_id) === activeSupportChatUserId ? ' active' : ''}`;
        button.addEventListener('click', () => {
            activeSupportChatUserId = String(chat.user_id);
            activeSupportChatName = chat.username;
            knownSupportMessageIds = null;
            refreshSupportChat();
        });
        const name = document.createElement('strong');
        name.textContent = chat.username;
        const preview = document.createElement('span');
        preview.textContent = chat.restriction_id
            ? 'Активно ограничение'
            : chat.closed_at
                ? 'Обращение закрыто'
                : chat.last_message || 'Сообщений пока нет';
        const avatar = document.createElement('span');
        avatar.className = 'support-chat-user-avatar';
        avatar.textContent = String(chat.username || '?').trim().charAt(0).toUpperCase();
        const copy = document.createElement('span');
        copy.className = 'support-chat-user-copy';
        copy.append(name, preview);
        button.append(avatar, copy);
        if (Number(chat.unread_count)) {
            const count = document.createElement('span');
            count.className = 'chat-unread';
            count.textContent = chat.unread_count > 99 ? '99+' : String(chat.unread_count);
            button.append(count);
        }
        return button;
    });
    users.replaceChildren(...buttons);
}

function renderSupportChatMessages(messages, chatUserId) {
    const container = document.getElementById('support-chat-messages');
    const currentUser = Auth.getUser();
    const isAdmin = isAdminUser();
    if (!messages.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-welcome';
        const icon = document.createElement('span');
        icon.className = 'chat-welcome-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = isAdmin ? '↗' : '?';
        const heading = document.createElement('strong');
        heading.textContent = isAdmin
            ? 'Диалог только начинается'
            : 'Чем можем помочь?';
        const description = document.createElement('p');
        description.textContent = isAdmin
            ? `Ответьте пользователю ${activeSupportChatName || ''} — ваше сообщение появится в его личном чате.`
            : 'Опишите вопрос в сообщении ниже. Ответ администратора появится здесь же.';
        empty.append(icon, heading, description);
        container.replaceChildren(empty);
        knownSupportMessageIds = new Set();
        return;
    }

    const currentIds = new Set(messages.map(message => String(message.id)));
    if (knownSupportMessageIds) {
        messages.filter(message =>
            !knownSupportMessageIds.has(String(message.id))
            && String(message.sender_id) !== String(currentUser.id)
        ).forEach(message => {
            showNotificationToast({
                title: isAdmin ? `Сообщение от ${message.sender_name}` : 'Ответ от администратора',
                message: message.message
            });
        });
    }
    knownSupportMessageIds = currentIds;

    const nodes = messages.map(message => {
        const ownMessage = String(message.sender_id) === String(currentUser.id);
        const item = document.createElement('article');
        item.className = `support-message${ownMessage ? ' own' : ''}`;
        const meta = document.createElement('div');
        meta.className = 'support-message-meta';
        const sender = document.createElement('strong');
        sender.textContent = ownMessage ? (isAdmin ? 'Администратор' : 'Вы') : message.sender_name;
        const date = document.createElement('time');
        const parsed = new Date(String(message.created_at).replace(' ', 'T') + (String(message.created_at).endsWith('Z') ? '' : 'Z'));
        date.textContent = Number.isNaN(parsed.getTime())
            ? ''
            : new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(parsed);
        meta.append(sender, date);
        const text = document.createElement('p');
        text.textContent = message.message;
        item.append(meta, text);
        return item;
    });
    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    const previousMessageCount = container.querySelectorAll('.support-message').length;
    container.replaceChildren(...nodes);
    if (wasAtBottom || nodes.length > previousMessageCount) container.scrollTop = container.scrollHeight;
    if (chatUserId) document.getElementById('support-chat-input').placeholder = 'Ответить пользователю…';
    else document.getElementById('support-chat-input').placeholder = 'Напишите сообщение…';
}

async function handleSupportChatSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('support-chat-input');
    const message = input.value.trim();
    if (!message) return;
    if (isAdminUser() && !activeSupportChatUserId) {
        alert('Сначала выберите переписку пользователя.');
        return;
    }

    const sendButton = document.getElementById('support-chat-send');
    sendButton.disabled = true;
    try {
        if (isAdminUser()) await API.sendAdminChatMessage(activeSupportChatUserId, message);
        else await API.sendUserChatMessage(message);
        input.value = '';
        knownSupportMessageIds = knownSupportMessageIds || new Set();
        await refreshSupportChat();
    } catch (error) {
        alert(`Не удалось отправить сообщение: ${error.message}`);
    } finally {
        sendButton.disabled = false;
        input.focus();
    }
}

async function loadAdminAcceptedTeams() {
    const container = document.getElementById('admin-accepted-teams-list');
    try {
        const teams = await API.getAcceptedTeams();
        const canManageRegistry = currentAdminLevel() >= 3;
        const canAddToBracket = currentAdminLevel() >= 2;
        const clearButton = document.getElementById('clear-accepted-teams');
        clearButton.hidden = !canManageRegistry;
        clearButton.disabled = teams.length === 0 || !canManageRegistry;
        if (!teams.length) {
            container.innerHTML = '<p>Одобренных команд пока нет.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-table';
        const header = table.insertRow();
        ['Команда', 'Турнир', 'Игра', 'Состав', 'Принята', 'Сетка'].forEach(label => {
            const cell = document.createElement('th');
            cell.textContent = label;
            header.append(cell);
        });

        teams.forEach(team => {
            const row = table.insertRow();
            const teamCell = row.insertCell();
            const teamName = document.createElement('strong');
            teamName.textContent = team.team_name;
            const contact = document.createElement('small');
            contact.textContent = team.captain_contact;
            teamCell.append(teamName, document.createElement('br'), contact);
            row.insertCell().textContent = team.tournament_name;
            row.insertCell().textContent = team.game || '—';
            row.insertCell().textContent = team.roster;
            row.insertCell().textContent = new Intl.DateTimeFormat('ru-RU', {
                dateStyle: 'short'
            }).format(new Date(`${team.accepted_at}${team.accepted_at.includes('Z') ? '' : 'Z'}`));

            const actionCell = row.insertCell();
            if (team.bracket_added_at) {
                const addedLabel = document.createElement('span');
                addedLabel.className = 'badge status-approved';
                addedLabel.textContent = 'Добавлена';
                actionCell.append(addedLabel);
            } else if (team.tournament_status !== 'upcoming') {
                const startedLabel = document.createElement('span');
                startedLabel.textContent = 'Турнир уже начался';
                actionCell.append(startedLabel);
            } else if (canAddToBracket) {
                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.className = 'btn-ai-small';
                addButton.textContent = 'Добавить в сетку';
                addButton.addEventListener('click', () => addAcceptedTeamToBracket(team.application_id));
                actionCell.append(addButton);
            } else {
                actionCell.textContent = 'Только просмотр';
            }

            if (canManageRegistry) {
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'action-btn-small registry-remove-button';
                removeButton.textContent = 'Убрать';
                removeButton.addEventListener('click', () => removeAcceptedTeamFromRegistry(team.application_id));
                actionCell.append(removeButton);
            }
        });
        container.replaceChildren(table);
    } catch (error) {
        container.textContent = `Не удалось загрузить реестр принятых команд: ${error.message}`;
        console.error('Ошибка загрузки реестра принятых команд:', error);
        document.getElementById('clear-accepted-teams').disabled = true;
    }
}

async function removeAcceptedTeamFromRegistry(applicationId) {
    if (!confirm('Убрать команду из реестра? Заявка и сетка останутся без изменений.')) return;
    try {
        const result = await API.removeAcceptedTeam(applicationId);
        alert(result.message);
        await loadAdminAcceptedTeams();
    } catch (error) {
        alert(`Не удалось убрать команду из реестра: ${error.message}`);
    }
}

async function clearAcceptedTeamRegistry() {
    if (!confirm('Очистить реестр принятых команд? История заявок и уже созданная сетка сохранятся.')) return;
    try {
        const result = await API.clearAcceptedTeams();
        alert(result.message);
        await loadAdminAcceptedTeams();
    } catch (error) {
        alert(`Не удалось очистить реестр: ${error.message}`);
    }
}

async function addAcceptedTeamToBracket(applicationId) {
    try {
        const result = await API.addAcceptedTeamToBracket(applicationId);
        alert(result.message);
        await loadAdminAcceptedTeams();
    } catch (error) {
        alert(`Не удалось добавить команду в сетку: ${error.message}`);
    }
}

async function loadAdminUsers() {
    const container = document.getElementById('admin-users-list');
    container.textContent = 'Загрузка пользователей…';
    try {
        const users = await API.getUsers();
        const table = document.createElement('table');
        table.className = 'admin-table';
        const header = table.insertRow();
        ['ID', 'Имя', 'Роль', 'Ограничение', 'Действия'].forEach(label => {
            const cell = document.createElement('th');
            cell.textContent = label;
            header.append(cell);
        });

        users.forEach(user => {
            const row = table.insertRow();
            const role = user.role || 'ROLE_USER';
            row.dataset.search = [
                user.id,
                user.username,
                adminRoleLabels[role] || role,
                role,
                user.restriction_reason ? restrictionReasonLabels[user.restriction_reason] : '',
                user.restriction_details || ''
            ].join(' ').toLocaleLowerCase('ru-RU');
            row.insertCell().textContent = user.id;
            row.insertCell().textContent = user.username;

            const roleCell = row.insertCell();
            const roleBadge = document.createElement('span');
            roleBadge.className = `badge ${role}`;
            roleBadge.textContent = adminRoleLabels[role] || role;
            roleCell.append(roleBadge);

            const actorLevel = currentAdminLevel();
            const targetLevel = adminRoleLevels[role] || (role === 'ROLE_ADMIN' ? 3 : 0);
            const protectedUser = user.username === 'admin'
                || role === 'ROLE_SUPER_ADMIN'
                || Number(user.id) === Number(Auth.getUser().id)
                || targetLevel >= actorLevel;
            const restrictionCell = row.insertCell();
            if (user.restriction_id) {
                const reason = document.createElement('span');
                reason.className = 'badge restriction-active-badge';
                reason.textContent = restrictionReasonLabels[user.restriction_reason] || 'Ограничение';
                const duration = document.createElement('small');
                duration.className = 'admin-user-restriction-details';
                duration.textContent = user.restriction_expires_at
                    ? `До ${formatRestrictionDate(user.restriction_expires_at)}`
                    : 'Бессрочно';
                restrictionCell.append(reason, document.createElement('br'), duration);
                if (user.restriction_details) {
                    const details = document.createElement('small');
                    details.className = 'admin-user-restriction-details';
                    details.textContent = user.restriction_details;
                    restrictionCell.append(document.createElement('br'), details);
                }
            } else {
                restrictionCell.textContent = 'Нет';
            }

            const actionCell = row.insertCell();
            const allowedRoles = [
                ['ROLE_USER', 0],
                ['ROLE_ADMIN_JUNIOR', 1],
                ['ROLE_ADMIN_MIDDLE', 2],
                ['ROLE_ADMIN_SENIOR', 3]
            ].filter(([, level]) => level < actorLevel);
            if (protectedUser) {
                actionCell.textContent = user.username === 'admin'
                    ? 'Защищённая системная учётная запись'
                    : 'Нет прав для изменения';
            } else {
                const roleSelect = document.createElement('select');
                roleSelect.setAttribute('aria-label', `Новая роль для ${user.username}`);
                allowedRoles.forEach(([value]) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = adminRoleLabels[value];
                    option.selected = value === role;
                    roleSelect.append(option);
                });
                const roleButton = document.createElement('button');
                roleButton.type = 'button';
                roleButton.className = 'btn-ai-small';
                roleButton.textContent = 'Изменить роль';
                roleButton.addEventListener('click', () => changeUserRole(user, roleSelect.value));
                actionCell.append(roleSelect, roleButton);
            }

            if (!protectedUser && actorLevel >= 2) {
                const restrictionActions = document.createElement('div');
                restrictionActions.className = 'admin-user-restriction-actions';
                if (user.restriction_id) {
                    const liftButton = document.createElement('button');
                    liftButton.type = 'button';
                    liftButton.className = 'support-chat-sanction-remove';
                    liftButton.textContent = 'Снять ограничение';
                    liftButton.addEventListener('click', () => liftUserRestriction(user));
                    restrictionActions.append(liftButton);
                } else {
                    const details = document.createElement('details');
                    details.className = 'admin-user-restriction-form';
                    const summary = document.createElement('summary');
                    summary.textContent = 'Выдать ограничение';
                    const form = document.createElement('form');
                    form.className = 'admin-user-restriction-fields';
                    const reasonLabel = document.createElement('label');
                    reasonLabel.textContent = 'Причина';
                    const reasonSelect = document.createElement('select');
                    reasonSelect.required = true;
                    Object.entries(restrictionReasonLabels).forEach(([value, label]) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = label;
                        reasonSelect.append(option);
                    });
                    reasonLabel.append(reasonSelect);
                    const descriptionLabel = document.createElement('label');
                    descriptionLabel.textContent = 'Подробности';
                    const descriptionInput = document.createElement('input');
                    descriptionInput.type = 'text';
                    descriptionInput.maxLength = 500;
                    descriptionInput.placeholder = 'Уточнение причины';
                    descriptionLabel.append(descriptionInput);
                    const durationLabel = document.createElement('label');
                    durationLabel.textContent = 'Срок, дней';
                    const durationInput = document.createElement('input');
                    durationInput.type = 'number';
                    durationInput.min = '1';
                    durationInput.max = '36500';
                    durationInput.value = '7';
                    durationInput.required = true;
                    durationLabel.append(durationInput);
                    const permanentLabel = document.createElement('label');
                    permanentLabel.className = 'admin-user-permanent-option';
                    const permanentInput = document.createElement('input');
                    permanentInput.type = 'checkbox';
                    permanentLabel.append(permanentInput, document.createTextNode('Бессрочно'));
                    permanentInput.addEventListener('change', () => {
                        durationInput.disabled = permanentInput.checked;
                        durationInput.required = !permanentInput.checked;
                    });
                    reasonSelect.addEventListener('change', () => {
                        descriptionInput.required = reasonSelect.value === 'other';
                    });
                    const submitButton = document.createElement('button');
                    submitButton.type = 'submit';
                    submitButton.className = 'support-chat-sanction-apply';
                    submitButton.textContent = 'Применить';
                    form.append(reasonLabel, descriptionLabel, durationLabel, permanentLabel, submitButton);
                    form.addEventListener('submit', event => applyUserRestrictionFromAdmin(
                        event,
                        user,
                        reasonSelect,
                        descriptionInput,
                        durationInput,
                        permanentInput,
                        submitButton
                    ));
                    details.append(summary, form);
                    restrictionActions.append(details);
                }
                actionCell.append(restrictionActions);
            }
        });
        container.replaceChildren(table);
        filterAdminUsers();
    } catch (error) {
        container.textContent = `Ошибка загрузки пользователей: ${error.message}`;
        console.error('Не удалось загрузить пользователей в админке:', error);
    }
}

function filterAdminUsers() {
    const input = document.getElementById('admin-user-search-input');
    const container = document.getElementById('admin-users-list');
    const count = document.getElementById('admin-user-search-count');
    if (!input || !container || !count) return;
    const query = input.value.trim().toLocaleLowerCase('ru-RU');
    const rows = [...container.querySelectorAll('tr[data-search]')];
    let visible = 0;
    rows.forEach(row => {
        const matches = row.dataset.search.includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
    });
    count.textContent = `Показано ${visible} из ${rows.length}`;
}

async function applyUserRestrictionFromAdmin(event, user, reasonSelect, descriptionInput, durationInput, permanentInput, submitButton) {
    event.preventDefault();
    const reasonCode = reasonSelect.value;
    const reasonDetails = descriptionInput.value.trim();
    const durationDays = permanentInput.checked ? null : Number(durationInput.value);
    if (reasonCode === 'other' && !reasonDetails) {
        alert('Укажите причину для варианта «Другое».');
        return;
    }
    if (durationDays !== null && (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 36500)) {
        alert('Срок ограничения должен быть от 1 до 36500 дней либо бессрочным.');
        return;
    }
    const durationLabel = durationDays === null ? 'бессрочно' : `на ${durationDays} дн.`;
    if (!confirm(`Применить ограничение «${restrictionReasonLabels[reasonCode]}» к пользователю «${user.username}» ${durationLabel}? Будут заблокированы чат и новые заявки на турниры.`)) {
        return;
    }
    submitButton.disabled = true;
    try {
        const result = await API.restrictUser(user.id, { reasonCode, reasonDetails, durationDays });
        await loadAdminUsers();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось применить ограничение: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
}

async function liftUserRestriction(user) {
    if (!confirm(`Снять ограничение с пользователя «${user.username}»?`)) return;
    try {
        const result = await API.liftUserRestriction(user.id);
        await loadAdminUsers();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось снять ограничение: ${error.message}`);
    }
}

const adminAuditActionLabels = {
    user_restricted: 'Применено ограничение',
    user_restriction_lifted: 'Ограничение снято',
    chat_marked_resolved: 'Администратор отметил обращение решённым',
    chat_reopened: 'Обращение возобновлено',
    admin_chat_reply_sent: 'Отправлен ответ в поддержку',
    user_role_changed: 'Изменена роль пользователя',
    user_deleted: 'Удалён пользователь',
    application_reviewed: 'Рассмотрена заявка',
    tournament_created: 'Создан турнир',
    tournament_updated: 'Изменён турнир или сетка',
    tournament_deleted: 'Удалён турнир',
    accepted_team_removed_from_registry: 'Команда удалена из реестра',
    accepted_registry_cleared: 'Реестр принятых команд очищен',
    accepted_team_added_to_bracket: 'Команда добавлена в сетку',
    team_leaderboard_cleared: 'Топ команд очищен'
};

function formatAdminAuditDetails(log) {
    let details = {};
    try {
        details = typeof log.details_json === 'string' ? JSON.parse(log.details_json) : (log.details_json || {});
    } catch (error) {
        console.error('Некорректные данные в записи журнала:', error);
        return 'Не удалось прочитать детали записи';
    }

    const values = [];
    const reasonLabels = {
        unsporting: 'Неспортивное поведение',
        harassment: 'Оскорбления или травля',
        spam: 'Спам',
        rule_violation: 'Нарушение правил',
        other: 'Другое'
    };
    const add = (label, value) => {
        if (value !== undefined && value !== null && value !== '') values.push(`${label}: ${value}`);
    };
    add('Причина', reasonLabels[details.reasonCode] || details.reasonCode);
    add('Комментарий', details.reasonDetails);
    add('Срок', details.durationDays === null && log.action === 'user_restricted' ? 'бессрочно' : details.durationDays ? `${details.durationDays} дн.` : undefined);
    add('Истекает', details.expiresAt);
    add('Снятая роль', details.previousRole);
    add('Новая роль', details.newRole);
    add('Заявка', details.applicationId);
    add('Турнир', details.tournamentName || details.name || details.tournamentId);
    add('Команда', details.teamName);
    add('Пользователь', details.username);
    if (details.status) add('Статус', details.status === 'approved' ? 'одобрена' : details.status === 'rejected' ? 'отклонена' : details.status);
    add('ID сообщения', details.messageId);
    add('Изменено полей', Array.isArray(details.changedFields) ? details.changedFields.join(', ') : undefined);
    add('Убрано команд', details.removedCount);
    add('Сброшено результатов', details.clearedMatchResults);
    add('Подтверждение пользователя', details.userConfirmed ? 'да' : details.userConfirmed === false ? 'нет' : undefined);
    add('Подтверждение администратора', details.adminConfirmed ? 'да' : details.adminConfirmed === false ? 'нет' : undefined);
    return values.join(' · ') || '—';
}

async function loadAdminAuditLogs() {
    const container = document.getElementById('admin-audit-logs-list');
    const user = Auth.getUser();
    if (!user || currentAdminLevel() < 3) {
        container.textContent = 'Журнал доступен старшему и главному администраторам.';
        return;
    }

    container.textContent = 'Загрузка журнала действий…';
    try {
        const logs = await API.getAdminAuditLogs();
        if (!Array.isArray(logs)) throw new Error('Сервер вернул некорректный формат журнала');
        if (!logs.length) {
            container.textContent = 'Записей пока нет.';
            return;
        }

        const table = document.createElement('table');
        table.className = 'admin-table';
        const header = table.insertRow();
        ['Дата и время', 'Администратор', 'Пользователь', 'Действие', 'Детали'].forEach(label => {
            const cell = document.createElement('th');
            cell.textContent = label;
            header.append(cell);
        });

        logs.forEach(log => {
            const row = table.insertRow();
            const date = new Date(log.created_at);
            row.insertCell().textContent = Number.isNaN(date.getTime()) ? String(log.created_at || '—') : date.toLocaleString('ru-RU');
            row.insertCell().textContent = log.admin_name || 'Неизвестно';
            row.insertCell().textContent = log.target_username || '—';
            row.insertCell().textContent = adminAuditActionLabels[log.action] || log.action || 'Неизвестное действие';
            row.insertCell().textContent = formatAdminAuditDetails(log);
        });
        container.replaceChildren(table);
    } catch (error) {
        container.textContent = `Не удалось загрузить журнал действий: ${error.message}`;
        console.error('Не удалось загрузить журнал действий:', error);
    }
}

async function changeUserRole(user, role) {
    if (!confirm(`Изменить роль пользователя «${user.username}» на «${adminRoleLabels[role] || role}»?`)) return;

    try {
        const result = await API.updateUserRole(user.id, role);
        await loadAdminUsers();
        alert(result.message);
    } catch (error) {
        alert(`Не удалось изменить роль пользователя: ${error.message}`);
    }
}