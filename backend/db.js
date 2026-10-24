const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.pkg) {
    const runtimeRoot = path.join(os.homedir(), 'AppData', 'Local', 'CyberBracket');
    fs.mkdirSync(runtimeRoot, { recursive: true });

    const bindingSource = path.join(__dirname, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node');
    const bindingTarget = path.join(runtimeRoot, 'node_sqlite3.node');
    if (!fs.existsSync(bindingTarget)) {
        fs.copyFileSync(bindingSource, bindingTarget);
    }

    const sqlite3Entry = require.resolve('sqlite3');
    const bindingModulePath = path.join(path.dirname(sqlite3Entry), 'sqlite3-binding.js');
    const Module = require('module');
    const bindingModule = new Module(bindingModulePath);
    process.dlopen(bindingModule, bindingTarget);
    bindingModule.loaded = true;
    require.cache[bindingModulePath] = bindingModule;
}

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.db');
let resolveTournamentSchema;
let rejectTournamentSchema;
const tournamentSchemaReady = new Promise((resolve, reject) => {
    resolveTournamentSchema = resolve;
    rejectTournamentSchema = reject;
});
const userProfileColumns = [
    ['avatar_frame_color', "TEXT NOT NULL DEFAULT '#00f0ff'"],
    ['avatar_frame_style', "TEXT NOT NULL DEFAULT 'neon'"]
];
const teamProfileColumns = [
    ['is_hidden', 'INTEGER NOT NULL DEFAULT 0']
];

function ensureTableColumns(tableName, columnsToEnsure, callback) {
    db.all(`PRAGMA table_info(${tableName})`, (schemaError, columns) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }
        const existingColumns = new Set(columns.map(column => column.name));
        const missingColumns = columnsToEnsure.filter(([column]) => !existingColumns.has(column));
        const addNextColumn = index => {
            if (index >= missingColumns.length) {
                callback(null);
                return;
            }
            const [column, definition] = missingColumns[index];
            db.run(`ALTER TABLE ${tableName} ADD COLUMN ${column} ${definition}`, migrationError => {
                if (migrationError) {
                    callback(migrationError);
                    return;
                }
                addNextColumn(index + 1);
            });
        };
        addNextColumn(0);
    });
}

function ensureProfileCustomizationColumns(callback) {
    ensureTableColumns('user_profiles', userProfileColumns, profileError => {
        if (profileError) {
            callback(profileError);
            return;
        }
        ensureTableColumns('team_profiles', teamProfileColumns, callback);
    });
}

function ensureTeamAndMatchTables(callback) {
    db.run(`
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            team_key TEXT NOT NULL UNIQUE,
            game TEXT NOT NULL,
            captain_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `, error => {
        if (error) return callback(error);
        db.run(`
            CREATE TABLE IF NOT EXISTS team_members (
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('captain', 'player')),
                joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (team_id, user_id),
                UNIQUE (user_id)
            )
        `, memberError => {
            if (memberError) return callback(memberError);
            db.run(`
                CREATE TABLE IF NOT EXISTS team_join_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected')),
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (team_id, user_id)
                )
            `, requestError => {
                if (requestError) return callback(requestError);
                db.run(`
                    CREATE TABLE IF NOT EXISTS match_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
                        round_index INTEGER NOT NULL,
                        match_index INTEGER NOT NULL,
                        team1 TEXT NOT NULL,
                        team2 TEXT NOT NULL,
                        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        message TEXT NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `, messageError => {
                    if (messageError) return callback(messageError);
                    db.all('PRAGMA table_info(match_messages)', (messageSchemaError, columns) => {
                        if (messageSchemaError) return callback(messageSchemaError);
                        const existingColumns = new Set(columns.map(column => column.name));
                        const missingColumns = ['team1', 'team2'].filter(column => !existingColumns.has(column));
                        const addColumn = index => {
                            if (index >= missingColumns.length) {
                                db.run(`
                                    CREATE INDEX IF NOT EXISTS idx_match_messages_room
                                    ON match_messages(tournament_id, round_index, match_index, id)
                                `, callback);
                                return;
                            }
                            db.run(`ALTER TABLE match_messages ADD COLUMN ${missingColumns[index]} TEXT`, columnError => {
                                if (columnError) return callback(columnError);
                                addColumn(index + 1);
                            });
                        };
                        addColumn(0);
                    });
                });
            });
        });
    });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к SQLite:', err.message);
    } else {
        console.log(`Подключено к локальной базе данных SQLite (${dbPath})`);
    }
});
db.run('PRAGMA foreign_keys = ON');

// Инициализация таблиц и создание стандартного админа
db.serialize(async () => {
    // 1. Таблица пользователей
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'ROLE_USER',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        UPDATE users
        SET role = CASE
            WHEN username = 'admin' THEN 'ROLE_SUPER_ADMIN'
            WHEN role = 'ROLE_ADMIN' THEN 'ROLE_ADMIN_SENIOR'
            ELSE role
        END
        WHERE username = 'admin' OR role = 'ROLE_ADMIN'
    `);

    // 2. Таблица турниров
    db.run(`
        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            bracket_data TEXT NOT NULL,
            game TEXT NOT NULL DEFAULT '',
            prize_amount REAL NOT NULL DEFAULT 0,
            prize_currency TEXT NOT NULL DEFAULT 'USD',
            team_size INTEGER NOT NULL DEFAULT 0,
            start_date TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'upcoming',
            description TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS team_match_results (
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            round_index INTEGER NOT NULL,
            match_index INTEGER NOT NULL,
            team1 TEXT NOT NULL,
            team2 TEXT NOT NULL,
            winner TEXT NOT NULL,
            PRIMARY KEY (tournament_id, round_index, match_index)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS leaderboard_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            seeded INTEGER NOT NULL DEFAULT 0
        )
    `);
    db.run('INSERT OR IGNORE INTO leaderboard_meta (id, seeded) VALUES (1, 0)');
    db.run(`
        CREATE TABLE IF NOT EXISTS user_policy_consents (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            agreement_version TEXT NOT NULL,
            privacy_version TEXT NOT NULL,
            accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            avatar_data TEXT,
            cover_data TEXT,
            avatar_frame_color TEXT NOT NULL DEFAULT '#00f0ff',
            avatar_frame_style TEXT NOT NULL DEFAULT 'neon',
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS team_profiles (
            owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            team_key TEXT NOT NULL,
            team_name TEXT NOT NULL,
            avatar_data TEXT,
            is_hidden INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (owner_user_id, team_key)
        )
    `);

    // 3. Заявки пользователей на турниры
    db.run(`
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            team_name TEXT NOT NULL,
            captain_contact TEXT NOT NULL,
            roster TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TEXT,
            bracket_added_at TEXT,
            registry_removed_at TEXT
        )
    `);

    const tournamentColumns = {
        game: "TEXT NOT NULL DEFAULT ''",
        prize_amount: 'REAL NOT NULL DEFAULT 0',
        prize_currency: "TEXT NOT NULL DEFAULT 'USD'",
        team_size: 'INTEGER NOT NULL DEFAULT 0',
        start_date: "TEXT NOT NULL DEFAULT ''",
        status: "TEXT NOT NULL DEFAULT 'upcoming'",
        description: "TEXT NOT NULL DEFAULT ''"
    };

    db.all('PRAGMA table_info(tournaments)', (err, columns) => {
        if (err) {
            console.error('Ошибка проверки схемы турниров:', err.message);
            rejectTournamentSchema(err);
            return;
        }

        const existingColumns = new Set(columns.map(column => column.name));
        const missingColumns = Object.entries(tournamentColumns)
            .filter(([column]) => !existingColumns.has(column));
        const createNotificationsTable = () => {
            db.run(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    is_read INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (notificationError) => {
                if (notificationError) {
                    console.error('Ошибка создания таблицы уведомлений:', notificationError.message);
                    rejectTournamentSchema(notificationError);
                } else {
                    db.all('PRAGMA table_info(applications)', (applicationSchemaError, applicationColumns) => {
                        if (applicationSchemaError) {
                            console.error('Ошибка проверки заявок:', applicationSchemaError.message);
                            rejectTournamentSchema(applicationSchemaError);
                            return;
                        }
                        const existingApplicationColumns = new Set(applicationColumns.map(column => column.name));
                        const applicationMigrations = [
                            ['reviewed_at', 'TEXT'],
                            ['bracket_added_at', 'TEXT'],
                            ['registry_removed_at', 'TEXT']
                        ].filter(([column]) => !existingApplicationColumns.has(column));
                        const createSupportMessagesTable = () => {
                            db.run(`
                                CREATE TABLE IF NOT EXISTS support_messages (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                    message TEXT NOT NULL,
                                    is_read INTEGER NOT NULL DEFAULT 0,
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `, (chatError) => {
                                if (chatError) {
                                    console.error('Ошибка создания таблицы чата поддержки:', chatError.message);
                                    rejectTournamentSchema(chatError);
                                } else {
                                    db.run(`
                                        CREATE TABLE IF NOT EXISTS support_conversations (
                                            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                            user_resolved_at TEXT,
                                            admin_resolved_at TEXT,
                                            closed_at TEXT,
                                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                        )
                                    `, (conversationError) => {
                                        if (conversationError) {
                                            console.error('Ошибка создания статусов чата поддержки:', conversationError.message);
                                            rejectTournamentSchema(conversationError);
                                            return;
                                        }
                                        db.run(`
                                            CREATE TABLE IF NOT EXISTS user_restrictions (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                admin_id INTEGER NOT NULL REFERENCES users(id),
                                                reason_code TEXT NOT NULL,
                                                reason_details TEXT NOT NULL DEFAULT '',
                                                starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                expires_at DATETIME,
                                                revoked_at DATETIME,
                                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                            )
                                        `, (restrictionError) => {
                                            if (restrictionError) {
                                                console.error('Ошибка создания ограничений пользователей:', restrictionError.message);
                                                rejectTournamentSchema(restrictionError);
                                                return;
                                            }
                                            db.run('CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id, id)', (messageIndexError) => {
                                                if (messageIndexError) {
                                                    console.error('Ошибка создания индекса сообщений поддержки:', messageIndexError.message);
                                                    rejectTournamentSchema(messageIndexError);
                                                    return;
                                                }
                                                db.run(`
                                                    CREATE TABLE IF NOT EXISTS admin_audit_logs (
                                                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                        admin_id INTEGER NOT NULL REFERENCES users(id),
                                                        action TEXT NOT NULL,
                                                        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                                                        details_json TEXT NOT NULL DEFAULT '{}',
                                                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                                    )
                                                `, (auditTableError) => {
                                                    if (auditTableError) {
                                                        console.error('Ошибка создания журнала действий администраторов:', auditTableError.message);
                                                        rejectTournamentSchema(auditTableError);
                                                        return;
                                                    }
                                                    db.run('CREATE INDEX IF NOT EXISTS idx_user_restrictions_active ON user_restrictions(user_id, revoked_at, expires_at)', (restrictionIndexError) => {
                                                    if (restrictionIndexError) {
                                                        console.error('Ошибка создания индекса ограничений пользователей:', restrictionIndexError.message);
                                                        rejectTournamentSchema(restrictionIndexError);
                                                        return;
                                                    }
                                                    db.run('CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC, id DESC)', (auditIndexError) => {
                                                        if (auditIndexError) {
                                                            console.error('Ошибка создания индекса журнала администраторов:', auditIndexError.message);
                                                            rejectTournamentSchema(auditIndexError);
                                                            return;
                                                        }
                                                        ensureProfileCustomizationColumns(profileColumnError => {
                                                            if (profileColumnError) {
                                                                console.error('Ошибка обновления настройки рамки профиля:', profileColumnError.message);
                                                                rejectTournamentSchema(profileColumnError);
                                                                return;
                                                            }
                                                            ensureTeamAndMatchTables(teamTableError => {
                                                                if (teamTableError) {
                                                                    console.error('Ошибка создания таблиц команд и матчей:', teamTableError.message);
                                                                    rejectTournamentSchema(teamTableError);
                                                                    return;
                                                                }
                                                                resolveTournamentSchema();
                                                            });
                                                        });
                                                    });
                                                });
                                                });
                                            });
                                        });
                                    });
                                }
                             });
                        };
                        if (!applicationMigrations.length) {
                            createSupportMessagesTable();
                            return;
                        }
                        let applicationMigrationsRemaining = applicationMigrations.length;
                        applicationMigrations.forEach(([column, definition]) => {
                            db.run(`ALTER TABLE applications ADD COLUMN ${column} ${definition}`, (migrationError) => {
                                if (migrationError) {
                                    console.error(`Ошибка добавления поля ${column} в заявки:`, migrationError.message);
                                    rejectTournamentSchema(migrationError);
                                    return;
                                }
                                applicationMigrationsRemaining -= 1;
                                if (applicationMigrationsRemaining === 0) {
                                    createSupportMessagesTable();
                                }
                            });
                        });
                    });
                }
            });
        };

        if (missingColumns.length === 0) {
            createNotificationsTable();
            return;
        }

        let migrationsRemaining = missingColumns.length;
        missingColumns.forEach(([column, definition]) => {
            db.run(`ALTER TABLE tournaments ADD COLUMN ${column} ${definition}`, (migrationError) => {
                if (migrationError) {
                    console.error(`Ошибка добавления поля ${column}:`, migrationError.message);
                    rejectTournamentSchema(migrationError);
                    return;
                }
                migrationsRemaining -= 1;
                if (migrationsRemaining === 0) createNotificationsTable();
            });
        });
    });

    // 4. Автоматическое создание базового аккаунта Администратора
    const defaultAdminUsername = 'admin';
    const defaultAdminPassword = 'admin123';

    db.get('SELECT * FROM users WHERE username = ?', [defaultAdminUsername], async (err, row) => {
        if (err) {
            console.error('Ошибка проверки админа:', err.message);
            return;
        }

        // Если админа еще нет в базе — создаем его
        if (!row) {
            const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);
            db.run(
                'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
                [defaultAdminUsername, hashedPassword, 'ROLE_SUPER_ADMIN'],
                (insertErr) => {
                    if (insertErr) {
                        console.error('Ошибка создания дефолтного админа:', insertErr.message);
                    } else {
                        console.log('--------------------------------------------------');
                        console.log('👑 Создан дефолтный администратор:');
                        console.log(`   Логин:  ${defaultAdminUsername}`);
                        console.log(`   Пароль: ${defaultAdminPassword}`);
                        console.log('--------------------------------------------------');
                    }
                }
            );
        }
    });
});

// Адаптер для async/await запросов
module.exports = {
    query: async (sql, params = []) => {
        await tournamentSchemaReady;
        return new Promise((resolve, reject) => {
            const sqliteSql = sql.replace(/\$\d+/g, '?');

            if (sqliteSql.trim().toUpperCase().startsWith('SELECT')) {
                db.all(sqliteSql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                });
            } else {
                db.run(sqliteSql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ rows: [], lastID: this.lastID, changes: this.changes });
                });
            }
        });
    }
};