import React from 'react';
import toast, { ToastOptions } from 'react-hot-toast';

/**
 * MercadinhoSys — Toast Premium (Apple Style)
 * Design com Glassmorphism, Blur e alta velocidade.
 * Foco exclusivo em performance e estética moderna.
 */

const glassBase: React.CSSProperties = {
    padding: '16px 24px',
    borderRadius: '24px',
    fontFamily: '"Outfit", "Inter", system-ui, sans-serif',
    fontSize: '15px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    backdropFilter: 'blur(20px) saturate(160%)',
    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
    color: '#ffffff',
    letterSpacing: '-0.3px',
};

const themes = {
    success: {
        style: {
            ...glassBase,
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.15) 100%)',
            borderColor: 'rgba(52, 211, 153, 0.2)',
        },
        iconColor: '#34d399',
    },
    error: {
        style: {
            ...glassBase,
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.15) 100%)',
            borderColor: 'rgba(248, 113, 113, 0.2)',
        },
        iconColor: '#f87171',
    },
    warning: {
        style: {
            ...glassBase,
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.15) 100%)',
            borderColor: 'rgba(251, 191, 36, 0.2)',
        },
        iconColor: '#fbbf24',
    },
    info: {
        style: {
            ...glassBase,
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.15) 100%)',
            borderColor: 'rgba(96, 165, 250, 0.2)',
        },
        iconColor: '#60a5fa',
    }
};

const Icon = {
    success: (c: string) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M20 6L9 17l-5-5" />
        </svg>
    ),
    error: (c: string) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
    ),
    warning: (c: string) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    info: (c: string) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
};

export const showToast = {
    success: (message: string, options?: ToastOptions) => {
        toast.success(message, {
            duration: 2500,
            style: themes.success.style as React.CSSProperties,
            icon: Icon.success(themes.success.iconColor),
            ...options,
        });
    },
    /** Verde — para Criações */
    create: (message: string, options?: ToastOptions) => {
        toast.success(message, {
            duration: 2500,
            style: themes.success.style as React.CSSProperties,
            icon: Icon.success(themes.success.iconColor),
            ...options,
        });
    },
    /** Amarelo — para Atualizações / Edições */
    update: (message: string, options?: ToastOptions) => {
        toast(message, {
            duration: 2500,
            style: themes.warning.style as React.CSSProperties,
            icon: Icon.warning(themes.warning.iconColor),
            ...options,
        });
    },
    /** Vermelho — para Erros ou Deleções */
    error: (message: string, options?: ToastOptions) => {
        toast.error(message, {
            duration: 4000,
            style: themes.error.style as React.CSSProperties,
            icon: Icon.error(themes.error.iconColor),
            ...options,
        });
    },
    /** Amarelo — para Avisos Gerais */
    warning: (message: string, options?: ToastOptions) => {
        toast(message, {
            duration: 3000,
            style: themes.warning.style as React.CSSProperties,
            icon: Icon.warning(themes.warning.iconColor),
            ...options,
        });
    },
    /** Azul — para Informações Gerais */
    info: (message: string, options?: ToastOptions) => {
        toast(message, {
            duration: 2500,
            style: themes.info.style as React.CSSProperties,
            icon: Icon.info(themes.info.iconColor),
            ...options,
        });
    },
    loading: (message: string, options?: ToastOptions) => {
        return toast.loading(message, {
            style: { ...glassBase, background: 'rgba(30, 41, 59, 0.7)' },
            ...options,
        });
    },
    /** Verde com botão de ação (ex.: "Imprimir etiqueta" logo após cadastrar). */
    successAction: (message: string, actionLabel: string, onAction: () => void, options?: ToastOptions) => {
        return toast.success((t) => (
            <span style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span>{message}</span>
                <button
                    type="button"
                    onClick={() => { toast.dismiss(t.id); onAction(); }}
                    style={{
                        padding: '6px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.35)',
                        background: 'rgba(255,255,255,0.15)', color: '#ffffff', fontWeight: 800,
                        fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                >
                    {actionLabel}
                </button>
            </span>
        ), {
            duration: 10000,
            style: themes.success.style as React.CSSProperties,
            icon: Icon.success(themes.success.iconColor),
            ...options,
        });
    },
    dismiss: (toastId?: string) => toast.dismiss(toastId),
    promise: <T,>(
        promise: Promise<T>,
        msgs: {
            loading: string;
            success: string | ((data: T) => string);
            error: string | ((err: any) => string);
        },
        options?: ToastOptions & { theme?: 'success' | 'warning' | 'info' | 'error' }
    ) => {
        const theme = options?.theme || 'success';
        return toast.promise(promise, msgs, {
            style: glassBase,
            success: {
                style: themes[theme].style as React.CSSProperties,
                icon: Icon[theme === 'success' || theme === 'warning' ? (theme as 'success' | 'warning') : 'success'](themes[theme].iconColor),
                duration: 2500
            },
            error: {
                style: themes.error.style as React.CSSProperties,
                icon: Icon.error(themes.error.iconColor),
                duration: 4000
            },
            ...options,
        });
    },
};
