import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Play,
  Check,
  Database,
  FileDown,
  FileSpreadsheet,
  Copy,
  ArrowLeft,
  Lightbulb,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  consultorService,
  AcaoSugerida,
  FonteDetalhada,
  MetricasConsultorResponse,
  RelatorioEstruturado,
} from '../services/consultorService';
import { showToast } from '../utils/toast';
import ReactMarkdown from 'react-markdown';

interface Mensagem {
  id: number;
  texto: string;
  isBot: boolean;
  timestamp: Date;
  fontes?: string[];
  fontesDetalhadas?: FonteDetalhada[];
  acoesSugeridas?: AcaoSugerida[];
  relatorioEstruturado?: RelatorioEstruturado;
}

export const ConsultorPage: React.FC = () => {
  const [mensagens, setMensagens] = useState<Mensagem[]>([
    {
      id: 1,
      texto:
        'Olá! Sou o **Consultor da Loja**, seu copiloto de vendas, estoque, caixa, equipe e suporte do sistema. Você pode tirar dúvidas de como usar o sistema, cadastrar produtos direto por aqui ou emitir relatórios completos em PDF/CSV.',
      isBot: true,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [especialista, setEspecialista] = useState<
    | 'geral'
    | 'sistema'
    | 'financeiro'
    | 'vendas'
    | 'estoque'
    | 'rh'
    | 'compras'
    | 'fornecedores'
    | 'clientes'
    | 'auditoria'
  >('geral');
  const [metricas, setMetricas] = useState<MetricasConsultorResponse | null>(null);
  const [executandoKey, setExecutandoKey] = useState<string | null>(null);
  const [acoesConcluidas, setAcoesConcluidas] = useState<Record<string, string>>({});

  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  // Sugestões aparecem como cartões enquanto a conversa não começou; depois ficam a um toque
  // (lâmpada ao lado do campo), sem ocupar uma faixa fixa da tela.
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const conversaIniciada = mensagens.some((m) => !m.isBot);

  // Rola SÓ a conversa. O scrollIntoView de antes rolava também a página e o <main>,
  // o que no celular jogava a tela para cima/baixo e acionava o "puxar para atualizar".
  // Resposta do consultor chega com o começo à vista (para ler a mensagem inteira
  // de cima para baixo); pergunta do usuário e "digitando" vão para o fim.
  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    const ultima = mensagens[mensagens.length - 1];
    requestAnimationFrame(() => {
      const alvo = chat.querySelector<HTMLElement>(`[data-msg-id="${ultima?.id}"]`);
      if (!loading && ultima?.isBot && alvo && mensagens.length > 1) {
        chat.scrollTo({ top: alvo.offsetTop - 8, behavior: 'smooth' });
      } else {
        chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
      }
    });
  }, [mensagens, loading]);

  // Caixa de texto cresce com a mensagem (até o limite) para o usuário ver o que digitou.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [inputValue]);

  useEffect(() => {
    let cancelado = false;
    consultorService.obterResumoDiario(false).then((res) => {
      if (cancelado) return;
      if (res.success && res.resumo) {
        setMensagens((prev) => {
          if (prev.some((m) => m.id === 2)) return prev;
          return [
            prev[0],
            {
              id: 2,
              texto: `**Resumo Diário da Loja**\n\n${res.resumo}`,
              isBot: true,
              timestamp: new Date(),
              fontes: res.fontes,
              fontesDetalhadas: res.fontes_detalhadas,
              acoesSugeridas: res.acoes_sugeridas,
            },
          ];
        });
      }
    });
    consultorService.obterMetricas().then((m) => {
      if (!cancelado && m.success) {
        setMetricas(m);
      }
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const exportarRelatorioPDF = (rel: RelatorioEstruturado, textoAnalise: string) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text(rel.titulo || 'Relatório Gerencial — Consultor da Loja', 14, 18);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(
        `Emitido em: ${new Date(rel.gerado_em || Date.now()).toLocaleString('pt-BR')}`,
        14,
        25
      );

      let currentY = 32;
      const textoLimpo = textoAnalise.replace(/[#*_`]/g, '');
      const linhasTexto = doc.splitTextToSize(textoLimpo, 180);
      doc.setFontSize(10);
      doc.setTextColor(40);
      doc.text(linhasTexto.slice(0, 18), 14, currentY);
      currentY += Math.min(linhasTexto.length, 18) * 5 + 6;

      for (const tabela of rel.tabelas) {
        autoTable(doc, {
          startY: currentY,
          head: [tabela.colunas],
          body: tabela.linhas,
          theme: 'grid',
          headStyles: { fillColor: [79, 70, 229] },
          styles: { fontSize: 9 },
        });
        currentY = ((doc as any).lastAutoTable?.finalY || currentY + 30) + 10;
      }

      doc.save(`relatorio-consultor-loja-${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast.success('PDF do relatório baixado com sucesso!');
    } catch {
      showToast.error('Não foi possível gerar o PDF agora.');
    }
  };

  const exportarRelatorioCSV = (rel: RelatorioEstruturado) => {
    try {
      const blocos: string[] = [];
      for (const tab of rel.tabelas) {
        blocos.push(`# ${tab.titulo}`);
        blocos.push(tab.colunas.map((c) => `"${c.replace(/"/g, '""')}"`).join(';'));
        for (const linha of tab.linhas) {
          blocos.push(linha.map((cel) => `"${String(cel).replace(/"/g, '""')}"`).join(';'));
        }
        blocos.push('');
      }
      const csvContent = '\uFEFF' + blocos.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-consultor-loja-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast.success('Planilha CSV exportada com sucesso!');
    } catch {
      showToast.error('Não foi possível exportar o CSV.');
    }
  };

  const copiarRelatorioWhatsApp = async (rel: RelatorioEstruturado, textoAnalise: string) => {
    const kpisTxt = (rel.resumo_kpis || [])
      .map((k) => `• *${k.label}:* ${k.valor}`)
      .join('\n');
    const resumoFinal = `*${rel.titulo}*\n\n${kpisTxt}\n\n${textoAnalise}`;
    try {
      await navigator.clipboard.writeText(resumoFinal);
      showToast.success('Relatório copiado! Pronto para colar no WhatsApp.');
    } catch {
      showToast.error('Não foi possível copiar para a área de transferência.');
    }
  };

  const handleExecutarAcao = async (msgId: number, acao: AcaoSugerida, idx: number) => {
    const key = `${msgId}-${idx}`;
    if (executandoKey !== null || acoesConcluidas[key]) return;

    const confirmado = window.confirm(`${acao.confirmacao}\n\n${acao.descricao}`);
    if (!confirmado) return;

    setExecutandoKey(key);
    try {
      const res = await consultorService.executarAcao(acao.acao, acao.parametros);
      if (res.success) {
        const msg = res.mensagem || 'Ação confirmada e executada!';
        setAcoesConcluidas((prev) => ({ ...prev, [key]: msg }));
        showToast.success(msg);
      } else {
        showToast.error(res.error || 'Falha ao executar ação.');
      }
    } catch {
      showToast.error('Erro ao executar ação.');
    } finally {
      setExecutandoKey(null);
    }
  };

  const handleSend = async (textoDireto?: string) => {
    const textoEnviar = (textoDireto ?? inputValue).trim();
    if (!textoEnviar || loading) return;

    if (!textoDireto) {
      setInputValue('');
    }
    setSugestoesAbertas(false);

    setMensagens((prev) => [
      ...prev,
      {
        id: Date.now(),
        texto: textoEnviar,
        isBot: false,
        timestamp: new Date(),
      },
    ]);

    setLoading(true);

    try {
      const response = await consultorService.enviarMensagemChat(especialista, textoEnviar);
      if (response.success && response.resposta) {
        setMensagens((prev) => [
          ...prev,
          {
            id: Date.now(),
            texto: response.resposta!,
            isBot: true,
            timestamp: new Date(),
            fontes: response.fontes,
            fontesDetalhadas: response.fontes_detalhadas,
            acoesSugeridas: response.acoes_sugeridas,
            relatorioEstruturado: response.relatorio_estruturado,
          },
        ]);
      } else {
        showToast.error(response.error || 'Erro ao processar mensagem.');
        setMensagens((prev) => [
          ...prev,
          {
            id: Date.now(),
            texto: `Desculpe, não consegui concluir a consulta: ${response.error || 'Falha na conexão'}`,
            isBot: true,
            timestamp: new Date(),
          },
        ]);
      }
    } catch {
      showToast.error('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  const sugestoes = [
    'Como cadastrar um Projetor ou produto sem código de barras?',
    'Emitir relatório completo de vendas, estoque e financeiro deste mês',
    'Quais são os produtos mais vendidos e quais estão em ruptura?',
    'Faturamento vs Despesas deste mês',
  ];

  const LGPD =
    'Respostas baseadas exclusivamente nos indicadores auditáveis e no manual oficial da loja, com dados pessoais pseudonimizados (LGPD).';

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 dark:bg-gray-900 md:rounded-2xl overflow-hidden md:shadow-lg md:border border-gray-100 dark:border-gray-800">
      {/* Cabeçalho numa linha: voltar (celular), título, especialidade e privacidade. */}
      <div className="shrink-0 flex items-center gap-2 sm:gap-3 bg-white dark:bg-gray-800 px-2 sm:px-4 py-2 sm:py-3 border-b border-gray-200 dark:border-gray-700 z-10">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}
          aria-label="Voltar"
          className="md:hidden shrink-0 rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="hidden sm:flex p-2 rounded-xl bg-linear-to-br from-indigo-500 to-purple-600 text-white shadow-md shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base sm:text-lg font-bold text-gray-800 dark:text-white">Consultor da Loja</h2>
          <p className="hidden md:block truncate text-xs text-gray-500 dark:text-gray-400">
            Copiloto com os dados reais da loja: análise, ajuda do sistema, cadastro assistido e relatórios
            {metricas?.interacoes_hoje
              ? ` • Hoje: ${metricas.interacoes_hoje.chat} conversas / ${metricas.interacoes_hoje.acoes} ações`
              : ''}
          </p>
        </div>
        <select
          aria-label="Especialidade do consultor"
          value={especialista}
          onChange={(e) => setEspecialista(e.target.value as any)}
          className="min-w-0 max-w-[48%] sm:max-w-none shrink bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-xs sm:text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 py-1.5 sm:py-2 pl-2"
        >
          <option value="geral">Visão Geral (Master)</option>
          <option value="sistema">Ajuda do Sistema & Cadastros</option>
          <option value="financeiro">Financeiro & Caixa</option>
          <option value="vendas">Vendas & PDV</option>
          <option value="estoque">Estoque & Giro</option>
          <option value="compras">Compras & Reposição</option>
          <option value="fornecedores">Fornecedores & Prazos</option>
          <option value="clientes">Clientes & Crediário</option>
          <option value="rh">Equipe & Ponto</option>
          <option value="auditoria">Auditoria & Prevenção de Perdas</option>
        </select>
        <span title={LGPD} aria-label={LGPD} className="hidden sm:inline-flex shrink-0 p-1.5 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-5 w-5" />
        </span>
      </div>

      {/* Chat Area */}
      <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 sm:px-6 sm:py-6 bg-[url('/pattern.svg')] dark:bg-[url('/pattern-dark.svg')] bg-repeat/5">
        {/* Coluna de leitura: em tela larga a conversa não se espalha de ponta a ponta. */}
        <div className="mx-auto w-full max-w-3xl space-y-5 sm:space-y-6">
        <AnimatePresence>
          {mensagens.map((msg) => (
            <motion.div
              key={msg.id}
              data-msg-id={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex flex-col min-w-0 max-w-[94%] sm:max-w-[88%] ${msg.isBot ? 'mr-auto items-start' : 'ml-auto items-end'}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1 dark:text-gray-400">
                  {msg.isBot ? (
                    <Bot className="w-3 h-3 text-indigo-500" />
                  ) : (
                    <User className="w-3 h-3 text-gray-400" />
                  )}
                  {msg.isBot ? 'Consultor da Loja' : 'Você'}
                </span>
                <span className="text-[10px] text-gray-400">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div
                className={`max-w-full min-w-0 p-3 sm:p-4 rounded-2xl shadow-sm leading-relaxed wrap-anywhere ${
                  msg.isBot
                    ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-none'
                    : 'bg-linear-to-r from-indigo-500 to-purple-600 text-white rounded-tr-none'
                }`}
              >
                {msg.isBot ? (
                  <div className="space-y-3">
                    <div className="prose dark:prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.texto}</ReactMarkdown>
                    </div>

                    {/* Relatório Estruturado sob demanda (KPIs + Tabelas + Exportação PDF/CSV/WhatsApp) */}
                    {msg.relatorioEstruturado && (
                      <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-900/50 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                            📊 {msg.relatorioEstruturado.titulo}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => exportarRelatorioPDF(msg.relatorioEstruturado!, msg.texto)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              Baixar PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => exportarRelatorioCSV(msg.relatorioEstruturado!)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                              Exportar CSV
                            </button>
                            <button
                              type="button"
                              onClick={() => copiarRelatorioWhatsApp(msg.relatorioEstruturado!, msg.texto)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Copiar (WhatsApp)
                            </button>
                          </div>
                        </div>

                        {msg.relatorioEstruturado.resumo_kpis?.length > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {msg.relatorioEstruturado.resumo_kpis.map((kpi, kIdx) => (
                              <div
                                key={kIdx}
                                className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-100 dark:border-gray-700"
                              >
                                <span className="block text-[10px] font-semibold uppercase text-gray-400">
                                  {kpi.label}
                                </span>
                                <span className="text-sm font-bold text-gray-900 dark:text-white">
                                  {kpi.valor}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.relatorioEstruturado.tabelas?.map((tab, tIdx) => (
                          <div
                            key={tIdx}
                            className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700"
                          >
                            <div className="bg-gray-50 dark:bg-gray-900/70 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                              {tab.titulo}
                            </div>
                            <table className="w-full text-left text-xs">
                              <thead className="bg-gray-100/70 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                <tr>
                                  {tab.colunas.map((col, cIdx) => (
                                    <th key={cIdx} className="px-3 py-1.5 font-semibold">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                                {tab.linhas.map((linha, rIdx) => (
                                  <tr key={rIdx}>
                                    {linha.map((cel, cIdx) => (
                                      <td key={cIdx} className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                                        {cel}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.acoesSugeridas && msg.acoesSugeridas.length > 0 && (
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
                        {msg.acoesSugeridas.map((acao, idx) => {
                          const key = `${msg.id}-${idx}`;
                          const concluida = acoesConcluidas[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => handleExecutarAcao(msg.id, acao, idx)}
                              disabled={executandoKey !== null || Boolean(concluida)}
                              title={acao.descricao}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                concluida
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50'
                              }`}
                            >
                              {concluida ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  {concluida}
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5" />
                                  {executandoKey === key ? 'Executando...' : acao.rotulo}
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {((msg.fontesDetalhadas && msg.fontesDetalhadas.length > 0) ||
                      (msg.fontes && msg.fontes.length > 0)) && (
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-700/80">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                          <Database className="w-3 h-3" /> De onde veio este número
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {msg.fontesDetalhadas && msg.fontesDetalhadas.length > 0
                            ? msg.fontesDetalhadas.map((fd, i) => (
                                <li
                                  key={`${fd.fonte}-${i}`}
                                  className="text-[11px] text-gray-600 dark:text-gray-300"
                                >
                                  <span className="font-semibold">{fd.titulo}:</span>{' '}
                                  <span className="text-gray-500 dark:text-gray-400">{fd.descricao}</span>
                                </li>
                              ))
                            : (msg.fontes || []).map((f, i) => (
                                <li key={`${f}-${i}`} className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {f}
                                </li>
                              ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p>{msg.texto}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex mr-auto items-start max-w-[80%]"
          >
            <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-none border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
              <div
                className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                style={{ animationDelay: '0.2s' }}
              ></div>
              <div
                className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                style={{ animationDelay: '0.4s' }}
              ></div>
            </div>
          </motion.div>
        )}

        {!conversaIniciada && (
          <div>
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">Comece por aqui</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {sugestoes.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => handleSend(sug)}
                  disabled={loading}
                  className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-indigo-500 dark:hover:bg-gray-700"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Campo de mensagem: a lâmpada abre as sugestões quando a conversa já começou. */}
      <div
        className="shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-2 pt-2 sm:px-4 sm:pt-3"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {conversaIniciada && sugestoesAbertas && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sugestoes.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => handleSend(sug)}
                  disabled={loading}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs font-medium text-gray-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-1.5 sm:gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl p-1.5 sm:p-2 border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all shadow-inner"
          >
            {conversaIniciada && (
              <button
                type="button"
                onClick={() => setSugestoesAbertas((v) => !v)}
                aria-label="Sugestões de pergunta"
                aria-expanded={sugestoesAbertas}
                title="Sugestões de pergunta"
                className={`shrink-0 p-2.5 mb-0.5 rounded-lg transition-colors ${sugestoesAbertas ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                <Lightbulb className="w-5 h-5" />
              </button>
            )}
            <textarea
              ref={textareaRef}
              aria-label="Mensagem para o consultor"
              enterKeyHint="send"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Pergunte, peça um cadastro ou um relatório..."
              className="flex-1 min-w-0 max-h-32 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none overflow-y-auto text-gray-700 dark:text-gray-200 py-3 px-2"
              rows={1}
            />
            <button
              type="submit"
              aria-label="Enviar mensagem"
              disabled={!inputValue.trim() || loading}
              className="shrink-0 p-3 mb-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white transition-colors shadow-md disabled:shadow-none"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
