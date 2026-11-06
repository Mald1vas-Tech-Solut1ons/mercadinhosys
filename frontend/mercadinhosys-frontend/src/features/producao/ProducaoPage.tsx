import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Plus, Trash2, Play, CheckCircle2, XCircle, AlertTriangle, Pencil, Search, History, Copy, Undo2, PackagePlus, GitBranch } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';
import { dataLocalISO } from '../../utils/dataLocal';
import { confirmar } from '../../components/ui/Confirmacao';

// ── Tipos (espelham backend/app/services/producao_service.py) ──────────────
type Papel = 'revenda' | 'fabricado' | 'semiacabado' | 'materia_prima' | 'embalagem';
interface Item { id: number; nome: string; unidade: string; unidades: string[]; papel: Papel; quantidade: number; preco_custo: number; preco_venda: number; produto_pai_id: number | null }
interface FichaItem {
    insumo_id: number; insumo_nome: string; unidade: string; unidades: string[]; papel: Papel; quantidade: number;
    quantidade_receita: number | null; unidade_receita: string | null; perda_percentual: number;
}
interface Custo {
    material_receita: number; mao_de_obra_receita: number; indireto_receita: number; total_receita: number;
    rendimento: number; custo_unitario: number; preco_sugerido: number; preco_venda_atual: number; margem_atual_percentual: number | null;
}
interface Ficha {
    id: number; produto_id: number; produto_nome: string; produto_pai_id: number | null; unidade_produto: string; versao: number;
    rendimento: number; minutos_mao_de_obra: number; custo_hora_mao_de_obra: number; custo_indireto_percentual: number; markup_percentual: number;
    validade_dias: number | null; observacoes: string | null; ativa: boolean; itens: FichaItem[]; custo: Custo;
    capacidade: { unidades: number; gargalo_nome: string | null };
}
interface Versao {
    versao: number; criada_em: string | null; rendimento: number; custo_unitario: number | null; markup_percentual: number;
    itens: { insumo_nome: string; quantidade: number; unidade: string; quantidade_receita: number | null; unidade_receita: string | null; perda_percentual: number }[];
}
interface Necessidade {
    insumo_id: number; insumo_nome: string; unidade: string; acao: 'comprar' | 'produzir'; nivel: number;
    previsto_ordens: number; disponivel: number; a_caminho: number; comprar: number; produzir: number; custo_estimado: number; ordens: string[];
}
interface Falta { insumo_nome: string; unidade?: string; precisa: number; disponivel?: number; falta?: number }
interface Apontamento { sequencia: number; final: boolean; estornado: boolean; quantidade_boa: number; quantidade_refugo: number; custo_unitario: number | null; criado_em: string | null }
type StatusOrdem = 'planejada' | 'em_producao' | 'encerrada' | 'cancelada' | 'estornada';
interface Ordem {
    id: number; numero: string; status: StatusOrdem; ficha_id: number; ficha_versao: number | null; produto_nome: string; unidade_produto: string;
    quantidade_planejada: number; quantidade_produzida: number | null; quantidade_refugo: number | null; motivo_refugo: string | null;
    custo_unitario_padrao: number | null; custo_unitario_real: number | null; criada_em: string | null; data_encerramento: string | null;
    lote_id: number | null; lote_numero: string | null; lote_validade: string | null; variacao_custo_percentual: number | null;
    motivo_estorno: string | null; data_estorno: string | null;
    itens: { insumo_id: number; insumo_nome: string; unidade: string; quantidade_prevista: number; quantidade_consumida: number | null }[];
    apontamentos: Apontamento[];
    faltas?: Falta[];
}

const PAPEIS: { valor: Papel; nome: string }[] = [
    { valor: 'materia_prima', nome: 'Matéria-prima' }, { valor: 'embalagem', nome: 'Embalagem' },
    { valor: 'semiacabado', nome: 'Semiacabado' }, { valor: 'fabricado', nome: 'Fabricado' }, { valor: 'revenda', nome: 'Revenda' },
];
// Lista curta de motivos: refugo analisável por motivo (perda prevista fica na ficha, %).
// Genérico para qualquer produto fabricado (vela, imagem, roupa, alimento...); "Outro" aceita texto.
const MOTIVOS_REFUGO = ['Defeito de acabamento', 'Quebra / avaria', 'Bolha / rachadura', 'Medida ou peso fora do padrão', 'Erro de processo', 'Matéria-prima com defeito', 'Outro'];
const STATUS: Record<StatusOrdem, { nome: string; cor: string }> = {
    planejada: { nome: 'Planejada', cor: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
    em_producao: { nome: 'Em produção', cor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    encerrada: { nome: 'Encerrada', cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    cancelada: { nome: 'Cancelada', cor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
    estornada: { nome: 'Estornada', cor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
};

const num = (v: string) => Number(String(v).replace(',', '.'));
const qtd = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const erroApi = (e: any) => e?.response?.data?.error || 'Não foi possível concluir';
const campo = 'px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm';
const inp = `w-full ${campo}`;
const btn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm font-semibold disabled:opacity-50';
const somarDias = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return dataLocalISO(d); };
const ativos = (o: Ordem) => (o.apontamentos || []).filter(a => !a.estornado);

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
            <div className="bg-white dark:bg-slate-900 w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4 gap-2">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{titulo}</h2>
                    <button onClick={onFechar} className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-white" aria-label="Fechar"><XCircle className="w-5 h-5" /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function BuscaItem({ rotulo, onEscolher, excluir = [] }: { rotulo: string; onEscolher: (i: Item) => void; excluir?: number[] }) {
    const [busca, setBusca] = useState('');
    const [itens, setItens] = useState<Item[]>([]);
    useEffect(() => {
        if (busca.trim().length < 2) { setItens([]); return; }
        const t = setTimeout(() => {
            apiClient.get('/producao/itens', { params: { busca, limite: 15 } })
                .then(r => setItens((r.data.itens || []).filter((i: Item) => !excluir.includes(i.id)))).catch(() => setItens([]));
        }, 250);
        return () => clearTimeout(t);
    }, [busca, excluir]);
    return (
        <div className="relative">
            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input className={`${inp} pl-9`} placeholder={rotulo} value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            {itens.length > 0 && (
                <ul className="absolute z-[210] mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg">
                    {itens.map(i => (
                        <li key={i.id}>
                            <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-700"
                                onClick={() => { onEscolher(i); setBusca(''); setItens([]); }}>
                                <span className="font-medium">{i.nome}</span>
                                <span className="text-gray-500"> · {qtd(i.quantidade)} {i.unidade} · custo {formatCurrency(i.preco_custo)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Ficha técnica ─────────────────────────────────────────────────────────
interface LinhaForm { insumo_id: number; insumo_nome: string; unidades: string[]; unidade: string; papel?: Papel; quantidade: string; perda_percentual: string }

function FormFicha({ ficha, onSalvo, onFechar }: { ficha: Ficha | null; onSalvo: () => void; onFechar: () => void }) {
    const [produto, setProduto] = useState<{ id: number; nome: string } | null>(ficha ? { id: ficha.produto_id, nome: ficha.produto_nome } : null);
    const [campos, setCampos] = useState({
        rendimento: String(ficha?.rendimento ?? ''), minutos_mao_de_obra: String(ficha?.minutos_mao_de_obra ?? 0),
        custo_hora_mao_de_obra: String(ficha?.custo_hora_mao_de_obra ?? 0), custo_indireto_percentual: String(ficha?.custo_indireto_percentual ?? 0),
        markup_percentual: String(ficha?.markup_percentual ?? 100), validade_dias: String(ficha?.validade_dias ?? ''),
        observacoes: ficha?.observacoes ?? '',
    });
    const [linhas, setLinhas] = useState<LinhaForm[]>(ficha?.itens.map(i => ({
        insumo_id: i.insumo_id, insumo_nome: i.insumo_nome, papel: i.papel,
        unidades: i.unidades?.length ? i.unidades : [i.unidade],
        unidade: i.unidade_receita || i.unidades?.[0] || i.unidade,
        quantidade: String(i.unidade_receita ? i.quantidade_receita : i.quantidade), perda_percentual: String(i.perda_percentual),
    })) ?? []);
    const [salvando, setSalvando] = useState(false);
    const excluir = useMemo(() => [...linhas.map(l => l.insumo_id), ...(produto ? [produto.id] : [])], [linhas, produto]);

    const set = (k: keyof typeof campos) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCampos(c => ({ ...c, [k]: e.target.value }));
    const setLinha = (i: number, k: keyof LinhaForm, v: string) => setLinhas(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));

    const mudarPapel = async (i: number, papel: Papel) => {
        const l = linhas[i];
        try {
            await apiClient.patch(`/producao/itens/${l.insumo_id}/papel`, { papel });
            setLinhas(ls => ls.map((x, j) => j === i ? { ...x, papel } : x));
            showToast.success(papel === 'materia_prima' || papel === 'embalagem' ? `${l.insumo_nome} não aparece mais no PDV` : 'Papel atualizado');
        } catch (e) { showToast.error(erroApi(e)); }
    };

    const salvar = async () => {
        if (!produto) { showToast.error('Escolha o produto fabricado'); return; }
        if (!linhas.length) { showToast.error('Adicione pelo menos um insumo'); return; }
        setSalvando(true);
        const corpo = {
            produto_id: produto.id, rendimento: num(campos.rendimento), minutos_mao_de_obra: num(campos.minutos_mao_de_obra),
            custo_hora_mao_de_obra: num(campos.custo_hora_mao_de_obra), custo_indireto_percentual: num(campos.custo_indireto_percentual),
            markup_percentual: num(campos.markup_percentual), validade_dias: campos.validade_dias ? num(campos.validade_dias) : null,
            observacoes: campos.observacoes || null,
            itens: linhas.map(l => ({ insumo_id: l.insumo_id, quantidade: num(l.quantidade), unidade: l.unidade, perda_percentual: num(l.perda_percentual || '0') })),
        };
        try {
            if (ficha) await apiClient.put(`/producao/fichas/${ficha.id}`, corpo);
            else await apiClient.post('/producao/fichas', corpo);
            showToast.success(ficha ? `Ficha salva (versão ${ficha.versao + 1})` : 'Ficha técnica salva');
            onSalvo();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };

    return (
        <Modal titulo={ficha ? `Ficha técnica — ${ficha.produto_nome}` : 'Nova ficha técnica'} onFechar={onFechar}>
            <div className="space-y-4 text-sm">
                {!ficha && (
                    <div>
                        <label className="font-semibold">Produto que a fábrica faz *</label>
                        {produto
                            ? <div className="flex items-center justify-between mt-1 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30"><span>{produto.nome}</span><button className="text-blue-600 text-xs p-1" onClick={() => setProduto(null)}>trocar</button></div>
                            : <div className="mt-1"><BuscaItem rotulo="Busque o produto (ex.: Vela 7 dias branca, Camiseta P azul)" excluir={excluir} onEscolher={i => setProduto({ id: i.id, nome: i.nome })} /></div>}
                        <p className="text-xs text-gray-500 mt-1">Produto com grade (tamanho/cor): faça a ficha de uma variação e use “Copiar para variações”.</p>
                    </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div><label className="font-semibold">Rendimento da receita *</label><input className={inp} inputMode="decimal" value={campos.rendimento} onChange={set('rendimento')} placeholder="ex.: 190" /><p className="text-xs text-gray-500 mt-1">unidades boas por receita/lote</p></div>
                    <div><label className="font-semibold">Mão de obra (min/receita)</label><input className={inp} inputMode="decimal" value={campos.minutos_mao_de_obra} onChange={set('minutos_mao_de_obra')} /></div>
                    <div><label className="font-semibold">Custo da hora (R$)</label><input className={inp} inputMode="decimal" value={campos.custo_hora_mao_de_obra} onChange={set('custo_hora_mao_de_obra')} /></div>
                    <div><label className="font-semibold">Custo indireto (%)</label><input className={inp} inputMode="decimal" value={campos.custo_indireto_percentual} onChange={set('custo_indireto_percentual')} /><p className="text-xs text-gray-500 mt-1">energia, gás, aluguel da fábrica</p></div>
                    <div><label className="font-semibold">Markup (%)</label><input className={inp} inputMode="decimal" value={campos.markup_percentual} onChange={set('markup_percentual')} /></div>
                    <div><label className="font-semibold">Validade do lote (dias)</label><input className={inp} inputMode="numeric" value={campos.validade_dias} onChange={set('validade_dias')} placeholder="ex.: 365" /><p className="text-xs text-gray-500 mt-1">preenche a validade ao encerrar</p></div>
                </div>

                <div>
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                        <label className="font-semibold">Insumos da receita *</label>
                        <span className="text-xs text-gray-500">digite na unidade que preferir (g, ml, cm): o estoque converte sozinho</span>
                    </div>
                    <div className="space-y-2">
                        {linhas.map((l, i) => (
                            <div key={l.insumo_id} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg border border-gray-200 dark:border-slate-700">
                                <div className="col-span-10 sm:col-span-4 font-medium">{l.insumo_nome}</div>
                                <div className="col-span-2 sm:hidden text-right"><button onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))} className="p-2 text-rose-600" aria-label="Remover"><Trash2 className="w-4 h-4" /></button></div>
                                <div className="col-span-4 sm:col-span-2"><input className={inp} inputMode="decimal" value={l.quantidade} onChange={e => setLinha(i, 'quantidade', e.target.value)} aria-label="Quantidade" /></div>
                                <div className="col-span-3 sm:col-span-1">
                                    {l.unidades.length > 1
                                        ? <select className={`${inp} px-1`} value={l.unidade} onChange={e => setLinha(i, 'unidade', e.target.value)} aria-label="Unidade">{l.unidades.map(u => <option key={u} value={u}>{u}</option>)}</select>
                                        : <span className="text-gray-500">{l.unidade}</span>}
                                </div>
                                <div className="col-span-5 sm:col-span-2"><input className={inp} inputMode="decimal" value={l.perda_percentual} onChange={e => setLinha(i, 'perda_percentual', e.target.value)} aria-label="Perda %" placeholder="perda %" /></div>
                                <div className="col-span-12 sm:col-span-2">
                                    <select className={inp} value={l.papel ?? ''} onChange={e => mudarPapel(i, e.target.value as Papel)} aria-label="Papel do insumo">
                                        <option value="" disabled>papel…</option>
                                        {PAPEIS.map(p => <option key={p.valor} value={p.valor}>{p.nome}</option>)}
                                    </select>
                                </div>
                                <div className="hidden sm:block sm:col-span-1 text-right"><button onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))} className="p-1 text-rose-600" aria-label="Remover"><Trash2 className="w-4 h-4" /></button></div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2">
                        <BuscaItem rotulo="Adicionar insumo (matéria-prima, embalagem, semiacabado…)" excluir={excluir}
                            onEscolher={i => setLinhas(ls => [...ls, {
                                insumo_id: i.id, insumo_nome: i.nome, papel: i.papel, quantidade: '', perda_percentual: '0',
                                unidades: i.unidades?.length ? i.unidades : [i.unidade], unidade: i.unidades?.[0] || i.unidade,
                            }])} />
                        <p className="text-xs text-gray-500 mt-1">Semiacabado com ficha própria (ex.: massa, base, tecido cortado) entra como insumo: a necessidade calcula o que produzir antes.</p>
                    </div>
                </div>
                <div><label className="font-semibold">Observações</label><textarea className={inp} rows={2} value={campos.observacoes} onChange={set('observacoes')} placeholder="ex.: parafina 140/145 °F, pavio com fio de cobre" /></div>
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Cancelar</button>
                    <button className={`${btn} bg-blue-600 text-white`} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar ficha'}</button>
                </div>
            </div>
        </Modal>
    );
}

function Versoes({ ficha, onFechar }: { ficha: Ficha; onFechar: () => void }) {
    const [versoes, setVersoes] = useState<Versao[] | null>(null);
    useEffect(() => {
        apiClient.get(`/producao/fichas/${ficha.id}/versoes`).then(r => setVersoes(r.data.versoes || [])).catch(e => { showToast.error(erroApi(e)); setVersoes([]); });
    }, [ficha.id]);
    return (
        <Modal titulo={`Histórico — ${ficha.produto_nome}`} onFechar={onFechar}>
            {versoes === null ? <p className="text-gray-500">Carregando…</p> : versoes.length === 0 ? <p className="text-gray-500">Sem histórico.</p> : (
                <ol className="space-y-3 text-sm">
                    {versoes.map(v => (
                        <li key={v.versao} className="p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold">Versão {v.versao}{v.versao === ficha.versao ? ' · atual' : ''}</span>
                                <span className="text-xs text-gray-500">{formatDateTime(v.criada_em)}</span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">Rende {qtd(v.rendimento)} · custo/un {v.custo_unitario !== null ? formatCurrency(v.custo_unitario) : '—'} · markup {qtd(v.markup_percentual)}%</p>
                            <ul className="mt-1 text-xs text-gray-600 dark:text-slate-300 list-disc pl-5">
                                {v.itens.map(i => <li key={i.insumo_nome}>{i.insumo_nome}: {i.unidade_receita ? `${qtd(i.quantidade_receita)} ${i.unidade_receita}` : `${qtd(i.quantidade)} ${i.unidade}`}{i.perda_percentual ? ` (+${qtd(i.perda_percentual)}% perda)` : ''}</li>)}
                            </ul>
                        </li>
                    ))}
                </ol>
            )}
        </Modal>
    );
}

function CopiarVariacoes({ ficha, fichas, onCopiado, onFechar }: { ficha: Ficha; fichas: Ficha[]; onCopiado: () => void; onFechar: () => void }) {
    const [irmas, setIrmas] = useState<Item[] | null>(null);
    const [marcadas, setMarcadas] = useState<number[]>([]);
    const [salvando, setSalvando] = useState(false);
    const comFicha = useMemo(() => new Set(fichas.map(f => f.produto_id)), [fichas]);
    useEffect(() => {
        apiClient.get('/producao/itens', { params: { pai: ficha.produto_pai_id, limite: 200 } })
            .then(r => {
                const lista: Item[] = (r.data.itens || []).filter((i: Item) => i.id !== ficha.produto_id);
                setIrmas(lista);
                setMarcadas(lista.filter(i => !comFicha.has(i.id)).map(i => i.id));
            }).catch(e => { showToast.error(erroApi(e)); setIrmas([]); });
    }, [ficha, comFicha]);
    const copiar = async () => {
        setSalvando(true);
        try {
            const r = await apiClient.post(`/producao/fichas/${ficha.id}/copiar`, { produto_ids: marcadas });
            const criadas = r.data.criadas?.length ?? 0;
            const ignoradas = r.data.ignoradas ?? [];
            showToast.success(`${criadas} ficha(s) criada(s)${ignoradas.length ? ` · ${ignoradas.length} ignorada(s)` : ''}`);
            onCopiado();
            onFechar();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <Modal titulo="Copiar ficha para variações" onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                <p className="text-gray-600 dark:text-slate-300">A receita de <b>{ficha.produto_nome}</b> vai para as variações marcadas. Ajuste depois o que muda (ex.: mais tecido no tamanho G).</p>
                {irmas === null ? <p className="text-gray-500">Carregando…</p> : irmas.length === 0 ? <p className="text-gray-500">Nenhuma outra variação nesta grade.</p> : (
                    <ul className="space-y-1">
                        {irmas.map(i => (
                            <li key={i.id}>
                                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                                    <input type="checkbox" className="w-4 h-4" disabled={comFicha.has(i.id)} checked={marcadas.includes(i.id)}
                                        onChange={e => setMarcadas(m => e.target.checked ? [...m, i.id] : m.filter(x => x !== i.id))} />
                                    <span className="flex-1">{i.nome}</span>
                                    {comFicha.has(i.id) && <span className="text-xs text-gray-500">já tem ficha</span>}
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Cancelar</button>
                    <button className={`${btn} bg-blue-600 text-white`} disabled={salvando || !marcadas.length} onClick={copiar}><Copy className="w-4 h-4" /> Copiar para {marcadas.length}</button>
                </div>
            </div>
        </Modal>
    );
}

// ── Ordem de produção ─────────────────────────────────────────────────────
function Faltas({ faltas }: { faltas: Falta[] }) {
    if (!faltas.length) return null;
    return (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm">
            <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Falta insumo para esta ordem</p>
            <ul className="mt-1 list-disc pl-5">
                {faltas.map(f => <li key={f.insumo_nome}>{f.insumo_nome}: faltam {qtd(f.falta ?? f.precisa)} {f.unidade ?? ''}{f.disponivel !== undefined ? ` (tem ${qtd(f.disponivel)})` : ''}</li>)}
            </ul>
        </div>
    );
}

function NovaOrdem({ fichas, onCriada, onFechar }: { fichas: Ficha[]; onCriada: () => void; onFechar: () => void }) {
    const ativas = fichas.filter(f => f.ativa);
    const [fichaId, setFichaId] = useState<number>(ativas[0]?.id ?? 0);
    const [quantidade, setQuantidade] = useState('');
    const [observacoes, setObservacoes] = useState('');
    const [faltas, setFaltas] = useState<Falta[]>([]);
    const [salvando, setSalvando] = useState(false);
    const ficha = fichas.find(f => f.id === fichaId);
    const criar = async () => {
        setSalvando(true);
        try {
            const r = await apiClient.post('/producao/ordens', { ficha_id: fichaId, quantidade: num(quantidade), observacoes: observacoes || null });
            const op: Ordem = r.data.ordem;
            if (op.faltas?.length) { setFaltas(op.faltas); showToast.success(`${op.numero} criada; falta insumo para iniciar`); }
            else showToast.success(`${op.numero} criada`);
            onCriada();
            if (!op.faltas?.length) onFechar();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <Modal titulo="Nova ordem de produção" onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                <div><label className="font-semibold">Produto (ficha técnica)</label>
                    <select className={inp} value={fichaId} onChange={e => setFichaId(Number(e.target.value))}>
                        {ativas.map(f => <option key={f.id} value={f.id}>{f.produto_nome}</option>)}
                    </select>
                </div>
                {ficha && <p className="text-gray-600 dark:text-slate-300">Dá para fazer agora: <b>{ficha.capacidade.unidades}</b> {ficha.unidade_produto}{ficha.capacidade.gargalo_nome ? ` (limitado por ${ficha.capacidade.gargalo_nome})` : ''} · custo padrão {formatCurrency(ficha.custo.custo_unitario)}/un · ficha v{ficha.versao}</p>}
                <div><label className="font-semibold">Quantidade a produzir *</label><input className={inp} inputMode="decimal" value={quantidade} onChange={e => setQuantidade(e.target.value)} /></div>
                <div><label className="font-semibold">Observações</label><input className={inp} value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="ex.: encomenda do cliente X, entrega sexta" /></div>
                <Faltas faltas={faltas} />
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Fechar</button>
                    <button className={`${btn} bg-blue-600 text-white`} disabled={salvando || !quantidade || !fichaId} onClick={criar}>Criar ordem</button>
                </div>
            </div>
        </Modal>
    );
}

/** Entrega da OP: parcial (turno/fornada, a OP continua) ou final (encerra). */
function ApontarOrdem({ ordem, final, validadeDias, onFeito, onFechar }: { ordem: Ordem; final: boolean; validadeDias: number | null; onFeito: () => void; onFechar: () => void }) {
    const jaFeito = (ordem.quantidade_produzida ?? 0) + (ordem.quantidade_refugo ?? 0);
    const restantePlanejado = Math.max(ordem.quantidade_planejada - jaFeito, 0);
    const restante = (i: Ordem['itens'][number]) => Math.max(i.quantidade_prevista - (i.quantidade_consumida ?? 0), 0);
    const [boa, setBoa] = useState(final ? String(restantePlanejado) : '');
    const [refugo, setRefugo] = useState('0');
    const [motivo, setMotivo] = useState('');
    const [motivoOutro, setMotivoOutro] = useState('');
    const [validade, setValidade] = useState(validadeDias ? somarDias(validadeDias) : '');
    // Final: vem o que falta do previsto. Parcial: vazio = automático (proporcional ao que foi feito).
    const [consumo, setConsumo] = useState<Record<number, string>>(
        Object.fromEntries(ordem.itens.map(i => [i.insumo_id, final ? String(Number(restante(i).toFixed(4))) : ''])));
    const [faltas, setFaltas] = useState<Falta[]>([]);
    const [salvando, setSalvando] = useState(false);
    const enviar = async () => {
        setSalvando(true);
        try {
            const informados = ordem.itens.filter(i => (consumo[i.insumo_id] ?? '').trim() !== '');
            await apiClient.post(`/producao/ordens/${ordem.id}/${final ? 'encerrar' : 'apontar'}`, {
                quantidade_produzida: num(boa || '0'), quantidade_refugo: num(refugo || '0'),
                motivo_refugo: motivo === 'Outro' ? motivoOutro : motivo, data_validade: validade || undefined,
                consumo: informados.map(i => ({ insumo_id: i.insumo_id, quantidade: num(consumo[i.insumo_id]) })),
            });
            showToast.success(final ? `${ordem.numero} encerrada: estoque atualizado` : `Entrega registrada em ${ordem.numero}`);
            onFeito();
            onFechar();
        } catch (e: any) {
            if (e?.response?.data?.faltas) setFaltas(e.response.data.faltas);
            showToast.error(erroApi(e));
        } finally { setSalvando(false); }
    };
    return (
        <Modal titulo={`${final ? 'Encerrar' : 'Entrega parcial'} ${ordem.numero} — ${ordem.produto_nome}`} onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                {jaFeito > 0 && <p className="text-gray-600 dark:text-slate-300">Já entregue: <b>{qtd(ordem.quantidade_produzida)}</b> boas{ordem.quantidade_refugo ? ` + ${qtd(ordem.quantidade_refugo)} refugo` : ''} de {qtd(ordem.quantidade_planejada)} planejadas.</p>}
                <div className="grid grid-cols-2 gap-3">
                    <div><label className="font-semibold">Produzido bom{final ? '' : ' *'}</label><input className={inp} inputMode="decimal" value={boa} onChange={e => setBoa(e.target.value)} /></div>
                    <div><label className="font-semibold">Refugo</label><input className={inp} inputMode="decimal" value={refugo} onChange={e => setRefugo(e.target.value)} /></div>
                </div>
                {num(refugo) > 0 && (
                    <div><label className="font-semibold">Motivo do refugo *</label>
                        <select className={inp} value={motivo} onChange={e => setMotivo(e.target.value)}>
                            <option value="" disabled>Escolha</option>
                            {MOTIVOS_REFUGO.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {motivo === 'Outro' && <input className={`${inp} mt-2`} value={motivoOutro} onChange={e => setMotivoOutro(e.target.value)} placeholder="Descreva" />}
                    </div>
                )}
                {num(boa) > 0 && <div><label className="font-semibold">Validade do lote</label><input type="date" className={inp} min={dataLocalISO()} value={validade} onChange={e => setValidade(e.target.value)} /><p className="text-xs text-gray-500 mt-1">{validadeDias ? `pelo prazo da ficha (${validadeDias} dias); ajuste se precisar` : 'obrigatória só para produto com controle de validade (alimento, banho, cosmético); cadastre o prazo na ficha para vir pronta'}</p></div>}
                <div>
                    <label className="font-semibold">Consumo real dos insumos</label>
                    <p className="text-xs text-gray-500 mb-2">{final ? 'Vem com o que falta do previsto; ajuste se usou mais ou menos.' : 'Em branco = proporcional ao que foi feito. Preencha só se usou diferente.'}</p>
                    <div className="space-y-2">
                        {ordem.itens.map(i => (
                            <div key={i.insumo_id} className="flex items-center gap-2">
                                <span className="flex-1 min-w-0 truncate">{i.insumo_nome}<span className="block text-xs text-gray-500">usado {qtd(i.quantidade_consumida)} de {qtd(i.quantidade_prevista)}</span></span>
                                <input className={`${campo} w-24 sm:w-28 shrink-0`} inputMode="decimal" value={consumo[i.insumo_id] ?? ''} placeholder={final ? '' : 'auto'} onChange={e => setConsumo(c => ({ ...c, [i.insumo_id]: e.target.value }))} aria-label={`Consumo de ${i.insumo_nome}`} />
                                <span className="w-10 text-gray-500">{i.unidade}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <Faltas faltas={faltas} />
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Cancelar</button>
                    <button className={`${btn} ${final ? 'bg-emerald-600' : 'bg-blue-600'} text-white`} disabled={salvando || (!final && !num(boa) && !num(refugo))} onClick={enviar}>
                        {final ? <><CheckCircle2 className="w-4 h-4" /> Encerrar e dar entrada</> : <><PackagePlus className="w-4 h-4" /> Registrar entrega</>}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

function EstornarOrdem({ ordem, onFeito, onFechar }: { ordem: Ordem; onFeito: () => void; onFechar: () => void }) {
    const [motivo, setMotivo] = useState('');
    const [pin, setPin] = useState('');
    const [salvando, setSalvando] = useState(false);
    const entregas = ativos(ordem).length;
    const estornar = async () => {
        setSalvando(true);
        try {
            await apiClient.post(`/producao/ordens/${ordem.id}/estornar`, { motivo, pin });
            showToast.success(`${ordem.numero} estornada: insumos devolvidos e lote retirado`);
            onFeito();
            onFechar();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <Modal titulo={`Estornar ${ordem.numero} — ${ordem.produto_nome}`} onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                <p className="text-gray-700 dark:text-slate-200">Use quando o apontamento saiu errado. {entregas > 1 ? `As ${entregas} entregas são desfeitas: os` : 'Os'} <b>{qtd(ordem.quantidade_produzida)}</b> {ordem.unidade_produto} saem do estoque, os insumos voltam aos lotes de onde saíram e o custo médio volta ao de antes. Depois, crie a ordem de novo com os números certos.</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">Só é possível se nada dos lotes desta ordem foi vendido ou usado; senão o sistema diz quantas peças saíram.</p>
                <div><label className="font-semibold">Motivo *</label><input className={inp} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ex.: apontei 190, eram 150" /></div>
                <div><label className="font-semibold">PIN do gerente *</label><input className={inp} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} /></div>
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Voltar</button>
                    <button className={`${btn} bg-rose-600 text-white`} disabled={salvando || motivo.trim().length < 5 || !pin} onClick={estornar}><Undo2 className="w-4 h-4" /> Estornar ordem</button>
                </div>
            </div>
        </Modal>
    );
}

interface LoteInfo { lote_id: number; numero_lote?: string; produto_nome?: string | null; fornecedor?: string | null; data_validade?: string | null; quantidade_inicial?: number; saldo?: number; quantidade_usada?: number }
interface RastreioDados {
    lote: LoteInfo;
    produzido_por: { numero: string; entrega?: number; data_encerramento: string | null; insumos: { insumo_nome: string; unidade: string; quantidade_consumida: number | null; lotes: LoteInfo[] }[] } | null;
    usado_em: { numero: string; entrega?: number; estornada?: boolean; produto_nome: string; quantidade_usada: number; lote_produzido: LoteInfo | null }[];
    vendas: { venda_id: number; codigo: string | null; data: string | null; status: string | null; quantidade: number; cliente: string | null; telefone: string | null }[];
}

function Rastreio({ loteId, onFechar }: { loteId: number; onFechar: () => void }) {
    const [carregado, setCarregado] = useState<{ id: number; dados: RastreioDados } | null>(null);
    const [atual, setAtual] = useState(loteId);
    useEffect(() => {
        apiClient.get(`/producao/rastreio/lote/${atual}`).then(r => setCarregado({ id: atual, dados: r.data }))
            .catch(e => { showToast.error(erroApi(e)); onFechar(); });
    }, [atual, onFechar]);
    const dados = carregado?.id === atual ? carregado.dados : null;
    const linkLote = (l: LoteInfo | null | undefined) => l?.lote_id
        ? <button className="font-mono text-blue-600 underline" onClick={() => setAtual(l.lote_id)}>{l.numero_lote ?? `#${l.lote_id}`}</button> : <span>—</span>;
    const secao = 'p-3 rounded-lg border border-gray-200 dark:border-slate-700';
    return (
        <Modal titulo="Rastreio do lote" onFechar={onFechar}>
            {!dados ? <p className="text-gray-500">Carregando…</p> : (
                <div className="space-y-3 text-sm">
                    <div className={secao}>
                        <p className="font-bold">{dados.lote.produto_nome} · lote <span className="font-mono">{dados.lote.numero_lote}</span></p>
                        <p className="text-gray-500">Validade {formatDate(dados.lote.data_validade)} · entrou {dados.lote.quantidade_inicial} · saldo {dados.lote.saldo}{dados.lote.fornecedor ? ` · fornecedor ${dados.lote.fornecedor}` : ''}</p>
                    </div>
                    {dados.produzido_por && (
                        <div className={secao}>
                            <p className="font-semibold mb-1">De onde veio: {dados.produzido_por.numero}{dados.produzido_por.entrega && dados.produzido_por.entrega > 1 ? `, entrega ${dados.produzido_por.entrega}` : ''} ({formatDateTime(dados.produzido_por.data_encerramento)})</p>
                            <ul className="space-y-1">
                                {dados.produzido_por.insumos.map(i => (
                                    <li key={i.insumo_nome}>{i.insumo_nome}: {i.quantidade_consumida} {i.unidade}
                                        {i.lotes.length ? <> — lotes {i.lotes.map((l, k) => <span key={k}>{k ? ', ' : ' '}{linkLote(l)} ({l.quantidade_usada}{l.fornecedor ? `, ${l.fornecedor}` : ''})</span>)}</> : <span className="text-gray-500"> — sem lote controlado</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {dados.usado_em.length > 0 && (
                        <div className={secao}>
                            <p className="font-semibold mb-1">Onde foi usado (produção)</p>
                            <ul className="space-y-1">{dados.usado_em.map(u => <li key={`${u.numero}-${u.entrega ?? 1}`}>{u.numero}{u.estornada ? ' (estornada)' : ''} · {u.produto_nome} · usou {u.quantidade_usada} → lote {linkLote(u.lote_produzido)}</li>)}</ul>
                        </div>
                    )}
                    <div className={secao}>
                        <p className="font-semibold mb-1">Para quem foi vendido ({dados.vendas.length})</p>
                        {dados.vendas.length === 0 ? <p className="text-gray-500">Nenhuma venda deste lote.</p> : (
                            <div className="overflow-x-auto"><table className="w-full">
                                <thead><tr className="text-left text-xs text-gray-500"><th>Venda</th><th>Data</th><th>Qtd</th><th>Cliente</th><th>Telefone</th></tr></thead>
                                <tbody>{dados.vendas.map(v => <tr key={`${v.venda_id}-${v.quantidade}`} className="border-t border-gray-100 dark:border-slate-700"><td className="py-1">{v.codigo ?? v.venda_id}{v.status === 'cancelada' ? ' (cancelada)' : ''}</td><td>{formatDateTime(v.data)}</td><td>{v.quantidade}</td><td>{v.cliente ?? 'consumidor'}</td><td>{v.telefone ?? '—'}</td></tr>)}</tbody>
                            </table></div>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}

function BuscaLote({ onAbrir }: { onAbrir: (loteId: number) => void }) {
    const [busca, setBusca] = useState('');
    const [achados, setLotes] = useState<{ lote_id: number; numero_lote: string; produto_nome: string | null; data_validade: string | null; saldo: number }[]>([]);
    const lotes = busca.trim().length < 2 ? [] : achados;
    useEffect(() => {
        if (busca.trim().length < 2) return;
        const t = setTimeout(() => {
            apiClient.get('/producao/lotes', { params: { busca } }).then(r => setLotes(r.data.lotes || [])).catch(() => setLotes([]));
        }, 250);
        return () => clearTimeout(t);
    }, [busca]);
    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-slate-300">Digite o número do lote ou o nome do produto. Você vê de qual ordem e de quais lotes de insumo ele veio, onde foi usado e para quem foi vendido — o que precisa num recall ou numa reclamação de cliente.</p>
            <div className="relative max-w-xl">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input className={`${inp} pl-9`} placeholder="ex.: OP-20261106-001 ou parafina" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <div className="space-y-2">
                {lotes.map(l => (
                    <button key={l.lote_id} onClick={() => onAbrir(l.lote_id)} className="w-full text-left p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400">
                        <span className="font-mono font-bold">{l.numero_lote}</span> · {l.produto_nome}
                        <span className="text-gray-500 text-sm"> · validade {formatDate(l.data_validade)} · saldo {l.saldo}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Página ────────────────────────────────────────────────────────────────
export default function ProducaoPage() {
    const [aba, setAba] = useState<'fichas' | 'ordens' | 'rastreio'>('fichas');
    const [fichas, setFichas] = useState<Ficha[]>([]);
    const [ordens, setOrdens] = useState<Ordem[]>([]);
    const [necessidade, setNecessidade] = useState<Necessidade[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [editando, setEditando] = useState<Ficha | null | 'nova'>(null);
    const [historico, setHistorico] = useState<Ficha | null>(null);
    const [copiando, setCopiando] = useState<Ficha | null>(null);
    const [novaOrdem, setNovaOrdem] = useState(false);
    const [apontando, setApontando] = useState<{ ordem: Ordem; final: boolean } | null>(null);
    const [estornando, setEstornando] = useState<Ordem | null>(null);
    const [rastreando, setRastreando] = useState<number | null>(null);
    const fecharRastreio = useCallback(() => setRastreando(null), []);

    const carregar = useCallback(async () => {
        try {
            const [f, o, n] = await Promise.all([apiClient.get('/producao/fichas'), apiClient.get('/producao/ordens'),
                apiClient.get('/producao/necessidade-insumos')]);
            setFichas(f.data.fichas || []);
            setOrdens(o.data.ordens || []);
            setNecessidade(n.data.insumos || []);
        } catch (e) { showToast.error(erroApi(e)); } finally { setCarregando(false); }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);

    const acao = async (o: Ordem, tipo: 'iniciar' | 'cancelar') => {
        if (tipo === 'cancelar' && !(await confirmar({ titulo: `Cancelar ${o.numero}?`, mensagem: 'Nenhum estoque foi movimentado por esta ordem.', acao: 'Cancelar ordem', perigo: true }))) return;
        try {
            await apiClient.post(`/producao/ordens/${o.id}/${tipo}`);
            showToast.success(tipo === 'iniciar' ? `${o.numero} em produção` : `${o.numero} cancelada`);
            carregar();
        } catch (e: any) {
            const faltas: Falta[] | undefined = e?.response?.data?.faltas;
            showToast.error(faltas?.length ? `Falta: ${faltas.map(f => f.insumo_nome).join(', ')}` : erroApi(e));
        }
    };

    const pendentes = necessidade.filter(n => n.comprar > 0 || n.produzir > 0);

    return (
        <div className="p-4 md:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2"><Factory className="w-6 h-6 text-blue-600" /> Produção</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Ficha técnica, custo real e ordem de produção: insumo sai, produto pronto entra com lote.</p>
                </div>
                <div className="flex gap-2">
                    {aba === 'fichas' && <button className={`${btn} bg-blue-600 text-white w-full sm:w-auto`} onClick={() => setEditando('nova')}><Plus className="w-4 h-4" /> Nova ficha</button>}
                    {aba === 'ordens' && <button className={`${btn} bg-blue-600 text-white w-full sm:w-auto`} disabled={!fichas.length} onClick={() => setNovaOrdem(true)}><Plus className="w-4 h-4" /> Nova ordem</button>}
                </div>
            </div>

            <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
                {([['fichas', `Fichas (${fichas.length})`], ['ordens', `Ordens (${ordens.length})`], ['rastreio', 'Rastreio']] as const).map(([k, nome]) => (
                    <button key={k} onClick={() => setAba(k)} className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${aba === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>{nome}</button>
                ))}
            </div>

            {carregando && <p className="text-gray-500">Carregando…</p>}

            {!carregando && aba === 'fichas' && (
                fichas.length === 0
                    ? <div className="p-6 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 text-center text-gray-600 dark:text-slate-300">
                        <p className="font-semibold">Nenhuma ficha técnica ainda.</p>
                        <p className="text-sm mt-1">Cadastre os insumos como produtos (em kg, L, m ou unidade) e monte a receita do que a fábrica faz. Na receita, pode digitar em g, ml ou cm.</p>
                    </div>
                    : <div className="grid gap-3 md:grid-cols-2">
                        {fichas.map(f => {
                            const margemBaixa = f.custo.margem_atual_percentual !== null && f.custo.margem_atual_percentual < 30;
                            return (
                                <div key={f.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-bold text-gray-900 dark:text-white">{f.produto_nome}</p>
                                            <p className="text-xs text-gray-500">Rende {qtd(f.rendimento)} {f.unidade_produto} · {f.itens.length} insumo(s) · v{f.versao}{f.validade_dias ? ` · validade ${f.validade_dias} dias` : ''}{!f.ativa ? ' · inativa' : ''}</p>
                                        </div>
                                        <div className="flex shrink-0">
                                            {f.produto_pai_id && <button className="p-2 text-blue-600" onClick={() => setCopiando(f)} aria-label="Copiar para variações" title="Copiar para variações"><Copy className="w-4 h-4" /></button>}
                                            <button className="p-2 text-blue-600" onClick={() => setHistorico(f)} aria-label="Histórico de versões" title="Histórico"><History className="w-4 h-4" /></button>
                                            <button className="p-2 text-blue-600" onClick={() => setEditando(f)} aria-label="Editar ficha" title="Editar"><Pencil className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                                        <div><p className="text-xs text-gray-500">Custo/un</p><p className="font-bold">{formatCurrency(f.custo.custo_unitario)}</p></div>
                                        <div><p className="text-xs text-gray-500">Preço sugerido</p><p className="font-bold text-blue-600">{formatCurrency(f.custo.preco_sugerido)}</p></div>
                                        <div><p className="text-xs text-gray-500">Preço atual</p><p className={`font-bold ${margemBaixa ? 'text-rose-600' : ''}`}>{formatCurrency(f.custo.preco_venda_atual)}{f.custo.margem_atual_percentual !== null ? ` · ${f.custo.margem_atual_percentual}%` : ''}</p></div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">Material {formatCurrency(f.custo.material_receita)} + mão de obra {formatCurrency(f.custo.mao_de_obra_receita)} + indireto {formatCurrency(f.custo.indireto_receita)} por receita</p>
                                    <p className="text-sm mt-2">Dá para fazer agora: <b>{f.capacidade.unidades}</b>{f.capacidade.gargalo_nome ? <span className="text-gray-500"> (limite: {f.capacidade.gargalo_nome})</span> : null}</p>
                                </div>
                            );
                        })}
                    </div>
            )}

            {!carregando && aba === 'ordens' && pendentes.length > 0 && (
                <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Para cumprir as ordens abertas</p>
                        <Link to="/compras" className="text-sm font-semibold text-blue-700 dark:text-blue-300 underline">Abrir Compras</Link>
                    </div>
                    <ul className="divide-y divide-amber-200 dark:divide-amber-800 text-sm">
                        {pendentes.map(n => (
                            <li key={n.insumo_id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium">{n.insumo_nome}
                                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[11px] font-bold ${n.acao === 'produzir' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-amber-200 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100'}`}>{n.acao === 'produzir' ? 'PRODUZIR' : 'COMPRAR'}</span>
                                    </p>
                                    <p className="text-xs text-gray-500">precisa {qtd(n.previsto_ordens)} · tem {qtd(n.disponivel)}{n.a_caminho ? ` · a caminho ${qtd(n.a_caminho)}` : ''} · {n.ordens.join(', ')}</p>
                                </div>
                                <p className="font-bold whitespace-nowrap">{qtd(n.acao === 'produzir' ? n.produzir : n.comprar)} {n.unidade}{n.acao === 'comprar' && n.custo_estimado ? <span className="font-normal text-gray-500"> · {formatCurrency(n.custo_estimado)}</span> : null}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {!carregando && aba === 'ordens' && (
                ordens.length === 0
                    ? <p className="text-gray-500">Nenhuma ordem de produção.</p>
                    : <div className="space-y-2">
                        {ordens.map(o => {
                            const entregas = ativos(o);
                            const aberta = o.status === 'planejada' || o.status === 'em_producao';
                            return (
                                <div key={o.id} className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col md:flex-row md:items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono font-bold">{o.numero}</span>
                                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS[o.status].cor}`}>{STATUS[o.status].nome}</span>
                                            {o.ficha_versao ? <span className="text-xs text-gray-500">ficha v{o.ficha_versao}</span> : null}
                                        </div>
                                        <p className="text-sm text-gray-700 dark:text-slate-200">{o.produto_nome} · {qtd(o.quantidade_planejada)} planejadas
                                            {(o.quantidade_produzida ?? 0) > 0 || (o.quantidade_refugo ?? 0) > 0 ? ` · ${qtd(o.quantidade_produzida)} boas${o.quantidade_refugo ? ` · ${qtd(o.quantidade_refugo)} refugo (${o.motivo_refugo})` : ''}` : ''}
                                            {entregas.length > 1 ? ` · ${entregas.length} entregas` : ''}</p>
                                        <p className="text-xs text-gray-500">Custo/un padrão {o.custo_unitario_padrao !== null ? formatCurrency(o.custo_unitario_padrao) : '—'}
                                            {o.custo_unitario_real !== null ? ` · real ${formatCurrency(o.custo_unitario_real)}` : ''}
                                            {o.variacao_custo_percentual != null && <span className={o.variacao_custo_percentual > 5 ? 'text-rose-600 font-semibold' : o.variacao_custo_percentual < -5 ? 'text-emerald-600 font-semibold' : ''}> ({o.variacao_custo_percentual > 0 ? '+' : ''}{o.variacao_custo_percentual}% vs padrão)</span>}
                                            {' '}· criada {formatDateTime(o.criada_em)}</p>
                                        {o.lote_numero && o.status !== 'estornada' && <p className="text-xs text-gray-500">Lote <span className="font-mono">{o.lote_numero}</span>{entregas.length > 1 ? ` (+${entregas.length - 1})` : ''} · validade {formatDate(o.lote_validade)}</p>}
                                        {o.status === 'estornada' && <p className="text-xs text-violet-700 dark:text-violet-300">Estornada {formatDateTime(o.data_estorno)}: {o.motivo_estorno}</p>}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {o.status === 'planejada' && !entregas.length && <button className={`${btn} bg-amber-500 text-white`} onClick={() => acao(o, 'iniciar')}><Play className="w-4 h-4" /> Iniciar</button>}
                                        {aberta && <>
                                            <button className={`${btn} bg-blue-600 text-white`} onClick={() => setApontando({ ordem: o, final: false })}><PackagePlus className="w-4 h-4" /> Entrega parcial</button>
                                            <button className={`${btn} bg-emerald-600 text-white`} onClick={() => setApontando({ ordem: o, final: true })}><CheckCircle2 className="w-4 h-4" /> Encerrar</button>
                                        </>}
                                        {aberta && !entregas.length && <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={() => acao(o, 'cancelar')}>Cancelar</button>}
                                        {o.lote_id && o.status !== 'estornada' && <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={() => setRastreando(o.lote_id)}><GitBranch className="w-4 h-4" /> Rastreio</button>}
                                        {(o.status === 'encerrada' || o.status === 'em_producao') && entregas.length > 0 &&
                                            <button className={`${btn} bg-gray-100 dark:bg-slate-700 text-rose-700 dark:text-rose-300`} onClick={() => setEstornando(o)}><Undo2 className="w-4 h-4" /> Estornar</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
            )}

            {!carregando && aba === 'rastreio' && <BuscaLote onAbrir={setRastreando} />}

            {editando && <FormFicha ficha={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
            {historico && <Versoes ficha={historico} onFechar={() => setHistorico(null)} />}
            {copiando && <CopiarVariacoes ficha={copiando} fichas={fichas} onFechar={() => setCopiando(null)} onCopiado={carregar} />}
            {novaOrdem && <NovaOrdem fichas={fichas} onFechar={() => setNovaOrdem(false)} onCriada={carregar} />}
            {apontando && <ApontarOrdem ordem={apontando.ordem} final={apontando.final} validadeDias={fichas.find(f => f.id === apontando.ordem.ficha_id)?.validade_dias ?? null} onFechar={() => setApontando(null)} onFeito={carregar} />}
            {estornando && <EstornarOrdem ordem={estornando} onFechar={() => setEstornando(null)} onFeito={carregar} />}
            {rastreando !== null && <Rastreio loteId={rastreando} onFechar={fecharRastreio} />}
        </div>
    );
}
