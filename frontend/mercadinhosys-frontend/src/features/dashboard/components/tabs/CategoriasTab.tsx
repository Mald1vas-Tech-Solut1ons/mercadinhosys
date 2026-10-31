import { useEffect, useMemo, useState } from 'react';
import {
    Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer,
    Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Boxes, ChevronRight, Layers, Loader2, TrendingUp } from 'lucide-react';
import { apiClient } from '../../../../api/apiClient';
import { formatCurrency } from '../../../../utils/formatters';

/**
 * Categorias e Subcategorias — o recorte que o dono usa para decidir compra.
 *
 * O produto está organizado em família → categoria → subcategoria desde o cadastro,
 * e o painel não mostrava nada disso. Aqui:
 *
 *  * receita, margem e participação por categoria (curva ABC);
 *  * Δ% contra o período anterior de mesmo tamanho;
 *  * drill-down: tocar numa categoria abre as subcategorias dela.
 *
 * Os números vêm de /dashboard/categorias, que agrega o ledger de venda_itens.
 */

interface Subcategoria {
    subcategoria: string;
    receita: number;
    quantidade: number;
    margem: number;
    margem_pct: number;
}

interface Categoria {
    categoria: string;
    familia: string;
    receita: number;
    custo: number;
    margem: number;
    margem_pct: number;
    quantidade: number;
    produtos: number;
    participacao: number;
    variacao_pct: number | null;
    classe_abc: 'A' | 'B' | 'C';
    subcategorias: Subcategoria[];
}

interface EstoqueCategoria {
    categoria: string;
    familia: string;
    itens: number;
    unidades: number;
    valor_custo: number;
    valor_venda: number;
    margem_potencial_pct: number;
    participacao_custo: number;
}

interface Resposta {
    periodo: { dias: number; inicio: string; fim: string };
    resumo: {
        receita: number;
        margem: number;
        margem_pct: number;
        categorias: number;
        receita_periodo_anterior: number;
        variacao_pct: number | null;
    };
    categorias: Categoria[];
    estoque: {
        resumo: { categorias: number; itens: number; valor_custo: number; valor_venda: number };
        categorias: EstoqueCategoria[];
    };
}

const CORES = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626'];
const CORES_ABC: Record<string, string> = { A: '#059669', B: '#d97706', C: '#94a3b8' };
// Abaixo disso a loja ainda está em implantação: o retrato do estoque diz mais que o de vendas.
const LIMIAR_IMPLANTACAO = 500;

const Cartao: React.FC<{ rotulo: string; valor: string; nota?: React.ReactNode; cor?: string }> = ({ rotulo, valor, nota, cor }) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-[11px] font-black uppercase tracking-wide text-gray-400">{rotulo}</p>
        <p className={`mt-1 text-2xl font-black tabular-nums ${cor || 'text-slate-900 dark:text-white'}`}>{valor}</p>
        {nota && <div className="mt-1 text-[11px] text-gray-400">{nota}</div>}
    </div>
);

const EstoqueTabela: React.FC<{ estoque: Resposta['estoque'] }> = ({ estoque }) => (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
            <Boxes className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black text-gray-900 dark:text-white">Capital em estoque por categoria</h3>
            <span className="ml-auto text-[11px] text-gray-500">
                {estoque.resumo.itens} itens · {formatCurrency(estoque.resumo.valor_custo)} a custo
            </span>
        </div>
        <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                    <th className="px-3 py-2 text-left">Categoria</th>
                    <th className="px-3 py-2 text-right">Itens</th>
                    <th className="px-3 py-2 text-right">Un.</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                    <th className="px-3 py-2 text-right">Venda</th>
                    <th className="px-3 py-2 text-right">Margem</th>
                    <th className="px-3 py-2 text-right">% capital</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {estoque.categorias.map(item => (
                    <tr key={item.categoria} className="bg-white dark:bg-gray-900">
                        <td className="px-3 py-2">
                            <span className="block truncate font-bold text-gray-900 dark:text-white">{item.categoria}</span>
                            <span className="block text-[11px] text-gray-400">{item.familia}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{item.itens}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{item.unidades}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(item.valor_custo)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{formatCurrency(item.valor_venda)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{item.margem_potencial_pct}%</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{item.participacao_custo}%</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const Variacao: React.FC<{ valor: number | null }> = ({ valor }) => {
    if (valor === null || Number.isNaN(valor)) {
        return <span className="text-xs font-bold text-gray-400">sem base anterior</span>;
    }
    const subiu = valor >= 0;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-black ${subiu ? 'text-emerald-600' : 'text-red-600'}`}>
            {subiu ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(valor).toFixed(1)}%
        </span>
    );
};

const CategoriasTab: React.FC<{ dias: number }> = ({ dias }) => {
    const [dados, setDados] = useState<Resposta | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [aberta, setAberta] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        setCarregando(true);
        setErro(null);
        apiClient.get('/dashboard/categorias', { params: { days: dias } })
            .then(resposta => {
                if (vivo) setDados(resposta.data?.data || null);
            })
            .catch(() => {
                if (vivo) setErro('Não foi possível carregar a análise por categoria.');
            })
            .finally(() => {
                if (vivo) setCarregando(false);
            });
        return () => { vivo = false; };
    }, [dias]);

    const top10 = useMemo(() => (dados?.categorias || []).slice(0, 10), [dados]);
    const categorias = dados?.categorias || [];
    const estoque = dados?.estoque;

    if (carregando) {
        return (
            <div className="flex items-center gap-2 p-8 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculando categorias…
            </div>
        );
    }

    if (erro) {
        return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{erro}</div>;
    }

    if (!dados || (categorias.length === 0 && (estoque?.categorias.length || 0) === 0)) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
                <Layers className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm font-bold text-gray-600 dark:text-gray-300">Nada cadastrado nem vendido ainda.</p>
                <p className="mt-1 text-xs text-gray-500">
                    Cadastre produtos com categoria e subcategoria: este painel passa a mostrar o capital em estoque
                    e, com as primeiras vendas, o que vende e o que dá lucro por seção da loja.
                </p>
            </div>
        );
    }

    // Loja em implantação (poucas vendas): o estoque é o retrato que decide compra.
    const emImplantacao = estoque
        && estoque.categorias.length > 0
        && dados.resumo.receita < LIMIAR_IMPLANTACAO;

    if (emImplantacao) {
        return (
            <div className="space-y-4">
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                    <p className="text-sm font-black text-blue-900 dark:text-blue-200">Loja em implantação — retrato do estoque</p>
                    <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
                        {categorias.length === 0
                            ? 'Ainda não há venda finalizada no período.'
                            : `Só ${categorias.length} categoria(s) com venda e ${formatCurrency(dados.resumo.receita)} no período.`}
                        {' '}Enquanto o estoque está sendo cadastrado, o que decide compra é o capital parado por seção:
                        {' '}{estoque!.resumo.itens} itens em {estoque!.resumo.categorias} categorias, {formatCurrency(estoque!.resumo.valor_custo)} a custo.
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Cartao rotulo="Capital em estoque (custo)" valor={formatCurrency(estoque!.resumo.valor_custo)} nota="quantidade × preço de custo" />
                    <Cartao rotulo="Potencial de venda" valor={formatCurrency(estoque!.resumo.valor_venda)} cor="text-emerald-600" nota="quantidade × preço de venda" />
                    <Cartao rotulo="Itens cadastrados" valor={String(estoque!.resumo.itens)} nota={`${estoque!.resumo.categorias} categorias`} />
                </div>
                <EstoqueTabela estoque={estoque!} />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* KPIs do recorte */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-400">Faturamento no período</p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">{formatCurrency(dados.resumo.receita)}</p>
                    <div className="mt-1 flex items-center gap-2">
                        <Variacao valor={dados.resumo.variacao_pct} />
                        <span className="text-[11px] text-gray-400">vs. {dados.periodo.dias} dias anteriores</span>
                    </div>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-400">Margem bruta</p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-emerald-600">{formatCurrency(dados.resumo.margem)}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{dados.resumo.margem_pct}% do faturamento</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-400">Categorias com venda</p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">{dados.resumo.categorias}</p>
                    <p className="mt-1 text-[11px] text-gray-400">classificadas por curva ABC</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-[11px] font-black uppercase tracking-wide text-gray-400">Categoria líder</p>
                    <p className="mt-1 truncate text-lg font-black text-slate-900 dark:text-white">{categorias[0]?.categoria || '—'}</p>
                    <p className="mt-1 text-[11px] text-gray-400">{categorias[0]?.participacao ?? 0}% do faturamento</p>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
                {/* Participação */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:col-span-2 dark:border-gray-700 dark:bg-gray-800">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-gray-900 dark:text-white">
                        <TrendingUp className="h-4 w-4 text-blue-600" /> Quem puxa o faturamento
                    </h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={top10} dataKey="receita" nameKey="categoria" innerRadius={45} outerRadius={80} paddingAngle={2}>
                                    {top10.map((c, i) => <Cell key={c.categoria} fill={CORES[i % CORES.length]} />)}
                                </Pie>
                                <Tooltip formatter={(v: number, n: string) => [formatCurrency(v), n]} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Receita por categoria */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:col-span-3 dark:border-gray-700 dark:bg-gray-800">
                    <h3 className="mb-2 text-sm font-black text-gray-900 dark:text-white">Faturamento por categoria</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 16 }}>
                                <XAxis type="number" tickFormatter={(v: number) => `R$${Math.round(v / 100) / 10}k`} fontSize={10} />
                                <YAxis type="category" dataKey="categoria" width={110} fontSize={10} tickLine={false} />
                                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                                <Bar dataKey="receita" radius={[0, 6, 6, 0]}>
                                    {top10.map(c => <Cell key={c.categoria} fill={CORES_ABC[c.classe_abc]} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">
                        Verde = curva A (até 80% do faturamento) · âmbar = B (até 95%) · cinza = C
                    </p>
                </div>
            </div>

            {/* Tabela com drill-down */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <tr>
                            <th className="px-3 py-2 text-left">Categoria</th>
                            <th className="px-3 py-2 text-right">Faturamento</th>
                            <th className="px-3 py-2 text-right">Part.</th>
                            <th className="px-3 py-2 text-right">Margem</th>
                            <th className="px-3 py-2 text-right">%</th>
                            <th className="px-3 py-2 text-right">Δ anterior</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {categorias.map(categoria => {
                            const expandida = aberta === categoria.categoria;
                            return (
                                <>
                                    <tr
                                        key={categoria.categoria}
                                        onClick={() => setAberta(expandida ? null : categoria.categoria)}
                                        className="cursor-pointer bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-black text-white"
                                                    style={{ background: CORES_ABC[categoria.classe_abc] }}
                                                    title={`Curva ${categoria.classe_abc}`}
                                                >
                                                    {categoria.classe_abc}
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate font-bold text-gray-900 dark:text-white">{categoria.categoria}</span>
                                                    <span className="block text-[11px] text-gray-400">
                                                        {categoria.produtos} produto(s) · {categoria.familia}
                                                    </span>
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(categoria.receita)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{categoria.participacao}%</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{formatCurrency(categoria.margem)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{categoria.margem_pct}%</td>
                                        <td className="px-3 py-2 text-right"><Variacao valor={categoria.variacao_pct} /></td>
                                        <td className="px-3 py-2 text-right">
                                            <ChevronRight className={`ml-auto h-4 w-4 text-gray-400 transition-transform ${aberta === categoria.categoria ? 'rotate-90' : ''}`} />
                                        </td>
                                    </tr>
                                    {expandida && categoria.subcategorias.map(sub => (
                                        <tr key={`${categoria.categoria}-${sub.subcategoria}`} className="bg-gray-50/70 dark:bg-gray-800/40">
                                            <td className="pl-10 pr-3 py-2 text-gray-700 dark:text-gray-300">{sub.subcategoria}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(sub.receita)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                                                {categoria.receita ? ((sub.receita / categoria.receita) * 100).toFixed(1) : '0'}%
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{formatCurrency(sub.margem)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-gray-500">{sub.margem_pct}%</td>
                                            <td />
                                            <td />
                                        </tr>
                                    ))}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {estoque && estoque.categorias.length > 0 && <EstoqueTabela estoque={estoque} />}
        </div>
    );
};

export default CategoriasTab;
