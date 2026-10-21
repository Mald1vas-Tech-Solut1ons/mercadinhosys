import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { escapeHtml } from '../../utils/escapeHtml';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
    type: ToastType;
    message: string;
    onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ type, message, onClose }) => {
    const getIcon = () => {
        switch (type) {
            case 'success':
                return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'error':
                return <XCircle className="w-5 h-5 text-red-500" />;
            case 'warning':
                return <AlertCircle className="w-5 h-5 text-yellow-500" />;
            case 'info':
                return <Info className="w-5 h-5 text-blue-500" />;
            default:
                return <Info className="w-5 h-5 text-blue-500" />;
        }
    };

    const getBgColor = () => {
        switch (type) {
            case 'success':
                return 'bg-green-50 border-green-200 text-green-800';
            case 'error':
                return 'bg-red-50 border-red-200 text-red-800';
            case 'warning':
                return 'bg-yellow-50 border-yellow-200 text-yellow-800';
            case 'info':
                return 'bg-blue-50 border-blue-200 text-blue-800';
            default:
                return 'bg-gray-50 border-gray-200 text-gray-800';
        }
    };

    return (
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${getBgColor()} shadow-lg`}>
            {getIcon()}
            <p className="flex-1 text-sm font-medium">{message}</p>
            <button
                onClick={onClose}
                className="p-1 hover:bg-black/10 rounded-full transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};

// Toast Container e Manager
interface ToastItem {
    id: string;
    type: ToastType;
    message: string;
}

let toastContainer: HTMLDivElement | null = null;
let toasts: ToastItem[] = [];
let toastIdCounter = 0;

const createToastContainer = () => {
    if (toastContainer) return toastContainer;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed top-4 right-4 z-50 space-y-2 pointer-events-none';
    document.body.appendChild(toastContainer);
    return toastContainer;
};

const renderToasts = () => {
    const container = createToastContainer();
    
    container.innerHTML = toasts.map(toast => `
        <div class="pointer-events-auto animate-slide-in" data-toast-id="${toast.id}">
            <div class="flex items-center gap-3 p-4 rounded-lg border shadow-lg ${
                toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                toast.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
            }">
                ${
                    toast.type === 'success' ? '<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' :
                    toast.type === 'error' ? '<svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' :
                    toast.type === 'warning' ? '<svg class="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>' :
                    '<svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                }
                <p class="flex-1 text-sm font-medium">${escapeHtml(toast.message)}</p>
                <button class="p-1 hover:bg-black/10 rounded-full transition-colors" onclick="removeToast('${toast.id}')">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>
    `).join('');

    // Adicionar CSS para animação
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slide-in {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            .animate-slide-in {
                animation: slide-in 0.3s ease-out;
            }
        `;
        document.head.appendChild(style);
    }
};

const removeToast = (id: string) => {
    toasts = toasts.filter(toast => toast.id !== id);
    renderToasts();
};

// Função global para remover toast
(window as any).removeToast = removeToast;

export const showToast = {
    success: (message: string) => {
        const id = `toast-${++toastIdCounter}`;
        toasts.push({ id, type: 'success', message });
        renderToasts();
        setTimeout(() => removeToast(id), 3000);
    },
    error: (message: string) => {
        const id = `toast-${++toastIdCounter}`;
        toasts.push({ id, type: 'error', message });
        renderToasts();
        setTimeout(() => removeToast(id), 5000);
    },
    warning: (message: string) => {
        const id = `toast-${++toastIdCounter}`;
        toasts.push({ id, type: 'warning', message });
        renderToasts();
        setTimeout(() => removeToast(id), 4000);
    },
    info: (message: string) => {
        const id = `toast-${++toastIdCounter}`;
        toasts.push({ id, type: 'info', message });
        renderToasts();
        setTimeout(() => removeToast(id), 3000);
    }
};

export default Toast;
