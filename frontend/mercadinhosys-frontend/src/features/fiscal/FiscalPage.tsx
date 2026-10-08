import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Download, Ban, CheckCircle, XCircle, Clock, RefreshCw, FileInput, FileOutput } from 'lucide-react';
import { fiscalService, NotaEntrada, NotaEntradaPreview, DocumentoFiscal } from './fiscalService';
import { apiClient } from '../../api/apiClient';
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
                    <p className="text-sm text-slate-500">Importação de NF-e de compra e emissão de NFC-e</p>
                </div>
            </div>

            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setTab('entrada')} className={`px-4 py-2.5 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${tab === 'entrada' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                    <FileInput className="w-4 h-4" /> Entrada (XML de compra)
                </button>
                <button onClick={() => setTab('saida')} className={`px-4 py-2.5 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${tab === 'saida' ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                    <FileOutput className="w-4 h-4" /> Notas Emitidas (NFC-e)
                </button>
            </div>

            {tab === 'entrada' ? <EntradaTab /> : <SaidaTab />}
        </div>
    );
}

// ───────────────────────── Entrada ─────────────────────────
function EntradaTab() {
    const [notas, setNotas] = useState<NotaEntrada[]>([]);
    const [loading, setLoading] = useState(true);
    const [preview, setPreview] = useState<NotaEntradaPreview | null>(null);
    const [arquivo, setArquivo] = useState<File | null>(null);
    const [importando, setImportando] = useState(false);
    const [destinoCompra, setDestinoCompra] = useState('');
    const [avulsaConfirmada, setAvulsaConfirmada] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const leituraAtual = useRef(0);

    const carregar = useCallback(async () => {
        setLoading(true);
        try { setNotas((await fiscalService.listarEntradas()).notas || []); }
        catch { showToast.error('Erro ao listar notas de entrada'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    const processarArquivo = async (file: File) => {
        if (importando) return;
        if (!file.name.toLowerCase().endsWith('.xml')) { showToast.error('Selecione um arquivo .xml'); return; }
        const leitura = ++leituraAtual.current;
        setArquivo(file);
        setPreview(null);
        setDestinoCompra('');
        setAvulsaConfirmada(false);
        try {
            const pv = await fiscalService.previewEntrada(file);
            if (leitura !== leituraAtual.current) return;
            setPreview(pv);
        } catch (e: any) {
            if (leitura !== leituraAtual.current) return;
            showToast.error(e?.response?.data?.error || 'Falha ao ler o XML');
            setArquivo(null);
        }
    };

    const confirmarImportacao = async () => {
        if (!arquivo || !destinoCompra || (destinoCompra === 'avulsa' && !avulsaConfirmada)) return;
        setImportando(true);
        try {
            const r = await fiscalService.importarEntrada(arquivo,
                destinoCompra === 'avulsa' ? undefined : Number(destinoCompra), destinoCompra === 'avulsa');
            const res = r.resultado || {};
            showToast.success(res.modo === 'vinculada'
                ? 'XML vinculado ao pedido. Estoque e cobrança continuam no recebimento da compra.'
                : `Nota importada: ${res.produtos_criados || 0} novos, ${res.produtos_atualizados || 0} atualizados, ${res.contas_pagar_geradas || 0} conta(s) a pagar.`);
            setPreview(null); setArquivo(null);
            carregar();
        } catch (e: any) {
            showToast.error(e?.response?.data?.error || 'Falha ao importar a nota');
        } finally { setImportando(false); }
    };

    const baixarXml = async (id: number) => {
        try {
            const resp = await apiClient.get(fiscalService.urlXmlEntrada(id), { responseType: 'blob' });
            const url = URL.createObjectURL(resp.data as Blob);
            const a = document.createElement('a'); a.href = url; a.download = `NFe-${id}.xml`; a.click();
            URL.revokeObjectURL(url);
        } catch { showToast.error('Falha ao baixar XML'); }
    };

    return (
        <div className="space-y-6">
            {/* Dropzone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) processarArquivo(f); }}
                onClick={() => !importando && inputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-slate-300 dark:border-slate-700 hover:border-primary-400'}`}
            >
                <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                <p className="font-bold text-slate-700 dark:text-slate-200">Arraste o XML da NF-e de compra aqui</p>
                <p className="text-sm text-slate-500">Vincule ao pedido de compra ou confira uma compra avulsa antes de importar.</p>
                <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processarArquivo(f); e.currentTarget.value = ''; }} />
            </div>

            {/* Lista de notas importadas */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white">Notas de entrada importadas</h3>
                    <button onClick={carregar} className="text-slate-400 hover:text-slate-600"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                </div>
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                        <tr><th className="text-left px-5 py-2.5">Fornecedor</th><th className="text-left px-4 py-2.5">Nº/Série</th><th className="text-left px-4 py-2.5 hidden md:table-cell">Emissão</th><th className="text-right px-4 py-2.5">Valor</th><th className="text-right px-5 py-2.5">XML</th></tr>
                    </thead>
                    <tbody>
                        {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Carregando…</td></tr>
                            : notas.length === 0 ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Nenhuma nota importada ainda.</td></tr>
                                : notas.map((n) => (
                                    <tr key={n.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td className="px-5 py-3 font-medium text-slate-700 dark:text-slate-200">{n.fornecedor_nome || n.emitente_nome}</td>
                                        <td className="px-4 py-3 text-slate-500 font-mono">{n.numero}/{n.serie}{n.pedido_compra_id && <p className="text-xs">Pedido #{n.pedido_compra_id}</p>}</td>
                                        <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{fmtData(n.data_emissao)}</td>
                                        <td className="px-4 py-3 text-right font-bold tabular-nums">{brl(n.valor_total)}</td>
                                        <td className="px-5 py-3 text-right"><button onClick={() => baixarXml(n.id)} className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 text-xs font-semibold"><Download className="w-4 h-4" /> XML</button></td>
                                    </tr>
                                ))}
                    </tbody>
                </table>
            </div>

            {/* Modal de preview */}
            {preview && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1rem + env(safe-area-inset-top))' }} onClick={(e) => e.target === e.currentTarget && setPreview(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                            <h3 className="font-black text-slate-900 dark:text-white">Conferir importação</h3>
                            <p className="text-xs text-slate-500">{preview.emitente.nome} · NF-e {preview.numero}/{preview.serie} · {brl(preview.total)}</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-3">
                            {preview.ja_importada && <div className="rounded-xl bg-warning-50 text-warning-700 dark:bg-warning-900/20 px-4 py-3 text-sm font-semibold">⚠ Esta nota já foi importada anteriormente.</div>}
                            <label className="block text-sm font-semibold">
                                Destino da nota
                                <select value={destinoCompra} disabled={importando} onChange={e => { setDestinoCompra(e.target.value); setAvulsaConfirmada(false); }} className="mt-2 block w-full rounded-lg border p-2 dark:bg-slate-800">
                                    <option value="">Selecione o pedido ou compra avulsa</option>
                                    {(preview.pedidos_fornecedor || []).map(p => <option key={p.id} value={p.id}>{p.numero_pedido} · {p.status} · {brl(p.total)}</option>)}
                                    <option value="avulsa">Compra avulsa, sem pedido</option>
                                </select>
                            </label>
                            {destinoCompra && destinoCompra !== 'avulsa' && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">O XML deve cobrir o pedido inteiro. Não gera outra entrada de estoque ou cobrança. Confira a mercadoria no recebimento do pedido, inclusive em cargas parciais.</p>}
                            {destinoCompra === 'avulsa' && <label className="flex gap-2 rounded-lg bg-warning-50 p-3 text-sm text-warning-800"><input type="checkbox" checked={avulsaConfirmada} disabled={importando} onChange={e => setAvulsaConfirmada(e.target.checked)} />Confirmo que esta compra não foi registrada ou recebida por pedido. A importação movimentará estoque e gerará contas a pagar.</label>}
                            <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                                {preview.itens.map((it, i) => (
                                    <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                                        <div>
                                            <p className="font-medium text-slate-700 dark:text-slate-200">{it.descricao}</p>
                                            <p className="text-xs text-slate-400">{it.quantidade} × {brl(it.valor_unitario)} {it.ncm ? `· NCM ${it.ncm}` : ''}</p>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${it.produto_existente ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                                            {destinoCompra && destinoCompra !== 'avulsa' ? 'Conferir vínculo' : it.produto_existente ? 'Atualizar estoque' : 'Novo produto'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            {destinoCompra === 'avulsa' && preview.duplicatas.length > 0 && (
                                <p className="text-xs text-slate-500">{preview.duplicatas.length} conta(s) a pagar serão geradas (1ª vence {preview.duplicatas[0].vencimento}).</p>
                            )}
                        </div>
                        <div className="flex gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
                            <button onClick={() => { setPreview(null); setArquivo(null); }} disabled={importando} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-sm text-slate-600 dark:text-slate-300">Cancelar</button>
                            <button onClick={confirmarImportacao} disabled={importando || preview.ja_importada || !destinoCompra || (destinoCompra === 'avulsa' && !avulsaConfirmada)} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-50">
                                {importando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Confirmar importação
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
                                        <td className="px-4 py-3 text-slate-500">{fmtData(d.created_at)}</td>
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
