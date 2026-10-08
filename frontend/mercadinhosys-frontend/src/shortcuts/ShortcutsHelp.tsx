import React from 'react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUT_GROUPS } from './registry';

interface ShortcutsHelpProps {
    open: boolean;
    onClose: () => void;
}

/** Tecla renderizada como "kbd". */
const Tecla: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <kbd className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-100 shadow-sm">
        {children}
    </kbd>
);

/** Overlay global com todos os atalhos do sistema. Abre com "?", fecha com Esc. */
const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ open, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-300 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">Atalhos de teclado</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        aria-label="Fechar"
                    >
                        <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-6 overflow-y-auto">
                    {SHORTCUT_GROUPS.map((grupo) => (
                        <div key={grupo.titulo}>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{grupo.titulo}</p>
                            <div className="space-y-1.5">
                                {grupo.atalhos.map((a, i) => (
                                    <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                        <span className="text-sm text-slate-600 dark:text-slate-300">{a.label}</span>
                                        <span className="flex items-center gap-1 shrink-0">
                                            {a.keys.map((k, j) => (
                                                <React.Fragment key={j}>
                                                    {j > 0 && <span className="text-slate-400 text-xs">depois</span>}
                                                    <Tecla>{k}</Tecla>
                                                </React.Fragment>
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 text-center">
                    <p className="text-xs text-slate-400">
                        Pressione <Tecla>?</Tecla> a qualquer momento para abrir esta ajuda.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ShortcutsHelp;
