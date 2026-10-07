import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, IdCard, FileWarning, ClipboardX } from 'lucide-react';
import { deliveryService, RelatorioConformidade } from './deliveryService';

interface Props {
    open: boolean;
    onClose: () => void;
}

function Secao({ titulo, icon, itens, render }: {
    titulo: string; icon: React.ReactNode; itens: any[]; render: (it: any) => string;
}) {
    if (itens.length === 0) return null;
    return (
        <div>
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase mb-2">{icon}{titulo} ({itens.length})</div>
            <ul className="space-y-1.5">
                {itens.map((it, i) => (
                    <li key={i} className="text-sm bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-200">
                        {render(it)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function ConformidadeModal({ open, onClose }: Props) {
    const [dados, setDados] = useState<RelatorioConformidade | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        deliveryService.getConformidade(30)
            .then(setDados)
            .catch(() => setDados(null))
            .finally(() => setLoading(false));
    }, [open]);

    if (!open) return null;
    const r = dados?.resumo;

    return createPortal(
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 w-full sm:max-w-xl sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className={`sticky top-0 text-white p-5 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl ${r?.conforme ? 'bg-linear-to-r from-emerald-600 to-teal-700' : 'bg-linear-to-r from-rose-600 to-red-700'}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-white/15">{r?.conforme ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}</div>
                        <div>
                            <h3 className="font-black text-lg leading-tight">Relatório de Conformidade</h3>
                            <p className="text-white/70 text-xs">{dados ? new Date(dados.gerado_em).toLocaleString('pt-BR') : 'Carregando…'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/15"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-5 space-y-5">
                    {loading ? (
                        <p className="text-sm text-gray-400 text-center py-8">Analisando frota e motoristas…</p>
                    ) : !dados ? (
                        <p className="text-sm text-gray-400 text-center py-8">Não foi possível carregar o relatório.</p>
                    ) : (
                        <>
                            <div className={`rounded-xl p-4 flex items-center justify-between ${r?.conforme ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
                                <div>
                                    <p className={`font-black text-lg ${r?.conforme ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                        {r?.conforme ? 'Tudo em conformidade' : `${r?.total_pendencias_criticas} pendência(s) crítica(s)`}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{r?.total_motoristas} motoristas · {r?.total_veiculos} veículos ativos</p>
                                </div>
                                {r?.conforme ? <CheckCircle2 className="w-8 h-8 text-emerald-500" /> : <AlertTriangle className="w-8 h-8 text-rose-500" />}
                            </div>

                            <Secao titulo="CNH vencida" icon={<IdCard className="w-4 h-4 text-rose-500" />} itens={dados.cnh.vencidas}
                                render={it => `${it.nome} — vencida há ${Math.abs(it.dias)} dia(s)`} />
                            <Secao titulo="CNH a vencer (30 dias)" icon={<IdCard className="w-4 h-4 text-amber-500" />} itens={dados.cnh.a_vencer}
                                render={it => `${it.nome} — vence em ${it.dias} dia(s)`} />

                            <Secao titulo="Licenciamento vencido" icon={<FileWarning className="w-4 h-4 text-rose-500" />} itens={dados.licenciamento.vencido}
                                render={it => `Placa ${it.placa} — vencido há ${Math.abs(it.dias)} dia(s)`} />
                            <Secao titulo="Licenciamento a vencer (30 dias)" icon={<FileWarning className="w-4 h-4 text-amber-500" />} itens={dados.licenciamento.a_vencer}
                                render={it => `Placa ${it.placa} — vence em ${it.dias} dia(s)`} />

                            <Secao titulo="Seguro vencido" icon={<FileWarning className="w-4 h-4 text-rose-500" />} itens={dados.seguro.vencido}
                                render={it => `Placa ${it.placa} — vencido há ${Math.abs(it.dias)} dia(s)`} />
                            <Secao titulo="Seguro a vencer (30 dias)" icon={<FileWarning className="w-4 h-4 text-amber-500" />} itens={dados.seguro.a_vencer}
                                render={it => `Placa ${it.placa} — vence em ${it.dias} dia(s)`} />

                            <Secao titulo="Checklist pendente" icon={<ClipboardX className="w-4 h-4 text-rose-500" />} itens={dados.checklist_pendente}
                                render={it => `Placa ${it.placa} — ${it.motivo}`} />

                            {r?.conforme && (
                                <div className="text-center py-6">
                                    <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma pendência de CNH, licenciamento, seguro ou checklist encontrada.</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
