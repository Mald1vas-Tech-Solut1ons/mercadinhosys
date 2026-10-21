import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService } from '../features/auth/authService';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';
import { mensagemErroLogin } from '../utils/mensagemErro';

interface User {
    id: number;
    username?: string;
    usuario?: string;
    nome: string;
    email?: string;
    role: string;
    cargo: string;
    estabelecimento_id: number;
    status: string;
    foto_url?: string;
    telefone?: string;
    is_super_admin?: boolean;
    plano?: string;
    plano_status?: string;
    permissoes: Record<string, boolean>;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (username: string, senha: string) => Promise<boolean>;
    logout: () => void;
    isAuthenticated: boolean;
    updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAuth = () => {
            const token = sessionStorage.getItem('access_token');
            const userData = sessionStorage.getItem('user_data');

            if (token && userData) {
                try {
                    const parsedUser = JSON.parse(userData);
                    setUser(parsedUser);
                } catch (error) {
                    console.error('Erro ao parsear dados do usuário:', error);
                    setUser(null);
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        };

        checkAuth();

        window.addEventListener('auth-change', checkAuth);
        return () => window.removeEventListener('auth-change', checkAuth);
    }, []);

    const login = async (username: string, senha: string): Promise<boolean> => {
        try {
            const result = await authService.login(username, senha);
            console.log('🔍 Resultado do login no AuthService:', result);

            if (result && result.success && result.data?.user) {
                // Ao contrário do LoginPage, aqui não sobrescrevemos localStorage, 
                // pois o authService.login já o fez corretamente.
                setUser(result.data.user as unknown as User);
                if (import.meta.env.DEV) {
                    console.log('✅ Login success');
                }

                // No forced hard reload. 
                // AppRoutes.tsx detects 'user' change and navigate to /dashboard automatically.
                console.log('🏁 [DEBUG] Login efetuado. Redirecionamento automático via React state.');

                return true;
            }
            return false;
        } catch (error) {
            console.error('Erro no login Context:', error);
            // Antes devolvia `false` e a tela dizia sempre "verifique suas
            // credenciais" — inclusive com o servidor fora do ar. Agora o motivo
            // real (rede/timeout, senha, usuário inativo, assinatura) sobe.
            throw new Error(mensagemErroLogin(error));
        }
    };

    const logout = () => {
        authService.logout();
        setUser(null);
        // No hard reload. AppRoutes will handle navigation to /.
        console.log('🏁 [DEBUG] Logout efetuado. Navegação via React state.');
    };

    const updateUser = (updatedUser: User) => {
        setUser(updatedUser);
        sessionStorage.setItem('user_data', JSON.stringify(updatedUser));
    };

    // A autenticação é verdadeira se tivermos um usuário populado
    const isAuthenticated = !!user;

    // Inicia o rastreamento de inatividade
    useInactivityTimeout({ isAuthenticated, logout });

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                logout,
                isAuthenticated,
                updateUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth deve ser usado dentro de um AuthProvider');
    }
    return context;
};

export default AuthContext;
