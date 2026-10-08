import React, { ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface ResponsiveTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: ReactNode;
  variant?: 'default' | 'pills' | 'underline';
}

const ResponsiveTabs: React.FC<ResponsiveTabsProps> = ({
  tabs,
  activeTab,
  onTabChange,
  children,
  variant = 'underline',
}) => {
  const tabClasses = {
    default: {
      container: 'flex gap-1 px-4 sm:px-6 overflow-x-auto',
      tab: 'px-3 sm:px-4 py-2 sm:py-3 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors',
      active: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900 rounded-t-lg',
      inactive: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
    },
    pills: {
      container: 'flex gap-2 px-4 sm:px-6 py-3 overflow-x-auto',
      tab: 'px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm whitespace-nowrap rounded-full transition-colors',
      active: 'bg-blue-600 text-white',
      inactive: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600',
    },
    underline: {
      container: 'flex gap-1 px-4 sm:px-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto',
      tab: 'px-3 sm:px-4 py-3 font-medium text-xs sm:text-sm whitespace-nowrap transition-colors relative',
      active: 'text-blue-600 dark:text-blue-400',
      inactive: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
    },
  };

  const styles = tabClasses[variant];

  return (
    <div className="flex flex-col h-full">
      <div className={styles.container}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`${styles.tab} ${
              activeTab === tab.id ? styles.active : styles.inactive
            }`}
          >
            <div className="flex items-center gap-1 sm:gap-2">
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-red-500 text-white rounded-full">
                  {tab.badge}
                </span>
              )}
            </div>
            {variant === 'underline' && activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
};

export default ResponsiveTabs;
