import axios from 'axios';
import { API_CONFIG } from './apiConfig';
import { pedirPin } from '../components/ui/PedidoPin';

// Variáveis para controle de Concorrência no Refresh Token
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token!);
        }
    });
    failedQueue = [];
};

const apiClient = axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Keep-alive: pinga o backend a cada 9 minutos para evitar cold start do Render
// (o Render free tier dorme após 15 minutos sem requisições)
if (typeof window !== 'undefined') {
    const keepAlive = () => {
        axios.get(`${API_CONFIG.BASE_URL}/health`, { timeout: 5000 }).catch(() => {/* silencioso */});
    };
    setInterval(keepAlive, 9 * 60 * 1000); // 9 minutos
}

const shouldRetryRequest = (error: any): boolean => {
    const cfg = error?.config;
    if (!cfg) return false;
    const method = String(cfg.method || 'get').toLowerCase();
    const isGet = method === 'get';
    const isTimeout = error?.code === 'ECONNABORTED';
    const isNetwork = !error?.response && !!error?.request;
    const retryCount = cfg.__retryCount || 0;
    return isGet && (isTimeout || isNetwork) && retryCount < 1;
};

// Request interceptor para adicionar token e sanitizar URLs
apiClient.interceptors.request.use(
    (config) => {
        // CORREÇÃO DEFINITIVA: Sanitizar baseURL e URL para evitar vazamento de host interno
        const sanitize = (val: string | undefined): string | undefined => {
            if (!val) return val;
            // Se a URL contiver o host interno do Docker ou 'backend', reduz para caminho relativo
            if (/backend|:\d+|https?:\/\//.test(val) && (val.includes('backend') || val.includes(':5000'))) {
                const parts = val.split('/api');
                const path = parts.length > 1 ? `/api${parts[1]}` : val.replace(/^https?:\/\/[^/]+/, '');
                return path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
            }
            return val;
        };

        config.baseURL = sanitize(config.baseURL);
        config.url = sanitize(config.url);

        const token = sessionStorage.getItem('access_token');
        if (token && token !== 'undefined' && token !== 'null') {
            config.headers.Authorization = `Bearer ${token}`;
        } else if (import.meta.env.DEV) {
            console.warn(`⚠️ Request sem token para: ${config.url}. LocalStorage access_token:`, token);
        }

        // DEBUG: Log headers for auth issues
        if (import.meta.env.DEV) {
            console.debug(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
                hasToken: !!token,
                tokenType: typeof token,
                tokenValue: token ? `${token.substring(0, 10)}...` : 'none'
            });
        }

        // Injeção de Contexto Super-Admin (Impersonation)
        const selectedEstabId = sessionStorage.getItem('selected_establishment_id');
        if (selectedEstabId) {
            config.headers['X-Establishment-ID'] = selectedEstabId;
        }

        const superAdminTenantId = sessionStorage.getItem('mercadinhosys_superadmin_tenant');
        if (superAdminTenantId) {
            config.headers['X-Impersonate-Tenant-Id'] = superAdminTenantId;
        }

        // Debug log para upload de logo
        if (config.url?.includes('logo')) {
            console.log('🚀 Upload Request:', {
                method: config.method,
                url: config.baseURL + config.url,
                hasToken: !!token,
                hasFile: !!config.data
            });
        }

        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor para tratamento de erros
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (shouldRetryRequest(error)) {
            originalRequest.__retryCount = (originalRequest.__retryCount || 0) + 1;
            await new Promise((resolve) => setTimeout(resolve, 800));
            return apiClient(originalRequest);
        }

        // Ação que a loja configurou para exigir PIN de Admin/Gerente: pede o PIN e
        // refaz a mesma requisição. PIN errado pede de novo; o servidor trava após 5 erros (429).
        const corpoErro = error.response?.data;
        if (error.response?.status === 403 && corpoErro?.code === 'PIN_REQUIRED' && corpoErro?.pin_por_header && originalRequest) {
            const jaTentou = !!originalRequest.headers?.['X-PIN-Autorizacao'];
            const pin = await pedirPin({
                acao: corpoErro.acao_rotulo,
                erro: jaTentou ? 'PIN incorreto. Tente de novo.' : undefined,
            });
            if (pin) {
                originalRequest.headers = { ...(originalRequest.headers || {}), 'X-PIN-Autorizacao': pin };
                return apiClient(originalRequest);
            }
            return Promise.reject(error);
        }

        // Se for 401 e não for uma retentativa
        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                // Se já estiver atualizando, adiciona à fila
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        originalRequest.headers['Authorization'] = `Bearer ${token}`;
                        return apiClient(originalRequest);
                    })
                    .catch((err) => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const refreshToken = sessionStorage.getItem('refresh_token');

                if (!refreshToken || refreshToken === 'undefined' || refreshToken === 'null') {
                    throw new Error('No refresh token available');
                }

                // Tenta renovar o token
                console.log('🔄 Tentando refresh token...');
                const response = await axios.post(`${API_CONFIG.BASE_URL}/auth/refresh`, {}, {
                    headers: {
                        'Authorization': `Bearer ${refreshToken}`
                    }
                });

                const { access_token } = response.data;

                if (!access_token) {
                    throw new Error('No access token returned');
                }

                sessionStorage.setItem('access_token', access_token);
                apiClient.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
                originalRequest.headers['Authorization'] = `Bearer ${access_token}`;

                // Processa fila com sucesso
                processQueue(null, access_token);

                // Retorna a requisição original
                return apiClient(originalRequest);

            } catch (refreshError: any) {
                // Processa fila com erro
                processQueue(refreshError, null);

                const errorInfo = {
                    message: refreshError.message,
                    status: refreshError.response?.status,
                    data: refreshError.response?.data,
                    timestamp: new Date().toISOString()
                };
                localStorage.setItem('mercadinhosys_last_refresh_error', JSON.stringify(errorInfo));

                console.error('❌ Refresh token falhou!', errorInfo);

                // Remover tokens inválidos
                sessionStorage.removeItem('access_token');
                sessionStorage.removeItem('refresh_token');
                sessionStorage.removeItem('user_data');

                // Redirecionar para login automaticamente após pequeno delay
                setTimeout(() => {
                    window.location.href = '/login?reason=session_expired';
                }, 100);

                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        } else if (error.response?.status === 401 && originalRequest._retry) {
            // Falha após tentativa de refresh: limpa sessão e redireciona para login
            console.error('❌ Falha após refresh; redirecionando para login');
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('refresh_token');

            if (import.meta.env.DEV) {
                // debugger;
            }

            setTimeout(() => {
                window.location.href = '/login';
            }, 1000);

            return Promise.reject(error);
        }

        // Se não for 401 ou se falhou após retry, loga o erro
        if (error.response) {
            // Ignora log de 401 se foi tratado (embora aqui só chegue se não foi tratado ou se falhou)
            // Se falhou o refresh, já logamos no catch acima.
            // Se for outro erro (500, 404, etc) logamos aqui.
            console.error('❌ API Error:', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
            });
        } else if (error.request) {
            console.error('❌ Network Error:', {
                url: error.config?.url,
                message: error.code === 'ECONNABORTED' ? 'Timeout na resposta do servidor' : 'Sem resposta do servidor',
                baseURL: API_CONFIG.BASE_URL,
            });
        } else {
            console.error('❌ Request Error:', error.message);
        }

        // Tratamento específico para 403 - Acesso Negado
        if (error.response?.status === 403) {
            console.error('❌ Acesso Negado (403):', {
                url: error.config?.url,
                method: error.config?.method,
                data: error.response.data,
                message: 'Você não tem permissão para acessar este recurso'
            });
            
            // Se for erro de permissão, podemos mostrar mensagem amigável
            const errorData = error.response.data;
            const errorMsg = errorData?.msg || errorData?.error || 'Acesso negado';
            
            // Mostrar toast de erro (se tiver toast disponível)
            if (typeof window !== 'undefined' && (window as any).showToast) {
                (window as any).showToast(errorMsg, 'error');
            }
            
            return Promise.reject(error);
        }

        // Tratamento específico para 422 (Token malformado etc)
        if (error.response?.status === 422) {
            const msg =
                typeof error.response.data === 'object' &&
                    error.response.data !== null &&
                    'msg' in error.response.data
                    ? String((error.response.data as { msg?: unknown }).msg || '')
                    : '';
            const looksLikeJwt =
                msg.toLowerCase().includes('token') ||
                msg.toLowerCase().includes('jwt') ||
                msg.toLowerCase().includes('segments') ||
                msg.toLowerCase().includes('authorization');
            const token = sessionStorage.getItem('access_token');
            if (looksLikeJwt || token === 'undefined' || token === 'null') {
                sessionStorage.removeItem('access_token');
                sessionStorage.removeItem('refresh_token');
                window.location.href = '/login';
            }
        }

        return Promise.reject(error);
    }
);

export { apiClient };
