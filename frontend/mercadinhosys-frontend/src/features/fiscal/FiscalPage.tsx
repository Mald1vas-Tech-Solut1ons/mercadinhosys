import { useState, useEffect, useCallback } from 'react';
import { FileText, Ban, CheckCircle, XCircle, Clock, RefreshCw, FileInput, FileOutput } from 'lucide-react';
import { fiscalService, DocumentoFiscal } from './fiscalService';
import EntradaNotaPanel from './EntradaNotaPanel';
import { showToast } from '../../utils/toast';

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (s?: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

const statusDoc: Record<string, { label: string; cls: string; Icon: any }> = {
    autorizado: { label: 'Autorizada', cls: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300', Icon: CheckCircle },
    rejeitado: { label: 'Rejeitada', cls: 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300', Icon: XCircle },
    cancelado: { label: 'Cancelada', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300', Icon: Ban },
    processando: { label: 'Processando', cls: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300', Icon: Clock },
    erro: { label: 'Erro', cls: 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300', Icon: XCircle },
};

export default function FiscalPage() {
    const [tab, setTab] = useState<'entrada' | 'saida'>('entrada');

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary-600 text-white"><FileText className="w-6 h-6" /></div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">Fiscal</h1>
                    <p className="text-sm text-slate-500 dark:text-gray-400">Importação de NF-e de compra e emissão de NFC-e</p>
                </div>
            </div>

            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setTab('entrada')} className={`px-4 py-2.5 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${tab === 'entrada' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'} dark:text-gray-400`}>
                    <FileInput className="w-4 h-4" /> Entrada (XML / QR Code)
                </button>
                <button onClick={() => setTab('saida')} className={`px-4 py-2.5 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${tab === 'saida' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'} dark:text-gray-400`}>
                    <FileOutput className="w-4 h-4" /> Notas Emitidas (NFC-e)
                </button>
            </div>

            {tab === 'entrada' ? <EntradaNotaPanel /> : <SaidaTab />}
        </div>
    );
}

// ───────────────────────── Saída ─────────────────────────
function SaidaTab() {
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [loading, setLoading] = useState(true);

    const carregar = useCallback(async () => {
        setLoading(true);
        try { setDocs((await fiscalService.listarDocumentos()).documentos || []); }
        catch { showToast.error('Erro ao listar documentos'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    const cancelar = async (doc: DocumentoFiscal) => {
        const justificativa = window.prompt('Justificativa do cancelamento (mín. 15 caracteres, exigência da SEFAZ):', '');
        if (justificativa === null) return;
        if (justificativa.trim().length < 15) { showToast.error('Justificativa deve ter ao menos 15 caracteres.'); return; }
        try {
            const r = await fiscalService.cancelarDocumento(doc.id, justificativa.trim());
            if (r.success) { showToast.success('NFC-e cancelada'); carregar(); }
            else showToast.error(r.message || 'Falha ao cancelar');
        } catch (e: any) { showToast.error(e?.response?.data?.error || 'Falha ao cancelar'); }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 dark:text-white">NFC-e emitidas</h3>
                <button onClick={carregar} className="text-slate-400 hover:text-slate-600"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                    <tr><th className="text-left px-5 py-2.5">Nº/Série</th><th className="text-left px-4 py-2.5 hidden md:table-cell">Chave</th><th className="text-left px-4 py-2.5">Emissão</th><th className="text-right px-4 py-2.5">Valor</th><th className="text-center px-4 py-2.5">Status</th><th className="text-right px-5 py-2.5">Ações</th></tr>
                </thead>
                <tbody>
                    {loading ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Carregando…</td></tr>
                        : docs.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Nenhuma NFC-e emitida ainda. Emita pela tela de Vendas.</td></tr>
                            : docs.map((d) => {
                                const s = statusDoc[d.status] || statusDoc.processando;
                                return (
                                    <tr key={d.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td className="px-5 py-3 font-mono text-slate-600 dark:text-slate-300">{d.numero || '—'}/{d.serie || '—'}</td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 hidden md:table-cell">{d.chave_acesso || '—'}</td>
                                        <td className="px-4 py-3 text-slate-500 dark:text-gray-400">{fmtData(d.created_at)}</td>
                                        <td className="px-4 py-3 text-right font-bold tabular-nums">{brl(d.valor_total)}</td>
                                        <td className="px-4 py-3 text-center"><span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-1 rounded-full ${s.cls}`}><s.Icon className="w-3 h-3" />{s.label}</span></td>
                                        <td className="px-5 py-3 text-right">
                                            {d.status === 'autorizado' && (
                                                <button onClick={() => cancelar(d)} className="text-error-600 hover:text-error-700 inline-flex items-center gap-1 text-xs font-semibold"><Ban className="w-4 h-4" /> Cancelar</button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                </tbody>
            </table>
            {docs.some((d) => d.ambiente === 'homologacao' || d.gateway === 'simulado') && (
                <div className="px-5 py-3 text-xs text-warning-600 bg-warning-50 dark:bg-warning-900/10 border-t border-warning-100">
                    ⚠ Ambiente de homologação/simulado — documentos SEM valor fiscal. Configure o gateway em Configurações › Fiscal para emitir em produção.
                </div>
            )}
        </div>
    );
}
