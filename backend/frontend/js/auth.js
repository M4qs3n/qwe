const Auth = {
    setToken(token) { localStorage.setItem('token', token); },
    getToken() { return localStorage.getItem('token'); },
    removeToken() { localStorage.removeItem('token'); },
    getUser() {
        const token = this.getToken();
        if (!token) return null;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload;
        } catch (e) { 
            console.error('Ошибка расшифровки токена:', e);
            return null; 
        }
    },
    logout() {
        this.removeToken();
        window.location.reload();
    }
};

let isLoginMode = true;
const USER_AGREEMENT_VERSION = '2026-10-09';
const PRIVACY_POLICY_VERSION = '2026-10-09';

function openAuthPage(mode) {
    switchAuthTab(mode);
    showPage('page-auth');
}

function switchAuthTab(mode) {
    isLoginMode = (mode === 'login');
    document.getElementById('tab-login-btn').classList.toggle('active', isLoginMode);
    document.getElementById('tab-reg-btn').classList.toggle('active', !isLoginMode);
    document.getElementById('auth-submit-btn').innerText = isLoginMode ? 'ВОЙТИ В АРЕНУ' : 'СОЗДАТЬ АККАУНТ';
    const consentSection = document.getElementById('registration-consents');
    consentSection.hidden = isLoginMode;
    consentSection.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.required = !isLoginMode;
        if (isLoginMode) input.checked = false;
    });
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value;

    if (!user || !pass) {
        alert('Заполните имя пользователя и пароль');
        return;
    }

    try {
        let res;
        if (isLoginMode) {
            res = await API.login(user, pass);
        } else {
            const agreementAccepted = document.getElementById('agreement-consent').checked;
            const privacyConsent = document.getElementById('privacy-consent').checked;
            if (!agreementAccepted || !privacyConsent) {
                alert('Для регистрации примите пользовательское соглашение и дайте согласие на обработку персональных данных.');
                return;
            }
            res = await API.register(user, pass, {
                agreementAccepted,
                privacyConsent,
                agreementVersion: USER_AGREEMENT_VERSION,
                privacyVersion: PRIVACY_POLICY_VERSION
            });
        }

        // В случае старого бэкенда / нестандартного ответа делаем fallback на автоматический вход.
        if (!res.token && !res.accessToken && !res.access_token && !isLoginMode) {
            res = await API.login(user, pass);
        }

        const token = res.token || res.accessToken || res.access_token;
        if (!token) throw new Error('Сервер ответил успешно, но не прислал токен.');

        Auth.setToken(token);
        window.location.reload();
    } catch (err) {
        alert('Ошибка авторизации: ' + err.message);
    }
}