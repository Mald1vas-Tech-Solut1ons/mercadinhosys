import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { BlocoId, ColunaId, ConfigBI, LimiaresBI, ModoBI } from './biConfig';
import { BLOCOS, COLUNAS, CONFIG_PADRAO, VISOES_PRONTAS } from './biConfig';
import type { ProdutoBI } from './biTypes';
import { estaParado, fmtBRL, fmtNum, fmtPct, giro } from './biCalc';

const Gaveta: React.FC<{ titulo: string; subtitulo?: string; onFechar: () => void; children: React.ReactNode; largura?: string }> = ({ titulo, subtitulo, onFechar, children, largura = 'max-w-xl' }) => createPortal(
  <div className="fixed inset-0 z-[200] flex justify-end bg-black/40" onClick={onFechar}>
    <aside
      onClick={e => e.stopPropagation()}
      className={`flex h-full w-full ${largura} flex-col bg-white shadow-2xl dark:bg-slate-900`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <header className="flex flex-shrink-0 items-start gap-3 border-b border-gray-200 px-5 py-4 dark:border-slate-700" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black text-gray-900 dark:text-white">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{subtitulo}</p>}
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  </div>,
  document.body,
);

const Secao: React.FC<{ titulo: string; nota?: string; children: React.ReactNode }> = ({ titulo, nota, children }) => (
  <section className="mb-6">
    <h3 className="text-xs font-black uppercase tracking-wide text-gray-500 dark:text-slate-400">{titulo}</h3>
    {nota && <p className="mb-2 mt-0.5 text-[11px] text-gray-400">{nota}</p>}
    <div className="mt-2">{children}</div>
  </section>
);

function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const n = [...lista];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

function ListaOrdenavel<T extends string>({ todos, ativos, onChange, modo }: {
  todos: { id: T; nome: string; descricao?: string; dica?: string; avancado: boolean }[];
  ativos: T[];
  onChange: (v: T[]) => void;
  modo: ModoBI;
}) {
  const inativos = todos.filter(t => !ativos.includes(t.id));
  const ordenados = [...ativos.map(id => todos.find(t => t.id === id)!).filter(Boolean), ...inativos];
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-slate-800 dark:border-slate-700">
      {ordenados.map(item => {
        const ligado = ativos.includes(item.id);
        const idx = ativos.indexOf(item.id);
        const oculto = modo === 'essencial' && item.avancado;
        return (
          <li key={item.id} className={`flex items-center gap-2 px-3 py-2 ${ligado ? '' : 'opacity-60'}`}>
            <input id={`cfg-${item.id}`} type="checkbox" checked={ligado} className="h-4 w-4 accent-blue-600"
              onChange={() => onChange(ligado ? ativos.filter(a => a !== item.id) : [...ativos, item.id])} />
            <label htmlFor={`cfg-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-sm font-semibold text-gray-800 dark:text-slate-200">
                {item.nome}
                {item.avancado && <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">avançado</span>}
              </span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">{item.descricao || item.dica}{oculto && ligado ? ' · oculto no modo essencial' : ''}</span>
            </label>
            {ligado && (
              <span className="flex flex-col">
                <button type="button" aria-label="Subir" onClick={() => onChange(mover(ativos, idx, -1))} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Descer" onClick={() => onChange(mover(ativos, idx, 1))} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800"><ArrowDown className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const CAMPOS_LIMIAR: { id: keyof LimiaresBI; nome: string; unidade: string; dica: string }[] = [
  { id: 'margem_minima', nome: 'Margem mínima', unidade: '%', dica: 'Abaixo disso a linha fica vermelha e entra em "Onde agir"' },
  { id: 'dias_parado', nome: 'Parado a partir de', unidade: 'dias', dica: 'Dias sem venda para considerar o produto parado' },
  { id: 'cobertura_alvo', nome: 'Cobertura-alvo', unidade: 'dias', dica: 'Quantos dias de venda o estoque deveria cobrir' },
  { id: 'validade_critica', nome: 'Validade crítica', unidade: 'dias', dica: 'Lotes que vencem dentro deste prazo' },
];

export const PainelConfig: React.FC<{ config: ConfigBI; onChange: (c: ConfigBI) => void; onFechar: () => void }> = ({ config, onChange, onFechar }) => {
  const [nomeVisao, setNomeVisao] = useState('');
  const set = (parcial: Partial<ConfigBI>) => onChange({ ...config, ...parcial });

  return (
    <Gaveta titulo="Configurar o BI" subtitulo="Você decide o que analisar. As escolhas ficam salvas neste navegador." onFechar={onFechar}>
      <Secao titulo="Nível de análise">
        <div className="grid grid-cols-2 gap-2">
          {(['essencial', 'avancado'] as ModoBI[]).map(m => (
            <button key={m} type="button" onClick={() => set({ modo: m })}
              className={`rounded-xl border p-3 text-left ${config.modo === m ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-600/20 dark:bg-blue-500/10' : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
              <span className="block text-sm font-black text-gray-900 dark:text-white">{m === 'essencial' ? 'Essencial' : 'Avançado'}</span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">
                {m === 'essencial' ? 'Indicadores, onde agir, mapa do capital e tabela-mestra.' : 'Tudo: faixas, matriz giro × margem, Pareto, mapa de calor, cesta, GMROI e XYZ.'}
              </span>
            </button>
          ))}
        </div>
      </Secao>

      <Secao titulo="Visões" nota="Uma visão guarda modo, blocos e colunas. Aplique uma pronta ou salve a sua.">
        <div className="flex flex-wrap gap-1.5">
          {VISOES_PRONTAS.map(v => (
            <button key={v.nome} type="button" onClick={() => set({ modo: v.modo, blocos: v.blocos, colunas: v.colunas })}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 hover:border-blue-500 hover:text-blue-700 dark:border-slate-700 dark:text-slate-200">
              {v.nome}
            </button>
          ))}
        </div>
        {config.visoes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {config.visoes.map((v, i) => (
              <li key={`${v.nome}-${i}`} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-slate-800">
                <button type="button" onClick={() => set({ modo: v.modo, blocos: v.blocos, colunas: v.colunas })} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">{v.nome}</button>
                <span className="text-[10px] text-gray-400">{v.blocos.length} blocos · {v.colunas.length} colunas</span>
                <button type="button" aria-label={`Excluir visão ${v.nome}`} onClick={() => set({ visoes: config.visoes.filter((_, j) => j !== i) })} className="rounded p-1 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-3 flex gap-2" onSubmit={e => {
          e.preventDefault();
          const nome = nomeVisao.trim();
          if (!nome) return;
          set({ visoes: [...config.visoes.filter(v => v.nome !== nome), { nome, modo: config.modo, blocos: config.blocos, colunas: config.colunas }] });
          setNomeVisao('');
        }}>
          <input id="bi-nome-visao" value={nomeVisao} onChange={e => setNomeVisao(e.target.value)} placeholder="Nome da visão atual (ex.: Compras de segunda)"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <button type="submit" disabled={!nomeVisao.trim()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />Salvar</button>
        </form>
      </Secao>

      <Secao titulo="Blocos do painel" nota="Marque o que aparece e use as setas para ordenar.">
        <ListaOrdenavel<BlocoId> todos={BLOCOS} ativos={config.blocos} onChange={b => set({ blocos: b })} modo={config.modo} />
      </Secao>

      <Secao titulo="Colunas da tabela-mestra">
        <ListaOrdenavel<ColunaId> todos={COLUNAS} ativos={config.colunas} onChange={c => set({ colunas: c })} modo={config.modo} />
      </Secao>

      <Secao titulo="Limiares da loja" nota="Definem faixas, cores de alerta e as listas de 'Onde agir'.">
        <div className="grid grid-cols-2 gap-3">
          {CAMPOS_LIMIAR.map(c => (
            <label key={c.id} className="block" title={c.dica}>
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">{c.nome}</span>
              <span className="mt-1 flex items-center gap-1">
                <input id={`limiar-${c.id}`} type="number" min={0} max={c.unidade === '%' ? 100 : 3650} value={config.limiares[c.id]}
                  onChange={e => set({ limiares: { ...config.limiares, [c.id]: Math.max(0, Number(e.target.value) || 0) } })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm tabular-nums text-gray-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <span className="text-xs text-gray-500">{c.unidade}</span>
              </span>
              <span className="mt-0.5 block text-[10px] text-gray-400">{c.dica}</span>
            </label>
          ))}
        </div>
      </Secao>

      <Secao titulo="Densidade da tabela">
        <div className="flex gap-2">
          {(['confortavel', 'compacta'] as const).map(d => (
            <button key={d} type="button" onClick={() => set({ densidade: d })}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${config.densidade === d ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200'}`}>
              {d === 'confortavel' ? 'Confortável' : 'Compacta'}
            </button>
          ))}
        </div>
      </Secao>

      <button type="button" onClick={() => onChange({ ...CONFIG_PADRAO, visoes: config.visoes })} className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 dark:hover:text-white">
        <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão (mantém as visões salvas)
      </button>
    </Gaveta>
  );
};

const Linha: React.FC<{ rotulo: string; valor: React.ReactNode; destaque?: string }> = ({ rotulo, valor, destaque }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-1.5 text-sm dark:border-slate-800">
    <span className="text-gray-500 dark:text-slate-400">{rotulo}</span>
    <span className={`text-right font-semibold tabular-nums ${destaque || 'text-gray-900 dark:text-white'}`}>{valor}</span>
  </div>
);

export const PainelProduto: React.FC<{ produto: ProdutoBI; limiares: LimiaresBI; dias: number; onFechar: () => void }> = ({ produto: p, limiares, dias, onFechar }) => (
  <Gaveta titulo={p.nome} subtitulo={`${p.familia} › ${p.categoria} › ${p.subcategoria}`} onFechar={onFechar} largura="max-w-md">
    <div className="mb-4 flex flex-wrap gap-1.5">
      {p.abc && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">Curva {p.abc}</span>}
      {p.xyz && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-black text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">{{ X: 'X · regular', Y: 'Y · oscila', Z: 'Z · esporádico' }[p.xyz]}</span>}
      {p.ruptura && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-800 dark:bg-red-500/20 dark:text-red-300">Ruptura</span>}
      {estaParado(p, limiares) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">Parado</span>}
      {p.custo_estimado && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700 dark:bg-slate-700 dark:text-slate-200">Custo estimado</span>}
    </div>
    <h3 className="mb-1 text-xs font-black uppercase tracking-wide text-gray-400">Vendas · {dias} dias</h3>
    <Linha rotulo="Faturamento" valor={fmtBRL(p.receita)} />
    <Linha rotulo="Período anterior" valor={`${fmtBRL(p.receita_anterior)} ${p.variacao_pct === null ? '' : `(${p.variacao_pct >= 0 ? '+' : ''}${fmtPct(p.variacao_pct)})`}`} destaque={p.variacao_pct === null ? undefined : p.variacao_pct >= 0 ? 'text-emerald-600' : 'text-red-600'} />
    <Linha rotulo="Margem bruta" valor={`${fmtBRL(p.margem)} · ${fmtPct(p.margem_pct)}`} destaque={(p.margem_pct ?? 100) < limiares.margem_minima ? 'text-red-600' : undefined} />
    <Linha rotulo="Quantidade · vendas" valor={`${fmtNum(p.qtd, p.qtd % 1 ? 2 : 0)} un · ${p.vendas} vendas`} />
    <Linha rotulo="Dias com venda" valor={`${p.dias_com_venda} de ${dias}`} />
    <Linha rotulo="Venda média diária" valor={fmtNum(p.vmd, 2)} />
    <Linha rotulo="Última venda" valor={p.nunca_vendeu ? 'nunca vendeu' : `há ${p.dias_sem_venda} dias`} />
    <h3 className="mb-1 mt-5 text-xs font-black uppercase tracking-wide text-gray-400">Estoque e capital</h3>
    <Linha rotulo="Estoque · mínimo" valor={`${fmtNum(p.estoque, p.estoque % 1 ? 2 : 0)} · ${fmtNum(p.estoque_minimo)}`} destaque={p.ruptura ? 'text-red-600' : undefined} />
    <Linha rotulo="Preço de custo · venda" valor={`${fmtBRL(p.preco_custo)} · ${fmtBRL(p.preco_venda)}`} />
    <Linha rotulo="Margem potencial" valor={fmtPct(p.margem_potencial_pct)} />
    <Linha rotulo="Capital a custo" valor={fmtBRL(p.capital_custo)} />
    <Linha rotulo="Capital a preço de venda" valor={fmtBRL(p.capital_venda)} />
    <Linha rotulo="Cobertura" valor={p.cobertura_dias === null ? (p.estoque > 0 ? 'sem giro' : '—') : `${fmtNum(p.cobertura_dias)} dias`} />
    <Linha rotulo="Giro no período" valor={giro(p) === null ? '—' : fmtNum(giro(p)!, 2)} />
    <Linha rotulo="GMROI" valor={p.gmroi === null ? '—' : fmtNum(p.gmroi, 2)} />
    <Linha rotulo="Validade" valor={p.validade_dias === null ? 'não informada' : p.validade_dias < 0 ? `venceu há ${-p.validade_dias} dias` : `${p.validade_dias} dias`} destaque={p.validade_dias !== null && p.validade_dias <= limiares.validade_critica ? 'text-red-600' : undefined} />
    <h3 className="mb-1 mt-5 text-xs font-black uppercase tracking-wide text-gray-400">Cadastro</h3>
    <Linha rotulo="EAN" valor={p.ean || '—'} />
    <Linha rotulo="Marca" valor={p.marca || '—'} />
    <Linha rotulo="Fornecedor" valor={p.fornecedor || '—'} />
  </Gaveta>
);
