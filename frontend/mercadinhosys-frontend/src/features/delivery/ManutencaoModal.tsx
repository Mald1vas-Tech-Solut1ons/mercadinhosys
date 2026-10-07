import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { Wrench, Settings, AlertCircle } from 'lucide-react';
import { deliveryService } from './deliveryService';

interface ManutencaoModalProps {
    isOpen: boolean;
    onClose: () => void;
    veiculoId: number;
    kmAtualVeiculo: number;
    onSuccess: () => void;
}

export const ManutencaoModal: React.FC<ManutencaoModalProps> = ({ isOpen, onClose, veiculoId, kmAtualVeiculo, onSuccess }) => {
    const [tipoServico, setTipoServico] = useState('Troca de Óleo');
    const [descricao, setDescricao] = useState('');
    const [kmAtual, setKmAtual] = useState(kmAtualVeiculo.toString());
    const [valorTotal, setValorTotal] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const valorNum = parseFloat(valorTotal);
        const kmNum = parseFloat(kmAtual);

        if (!valorNum || !kmNum) {
            toast.error("Preencha KM e Valor corretamente.");
            return;
        }

        if (kmNum < kmAtualVeiculo) {
            toast.error(`O KM Atual não pode ser menor que o último KM registrado (${kmAtualVeiculo}).`);
            return;
        }

        setLoading(true);
        try {
            const res = await deliveryService.registrarManutencao({
                veiculo_id: veiculoId,
                tipo_servico: tipoServico,
                descricao: descricao,
                km_atual: kmNum,
                valor_total: valorNum
            });

            if (res.success) {
                toast.success("Manutenção salva e lançada nas Despesas!");
                onSuccess();
                onClose();
                setDescricao('');
                setValorTotal('');
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Erro ao salvar manutenção.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
                <motion.div
                    initial={{ opacity: 0, y: '100%' }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: '100%' }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
                >
                    <div className="bg-linear-to-r from-blue-700 to-indigo-700 p-6 text-white text-center rounded-t-3xl sm:rounded-none">
                        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                            <Wrench className="w-8 h-8 text-white" />
                        </div>
                        <h3 className="text-xl font-black">Registrar Manutenção</h3>
                        <p className="text-sm font-medium text-blue-100">Atualize os dados e despesas do seu veículo.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria de Serviço</label>
                            <select
                                value={tipoServico}
                                onChange={e => setTipoServico(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm font-bold text-gray-900 dark:text-white"
                            >
                                <option value="Troca de Óleo">Troca de Óleo</option>
                                <option value="Pneus/Borracharia">Pneus / Borracharia / Calibragem</option>
                                <option value="Relação/Transmissão">Relação / Transmissão</option>
                                <option value="Elétrica">Elétrica (Farol, Setas, Bateria)</option>
                                <option value="Mecânica Geral">Mecânica Geral / Revisão</option>
                                <option value="Outros">Outros Reparos</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Odômetro (KM)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={kmAtual}
                                    onChange={e => setKmAtual(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-lg font-bold"
                                    placeholder={kmAtualVeiculo.toString()}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor Pago (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={valorTotal}
                                    onChange={e => setValorTotal(e.target.value)}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-lg font-bold text-red-600"
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Detalhes (Opcional)</label>
                            <textarea
                                value={descricao}
                                onChange={e => setDescricao(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-sm"
                                placeholder="Quais peças foram trocadas? Qual o problema exato?"
                                rows={2}
                            />
                        </div>

                        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/10 p-3 rounded-xl border border-red-100 dark:border-red-900/20">
                            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-800 dark:text-red-300 font-medium">
                                Este registro lançará automaticamente uma <b>Despesa</b> vinculada ao caixa da loja. O gerente terá acesso para conferir.
                            </p>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/30 flex justify-center items-center disabled:opacity-50"
                            >
                                {loading ? <Settings className="w-5 h-5 animate-spin" /> : 'Salvar Despesa'}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
