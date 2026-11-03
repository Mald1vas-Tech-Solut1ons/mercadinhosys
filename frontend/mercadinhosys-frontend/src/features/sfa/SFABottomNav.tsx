import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Users, PackageSearch, Clock } from 'lucide-react';

export default function SFABottomNav() {
    const navigate = useNavigate();
    const location = useLocation();
    const path = location.pathname;

    const navItems = [
        { name: 'Início', path: '/sfa', icon: Home },
        { name: 'Clientes', path: '/sfa/clientes', icon: Users },
        { name: 'Catálogo', path: '/sfa/produtos', icon: PackageSearch },
        { name: 'Ponto', path: '/ponto', icon: Clock },
    ];

    return (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border-t border-slate-200/50 dark:border-slate-800/50 pb-2 pt-2 px-6 shadow-[0_-10px_40px_rgba(0,0,0,0.08)] z-50 rounded-t-3xl transition-colors duration-300">
            <div className="flex justify-between items-center max-w-md mx-auto relative">
                {navItems.map((item) => {
                    const isActive = path === item.path || (path.startsWith(item.path) && item.path !== '/sfa' && item.path !== '/ponto');
                    const Icon = item.icon;
                    return (
                        <button 
                            key={item.name}
                            onClick={() => navigate(item.path)}
                            className={`relative flex flex-col items-center justify-center p-2 rounded-2xl transition-all duration-300 ease-out w-16 h-14 ${isActive ? 'text-blue-600 dark:text-blue-400 transform -translate-y-1' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-slate-800/50'}`}
                        >
                            <Icon className={`w-6 h-6 mb-1 transition-transform duration-300 ${isActive ? 'scale-110 drop-shadow-md' : 'scale-100'}`} strokeWidth={isActive ? 2.5 : 2} />
                            <span className={`text-[10px] font-bold tracking-wide transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-70'}`}>{item.name}</span>
                            {isActive && (
                                <div className="absolute -bottom-2 w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shadow-[0_0_10px_rgba(37,99,235,0.8)] animate-pulse" />
                            )}
                        </button>
                    );
                })}
            </div>
            {/* Safe area padding for mobile browsers */}
            <div className="h-4 w-full"></div>
        </div>
    );
}
