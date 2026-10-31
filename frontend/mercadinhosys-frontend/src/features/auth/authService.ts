// src/features/auth/authService.ts
import axios from 'axios';
import { LoginApiResponse } from '../../types';
import { API_CONFIG } from '../../api/apiConfig';
import { viewSchemaService } from '../../services/viewSchemaService';
import { limparCarrinhosPdv } from '../../utils/pdvStorage';

const API_URL = API_CONFIG.BASE_URL;

class AuthService {
    async login(identifier: string, password: string): Promise<LoginApiResponse> {
        console.log('📤 Enviando para backend:', { identifier });

        // ✅ Estrutura CORRETA para o backend (Flexibilidade Total)
        const loginData = {
            identifier: identifier,
            username: identifier,
            email: identifier.includes('@') ? identifier : undefined,
            senha: password,
            password: password,
            estabelecimento_id: identifier
        };

        try {
            const response = await axios.post(
                `${API_URL}/auth/login`,
                loginData,
                {
                    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': identifier },
                    timeout: API_CONFIG.TIMEOUT
                }
            );

            const data = response.data;

            // ✅ Validação robusta da resposta (Tokens na Raiz)
            if (!data || typeof data !== 'object') {
                throw new Error('Resposta inválida do servidor');
            }

            if (!data.success) {
                throw new Error(data.error || 'Login falhou');
            }

            if (!data.access_token || !data.data?.user) {
                throw new Error('Dados de autenticação incompletos');
            }

            // ✅ Salva tokens com Blindagem contra "undefined"
            if (data.access_token && String(data.access_token) !== 'undefined' && String(data.access_token) !== 'null') {
                sessionStorage.setItem('access_token', data.access_token);
                console.log('🗝️ Access Token persistido');
            } else {
                console.error('⚠️ Tentativa de salvar Access Token inválido detectada!');
            }

            if (data.refresh_token && String(data.refresh_token) !== 'undefined' && String(data.refresh_token) !== 'null') {
                sessionStorage.setItem('refresh_token', data.refresh_token);
                console.log('🔐 Refresh Token persistido');
            }

            if (data.data?.user) {
                sessionStorage.setItem('user_data', JSON.stringify(data.data.user));
            }

            if (data.data?.estabelecimento) {
                localStorage.setItem('estabelecimento_data', JSON.stringify(data.data.estabelecimento));
            }

            // Schema contextual é por tenant/segmento — nunca reaproveitar entre logins.
            viewSchemaService.invalidate();
            // Dispara evento para atualizar estado de autenticação
            window.dispatchEvent(new Event('auth-change'));

            console.log('✅ Tokens e dados de sessão salvos com sucesso');
            return data;

        } catch (error: unknown) {
            const err = error as { message?: string; response?: { status?: number; data?: unknown } };
            console.error('❌ Erro no authService:', {
                message: err.message,
                status: err.response?.status,
                data: err.response?.data
            });

            // ✅ Limpa tokens em caso de erro
            this.logout();
            throw error;
        }
    }

    async bootstrapAdmin(identifier: string, password: string): Promise<{ success: boolean; message?: string; error?: string; code?: string }> {
        const bootstrapData = {
            email: identifier.includes('@') ? identifier : undefined,
            username: !identifier.includes('@') ? identifier : undefined,
            identifier,
            senha: password,
            password,
            estabelecimento_id: identifier
        };

        try {
            const response = await axios.post(
                `${API_URL}/auth/bootstrap`,
                bootstrapData,
                {
                    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': identifier },
                    timeout: API_CONFIG.TIMEOUT
                }
            );
            const data = response.data as { success: boolean; message?: string; error?: string; code?: string };
            if (!data || typeof data !== 'object') {
                throw new Error('Resposta inválida do servidor');
            }
            return data;
        } catch (error: unknown) {
            const err = error as { message?: string; response?: { status?: number; data?: any } };
            const serverData = err.response?.data;
            return {
                success: false,
                error: serverData?.error || err.message || 'Erro ao executar bootstrap',
                code: serverData?.code
            };
        }
    }

    async registerAccount(payload: any): Promise<{ success: boolean; message?: string; estabelecimento_id?: number }> {
        try {
            const response = await axios.post(
                `${API_URL}/onboarding/registrar`,
                payload,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: API_CONFIG.TIMEOUT
                }
            );
            const data = response.data;
            if (!data || typeof data !== 'object') {
                throw new Error('Resposta inválida do servidor');
            }
            if (!data.success) {
                throw new Error(data.error || 'Falha ao registrar conta');
            }
            return data;
        } catch (error: unknown) {
            const err = error as { message?: string; response?: { status?: number; data?: any } };
            const serverData = err.response?.data;
            throw new Error(serverData?.error || err.message || 'Erro ao registrar conta');
        }
    }

    async updateProfile(payload: { nome?: string; email?: string; telefone?: string; foto_url?: string }): Promise<{ success: boolean; data?: { nome?: string; email?: string; telefone?: string; foto_url?: string }; message?: string }> {
        const token = this.getToken();
        if (!token) {
            throw new Error('Usuário não autenticado');
        }
        try {
            const response = await axios.put(
                `${API_URL}/auth/profile`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    timeout: API_CONFIG.TIMEOUT
                }
            );
            const data = response.data as { success: boolean; data?: { nome?: string; email?: string; telefone?: string; foto_url?: string }; message?: string; error?: string };
            if (!data || typeof data !== 'object') {
                throw new Error('Resposta inválida do servidor');
            }
            if (!data.success) {
                throw new Error(data.error || 'Falha ao atualizar perfil');
            }
            return { success: true, data: data.data, message: data.message || 'Perfil atualizado' };
        } catch (error: unknown) {
            const err = error as { message?: string; response?: { status?: number; data?: unknown } };
            const respData = err.response?.data as { error?: string; message?: string } | undefined;
            const serverMessage = respData?.error || respData?.message;
            throw new Error(serverMessage || err.message || 'Erro ao atualizar perfil');
        }
    }

    async changePassword(senhaAtual: string, novaSenha: string): Promise<{ success: boolean; message?: string }> {
        const token = this.getToken();
        if (!token) {
            throw new Error('Usuário não autenticado');
        }
        try {
            const response = await axios.put(
                `${API_URL}/auth/profile`,
                { senha_atual: senhaAtual, nova_senha: novaSenha },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    timeout: API_CONFIG.TIMEOUT
                }
            );
            const data = response.data;
            if (!data || typeof data !== 'object') {
                throw new Error('Resposta inválida do servidor');
            }
            if (!data.success) {
                throw new Error(data.error || 'Falha ao alterar senha');
            }
            this.logout();
            return { success: true, message: data.message || 'Senha alterada com sucesso' };
        } catch (error: unknown) {
            const err = error as { message?: string; response?: { status?: number; data?: unknown } };
            const respData = err.response?.data as { error?: string; message?: string } | undefined;
            const serverMessage = respData?.error || respData?.message;
            throw new Error(serverMessage || err.message || 'Erro ao alterar senha');
        }
    }

    logout(): void {
        const keysToRemove = [
            'access_token',
            'refresh_token',
            'user_data',
            'estabelecimento_data',
            'current_estabelecimento_id',
            'theme',
            'preferencias_usuario',
        ];

        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            sessionStorage.removeItem(key);
        });

        // FASE 1.4: o carrinho é por operador (pdv_sessions_v1_<funcionario_id>) e não pode
        // sobreviver ao logout — o próximo login no tablet começaria com o carrinho do anterior.
        limparCarrinhosPdv();

        viewSchemaService.invalidate();
        // Dispara evento para atualizar estado de autenticação
        window.dispatchEvent(new Event('auth-change'));

        console.log('🗑️ Sessão limpa integralmente');
    }

    getToken(): string | null {
        return sessionStorage.getItem('access_token');
    }

    getCurrentUser(): { nome: string; role: string; is_super_admin?: boolean } | null {
        const userStr = sessionStorage.getItem('user_data');
        try {
            return userStr ? JSON.parse(userStr) : null;
        } catch {
            return null;
        }
    }

    async syncUserData(): Promise<any> {
        const token = this.getToken();
        if (!token) return null;

        try {
            const response = await axios.get(`${API_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.data.success) {
                const userData = response.data.data;
                sessionStorage.setItem('user_data', JSON.stringify(userData));

                viewSchemaService.invalidate();
                // Dispara evento para o usePlanGate e outros hooks
                window.dispatchEvent(new Event('auth-change'));
                return userData;
            }
        } catch (error) {
            console.error('❌ Falha ao sincronizar dados do usuário:', error);
        }
        return null;
    }

    isAuthenticated(): boolean {
        const token = this.getToken();
        return !!token && token !== 'undefined' && token !== 'null';
    }
}

export const authService = new AuthService();
