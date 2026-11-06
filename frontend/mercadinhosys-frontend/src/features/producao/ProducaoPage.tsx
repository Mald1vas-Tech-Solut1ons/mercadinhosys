import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Factory, Plus, Trash2, Play, CheckCircle2, XCircle, AlertTriangle, Pencil, Search, Undo2, GitBranch } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';
import { dataLocalISO } from '../../utils/dataLocal';
import { confirmar } from '../../components/ui/Confirmacao';

// ── Tipos (espelham backend/app/services/producao_service.py) ──────────────
type Papel = 'revenda' | 'fabricado' | 'semiacabado' | 'materia_prima' | 'embalagem';
interface Item { id: number; nome: string; unidade: string; papel: Papel; quantidade: number; preco_custo: number; preco_venda: number }
interface FichaItem { insumo_id: number; insumo_nome: string; unidade: string; quantidade: number; perda_percentual: number }
interface Custo {
    material_receita: number; mao_de_obra_receita: number; indireto_receita: number; total_receita: number;
    rendimento: number; custo_unitario: number; preco_sugerido: number; preco_venda_atual: number; margem_atual_percentual: number | null;
}
interface Ficha {
    id: number; produto_id: number; produto_nome: string; unidade_produto: string; rendimento: number;
    minutos_mao_de_obra: number; custo_hora_mao_de_obra: number; custo_indireto_percentual: number; markup_percentual: number;
    validade_dias: number | null; observacoes: string | null; ativa: boolean; itens: FichaItem[]; custo: Custo;
    capacidade: { unidades: number; gargalo_nome: string | null };
}
interface Necessidade { insumo_id: number; insumo_nome: string; unidade: string; previsto_ordens: number; disponivel: number; a_caminho: number; comprar: number; custo_estimado: number; ordens: string[] }
interface Falta { insumo_nome: string; unidade?: string; precisa: number; disponivel?: number; falta?: number }
interface Ordem {
    id: number; numero: string; status: 'planejada' | 'em_producao' | 'encerrada' | 'cancelada' | 'estornada'; ficha_id: number; produto_nome: string;
    lote_id: number | null; lote_numero: string | null; lote_validade: string | null; variacao_custo_percentual: number | null;
    motivo_estorno: string | null; data_estorno: string | null;
    quantidade_planejada: number; quantidade_produzida: number | null; quantidade_refugo: number | null; motivo_refugo: string | null;
    custo_unitario_padrao: number | null; custo_unitario_real: number | null; criada_em: string | null; data_encerramento: string | null;
    itens: { insumo_id: number; insumo_nome: string; unidade: string; quantidade_prevista: number; quantidade_consumida: number | null }[];
    faltas?: Falta[];
}

const PAPEIS: { valor: Papel; nome: string }[] = [
    { valor: 'materia_prima', nome: 'Matéria-prima' }, { valor: 'embalagem', nome: 'Embalagem' },
    { valor: 'semiacabado', nome: 'Semiacabado' }, { valor: 'fabricado', nome: 'Fabricado' }, { valor: 'revenda', nome: 'Revenda' },
];
// Lista curta de motivos: refugo analisável por motivo (perda prevista fica na ficha, %).
// Genérico para qualquer produto fabricado (vela, imagem, guia, banho, alimento...); "Outro" aceita texto.
const MOTIVOS_REFUGO = ['Defeito de acabamento', 'Quebra / avaria', 'Bolha / rachadura', 'Medida ou peso fora do padrão', 'Erro de processo', 'Matéria-prima com defeito', 'Outro'];
const STATUS: Record<Ordem['status'], { nome: string; cor: string }> = {
    planejada: { nome: 'Planejada', cor: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
    em_producao: { nome: 'Em produção', cor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    encerrada: { nome: 'Encerrada', cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    cancelada: { nome: 'Cancelada', cor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
    estornada: { nome: 'Estornada', cor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
};
const somarDias = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return dataLocalISO(d); };

const num = (v: string) => Number(String(v).replace(',', '.'));
const erroApi = (e: any) => e?.response?.data?.error || 'Não foi possível concluir';
const inp = 'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50';

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
            <div className="bg-white dark:bg-slate-900 w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{titulo}</h2>
                    <button onClick={onFechar} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-white" aria-label="Fechar"><XCircle className="w-5 h-5" /></button>
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
                                <span className="text-gray-500"> · {i.quantidade} {i.unidade} · custo {formatCurrency(i.preco_custo)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Ficha técnica ─────────────────────────────────────────────────────────
interface LinhaForm { insumo_id: number; insumo_nome: string; unidade: string; papel?: Papel; quantidade: string; perda_percentual: string }

function FormFicha({ ficha, onSalvo, onFechar }: { ficha: Ficha | null; onSalvo: () => void; onFechar: () => void }) {
    const [produto, setProduto] = useState<{ id: number; nome: string } | null>(ficha ? { id: ficha.produto_id, nome: ficha.produto_nome } : null);
    const [campos, setCampos] = useState({
        rendimento: String(ficha?.rendimento ?? ''), minutos_mao_de_obra: String(ficha?.minutos_mao_de_obra ?? 0),
        custo_hora_mao_de_obra: String(ficha?.custo_hora_mao_de_obra ?? 0), custo_indireto_percentual: String(ficha?.custo_indireto_percentual ?? 0),
        markup_percentual: String(ficha?.markup_percentual ?? 100), validade_dias: String(ficha?.validade_dias ?? ''),
        observacoes: ficha?.observacoes ?? '',
    });
    const [linhas, setLinhas] = useState<LinhaForm[]>(ficha?.itens.map(i => ({
        insumo_id: i.insumo_id, insumo_nome: i.insumo_nome, unidade: i.unidade,
        quantidade: String(i.quantidade), perda_percentual: String(i.perda_percentual),
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
            itens: linhas.map(l => ({ insumo_id: l.insumo_id, quantidade: num(l.quantidade), perda_percentual: num(l.perda_percentual || '0') })),
        };
        try {
            if (ficha) await apiClient.put(`/producao/fichas/${ficha.id}`, corpo);
            else await apiClient.post('/producao/fichas', corpo);
            showToast.success('Ficha técnica salva');
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
                            ? <div className="flex items-center justify-between mt-1 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30"><span>{produto.nome}</span><button className="text-blue-600 text-xs" onClick={() => setProduto(null)}>trocar</button></div>
                            : <div className="mt-1"><BuscaItem rotulo="Busque o produto (ex.: Vela 7 dias branca)" excluir={excluir} onEscolher={i => setProduto({ id: i.id, nome: i.nome })} /></div>}
                    </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div><label className="font-semibold">Rendimento da receita *</label><input className={inp} inputMode="decimal" value={campos.rendimento} onChange={set('rendimento')} placeholder="ex.: 190" /><p className="text-xs text-gray-500 mt-1">unidades boas por receita/lote</p></div>
                    <div><label className="font-semibold">Mão de obra (min/receita)</label><input className={inp} inputMode="decimal" value={campos.minutos_mao_de_obra} onChange={set('minutos_mao_de_obra')} /></div>
                    <div><label className="font-semibold">Custo da hora (R$)</label><input className={inp} inputMode="decimal" value={campos.custo_hora_mao_de_obra} onChange={set('custo_hora_mao_de_obra')} /></div>
                    <div><label className="font-semibold">Custo indireto (%)</label><input className={inp} inputMode="decimal" value={campos.custo_indireto_percentual} onChange={set('custo_indireto_percentual')} /><p className="text-xs text-gray-500 mt-1">energia, gás, aluguel da fábrica</p></div>
                    <div><label className="font-semibold">Markup (%)</label><input className={inp} inputMode="decimal" value={campos.markup_percentual} onChange={set('markup_percentual')} /></div>
                    <div><label className="font-semibold">Validade do lote (dias)</label><input className={inp} inputMode="numeric" value={campos.validade_dias} onChange={set('validade_dias')} placeholder="ex.: 365" /><p className="text-xs text-gray-500 mt-1">preenche a validade ao encerrar a ordem</p></div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="font-semibold">Insumos da receita *</label>
                        <span className="text-xs text-gray-500">quantidade na unidade de estoque do insumo (kg, L, un, m)</span>
                    </div>
                    <div className="space-y-2">
                        {linhas.map((l, i) => (
                            <div key={l.insumo_id} className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg border border-gray-200 dark:border-slate-700">
                                <div className="col-span-12 sm:col-span-4 font-medium">{l.insumo_nome}</div>
                                <div className="col-span-4 sm:col-span-2"><input className={inp} inputMode="decimal" value={l.quantidade} onChange={e => setLinha(i, 'quantidade', e.target.value)} aria-label="Quantidade" /></div>
                                <div className="col-span-2 sm:col-span-1 text-gray-500">{l.unidade}</div>
                                <div className="col-span-4 sm:col-span-2"><input className={inp} inputMode="decimal" value={l.perda_percentual} onChange={e => setLinha(i, 'perda_percentual', e.target.value)} aria-label="Perda %" placeholder="perda %" /></div>
                                <div className="col-span-10 sm:col-span-2">
                                    <select className={inp} value={l.papel ?? ''} onChange={e => mudarPapel(i, e.target.value as Papel)} aria-label="Papel do insumo">
                                        <option value="" disabled>papel…</option>
                                        {PAPEIS.map(p => <option key={p.valor} value={p.valor}>{p.nome}</option>)}
                                    </select>
                                </div>
                                <div className="col-span-2 sm:col-span-1 text-right"><button onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))} className="p-1 text-rose-600" aria-label="Remover"><Trash2 className="w-4 h-4" /></button></div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2">
                        <BuscaItem rotulo="Adicionar insumo (parafina, pavio, copo, essência…)" excluir={excluir}
                            onEscolher={i => setLinhas(ls => [...ls, { insumo_id: i.id, insumo_nome: i.nome, unidade: i.unidade, papel: i.papel, quantidade: '', perda_percentual: '0' }])} />
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

// ── Ordem de produção ─────────────────────────────────────────────────────
function Faltas({ faltas }: { faltas: Falta[] }) {
    if (!faltas.length) return null;
    return (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm">
            <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Falta insumo para esta ordem</p>
            <ul className="mt-1 list-disc pl-5">
                {faltas.map(f => <li key={f.insumo_nome}>{f.insumo_nome}: faltam {f.falta ?? f.precisa} {f.unidade ?? ''}{f.disponivel !== undefined ? ` (tem ${f.disponivel})` : ''}</li>)}
            </ul>
        </div>
    );
}

function NovaOrdem({ fichas, onCriada, onFechar }: { fichas: Ficha[]; onCriada: () => void; onFechar: () => void }) {
    const [fichaId, setFichaId] = useState<number>(fichas[0]?.id ?? 0);
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
                        {fichas.filter(f => f.ativa).map(f => <option key={f.id} value={f.id}>{f.produto_nome}</option>)}
                    </select>
                </div>
                {ficha && <p className="text-gray-600 dark:text-slate-300">Dá para fazer agora: <b>{ficha.capacidade.unidades}</b> {ficha.unidade_produto}{ficha.capacidade.gargalo_nome ? ` (limitado por ${ficha.capacidade.gargalo_nome})` : ''} · custo padrão {formatCurrency(ficha.custo.custo_unitario)}/un</p>}
                <div><label className="font-semibold">Quantidade a produzir *</label><input className={inp} inputMode="decimal" value={quantidade} onChange={e => setQuantidade(e.target.value)} /></div>
                <div><label className="font-semibold">Observações</label><input className={inp} value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="ex.: encomenda do terreiro X, entrega sexta" /></div>
                <Faltas faltas={faltas} />
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Fechar</button>
                    <button className={`${btn} bg-blue-600 text-white`} disabled={salvando || !quantidade || !fichaId} onClick={criar}>Criar ordem</button>
                </div>
            </div>
        </Modal>
    );
}

function EncerrarOrdem({ ordem, validadeDias, onEncerrada, onFechar }: { ordem: Ordem; validadeDias: number | null; onEncerrada: () => void; onFechar: () => void }) {
    const [boa, setBoa] = useState(String(ordem.quantidade_planejada));
    const [refugo, setRefugo] = useState('0');
    const [motivo, setMotivo] = useState('');
    const [motivoOutro, setMotivoOutro] = useState('');
    const [validade, setValidade] = useState(validadeDias ? somarDias(validadeDias) : '');
    const [consumo, setConsumo] = useState<Record<number, string>>(Object.fromEntries(ordem.itens.map(i => [i.insumo_id, String(i.quantidade_prevista)])));
    const [faltas, setFaltas] = useState<Falta[]>([]);
    const [salvando, setSalvando] = useState(false);
    const encerrar = async () => {
        setSalvando(true);
        try {
            await apiClient.post(`/producao/ordens/${ordem.id}/encerrar`, {
                quantidade_produzida: num(boa), quantidade_refugo: num(refugo || '0'),
                motivo_refugo: motivo === 'Outro' ? motivoOutro : motivo, data_validade: validade || undefined,
                consumo: ordem.itens.map(i => ({ insumo_id: i.insumo_id, quantidade: num(consumo[i.insumo_id] ?? '0') })),
            });
            showToast.success(`${ordem.numero} encerrada: estoque atualizado`);
            onEncerrada();
            onFechar();
        } catch (e: any) {
            if (e?.response?.data?.faltas) setFaltas(e.response.data.faltas);
            showToast.error(erroApi(e));
        } finally { setSalvando(false); }
    };
    return (
        <Modal titulo={`Encerrar ${ordem.numero} — ${ordem.produto_nome}`} onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                    <div><label className="font-semibold">Produzido bom *</label><input className={inp} inputMode="decimal" value={boa} onChange={e => setBoa(e.target.value)} /></div>
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
                <div><label className="font-semibold">Validade do lote</label><input type="date" className={inp} min={dataLocalISO()} value={validade} onChange={e => setValidade(e.target.value)} /><p className="text-xs text-gray-500 mt-1">{validadeDias ? `pelo prazo da ficha (${validadeDias} dias); ajuste se precisar` : 'obrigatória só para produto com controle de validade (banho, sabonete); cadastre o prazo na ficha para vir pronta'}</p></div>
                <div>
                    <label className="font-semibold">Consumo real dos insumos</label>
                    <p className="text-xs text-gray-500 mb-2">Vem preenchido com o previsto pela ficha; ajuste se usou mais ou menos.</p>
                    <div className="space-y-2">
                        {ordem.itens.map(i => (
                            <div key={i.insumo_id} className="flex items-center gap-2">
                                <span className="flex-1">{i.insumo_nome}</span>
                                <input className={`${inp} w-28`} inputMode="decimal" value={consumo[i.insumo_id] ?? ''} onChange={e => setConsumo(c => ({ ...c, [i.insumo_id]: e.target.value }))} aria-label={`Consumo de ${i.insumo_nome}`} />
                                <span className="w-10 text-gray-500">{i.unidade}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <Faltas faltas={faltas} />
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Cancelar</button>
                    <button className={`${btn} bg-emerald-600 text-white`} disabled={salvando} onClick={encerrar}><CheckCircle2 className="w-4 h-4" /> Encerrar e dar entrada</button>
                </div>
            </div>
        </Modal>
    );
}

function EstornarOrdem({ ordem, onEstornada, onFechar }: { ordem: Ordem; onEstornada: () => void; onFechar: () => void }) {
    const [motivo, setMotivo] = useState('');
    const [pin, setPin] = useState('');
    const [salvando, setSalvando] = useState(false);
    const estornar = async () => {
        setSalvando(true);
        try {
            await apiClient.post(`/producao/ordens/${ordem.id}/estornar`, { motivo, pin });
            showToast.success(`${ordem.numero} estornada: insumos devolvidos e lote retirado`);
            onEstornada();
            onFechar();
        } catch (e) { showToast.error(erroApi(e)); } finally { setSalvando(false); }
    };
    return (
        <Modal titulo={`Estornar ${ordem.numero} — ${ordem.produto_nome}`} onFechar={onFechar}>
            <div className="space-y-3 text-sm">
                <p className="text-gray-600 dark:text-slate-300">Use quando o apontamento saiu errado. Os insumos voltam aos lotes de onde saíram, o lote {ordem.lote_numero ?? ''} ({ordem.quantidade_produzida} {ordem.produto_nome}) sai do estoque e o custo médio volta ao de antes. Só é possível se nada desse lote foi vendido ou usado. Depois, crie a ordem de novo com os números certos.</p>
                <div><label className="font-semibold">Motivo *</label><input className={inp} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ex.: apontei 190, eram 150" /></div>
                <div><label className="font-semibold">PIN do gerente *</label><input className={inp} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} /></div>
                <div className="flex justify-end gap-2">
                    <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={onFechar}>Cancelar</button>
                    <button className={`${btn} bg-purple-600 text-white`} disabled={salvando || motivo.trim().length < 5 || !pin} onClick={estornar}><Undo2 className="w-4 h-4" /> Estornar ordem</button>
                </div>
            </div>
        </Modal>
    );
}

interface LoteInfo { lote_id: number; numero_lote?: string; produto_nome?: string | null; fornecedor?: string | null; data_validade?: string | null; quantidade_inicial?: number; saldo?: number; quantidade_usada?: number }
interface RastreioDados {
    lote: LoteInfo;
    produzido_por: { numero: string; data_encerramento: string | null; insumos: { insumo_nome: string; unidade: string; quantidade_consumida: number | null; lotes: LoteInfo[] }[] } | null;
    usado_em: { numero: string; produto_nome: string; quantidade_usada: number; lote_produzido: LoteInfo | null }[];
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
                            <p className="font-semibold mb-1">De onde veio: {dados.produzido_por.numero} ({formatDateTime(dados.produzido_por.data_encerramento)})</p>
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
                            <ul className="space-y-1">{dados.usado_em.map(u => <li key={u.numero}>{u.numero} · {u.produto_nome} · usou {u.quantidade_usada} → lote {linkLote(u.lote_produzido)}</li>)}</ul>
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
    const [novaOrdem, setNovaOrdem] = useState(false);
    const [encerrando, setEncerrando] = useState<Ordem | null>(null);
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
        if (tipo === 'cancelar' && !(await confirmar({ titulo: `Cancelar ${o.numero}?`, mensagem: 'Nenhum estoque foi movimentado por esta ordem.' }))) return;
        try {
            await apiClient.post(`/producao/ordens/${o.id}/${tipo}`);
            showToast.success(tipo === 'iniciar' ? `${o.numero} em produção` : `${o.numero} cancelada`);
            carregar();
        } catch (e: any) {
            const faltas: Falta[] | undefined = e?.response?.data?.faltas;
            showToast.error(faltas?.length ? `Falta: ${faltas.map(f => f.insumo_nome).join(', ')}` : erroApi(e));
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2"><Factory className="w-6 h-6 text-blue-600" /> Produção</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Ficha técnica, custo real e ordem de produção: insumo sai, produto pronto entra com lote.</p>
                </div>
                <div className="flex gap-2">
                    {aba === 'fichas' && <button className={`${btn} bg-blue-600 text-white`} onClick={() => setEditando('nova')}><Plus className="w-4 h-4" /> Nova ficha</button>}
                    {aba === 'ordens' && <button className={`${btn} bg-blue-600 text-white`} disabled={!fichas.length} onClick={() => setNovaOrdem(true)}><Plus className="w-4 h-4" /> Nova ordem</button>}
                </div>
            </div>

            <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
                {([['fichas', `Fichas técnicas (${fichas.length})`], ['ordens', `Ordens de produção (${ordens.length})`], ['rastreio', 'Rastreio de lote']] as const).map(([k, nome]) => (
                    <button key={k} onClick={() => setAba(k)} className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${aba === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>{nome}</button>
                ))}
            </div>

            {carregando && <p className="text-gray-500">Carregando…</p>}

            {!carregando && aba === 'fichas' && (
                fichas.length === 0
                    ? <div className="p-6 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 text-center text-gray-600 dark:text-slate-300">
                        <p className="font-semibold">Nenhuma ficha técnica ainda.</p>
                        <p className="text-sm mt-1">Cadastre os insumos como produtos (parafina em kg, pavio e copo em unidade) e monte a receita do que a fábrica faz.</p>
                    </div>
                    : <div className="grid gap-3 md:grid-cols-2">
                        {fichas.map(f => {
                            const margemBaixa = f.custo.margem_atual_percentual !== null && f.custo.margem_atual_percentual < 30;
                            return (
                                <div key={f.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white">{f.produto_nome}</p>
                                            <p className="text-xs text-gray-500">Receita rende {f.rendimento} {f.unidade_produto} · {f.itens.length} insumo(s){f.validade_dias ? ` · validade ${f.validade_dias} dias` : ''}{!f.ativa ? ' · inativa' : ''}</p>
                                        </div>
                                        <button className="p-1 text-blue-600" onClick={() => setEditando(f)} aria-label="Editar ficha"><Pencil className="w-4 h-4" /></button>
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

            {!carregando && aba === 'ordens' && necessidade.some(n => n.comprar > 0) && (
                <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Comprar para produzir as ordens abertas</p>
                        <Link to="/compras" className="text-sm font-semibold text-blue-700 dark:text-blue-300 underline">Abrir Compras</Link>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-xs text-gray-600 dark:text-slate-400"><th className="py-1">Insumo</th><th>Previsto nas OPs</th><th>Tem</th><th>A caminho</th><th>Comprar</th><th>Custo estimado</th></tr></thead>
                            <tbody>
                                {necessidade.filter(n => n.comprar > 0).map(n => (
                                    <tr key={n.insumo_id} className="border-t border-amber-200 dark:border-amber-800">
                                        <td className="py-1 font-medium">{n.insumo_nome}<span className="block text-xs text-gray-500">{n.ordens.join(', ')}</span></td>
                                        <td>{n.previsto_ordens} {n.unidade}</td><td>{n.disponivel}</td><td>{n.a_caminho}</td>
                                        <td className="font-bold">{n.comprar} {n.unidade}</td><td>{formatCurrency(n.custo_estimado)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!carregando && aba === 'ordens' && (
                ordens.length === 0
                    ? <p className="text-gray-500">Nenhuma ordem de produção.</p>
                    : <div className="space-y-2">
                        {ordens.map(o => (
                            <div key={o.id} className="p-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono font-bold">{o.numero}</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS[o.status].cor}`}>{STATUS[o.status].nome}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 dark:text-slate-200">{o.produto_nome} · {o.quantidade_planejada} planejadas
                                        {o.status === 'encerrada' || o.status === 'estornada' ? ` · ${o.quantidade_produzida} boas${o.quantidade_refugo ? ` · ${o.quantidade_refugo} refugo (${o.motivo_refugo})` : ''}` : ''}</p>
                                    <p className="text-xs text-gray-500">Custo/un padrão {o.custo_unitario_padrao !== null ? formatCurrency(o.custo_unitario_padrao) : '—'}
                                        {o.custo_unitario_real !== null ? ` · real ${formatCurrency(o.custo_unitario_real)}` : ''}
                                        {o.variacao_custo_percentual !== null && <span className={o.variacao_custo_percentual > 5 ? 'text-rose-600 font-semibold' : o.variacao_custo_percentual < -5 ? 'text-emerald-600 font-semibold' : ''}> ({o.variacao_custo_percentual > 0 ? '+' : ''}{o.variacao_custo_percentual}% vs padrão)</span>}
                                        {' '}· criada {formatDateTime(o.criada_em)}</p>
                                    {o.lote_numero && o.status === 'encerrada' && <p className="text-xs text-gray-500">Lote <span className="font-mono">{o.lote_numero}</span> · validade {formatDate(o.lote_validade)}</p>}
                                    {o.status === 'estornada' && <p className="text-xs text-purple-700 dark:text-purple-300">Estornada {formatDateTime(o.data_estorno)}: {o.motivo_estorno}</p>}
                                </div>
                                <div className="flex gap-2">
                                    {o.status === 'planejada' && <button className={`${btn} bg-amber-500 text-white`} onClick={() => acao(o, 'iniciar')}><Play className="w-4 h-4" /> Iniciar</button>}
                                    {(o.status === 'planejada' || o.status === 'em_producao') && <>
                                        <button className={`${btn} bg-emerald-600 text-white`} onClick={() => setEncerrando(o)}><CheckCircle2 className="w-4 h-4" /> Encerrar</button>
                                        <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={() => acao(o, 'cancelar')}>Cancelar</button>
                                    </>}
                                    {o.status === 'encerrada' && o.lote_id && <button className={`${btn} bg-gray-100 dark:bg-slate-700`} onClick={() => setRastreando(o.lote_id)}><GitBranch className="w-4 h-4" /> Rastreio</button>}
                                    {o.status === 'encerrada' && <button className={`${btn} bg-gray-100 dark:bg-slate-700 text-purple-700 dark:text-purple-300`} onClick={() => setEstornando(o)}><Undo2 className="w-4 h-4" /> Estornar</button>}
                                </div>
                            </div>
                        ))}
                    </div>
            )}

            {!carregando && aba === 'rastreio' && <BuscaLote onAbrir={setRastreando} />}

            {editando && <FormFicha ficha={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
            {novaOrdem && <NovaOrdem fichas={fichas} onFechar={() => setNovaOrdem(false)} onCriada={carregar} />}
            {encerrando && <EncerrarOrdem ordem={encerrando} validadeDias={fichas.find(f => f.id === encerrando.ficha_id)?.validade_dias ?? null} onFechar={() => setEncerrando(null)} onEncerrada={carregar} />}
            {estornando && <EstornarOrdem ordem={estornando} onFechar={() => setEstornando(null)} onEstornada={carregar} />}
            {rastreando !== null && <Rastreio loteId={rastreando} onFechar={fecharRastreio} />}
        </div>
    );
}
