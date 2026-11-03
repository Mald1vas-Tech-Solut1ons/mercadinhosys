import { showToast } from '../../utils/toast';
import { API_CONFIG } from '../../api/apiConfig';

/** Entra na loja de demonstração (landing e páginas de nicho usam o mesmo botão). */
export async function entrarNaDemo() {
    try {
        showToast.loading('Preparando ambiente de demonstração...');
        const response = await fetch(`${API_CONFIG.BASE_URL}/auth/demo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (response.ok && result.success) {
            const data = result.data || {};
            const access_token = data.access_token || result.access_token;
            const refresh_token = data.refresh_token || result.refresh_token;
            const user = data.user;
            const estabelecimento = data.estabelecimento;

            if (access_token) sessionStorage.setItem('access_token', access_token);
            if (refresh_token) sessionStorage.setItem('refresh_token', refresh_token);
            if (user) sessionStorage.setItem('user_data', JSON.stringify(user));
            if (estabelecimento) localStorage.setItem('estabelecimento_data', JSON.stringify(estabelecimento));

            window.dispatchEvent(new Event('auth-change'));
            showToast.dismiss();
            showToast.info('Entrando no ambiente de demonstração...', { icon: '✨' });
            setTimeout(() => { window.location.href = '/dashboard'; }, 500);
        } else {
            showToast.dismiss();
            showToast.error(result.error || 'Erro ao acessar demonstração');
        }
    } catch {
        showToast.dismiss();
        showToast.error('Erro de conexão com o servidor demo.');
    }
}
