import React from 'react';
import { X, SlidersHorizontal, Trash2 } from 'lucide-react';

export type StatusFilter = 'todos' | 'ativos' | 'inativos';
export type SegmentFilter = 'todos' | 'VIP' | 'Premium' | 'Final de Semana' | 'Caçador de Promoções' | 'Regular' | 'Raro' | 'Novo' | 'Em Risco';

interface CustomersAdvancedFiltersModalProps {
    show: boolean;
    onClose: () => void;
    statusFilter: StatusFilter;
    setStatusFilter: (status: StatusFilter) => void;
    segmentFilter: SegmentFilter;
    setSegmentFilter: (segment: SegmentFilter) => void;
    fiadoFilter: boolean;
    setFiadoFilter: (fiado: boolean) => void;
    birthdayFilter: boolean;
    setBirthdayFilter: (birthday: boolean) => void;
    onApply: () => void;
}

const CustomersAdvancedFiltersModal: React.FC<CustomersAdvancedFiltersModalProps> = ({
    show,
    onClose,
    statusFilter,
    setStatusFilter,
    segmentFilter,
    setSegmentFilter,
    fiadoFilter,
    setFiadoFilter,
    birthdayFilter,
    setBirthdayFilter,
    onApply
}) => {
    if (!show) return null;

    const handleClear = () => {
        setStatusFilter('todos');
        setSegmentFilter('todos');
        setFiadoFilter(false);
        setBirthdayFilter(false);
    };

    return (
        <>
            {/* Overlay */}
            <div 
                className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400">
                            <SlidersHorizontal size={20} />
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                            Filtros Avançados
                        </h2>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-gray-400"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    <div className="space-y-3">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
                            Status do Cliente
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {(['todos', 'ativos', 'inativos'] as StatusFilter[]).map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    className={`px-4 py-2.5 rounded-xl border text-sm font-medium capitalize transition-all ${
                                        statusFilter === status
                                            ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
                            Segmento RFM
                        </label>
                        <select 
                            value={segmentFilter}
                            onChange={(e) => setSegmentFilter(e.target.value as SegmentFilter)}
                            className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="todos">Todos os segmentos</option>
                            <option value="VIP">VIP</option>
                            <option value="Premium">Premium</option>
                            <option value="Final de Semana">Final de Semana</option>
                            <option value="Caçador de Promoções">Caçador de Promoções</option>
                            <option value="Regular">Regulares</option>
                            <option value="Raro">Raro</option>
                            <option value="Novo">Novos</option>
                            <option value="Em Risco">Em Risco</option>
                        </select>
                    </div>

                    <div className="space-y-3">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
                            Filtros Especiais
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setFiadoFilter(!fiadoFilter)}
                                className={`flex flex-col items-start p-4 rounded-xl border transition-all ${
                                    fiadoFilter
                                        ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800/50'
                                        : 'bg-white border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'
                                }`}
                            >
                                <span className={`text-sm font-bold ${fiadoFilter ? 'text-orange-700 dark:text-orange-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    Com Fiado Aberto
                                </span>
                                <span className={`text-xs mt-1 ${fiadoFilter ? 'text-orange-600/80 dark:text-orange-400/80' : 'text-slate-500'}`}>
                                    Exibe apenas clientes devedores
                                </span>
                            </button>

                            <button
                                onClick={() => setBirthdayFilter(!birthdayFilter)}
                                className={`flex flex-col items-start p-4 rounded-xl border transition-all ${
                                    birthdayFilter
                                        ? 'bg-pink-50 border-pink-200 dark:bg-pink-900/20 dark:border-pink-800/50'
                                        : 'bg-white border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700'
                                }`}
                            >
                                <span className={`text-sm font-bold ${birthdayFilter ? 'text-pink-700 dark:text-pink-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    Aniversariantes
                                </span>
                                <span className={`text-xs mt-1 ${birthdayFilter ? 'text-pink-600/80 dark:text-pink-400/80' : 'text-slate-500'}`}>
                                    Exibe os aniversariantes do mês
                                </span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                    <button
                        onClick={handleClear}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-500 hover:text-red-500 transition-colors dark:text-gray-400"
                    >
                        <Trash2 size={16} />
                        Limpar Filtros
                    </button>
                    <button
                        onClick={onApply}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm shadow-blue-500/20 transition-all active:scale-95"
                    >
                        Aplicar Filtros
                    </button>
                </div>
            </div>
        </>
    );
};

export default CustomersAdvancedFiltersModal;
