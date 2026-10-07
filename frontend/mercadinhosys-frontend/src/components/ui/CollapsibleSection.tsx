import React, { useState, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  variant?: 'default' | 'card' | 'minimal';
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon,
  children,
  defaultOpen = true,
  badge,
  variant = 'default',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const variantClasses = {
    default: {
      container: 'border border-gray-200 dark:border-gray-700 rounded-lg',
      header: 'bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:py-4',
      content: 'px-4 py-3 sm:px-6 sm:py-4 bg-white dark:bg-gray-800',
    },
    card: {
      container: 'bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700',
      header: 'px-4 py-3 sm:px-6 sm:py-4 bg-linear-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800',
      content: 'px-4 py-3 sm:px-6 sm:py-4',
    },
    minimal: {
      container: '',
      header: 'px-4 py-2 sm:px-6 sm:py-3',
      content: 'px-4 py-2 sm:px-6 sm:py-3 bg-gray-50 dark:bg-gray-800 rounded-b-lg',
    },
  };

  const styles = variantClasses[variant];

  return (
    <div className={styles.container}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between ${styles.header} hover:bg-opacity-75 transition-colors`}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {icon && <span className="shrink-0 text-gray-600 dark:text-gray-400">{icon}</span>}
          <span className="font-semibold text-gray-800 dark:text-white text-sm sm:text-base truncate">
            {title}
          </span>
          {badge !== undefined && (
            <span className="ml-2 px-2 py-1 text-xs font-semibold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full shrink-0">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-600 dark:text-gray-400 shrink-0 transition-transform ${
            isOpen ? 'transform rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className={styles.content}>
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
