import React, { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  headerIcon?: ReactNode;
  headerColor?: 'blue' | 'green' | 'red' | 'indigo' | 'purple';
  closeButton?: boolean;
}

const ResponsiveModal: React.FC<ResponsiveModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'lg',
  headerIcon,
  headerColor = 'blue',
  closeButton = true,
}) => {
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  const headerColorClasses = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    red: 'from-red-500 to-red-600',
    indigo: 'from-indigo-500 to-indigo-600',
    purple: 'from-purple-500 to-purple-600',
  };

  return createPortal(
    <div className="fixed inset-0 h-dvh bg-black/60 backdrop-blur-sm flex items-center justify-center z-200 p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      <div
        className={`bg-white dark:bg-gray-800 shadow-2xl w-full ${sizeClasses[size]}
          h-dvh sm:h-auto sm:max-h-[95dvh] sm:rounded-xl overflow-hidden flex flex-col
          animate-in zoom-in-95 duration-200`}
      >
        {/* Header — paddingTop respeita o notch/status bar no modo tela cheia (mobile) */}
        <div
          className={`bg-linear-to-r ${headerColorClasses[headerColor] || 'from-blue-600 to-blue-700'} px-5 sm:px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10`}
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {headerIcon && (
              <div className="text-white shrink-0 bg-white/20 p-2 rounded-lg">
                {headerIcon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white truncate leading-tight">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs sm:text-sm text-white/80 truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {closeButton && (
            <button
              onClick={onClose}
              className="p-2.5 hover:bg-white/20 active:bg-white/30 rounded-xl transition-all shrink-0 ml-2 text-white"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 bg-white dark:bg-gray-800">
          {children}
        </div>

        {/* Footer — respeita a safe-area do dispositivo (barra de gestos / home indicator)
            para que os botões de ação nunca fiquem sob a barra do sistema no celular. */}
        {footer && (
          <div
            className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/50 backdrop-blur-md px-5 sm:px-6 py-4 shrink-0 flex items-center justify-end gap-3 translate-z-0"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ResponsiveModal;
