import React, { ReactNode } from 'react';

interface PageHeaderProps {
    title: ReactNode;
    subtitle?: ReactNode;
    /** Ícone opcional à esquerda do título. */
    icon?: ReactNode;
    /** Botões/ações à direita (desktop) que passam a ocupar a linha inteira no mobile. */
    actions?: ReactNode;
    className?: string;
}

/**
 * Cabeçalho de página responsivo por padrão. Substitui o padrão ad-hoc
 * `flex justify-between` que cada página reinventava e que estourava a largura
 * em telas estreitas (título + botões sem quebra de linha → scroll horizontal).
 *
 * Comportamento:
 * - Mobile: título/subtítulo em cima, ações embaixo ocupando a linha inteira
 *   (cada ação vira `flex-1` para preencher e ficar tocável).
 * - Desktop (sm+): título à esquerda, ações à direita com largura natural.
 * - `min-w-0` + `truncate` no título impedem que textos longos empurrem o layout.
 *
 * As ações devem ser botões "crus"; o wrapper cuida do full-width no mobile via
 * `*:flex-1 sm:*:flex-none`, sem precisar tocar em cada botão.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    icon,
    actions,
    className = '',
}) => {
    return (
        <div className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}>
            <div className="flex items-start gap-3 min-w-0">
                {icon && <div className="shrink-0">{icon}</div>}
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white leading-tight truncate">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm sm:text-base">
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>
            {actions && (
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto shrink-0 *:flex-1 sm:*:flex-none">
                    {actions}
                </div>
            )}
        </div>
    );
};

export default PageHeader;
