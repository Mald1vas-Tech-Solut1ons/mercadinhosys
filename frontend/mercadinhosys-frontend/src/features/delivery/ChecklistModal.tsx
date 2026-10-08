import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ClipboardCheck, CheckCircle2, XCircle, History } from 'lucide-react';
import { deliveryService, Veiculo, ChecklistItem, Checklist } from './deliveryService';
import toast from 'react-hot-toast';

/** Rótulos amigáveis para os itens padrão do checklist de saída. */
const ROTULOS: Record<string, string> = {
    pneus: 'Pneus', freios: 'Freios', setas: 'Setas', farol: 'Farol',
    lanterna_traseira: 'Lanterna traseira', buzina: 'Buzina',
    espelhos_retrovisores: 'Espelhos retrovisores', oleo_motor: 'Óleo do motor',
    agua_radiador: 'Água do radiador', extintor: 'Extintor',
};

interface Props {
    veiculo: Veiculo | null;
    onClose: () => void;
}

export default function ChecklistModal({ veiculo, onClose }: Props) {
    const [itens, setItens] = useState<ChecklistItem[]>([]);
    const [kmAtual, setKmAtual] = useState('');
    const [observacoesGerais, setObservacoesGerais] = useState('');
    const [historico, setHistorico] = useState<Checklist[]>([]);
    const [mostrarHistorico, setMostrarHistorico] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [carregando, setCarregando] = useState(false);

    useEffect(() => {
        if (!veiculo) return;
        setKmAtual(veiculo.km_atual ? String(veiculo.km_atual) : '');
        setObservacoesGerais('');
        setCarregando(true);
        deliveryService.listarChecklist(veiculo.id)
            .then(r => {
                const padrao = r.itens_padrao || Object.keys(ROTULOS);
                setItens(padrao.map(item => ({ item, ok: true, observacao: '' })));
                setHistorico(r.checklists || []);
            })
            .catch(() => setItens(Object.keys(ROTULOS).map(item => ({ item, ok: true, observacao: '' }))))
            .finally(() => setCarregando(false));
    }, [veiculo]);

    if (!veiculo) return null;

    const toggleItem = (idx: number) => {
        setItens(prev => prev.map((it, i) => i === idx ? { ...it, ok: !it.ok } : it));
    };

    const setObs = (idx: number, valor: string) => {
        setItens(prev => prev.map((it, i) => i === idx ? { ...it, observacao: valor } : it));
    };

    const salvar = async () => {
        const reprovados = itens.filter(i => !i.ok);
        if (reprovados.some(i => !i.observacao?.trim())) {
            toast.error('Descreva o problema dos itens reprovados');
            return;
        }
        setSalvando(true);
        try {
            await deliveryService.criarChecklist(veiculo.id, {
                km_atual: kmAtual ? Number(kmAtual) : undefined,
                itens,
                observacoes_gerais: observacoesGerais || undefined,
                motorista_id: veiculo.motorista_id || undefined,
            });
            const aprovado = reprovados.length === 0;
            toast.success(aprovado ? 'Checklist aprovado! Veículo liberado.' : 'Checklist registrado com itens reprovados.');
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.error || 'Erro ao registrar checklist');
        } finally {
            setSalvando(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-linear-to-r from-emerald-600 to-teal-700 text-white p-5 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-white/15"><ClipboardCheck className="w-5 h-5" /></div>
                        <div>
                            <h3 className="font-black text-lg leading-tight">Checklist de Saída</h3>
                            <p className="text-white/70 text-xs">{veiculo.placa} · {veiculo.modelo}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/15"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">KM atual do veículo</label>
                        <input type="number" value={kmAtual} onChange={e => setKmAtual(e.target.value)} placeholder="Ex: 15230"
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                    </div>

                    {carregando ? (
                        <p className="text-sm text-gray-400 text-center py-4">Carregando itens…</p>
                    ) : (
                        <div className="space-y-2">
                            {itens.map((it, idx) => (
                                <div key={it.item} className={`rounded-xl border p-3 ${it.ok ? 'border-gray-100 dark:border-gray-800' : 'border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/5'}`}>
                                    <button type="button" onClick={() => toggleItem(idx)} className="w-full flex items-center justify-between">
                                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ROTULOS[it.item] || it.item}</span>
                                        {it.ok ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold"><CheckCircle2 className="w-4 h-4" /> OK</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs font-bold"><XCircle className="w-4 h-4" /> Reprovado</span>
                                        )}
                                    </button>
                                    {!it.ok && (
                                        <input value={it.observacao || ''} onChange={e => setObs(idx, e.target.value)} placeholder="Descreva o problema…"
                                            className="w-full mt-2 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Observações gerais</label>
                        <textarea value={observacoesGerais} onChange={e => setObservacoesGerais(e.target.value)} rows={2}
                            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                    </div>

                    <button onClick={salvar} disabled={salvando}
                        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50">
                        {salvando ? 'Salvando…' : 'Concluir Checklist'}
                    </button>

                    <button onClick={() => setMostrarHistorico(v => !v)} className="w-full text-xs text-gray-400 hover:text-gray-600 inline-flex items-center justify-center gap-1.5">
                        <History className="w-3.5 h-3.5" /> {mostrarHistorico ? 'Ocultar' : 'Ver'} histórico ({historico.length})
                    </button>

                    {mostrarHistorico && (
                        <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
                            {historico.length === 0 ? (
                                <p className="text-xs text-gray-400 text-center">Nenhum checklist anterior</p>
                            ) : historico.map(h => (
                                <div key={h.id} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500 dark:text-gray-400">{h.created_at ? new Date(h.created_at).toLocaleString('pt-BR') : '—'}</span>
                                    <span className={`font-bold ${h.aprovado ? 'text-emerald-600' : 'text-rose-600'}`}>{h.aprovado ? 'Aprovado' : 'Reprovado'}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
