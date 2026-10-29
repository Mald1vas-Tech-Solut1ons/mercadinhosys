import { useEffect, useRef, useCallback } from 'react';
import { showToast } from '../utils/toast';
interface UseInactivityTimeoutProps {
    isAuthenticated: boolean;
    logout: () => void;
}

export const INACTIVITY_STORAGE_KEY = 'mercadinhosys_inactivity_timeout_min';
export const DEFAULT_TIMEOUT_MINUTES = 30;

export const getInactivityTimeoutMs = (): number => {
    const saved = localStorage.getItem(INACTIVITY_STORAGE_KEY);
    const minutes = saved ? parseInt(saved, 10) : DEFAULT_TIMEOUT_MINUTES;
    return (isNaN(minutes) ? DEFAULT_TIMEOUT_MINUTES : minutes) * 60 * 1000;
};

export const useInactivityTimeout = ({ isAuthenticated, logout }: UseInactivityTimeoutProps) => {
    const timeoutRef = useRef<number | null>(null);

    const resetTimeout = useCallback(() => {
        if (!isAuthenticated) return;

        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
        }

        const timeoutMs = getInactivityTimeoutMs();

        timeoutRef.current = window.setTimeout(() => {
            showToast.error('Sessão encerrada por inatividade de segurança.', {
                duration: 5000,
                icon: '🔒'
            });
            logout();
        }, timeoutMs);
    }, [isAuthenticated, logout]);

    useEffect(() => {
        if (!isAuthenticated) {
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
            return;
        }

        const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
        
        const handleUserActivity = () => {
            // Utilizamos requestAnimationFrame ou throttle para não sobrecarregar o render/js event loop
            // Mas para simplicidade e performance, o clearTimeout já é super rápido.
            resetTimeout();
        };

        // Inicia o timer logo após o login
        resetTimeout();

        events.forEach((event) => {
            window.addEventListener(event, handleUserActivity, { passive: true });
        });

        // Ouvir alterações no localStorage vindas de outras abas ou da tela de configurações
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === INACTIVITY_STORAGE_KEY) {
                resetTimeout();
            }
        };
        window.addEventListener('storage', handleStorageChange);
        
        // Custom event dispatcher from settings
        const handleCustomSettingsChange = () => resetTimeout();
        window.addEventListener('inactivity-settings-changed', handleCustomSettingsChange);

        return () => {
            events.forEach((event) => {
                window.removeEventListener(event, handleUserActivity);
            });
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('inactivity-settings-changed', handleCustomSettingsChange);
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, [isAuthenticated, resetTimeout]);
};
