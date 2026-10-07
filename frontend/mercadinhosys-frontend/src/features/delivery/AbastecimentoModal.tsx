import React, { useState } from 'react';
import { Fuel, TrendingDown, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { apiClient } from '../../api/apiClient';

interface AbastecimentoModalProps {
    isOpen: boolean;
    onClose: () => void;
    veiculoId: number;
    kmAtualVeiculo: number;
    onSuccess: (novoConsumoMedio: number) => void;
}

export const AbastecimentoModal: React.FC<AbastecimentoModalProps> = ({ isOpen, onClose, veiculoId, kmAtualVeiculo, onSuccess }) => {
    const [litros, setLitros] = useState('');
    const [valorTotal, setValorTotal] = useState('');
    const [kmAtual, setKmAtual] = useState(kmAtualVeiculo.toString());
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const litrosNum = parseFloat(litros);
        const valorTotalNum = parseFloat(valorTotal);
        const kmAtualNum = parseFloat(kmAtual);

        if (!litrosNum || !valorTotalNum || !kmAtualNum) {
            toast.error("Preencha todos os campos corretamente.");
            return;
        }

        if (kmAtualNum < kmAtualVeiculo) {
            toast.error(`O KM Atual não pode ser menor que o último KM registrado (${kmAtualVeiculo}).`);
            return;
        }

        setLoading(true);
        try {
            const res = await apiClient.post('/logistica/abastecimento', {
                veiculo_id: veiculoId,
                litros: litrosNum,
                valor_total: valorTotalNum,
                km_atual: kmAtualNum
            });

            if (res.data.success) {
                toast.success("Abastecimento registrado! Inteligência atualizada.");
                onSuccess(res.data.novo_consumo_medio);
                onClose();
            } else {
                toast.error(res.data.error || "Erro ao registrar");
            }
        } catch (error) {
            console.error(error);
            toast.error("Falha de comunicação ao registrar abastecimento.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    // Calculos On The Fly
    const litrosNum = parseFloat(litros) || 0;
    const valorTotalNum = parseFloat(valorTotal) || 0;
    const kmAtualNum = parseFloat(kmAtual) || 0;
    const precoLitro = litrosNum > 0 ? (valorTotalNum / litrosNum).toFixed(2) : '0.00';
    const kmRodados = kmAtualNum > kmAtualVeiculo ? kmAtualNum - kmAtualVeiculo : 0;
    const previsaoKml = litrosNum > 0 ? (kmRodados / litrosNum).toFixed(1) : '0.0';

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
                >
                    <div className="bg-linear-to-r from-orange-500 to-amber-500 p-6 text-white text-center">
                        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                            <Fuel className="w-8 h-8 text-white" />
                        </div>
                        <h3 className="text-xl font-bold">Registrar Abastecimento</h3>
                        <p className="text-sm font-medium text-orange-100">Atualize os dados para calcular o consumo inteligente do veículo.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Litros</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={litros}
                                    onChange={e => setLitros(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-lg font-bold"
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor Total (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={valorTotal}
                                    onChange={e => setValorTotal(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-lg font-bold text-emerald-600"
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Odômetro Atual (KM)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={kmAtual}
                                onChange={e => setKmAtual(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-lg font-bold"
                                placeholder={kmAtualVeiculo.toString()}
                                required
                            />
                            <p className="text-xs text-gray-400 mt-1 text-right">Último KM: {kmAtualVeiculo}</p>
                        </div>

                        {/* Painel Inteligente */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                            <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-wider mb-3">Inteligência de Consumo</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-blue-500" />
                                    <span className="text-gray-600 dark:text-gray-300">R$ {precoLitro} / L</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <TrendingDown className="w-4 h-4 text-emerald-500" />
                                    <span className="text-gray-600 dark:text-gray-300 font-bold">{previsaoKml} km/L</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/30 flex justify-center items-center gap-2 disabled:opacity-50"
                            >
                                {loading ? 'Salvando...' : 'Salvar Abastecimento'}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
