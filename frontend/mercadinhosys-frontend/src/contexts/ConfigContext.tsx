import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import settingsService, { Configuracao, PreferenciasUsuario } from '../features/settings/settingsService';
import { useAuth } from './AuthContext';

interface ConfigContextType {
    config: Configuracao | null;
    preferencias: PreferenciasUsuario | null;
    loading: boolean;
    updateConfig: (newConfig: Partial<Configuracao>) => Promise<void>;
    updatePreferencias: (newPrefs: Partial<PreferenciasUsuario>) => Promise<void>;
    refreshConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
    const [config, setConfig] = useState<Configuracao | null>(null);
    const [preferencias, setPreferencias] = useState<PreferenciasUsuario | null>(null);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();

    // Senior Mode: Cálculo centralizado do tema removido daqui.
    // Agora o ThemeProvider é o único responsável.


    const loadConfig = async () => {
        try {
            setLoading(true);

            if (!user || !user.id) {
                setConfig(null);
                setPreferencias(null);
                setLoading(false);
                return;
            }

            const [configRes, prefsRes] = await Promise.all([
                settingsService.getConfig(),
                settingsService.getPreferencias().catch(() => ({ tema_escuro: false, notificacoes_desktop: true, idioma: 'pt-BR' }))
            ]);

            setPreferencias(prefsRes);
            setConfig({
                ...configRes,
                logo_url: configRes.logo_base64 || configRes.logo_url || '/assets/logo.png'
            });
        } catch (error) {
            console.error('Erro ao carregar configurações:', error);
        } finally {
            setLoading(false);
        }
    };

    // Tempo de sessão é regra da loja: vale em todo aparelho que logar, não só no
    // navegador onde o admin salvou. O hook de inatividade lê esta chave.
    useEffect(() => {
        const minutos = config?.tempo_sessao_minutos;
        if (!minutos) return;
        try {
            localStorage.setItem('mercadinhosys_inactivity_timeout_min', String(minutos));
        } catch { /* armazenamento bloqueado: fica o padrão do hook */ }
        window.dispatchEvent(new Event('inactivity-settings-changed'));
    }, [config?.tempo_sessao_minutos]);

    const updateConfig = async (newConfig: Partial<Configuracao>) => {
        const previousConfig = config;
        // ✅ ATUALIZAÇÃO OTIMISTA PARA CORES E CONFIGS
        setConfig(prev => prev ? { ...prev, ...newConfig } : null);

        try {
            const { logo_base64, ...configToUpdate } = newConfig;
            const response = await settingsService.updateConfig(configToUpdate);
            setConfig(response);
        } catch (error) {
            console.error('Erro ao atualizar configurações:', error);
            setConfig(previousConfig);
            throw error;
        }
    };

    const updatePreferencias = async (newPrefs: Partial<PreferenciasUsuario>) => {
        const previousPrefs = preferencias;

        // ✅ ATUALIZAÇÃO OTIMISTA (Instantânea na UI)
        setPreferencias(prev => prev ? { ...prev, ...newPrefs } : null);

        // Feedback imediato para o localStorage para evitar flicker
        if (newPrefs.tema_escuro !== undefined) {
            localStorage.setItem('theme', newPrefs.tema_escuro ? 'dark' : 'light');
        }

        try {
            const response = await settingsService.updatePreferencias(newPrefs);
            // ✅ Only update if backend returned the full object, otherwise keep optimistic
            if (response && response.tema_escuro !== undefined) {
                setPreferencias(response);
            }
        } catch (error) {
            console.error('Erro ao atualizar preferências:', error);
            setPreferencias(previousPrefs);
            if (previousPrefs?.tema_escuro !== undefined) {
                localStorage.setItem('theme', previousPrefs.tema_escuro ? 'dark' : 'light');
            }
        }
    };

    const refreshConfig = async () => {
        await loadConfig();
    };

    useEffect(() => {
        const previousEstab = localStorage.getItem('current_estabelecimento_id');
        const currentEstab = user?.estabelecimento_id?.toString();

        if (user && previousEstab && currentEstab && previousEstab !== currentEstab) {
            localStorage.removeItem('theme');
            localStorage.removeItem('preferencias_usuario');
        }

        if (currentEstab) {
            localStorage.setItem('current_estabelecimento_id', currentEstab);
        }

        loadConfig();
    }, [user?.id, user?.estabelecimento_id]);

    useEffect(() => {
        const root = document.documentElement;
        // Aplicar apenas cores (vêm do estabelecimento) no document root
        if (config?.cor_principal) {
            root.style.setProperty('--color-primary', config.cor_principal);
            const hex = config.cor_principal.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16) || 37;
            const g = parseInt(hex.substring(2, 4), 16) || 99;
            const b = parseInt(hex.substring(4, 6), 16) || 235;
            root.style.setProperty('--color-primary-dark', `rgb(${Math.floor(r * 0.8)}, ${Math.floor(g * 0.8)}, ${Math.floor(b * 0.8)})`);
            root.style.setProperty('--color-primary-light', `rgba(${r}, ${g}, ${b}, 0.1)`);
        }
    }, [config?.cor_principal]);

    return (
        <ConfigContext.Provider value={{ config, preferencias, loading, updateConfig, updatePreferencias, refreshConfig }}>
            {children}
        </ConfigContext.Provider>
    );
};

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within ConfigProvider');
    }
    return context;
};
