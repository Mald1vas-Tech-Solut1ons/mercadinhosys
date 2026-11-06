import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BarChart3, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { apiClient } from '../../../api/apiClient';
import { formatDate } from '../../../utils/formatters';
import type { FiltrosBI, ProdutoBI, RespostaBI } from './biTypes';
import { FILTROS_VAZIOS } from './biTypes';
import type { BlocoId, ConfigBI } from './biConfig';
import { blocosDoModo, colunasDoModo, lerConfig, salvarConfig } from './biConfig';
import { agregar, aplicarFiltros } from './biCalc';
import BiFiltros from './BiFiltros';
import BiArvore from './BiArvore';
import {
  AvisoAmostra, BlocoAcoes, BlocoCapitalReceita, BlocoCesta, BlocoFaixas, BlocoHeatmap, BlocoKpis,
  BlocoMatriz, BlocoPareto, BlocoTreemap,
} from './BiBlocos';
import { PainelConfig, PainelProduto } from './BiPaineis';

/** Um bloco com erro mostra o aviso só nele; o resto do painel continua de pé. */
class ProtecaoBloco extends Component<{ nome: string; children: ReactNode }, { erro: string | null }> {
  state = { erro: null as string | null };
  static getDerivedStateFromError(e: Error) { return { erro: e.message }; }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error(`[BI] bloco ${this.props.nome}`, e, info.componentStack); }
  render() {
    if (this.state.erro) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-bold">Este bloco não pôde ser exibido ({this.props.nome}).</p>
          <button type="button" onClick={() => this.setState({ erro: null })} className="mt-1 font-bold underline">Tentar de novo</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Blocos que ocupam a largura inteira; os demais formam pares lado a lado. */
const LARGURA_TOTAL: BlocoId[] = ['kpis', 'acoes', 'arvore', 'matriz', 'heatmap'];

const BiTab: React.FC<{ periodo?: { de: string; ate: string } }> = ({ periodo }) => {
  // A resposta guarda a chave (período + versão) que a pediu: "carregando" é só
  // a chave atual ainda não ter resposta, sem setState síncrono dentro do efeito.
  const [versao, setVersao] = useState(0);
  const [resposta, setResposta] = useState<{ chave: string; dados: RespostaBI | null; erro: string | null } | null>(null);
  const [filtros, setFiltros] = useState<FiltrosBI>(FILTROS_VAZIOS);
  const [config, setConfigState] = useState<ConfigBI>(() => lerConfig());
  const [configAberta, setConfigAberta] = useState(false);
  const [produtoAberto, setProdutoAberto] = useState<ProdutoBI | null>(null);

  const setConfig = (c: ConfigBI) => { setConfigState(c); salvarConfig(c); };

  const de = periodo?.de;
  const ate = periodo?.ate;
  const chave = `${de}|${ate}|${versao}`;

  useEffect(() => {
    if (!de || !ate) return undefined;
    let vivo = true;
    // versao > 0 = o usuário pediu "Recarregar": o backend pula o cache.
    apiClient.get('/dashboard/bi', { params: { de, ate, ...(versao > 0 ? { fresh: 1 } : {}) } })
      .then(r => { if (vivo) setResposta({ chave, dados: r.data?.data || null, erro: null }); })
      .catch(e => {
        if (!vivo) return;
        const codigo = e?.response?.data?.code;
        setResposta(atual => ({
          chave,
          dados: atual?.dados ?? null,
          erro: codigo === 'PLAN_RESTRICTED' ? 'A análise BI faz parte do plano Pro.' : 'Não foi possível carregar a análise BI. Tente atualizar.',
        }));
      });
    return () => { vivo = false; };
  }, [de, ate, chave, versao]);

  const carregar = useCallback(() => setVersao(v => v + 1), []);
  const carregando = resposta?.chave !== chave;
  const dados = resposta?.dados ?? null;
  const erro = resposta?.chave === chave ? resposta.erro : null;

  const todos = useMemo(() => dados?.produtos || [], [dados]);
  const limiares = config.limiares;
  const filtrados = useMemo(() => aplicarFiltros(todos, filtros, limiares), [todos, filtros, limiares]);
  // Faixas e matriz mostram a distribuição sem o próprio recorte, para o usuário ver as outras barras.
  const semFaixa = useMemo(() => aplicarFiltros(todos, filtros, limiares, { faixa: true }), [todos, filtros, limiares]);
  const semQuadrante = useMemo(() => aplicarFiltros(todos, filtros, limiares, { quadrante: true }), [todos, filtros, limiares]);
  const total = useMemo(() => agregar(filtrados, limiares), [filtrados, limiares]);

  const blocos = blocosDoModo(config);
  const colunas = colunasDoModo(config);
  // Bloco de meia largura sem par (vizinho de um de largura total) ocupa a linha inteira.
  const larguraTotal = new Set<BlocoId>();
  let pendente: BlocoId | null = null;
  for (const id of blocos) {
    if (LARGURA_TOTAL.includes(id)) {
      if (pendente) larguraTotal.add(pendente);
      pendente = null;
      larguraTotal.add(id);
    } else if (pendente) {
      pendente = null;
    } else {
      pendente = id;
    }
  }
  if (pendente) larguraTotal.add(pendente);
  const aplicarFiltro = (parcial: Partial<FiltrosBI>) => setFiltros(f => ({ ...f, ...parcial }));
  const comVenda = todos.filter(p => p.receita > 0).length;

  if (!periodo) {
    return <p className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-slate-700">Escolha as datas do período personalizado e clique em Aplicar.</p>;
  }

  const renderBloco = (id: BlocoId) => {
    switch (id) {
      case 'kpis': return <BlocoKpis total={total} produtos={filtrados} limiares={limiares} />;
      case 'acoes': return <BlocoAcoes produtos={filtrados} limiares={limiares} onProduto={setProdutoAberto} onFiltro={aplicarFiltro} />;
      case 'arvore': return <BiArvore produtos={filtrados} colunas={colunas} limiares={limiares} compacta={config.densidade === 'compacta'} onProduto={setProdutoAberto} />;
      case 'treemap': return <BlocoTreemap produtos={filtrados} onFiltro={aplicarFiltro} />;
      case 'capital_receita': return <BlocoCapitalReceita produtos={filtrados} onFiltro={aplicarFiltro} />;
      case 'faixas': return <BlocoFaixas produtos={semFaixa} limiares={limiares} filtros={filtros} onFiltro={aplicarFiltro} />;
      case 'matriz': return <BlocoMatriz produtos={semQuadrante} limiares={limiares} filtros={filtros} onFiltro={aplicarFiltro} onProduto={setProdutoAberto} />;
      case 'pareto': return <BlocoPareto produtos={filtrados} />;
      case 'heatmap': return dados ? <BlocoHeatmap temporal={dados.temporal} produtos={filtrados} onFiltro={aplicarFiltro} /> : null;
      case 'cesta': return dados ? <BlocoCesta cesta={dados.cesta} produtos={todos} onProduto={setProdutoAberto} /> : null;
      default: return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Barra do BI: período, nível de análise, configuração */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <BarChart3 className="h-5 w-5 text-blue-600" />
        <div className="min-w-0">
          <h2 className="text-base font-black text-gray-900 dark:text-white">Análise BI</h2>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            {dados ? `${formatDate(dados.periodo.inicio)} a ${formatDate(dados.periodo.fim)} · comparado a ${formatDate(dados.periodo.anterior_inicio)}–${formatDate(dados.periodo.anterior_fim)}` : 'Carregando período…'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Nível de análise">
            {(['essencial', 'avancado'] as const).map(m => (
              <button key={m} type="button" onClick={() => setConfig({ ...config, modo: m })}
                className={`rounded-md px-3 py-1.5 text-xs font-bold ${config.modo === m ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-gray-500 dark:text-slate-400'}`}>
                {m === 'essencial' ? 'Essencial' : 'Avançado'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => carregar()} title="Recarregar dados" className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={() => setConfigAberta(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
            <SlidersHorizontal className="h-4 w-4" /> Configurar BI
          </button>
        </div>
        {dados && (
          <div className="basis-full border-t border-gray-100 pt-3 dark:border-slate-800">
            <BiFiltros produtos={todos} filtros={filtros} onChange={setFiltros} />
          </div>
        )}
      </div>

      {carregando && !dados && (
        <div className="flex items-center gap-2 p-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Montando a análise…</div>
      )}
      {erro && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{erro}</div>}

      {dados && todos.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-slate-700">
          Nenhum produto ativo cadastrado. Cadastre produtos com família, categoria e subcategoria para a análise aparecer.
        </div>
      )}

      {dados && todos.length > 0 && (
        <>
          {comVenda < 10 && <AvisoAmostra texto={`Só ${comVenda} produto(s) com venda no período: margem, giro, Pareto e cesta ficam pouco confiáveis. O retrato do estoque (capital, cobertura, parados) continua válido.`} />}
          {blocos.length === 0 && <p className="text-sm text-gray-500">Nenhum bloco ligado. Abra “Configurar BI” e escolha o que analisar.</p>}
          <div className={`grid gap-4 lg:grid-cols-2 ${carregando ? 'opacity-60' : ''}`}>
            {blocos.map(id => (
              <div key={id} className={`min-w-0 ${larguraTotal.has(id) ? 'lg:col-span-2' : ''}`}><ProtecaoBloco nome={id}>{renderBloco(id)}</ProtecaoBloco></div>
            ))}
          </div>
        </>
      )}

      {configAberta && <PainelConfig config={config} onChange={setConfig} onFechar={() => setConfigAberta(false)} />}
      {produtoAberto && dados && <PainelProduto produto={produtoAberto} limiares={limiares} dias={dados.periodo.dias} onFechar={() => setProdutoAberto(null)} />}
    </div>
  );
};

export default BiTab;
