import React, { useState } from 'react';
import { Phone, Mail, Keyboard, X } from 'lucide-react';

const FootPage: React.FC = () => {
    const year = new Date().getFullYear();
    const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
    return (
        <>
            <footer className="w-full border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                    <div className="min-w-0 truncate text-gray-600 dark:text-gray-300">
                        © {year} MaldivaSky Tech Solutions
                    </div>
                    <div className="flex items-center gap-3 whitespace-nowrap">
                        <a 
                            href="https://wa.me/5511919889233" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors"
                            aria-label="Abrir WhatsApp"
                        >
                            <Phone className="w-4 h-4" />
                            <span>WhatsApp</span>
                        </a>
                        <span className="hidden sm:inline text-gray-400">•</span>
                        <a 
                            href="mailto:rafaelmaldivas@gmail.com" 
                            className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                            aria-label="Enviar e-mail"
                        >
                            <Mail className="w-4 h-4" />
                            <span>Email</span>
                        </a>
                       
                        <button
                            type="button"
                            onClick={() => setShortcutsOpen(true)}
                            className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                            aria-label="Abrir atalhos do PDV"
                        >
                            <Keyboard className="w-4 h-4" />
                            <span>Atalhos do PDV</span>
                        </button>
                        <span className="hidden sm:inline text-gray-400">•</span>
                        <span className="text-gray-500 dark:text-gray-400">v2.0</span>
                    </div>
                </div>
            </footer>

            {shortcutsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setShortcutsOpen(false)}
                        aria-hidden="true"
                    />
                    <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-xl">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-2">
                                <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Atalhos do PDV</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShortcutsOpen(false)}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                aria-label="Fechar"
                            >
                                <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                            </button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                Use os atalhos abaixo para agilizar o atendimento no caixa.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">F1</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Buscar produto</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">F2</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Selecionar cliente</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">F4</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Alternar forma de pagamento</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">F9</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Finalizar venda</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">F10</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Finalizar venda</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">ESC</span>
                                    <span className="text-sm text-gray-600 dark:text-gray-300">Cancelar/fechar</span>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setShortcutsOpen(false)}
                                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                            >
                                Entendi
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default FootPage;
