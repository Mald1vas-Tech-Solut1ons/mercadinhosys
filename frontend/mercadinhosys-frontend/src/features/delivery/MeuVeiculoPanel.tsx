import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Plus, CalendarDays, Activity, FileText } from 'lucide-react';
import { deliveryService, ManutencaoVeiculo } from './deliveryService';
import { ManutencaoModal } from './ManutencaoModal';

interface MeuVeiculoPanelProps {
    veiculoId?: number;
    kmAtual: number;
}

export const MeuVeiculoPanel: React.FC<MeuVeiculoPanelProps> = ({ veiculoId, kmAtual }) => {
    const [manutencoes, setManutencoes] = useState<ManutencaoVeiculo[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    const loadManutencoes = async () => {
        if (!veiculoId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await deliveryService.getHistoricoManutencao(veiculoId);
            if (res.success) {
                setManutencoes(res.manutencoes);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadManutencoes();
    }, [veiculoId]);

    const totalGasto = manutencoes.reduce((acc, m) => acc + (Number(m.valor_total) || 0), 0);

    if (!veiculoId) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="w-16 h-16 bg-gray-200 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                    <Wrench className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">Nenhum veículo selecionado para este turno. Inicie um turno selecionando seu veículo para gerenciar a manutenção.</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto pb-24 p-4 space-y-6">
            {/* Cabecalho e Total */}
            <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-linear-to-br from-blue-800 to-indigo-900 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Wrench className="w-24 h-24 transform rotate-12" />
                </div>
                <div className="relative z-10">
                    <p className="text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Custo de Manutenção Histórico</p>
                    <h2 className="text-4xl font-black mb-4">R$ {totalGasto.toFixed(2)}</h2>
                    <button
                        onClick={() => setModalOpen(true)}
                        className="bg-white text-blue-800 px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 w-full shadow-lg hover:bg-blue-50 transition-colors"
                    >
                        <Plus className="w-5 h-5" />
                        Lançar Gasto / Reparo
                    </button>
                </div>
            </motion.div>

            {/* Lista Timeline */}
            <div>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 px-2 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Histórico de Serviços
                </h3>
                
                <div className="space-y-4">
                    <AnimatePresence>
                        {loading ? (
                            <div className="text-center py-10 text-gray-400 animate-pulse font-medium">Buscando histórico...</div>
                        ) : manutencoes.length === 0 ? (
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 text-center border border-dashed border-gray-200 dark:border-gray-700">
                                <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                                <p className="text-gray-500 text-sm font-medium">Nenhum registro de manutenção encontrado para este veículo.</p>
                            </div>
                        ) : (
                            manutencoes.map((m, idx) => (
                                <motion.div
                                    key={m.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group"
                                >
                                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                    <div className="flex justify-between items-start mb-2 pl-2">
                                        <div>
                                            <h4 className="font-bold text-gray-900 dark:text-white text-base">{m.tipo_servico}</h4>
                                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                <CalendarDays className="w-3 h-3" /> {new Date(m.data_manutencao).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div className="bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-lg text-red-700 dark:text-red-400 font-bold text-sm">
                                            R$ {Number(m.valor_total).toFixed(2)}
                                        </div>
                                    </div>
                                    
                                    <div className="pl-2 mt-3 flex items-start gap-4">
                                        <div className="flex-1">
                                            {m.descricao ? (
                                                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-900 p-2 rounded-lg border border-gray-100 dark:border-gray-800">
                                                    "{m.descricao}"
                                                </p>
                                            ) : (
                                                <p className="text-xs text-gray-400 italic">Sem observações</p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] uppercase text-gray-400 font-bold">Odômetro</p>
                                            <p className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300">{m.km_atual} km</p>
                                        </div>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <ManutencaoModal 
                isOpen={modalOpen} 
                onClose={() => setModalOpen(false)} 
                veiculoId={veiculoId as number} 
                kmAtualVeiculo={kmAtual} 
                onSuccess={loadManutencoes} 
            />
        </div>
    );
};
