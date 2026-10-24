const API = {
    async request(endpoint, options = {}) {
        const token = localStorage.getItem('token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers
        };
        try {
            const response = await fetch(`/api${endpoint}`, {
                ...options,
                cache: options.cache || 'no-store',
                headers
            });
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.toLowerCase().includes('application/json')) {
                throw new Error(
                    `Сервер вернул HTML вместо JSON для /api${endpoint} (HTTP ${response.status}). Перезапустите актуальный backend проекта.`
                );
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Ошибка API');
            return data;
        } catch (error) {
            console.error(`Ошибка [${endpoint}]:`, error);
            throw error;
        }
    },
    async login(username, password) { return await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); },
    async register(username, password, consents) { return await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, ...consents }) }); },
    async getTournaments() { return await this.request('/tournaments'); },
    async getProfile() { return await this.request('/profile'); },
    async updateProfile(profile) { return await this.request('/profile', { method: 'PUT', body: JSON.stringify(profile) }); },
    async updateTeamProfile(teamName, avatarData) { return await this.request(`/profile/teams/${encodeURIComponent(teamName)}`, { method: 'PUT', body: JSON.stringify({ avatarData }) }); },
    async hideProfileTeam(teamName) { return await this.request(`/profile/teams/${encodeURIComponent(teamName)}`, { method: 'DELETE' }); },
    async getTeamLeaderboard() { return await this.request('/teams/leaderboard'); },
    async getTeams() { return await this.request('/teams'); },
    async getTeamByName(teamName) { return await this.request(`/teams/by-name/${encodeURIComponent(teamName)}`); },
    async getMyTeam() { return await this.request('/teams/mine'); },
    async createTeam(data) { return await this.request('/teams', { method: 'POST', body: JSON.stringify(data) }); },
    async requestToJoinTeam(teamId) { return await this.request(`/teams/${teamId}/join-requests`, { method: 'POST' }); },
    async reviewTeamJoinRequest(teamId, requestId, status) { return await this.request(`/teams/${teamId}/join-requests/${requestId}`, { method: 'PUT', body: JSON.stringify({ status }) }); },
    async leaveTeam() { return await this.request('/teams/membership', { method: 'DELETE' }); },
    async removeTeamMember(teamId, userId) { return await this.request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }); },
    async deleteTeam(teamId) { return await this.request(`/teams/${teamId}`, { method: 'DELETE' }); },
    async getMatchMessages(tournamentId, roundIndex, matchIndex) { return await this.request(`/matches/${tournamentId}/${roundIndex}/${matchIndex}/messages`); },
    async sendMatchMessage(tournamentId, roundIndex, matchIndex, message) { return await this.request(`/matches/${tournamentId}/${roundIndex}/${matchIndex}/messages`, { method: 'POST', body: JSON.stringify({ message }) }); },
    async clearTeamLeaderboard() { return await this.request('/admin/teams/leaderboard', { method: 'DELETE' }); },
    async getTournamentById(id) { return await this.request(`/tournaments/${id}`); },
    async createTournament(data) { return await this.request('/tournaments', { method: 'POST', body: JSON.stringify(data) }); },
    async updateTournament(id, data) { return await this.request(`/tournaments/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
    async updateTournamentBracket(id, bracketData) { return await this.updateTournament(id, { bracketData }); },
    async deleteTournament(id) { return await this.request(`/tournaments/${id}`, { method: 'DELETE' }); },
    async submitApplication(data) { return await this.request('/applications', { method: 'POST', body: JSON.stringify(data) }); },
    async getApplications() { return await this.request('/applications'); },
    async updateApplicationStatus(id, status) { return await this.request(`/applications/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); },
    async getAcceptedTeams() { return await this.request('/admin/accepted-teams'); },
    async removeAcceptedTeam(id) { return await this.request(`/admin/accepted-teams/${id}`, { method: 'DELETE' }); },
    async clearAcceptedTeams() { return await this.request('/admin/accepted-teams', { method: 'DELETE' }); },
    async addAcceptedTeamToBracket(id) { return await this.request(`/applications/${id}/add-to-bracket`, { method: 'POST' }); },
    async getNotifications() { return await this.request('/notifications'); },
    async markNotificationsRead() { return await this.request('/notifications/read', { method: 'PUT' }); },
    async getUserChatMessages() { return await this.request('/chat/messages'); },
    async getUserChatUnreadCount() { return await this.request('/chat/unread-count'); },
    async getUserChatStatus() { return await this.request('/chat/status'); },
    async setUserChatResolved(resolved) { return await this.request('/chat/resolution', { method: 'PATCH', body: JSON.stringify({ resolved }) }); },
    async sendUserChatMessage(message) { return await this.request('/chat/messages', { method: 'POST', body: JSON.stringify({ message }) }); },
    async getAdminChats() { return await this.request('/admin/chats'); },
    async getAdminChatMessages(userId) { return await this.request(`/admin/chats/${userId}/messages`); },
    async sendAdminChatMessage(userId, message) { return await this.request(`/admin/chats/${userId}/messages`, { method: 'POST', body: JSON.stringify({ message }) }); },
    async setAdminChatResolved(userId, resolved) { return await this.request(`/admin/chats/${userId}/resolution`, { method: 'PATCH', body: JSON.stringify({ resolved }) }); },
    async restrictChatUser(userId, restriction) { return await this.request(`/admin/chats/${userId}/restriction`, { method: 'POST', body: JSON.stringify(restriction) }); },
    async liftChatUserRestriction(userId) { return await this.request(`/admin/chats/${userId}/restriction`, { method: 'DELETE' }); },
    async restrictUser(userId, restriction) { return await this.request(`/admin/users/${userId}/restriction`, { method: 'POST', body: JSON.stringify(restriction) }); },
    async liftUserRestriction(userId) { return await this.request(`/admin/users/${userId}/restriction`, { method: 'DELETE' }); },
    async getUsers() { return await this.request('/admin/users'); },
    async getAdminAuditLogs() { return await this.request('/admin/audit-logs'); },
    async updateUserRole(userId, role) { return await this.request(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); },
    async getStats() { return await this.request('/stats'); }
};