import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scale, X, Check, Calculator } from 'lucide-react';
import { Produto } from '../../../types';
import { formatCurrency } from '../../../utils/formatters';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

interface PesoInputModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (quantidade: number) => void;
    produto: Produto | null;
}

const PesoInputModal: React.FC<PesoInputModalProps> = ({ isOpen, onClose, onConfirm, produto }) => {
    const [peso, setPeso] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPeso('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useBodyScrollLock(isOpen);

    if (!produto) return null;

    const precoUnitario = (produto as any).preco_venda_efetivo ?? produto.preco_venda;
    const valorPeso = parseFloat(peso.replace(',', '.')) || 0;
    const totalCalculado = valorPeso * precoUnitario;

    const handleConfirm = () => {
        if (valorPeso > 0) {
            onConfirm(valorPeso);
            onClose();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white">
                                    <Scale className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Entrada de Peso</h3>
                                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Produto a Granel</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-8 space-y-6">
                            <div className="text-center">
                                <h4 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">{produto.nome}</h4>
                                <p className="text-sm text-slate-500 font-medium">
                                    Preço: <span className="text-slate-900 dark:text-white font-bold">{formatCurrency(precoUnitario)}</span> / {produto.unidade_medida}
                                </p>
                            </div>

                            <div className="relative">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 ml-1">
                                    Valor da Balança ({produto.unidade_medida})
                                </label>
                                <div className="relative group">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        inputMode="decimal"
                                        value={peso}
                                        onChange={(e) => setPeso(e.target.value.replace(/[^0-9,.]/g, ''))}
                                        onKeyDown={handleKeyDown}
                                        placeholder="0,000"
                                        className="w-full text-5xl font-black text-center py-6 bg-slate-50 dark:bg-slate-800/50 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none transition-all tabular-nums text-slate-900 dark:text-white group-hover:bg-slate-100 dark:group-hover:bg-slate-800"
                                    />
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
                                        <Scale className="w-10 h-10 text-slate-400" />
                                    </div>
                                </div>
                            </div>

                            {/* Total Grid */}
                            <div className="grid grid-cols-1 gap-4 p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-500/20">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                                        <Calculator className="w-4 h-4" />
                                        <span className="text-xs font-bold uppercase tracking-wider">Total do Item</span>
                                    </div>
                                    <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                                        {formatCurrency(totalCalculado)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 py-4 px-6 rounded-2xl font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-all uppercase text-xs tracking-widest"
                            >
                                Cancelar (Esc)
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={valorPeso <= 0}
                                className={`flex-1 py-4 px-6 rounded-2xl font-black flex items-center justify-center gap-3 transition-all uppercase text-xs tracking-widest shadow-lg ${valorPeso > 0
                                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20 active:scale-95'
                                        : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                                    }`}
                            >
                                <Check className="w-5 h-5" />
                                <span>Confirmar (Enter)</span>
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default PesoInputModal;
