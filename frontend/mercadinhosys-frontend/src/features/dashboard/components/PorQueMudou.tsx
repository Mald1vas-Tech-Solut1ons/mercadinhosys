import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus, PackageX, Loader2 } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { formatCurrency } from '../../../utils/formatters';
import { dataDoDia } from '../../../utils/dataLocal';

export interface PeriodoDashboard {
    de: string; // AAAA-MM-DD (dia da loja)
    ate: string;
}

interface ItemProduto { produto_id: number; nome: string; atual: number; anterior: number; variacao: number; estoque: number }

const diaMes = (iso: string) => dataDoDia(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const sinal = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const moeda = (v: number) => `${sinal(v)}${formatCurrency(Math.abs(v))}`;

function Variacao({ pct }: { pct: number | null }) {
    if (pct === null || pct === undefined) return <span className="text-xs text-gray-400 dark:text-gray-500">sem base anterior</span>;
    const Icone = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
    const cor = pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : pct < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500';
    return <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${cor}`}><Icone className="w-3.5 h-3.5" />{Math.abs(pct).toFixed(1)}%</span>;
}

/**
 * "Por que o faturamento mudou?": período atual x anterior de mesma duração, a ponte
 * (quantidade de vendas x ticket, conta exata) e os produtos que puxaram a variação.
 */
export default function PorQueMudou({ periodo }: { periodo: PeriodoDashboard }) {
    const navigate = useNavigate();
    const [dados, setDados] = useState<any>(null);
    const [erro, setErro] = useState(false);
    const [carregando, setCarregando] = useState(true);

    useEffect(() => {
        let vivo = true;
        setCarregando(true);
        setErro(false);
        apiClient.get('/dashboard/comparativo', { params: { start_date: periodo.de, end_date: periodo.ate } })
            .then(({ data }) => { if (vivo) setDados(data); })
            .catch(() => { if (vivo) setErro(true); })
            .finally(() => { if (vivo) setCarregando(false); });
        return () => { vivo = false; };
    }, [periodo.de, periodo.ate]);

    const caixa = 'bg-white dark:bg-slate-800/80 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/50 shadow-lg';
    if (carregando) return <div className={`${caixa} flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400`}><Loader2 className="w-4 h-4 animate-spin" /> Comparando com o período anterior…</div>;
    if (erro || !dados) return <div className={`${caixa} text-sm text-red-600 dark:text-red-400`}>Não foi possível comparar com o período anterior agora.</div>;

    const { atual, anterior, variacao, ponte, produtos } = dados;
    const delta = variacao.faturamento as number;
    const passos = [
        { nome: 'Período anterior', valor: ponte.anterior, tipo: 'total' },
        { nome: variacao.vendas >= 0 ? `Mais vendas (${sinal(variacao.vendas)}${Math.abs(variacao.vendas)})` : `Menos vendas (${variacao.vendas})`, valor: ponte.efeito_quantidade, tipo: 'efeito' },
        { nome: variacao.ticket >= 0 ? 'Ticket médio maior' : 'Ticket médio menor', valor: ponte.efeito_ticket, tipo: 'efeito' },
        { nome: 'Período atual', valor: ponte.atual, tipo: 'total' },
    ];
    // Cascata: cada efeito começa onde o anterior terminou (anterior → +qtd → +ticket = atual).
    const inicioPasso = [0, ponte.anterior, ponte.anterior + ponte.efeito_quantidade, 0];
    const fimPasso = [ponte.anterior, ponte.anterior + ponte.efeito_quantidade, ponte.atual, ponte.atual];
    const escala = Math.max(...inicioPasso, ...fimPasso, 1);

    const frase = anterior.vendas === 0
        ? `Não houve vendas entre ${diaMes(anterior.inicio)} e ${diaMes(anterior.fim)}; não há base para comparar.`
        : `O faturamento ${delta >= 0 ? 'subiu' : 'caiu'} ${formatCurrency(Math.abs(delta))}: ` +
          `${moeda(ponte.efeito_quantidade)} vieram da quantidade de vendas e ${moeda(ponte.efeito_ticket)} do valor de cada venda.`;

    const lista = (titulo: string, itens: ItemProduto[], cor: string, vazio: string) => (
        <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">{titulo}</p>
            {itens.length === 0 ? <p className="text-xs text-gray-400 dark:text-gray-500">{vazio}</p> : (
                <ul className="space-y-1.5">
                    {itens.map((p) => (
                        <li key={p.produto_id}>
                            <button onClick={() => navigate(`/products/${p.produto_id}`)} className="w-full flex justify-between gap-3 text-left text-sm hover:underline">
                                <span className="truncate text-gray-700 dark:text-gray-200">{p.nome}</span>
                                <span className={`shrink-0 font-bold ${cor}`}>{moeda(p.variacao)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );

    return (
        <div className={caixa}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Por que o faturamento mudou?</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                    {diaMes(atual.inicio)}–{diaMes(atual.fim)} comparado a {diaMes(anterior.inicio)}–{diaMes(anterior.fim)}
                </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">{frase}</p>

            <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                    { nome: 'Faturamento', atual: formatCurrency(atual.faturamento), antes: formatCurrency(anterior.faturamento), pct: variacao.faturamento_pct },
                    { nome: 'Vendas', atual: String(atual.vendas), antes: String(anterior.vendas), pct: variacao.vendas_pct },
                    { nome: 'Ticket médio', atual: formatCurrency(atual.ticket), antes: formatCurrency(anterior.ticket), pct: variacao.ticket_pct },
                ].map((m) => (
                    <div key={m.nome} className="rounded-xl border border-gray-100 dark:border-slate-700 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">{m.nome}</p>
                        <p className="text-base sm:text-lg font-black text-gray-900 dark:text-white">{m.atual}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">antes {m.antes} · <Variacao pct={m.pct} /></p>
                    </div>
                ))}
            </div>

            {anterior.vendas > 0 && (
                <div className="space-y-2 mb-6" aria-label="Ponte do faturamento">
                    {passos.map((p, i) => {
                        const a = Math.min(inicioPasso[i], fimPasso[i]), b = Math.max(inicioPasso[i], fimPasso[i]);
                        const esquerda = `${(a / escala) * 100}%`;
                        const largura = `${Math.max(1.5, ((b - a) / escala) * 100)}%`;
                        const cor = p.tipo === 'total' ? 'bg-slate-400 dark:bg-slate-500' : p.valor >= 0 ? 'bg-emerald-500' : 'bg-red-500';
                        return (
                            <div key={p.nome} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                                <span className={`truncate ${p.tipo === 'total' ? 'font-bold text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>{p.nome}</span>
                                <div className="relative h-3 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden"><div className={`absolute inset-y-0 rounded-full ${cor}`} style={{ left: esquerda, width: largura }} /></div>
                                <span className={`w-28 text-right font-bold ${p.tipo === 'total' ? 'text-gray-900 dark:text-white' : p.valor >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {p.tipo === 'total' ? formatCurrency(p.valor) : moeda(p.valor)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {lista('Mais ganharam', produtos.ganhos, 'text-emerald-600 dark:text-emerald-400', 'Nenhum produto cresceu.')}
                {lista('Mais perderam', produtos.perdas, 'text-red-600 dark:text-red-400', 'Nenhum produto caiu.')}
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1">
                        <PackageX className="w-3.5 h-3.5" /> Pararam por falta de estoque
                    </p>
                    {produtos.ruptura.length === 0 ? <p className="text-xs text-gray-400 dark:text-gray-500">Nenhuma venda perdida por ruptura.</p> : (
                        <>
                            <ul className="space-y-1.5">
                                {produtos.ruptura.map((p: ItemProduto) => (
                                    <li key={p.produto_id}>
                                        <button onClick={() => navigate(`/products/${p.produto_id}`)} className="w-full flex justify-between gap-3 text-left text-sm hover:underline">
                                            <span className="truncate text-gray-700 dark:text-gray-200">{p.nome}</span>
                                            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">vendia {formatCurrency(p.anterior)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                {formatCurrency(produtos.ruptura_valor_anterior)} vendidos antes; repor evita perder essa venda.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
