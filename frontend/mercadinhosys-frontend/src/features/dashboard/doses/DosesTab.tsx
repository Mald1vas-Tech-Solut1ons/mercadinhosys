import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, GlassWater, Loader2, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../api/apiClient';
import { fmtBRL, fmtNum, fmtPct } from '../bi/biCalc';
import { Bloco } from '../bi/BiBlocos';
import type { RespostaDoses } from './dosesTypes';
import { horaDePico, rendimentoSaudavel } from './dosesTypes';

const Kpi: React.FC<{ rotulo: string; valor: string; detalhe?: string; alerta?: boolean }> = ({ rotulo, valor, detalhe, alerta }) => (
  <div className={`min-w-0 rounded-2xl border p-3 ${alerta ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">{rotulo}</p>
    <p className="mt-1 truncate text-xl font-black text-gray-900 dark:text-white">{valor}</p>
    {detalhe && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">{detalhe}</p>}
  </div>
);

const COR_ALERTA: Record<string, string> = {
  alta: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  media: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  baixa: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
};

const DosesTab: React.FC<{ periodo?: { de: string; ate: string } }> = ({ periodo }) => {
  const navigate = useNavigate();
  const [versao, setVersao] = useState(0);
  const [resposta, setResposta] = useState<{ chave: string; dados: RespostaDoses | null; erro: string | null } | null>(null);
  const de = periodo?.de;
  const ate = periodo?.ate;
  const chave = `${de}|${ate}|${versao}`;

  useEffect(() => {
    if (!de || !ate) return undefined;
    let vivo = true;
    apiClient.get('/dashboard/doses', { params: { de, ate } })
      .then(r => { if (vivo) setResposta({ chave, dados: r.data?.data || null, erro: null }); })
      .catch(e => {
        if (!vivo) return;
        const codigo = e?.response?.data?.code;
        setResposta({ chave, dados: null, erro: codigo === 'PLAN_RESTRICTED' ? 'O acompanhamento de doses faz parte do plano Pro.' : 'Não foi possível carregar as doses. Tente atualizar.' });
      });
    return () => { vivo = false; };
  }, [de, ate, chave, versao]);

  const recarregar = useCallback(() => setVersao(v => v + 1), []);

  const exportar = async () => {
    if (!de || !ate) return;
    const r = await apiClient.get('/dashboard/doses', { params: { de, ate, formato: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `doses_${de}_${ate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!periodo) {
    return <p className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-slate-700">Escolha as datas do período personalizado e clique em Aplicar.</p>;
  }

  const carregando = resposta?.chave !== chave;
  const dados = resposta?.dados ?? null;
  const erro = resposta?.chave === chave ? resposta.erro : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <GlassWater className="h-5 w-5 text-blue-600" />
        <div className="min-w-0">
          <h2 className="text-base font-black text-gray-900 dark:text-white">Venda por dose</h2>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">Vendas, margem, rendimento das garrafas e perdas no período</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dados && dados.produtos.length > 0 && (
            <button type="button" onClick={exportar} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              <Download className="h-4 w-4" /> Exportar
            </button>
          )}
          <button type="button" onClick={recarregar} title="Recarregar dados" className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {carregando && !dados && <div className="flex items-center gap-2 p-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando as doses…</div>}
      {erro && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">{erro}</div>}

      {dados && dados.produtos.length === 0 && dados.abertas.quantidade === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-slate-700">
          Nenhuma venda por dose neste período. Para vender por dose, abra o cadastro de uma bebida e configure as doses (ml e preço são livres).
        </div>
      )}

      {dados && (dados.produtos.length > 0 || dados.abertas.quantidade > 0) && (() => {
        const r = dados.resumo;
        const estado = rendimentoSaudavel(r.rendimento_pct, dados.config.perda_esperada_pct, dados.config.alerta_rendimento_pct);
        const pico = horaDePico(dados.pico_por_hora);
        return (
          <div className={`space-y-4 ${carregando ? 'opacity-60' : ''}`}>
            {dados.alertas.length > 0 && (
              <div className="space-y-2">
                {dados.alertas.map((a, i) => (
                  <div key={`${a.tipo}-${i}`} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${COR_ALERTA[a.severidade] || COR_ALERTA.baixa}`}>
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{a.titulo}</p>
                      <p className="text-xs opacity-90">{a.descricao}</p>
                    </div>
                    {a.produto_id ? (
                      <button type="button" onClick={() => navigate(`/products/${a.produto_id}`)} className="rounded-lg bg-black/5 px-3 py-1 text-xs font-bold uppercase hover:bg-black/10 dark:bg-white/10">
                        {a.acao}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi rotulo="Doses vendidas" valor={fmtNum(r.doses)} detalhe={`${fmtNum(r.ml)} ml · ${fmtNum(r.garrafas_equivalentes, 1)} garrafas`} />
              <Kpi rotulo="Receita de doses" valor={fmtBRL(r.receita)} detalhe={`Custo ${fmtBRL(r.custo)}`} />
              <Kpi rotulo="Margem" valor={fmtPct(r.margem_pct)} detalhe={`${fmtBRL(r.margem)} · após perdas ${fmtBRL(r.margem_liquida)}`} />
              <Kpi rotulo="Perdas e diferenças" valor={fmtBRL(r.perdas_custo)} detalhe="Custo do ml sem venda" alerta={r.perdas_custo > 0 && r.receita > 0 && r.perdas_custo / r.receita > 0.05} />
              <Kpi rotulo="Rendimento das garrafas" valor={r.rendimento_pct == null ? 'Sem dados' : fmtPct(r.rendimento_pct)}
                detalhe={r.garrafas_encerradas > 0 ? `${r.garrafas_encerradas} garrafa(s) encerrada(s)` : 'Encerre garrafas para medir'} alerta={estado === 'baixo'} />
              <Kpi rotulo="Garrafas abertas agora" valor={fmtNum(dados.abertas.quantidade)} detalhe={`${fmtNum(dados.abertas.saldo_ml)} ml · ${fmtBRL(dados.abertas.valor_custo)} a custo`} alerta={dados.abertas.vencidas > 0} />
              <Kpi rotulo="Horário de pico" valor={pico == null ? '—' : `${String(pico).padStart(2, '0')}h`} detalhe="Hora que mais vende dose" />
            </div>

            <Bloco titulo="Por produto" subtitulo="Receita, margem, quanto cada garrafa rendeu em dose e por quanto tempo o estoque dura">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="text-[11px] uppercase text-gray-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2 pr-2">Produto</th><th className="px-2 text-right">Doses</th><th className="px-2 text-right">Receita</th>
                      <th className="px-2 text-right">Margem</th><th className="px-2 text-right">R$/garrafa</th><th className="px-2 text-right">Rendimento</th>
                      <th className="px-2 text-right">Desvio</th><th className="pl-2 text-right">Cobertura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {dados.produtos.map(p => {
                      const estadoLinha = rendimentoSaudavel(p.rendimento_pct, dados.config.perda_esperada_pct, dados.config.alerta_rendimento_pct);
                      const melhor = p.preco_garrafa != null && p.receita_por_garrafa != null && p.receita_por_garrafa > p.preco_garrafa;
                      return (
                        <tr key={p.produto_id} className="text-gray-800 dark:text-slate-200">
                          <td className="max-w-[220px] truncate py-2 pr-2 font-bold">{p.produto}</td>
                          <td className="px-2 text-right">{fmtNum(p.doses)}</td>
                          <td className="px-2 text-right">{fmtBRL(p.receita)}</td>
                          <td className="px-2 text-right">{fmtPct(p.margem_pct)}</td>
                          <td className="px-2 text-right" title={p.preco_garrafa != null ? `Garrafa fechada: ${fmtBRL(p.preco_garrafa)}` : undefined}>
                            {fmtBRL(p.receita_por_garrafa)}{melhor ? <span className="ml-1 text-emerald-600">▲</span> : null}
                          </td>
                          <td className={`px-2 text-right font-bold ${estadoLinha === 'baixo' ? 'text-red-600' : ''}`}>{p.rendimento_pct == null ? '—' : fmtPct(p.rendimento_pct)}</td>
                          <td className="px-2 text-right">{p.garrafas_encerradas ? `${fmtNum(p.desvio_ml)} ml` : '—'}</td>
                          <td className="pl-2 text-right">{p.cobertura_dias == null ? '—' : `${fmtNum(p.cobertura_dias, 1)} d${p.cobertura_doses != null ? ` · ${fmtNum(p.cobertura_doses)} doses` : ''}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">▲ = vendida em dose, a garrafa rende mais do que o preço dela fechada. Rendimento e desvio só existem para garrafas encerradas no período.</p>
            </Bloco>

            <div className="grid gap-4 lg:grid-cols-2">
              <Bloco titulo="Para onde foi o ml sem venda" subtitulo="Perda, cortesia, descarte e diferença ao encerrar a garrafa (entram no DRE)">
                {dados.perdas.por_tipo.length === 0 ? (
                  <p className="text-xs text-gray-500">Nenhuma perda registrada no período.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 text-sm dark:divide-slate-800">
                    {dados.perdas.por_tipo.map(t => (
                      <li key={t.tipo} className="flex items-center justify-between gap-2 py-2">
                        <span className="text-gray-700 dark:text-slate-300">{t.rotulo}</span>
                        <span className="text-right text-xs text-gray-500">{fmtNum(t.ml)} ml · <b className="text-gray-900 dark:text-white">{fmtBRL(t.custo)}</b></span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between py-2 font-black"><span>Total</span><span>{fmtBRL(dados.perdas.total)}</span></li>
                  </ul>
                )}
                {dados.por_funcionario.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-3 dark:border-slate-800">
                    <p className="mb-1 text-[11px] font-bold uppercase text-gray-500">Quem registrou</p>
                    <ul className="space-y-1 text-xs text-gray-700 dark:text-slate-300">
                      {dados.por_funcionario.slice(0, 6).map(f => (
                        <li key={f.funcionario} className="flex justify-between gap-2"><span className="truncate">{f.funcionario}</span><span>{fmtNum(f.ml)} ml · {fmtBRL(f.custo)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </Bloco>

              <Bloco titulo="Doses por hora" subtitulo="Horário em dia da loja (happy hour, pico de balcão)">
                {dados.pico_por_hora.length === 0 ? (
                  <p className="text-xs text-gray-500">Sem vendas de dose no período.</p>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dados.pico_por_hora}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="hora" tick={{ fontSize: 10 }} tickFormatter={h => `${h}h`} />
                        <YAxis tick={{ fontSize: 10 }} width={32} />
                        <Tooltip formatter={(v) => [fmtNum(Number(v), 1), 'Doses']} labelFormatter={h => `${h}h`} />
                        <Bar dataKey="doses" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Bloco>
            </div>

            {dados.abertas.itens.length > 0 && (
              <Bloco titulo="Garrafas abertas agora" subtitulo="As mais antigas primeiro">
                <ul className="divide-y divide-gray-100 text-sm dark:divide-slate-800">
                  {dados.abertas.itens.map(g => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <button type="button" onClick={() => navigate(`/products/${g.produto_id}`)} className="min-w-0 truncate text-left font-bold text-gray-900 hover:underline dark:text-white">{g.produto}</button>
                      <span className="text-xs text-gray-500">
                        {fmtNum(g.saldo_ml)} de {fmtNum(g.volume_inicial_ml)} ml · aberta há {g.dias_aberta} d · {fmtBRL(g.valor_custo)}
                        {g.vencida ? <b className="ml-1 text-red-600">vencida</b> : g.velha ? <b className="ml-1 text-amber-600">velha</b> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </Bloco>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default DosesTab;
