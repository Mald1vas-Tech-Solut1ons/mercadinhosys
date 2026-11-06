import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis,
} from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, Flame, PackageX, ShoppingBasket, TrendingDown } from 'lucide-react';
import type { FiltrosBI, ProdutoBI, RespostaBI } from './biTypes';
import type { LimiaresBI } from './biConfig';
import type { Agregado, FaixaDef, Quadrante } from './biCalc';
import {
  QUADRANTES, capitalVsReceita, curvaPareto, estaParado, faixasPadrao, fmtBRL, fmtBRLCurto, fmtNum,
  fmtPct, giro, medianaGiro, montarFaixas, quadrante,
} from './biCalc';

// ------------------------------------------------------------------ base
function useTemaEscuro() {
  const [escuro, setEscuro] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setEscuro(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return escuro;
}

function useEixo() {
  const escuro = useTemaEscuro();
  return {
    tick: { fill: escuro ? '#94a3b8' : '#64748b', fontSize: 10 },
    grade: escuro ? '#1e293b' : '#eef2f7',
    tooltip: {
      contentStyle: { background: escuro ? '#0f172a' : '#ffffff', border: `1px solid ${escuro ? '#334155' : '#e2e8f0'}`, borderRadius: 10, fontSize: 12 },
      labelStyle: { color: escuro ? '#e2e8f0' : '#0f172a', fontWeight: 700 },
      itemStyle: { color: escuro ? '#cbd5e1' : '#334155' },
    },
  };
}

export const Bloco: React.FC<{ titulo: string; subtitulo?: React.ReactNode; icone?: React.ReactNode; acoes?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ titulo, subtitulo, icone, acoes, className = '', children }) => (
  <section className={`min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className}`}>
    <header className="mb-3 flex flex-wrap items-start gap-2">
      {icone}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-black text-gray-900 dark:text-white">{titulo}</h3>
        {subtitulo && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">{subtitulo}</p>}
      </div>
      {acoes}
    </header>
    {children}
  </section>
);

const CORES = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488', '#ca8a04', '#9333ea'];

const Segmentado: React.FC<{ opcoes: { valor: string; rotulo: string }[]; valor: string; onChange: (v: string) => void }> = ({ opcoes, valor, onChange }) => (
  <div className="inline-flex flex-wrap rounded-lg bg-gray-100 p-0.5 dark:bg-slate-800">
    {opcoes.map(o => (
      <button key={o.valor} type="button" onClick={() => onChange(o.valor)}
        className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${valor === o.valor ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
        {o.rotulo}
      </button>
    ))}
  </div>
);

// ------------------------------------------------------------------ KPIs
const Kpi: React.FC<{ rotulo: string; valor: string; nota?: React.ReactNode; tom?: 'bom' | 'ruim' | 'alerta'; dica: string }> = ({ rotulo, valor, nota, tom, dica }) => (
  <div title={dica} className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
    <p className="truncate text-[10px] font-black uppercase tracking-wide text-gray-400">{rotulo}</p>
    <p className={`mt-0.5 whitespace-nowrap text-lg font-black tabular-nums ${tom === 'ruim' ? 'text-red-600' : tom === 'alerta' ? 'text-amber-600' : tom === 'bom' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>{valor}</p>
    {nota && <div className="truncate text-[10px] text-gray-500 dark:text-slate-400">{nota}</div>}
  </div>
);

export const BlocoKpis: React.FC<{ total: Agregado; produtos: ProdutoBI[]; limiares: LimiaresBI }> = ({ total, produtos, limiares }) => {
  const parados = produtos.filter(p => estaParado(p, limiares));
  const capitalParado = parados.reduce((s, p) => s + p.capital_custo, 0);
  const comVenda = produtos.filter(p => p.receita > 0).length;
  const perdaRuptura = produtos.filter(p => p.ruptura && p.vmd > 0).reduce((s, p) => s + p.vmd * p.preco_venda, 0);
  const variacao = total.variacao_pct;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 min-[1800px]:grid-cols-8">
      <Kpi rotulo="Faturamento" valor={fmtBRLCurto(total.receita)} dica="Soma dos itens vendidos no período, vendas finalizadas"
        nota={variacao === null ? 'sem base anterior' : <span className={variacao >= 0 ? 'text-emerald-600' : 'text-red-600'}>{variacao >= 0 ? <ArrowUpRight className="inline h-3 w-3" /> : <ArrowDownRight className="inline h-3 w-3" />}{fmtPct(Math.abs(variacao))} vs anterior</span>} />
      <Kpi rotulo="Margem bruta" valor={fmtBRLCurto(total.margem)} tom={total.margem_pct !== null && total.margem_pct < limiares.margem_minima ? 'ruim' : 'bom'}
        dica="Faturamento − custo do item no momento da venda" nota={`${fmtPct(total.margem_pct)} do faturamento`} />
      <Kpi rotulo="Capital em estoque" valor={fmtBRLCurto(total.capital_custo)} dica="Estoque × preço de custo"
        nota={`${fmtBRLCurto(total.capital_venda)} a preço de venda`} />
      <Kpi rotulo="GMROI" valor={total.gmroi === null ? '—' : fmtNum(total.gmroi, 2)} dica="Margem do período ÷ capital a custo: quanto cada R$ 1 parado devolveu"
        nota="margem ÷ capital" tom={total.gmroi !== null && total.gmroi < 0.1 ? 'alerta' : undefined} />
      <Kpi rotulo="Cobertura" valor={total.cobertura_dias === null ? '—' : `${fmtNum(total.cobertura_dias)} dias`} dica="Estoque total ÷ venda média diária"
        nota={`alvo ${limiares.cobertura_alvo} dias`} tom={total.cobertura_dias !== null && total.cobertura_dias > limiares.cobertura_alvo * 3 ? 'alerta' : undefined} />
      <Kpi rotulo="Capital parado" valor={fmtBRLCurto(capitalParado)} dica={`Produtos com saldo e sem venda há ${limiares.dias_parado}+ dias (ou nunca vendidos)`}
        nota={`${parados.length} produtos · ${fmtPct(total.capital_custo ? (capitalParado / total.capital_custo) * 100 : null)}`} tom={capitalParado > 0 ? 'alerta' : undefined} />
      <Kpi rotulo="Rupturas" valor={fmtNum(total.rupturas)} dica="Produtos com estoque zerado ou negativo"
        nota={perdaRuptura > 0 ? `≈ ${fmtBRLCurto(perdaRuptura)}/dia sem vender` : 'sem perda estimada'} tom={total.rupturas > 0 ? 'ruim' : 'bom'} />
      <Kpi rotulo="Mix vendido" valor={`${fmtNum(comVenda)} / ${fmtNum(produtos.length)}`} dica="Produtos com pelo menos uma venda no período sobre o total do recorte"
        nota={fmtPct(produtos.length ? (comVenda / produtos.length) * 100 : null)} />
    </div>
  );
};

// ------------------------------------------------------------------ onde agir
export const BlocoAcoes: React.FC<{ produtos: ProdutoBI[]; limiares: LimiaresBI; onProduto: (p: ProdutoBI) => void; onFiltro: (f: Partial<FiltrosBI>) => void }> = ({ produtos, limiares, onProduto, onFiltro }) => {
  const listas = useMemo(() => {
    const ruptura = produtos.filter(p => p.ruptura && !p.servico && (p.abc === 'A' || p.abc === 'B' || p.vmd > 0))
      .map(p => ({ p, valor: p.vmd * p.preco_venda, texto: `≈ ${fmtBRL(p.vmd * p.preco_venda)}/dia` }))
      .sort((a, b) => b.valor - a.valor);
    const parado = produtos.filter(p => estaParado(p, limiares))
      .map(p => ({ p, valor: p.capital_custo, texto: `${fmtBRL(p.capital_custo)} · ${p.nunca_vendeu ? 'nunca vendeu' : `${p.dias_sem_venda} d`}` }))
      .sort((a, b) => b.valor - a.valor);
    const validade = produtos.filter(p => p.estoque > 0 && p.validade_dias !== null && p.validade_dias <= limiares.validade_critica)
      .map(p => ({ p, valor: p.capital_custo, texto: `${p.validade_dias! < 0 ? `venceu há ${-p.validade_dias!} d` : `vence em ${p.validade_dias} d`} · ${fmtBRL(p.capital_custo)}` }))
      .sort((a, b) => (a.p.validade_dias ?? 0) - (b.p.validade_dias ?? 0));
    const margem = produtos.filter(p => p.receita > 0 && (p.margem_pct ?? 0) < limiares.margem_minima)
      .map(p => ({ p, valor: p.receita, texto: `${fmtPct(p.margem_pct)} em ${fmtBRL(p.receita)}` }))
      .sort((a, b) => b.valor - a.valor);
    return { ruptura, parado, validade, margem };
  }, [produtos, limiares]);

  const cartoes = [
    { id: 'ruptura', titulo: 'Ruptura que custa venda', icone: <PackageX className="h-4 w-4 text-red-600" />, itens: listas.ruptura, vazio: 'Nenhum produto que vende está zerado.', filtro: { situacao: 'ruptura' as const } },
    { id: 'parado', titulo: `Capital parado (${limiares.dias_parado}+ dias)`, icone: <Clock className="h-4 w-4 text-amber-600" />, itens: listas.parado, vazio: 'Nada parado acima do limite.', filtro: { situacao: 'parado' as const } },
    { id: 'validade', titulo: `Validade em ${limiares.validade_critica} dias`, icone: <Flame className="h-4 w-4 text-orange-600" />, itens: listas.validade, vazio: 'Nenhum lote crítico cadastrado.', filtro: { situacao: 'vencendo' as const } },
    { id: 'margem', titulo: `Margem abaixo de ${limiares.margem_minima}%`, icone: <TrendingDown className="h-4 w-4 text-rose-600" />, itens: listas.margem, vazio: 'Todos os vendidos estão acima do mínimo.', filtro: { faixa: { metrica: 'margem_pct', nomeMetrica: 'Margem realizada', rotulo: `< ${limiares.margem_minima}%`, min: null, max: limiares.margem_minima } } },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cartoes.map(c => (
        <Bloco key={c.id} titulo={c.titulo} icone={c.icone} subtitulo={`${c.itens.length} produto(s)`}
          acoes={c.itens.length > 5 ? <button type="button" onClick={() => onFiltro(c.filtro)} className="text-[11px] font-bold text-blue-600 hover:underline dark:text-blue-400">Ver todos</button> : undefined}>
          {c.itens.length === 0 ? <p className="text-xs text-gray-400">{c.vazio}</p> : (
            <ul className="space-y-1">
              {c.itens.slice(0, 5).map(({ p, texto }) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onProduto(p)} className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-gray-50 dark:hover:bg-slate-800">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800 dark:text-slate-200" title={p.nome}>{p.nome}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-slate-400">{texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ mapa do capital
interface CelulaTree { name: string; size: number; receita: number; cor: string; chave: string; tipo: 'categoria' | 'subcategoria' }

const ConteudoTreemap = (props: any) => {
  const { x, y, width, height, name, cor, value, depth } = props;
  if (depth !== 1 && depth !== 2) return null;
  const mostra = width > 60 && height > 28;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={cor} fillOpacity={depth === 1 ? 0.92 : 0.75} stroke="#fff" strokeWidth={depth === 1 ? 2 : 1} rx={3} />
      {mostra && (
        <>
          <text x={x + 6} y={y + 15} fill="#fff" fontSize={11} fontWeight={700}>{String(name).length > width / 7 ? `${String(name).slice(0, Math.max(3, Math.floor(width / 7) - 1))}…` : name}</text>
          {height > 40 && <text x={x + 6} y={y + 29} fill="#fff" fillOpacity={0.85} fontSize={10}>{fmtBRLCurto(value)}</text>}
        </>
      )}
    </g>
  );
};

export const BlocoTreemap: React.FC<{ produtos: ProdutoBI[]; onFiltro: (f: Partial<FiltrosBI>) => void }> = ({ produtos, onFiltro }) => {
  const [medida, setMedida] = useState<'capital' | 'receita'>('capital');
  const eixo = useEixo();
  const dados = useMemo(() => {
    const cats = new Map<string, { nome: string; filhos: Map<string, CelulaTree> }>();
    for (const p of produtos) {
      const v = medida === 'capital' ? p.capital_custo : p.receita;
      if (v <= 0) continue;
      if (!cats.has(p.categoria_key)) cats.set(p.categoria_key, { nome: p.categoria, filhos: new Map() });
      const c = cats.get(p.categoria_key)!;
      const s = c.filhos.get(p.subcategoria_key) || { name: p.subcategoria, size: 0, receita: 0, cor: '', chave: p.subcategoria_key, tipo: 'subcategoria' as const };
      s.size += v;
      s.receita += p.receita;
      c.filhos.set(p.subcategoria_key, s);
    }
    return [...cats.entries()]
      .map(([k, c], i) => ({ name: c.nome, chave: k, cor: CORES[i % CORES.length], children: [...c.filhos.values()].map(f => ({ ...f, cor: CORES[i % CORES.length] })) }))
      .sort((a, b) => b.children.reduce((s, f) => s + f.size, 0) - a.children.reduce((s, f) => s + f.size, 0))
      .map((c, i) => ({ ...c, cor: CORES[i % CORES.length], children: c.children.map(f => ({ ...f, cor: CORES[i % CORES.length] })) }));
  }, [produtos, medida]);

  return (
    <Bloco titulo="Mapa do capital" subtitulo="Área = valor. Clique numa subcategoria para filtrar o painel inteiro."
      acoes={<Segmentado valor={medida} onChange={v => setMedida(v as 'capital' | 'receita')} opcoes={[{ valor: 'capital', rotulo: 'Capital a custo' }, { valor: 'receita', rotulo: 'Faturamento' }]} />}>
      {dados.length === 0 ? <p className="py-10 text-center text-xs text-gray-400">Sem valor para mostrar no recorte.</p> : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap data={dados} dataKey="size" aspectRatio={4 / 3} isAnimationActive={false} content={<ConteudoTreemap />}
              onClick={(n: any) => { if (n?.chave && n.depth === 2) onFiltro({ subcategorias: [n.chave] }); else if (n?.chave && n.depth === 1) onFiltro({ categorias: [n.chave] }); }}>
              <Tooltip {...eixo.tooltip} formatter={(v: number) => fmtBRL(v)} />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}
    </Bloco>
  );
};

// ------------------------------------------------------------------ capital × faturamento
export const BlocoCapitalReceita: React.FC<{ produtos: ProdutoBI[]; onFiltro: (f: Partial<FiltrosBI>) => void }> = ({ produtos, onFiltro }) => {
  const eixo = useEixo();
  const linhas = useMemo(() => capitalVsReceita(produtos).slice(0, 12), [produtos]);
  return (
    <Bloco titulo="Capital × Faturamento por categoria" subtitulo="Barra âmbar maior que a azul = a categoria prende mais dinheiro do que devolve em venda. Índice = % fat. ÷ % capital.">
      {linhas.length === 0 ? <p className="py-10 text-center text-xs text-gray-400">Sem dados.</p> : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={linhas} layout="vertical" margin={{ left: 4, right: 12 }} barGap={1}
                onClick={(e: any) => { const k = e?.activePayload?.[0]?.payload?.chave; if (k) onFiltro({ categorias: [k] }); }}>
                <CartesianGrid horizontal={false} stroke={eixo.grade} />
                <XAxis type="number" tick={eixo.tick} tickFormatter={(v: number) => `${v}%`} />
                <YAxis type="category" dataKey="nome" width={130} tick={eixo.tick} tickLine={false} interval={0} />
                <Tooltip {...eixo.tooltip} formatter={(v: number, n: string) => [fmtPct(v), n]} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="capital_pct" name="% do capital" fill="#f59e0b" radius={[0, 4, 4, 0]} cursor="pointer" />
                <Bar dataKey="receita_pct" name="% do faturamento" fill="#2563eb" radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {linhas.filter(l => l.eficiencia !== null).sort((a, b) => (a.eficiencia ?? 0) - (b.eficiencia ?? 0)).slice(0, 4).map(l => (
              <span key={l.chave} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                {l.nome}: índice {fmtNum(l.eficiencia!, 2)}
              </span>
            ))}
          </div>
        </>
      )}
    </Bloco>
  );
};

// ------------------------------------------------------------------ faixas
export const BlocoFaixas: React.FC<{ produtos: ProdutoBI[]; limiares: LimiaresBI; filtros: FiltrosBI; onFiltro: (f: Partial<FiltrosBI>) => void }> = ({ produtos, limiares, filtros, onFiltro }) => {
  const eixo = useEixo();
  const defs = useMemo(() => faixasPadrao(limiares), [limiares]);
  const [metrica, setMetrica] = useState(defs[0].id);
  const [medida, setMedida] = useState<'produtos' | 'capital' | 'receita'>('produtos');
  const def: FaixaDef = defs.find(d => d.id === metrica) || defs[0];
  const faixas = useMemo(() => montarFaixas(produtos, def), [produtos, def]);
  const selecionada = filtros.faixa?.metrica === def.id ? filtros.faixa.rotulo : null;

  return (
    <Bloco titulo="Análise por faixas" subtitulo="Clique numa barra: o painel inteiro e a tabela passam a mostrar só os produtos daquela faixa."
      acoes={<Segmentado valor={medida} onChange={v => setMedida(v as typeof medida)} opcoes={[{ valor: 'produtos', rotulo: 'Nº produtos' }, { valor: 'capital', rotulo: 'Capital' }, { valor: 'receita', rotulo: 'Faturamento' }]} />}>
      <div className="mb-3 flex flex-wrap gap-1">
        {defs.map(d => (
          <button key={d.id} type="button" onClick={() => setMetrica(d.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${metrica === d.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            {d.nome}
          </button>
        ))}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={faixas} margin={{ left: 0, right: 8 }}
            onClick={(e: any) => {
              const f = e?.activePayload?.[0]?.payload;
              if (!f) return;
              onFiltro({ faixa: selecionada === f.rotulo ? null : { metrica: def.id, nomeMetrica: def.nome, rotulo: f.rotulo, min: f.min, max: f.max, semValor: !!f.semValor } });
            }}>
            <CartesianGrid vertical={false} stroke={eixo.grade} />
            <XAxis dataKey="rotulo" tick={eixo.tick} interval={0} />
            <YAxis tick={eixo.tick} tickFormatter={(v: number) => (medida === 'produtos' ? fmtNum(v) : fmtBRLCurto(v))} width={70} />
            <Tooltip {...eixo.tooltip} cursor={{ fill: 'rgba(148,163,184,0.12)' }}
              formatter={(_v: number, _n: string, item: any) => {
                const f = item.payload;
                return [`${fmtNum(f.produtos)} produtos · capital ${fmtBRL(f.capital)} · faturamento ${fmtBRL(f.receita)}`, ''];
              }} />
            <Bar dataKey={medida} radius={[4, 4, 0, 0]} cursor="pointer">
              {faixas.map(f => (
                <Cell key={f.rotulo} fill={selecionada === f.rotulo ? '#1d4ed8' : f.semValor ? '#94a3b8' : '#60a5fa'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-gray-400"><tr><th className="py-1 text-left">Faixa</th><th className="text-right">Produtos</th><th className="text-right">Capital</th><th className="text-right">Faturamento</th></tr></thead>
          <tbody className="tabular-nums text-gray-700 dark:text-slate-300">
            {faixas.map(f => (
              <tr key={f.rotulo} className={selecionada === f.rotulo ? 'font-bold text-blue-700 dark:text-blue-300' : ''}>
                <td className="py-0.5">{f.rotulo}</td><td className="text-right">{fmtNum(f.produtos)}</td><td className="text-right">{fmtBRL(f.capital)}</td><td className="text-right">{fmtBRL(f.receita)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
};

// ------------------------------------------------------------------ matriz giro × margem
export const BlocoMatriz: React.FC<{ produtos: ProdutoBI[]; limiares: LimiaresBI; filtros: FiltrosBI; onFiltro: (f: Partial<FiltrosBI>) => void; onProduto: (p: ProdutoBI) => void }> = ({ produtos, limiares, filtros, onFiltro, onProduto }) => {
  const eixo = useEixo();
  const corte = useMemo(() => medianaGiro(produtos), [produtos]);
  const { pontos, contagem } = useMemo(() => {
    const cont: Record<string, { n: number; capital: number; receita: number }> = {};
    const pts: { x: number; y: number; z: number; q: Quadrante; p: ProdutoBI }[] = [];
    for (const p of produtos) {
      const q = quadrante(p, corte, limiares);
      if (q === 'sem_dado') continue;
      cont[q] = cont[q] || { n: 0, capital: 0, receita: 0 };
      cont[q].n += 1; cont[q].capital += p.capital_custo; cont[q].receita += p.receita;
      if (p.receita > 0) {
        const g = giro(p);
        pts.push({ x: Math.max(-50, Math.min(100, p.margem_pct ?? 0)), y: g === null ? corte * 4 || 1 : Math.min(g, corte * 6 || 10), z: Math.max(p.capital_custo, 1), q, p });
      }
    }
    return { pontos: pts.slice(0, 1500), contagem: cont };
  }, [produtos, corte, limiares]);

  return (
    <Bloco titulo="Matriz Giro × Margem" subtitulo={`Eixo X = margem realizada; eixo Y = giro (custo vendido ÷ capital). Cortes: margem ${limiares.margem_minima}% e giro mediano ${fmtNum(corte, 2)}. Bolha = capital.`}>
      <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
        <div className="h-80">
          {pontos.length === 0 ? <p className="py-20 text-center text-xs text-gray-400">Sem produtos vendidos no recorte.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid stroke={eixo.grade} />
                <XAxis type="number" dataKey="x" name="Margem" unit="%" tick={eixo.tick} domain={['auto', 'auto']} />
                <YAxis type="number" dataKey="y" name="Giro" tick={eixo.tick} width={40} />
                <ZAxis type="number" dataKey="z" range={[20, 400]} />
                <ReferenceLine x={limiares.margem_minima} stroke="#94a3b8" strokeDasharray="4 4" />
                <ReferenceLine y={corte} stroke="#94a3b8" strokeDasharray="4 4" />
                <Tooltip {...eixo.tooltip} cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }: any) => {
                    const d = payload?.[0]?.payload;
                    if (!d) return null;
                    return (
                      <div style={eixo.tooltip.contentStyle} className="px-3 py-2">
                        <p className="text-xs font-bold" style={eixo.tooltip.labelStyle}>{d.p.nome}</p>
                        <p className="text-[11px]" style={eixo.tooltip.itemStyle}>{QUADRANTES[d.q as keyof typeof QUADRANTES].nome} · margem {fmtPct(d.p.margem_pct)} · giro {fmtNum(giro(d.p) ?? 0, 2)}</p>
                        <p className="text-[11px]" style={eixo.tooltip.itemStyle}>Faturamento {fmtBRL(d.p.receita)} · capital {fmtBRL(d.p.capital_custo)}</p>
                      </div>
                    );
                  }} />
                <Scatter data={pontos} onClick={(d: any) => d?.p && onProduto(d.p)} cursor="pointer">
                  {pontos.map(pt => <Cell key={pt.p.id} fill={QUADRANTES[pt.q as keyof typeof QUADRANTES].cor} fillOpacity={0.65} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {(Object.keys(QUADRANTES) as (keyof typeof QUADRANTES)[]).map(q => {
            const info = QUADRANTES[q];
            const c = contagem[q] || { n: 0, capital: 0, receita: 0 };
            const ativo = filtros.quadrante === q;
            return (
              <button key={q} type="button" onClick={() => onFiltro({ quadrante: ativo ? null : q })}
                className={`rounded-xl border p-2.5 text-left transition-colors ${ativo ? 'border-blue-600 ring-2 ring-blue-600/30' : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                <span className="flex items-center gap-1.5 text-xs font-black text-gray-900 dark:text-white"><span className="h-2.5 w-2.5 rounded-full" style={{ background: info.cor }} />{info.nome}</span>
                <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-slate-400">{info.acao}</span>
                <span className="mt-1 block text-[11px] font-bold tabular-nums text-gray-700 dark:text-slate-200">{c.n} prod. · cap. {fmtBRLCurto(c.capital)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Bloco>
  );
};

// ------------------------------------------------------------------ pareto
export const BlocoPareto: React.FC<{ produtos: ProdutoBI[] }> = ({ produtos }) => {
  const eixo = useEixo();
  const curva = useMemo(() => curvaPareto(produtos), [produtos]);
  const ponto80 = curva.find(c => c.pct_receita >= 80);
  const amostra = curva.length > 300 ? curva.filter((_, i) => i % Math.ceil(curva.length / 300) === 0 || i === curva.length - 1) : curva;
  return (
    <Bloco titulo="Curva ABC (Pareto)"
      subtitulo={ponto80 ? `${fmtNum(ponto80.posicao)} produtos (${fmtPct(ponto80.pct_produtos)} do mix vendido) fazem 80% do faturamento.` : 'Sem vendas no recorte.'}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={amostra} margin={{ left: 0, right: 12 }}>
            <CartesianGrid stroke={eixo.grade} />
            <XAxis dataKey="pct_produtos" type="number" domain={[0, 100]} tick={eixo.tick} tickFormatter={(v: number) => `${Math.round(v)}%`} />
            <YAxis domain={[0, 100]} tick={eixo.tick} tickFormatter={(v: number) => `${v}%`} width={40} />
            <ReferenceLine y={80} stroke="#059669" strokeDasharray="4 4" />
            <ReferenceLine y={95} stroke="#d97706" strokeDasharray="4 4" />
            <Tooltip {...eixo.tooltip} labelFormatter={(v: number) => `${fmtPct(v)} dos produtos`} formatter={(v: number) => [fmtPct(v), 'Faturamento acumulado']} />
            <Line type="monotone" dataKey="pct_receita" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Bloco>
  );
};

// ------------------------------------------------------------------ mapa de calor
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const BlocoHeatmap: React.FC<{ temporal: RespostaBI['temporal']; produtos: ProdutoBI[]; onFiltro: (f: Partial<FiltrosBI>) => void }> = ({ temporal, produtos, onFiltro }) => {
  const [eixo, setEixo] = useState<'hora' | 'dia'>('hora');
  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of produtos) m.set(p.categoria_key, p.categoria);
    return m;
  }, [produtos]);
  const { linhas, colunas, max } = useMemo(() => {
    const fonte = eixo === 'hora'
      ? temporal.hora.map(h => ({ k: h.categoria_key, c: h.hora, v: h.receita }))
      : temporal.dia_semana.map(d => ({ k: d.categoria_key, c: d.dia, v: d.receita }));
    const visiveis = fonte.filter(f => nomes.has(f.k));
    const porCat = new Map<string, Map<number, number>>();
    let mx = 0;
    for (const f of visiveis) {
      if (!porCat.has(f.k)) porCat.set(f.k, new Map());
      porCat.get(f.k)!.set(f.c, (porCat.get(f.k)!.get(f.c) || 0) + f.v);
      mx = Math.max(mx, porCat.get(f.k)!.get(f.c)!);
    }
    const cols = eixo === 'hora'
      ? [...new Set(visiveis.map(f => f.c))].sort((a, b) => a - b)
      : [0, 1, 2, 3, 4, 5, 6];
    const lin = [...porCat.entries()]
      .map(([k, m]) => ({ k, nome: nomes.get(k) || k, m, total: [...m.values()].reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 14);
    return { linhas: lin, colunas: cols, max: mx };
  }, [temporal, eixo, nomes]);

  return (
    <Bloco titulo="Mapa de calor do faturamento" subtitulo="Quando cada categoria vende (hora da loja). Clique na categoria para filtrar."
      acoes={<Segmentado valor={eixo} onChange={v => setEixo(v as 'hora' | 'dia')} opcoes={[{ valor: 'hora', rotulo: 'Por hora' }, { valor: 'dia', rotulo: 'Por dia da semana' }]} />}>
      {linhas.length === 0 ? <p className="py-10 text-center text-xs text-gray-400">Sem vendas no recorte.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5 text-[10px]">
            <thead>
              <tr>
                <th className="w-40" />
                {colunas.map(c => <th key={c} className="font-semibold text-gray-400">{eixo === 'hora' ? `${c}h` : DIAS[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.k}>
                  <td className="max-w-[160px] truncate pr-2 text-right">
                    <button type="button" onClick={() => onFiltro({ categorias: [l.k] })} className="truncate font-semibold text-gray-700 hover:text-blue-600 dark:text-slate-300" title={l.nome}>{l.nome}</button>
                  </td>
                  {colunas.map(c => {
                    const v = l.m.get(c) || 0;
                    const t = max ? v / max : 0;
                    return (
                      <td key={c} title={`${l.nome} · ${eixo === 'hora' ? `${c}h` : DIAS[c]}: ${fmtBRL(v)}`}
                        className="h-6 min-w-[26px] rounded-sm text-center tabular-nums"
                        style={{ background: v ? `rgba(37, 99, 235, ${0.08 + t * 0.85})` : 'rgba(148,163,184,0.08)', color: t > 0.55 ? '#fff' : undefined }}>
                        {t > 0.35 ? fmtBRLCurto(v).replace('R$ ', '') : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
};

// ------------------------------------------------------------------ cesta
export const BlocoCesta: React.FC<{ cesta: RespostaBI['cesta']; produtos: ProdutoBI[]; onProduto: (p: ProdutoBI) => void }> = ({ cesta, produtos, onProduto }) => {
  const porId = useMemo(() => new Map(produtos.map(p => [p.id, p])), [produtos]);
  const pares = cesta.pares.filter(p => porId.has(p.a) && porId.has(p.b)).slice(0, 15);
  return (
    <Bloco titulo="Cesta de compras" icone={<ShoppingBasket className="h-4 w-4 text-blue-600" />}
      subtitulo={`Pares que saem na mesma venda (${fmtNum(cesta.vendas)} vendas analisadas). Lift > 1 = compram juntos mais do que o acaso: exponha lado a lado ou monte combo.`}>
      {pares.length === 0 ? <p className="py-6 text-center text-xs text-gray-400">Ainda não há pares frequentes no recorte (mínimo de 2 vendas juntas).</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-gray-400">
              <tr><th className="py-1 text-left">Produto</th><th className="text-left">Leva junto</th><th className="text-right">Vezes</th><th className="text-right" title="De quem leva o 1º, quantos % levam o 2º">Confiança</th><th className="text-right">Lift</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {pares.map(par => {
                const a = porId.get(par.a)!; const b = porId.get(par.b)!;
                return (
                  <tr key={`${par.a}-${par.b}`}>
                    <td className="max-w-[180px] truncate py-1.5 pr-2"><button type="button" onClick={() => onProduto(a)} className="truncate font-semibold text-gray-800 hover:text-blue-600 dark:text-slate-200" title={a.nome}>{a.nome}</button></td>
                    <td className="max-w-[180px] truncate pr-2"><button type="button" onClick={() => onProduto(b)} className="truncate text-gray-700 hover:text-blue-600 dark:text-slate-300" title={b.nome}>{b.nome}</button></td>
                    <td className="text-right tabular-nums text-gray-600 dark:text-slate-300">{par.vezes}</td>
                    <td className="text-right tabular-nums text-gray-600 dark:text-slate-300">{fmtPct(par.confianca_pct)}</td>
                    <td className={`text-right font-bold tabular-nums ${par.lift >= 2 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-slate-200'}`}>{fmtNum(par.lift, 1)}×</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
};

export const AvisoAmostra: React.FC<{ texto: string }> = ({ texto }) => (
  <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {texto}
  </p>
);
