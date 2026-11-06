import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { FiltrosBI, ProdutoBI, SituacaoEstoque } from './biTypes';
import { FILTROS_VAZIOS } from './biTypes';
import { QUADRANTES } from './biCalc';

interface Opcao { valor: string; rotulo: string; contagem: number; grupo?: string }

const MultiSelect: React.FC<{
  rotulo: string;
  opcoes: Opcao[];
  selecionados: string[];
  onChange: (v: string[]) => void;
}> = ({ rotulo, opcoes, selecionados, onChange }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const visiveis = opcoes.filter(o => o.rotulo.toLowerCase().includes(busca.toLowerCase()));
  const ativo = selecionados.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          ativo
            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
      >
        {rotulo}
        {ativo && <span className="rounded bg-blue-600 px-1.5 text-[10px] text-white">{selecionados.length}</span>}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <div className="border-b border-gray-100 p-2 dark:border-slate-700">
            <input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder={`Buscar ${rotulo.toLowerCase()}…`}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {visiveis.length === 0 && <p className="p-3 text-xs text-gray-400">Nada encontrado.</p>}
            {visiveis.map((o, i) => {
              const marcado = selecionados.includes(o.valor);
              const novoGrupo = o.grupo && o.grupo !== visiveis[i - 1]?.grupo;
              return (
                <div key={o.valor}>
                  {novoGrupo && <p className="px-2 pb-1 pt-2 text-[10px] font-black uppercase tracking-wide text-gray-400">{o.grupo}</p>}
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => onChange(marcado ? selecionados.filter(s => s !== o.valor) : [...selecionados, o.valor])}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-slate-200">{o.rotulo}</span>
                    <span className="tabular-nums text-gray-400">{o.contagem}</span>
                  </label>
                </div>
              );
            })}
          </div>
          {ativo && (
            <div className="border-t border-gray-100 p-2 text-right dark:border-slate-700">
              <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">Limpar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function contar(lista: ProdutoBI[], chave: (p: ProdutoBI) => string, rotulo: (p: ProdutoBI) => string, grupo?: (p: ProdutoBI) => string): Opcao[] {
  const m = new Map<string, Opcao>();
  for (const p of lista) {
    const k = chave(p);
    const atual = m.get(k);
    if (atual) atual.contagem += 1;
    else m.set(k, { valor: k, rotulo: rotulo(p), contagem: 1, grupo: grupo?.(p) });
  }
  return [...m.values()].sort((a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.rotulo.localeCompare(b.rotulo));
}

const SITUACOES: { valor: SituacaoEstoque; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todo o estoque' },
  { valor: 'com_saldo', rotulo: 'Com saldo' },
  { valor: 'ruptura', rotulo: 'Em ruptura (zerado)' },
  { valor: 'abaixo_minimo', rotulo: 'Abaixo do mínimo' },
  { valor: 'parado', rotulo: 'Parado' },
  { valor: 'vencendo', rotulo: 'Validade crítica' },
];

const BiFiltros: React.FC<{
  produtos: ProdutoBI[];
  filtros: FiltrosBI;
  onChange: (f: FiltrosBI) => void;
}> = ({ produtos, filtros, onChange }) => {
  // As opções em cascata: escolher a família reduz categorias e subcategorias.
  const naFamilia = useMemo(() => produtos.filter(p => !filtros.familias.length || filtros.familias.includes(p.familia_key)), [produtos, filtros.familias]);
  const naCategoria = useMemo(() => naFamilia.filter(p => !filtros.categorias.length || filtros.categorias.includes(p.categoria_key)), [naFamilia, filtros.categorias]);

  const opcoes = useMemo(() => ({
    familias: contar(produtos, p => p.familia_key, p => p.familia),
    categorias: contar(naFamilia, p => p.categoria_key, p => p.categoria, p => p.familia),
    subcategorias: contar(naCategoria, p => p.subcategoria_key, p => p.subcategoria, p => p.categoria),
    fornecedores: contar(produtos, p => p.fornecedor || '—', p => p.fornecedor || 'Sem fornecedor'),
    marcas: contar(produtos, p => p.marca || '—', p => p.marca || 'Sem marca'),
    abc: contar(produtos, p => p.abc || '—', p => (p.abc ? `Curva ${p.abc}` : 'Sem venda no período')),
    xyz: contar(produtos, p => p.xyz || '—', p => (p.xyz ? { X: 'X · venda regular', Y: 'Y · oscila', Z: 'Z · esporádica' }[p.xyz] : 'Sem venda no período')),
  }), [produtos, naFamilia, naCategoria]);

  const set = (parcial: Partial<FiltrosBI>) => onChange({ ...filtros, ...parcial });

  const chips: { rotulo: string; limpar: () => void }[] = [];
  const nomes = (lista: Opcao[], valores: string[]) => valores.map(v => lista.find(o => o.valor === v)?.rotulo || v).join(', ');
  if (filtros.familias.length) chips.push({ rotulo: `Família: ${nomes(opcoes.familias, filtros.familias)}`, limpar: () => set({ familias: [], categorias: [], subcategorias: [] }) });
  if (filtros.categorias.length) chips.push({ rotulo: `Categoria: ${nomes(contar(produtos, p => p.categoria_key, p => p.categoria), filtros.categorias)}`, limpar: () => set({ categorias: [], subcategorias: [] }) });
  if (filtros.subcategorias.length) chips.push({ rotulo: `Subcategoria: ${nomes(contar(produtos, p => p.subcategoria_key, p => p.subcategoria), filtros.subcategorias)}`, limpar: () => set({ subcategorias: [] }) });
  if (filtros.fornecedores.length) chips.push({ rotulo: `Fornecedor: ${nomes(opcoes.fornecedores, filtros.fornecedores)}`, limpar: () => set({ fornecedores: [] }) });
  if (filtros.marcas.length) chips.push({ rotulo: `Marca: ${nomes(opcoes.marcas, filtros.marcas)}`, limpar: () => set({ marcas: [] }) });
  if (filtros.abc.length) chips.push({ rotulo: `ABC: ${filtros.abc.join(', ')}`, limpar: () => set({ abc: [] }) });
  if (filtros.xyz.length) chips.push({ rotulo: `XYZ: ${filtros.xyz.join(', ')}`, limpar: () => set({ xyz: [] }) });
  if (filtros.situacao !== 'todos') chips.push({ rotulo: SITUACOES.find(s => s.valor === filtros.situacao)!.rotulo, limpar: () => set({ situacao: 'todos' }) });
  if (filtros.faixa) chips.push({ rotulo: `${filtros.faixa.nomeMetrica}: ${filtros.faixa.rotulo}`, limpar: () => set({ faixa: null }) });
  if (filtros.quadrante) chips.push({ rotulo: `Quadrante: ${QUADRANTES[filtros.quadrante as keyof typeof QUADRANTES]?.nome || filtros.quadrante}`, limpar: () => set({ quadrante: null }) });
  if (filtros.busca) chips.push({ rotulo: `Busca: "${filtros.busca}"`, limpar: () => set({ busca: '' }) });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={filtros.busca}
            onChange={e => set({ busca: e.target.value })}
            placeholder="Produto, EAN, marca, fornecedor…"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <MultiSelect rotulo="Família" opcoes={opcoes.familias} selecionados={filtros.familias} onChange={v => set({ familias: v, categorias: [], subcategorias: [] })} />
        <MultiSelect rotulo="Categoria" opcoes={opcoes.categorias} selecionados={filtros.categorias} onChange={v => set({ categorias: v, subcategorias: [] })} />
        <MultiSelect rotulo="Subcategoria" opcoes={opcoes.subcategorias} selecionados={filtros.subcategorias} onChange={v => set({ subcategorias: v })} />
        <MultiSelect rotulo="Fornecedor" opcoes={opcoes.fornecedores} selecionados={filtros.fornecedores} onChange={v => set({ fornecedores: v })} />
        <MultiSelect rotulo="Marca" opcoes={opcoes.marcas} selecionados={filtros.marcas} onChange={v => set({ marcas: v })} />
        <MultiSelect rotulo="ABC" opcoes={opcoes.abc} selecionados={filtros.abc} onChange={v => set({ abc: v })} />
        <MultiSelect rotulo="XYZ" opcoes={opcoes.xyz} selecionados={filtros.xyz} onChange={v => set({ xyz: v })} />
        <select
          value={filtros.situacao}
          onChange={e => set({ situacao: e.target.value as SituacaoEstoque })}
          aria-label="Situação do estoque"
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold outline-none ${
            filtros.situacao !== 'todos'
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300'
              : 'border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
          }`}
        >
          {SITUACOES.map(s => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map(c => (
            <span key={c.rotulo} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-900 py-1 pl-3 pr-1.5 text-[11px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900">
              <span className="truncate">{c.rotulo}</span>
              <button type="button" onClick={c.limpar} aria-label={`Remover filtro ${c.rotulo}`} className="rounded-full p-0.5 hover:bg-white/20 dark:hover:bg-black/10">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange(FILTROS_VAZIOS)} className="ml-1 text-[11px] font-bold text-blue-600 hover:underline dark:text-blue-400">
            Limpar tudo
          </button>
        </div>
      )}
    </div>
  );
};

export default BiFiltros;
