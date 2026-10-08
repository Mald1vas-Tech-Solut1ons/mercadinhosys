import { useEffect, useState } from 'react';
import { Sparkles, ChevronLeft, ChevronRight, PlayCircle } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { showToast } from '../../../components/elements/Toast';
import RetrospectivaWrapped from './RetrospectivaWrapped';

/**
 * Retrospectiva na gestão (Admin/Gerente/RH): escolhe um funcionário e o mês,
 * e abre a Retrospectiva (Wrapped) daquele colaborador. Reusa o backend
 * /rh/retrospectiva (aceita funcionario_id) — dados 100% reais.
 */

interface FuncionarioLite { id: number; nome: string; cargo?: string; }

function mesAtualISO() {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}
function mesLabel(m: string) {
    const [a, mm] = m.split('-').map(Number);
    return new Date(a, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function deslocar(m: string, d: number) {
    const [a, mm] = m.split('-').map(Number);
    const dt = new Date(a, mm - 1 + d, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export default function RetrospectivaGestao() {
    const [funcionarios, setFuncionarios] = useState<FuncionarioLite[]>([]);
    const [funcionarioId, setFuncionarioId] = useState<number | ''>('');
    const [mes, setMes] = useState(mesAtualISO());
    const [aberto, setAberto] = useState(false);

    useEffect(() => {
        apiClient.get('/funcionarios', { params: { simples: true, por_pagina: 200, incluir_estatisticas: false } })
            .then(r => setFuncionarios(r.data?.data || r.data?.funcionarios || []))
            .catch(() => setFuncionarios([]));
    }, []);

    const abrir = () => {
        if (!funcionarioId) { showToast.error('Selecione um funcionário'); return; }
        setAberto(true);
    };

    const funcSel = funcionarios.find(f => f.id === funcionarioId);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400"><Sparkles className="w-6 h-6" /></div>
                <div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Retrospectiva da Equipe</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Veja o desempenho de cada colaborador em números</p>
                </div>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-sm p-6 border border-gray-200/50 dark:border-gray-700/50 space-y-5">
                <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Funcionário</label>
                    <select value={funcionarioId} onChange={e => setFuncionarioId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900/50 text-gray-900 dark:text-white">
                        <option value="">Selecione um colaborador…</option>
                        {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}{f.cargo ? ` — ${f.cargo}` : ''}</option>)}
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Competência</label>
                    <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl py-2 px-3 border border-gray-100 dark:border-gray-800 w-fit">
                        <button onClick={() => setMes(m => deslocar(m, -1))} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"><ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-200 capitalize min-w-[150px] text-center">{mesLabel(mes)}</span>
                        <button onClick={() => setMes(m => deslocar(m, 1))} disabled={mes >= mesAtualISO()} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"><ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" /></button>
                    </div>
                </div>

                <button onClick={abrir} disabled={!funcionarioId}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-black text-white bg-linear-to-r from-fuchsia-600 via-purple-600 to-indigo-700 shadow-lg shadow-purple-500/20 disabled:opacity-50 hover:scale-[1.02] transition-transform">
                    <PlayCircle className="w-5 h-5" /> Ver retrospectiva{funcSel ? ` de ${funcSel.nome.split(' ')[0]}` : ''}
                </button>
            </div>

            {funcionarioId && (
                <RetrospectivaWrapped
                    open={aberto}
                    onClose={() => setAberto(false)}
                    funcionarioId={Number(funcionarioId)}
                    anoMes={mes}
                />
            )}
        </div>
    );
}
