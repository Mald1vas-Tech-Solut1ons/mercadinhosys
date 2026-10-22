/**
 * Entrada de estoque pela nota do FORNECEDOR — vale em qualquer plano, sem certificado.
 *
 * Três caminhos, todos com a mesma prévia e as mesmas regras de importação:
 * - XML da NF-e (o fornecedor manda por e-mail) — upload pelo seletor de arquivos do celular;
 * - QR Code do cupom (NFC-e de SP) — itens lidos na consulta pública da SEFAZ-SP;
 * - chave do DANFE (código de barras de 44 dígitos) — diz se a nota já entrou; os itens
 *   exigem o XML (baixar da SEFAZ pela chave exige certificado A1, fora do escopo).
 */
import { Suspense, useState, useEffect, useCallback, useRef, lazy } from 'react';
import { Upload, Download, CheckCircle, RefreshCw, QrCode, ScanLine, AlertTriangle, X } from 'lucide-react';
import { fiscalService, NotaEntrada, NotaEntradaPreview, ConsultaChave } from './fiscalService';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
const LerNotaModal = lazy(() => import('./LerNotaModal'));
import { interpretarLeitura } from './chaveAcesso';

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtdFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtData = (s?: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

type Fonte = { tipo: 'xml'; arquivo: File } | { tipo: 'qrcode'; url: string };

interface Props {
    /** Abre o leitor ao montar (botão "Nota fiscal (QR Code)" de outras telas). */
    abrirLeitor?: boolean;
    /** Texto recebido pelo Web Share Target (URL do QR lida pela câmera nativa). */
    textoCompartilhado?: string;
}

export default function EntradaNotaPanel({ abrirLeitor = false, textoCompartilhado }: Props) {
    const [notas, setNotas] = useState<NotaEntrada[]>([]);
    const [loading, setLoading] = useState(true);
    const [preview, setPreview] = useState<NotaEntradaPreview | null>(null);
    const [fonte, setFonte] = useState<Fonte | null>(null);
    const [importando, setImportando] = useState(false);
    const [destinoCompra, setDestinoCompra] = useState('');
    const [avulsaConfirmada, setAvulsaConfirmada] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [leitorAberto, setLeitorAberto] = useState(abrirLeitor);
    const [consultando, setConsultando] = useState(false);
    const [consultaChave, setConsultaChave] = useState<ConsultaChave | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const leituraAtual = useRef(0);
    const compartilhadoProcessado = useRef(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        try { setNotas((await fiscalService.listarEntradas()).notas || []); }
        catch { showToast.error('Erro ao listar notas de entrada'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    const limparPrevia = () => { setPreview(null); setFonte(null); setDestinoCompra(''); setAvulsaConfirmada(false); };

    const processarArquivo = async (file: File) => {
        if (importando) return;
        // Anexo baixado do e-mail no celular às vezes vem sem extensão/mime: o backend valida o conteúdo.
        if (file.size > 5 * 1024 * 1024) { showToast.error('Arquivo grande demais para um XML de NF-e.'); return; }
        const leitura = ++leituraAtual.current;
        limparPrevia();
        setConsultaChave(null);
        try {
            const pv = await fiscalService.previewEntrada(file);
            if (leitura !== leituraAtual.current) return;
            setFonte({ tipo: 'xml', arquivo: file });
            setPreview(pv);
        } catch (e: any) {
            if (leitura !== leituraAtual.current) return;
            showToast.error(e?.response?.data?.error || 'Falha ao ler o XML');
        }
    };

    /** Roteia o que foi lido: QR de SP → itens da SEFAZ; chave → "já entrou?"; resto → mensagem. */
    const aoLer = useCallback(async (texto: string) => {
        const leitura = interpretarLeitura(texto);
        if (leitura.tipo === 'erro') { showToast.error(leitura.erro); return; }
        const id = ++leituraAtual.current;
        setConsultando(true);
        try {
            if (leitura.tipo === 'qrcode_sp') {
                const pv = await fiscalService.previewQrcode(leitura.url);
                if (id !== leituraAtual.current) return;
                setLeitorAberto(false);
                setConsultaChave(null);
                setDestinoCompra(''); setAvulsaConfirmada(false);
                setFonte({ tipo: 'qrcode', url: leitura.url });
                setPreview(pv);
            } else {
                const r = await fiscalService.consultarChave(leitura.info.chave);
                if (id !== leituraAtual.current) return;
                setLeitorAberto(false);
                setConsultaChave(r);
            }
        } catch (e: any) {
            if (id !== leituraAtual.current) return;
            showToast.error(e?.response?.data?.error || 'Falha ao consultar a nota');
        } finally {
            if (id === leituraAtual.current) setConsultando(false);
        }
    }, []);

    // Web Share Target: /entrada-nfe?url=...&text=... já consulta a nota.
    useEffect(() => {
        if (textoCompartilhado && !compartilhadoProcessado.current) {
            compartilhadoProcessado.current = true;
            setLeitorAberto(false);
            void aoLer(textoCompartilhado);
        }
    }, [textoCompartilhado, aoLer]);

    const confirmarImportacao = async () => {
        if (!fonte || !destinoCompra || (destinoCompra === 'avulsa' && !avulsaConfirmada)) return;
        setImportando(true);
        const pedidoId = destinoCompra === 'avulsa' ? undefined : Number(destinoCompra);
        const avulsa = destinoCompra === 'avulsa';
        try {
            const r = fonte.tipo === 'xml'
                ? await fiscalService.importarEntrada(fonte.arquivo, pedidoId, avulsa)
                : await fiscalService.importarQrcode(fonte.url, pedidoId, avulsa);
            const res = r.resultado || {};
            showToast.success(res.modo === 'vinculada'
                ? 'Nota vinculada ao pedido. Estoque e cobrança continuam no recebimento da compra.'
                : `Nota importada: ${res.produtos_criados || 0} novos, ${res.produtos_atualizados || 0} atualizados, ${res.contas_pagar_geradas || 0} conta(s) a pagar.`);
            limparPrevia();
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

    const podeConfirmar = !!preview && !importando && !preview.ja_importada && !!destinoCompra && (destinoCompra !== 'avulsa' || avulsaConfirmada);

    return (
        <div className="space-y-4">
            {/* Ações: no celular, botões grandes empilhados */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button type="button" onClick={() => !importando && inputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) processarArquivo(f); }}
                    className={`sm:col-span-1 flex items-center gap-3 rounded-2xl border-2 border-dashed p-4 text-left transition ${dragOver ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-slate-300 dark:border-slate-700 hover:border-primary-400'}`}>
                    <Upload className="w-8 h-8 shrink-0 text-slate-400" />
                    <span><span className="block font-bold text-slate-700 dark:text-slate-200">Enviar XML da NF-e</span>
                        <span className="block text-xs text-slate-500">Arquivo que o fornecedor manda por e-mail</span></span>
                </button>
                <button type="button" onClick={() => setLeitorAberto(true)}
                    className="flex items-center gap-3 rounded-2xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 p-4 text-left">
                    <QrCode className="w-8 h-8 shrink-0 text-primary-600" />
                    <span><span className="block font-bold text-primary-700 dark:text-primary-300">Nota fiscal (QR Code)</span>
                        <span className="block text-xs text-slate-500">Cupom NFC-e de SP: itens lidos na SEFAZ</span></span>
                </button>
                <button type="button" onClick={() => setLeitorAberto(true)}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-left">
                    <ScanLine className="w-8 h-8 shrink-0 text-slate-500" />
                    <span><span className="block font-bold text-slate-700 dark:text-slate-200">Ler chave da nota</span>
                        <span className="block text-xs text-slate-500">Código de barras do DANFE (44 dígitos)</span></span>
                </button>
                <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml,application/octet-stream" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) processarArquivo(f); e.currentTarget.value = ''; }} />
            </div>

            {consultaChave && (
                <div className={`relative rounded-2xl p-4 pr-10 text-sm ${consultaChave.ja_importada ? 'bg-success-50 text-success-800 dark:bg-success-900/20 dark:text-success-200' : 'bg-warning-50 text-warning-800 dark:bg-warning-900/20 dark:text-warning-200'}`}>
                    <button type="button" onClick={() => setConsultaChave(null)} className="absolute top-3 right-3" aria-label="Fechar"><X className="w-4 h-4" /></button>
                    <p className="font-bold flex items-center gap-2">
                        {consultaChave.ja_importada ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                        {consultaChave.chave.modelo_descricao} {consultaChave.chave.numero}/{consultaChave.chave.serie} · {consultaChave.chave.uf} · CNPJ {consultaChave.chave.cnpj_emitente}
                    </p>
                    <p className="mt-1">{consultaChave.mensagem}</p>
                    {!consultaChave.ja_importada && (
                        <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-warning-600 px-4 py-2.5 font-bold text-white">
                            <Upload className="w-4 h-4" /> Enviar o XML agora
                        </button>
                    )}
                </div>
            )}

            {/* Notas importadas: cartões no celular, tabela no desktop */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-white">Notas de entrada importadas</h3>
                    <button onClick={carregar} className="p-2 text-slate-400 hover:text-slate-600" aria-label="Atualizar"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                </div>
                {loading ? <p className="px-5 py-8 text-center text-slate-400">Carregando…</p>
                    : notas.length === 0 ? <p className="px-5 py-8 text-center text-slate-400">Nenhuma nota importada ainda.</p>
                        : <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {notas.map((n) => (
                                <li key={n.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-700 dark:text-slate-200 truncate">{n.fornecedor_nome || n.emitente_nome}</p>
                                        <p className="text-xs text-slate-500 font-mono">{n.modelo === '65' ? 'NFC-e' : 'NF-e'} {n.numero}/{n.serie} · {fmtData(n.data_emissao)}{n.pedido_compra_id ? ` · Pedido #${n.pedido_compra_id}` : ''}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="font-bold tabular-nums">{brl(n.valor_total)}</span>
                                        {n.modelo !== '65' && <button onClick={() => baixarXml(n.id)} className="text-primary-600 inline-flex items-center gap-1 text-xs font-semibold p-1"><Download className="w-4 h-4" /> XML</button>}
                                    </div>
                                </li>
                            ))}
                        </ul>}
            </div>

            {leitorAberto && (
                <Suspense fallback={<div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"><RefreshCw className="w-6 h-6 animate-spin text-white" /></div>}>
                    <LerNotaModal onFechar={() => { leituraAtual.current++; setConsultando(false); setLeitorAberto(false); }} onLido={aoLer} carregando={consultando} />
                </Suspense>
            )}
            {!leitorAberto && consultando && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
                    <div className="rounded-2xl bg-white dark:bg-slate-900 px-6 py-5 flex items-center gap-3 font-semibold"><RefreshCw className="w-5 h-5 animate-spin text-primary-600" /> Consultando a nota…</div>
                </div>
            )}

            {/* Prévia: folha inferior no celular (botão de confirmar sempre ao alcance do polegar) */}
            {preview && (
                <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
                    onClick={(e) => e.target === e.currentTarget && !importando && limparPrevia()}>
                    <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl h-[92dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                            <h3 className="font-black text-slate-900 dark:text-white">Conferir entrada</h3>
                            <p className="text-xs text-slate-500">{preview.emitente.nome} · {preview.origem === 'qrcode' ? 'NFC-e' : 'NF-e'} {preview.numero}/{preview.serie} · {brl(preview.total)} · {preview.qtd_itens} itens</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 overscroll-contain">
                            {preview.ja_importada && <div className="rounded-xl bg-warning-50 text-warning-700 dark:bg-warning-900/20 px-4 py-3 text-sm font-semibold">Esta nota já foi importada nesta loja.</div>}
                            <label className="block text-sm font-semibold">
                                Destino da nota
                                <select value={destinoCompra} disabled={importando} onChange={e => { setDestinoCompra(e.target.value); setAvulsaConfirmada(false); }} className="mt-2 block w-full rounded-xl border p-3 text-base dark:bg-slate-800">
                                    <option value="">Selecione o pedido ou compra avulsa</option>
                                    {(preview.pedidos_fornecedor || []).map(p => <option key={p.id} value={p.id}>{p.numero_pedido} · {p.status} · {brl(p.total)}</option>)}
                                    <option value="avulsa">Compra avulsa, sem pedido</option>
                                </select>
                            </label>
                            {destinoCompra && destinoCompra !== 'avulsa' && <p className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">A nota deve cobrir o pedido inteiro. Não gera outra entrada de estoque ou cobrança; confira a mercadoria no recebimento do pedido.</p>}
                            {destinoCompra === 'avulsa' && <label className="flex gap-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 p-3 text-sm text-warning-800 dark:text-warning-200"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={avulsaConfirmada} disabled={importando} onChange={e => setAvulsaConfirmada(e.target.checked)} />Confirmo que esta compra não foi registrada por pedido. A importação dá entrada no estoque e gera conta a pagar.</label>}
                            <ul className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                                {preview.itens.map((it, i) => (
                                    <li key={i} className="px-4 py-3 text-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-medium text-slate-700 dark:text-slate-200 break-words">{it.descricao}</p>
                                            <span className={`shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-full ${it.produto_existente ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                                                {destinoCompra && destinoCompra !== 'avulsa' ? 'Conferir' : it.produto_existente ? 'Soma estoque' : 'Novo'}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                            <b className="text-slate-700 dark:text-slate-300">{qtdFmt(it.quantidade)} {it.unidade || 'UN'}</b> × {brl(it.valor_unitario)} = {brl(it.valor_total)}
                                            {it.ean ? ` · EAN ${it.ean}` : ' · sem EAN'}{it.icms_st ? ' · ICMS-ST' : ''}
                                        </p>
                                        {it.produto_existente && it.produto_nome && <p className="text-xs text-blue-600 dark:text-blue-300">→ {it.produto_nome}</p>}
                                    </li>
                                ))}
                            </ul>
                            {destinoCompra === 'avulsa' && preview.duplicatas.length > 0 && (
                                <p className="text-xs text-slate-500">{preview.duplicatas.length} conta(s) a pagar serão geradas (1ª vence {preview.duplicatas[0].vencimento}).</p>
                            )}
                        </div>
                        <div className="flex gap-2 px-4 pt-3 border-t border-slate-200 dark:border-slate-800" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
                            <button onClick={limparPrevia} disabled={importando} className="flex-1 px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-sm text-slate-600 dark:text-slate-300">Cancelar</button>
                            <button onClick={confirmarImportacao} disabled={!podeConfirmar} className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-50">
                                {importando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Confirmar entrada
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
