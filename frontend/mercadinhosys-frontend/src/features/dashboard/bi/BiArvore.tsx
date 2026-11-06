import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Download, ListTree, Minus, Plus } from 'lucide-react';
import type { ProdutoBI } from './biTypes';
import type { ColunaId, LimiaresBI } from './biConfig';
import { COLUNAS } from './biConfig';
import type { Agregado, No } from './biCalc';
import { agregar, estaParado, fmtBRL, fmtNum, fmtPct, montarArvore } from './biCalc';
import { dataLocalISO } from '../../../utils/dataLocal';

type Ordem = { coluna: ColunaId | 'nome'; dir: 'asc' | 'desc' };

const NUMERICAS: Partial<Record<ColunaId, (a: Agregado, total: Agregado) => number | null>> = {
  produtos: a => a.produtos,
  receita: a => a.receita,
  participacao: (a, t) => (t.receita ? (a.receita / t.receita) * 100 : null),
  margem: a => a.margem,
  margem_pct: a => a.margem_pct,
  qtd: a => a.qtd,
  variacao_pct: a => a.variacao_pct,
  estoque: a => a.estoque,
  capital_custo: a => a.capital_custo,
  capital_venda: a => a.capital_venda,
  participacao_capital: (a, t) => (t.capital_custo ? (a.capital_custo / t.capital_custo) * 100 : null),
  margem_potencial_pct: a => a.margem_potencial_pct,
  cobertura_dias: a => a.cobertura_dias,
  dias_sem_venda: a => a.dias_sem_venda,
  gmroi: a => a.gmroi,
  vmd: a => a.vmd,
};

function valorOrdenacao(no: No, col: ColunaId | 'nome', total: Agregado): number | string {
  if (col === 'nome') return no.nome.toLowerCase();
  const p = no.produto;
  if (col === 'abc') return p?.abc || 'Z';
  if (col === 'xyz') return p?.xyz || 'Z';
  if (col === 'validade_dias') return p?.validade_dias ?? Number.POSITIVE_INFINITY;
  if (col === 'fornecedor') return p?.fornecedor || '';
  if (col === 'marca') return p?.marca || '';
  const f = NUMERICAS[col];
  const v = f ? f(no.agregado, total) : null;
  return v === null ? Number.NEGATIVE_INFINITY : v;
}

const Badge: React.FC<{ texto: string; cor: string; titulo?: string }> = ({ texto, cor, titulo }) => (
  <span title={titulo} className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-black ${cor}`}>{texto}</span>
);
const COR_ABC: Record<string, string> = { A: 'bg-emerald-600 text-white', B: 'bg-amber-500 text-white', C: 'bg-slate-400 text-white' };
const COR_XYZ: Record<string, string> = { X: 'bg-sky-600 text-white', Y: 'bg-violet-500 text-white', Z: 'bg-rose-500 text-white' };

function Celula({ col, no, total, maxReceita, maxCapital, limiares }: {
  col: ColunaId; no: No; total: Agregado; maxReceita: number; maxCapital: number; limiares: LimiaresBI;
}) {
  const a = no.agregado;
  const p = no.produto;
  const base = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
  const barra = (valor: number, max: number, cor: string) => (
    <div className="relative">
      <div className={`absolute inset-y-0 right-0 rounded-sm ${cor}`} style={{ width: `${max ? Math.min(100, (valor / max) * 100) : 0}%` }} />
      <span className="relative">{fmtBRL(valor)}</span>
    </div>
  );
  switch (col) {
    case 'produtos': return <td className={`${base} text-gray-500`}>{fmtNum(a.produtos)}</td>;
    case 'receita': return <td className={`${base} font-semibold text-gray-900 dark:text-white`}>{barra(a.receita, maxReceita, 'bg-blue-500/15')}</td>;
    case 'participacao': return <td className={`${base} text-gray-500`}>{fmtPct(NUMERICAS.participacao!(a, total))}</td>;
    case 'margem': return <td className={`${base} ${a.margem < 0 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmtBRL(a.margem)}</td>;
    case 'margem_pct': {
      const baixa = a.margem_pct !== null && a.margem_pct < limiares.margem_minima;
      return <td className={`${base} ${a.margem_pct === null ? 'text-gray-400' : baixa ? 'font-bold text-red-600' : 'text-gray-700 dark:text-slate-200'}`}>{fmtPct(a.margem_pct)}</td>;
    }
    case 'qtd': return <td className={`${base} text-gray-600 dark:text-slate-300`}>{fmtNum(a.qtd, a.qtd % 1 ? 2 : 0)}</td>;
    case 'variacao_pct':
      return (
        <td className={`${base} ${a.variacao_pct === null ? 'text-gray-400' : a.variacao_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
          {a.variacao_pct === null ? '—' : <span className="inline-flex items-center gap-0.5">{a.variacao_pct >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{fmtPct(Math.abs(a.variacao_pct))}</span>}
        </td>
      );
    case 'estoque': return <td className={`${base} ${p?.ruptura ? 'font-bold text-red-600' : 'text-gray-600 dark:text-slate-300'}`}>{fmtNum(a.estoque, a.estoque % 1 ? 2 : 0)}</td>;
    case 'capital_custo': return <td className={`${base} font-semibold text-gray-900 dark:text-white`}>{barra(a.capital_custo, maxCapital, 'bg-amber-500/15')}</td>;
    case 'capital_venda': return <td className={`${base} text-gray-600 dark:text-slate-300`}>{fmtBRL(a.capital_venda)}</td>;
    case 'participacao_capital': return <td className={`${base} text-gray-500`}>{fmtPct(NUMERICAS.participacao_capital!(a, total))}</td>;
    case 'margem_potencial_pct': return <td className={`${base} text-gray-600 dark:text-slate-300`}>{fmtPct(a.margem_potencial_pct)}</td>;
    case 'cobertura_dias': {
      const c = a.cobertura_dias;
      const cor = c === null ? 'text-gray-400' : c > limiares.cobertura_alvo * 3 ? 'font-bold text-amber-600' : c < 7 ? 'font-bold text-red-600' : 'text-gray-700 dark:text-slate-200';
      return <td className={`${base} ${cor}`}>{c === null ? (a.estoque > 0 ? '∞' : '—') : `${fmtNum(c)} d`}</td>;
    }
    case 'dias_sem_venda': {
      if (p?.nunca_vendeu) return <td className={`${base} font-bold text-amber-600`}>nunca</td>;
      const d = a.dias_sem_venda;
      return <td className={`${base} ${d !== null && d >= limiares.dias_parado ? 'font-bold text-amber-600' : 'text-gray-600 dark:text-slate-300'}`}>{d === null ? '—' : `${fmtNum(d)} d`}</td>;
    }
    case 'gmroi': return <td className={`${base} ${a.gmroi !== null && a.gmroi < 0.1 ? 'text-amber-600' : 'text-gray-700 dark:text-slate-200'}`}>{a.gmroi === null ? '—' : fmtNum(a.gmroi, 2)}</td>;
    case 'vmd': return <td className={`${base} text-gray-600 dark:text-slate-300`}>{fmtNum(a.vmd, 2)}</td>;
    case 'abc': return <td className={`${base}`}>{p ? (p.abc ? <Badge texto={p.abc} cor={COR_ABC[p.abc]} /> : <span className="text-gray-400">—</span>) : ''}</td>;
    case 'xyz': return <td className={`${base}`}>{p ? (p.xyz ? <Badge texto={p.xyz} cor={COR_XYZ[p.xyz]} titulo={`CV ${p.cv}`} /> : <span className="text-gray-400">—</span>) : ''}</td>;
    case 'validade_dias': {
      const v = p?.validade_dias;
      return <td className={`${base} ${v !== undefined && v !== null && v <= limiares.validade_critica ? 'font-bold text-red-600' : 'text-gray-600 dark:text-slate-300'}`}>{v === undefined || v === null ? '' : `${v} d`}</td>;
    }
    case 'fornecedor': return <td className="max-w-[160px] truncate px-3 py-2 text-left text-gray-600 dark:text-slate-300">{p?.fornecedor || ''}</td>;
    case 'marca': return <td className="max-w-[120px] truncate px-3 py-2 text-left text-gray-600 dark:text-slate-300">{p?.marca || ''}</td>;
    default: return <td />;
  }
}

const RECUO: Record<string, string> = { familia: 'pl-3', categoria: 'pl-7', subcategoria: 'pl-11', produto: 'pl-[3.75rem]' };
const ESTILO_LINHA: Record<string, string> = {
  familia: 'bg-slate-100 font-black text-gray-900 dark:bg-slate-800 dark:text-white',
  categoria: 'bg-white font-bold text-gray-900 dark:bg-slate-900 dark:text-white',
  subcategoria: 'bg-gray-50/60 font-semibold text-gray-800 dark:bg-slate-900/60 dark:text-slate-200',
  produto: 'bg-white text-gray-700 dark:bg-slate-950/40 dark:text-slate-300',
};
const POR_PAGINA = 40;

const BiArvore: React.FC<{
  produtos: ProdutoBI[];
  colunas: ColunaId[];
  limiares: LimiaresBI;
  compacta: boolean;
  onProduto: (p: ProdutoBI) => void;
}> = ({ produtos, colunas, limiares, compacta, onProduto }) => {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [ordem, setOrdem] = useState<Ordem>({ coluna: 'receita', dir: 'desc' });
  const [limites, setLimites] = useState<Record<string, number>>({});
  const [exportando, setExportando] = useState(false);

  const total = useMemo(() => agregar(produtos, limiares), [produtos, limiares]);
  const arvore = useMemo(() => montarArvore(produtos, limiares), [produtos, limiares]);

  const ordenar = (nos: No[]) => [...nos].sort((x, y) => {
    const a = valorOrdenacao(x, ordem.coluna, total);
    const b = valorOrdenacao(y, ordem.coluna, total);
    const r = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b;
    return ordem.dir === 'asc' ? r : -r;
  });

  const maximos = useMemo(() => {
    let mr = 0; let mc = 0;
    for (const f of arvore) { mr = Math.max(mr, f.agregado.receita); mc = Math.max(mc, f.agregado.capital_custo); }
    return { receita: mr, capital: mc };
  }, [arvore]);

  const alternar = (chave: string) => setAbertos(prev => {
    const n = new Set(prev);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });

  const expandirAte = (nivel: 'familia' | 'categoria' | 'subcategoria' | null) => {
    if (!nivel) { setAbertos(new Set()); return; }
    const n = new Set<string>();
    for (const f of arvore) {
      n.add(f.chave);
      if (nivel === 'familia') continue;
      for (const c of f.filhos) {
        n.add(c.chave);
        if (nivel === 'subcategoria') for (const s of c.filhos) n.add(s.chave);
      }
    }
    setAbertos(n);
  };

  const cabecalho = (id: ColunaId | 'nome', texto: string, dica?: string, esquerda = false) => (
    <th key={id} title={dica} className={`sticky top-0 z-10 bg-gray-50 px-3 py-2 dark:bg-slate-800 ${esquerda ? 'text-left' : 'text-right'}`}>
      <button
        type="button"
        onClick={() => setOrdem(o => ({ coluna: id, dir: o.coluna === id && o.dir === 'desc' ? 'asc' : 'desc' }))}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-900 dark:hover:text-white ${ordem.coluna === id ? 'text-blue-600 dark:text-blue-400' : ''}`}
      >
        {texto}
        {ordem.coluna === id && (ordem.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  const exportar = async () => {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const linhas = produtos.map(p => ({
        Família: p.familia, Categoria: p.categoria, Subcategoria: p.subcategoria, Produto: p.nome, EAN: p.ean || '',
        Marca: p.marca || '', Fornecedor: p.fornecedor || '', Faturamento: p.receita, Custo: p.custo, 'Margem R$': p.margem,
        'Margem %': p.margem_pct ?? '', Quantidade: p.qtd, 'Δ % ant.': p.variacao_pct ?? '', Estoque: p.estoque,
        'Capital custo': p.capital_custo, 'Capital venda': p.capital_venda, 'Margem potencial %': p.margem_potencial_pct ?? '',
        'Cobertura (d)': p.cobertura_dias ?? '', 'Dias sem venda': p.nunca_vendeu ? 'nunca' : (p.dias_sem_venda ?? ''),
        GMROI: p.gmroi ?? '', VMD: p.vmd, ABC: p.abc || '', XYZ: p.xyz || '', 'Validade (d)': p.validade_dias ?? '',
        Parado: estaParado(p, limiares) ? 'sim' : '', Ruptura: p.ruptura ? 'sim' : '',
      }));
      const planilha = XLSX.utils.json_to_sheet(linhas);
      const livro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(livro, planilha, 'BI produtos');
      XLSX.writeFile(livro, `bi-produtos-${dataLocalISO()}.xlsx`);
    } finally {
      setExportando(false);
    }
  };

  const defs = colunas.map(id => COLUNAS.find(c => c.id === id)!).filter(Boolean);
  const pad = compacta ? '[&_td]:py-1' : '';

  const renderNo = (no: No): React.ReactNode => {
    const aberto = abertos.has(no.chave);
    const temFilhos = no.filhos.length > 0;
    const p = no.produto;
    const filhosOrdenados = aberto ? ordenar(no.filhos) : [];
    const limite = limites[no.chave] || POR_PAGINA;
    const visiveis = no.nivel === 'subcategoria' ? filhosOrdenados.slice(0, limite) : filhosOrdenados;
    return (
      <Fragment key={no.chave}>
        <tr
          onClick={() => (p ? onProduto(p) : temFilhos && alternar(no.chave))}
          className={`cursor-pointer border-b border-gray-100 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:bg-slate-800 ${ESTILO_LINHA[no.nivel]}`}
        >
          <td className={`sticky left-0 z-[5] max-w-[340px] py-2 pr-3 ${RECUO[no.nivel]} ${ESTILO_LINHA[no.nivel]}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              {temFilhos ? <ChevronRight className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${aberto ? 'rotate-90' : ''}`} /> : <span className="w-4 shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate" title={no.nome}>{no.nome}</span>
                {p && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-normal text-gray-400">
                    {p.ruptura && <Badge texto="RUPTURA" cor="bg-red-600 text-white" />}
                    {!p.ruptura && p.abaixo_minimo && <Badge texto="ABAIXO DO MÍN." cor="bg-orange-500 text-white" />}
                    {estaParado(p, limiares) && <Badge texto="PARADO" cor="bg-amber-500 text-white" />}
                    {p.custo_estimado && <Badge texto="CUSTO EST." cor="bg-slate-300 text-slate-700" titulo="Custo estimado, não informado" />}
                    {no.detalhe && <span className="truncate">{no.detalhe}</span>}
                  </span>
                )}
                {!p && <span className="block text-[10px] font-normal text-gray-400">{no.agregado.produtos} produto(s)</span>}
              </span>
            </div>
          </td>
          {defs.map(c => <Celula key={c.id} col={c.id} no={no} total={total} maxReceita={no.nivel === 'familia' ? maximos.receita : total.receita} maxCapital={no.nivel === 'familia' ? maximos.capital : total.capital_custo} limiares={limiares} />)}
        </tr>
        {visiveis.map(renderNo)}
        {no.nivel === 'subcategoria' && aberto && filhosOrdenados.length > limite && (
          <tr className="border-b border-gray-100 dark:border-slate-800">
            <td colSpan={defs.length + 1} className="py-2 pl-[3.75rem]">
              <button type="button" onClick={() => setLimites(l => ({ ...l, [no.chave]: limite + POR_PAGINA }))} className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400">
                Mostrar mais {Math.min(POR_PAGINA, filhosOrdenados.length - limite)} de {filhosOrdenados.length - limite} restantes
              </button>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
        <ListTree className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-black text-gray-900 dark:text-white">Tabela-mestra</h3>
        <span className="text-xs text-gray-500">Família › Categoria › Subcategoria › Produto · {fmtNum(produtos.length)} produtos</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">Abrir até:</span>
          {([['familia', 'Família'], ['categoria', 'Categoria'], ['subcategoria', 'Subcategoria']] as const).map(([n, r]) => (
            <button key={n} type="button" onClick={() => expandirAte(n)} className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              <Plus className="mr-0.5 inline h-3 w-3" />{r}
            </button>
          ))}
          <button type="button" onClick={() => expandirAte(null)} className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Minus className="mr-0.5 inline h-3 w-3" />Recolher
          </button>
          <button type="button" onClick={exportar} disabled={exportando || !produtos.length} className="ml-1 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Download className="h-3 w-3" /> {exportando ? 'Gerando…' : 'Excel'}
          </button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className={`w-full text-xs ${pad}`}>
          <thead className="text-[10px] font-bold text-gray-500 dark:text-slate-400">
            <tr>
              {cabecalho('nome', 'Hierarquia', undefined, true)}
              {defs.map(c => cabecalho(c.id, c.curto, c.dica, c.id === 'fornecedor' || c.id === 'marca'))}
            </tr>
          </thead>
          <tbody>
            {ordenar(arvore).map(renderNo)}
            {produtos.length > 0 && (
              <tr className="sticky bottom-0 bg-slate-900 font-black text-white dark:bg-slate-200 dark:text-slate-900">
                <td className="sticky left-0 bg-slate-900 py-2 pl-3 dark:bg-slate-200">Total do recorte</td>
                {defs.map(c => {
                  const f = NUMERICAS[c.id];
                  const v = f ? f(total, total) : null;
                  const moeda = ['receita', 'margem', 'capital_custo', 'capital_venda'].includes(c.id);
                  const pct = ['participacao', 'margem_pct', 'variacao_pct', 'participacao_capital', 'margem_potencial_pct'].includes(c.id);
                  return (
                    <td key={c.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {v === null || !f ? '' : moeda ? fmtBRL(v) : pct ? fmtPct(v) : c.id === 'cobertura_dias' || c.id === 'dias_sem_venda' ? `${fmtNum(v)} d` : fmtNum(v, c.id === 'gmroi' || c.id === 'vmd' ? 2 : 0)}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
        {produtos.length === 0 && <p className="p-8 text-center text-sm text-gray-500">Nenhum produto no recorte. Afrouxe os filtros.</p>}
      </div>
    </div>
  );
};

export default BiArvore;
