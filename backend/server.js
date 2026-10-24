const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

function prepareRuntimePaths() {
    if (!process.pkg) {
        process.env.DATABASE_PATH ||= path.join(__dirname, 'database.db');
        process.env.FRONTEND_PATH ||= path.join(__dirname, '../frontend');
        return;
    }

    const runtimeRoot = path.join(os.homedir(), 'AppData', 'Local', 'CyberBracket');
    fs.mkdirSync(runtimeRoot, { recursive: true });

    const databaseSource = path.join(__dirname, 'database.db');
    const databaseTarget = path.join(runtimeRoot, 'database.db');
    if (!fs.existsSync(databaseTarget)) {
        fs.copyFileSync(databaseSource, databaseTarget);
    }
    process.env.DATABASE_PATH = databaseTarget;

    const frontendTarget = path.join(path.dirname(process.execPath), 'frontend');
    if (!fs.existsSync(frontendTarget)) {
        throw new Error(`Не найдена папка frontend рядом с приложением: ${frontendTarget}`);
    }
    process.env.FRONTEND_PATH = frontendTarget;
}

prepareRuntimePaths();
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_cyber_key_2026';
const TOURNAMENT_STATUSES = new Set(['upcoming', 'live', 'completed']);
const PRIZE_CURRENCIES = new Set(['USD', 'EUR', 'RUB', 'KZT']);
const ADMIN_ROLE_LEVELS = new Map([
    ['ROLE_ADMIN', 3],
    ['ROLE_ADMIN_JUNIOR', 1],
    ['ROLE_ADMIN_MIDDLE', 2],
    ['ROLE_ADMIN_SENIOR', 3],
    ['ROLE_SUPER_ADMIN', 4]
]);
const isAdminRole = (role) => ADMIN_ROLE_LEVELS.has(role);
const USER_AGREEMENT_VERSION = '2026-10-09';
const PRIVACY_POLICY_VERSION = '2026-10-09';
const PROFILE_IMAGE_LIMITS = {
    avatar: 512 * 1024,
    cover: 1536 * 1024,
    team: 512 * 1024
};
const AVATAR_FRAME_COLORS = new Set(['#00f0ff', '#b693ff', '#ff5f7e', '#ffd36f', '#ffffff']);
const AVATAR_FRAME_STYLES = new Set(['neon', 'double', 'solid']);

function isValidImageData(value, maxBytes) {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return false;
    const encoded = match[2];
    const image = Buffer.from(encoded, 'base64');
    return image.length > 0
        && image.length <= maxBytes
        && image.toString('base64') === encoded;
}

function normalizeTeamKey(teamName) {
    return teamName.trim().toLocaleLowerCase('ru-RU');
}

function parseRosterNames(roster) {
    if (typeof roster !== 'string') return [];
    const seen = new Set();
    return roster.split(/[\n,;]+/)
        .map(name => name.trim())
        .filter(name => {
            if (!name) return false;
            const key = name.toLocaleLowerCase('ru-RU');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const frontendRoot = process.env.FRONTEND_PATH || path.join(__dirname, '../frontend');

// Явная раздача статики и ресурсов (CSS, JS)
app.use(express.static(frontendRoot));
app.use('/css', express.static(path.join(frontendRoot, 'css')));
app.use('/js', express.static(path.join(frontendRoot, 'js')));

// Middleware для проверки JWT токена
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'Авторизация требуется' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await db.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ message: 'Учётная запись не найдена' });
        if (user.username === 'admin' && user.role !== 'ROLE_SUPER_ADMIN') {
            await db.query("UPDATE users SET role = 'ROLE_SUPER_ADMIN' WHERE id = $1", [user.id]);
            user.role = 'ROLE_SUPER_ADMIN';
        } else if (user.role === 'ROLE_ADMIN') {
            await db.query("UPDATE users SET role = 'ROLE_ADMIN_SENIOR' WHERE id = $1", [user.id]);
            user.role = 'ROLE_ADMIN_SENIOR';
        }
        req.user = user;
        next();
    } catch (err) {
        if (err && err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError' && err.name !== 'NotBeforeError') {
            console.error('Ошибка проверки учётной записи:', err);
            return res.status(500).json({ message: 'Не удалось проверить права пользователя' });
        }
        return res.status(403).json({ message: 'Недействительный или истекший токен' });
    }
};

const requireAdminLevel = (minimumRole = 'ROLE_ADMIN_JUNIOR') => (req, res, next) => {
    const actualLevel = req.user ? (ADMIN_ROLE_LEVELS.get(req.user.role) || 0) : 0;
    const minimumLevel = ADMIN_ROLE_LEVELS.get(minimumRole);
    if (!actualLevel || actualLevel < minimumLevel) {
        return res.status(403).json({ message: 'Доступ запрещен. Требуются права администратора.' });
    }
    next();
};

const requireAdmin = requireAdminLevel('ROLE_ADMIN_JUNIOR');
const requireMiddleAdmin = requireAdminLevel('ROLE_ADMIN_MIDDLE');
const requireSeniorAdmin = requireAdminLevel('ROLE_ADMIN_SENIOR');

async function recordAdminAudit(adminId, action, targetUserId = null, details = {}) {
    await db.query(
        'INSERT INTO admin_audit_logs (admin_id, action, target_user_id, details_json) VALUES ($1, $2, $3, $4)',
        [adminId, action, targetUserId, JSON.stringify(details)]
    );
}

async function readBracketData(value, tournamentId) {
    try {
        const bracket = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(bracket) ? bracket : [];
    } catch (error) {
        console.error(`Некорректная сетка турнира ${tournamentId}:`, error);
        return [];
    }
}

function parseNonNegativeIndex(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function findLiveMatch(tournamentId, roundIndex, matchIndex) {
    const tournamentResult = await db.query(
        'SELECT id, status, bracket_data FROM tournaments WHERE id = $1',
        [tournamentId]
    );
    const tournament = tournamentResult.rows[0];
    if (!tournament) return { error: 'Турнир не найден', status: 404 };
    if (tournament.status !== 'live') return { error: 'Чат доступен только во время живого турнира', status: 409 };

    const bracket = await readBracketData(tournament.bracket_data, tournamentId);
    const round = bracket[roundIndex];
    const match = Array.isArray(round) ? round[matchIndex] : null;
    if (!match || typeof match !== 'object'
        || typeof match.team1 !== 'string' || typeof match.team2 !== 'string'
        || !match.team1.trim() || !match.team2.trim()
        || match.team1 === 'TBD' || match.team2 === 'TBD'
        || (match.winner !== null && match.winner !== undefined && match.winner !== '')) {
        return { error: 'Матч не найден или уже завершён', status: 409 };
    }
    return { tournament, match };
}

async function userBelongsToMatch(userId, match) {
    const result = await db.query(`
        SELECT t.name AS team_name
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = $1
    `, [userId]);
    const opponents = new Set([normalizeTeamKey(match.team1), normalizeTeamKey(match.team2)]);
    return result.rows.some(team => opponents.has(normalizeTeamKey(team.team_name)));
}

function validMatchWinner(match) {
    if (!match || typeof match !== 'object' || typeof match.winner !== 'string') return null;
    const winner = match.winner.trim();
    if (!winner || (winner !== match.team1 && winner !== match.team2)) return null;
    if (typeof match.team1 !== 'string' || typeof match.team2 !== 'string') return null;
    return { team1: match.team1, team2: match.team2, winner };
}

async function ensureLeaderboardSeeded() {
    const state = await db.query('SELECT seeded FROM leaderboard_meta WHERE id = 1');
    if (state.rows[0] && Number(state.rows[0].seeded) === 1) return;

    const tournaments = await db.query('SELECT id, bracket_data FROM tournaments');
    for (const tournament of tournaments.rows) {
        const bracket = await readBracketData(tournament.bracket_data, tournament.id);
        for (let roundIndex = 0; roundIndex < bracket.length; roundIndex += 1) {
            const round = bracket[roundIndex];
            if (!Array.isArray(round)) continue;
            for (let matchIndex = 0; matchIndex < round.length; matchIndex += 1) {
                const result = validMatchWinner(round[matchIndex]);
                if (!result) continue;
                await db.query(`
                    INSERT OR IGNORE INTO team_match_results
                        (tournament_id, round_index, match_index, team1, team2, winner)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [tournament.id, roundIndex, matchIndex, result.team1, result.team2, result.winner]);
            }
        }
    }
    await db.query('UPDATE leaderboard_meta SET seeded = 1 WHERE id = 1');
}

async function syncTeamMatchResults(tournamentId, previousValue, nextBracket) {
    const previousBracket = await readBracketData(previousValue, tournamentId);
    const maxRounds = Math.max(previousBracket.length, nextBracket.length);
    for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
        const previousRound = Array.isArray(previousBracket[roundIndex]) ? previousBracket[roundIndex] : [];
        const nextRound = Array.isArray(nextBracket[roundIndex]) ? nextBracket[roundIndex] : [];
        const maxMatches = Math.max(previousRound.length, nextRound.length);
        for (let matchIndex = 0; matchIndex < maxMatches; matchIndex += 1) {
            const previousResult = validMatchWinner(previousRound[matchIndex]);
            const nextResult = validMatchWinner(nextRound[matchIndex]);
            if (previousResult && nextResult &&
                previousResult.team1 === nextResult.team1 &&
                previousResult.team2 === nextResult.team2 &&
                previousResult.winner === nextResult.winner) continue;

            await db.query(`
                DELETE FROM team_match_results
                WHERE tournament_id = $1 AND round_index = $2 AND match_index = $3
            `, [tournamentId, roundIndex, matchIndex]);
            if (nextResult) {
                await db.query(`
                    INSERT INTO team_match_results
                        (tournament_id, round_index, match_index, team1, team2, winner)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [tournamentId, roundIndex, matchIndex, nextResult.team1, nextResult.team2, nextResult.winner]);
            }
        }
    }
}

// --- ГЛАВНАЯ СТРАНИЦА ---
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendRoot, 'index.html'));
});

// --- АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ ---

// Вход
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ message: 'Неверный логин или пароль' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ message: 'Неверный логин или пароль' });
        }
        if (user.username === 'admin' && user.role !== 'ROLE_SUPER_ADMIN') {
            await db.query("UPDATE users SET role = 'ROLE_SUPER_ADMIN' WHERE id = $1", [user.id]);
            user.role = 'ROLE_SUPER_ADMIN';
        } else if (user.role === 'ROLE_ADMIN') {
            await db.query("UPDATE users SET role = 'ROLE_ADMIN_SENIOR' WHERE id = $1", [user.id]);
            user.role = 'ROLE_ADMIN_SENIOR';
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, username: user.username, role: user.role });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ message: 'Ошибка сервера при входе' });
    }
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    const {
        username,
        password,
        agreementAccepted,
        privacyConsent,
        agreementVersion,
        privacyVersion
    } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Заполните все поля' });
    }
    if (agreementAccepted !== true || privacyConsent !== true) {
        return res.status(400).json({ message: 'Для регистрации примите пользовательское соглашение и дайте согласие на обработку персональных данных' });
    }
    if (agreementVersion !== USER_AGREEMENT_VERSION || privacyVersion !== PRIVACY_POLICY_VERSION) {
        return res.status(409).json({ message: 'Документы обновились. Обновите страницу и подтвердите актуальные версии' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = 'ROLE_USER';

        const insertResult = await db.query(
            'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
            [username, hashedPassword, role]
        );

        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [insertResult.lastID]);
        const user = userResult.rows[0];
        try {
            await db.query(`
                INSERT INTO user_policy_consents (user_id, agreement_version, privacy_version)
                VALUES ($1, $2, $3)
            `, [user.id, USER_AGREEMENT_VERSION, PRIVACY_POLICY_VERSION]);
        } catch (consentError) {
            try {
                await db.query('DELETE FROM users WHERE id = $1', [user.id]);
            } catch (cleanupError) {
                console.error('Не удалось отменить регистрацию после ошибки сохранения согласия:', cleanupError);
            }
            throw consentError;
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            token,
            username: user.username,
            role: user.role,
            message: 'Пользователь успешно зарегистрирован'
        });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT'
            && err.message.includes('UNIQUE constraint failed: users.username')) {
            return res.status(409).json({ message: 'Пользователь с таким именем уже существует. Войдите в аккаунт или выберите другое имя.' });
        }
        console.error('Ошибка регистрации:', err);
        res.status(500).json({ message: 'Ошибка сервера при регистрации' });
    }
});

app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        const [profileResult, teamResult, teamProfilesResult, ratingResult, tournamentCountResult] = await Promise.all([
            db.query('SELECT avatar_data, cover_data, avatar_frame_color, avatar_frame_style FROM user_profiles WHERE user_id = $1', [req.user.id]),
            db.query(`
                SELECT a.id, a.team_name, a.status, t.id AS tournament_id, t.name AS tournament_name,
                       r.round_index, r.match_index, r.team1, r.team2, r.winner
                FROM applications a
                JOIN tournaments t ON t.id = a.tournament_id
                LEFT JOIN team_match_results r
                    ON r.tournament_id = a.tournament_id AND a.status = 'approved'
                WHERE a.user_id = $1
                ORDER BY t.id DESC, a.id DESC
            `, [req.user.id]),
            db.query('SELECT team_key, avatar_data, is_hidden FROM team_profiles WHERE owner_user_id = $1', [req.user.id]),
            db.query(`
                SELECT a.user_id, u.username, a.team_name, r.tournament_id,
                       r.round_index, r.match_index, r.winner
                FROM applications a
                JOIN users u ON u.id = a.user_id
                JOIN team_match_results r ON r.tournament_id = a.tournament_id
                WHERE a.status = 'approved'
            `),
            db.query('SELECT COUNT(DISTINCT tournament_id) AS count FROM applications WHERE user_id = $1', [req.user.id])
        ]);

        const teamAvatars = new Map(teamProfilesResult.rows.map(profile => [profile.team_key, profile.avatar_data]));
        const hiddenTeamKeys = new Set(
            teamProfilesResult.rows.filter(profile => Number(profile.is_hidden) === 1).map(profile => profile.team_key)
        );
        const teamsByApplication = new Map();
        const playerStats = new Map();
        for (const row of ratingResult.rows) {
            let player = playerStats.get(row.user_id);
            if (!player) {
                player = { username: row.username, wins: new Set() };
                playerStats.set(row.user_id, player);
            }
            if (normalizeTeamKey(row.team_name) === normalizeTeamKey(row.winner)) {
                player.wins.add(`${row.tournament_id}:${row.round_index}:${row.match_index}`);
            }
        }
        for (const row of teamResult.rows) {
            if (hiddenTeamKeys.has(normalizeTeamKey(row.team_name))) continue;
            let team = teamsByApplication.get(row.id);
            if (!team) {
                team = {
                    teamName: row.team_name,
                    status: row.status,
                    tournamentId: row.tournament_id,
                    tournamentName: row.tournament_name,
                    avatarData: teamAvatars.get(normalizeTeamKey(row.team_name)) || null,
                    wins: 0,
                    losses: 0
                };
                teamsByApplication.set(row.id, team);
            }
            if (!row.winner) continue;
            const teamKey = normalizeTeamKey(row.team_name);
            if (teamKey === normalizeTeamKey(row.winner)) {
                team.wins += 1;
            } else if (teamKey === normalizeTeamKey(row.team1) || teamKey === normalizeTeamKey(row.team2)) {
                team.losses += 1;
            }
        }
        const teams = [...teamsByApplication.values()];
        const playerRankings = [...playerStats.entries()]
            .map(([userId, player]) => ({ userId, username: player.username, wins: player.wins.size }))
            .filter(player => player.wins > 0)
            .sort((left, right) => right.wins - left.wins || left.username.localeCompare(right.username, 'ru-RU'));
        const rankIndex = playerRankings.findIndex(player => Number(player.userId) === Number(req.user.id));
        const ratingWins = playerStats.get(req.user.id)?.wins.size || 0;
        res.json({
            username: req.user.username,
            role: req.user.role,
            avatarData: profileResult.rows[0] ? profileResult.rows[0].avatar_data : null,
            coverData: profileResult.rows[0] ? profileResult.rows[0].cover_data : null,
            avatarFrameColor: profileResult.rows[0] ? profileResult.rows[0].avatar_frame_color : '#00f0ff',
            avatarFrameStyle: profileResult.rows[0] ? profileResult.rows[0].avatar_frame_style : 'neon',
            rating: {
                points: ratingWins * 100,
                wins: ratingWins,
                rank: rankIndex < 0 ? null : rankIndex + 1,
                tournaments: Number(tournamentCountResult.rows[0].count) || 0
            },
            teams
        });
    } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        res.status(500).json({ message: 'Не удалось загрузить профиль' });
    }
});

app.put('/api/profile', authMiddleware, async (req, res) => {
    const { avatarData, coverData, avatarFrameColor, avatarFrameStyle } = req.body;
    if (!Object.prototype.hasOwnProperty.call(req.body, 'avatarData')
        || !Object.prototype.hasOwnProperty.call(req.body, 'coverData')
        || !Object.prototype.hasOwnProperty.call(req.body, 'avatarFrameColor')
        || !Object.prototype.hasOwnProperty.call(req.body, 'avatarFrameStyle')) {
        return res.status(400).json({ message: 'Передайте аватар, фон и настройки рамки профиля' });
    }
    if (!isValidImageData(avatarData, PROFILE_IMAGE_LIMITS.avatar)) {
        return res.status(400).json({ message: 'Аватар должен быть PNG, JPEG или WebP размером до 512 КБ' });
    }
    if (!isValidImageData(coverData, PROFILE_IMAGE_LIMITS.cover)) {
        return res.status(400).json({ message: 'Фон должен быть PNG, JPEG или WebP размером до 1,5 МБ' });
    }
    if (!AVATAR_FRAME_COLORS.has(avatarFrameColor) || !AVATAR_FRAME_STYLES.has(avatarFrameStyle)) {
        return res.status(400).json({ message: 'Выберите допустимый цвет и стиль рамки аватара' });
    }

    try {
        await db.query(`
            INSERT INTO user_profiles (user_id, avatar_data, cover_data, avatar_frame_color, avatar_frame_style)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(user_id) DO UPDATE SET
                avatar_data = excluded.avatar_data,
                cover_data = excluded.cover_data,
                avatar_frame_color = excluded.avatar_frame_color,
                avatar_frame_style = excluded.avatar_frame_style,
                updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, avatarData, coverData, avatarFrameColor, avatarFrameStyle]);
        res.json({ message: 'Профиль обновлён' });
    } catch (err) {
        console.error('Ошибка сохранения профиля:', err);
        res.status(500).json({ message: 'Не удалось сохранить профиль' });
    }
});

app.put('/api/profile/teams/:teamName', authMiddleware, async (req, res) => {
    const teamName = req.params.teamName.trim();
    const { avatarData } = req.body;
    if (!teamName || teamName.length > 255) {
        return res.status(400).json({ message: 'Некорректное название команды' });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'avatarData')
        || !isValidImageData(avatarData, PROFILE_IMAGE_LIMITS.team)) {
        return res.status(400).json({ message: 'Загрузите PNG, JPEG или WebP до 512 КБ либо очистите эмблему' });
    }

    try {
        const ownedTeams = await db.query('SELECT team_name FROM applications WHERE user_id = $1', [req.user.id]);
        if (!ownedTeams.rows.some(team => normalizeTeamKey(team.team_name) === normalizeTeamKey(teamName))) {
            return res.status(403).json({ message: 'Настраивать можно только команду из вашей заявки' });
        }
        await db.query(`
            INSERT INTO team_profiles (owner_user_id, team_key, team_name, avatar_data, is_hidden)
            VALUES ($1, $2, $3, $4, 0)
            ON CONFLICT(owner_user_id, team_key) DO UPDATE SET
                team_name = excluded.team_name,
                avatar_data = excluded.avatar_data,
                is_hidden = 0,
                updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, normalizeTeamKey(teamName), teamName, avatarData]);
        res.json({ message: 'Эмблема команды обновлена', teamName });
    } catch (err) {
        console.error('Ошибка сохранения эмблемы команды:', err);
        res.status(500).json({ message: 'Не удалось сохранить эмблему команды' });
    }
});

app.delete('/api/profile/teams/:teamName', authMiddleware, async (req, res) => {
    const teamName = req.params.teamName.trim();
    if (!teamName || teamName.length > 255) {
        return res.status(400).json({ message: 'Некорректное название команды' });
    }

    try {
        const ownedTeams = await db.query('SELECT team_name FROM applications WHERE user_id = $1', [req.user.id]);
        if (!ownedTeams.rows.some(team => normalizeTeamKey(team.team_name) === normalizeTeamKey(teamName))) {
            return res.status(403).json({ message: 'Можно скрыть только состав из вашей заявки' });
        }
        await db.query(`
            INSERT INTO team_profiles (owner_user_id, team_key, team_name, is_hidden)
            VALUES ($1, $2, $3, 1)
            ON CONFLICT(owner_user_id, team_key) DO UPDATE SET
                is_hidden = 1,
                updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, normalizeTeamKey(teamName), teamName]);
        res.json({
            message: 'Состав скрыт из профиля. Заявки, результаты и публичный рейтинг сохранены.',
            teamName
        });
    } catch (err) {
        console.error('Ошибка скрытия состава из профиля:', err);
        res.status(500).json({ message: 'Не удалось скрыть состав из профиля' });
    }
});

app.get('/api/teams', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.id, t.name, t.game, t.created_at, u.username AS captain_name,
                   COUNT(tm.user_id) AS member_count
            FROM teams t
            JOIN users u ON u.id = t.captain_user_id
            LEFT JOIN team_members tm ON tm.team_id = t.id
            GROUP BY t.id
            ORDER BY t.created_at DESC, t.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки списка команд:', err);
        res.status(500).json({ message: 'Не удалось загрузить команды' });
    }
});

app.get('/api/teams/by-name/:teamName', async (req, res) => {
    const teamName = typeof req.params.teamName === 'string' ? req.params.teamName.trim() : '';
    if (!teamName || teamName.length > 255) {
        return res.status(400).json({ message: 'Некорректное название команды' });
    }
    try {
        const registeredResult = await db.query(`
            SELECT t.id, t.name, t.game, u.username AS captain_name
            FROM teams t
            JOIN users u ON u.id = t.captain_user_id
            WHERE t.team_key = $1
        `, [normalizeTeamKey(teamName)]);
        const registered = registeredResult.rows[0];
        if (registered) {
            const membersResult = await db.query(`
                SELECT u.username, tm.role
                FROM team_members tm
                JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = $1
                ORDER BY CASE tm.role WHEN 'captain' THEN 0 ELSE 1 END, tm.joined_at
            `, [registered.id]);
            return res.json({
                team: registered,
                members: membersResult.rows.map(member => ({
                    username: member.username,
                    role: member.role
                }))
            });
        }

        const applicationsResult = await db.query(`
            SELECT a.team_name, a.roster, u.username AS captain_name, t.game
            FROM applications a
            JOIN users u ON u.id = a.user_id
            JOIN tournaments t ON t.id = a.tournament_id
            WHERE a.status = 'approved'
            ORDER BY a.reviewed_at DESC, a.id DESC
        `);
        const application = applicationsResult.rows.find(row =>
            normalizeTeamKey(row.team_name) === normalizeTeamKey(teamName)
        );
        if (!application) return res.status(404).json({ message: 'Состав команды пока не указан' });
        const members = typeof application.roster === 'string'
            ? application.roster.split(/[\n,;]+/).map(username => username.trim()).filter(Boolean)
            : [];
        const uniqueMembers = [...new Set([application.captain_name, ...members])];
        res.json({
            team: {
                id: null,
                name: application.team_name,
                game: application.game,
                captain_name: application.captain_name
            },
            members: uniqueMembers.map(username => ({
                username,
                role: username === application.captain_name ? 'captain' : 'player'
            }))
        });
    } catch (err) {
        console.error('Ошибка загрузки состава команды:', err);
        res.status(500).json({ message: 'Не удалось загрузить состав команды' });
    }
});

app.get('/api/teams/mine', authMiddleware, async (req, res) => {
    try {
        const [membershipResult, requestResult] = await Promise.all([
            db.query(`
                SELECT t.id, t.name, t.game, t.captain_user_id, tm.role
                FROM team_members tm
                JOIN teams t ON t.id = tm.team_id
                WHERE tm.user_id = $1
            `, [req.user.id]),
            db.query(
                'SELECT team_id, status FROM team_join_requests WHERE user_id = $1',
                [req.user.id]
            )
        ]);
        const membership = membershipResult.rows[0] || null;
        let members = [];
        let pendingRequests = [];
        if (membership) {
            const [membersResult, pendingResult] = await Promise.all([
                db.query(`
                    SELECT u.id, u.username, tm.role, tm.joined_at
                    FROM team_members tm
                    JOIN users u ON u.id = tm.user_id
                    WHERE tm.team_id = $1
                    ORDER BY CASE tm.role WHEN 'captain' THEN 0 ELSE 1 END, tm.joined_at
                `, [membership.id]),
                membership.role === 'captain'
                    ? db.query(`
                        SELECT r.id, r.user_id, u.username, r.created_at
                        FROM team_join_requests r
                        JOIN users u ON u.id = r.user_id
                        WHERE r.team_id = $1 AND r.status = 'pending'
                        ORDER BY r.created_at, r.id
                    `, [membership.id])
                    : Promise.resolve({ rows: [] })
            ]);
            members = membersResult.rows;
            pendingRequests = pendingResult.rows;
        }
        res.json({
            membership,
            members,
            pendingRequests,
            requestStatuses: requestResult.rows.map(row => ({
                teamId: row.team_id,
                status: row.status
            }))
        });
    } catch (err) {
        console.error('Ошибка загрузки состава пользователя:', err);
        res.status(500).json({ message: 'Не удалось загрузить информацию о команде' });
    }
});

app.post('/api/teams', authMiddleware, async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const game = typeof req.body.game === 'string' ? req.body.game.trim() : '';
    if (name.length < 2 || name.length > 40 || !game || game.length > 80) {
        return res.status(400).json({ message: 'Укажите название команды (2–40 символов) и игру (до 80 символов)' });
    }

    try {
        const existingMembership = await db.query(
            'SELECT team_id FROM team_members WHERE user_id = $1',
            [req.user.id]
        );
        if (existingMembership.rows.length) {
            return res.status(409).json({ message: 'Сначала выйдите из текущей команды' });
        }
        const teamKey = normalizeTeamKey(name);
        const result = await db.query(
            'INSERT INTO teams (name, team_key, game, captain_user_id) VALUES ($1, $2, $3, $4)',
            [name, teamKey, game, req.user.id]
        );
        try {
            await db.query(
                "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'captain')",
                [result.lastID, req.user.id]
            );
        } catch (memberError) {
            await db.query('DELETE FROM teams WHERE id = $1', [result.lastID]);
            throw memberError;
        }
        res.status(201).json({ message: `Команда «${name}» создана`, teamId: result.lastID });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ message: 'Вы уже состоите в команде или такое название занято' });
        }
        console.error('Ошибка создания команды:', err);
        res.status(500).json({ message: 'Не удалось создать команду' });
    }
});

app.post('/api/teams/:teamId/join-requests', authMiddleware, async (req, res) => {
    const teamId = parseNonNegativeIndex(req.params.teamId);
    if (!teamId) return res.status(400).json({ message: 'Некорректная команда' });
    try {
        const teamResult = await db.query('SELECT id FROM teams WHERE id = $1', [teamId]);
        if (!teamResult.rows.length) return res.status(404).json({ message: 'Команда не найдена' });
        const membership = await db.query('SELECT team_id FROM team_members WHERE user_id = $1', [req.user.id]);
        if (membership.rows.length) {
            return res.status(409).json({ message: 'Чтобы подать заявку, сначала выйдите из текущей команды' });
        }
        const result = await db.query(`
            INSERT INTO team_join_requests (team_id, user_id, status)
            VALUES ($1, $2, 'pending')
            ON CONFLICT(team_id, user_id) DO UPDATE SET
                status = 'pending',
                created_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE team_join_requests.status != 'pending'
        `, [teamId, req.user.id]);
        if (!result.changes) {
            return res.status(409).json({ message: 'Заявка в эту команду уже ожидает решения капитана' });
        }
        res.status(201).json({ message: 'Заявка отправлена капитану команды' });
    } catch (err) {
        console.error('Ошибка подачи заявки в команду:', err);
        res.status(500).json({ message: 'Не удалось отправить заявку в команду' });
    }
});

app.put('/api/teams/:teamId/join-requests/:requestId', authMiddleware, async (req, res) => {
    const teamId = parseNonNegativeIndex(req.params.teamId);
    const requestId = parseNonNegativeIndex(req.params.requestId);
    const status = req.body.status;
    if (!teamId || !requestId || !['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'Некорректное решение по заявке' });
    }
    try {
        const requestResult = await db.query(`
            SELECT r.id, r.user_id, r.status, t.captain_user_id, t.name
            FROM team_join_requests r
            JOIN teams t ON t.id = r.team_id
            WHERE r.id = $1 AND r.team_id = $2
        `, [requestId, teamId]);
        const request = requestResult.rows[0];
        if (!request) return res.status(404).json({ message: 'Заявка не найдена' });
        if (Number(request.captain_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ message: 'Решать по заявкам может только капитан команды' });
        }
        if (request.status !== 'pending') {
            return res.status(409).json({ message: 'Эта заявка уже обработана' });
        }
        if (status === 'accepted') {
            await db.query(
                "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'player')",
                [teamId, request.user_id]
            );
        }
        const updateResult = await db.query(`
            UPDATE team_join_requests
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status = 'pending'
        `, [status, requestId]);
        if (!updateResult.changes) {
            if (status === 'accepted') {
                await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, request.user_id]);
            }
            return res.status(409).json({ message: 'Заявка уже была обработана' });
        }
        res.json({ message: status === 'accepted' ? 'Игрок принят в команду' : 'Заявка отклонена' });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ message: 'Игрок уже состоит в другой команде' });
        }
        console.error('Ошибка обработки заявки в команду:', err);
        res.status(500).json({ message: 'Не удалось обработать заявку' });
    }
});

app.delete('/api/teams/membership', authMiddleware, async (req, res) => {
    try {
        const membershipResult = await db.query(
            'SELECT team_id, role FROM team_members WHERE user_id = $1',
            [req.user.id]
        );
        const membership = membershipResult.rows[0];
        if (!membership) return res.status(404).json({ message: 'Вы не состоите в команде' });
        if (membership.role === 'captain') {
            return res.status(409).json({ message: 'Капитан может распустить команду из панели управления' });
        }
        await db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [membership.team_id, req.user.id]);
        await db.query(`
            UPDATE team_join_requests
            SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
            WHERE team_id = $1 AND user_id = $2
        `, [membership.team_id, req.user.id]);
        res.json({ message: 'Вы вышли из команды' });
    } catch (err) {
        console.error('Ошибка выхода из команды:', err);
        res.status(500).json({ message: 'Не удалось выйти из команды' });
    }
});

app.delete('/api/teams/:teamId/members/:userId', authMiddleware, async (req, res) => {
    const teamId = parseNonNegativeIndex(req.params.teamId);
    const userId = parseNonNegativeIndex(req.params.userId);
    if (!teamId || !userId) return res.status(400).json({ message: 'Некорректный участник команды' });
    try {
        const teamResult = await db.query(
            'SELECT captain_user_id FROM teams WHERE id = $1',
            [teamId]
        );
        if (!teamResult.rows.length) return res.status(404).json({ message: 'Команда не найдена' });
        if (Number(teamResult.rows[0].captain_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ message: 'Удалять игроков может только капитан команды' });
        }
        const result = await db.query(
            "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 AND role = 'player'",
            [teamId, userId]
        );
        if (!result.changes) return res.status(404).json({ message: 'Игрок не найден в составе' });
        await db.query(`
            UPDATE team_join_requests
            SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
            WHERE team_id = $1 AND user_id = $2
        `, [teamId, userId]);
        res.json({ message: 'Игрок исключён из команды' });
    } catch (err) {
        console.error('Ошибка исключения игрока из команды:', err);
        res.status(500).json({ message: 'Не удалось исключить игрока' });
    }
});

app.delete('/api/teams/:teamId', authMiddleware, async (req, res) => {
    const teamId = parseNonNegativeIndex(req.params.teamId);
    if (!teamId) return res.status(400).json({ message: 'Некорректная команда' });
    try {
        const result = await db.query(
            'DELETE FROM teams WHERE id = $1 AND captain_user_id = $2',
            [teamId, req.user.id]
        );
        if (!result.changes) return res.status(404).json({ message: 'Команда не найдена или вы не её капитан' });
        res.json({ message: 'Команда распущена' });
    } catch (err) {
        console.error('Ошибка роспуска команды:', err);
        res.status(500).json({ message: 'Не удалось распустить команду' });
    }
});

// --- ТУРНИРЫ ---

// Список турниров
app.get('/api/tournaments', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, name, bracket_data, game, prize_amount, prize_currency, team_size, start_date, status, description, created_at FROM tournaments ORDER BY id DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки турниров:', err);
        res.status(500).json({ message: 'Ошибка загрузки турниров' });
    }
});

// Турнир по ID
app.get('/api/tournaments/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('SELECT * FROM tournaments WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Турнир не найден' });
        }

        const tournament = result.rows[0];
        tournament.bracket_data = JSON.parse(tournament.bracket_data);
        res.json(tournament);
    } catch (err) {
        res.status(500).json({ message: 'Ошибка при получении турнира' });
    }
});

app.get('/api/teams/leaderboard', async (req, res) => {
    try {
        await ensureLeaderboardSeeded();
        const [resultRows, rosterResult, teamProfilesResult] = await Promise.all([
            db.query(`
                SELECT r.winner, t.name AS tournament_name
                FROM team_match_results r
                JOIN tournaments t ON t.id = r.tournament_id
                ORDER BY t.id DESC, r.round_index, r.match_index
            `),
            db.query(`
                SELECT a.team_name, a.roster, t.name AS tournament_name
                FROM applications a
                JOIN tournaments t ON t.id = a.tournament_id
                WHERE a.status = 'approved'
                ORDER BY COALESCE(a.reviewed_at, a.created_at) DESC, a.id DESC
            `),
            db.query('SELECT team_key, avatar_data FROM team_profiles ORDER BY updated_at DESC')
        ]);
        const teamAvatars = new Map();
        teamProfilesResult.rows.forEach(profile => {
            if (!teamAvatars.has(profile.team_key)) teamAvatars.set(profile.team_key, profile.avatar_data);
        });
        const teams = new Map();
        const getTeam = (name) => {
            const teamName = typeof name === 'string' ? name.trim() : '';
            if (!teamName || teamName === 'TBD') return null;
            const key = teamName.toLocaleLowerCase('ru-RU');
            if (!teams.has(key)) {
                teams.set(key, { teamName, wins: 0, players: new Set(), tournaments: new Set(), avatarData: teamAvatars.get(key) || null });
            }
            return teams.get(key);
        };

        for (const application of rosterResult.rows) {
            const team = getTeam(application.team_name);
            if (!team) continue;
            team.tournaments.add(application.tournament_name);
            if (typeof application.roster === 'string') {
                application.roster.split(/[\n,;]+/).map(player => player.trim()).filter(Boolean)
                    .forEach(player => team.players.add(player));
            }
        }

        for (const result of resultRows.rows) {
            const winner = getTeam(result.winner);
            if (winner) {
                winner.wins += 1;
                winner.tournaments.add(result.tournament_name);
            }
        }

        const leaderboard = [...teams.values()]
            .filter(team => team.wins > 0)
            .map(team => ({
                teamName: team.teamName,
                wins: team.wins,
                players: [...team.players],
                tournaments: [...team.tournaments],
                avatarData: team.avatarData
            }))
            .sort((left, right) => right.wins - left.wins || left.teamName.localeCompare(right.teamName, 'ru-RU'))
            .slice(0, 100);
        res.json(leaderboard);
    } catch (err) {
        console.error('Ошибка загрузки рейтинга команд:', err);
        res.status(500).json({ message: 'Не удалось загрузить рейтинг команд' });
    }
});

app.delete('/api/admin/teams/leaderboard', authMiddleware, requireSeniorAdmin, async (req, res) => {
    try {
        await ensureLeaderboardSeeded();
        const result = await db.query('DELETE FROM team_match_results');
        await recordAdminAudit(req.user.id, 'team_leaderboard_cleared', null, {
            clearedMatchResults: result.changes
        });
        res.json({ message: `Топ очищен. Сброшено результатов матчей: ${result.changes}` });
    } catch (err) {
        console.error('Ошибка очистки топа команд:', err);
        res.status(500).json({ message: 'Не удалось очистить топ команд' });
    }
});

// Создать турнир (Admin)
app.post('/api/tournaments', authMiddleware, requireMiddleAdmin, async (req, res) => {
    const { name, bracketData, game = '', prizeAmount = 0, prizeCurrency = 'USD', teamSize, startDate = '', status = 'upcoming', description = '' } = req.body;
    const amount = Number(prizeAmount);
    const playerCount = Number(teamSize);

    if (typeof name !== 'string' || !name.trim() || !Array.isArray(bracketData)) {
        return res.status(400).json({ message: 'Укажите название турнира и корректную сетку' });
    }
    if (!Number.isSafeInteger(playerCount) || playerCount < 1 || playerCount > 100) {
        return res.status(400).json({ message: 'Укажите точное количество игроков в команде (от 1 до 100)' });
    }
    if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ message: 'Призовой фонд должен быть неотрицательным числом' });
    }
    if (!PRIZE_CURRENCIES.has(prizeCurrency) || !TOURNAMENT_STATUSES.has(status)) {
        return res.status(400).json({ message: 'Укажите корректную валюту и статус турнира' });
    }

    try {
        await ensureLeaderboardSeeded();
        const result = await db.query(
            `INSERT INTO tournaments (name, bracket_data, game, prize_amount, prize_currency, team_size, start_date, status, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [name.trim(), JSON.stringify(bracketData), game.trim(), amount, prizeCurrency, playerCount, startDate, status, description.trim()]
        );
        await syncTeamMatchResults(result.lastID, [], bracketData);
        await recordAdminAudit(req.user.id, 'tournament_created', null, {
            tournamentId: result.lastID,
            name: name.trim(),
            game: game.trim(),
            status
        });
        res.status(201).json({ id: result.lastID, message: 'Турнир создан' });
    } catch (err) {
        console.error('Ошибка создания турнира:', err);
        res.status(500).json({ message: 'Ошибка при создании турнира' });
    }
});

// Обновить сетку (Admin)
app.put('/api/tournaments/:id', authMiddleware, requireMiddleAdmin, async (req, res) => {
    const { id } = req.params;
    const { bracketData, name, game, prizeAmount, prizeCurrency, teamSize, startDate, status, description } = req.body;
    const fields = [];
    const values = [];

    if (bracketData !== undefined) {
        if (!Array.isArray(bracketData)) {
            return res.status(400).json({ message: 'Некорректная турнирная сетка' });
        }
        fields.push('bracket_data');
        values.push(JSON.stringify(bracketData));
    }

    if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ message: 'Название турнира не может быть пустым' });
        }
        fields.push('name');
        values.push(name.trim());
    }
    if (game !== undefined) { fields.push('game'); values.push(String(game).trim()); }
    if (description !== undefined) { fields.push('description'); values.push(String(description).trim()); }
    if (startDate !== undefined) { fields.push('start_date'); values.push(String(startDate)); }
    if (teamSize !== undefined) {
        const playerCount = Number(teamSize);
        if (!Number.isSafeInteger(playerCount) || playerCount < 1 || playerCount > 100) {
            return res.status(400).json({ message: 'Укажите точное количество игроков в команде (от 1 до 100)' });
        }
        fields.push('team_size');
        values.push(playerCount);
    }
    if (prizeAmount !== undefined) {
        const amount = Number(prizeAmount);
        if (!Number.isFinite(amount) || amount < 0) {
            return res.status(400).json({ message: 'Призовой фонд должен быть неотрицательным числом' });
        }
        fields.push('prize_amount');
        values.push(amount);
    }
    if (prizeCurrency !== undefined) {
        if (!PRIZE_CURRENCIES.has(prizeCurrency)) {
            return res.status(400).json({ message: 'Некорректная валюта призового фонда' });
        }
        fields.push('prize_currency');
        values.push(prizeCurrency);
    }
    if (status !== undefined) {
        if (!TOURNAMENT_STATUSES.has(status)) {
            return res.status(400).json({ message: 'Некорректный статус турнира' });
        }
        fields.push('status');
        values.push(status);
    }
    if (!fields.length) {
        return res.status(400).json({ message: 'Нет данных для обновления' });
    }

    try {
        const existing = await db.query('SELECT id, name, bracket_data FROM tournaments WHERE id = $1', [id]);
        if (!existing.rows.length) return res.status(404).json({ message: 'Турнир не найден' });
        if (bracketData !== undefined) await ensureLeaderboardSeeded();

        const assignments = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
        values.push(id);
        await db.query(`UPDATE tournaments SET ${assignments} WHERE id = $${values.length}`, values);
        if (bracketData !== undefined) {
            await syncTeamMatchResults(Number(id), existing.rows[0].bracket_data, bracketData);
        }
        await recordAdminAudit(req.user.id, 'tournament_updated', null, {
            tournamentId: Number(id),
            name: name === undefined ? existing.rows[0].name : name.trim(),
            changedFields: fields
        });
        res.json({ message: 'Сетка обновлена' });
    } catch (err) {
        console.error('Ошибка обновления турнира:', err);
        res.status(500).json({ message: 'Ошибка при обновлении сетки' });
    }
});

// Удалить турнир (Admin)
app.delete('/api/tournaments/:id', authMiddleware, requireSeniorAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const tournamentResult = await db.query('SELECT id, name FROM tournaments WHERE id = $1', [id]);
        const tournament = tournamentResult.rows[0];
        if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
        await db.query('DELETE FROM tournaments WHERE id = $1', [id]);
        await recordAdminAudit(req.user.id, 'tournament_deleted', null, {
            tournamentId: Number(id),
            name: tournament.name
        });
        res.json({ message: 'Турнир успешно удален' });
    } catch (err) {
        console.error('Ошибка удаления турнира:', err);
        res.status(500).json({ message: 'Ошибка при удалении турнира' });
    }
});

// --- АДМИНКА ---

// Список пользователей
app.get('/api/admin/users', authMiddleware, requireSeniorAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.username, u.role, u.created_at,
                   r.id AS restriction_id,
                   r.reason_code AS restriction_reason,
                   r.reason_details AS restriction_details,
                   r.expires_at AS restriction_expires_at
            FROM users u
            LEFT JOIN user_restrictions r ON r.id = (
                SELECT active.id
                FROM user_restrictions active
                WHERE active.user_id = u.id
                  AND active.revoked_at IS NULL
                  AND (active.expires_at IS NULL OR active.expires_at > CURRENT_TIMESTAMP)
                ORDER BY active.id DESC
                LIMIT 1
            )
            ORDER BY u.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка при получении пользователей:', err);
        res.status(500).json({ message: 'Ошибка при получении пользователей' });
    }
});

app.get('/api/admin/audit-logs', authMiddleware, requireSeniorAdmin, async (req, res) => {
    try {
        const juniorOnlyFilter = req.user.role === 'ROLE_ADMIN_SENIOR'
            ? "WHERE a.role IN ('ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_ADMIN')"
            : '';
        const result = await db.query(`
            SELECT l.id, l.action, l.details_json, l.created_at,
                   a.username AS admin_name,
                   l.target_user_id, target.username AS target_username
            FROM admin_audit_logs l
            JOIN users a ON a.id = l.admin_id
            LEFT JOIN users target ON target.id = l.target_user_id
            ${juniorOnlyFilter}
            ORDER BY l.id DESC
            LIMIT 500
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки журнала действий администраторов:', err);
        res.status(500).json({ message: 'Не удалось загрузить журнал действий' });
    }
});

// Изменить роль
app.patch('/api/admin/users/:id/role', authMiddleware, requireSeniorAdmin, async (req, res) => {
    const { role } = req.body;
    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
        return res.status(400).json({ message: 'Некорректный идентификатор пользователя' });
    }
    if (!['ROLE_USER', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR'].includes(role)) {
        return res.status(400).json({ message: 'Недопустимая роль пользователя' });
    }

    try {
        const targetResult = await db.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
        const target = targetResult.rows[0];
        if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
        if (target.username === 'admin' || target.role === 'ROLE_SUPER_ADMIN') {
            return res.status(403).json({ message: 'Главного системного администратора нельзя изменить через управление пользователями' });
        }
        if (userId === Number(req.user.id)) {
            return res.status(400).json({ message: 'Нельзя изменить собственную роль' });
        }
        const actorLevel = ADMIN_ROLE_LEVELS.get(req.user.role) || 0;
        const targetLevel = ADMIN_ROLE_LEVELS.get(target.role) || 0;
        const desiredLevel = ADMIN_ROLE_LEVELS.get(role) || 0;
        if (targetLevel >= actorLevel || desiredLevel >= actorLevel) {
            return res.status(403).json({ message: 'Можно управлять только пользователями и администраторами более низкого уровня' });
        }

        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
        await recordAdminAudit(req.user.id, 'user_role_changed', userId, {
            username: target.username,
            previousRole: target.role,
            newRole: role
        });
        res.json({ message: 'Роль успешно изменена', user: { ...target, role } });
    } catch (err) {
        console.error('Ошибка при смене роли пользователя:', err);
        res.status(500).json({ message: 'Ошибка при смене роли' });
    }
});

// Удалить пользователя
app.delete('/api/admin/users/:id', authMiddleware, requireSeniorAdmin, async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
        return res.status(400).json({ message: 'Некорректный идентификатор пользователя' });
    }
    try {
        const userResult = await db.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
        const target = userResult.rows[0];
        if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
        if (target.username === 'admin' || (ADMIN_ROLE_LEVELS.get(target.role) || 0) >= (ADMIN_ROLE_LEVELS.get(req.user.role) || 0)) {
            return res.status(403).json({ message: 'Нельзя удалить системного администратора или сотрудника своего/более высокого уровня' });
        }
        await db.query('DELETE FROM users WHERE id = $1', [userId]);
        await recordAdminAudit(req.user.id, 'user_deleted', null, {
            userId,
            username: target.username,
            role: target.role
        });
        res.json({ message: 'Пользователь удален' });
    } catch (err) {
        console.error('Ошибка удаления пользователя:', err);
        res.status(500).json({ message: 'Ошибка при удалении пользователя' });
    }
});

// --- ПОДАЧА И ОБРАБОТКА ЗАЯВОК ---

// 1. Юзер подает заявку на турнир
app.post('/api/applications', authMiddleware, async (req, res) => {
    const body = req.body || {};
    const tournamentId = typeof body.tournamentId === 'number' || typeof body.tournamentId === 'string'
        ? Number(body.tournamentId)
        : NaN;
    const captainContact = typeof body.captainContact === 'string' ? body.captainContact.trim() : '';
    if (!Number.isSafeInteger(tournamentId) || tournamentId < 1) {
        return res.status(400).json({ message: 'Выберите корректный турнир' });
    }
    if (!captainContact || captainContact.length > 100) {
        return res.status(400).json({ message: 'Укажите контакт капитана (до 100 символов)' });
    }

    try {
        const restriction = await getActiveUserRestriction(req.user.id);
        if (restriction) {
            return res.status(403).json({
                message: 'Ваша учётная запись временно ограничена: подача новых заявок и сообщения в поддержку недоступны.',
                restriction
            });
        }

        const tournamentResult = await db.query(
            'SELECT id, name, status, team_size FROM tournaments WHERE id = $1',
            [tournamentId]
        );
        const tournament = tournamentResult.rows[0];
        if (!tournament) return res.status(404).json({ message: 'Турнир не найден' });
        if (tournament.status !== 'upcoming') {
            return res.status(409).json({ message: 'Набор на турнир закрыт' });
        }

        let teamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';
        let rosterNames = parseRosterNames(body.roster);
        const selectedMemberIds = Array.isArray(body.selectedMemberIds)
            ? body.selectedMemberIds
            : null;
        const membershipResult = await db.query(`
            SELECT t.id, t.name
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            WHERE tm.user_id = $1
        `, [req.user.id]);
        if (membershipResult.rows.length) {
            const membership = membershipResult.rows[0];
            const membersResult = await db.query(`
                SELECT u.id, u.username
                FROM team_members tm
                JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = $1
                ORDER BY CASE tm.role WHEN 'captain' THEN 0 ELSE 1 END, tm.joined_at
            `, [membership.id]);
            if (!selectedMemberIds || selectedMemberIds.some(id => !Number.isSafeInteger(id) || id < 1)
                || new Set(selectedMemberIds).size !== selectedMemberIds.length) {
                return res.status(400).json({ message: 'Выберите игроков, которые будут участвовать в турнире' });
            }
            const membersById = new Map(membersResult.rows.map(member => [Number(member.id), member]));
            if (selectedMemberIds.some(id => !membersById.has(id))) {
                return res.status(400).json({ message: 'В выбранном составе есть игрок, не состоящий в вашей команде' });
            }
            teamName = membership.name;
            rosterNames = selectedMemberIds.map(id => membersById.get(id).username);
        }

        if (!teamName || teamName.length > 100) {
            return res.status(400).json({ message: 'Укажите название команды (до 100 символов)' });
        }
        if (!rosterNames.length) {
            return res.status(400).json({ message: 'Добавьте игроков в состав команды' });
        }
        if (rosterNames.length > 100) {
            return res.status(400).json({ message: 'В составе не может быть больше 100 игроков' });
        }
        const requiredPlayerCount = Number(tournament.team_size) || 0;
        if (requiredPlayerCount && rosterNames.length !== requiredPlayerCount) {
            const difference = rosterNames.length > requiredPlayerCount
                ? `В составе ${rosterNames.length} игроков, а для турнира разрешено не больше ${requiredPlayerCount}.`
                : `В составе ${rosterNames.length} игроков, а для турнира требуется ${requiredPlayerCount}.`;
            return res.status(400).json({ message: difference });
        }
        if (typeof body.roster === 'string' && membershipResult.rows.length === 0
            && rosterNames.length !== body.roster.split(/[\n,;]+/).filter(name => name.trim()).length) {
            return res.status(400).json({ message: 'В составе есть повторяющиеся имена игроков' });
        }

        const existingApplicationResult = await db.query(`
            SELECT team_name
            FROM applications
            WHERE tournament_id = $1 AND status IN ('pending', 'approved')
        `, [tournamentId]);
        if (existingApplicationResult.rows.some(application =>
            normalizeTeamKey(application.team_name) === normalizeTeamKey(teamName)
        )) {
            return res.status(409).json({ message: 'Эта команда уже подала заявку на выбранный турнир' });
        }

        const result = await db.query(
            `INSERT INTO applications (tournament_id, user_id, team_name, captain_contact, roster)
             SELECT $1, $2, $3, $4, $5
             WHERE EXISTS (
                 SELECT 1 FROM tournaments WHERE id = $6 AND status = 'upcoming'
             )`,
            [tournamentId, req.user.id, teamName, captainContact, rosterNames.join('\n'), tournamentId]
        );
        if (result.changes === 0) {
            const tournament = await db.query('SELECT status FROM tournaments WHERE id = $1', [tournamentId]);
            if (!tournament.rows.length) {
                return res.status(404).json({ message: 'Турнир не найден' });
            }
            return res.status(409).json({ message: 'Набор на турнир закрыт' });
        }
        let notificationWarning = false;
        try {
            await db.query(
                `UPDATE team_profiles
                 SET is_hidden = 0, updated_at = CURRENT_TIMESTAMP
                 WHERE owner_user_id = $1 AND team_key = $2`,
                [req.user.id, normalizeTeamKey(teamName)]
            );
        } catch (profileError) {
            notificationWarning = true;
            console.error('Заявка сохранена, но профиль команды не обновлён:', profileError);
        }
        try {
            await db.query(`
                INSERT INTO notifications (user_id, title, message)
                SELECT id, $1, $2
                FROM users
                WHERE role IN (
                    'ROLE_ADMIN',
                    'ROLE_ADMIN_JUNIOR',
                    'ROLE_ADMIN_MIDDLE',
                    'ROLE_ADMIN_SENIOR',
                    'ROLE_SUPER_ADMIN'
                )
            `, [
                'Новая заявка на турнир',
                `${req.user.username} подал заявку команды «${teamName}» на турнир «${tournament.name}».`
            ]);
        } catch (notificationError) {
            notificationWarning = true;
            console.error('Заявка сохранена, но уведомление администраторов не отправлено:', notificationError);
        }
        res.status(201).json({
            message: notificationWarning
                ? 'Заявка сохранена, но не все дополнительные данные удалось обновить. Повторно отправлять её не нужно.'
                : 'Заявка успешно отправлена!'
        });
    } catch (err) {
        console.error('Ошибка подачи заявки:', err);
        res.status(500).json({ message: 'Не удалось отправить заявку' });
    }
});

// 2. Админ получает все заявки
app.get('/api/applications', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT a.*, t.name as tournament_name, t.team_size, u.username as applicant_name
            FROM applications a
            JOIN tournaments t ON a.tournament_id = t.id
            JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
        `);
        res.json(result.rows.map(application => ({
            ...application,
            roster_count: parseRosterNames(application.roster).length
        })));
    } catch (err) {
        console.error('Ошибка получения заявок:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Реестр одобренных команд
app.get('/api/admin/accepted-teams', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT a.id AS application_id, a.tournament_id, a.team_name, a.captain_contact,
                   a.roster, COALESCE(a.reviewed_at, a.created_at) AS accepted_at,
                   a.bracket_added_at, a.registry_removed_at,
                   t.name AS tournament_name, t.game, t.status AS tournament_status
            FROM applications a
            JOIN tournaments t ON t.id = a.tournament_id
            WHERE a.status = 'approved' AND a.registry_removed_at IS NULL
            ORDER BY a.created_at DESC, a.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения реестра принятых команд:', err);
        res.status(500).json({ message: 'Не удалось загрузить реестр принятых команд' });
    }
});

// Удалить одобренную команду из реестра, сохранив заявку и сетку
app.delete('/api/admin/accepted-teams/:id', authMiddleware, requireSeniorAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE applications
             SET registry_removed_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'approved' AND registry_removed_at IS NULL`,
            [req.params.id]
        );
        if (!result.changes) {
            return res.status(404).json({ message: 'Команда не найдена в реестре' });
        }
        const application = await db.query('SELECT team_name, tournament_id FROM applications WHERE id = $1', [req.params.id]);
        await recordAdminAudit(req.user.id, 'accepted_team_removed_from_registry', null, {
            applicationId: Number(req.params.id),
            teamName: application.rows[0] ? application.rows[0].team_name : null,
            tournamentId: application.rows[0] ? application.rows[0].tournament_id : null
        });
        res.json({ message: 'Команда убрана из реестра; история заявки и сетка сохранены' });
    } catch (err) {
        console.error('Ошибка очистки команды из реестра:', err);
        res.status(500).json({ message: 'Не удалось убрать команду из реестра' });
    }
});

// Очистить реестр, не удаляя историю заявок или состав уже созданной сетки
app.delete('/api/admin/accepted-teams', authMiddleware, requireSeniorAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE applications
             SET registry_removed_at = CURRENT_TIMESTAMP
             WHERE status = 'approved' AND registry_removed_at IS NULL`
        );
        await recordAdminAudit(req.user.id, 'accepted_registry_cleared', null, {
             removedCount: result.changes
        });
        res.json({ message: `Реестр очищен. Убрано команд: ${result.changes}` });
    } catch (err) {
        console.error('Ошибка очистки реестра принятых команд:', err);
        res.status(500).json({ message: 'Не удалось очистить реестр принятых команд' });
    }
});

// Администратор добавляет выбранную команду из реестра в сетку
app.post('/api/applications/:id/add-to-bracket', authMiddleware, requireMiddleAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT a.id, a.tournament_id, a.team_name, a.status AS application_status,
                   a.bracket_added_at, t.bracket_data, t.status AS tournament_status
            FROM applications a
            JOIN tournaments t ON t.id = a.tournament_id
            WHERE a.id = $1
        `, [id]);
        const application = result.rows[0];
        if (!application || application.application_status !== 'approved') {
            return res.status(404).json({ message: 'Одобренная команда не найдена' });
        }
        if (application.bracket_added_at) {
            return res.status(409).json({ message: 'Эта команда уже добавлена в сетку' });
        }
        if (application.tournament_status !== 'upcoming') {
            return res.status(409).json({ message: 'Добавлять команды можно только до начала турнира' });
        }

        let bracket;
        try {
            bracket = JSON.parse(application.bracket_data);
        } catch (parseError) {
            console.error(`Некорректная сетка турнира ${application.tournament_id}:`, parseError);
            return res.status(409).json({ message: 'Не удалось прочитать сетку турнира' });
        }
        if (!Array.isArray(bracket)) {
            return res.status(409).json({ message: 'Сетка турнира имеет некорректный формат' });
        }
        if (bracket.some(round => Array.isArray(round) && round.some(match => match && match.winner))) {
            return res.status(409).json({ message: 'Сетка уже начата; изменить состав участников нельзя' });
        }
        if (bracket.some(round => Array.isArray(round) && round.some(match =>
            match && (match.team1 === application.team_name || match.team2 === application.team_name)
        ))) {
            return res.status(409).json({ message: 'Эта команда уже находится в сетке' });
        }

        if (!bracket.length) bracket.push([]);
        if (!Array.isArray(bracket[0])) {
            return res.status(409).json({ message: 'Первый этап сетки имеет некорректный формат' });
        }

        let openSlot = null;
        for (const match of bracket[0]) {
            if (!match || typeof match !== 'object') continue;
            if (match.team1 === 'TBD') {
                openSlot = { match, team: 'team1' };
                break;
            }
            if (match.team2 === 'TBD') {
                openSlot = { match, team: 'team2' };
                break;
            }
        }
        if (openSlot) {
            openSlot.match[openSlot.team] = application.team_name;
        } else {
            bracket[0].push({ team1: application.team_name, team2: 'TBD', winner: null });
        }

        const bracketUpdateResult = await db.query(
            'UPDATE tournaments SET bracket_data = $1 WHERE id = $2 AND bracket_data = $3',
            [JSON.stringify(bracket), application.tournament_id, application.bracket_data]
        );
        if (!bracketUpdateResult.changes) {
            return res.status(409).json({ message: 'Сетка изменилась. Обновите реестр и попробуйте снова' });
        }
        const markResult = await db.query(
            `UPDATE applications
             SET bracket_added_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND bracket_added_at IS NULL AND status = 'approved'`,
            [id]
        );
        if (!markResult.changes) {
            return res.status(409).json({ message: 'Эта команда уже добавлена в сетку' });
        }
        await recordAdminAudit(req.user.id, 'accepted_team_added_to_bracket', null, {
            applicationId: Number(id),
            teamName: application.team_name,
            tournamentId: application.tournament_id
        });
        res.json({ message: `Команда «${application.team_name}» добавлена в сетку` });
    } catch (err) {
        console.error('Ошибка добавления команды в сетку:', err);
        res.status(500).json({ message: 'Не удалось добавить команду в сетку' });
    }
});

app.get('/api/matches/:tournamentId/:roundIndex/:matchIndex/messages', authMiddleware, async (req, res) => {
    const tournamentId = parseNonNegativeIndex(req.params.tournamentId);
    const roundIndex = parseNonNegativeIndex(req.params.roundIndex);
    const matchIndex = parseNonNegativeIndex(req.params.matchIndex);
    if (!tournamentId || roundIndex === null || matchIndex === null) {
        return res.status(400).json({ message: 'Некорректный матч' });
    }
    try {
        const liveMatch = await findLiveMatch(tournamentId, roundIndex, matchIndex);
        if (liveMatch.error) return res.status(liveMatch.status).json({ message: liveMatch.error });
        if (!await userBelongsToMatch(req.user.id, liveMatch.match)) {
            return res.status(403).json({ message: 'Общий чат доступен только игрокам этих команд' });
        }
        const result = await db.query(`
            SELECT m.id, m.message, m.created_at, m.sender_id, u.username AS sender_name
            FROM match_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.tournament_id = $1 AND m.round_index = $2 AND m.match_index = $3
              AND ((m.team1 = $4 AND m.team2 = $5) OR (m.team1 = $5 AND m.team2 = $4))
            ORDER BY m.id DESC
            LIMIT 100
        `, [tournamentId, roundIndex, matchIndex, liveMatch.match.team1, liveMatch.match.team2]);
        res.json({
            match: { team1: liveMatch.match.team1, team2: liveMatch.match.team2 },
            messages: result.rows.reverse()
        });
    } catch (err) {
        console.error('Ошибка загрузки общего чата матча:', err);
        res.status(500).json({ message: 'Не удалось загрузить чат матча' });
    }
});

app.post('/api/matches/:tournamentId/:roundIndex/:matchIndex/messages', authMiddleware, async (req, res) => {
    const tournamentId = parseNonNegativeIndex(req.params.tournamentId);
    const roundIndex = parseNonNegativeIndex(req.params.roundIndex);
    const matchIndex = parseNonNegativeIndex(req.params.matchIndex);
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!tournamentId || roundIndex === null || matchIndex === null) {
        return res.status(400).json({ message: 'Некорректный матч' });
    }
    if (!message || message.length > 1000) {
        return res.status(400).json({ message: 'Сообщение должно содержать от 1 до 1000 символов' });
    }
    try {
        const liveMatch = await findLiveMatch(tournamentId, roundIndex, matchIndex);
        if (liveMatch.error) return res.status(liveMatch.status).json({ message: liveMatch.error });
        if (!await userBelongsToMatch(req.user.id, liveMatch.match)) {
            return res.status(403).json({ message: 'Общий чат доступен только игрокам этих команд' });
        }
        await db.query(`
            INSERT INTO match_messages
                (tournament_id, round_index, match_index, team1, team2, sender_id, message)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [tournamentId, roundIndex, matchIndex, liveMatch.match.team1, liveMatch.match.team2, req.user.id, message]);
        res.status(201).json({ message: 'Сообщение отправлено' });
    } catch (err) {
        console.error('Ошибка отправки сообщения в чат матча:', err);
        res.status(500).json({ message: 'Не удалось отправить сообщение' });
    }
});

// 3. Админ меняет статус заявки (approved / rejected)
app.put('/api/applications/:id/status', authMiddleware, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'Статус должен быть approved или rejected' });
    }

    try {
        const applicationResult = await db.query(
            `SELECT a.user_id, a.team_name, a.status, a.roster,
                    t.name AS tournament_name, t.team_size
             FROM applications a
             JOIN tournaments t ON t.id = a.tournament_id
             WHERE a.id = $1`,
            [id]
        );
        const application = applicationResult.rows[0];
        if (!application) {
            return res.status(404).json({ message: 'Заявка не найдена' });
        }
        if (application.status !== 'pending') {
            return res.status(409).json({ message: 'Статус этой заявки уже обработан' });
        }
        const requiredPlayerCount = Number(application.team_size) || 0;
        const submittedPlayerCount = parseRosterNames(application.roster).length;
        if (status === 'approved' && requiredPlayerCount
            && submittedPlayerCount !== requiredPlayerCount) {
            return res.status(409).json({
                message: `Нельзя одобрить заявку: в составе ${submittedPlayerCount} игроков, для турнира требуется ${requiredPlayerCount}.`
            });
        }

        const updateResult = await db.query(
            "UPDATE applications SET status = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'pending'",
            [status, id]
        );
        if (updateResult.changes === 0) {
            return res.status(409).json({ message: 'Статус этой заявки уже обработан' });
        }

        const approved = status === 'approved';
        await db.query(
            'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
            [
                application.user_id,
                approved ? 'Команда принята' : 'Команда не принята',
                `Команда «${application.team_name}» ${approved ? 'принята' : 'не принята'} на турнир «${application.tournament_name}».`
            ]
        );
        await recordAdminAudit(req.user.id, 'application_reviewed', application.user_id, {
            applicationId: Number(id),
            teamName: application.team_name,
            tournamentName: application.tournament_name,
            status
        });
        res.json({ message: `Статус заявки обновлен на ${status}` });
    } catch (err) {
        console.error('Ошибка обновления статуса:', err);
        res.status(500).json({ message: 'Не удалось обновить статус' });
    }
});

// Уведомления текущего пользователя
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, title, message, is_read, created_at
             FROM notifications
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT 30`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки уведомлений:', err);
        res.status(500).json({ message: 'Не удалось загрузить уведомления' });
    }
});

// Отметить уведомления текущего пользователя прочитанными
app.put('/api/notifications/read', authMiddleware, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0',
            [req.user.id]
        );
        res.json({ message: 'Уведомления отмечены прочитанными' });
    } catch (err) {
        console.error('Ошибка обновления уведомлений:', err);
        res.status(500).json({ message: 'Не удалось обновить уведомления' });
    }
});

const MAX_CHAT_MESSAGE_LENGTH = 2000;
const MAX_RESTRICTION_DAYS = 36500;
const CHAT_RESTRICTION_REASONS = new Set(['unsporting', 'harassment', 'spam', 'rule_violation', 'other']);

async function ensureSupportConversation(userId) {
    await db.query('INSERT OR IGNORE INTO support_conversations (user_id) VALUES ($1)', [userId]);
}

async function getActiveUserRestriction(userId) {
    const result = await db.query(`
        SELECT r.id, r.reason_code, r.reason_details, r.starts_at, r.expires_at,
               u.username AS admin_name
        FROM user_restrictions r
        JOIN users u ON u.id = r.admin_id
        WHERE r.user_id = $1
          AND r.revoked_at IS NULL
          AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
        ORDER BY r.id DESC
        LIMIT 1
    `, [userId]);
    return result.rows[0] || null;
}

async function getSupportConversationState(userId) {
    await ensureSupportConversation(userId);
    const [conversation, restriction] = await Promise.all([
        db.query(
            'SELECT user_resolved_at, admin_resolved_at, closed_at FROM support_conversations WHERE user_id = $1',
            [userId]
        ),
        getActiveUserRestriction(userId)
    ]);
    const state = conversation.rows[0];
    return {
        user_resolved_at: state.user_resolved_at,
        admin_resolved_at: state.admin_resolved_at,
        closed_at: state.closed_at,
        restriction
    };
}

async function setSupportConversationResolution(userId, side, resolved) {
    await ensureSupportConversation(userId);
    const timestamp = resolved ? new Date().toISOString() : null;
    if (side === 'user') {
        await db.query(`
            UPDATE support_conversations
            SET user_resolved_at = $1,
                closed_at = CASE WHEN $2 = 1 AND admin_resolved_at IS NOT NULL
                                 THEN CURRENT_TIMESTAMP ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $3
        `, [timestamp, resolved ? 1 : 0, userId]);
    } else {
        await db.query(`
            UPDATE support_conversations
            SET admin_resolved_at = $1,
                closed_at = CASE WHEN $2 = 1 AND user_resolved_at IS NOT NULL
                                 THEN CURRENT_TIMESTAMP ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $3
        `, [timestamp, resolved ? 1 : 0, userId]);
    }
    return await getSupportConversationState(userId);
}

async function resetSupportConversationResolution(userId) {
    await ensureSupportConversation(userId);
    await db.query(`
        UPDATE support_conversations
        SET user_resolved_at = NULL, admin_resolved_at = NULL,
            closed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
    `, [userId]);
}

function validateResolutionRequest(body) {
    if (!body || typeof body.resolved !== 'boolean') {
        return 'Укажите, решён ли вопрос';
    }
    return null;
}

function validateChatMessage(message) {
    if (typeof message !== 'string' || !message.trim()) {
        return 'Введите сообщение';
    }
    if (message.trim().length > MAX_CHAT_MESSAGE_LENGTH) {
        return `Сообщение не должно быть длиннее ${MAX_CHAT_MESSAGE_LENGTH} символов`;
    }
    return null;
}

// Личная переписка пользователя с поддержкой
app.get('/api/chat/status', authMiddleware, async (req, res) => {
    if (isAdminRole(req.user.role)) {
        return res.status(403).json({ message: 'Администратор открывает статусы через список чатов' });
    }
    try {
        res.json(await getSupportConversationState(req.user.id));
    } catch (err) {
        console.error('Ошибка загрузки состояния чата поддержки:', err);
        res.status(500).json({ message: 'Не удалось загрузить состояние чата' });
    }
});

app.patch('/api/chat/resolution', authMiddleware, async (req, res) => {
    if (isAdminRole(req.user.role)) {
        return res.status(403).json({ message: 'Администратор отмечает статус через выбранную переписку' });
    }
    const validationError = validateResolutionRequest(req.body);
    if (validationError) return res.status(400).json({ message: validationError });
    try {
        res.json({
            message: req.body.resolved ? 'Ожидаем подтверждение администратора' : 'Обращение снова открыто',
            state: await setSupportConversationResolution(req.user.id, 'user', req.body.resolved)
        });
    } catch (err) {
        console.error('Ошибка изменения статуса обращения пользователя:', err);
        res.status(500).json({ message: 'Не удалось изменить статус обращения' });
    }
});

app.get('/api/chat/unread-count', authMiddleware, async (req, res) => {
    if (isAdminRole(req.user.role)) {
        return res.status(403).json({ message: 'Администратор получает счётчик через список чатов' });
    }
    try {
        const result = await db.query(
            'SELECT COUNT(*) AS count FROM support_messages WHERE user_id = $1 AND sender_id != $2 AND is_read = 0',
            [req.user.id, req.user.id]
        );
        res.json({ count: Number(result.rows[0].count) });
    } catch (err) {
        console.error('Ошибка загрузки счётчика сообщений поддержки:', err);
        res.status(500).json({ message: 'Не удалось загрузить счётчик сообщений' });
    }
});

app.get('/api/chat/messages', authMiddleware, async (req, res) => {
    if (isAdminRole(req.user.role)) {
        return res.status(403).json({ message: 'Администратор открывает переписки через список чатов' });
    }
    try {
        await db.query(
            `UPDATE support_messages SET is_read = 1
             WHERE user_id = $1 AND sender_id != $2 AND is_read = 0`,
            [req.user.id, req.user.id]
        );
        const result = await db.query(
            `SELECT m.id, m.user_id, m.sender_id,
                    CASE
                        WHEN u.role IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')
                            THEN 'Поддержка'
                        ELSE u.username
                    END AS sender_name,
                    m.message, m.is_read, m.created_at
             FROM support_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.user_id = $1
             ORDER BY m.id ASC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки переписки пользователя:', err);
        res.status(500).json({ message: 'Не удалось загрузить переписку' });
    }
});

app.post('/api/chat/messages', authMiddleware, async (req, res) => {
    if (isAdminRole(req.user.role)) {
        return res.status(403).json({ message: 'Для ответа используйте переписку с выбранным пользователем' });
    }
    const validationError = validateChatMessage(req.body.message);
    if (validationError) return res.status(400).json({ message: validationError });

    try {
        const conversation = await getSupportConversationState(req.user.id);
        if (conversation.closed_at) {
            return res.status(409).json({ message: 'Обращение закрыто. Сначала возобновите его.' });
        }
        const restriction = conversation.restriction;
        if (restriction) {
            return res.status(403).json({
                message: 'Отправка сообщений и подача новых заявок временно ограничены.',
                restriction
            });
        }
        const result = await db.query(
            'INSERT INTO support_messages (user_id, sender_id, message) VALUES ($1, $2, $3)',
            [req.user.id, req.user.id, req.body.message.trim()]
        );
        await resetSupportConversationResolution(req.user.id);
        res.status(201).json({ id: result.lastID, message: 'Сообщение отправлено' });
    } catch (err) {
        console.error('Ошибка отправки сообщения в поддержку:', err);
        res.status(500).json({ message: 'Не удалось отправить сообщение' });
    }
});

// Список пользовательских переписок для админки
app.get('/api/admin/chats', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id AS user_id, u.username,
                   (SELECT m.message FROM support_messages m
                    WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                   (SELECT m.created_at FROM support_messages m
                    WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
                   (SELECT COUNT(*) FROM support_messages m
                    WHERE m.user_id = u.id AND m.sender_id = u.id AND m.is_read = 0) AS unread_count,
                   sc.user_resolved_at, sc.admin_resolved_at, sc.closed_at,
                   (SELECT r.id FROM user_restrictions r
                    WHERE r.user_id = u.id AND r.revoked_at IS NULL
                      AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
                    ORDER BY r.id DESC LIMIT 1) AS restriction_id,
                   (SELECT r.reason_code FROM user_restrictions r
                    WHERE r.user_id = u.id AND r.revoked_at IS NULL
                      AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
                    ORDER BY r.id DESC LIMIT 1) AS restriction_reason,
                   (SELECT r.reason_details FROM user_restrictions r
                    WHERE r.user_id = u.id AND r.revoked_at IS NULL
                      AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
                    ORDER BY r.id DESC LIMIT 1) AS restriction_details,
                   (SELECT r.expires_at FROM user_restrictions r
                    WHERE r.user_id = u.id AND r.revoked_at IS NULL
                      AND (r.expires_at IS NULL OR r.expires_at > CURRENT_TIMESTAMP)
                    ORDER BY r.id DESC LIMIT 1) AS restriction_expires_at
            FROM users u
            LEFT JOIN support_conversations sc ON sc.user_id = u.id
            WHERE u.role NOT IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')
              AND EXISTS (SELECT 1 FROM support_messages m WHERE m.user_id = u.id)
            ORDER BY last_message_at DESC, u.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки списка чатов поддержки:', err);
        res.status(500).json({ message: 'Не удалось загрузить список чатов' });
    }
});

app.patch('/api/admin/chats/:userId/resolution', authMiddleware, requireAdmin, async (req, res) => {
    const validationError = validateResolutionRequest(req.body);
    if (validationError) return res.status(400).json({ message: validationError });
    try {
        const userResult = await db.query(
            "SELECT id FROM users WHERE id = $1 AND role NOT IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')",
            [req.params.userId]
        );
        if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь чата не найден' });
        const state = await setSupportConversationResolution(req.params.userId, 'admin', req.body.resolved);
        await recordAdminAudit(req.user.id, req.body.resolved ? 'chat_marked_resolved' : 'chat_reopened', Number(req.params.userId), {
            targetClosed: Boolean(state.closed_at),
            userConfirmed: Boolean(state.user_resolved_at),
            adminConfirmed: Boolean(state.admin_resolved_at)
        });
        res.json({
            message: req.body.resolved ? 'Ожидаем подтверждение пользователя' : 'Обращение снова открыто',
            state
        });
    } catch (err) {
        console.error('Ошибка изменения статуса обращения администратором:', err);
        res.status(500).json({ message: 'Не удалось изменить статус обращения' });
    }
});

async function applyUserRestriction(req, res) {
    const userId = Number(req.params.userId || req.params.id);
    const { reasonCode, reasonDetails = '', durationDays } = req.body || {};
    if (!Number.isSafeInteger(userId) || userId < 1 || userId === Number(req.user.id)) {
        return res.status(400).json({ message: 'Некорректный пользователь для ограничения' });
    }
    if (!CHAT_RESTRICTION_REASONS.has(reasonCode)) {
        return res.status(400).json({ message: 'Выберите причину ограничения' });
    }
    if (typeof reasonDetails !== 'string' || reasonDetails.trim().length > 500) {
        return res.status(400).json({ message: 'Дополнительное описание не должно превышать 500 символов' });
    }
    if (reasonCode === 'other' && !reasonDetails.trim()) {
        return res.status(400).json({ message: 'Укажите причину для варианта «Другое»' });
    }
    const permanent = durationDays === null;
    if (!permanent && (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > MAX_RESTRICTION_DAYS)) {
        return res.status(400).json({ message: `Срок должен быть от 1 до ${MAX_RESTRICTION_DAYS} дней или бессрочным` });
    }

    try {
        const userResult = await db.query(
            "SELECT id FROM users WHERE id = $1 AND role NOT IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')",
            [userId]
        );
        if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь не найден' });

        await db.query(
            `UPDATE user_restrictions SET revoked_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
            [userId]
        );
        const restrictionInsert = await db.query(`
            INSERT INTO user_restrictions (user_id, admin_id, reason_code, reason_details, expires_at)
            VALUES ($1, $2, $3, $4,
                    CASE WHEN $5 IS NULL THEN NULL
                         ELSE datetime('now', '+' || $6 || ' days') END)
        `, [userId, req.user.id, reasonCode, reasonDetails.trim(), permanent ? null : durationDays, permanent ? null : durationDays]);
        const restriction = await getActiveUserRestriction(userId);
        await recordAdminAudit(req.user.id, 'user_restricted', userId, {
            restrictionId: restrictionInsert.lastID,
            reasonCode,
            reasonDetails: reasonDetails.trim(),
            durationDays: permanent ? null : durationDays,
            expiresAt: restriction ? restriction.expires_at : null
        });
        res.status(201).json({
            message: permanent
                ? 'Бессрочное ограничение применено: чат и подача новых заявок заблокированы'
                : `Ограничение применено на ${durationDays} дн.: чат и подача новых заявок заблокированы`,
            restriction
        });
    } catch (err) {
        console.error('Ошибка применения ограничения пользователя:', err);
        res.status(500).json({ message: 'Не удалось применить ограничение' });
    }
}

async function liftUserRestriction(req, res) {
    const userId = Number(req.params.userId || req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
        return res.status(400).json({ message: 'Некорректный идентификатор пользователя' });
    }
    try {
        const restriction = await getActiveUserRestriction(userId);
        if (!restriction) return res.status(404).json({ message: 'Активное ограничение не найдено' });
        const result = await db.query(`
            UPDATE user_restrictions SET revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        `, [userId]);
        if (!result.changes) return res.status(404).json({ message: 'Активное ограничение не найдено' });
        await recordAdminAudit(req.user.id, 'user_restriction_lifted', userId, {
            restrictionId: restriction.id,
            reasonCode: restriction.reason_code,
            reasonDetails: restriction.reason_details
        });
        res.json({ message: 'Ограничение снято' });
    } catch (err) {
        console.error('Ошибка снятия ограничения пользователя:', err);
        res.status(500).json({ message: 'Не удалось снять ограничение' });
    }
}

app.post('/api/admin/chats/:userId/restriction', authMiddleware, requireMiddleAdmin, applyUserRestriction);
app.delete('/api/admin/chats/:userId/restriction', authMiddleware, requireMiddleAdmin, liftUserRestriction);
app.post('/api/admin/users/:id/restriction', authMiddleware, requireMiddleAdmin, applyUserRestriction);
app.delete('/api/admin/users/:id/restriction', authMiddleware, requireMiddleAdmin, liftUserRestriction);

app.get('/api/admin/chats/:userId/messages', authMiddleware, requireAdmin, async (req, res) => {
    try {
        const userResult = await db.query(
            "SELECT id FROM users WHERE id = $1 AND role NOT IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')",
            [req.params.userId]
        );
        if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь чата не найден' });

        await db.query(
            'UPDATE support_messages SET is_read = 1 WHERE user_id = $1 AND sender_id = $2 AND is_read = 0',
            [req.params.userId, req.params.userId]
        );
        const result = await db.query(
            `SELECT m.id, m.user_id, m.sender_id, u.username AS sender_name,
                    u.role AS sender_role, m.message, m.is_read, m.created_at
             FROM support_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.user_id = $1
             ORDER BY m.id ASC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка загрузки чата администратора:', err);
        res.status(500).json({ message: 'Не удалось загрузить переписку' });
    }
});

app.post('/api/admin/chats/:userId/messages', authMiddleware, requireAdmin, async (req, res) => {
    const validationError = validateChatMessage(req.body.message);
    if (validationError) return res.status(400).json({ message: validationError });

    try {
        const userResult = await db.query(
            "SELECT id FROM users WHERE id = $1 AND role NOT IN ('ROLE_ADMIN', 'ROLE_ADMIN_JUNIOR', 'ROLE_ADMIN_MIDDLE', 'ROLE_ADMIN_SENIOR', 'ROLE_SUPER_ADMIN')",
            [req.params.userId]
        );
        if (!userResult.rows.length) return res.status(404).json({ message: 'Пользователь чата не найден' });

        const conversation = await getSupportConversationState(req.params.userId);
        if (conversation.closed_at) {
            return res.status(409).json({ message: 'Обращение закрыто. Сначала возобновите его.' });
        }
        const result = await db.query(
            'INSERT INTO support_messages (user_id, sender_id, message) VALUES ($1, $2, $3)',
            [req.params.userId, req.user.id, req.body.message.trim()]
        );
        await resetSupportConversationResolution(req.params.userId);
        await recordAdminAudit(req.user.id, 'admin_chat_reply_sent', Number(req.params.userId), {
            messageId: result.lastID
        });
        res.status(201).json({ id: result.lastID, message: 'Ответ отправлен' });
    } catch (err) {
        console.error('Ошибка ответа в чате поддержки:', err);
        res.status(500).json({ message: 'Не удалось отправить ответ' });
    }
});

// 4. Статистика платформы для красивого виджета
app.get('/api/stats', async (req, res) => {
    try {
        const tCount = await db.query('SELECT COUNT(*) AS count FROM tournaments');
        const uCount = await db.query('SELECT COUNT(*) AS count FROM users');
        const aCount = await db.query("SELECT COUNT(*) AS count FROM applications WHERE status = 'approved'");
        const prizeTotals = await db.query(
            'SELECT prize_currency, SUM(prize_amount) AS total FROM tournaments GROUP BY prize_currency'
        );

        res.json({
            tournaments: Number(tCount.rows[0].count),
            users: Number(uCount.rows[0].count),
            approvedTeams: Number(aCount.rows[0].count),
            prizeByCurrency: Object.fromEntries(prizeTotals.rows.map(row => [row.prize_currency, Number(row.total)]))
        });
    } catch (err) {
        console.error('Ошибка загрузки статистики:', err);
        res.status(500).json({ message: 'Ошибка загрузки статистики' });
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ message: `API-маршрут не найден: ${req.method} ${req.originalUrl}` });
});

// Запускаем сервер только после регистрации всех маршрутов
app.listen(PORT, () => {
    console.log(`⚡ BRACKETOFF Server запущен на http://localhost:${PORT}`);
});