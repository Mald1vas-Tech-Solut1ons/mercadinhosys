import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { showToast } from '../../utils/toast';
import { confirmar } from '../../components/ui/Confirmacao';

type Servico = {
  dataset: string;
  servico: string;
  mes: string;
  consultas: number;
  encontrados: number;
  limite: number;
  restantes: number;
  ativo: boolean;
  franquia_gratis: number;
  custo_estimado: number;
  custo_maximo_no_limite: number;
  configurado: boolean;
};

type HistoricoMes = {
  mes: string;
  servicos: Record<string, { consultas: number; encontrados: number; custo_estimado: number }>;
};

const COLUNAS: { dataset: string; titulo: string }[] = [
  { dataset: 'extra_info_data', titulo: 'Ficha técnica' },
  { dataset: 'current_pricing_data', titulo: 'Preço de mercado' },
  { dataset: 'images_data', titulo: 'Imagens' },
];

const brl = (valor: number) => `R$ ${valor.toFixed(2).replace('.', ',')}`;

const mesLabel = (mes: string) => {
  const partes = /^(\d{4})-(\d{2})/.exec(mes);
  return partes ? `${partes[2]}/${partes[1]}` : mes;
};

/** Super admin: consumo da BigDataCorp por serviço, pausa, limite do mês e histórico com cobrança. */
export default function ConsumoApisPanel() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [historico, setHistorico] = useState<HistoricoMes[]>([]);
  const [precoExcedente, setPrecoExcedente] = useState(0.06);
  const [franquiaGratis, setFranquiaGratis] = useState(500);
  const [limites, setLimites] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await apiClient.get('/super-admin/consumo-apis?meses=6');
      setServicos(data?.data ?? []);
      setHistorico(data?.historico ?? []);
      setPrecoExcedente(data?.preco_excedente ?? 0.06);
      setFranquiaGratis(data?.franquia_gratis ?? 500);
    } catch {
      setErro('Não foi possível carregar o consumo das APIs.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alternarAtivo = async (servico: Servico) => {
    setSalvando(servico.dataset);
    try {
      const { data } = await apiClient.put(`/super-admin/consumo-apis/${servico.dataset}`, { ativo: !servico.ativo });
      setServicos(data?.data ?? servicos);
      showToast.success(servico.ativo ? 'Serviço pausado: nenhuma consulta nova até retomar.' : 'Serviço retomado.');
    } catch {
      showToast.error('Não foi possível alterar o status do serviço.');
    } finally {
      setSalvando(null);
    }
  };

  const salvarLimite = async (servico: Servico) => {
    const novo = Number(limites[servico.dataset] ?? servico.limite);
    if (!Number.isFinite(novo) || novo < 0) {
      showToast.error('Informe um limite válido.');
      return;
    }
    let confirmarCobranca = false;
    if (novo > franquiaGratis) {
      const maximo = (novo - franquiaGratis) * precoExcedente;
      const ok = await confirmar({
        titulo: 'Liberar acima da franquia?',
        mensagem: `Acima de ${franquiaGratis} a BigDataCorp cobra ${brl(precoExcedente)} por consulta. Com limite de ${novo}, a cobrança pode chegar a ${brl(maximo)} neste serviço.`,
        acao: 'Liberar e assumir a cobrança',
        perigo: true,
      });
      if (!ok) return;
      confirmarCobranca = true;
    }
    setSalvando(servico.dataset);
    try {
      const corpo: { limite_mensal: number; confirmar_cobranca?: boolean } = { limite_mensal: novo };
      if (confirmarCobranca) corpo.confirmar_cobranca = true;
      const { data } = await apiClient.put(`/super-admin/consumo-apis/${servico.dataset}`, corpo);
      setServicos(data?.data ?? servicos);
      showToast.success('Limite atualizado.');
    } catch (err) {
      const mensagem = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Não foi possível salvar o limite.';
      showToast.error(mensagem);
    } finally {
      setSalvando(null);
    }
  };

  const naoConfigurado = servicos.some(s => !s.configurado);

  return (
    <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-gray-800 dark:text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Consumo da BigDataCorp</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {franquiaGratis} consultas grátis por serviço a cada mês. Acima disso a BigDataCorp cobra {brl(precoExcedente)} por consulta no boleto.
          </p>
        </div>
        <button type="button" onClick={carregar} disabled={carregando}
          className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
          Atualizar
        </button>
      </div>

      {naoConfigurado && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Credenciais da BigDataCorp não configuradas no servidor
        </div>
      )}
      {carregando && <p className="text-sm text-slate-600 dark:text-slate-400">Carregando...</p>}
      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {!carregando && !erro && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {servicos.map(servico => {
              const pct = Math.min(100, servico.limite > 0 ? (servico.consultas / servico.limite) * 100 : 100);
              const cor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
              const ocupado = salvando === servico.dataset;
              return (
                <div key={servico.dataset} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium">{servico.servico}</h3>
                    <span className={servico.ativo
                      ? 'whitespace-nowrap rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'whitespace-nowrap rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300'}>
                      {servico.ativo ? 'Ligado' : 'Pausado'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{servico.consultas} de {servico.limite} consultas</p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                    <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{servico.encontrados} encontrados · {servico.restantes} restantes</p>
                  {servico.custo_estimado > 0 && (
                    <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">Cobrança estimada no mês: {brl(servico.custo_estimado)}</p>
                  )}
                  <button type="button" onClick={() => alternarAtivo(servico)} disabled={ocupado}
                    className="mt-3 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    {servico.ativo ? 'Pausar' : 'Retomar'}
                  </button>
                  <div className="mt-3 flex gap-2">
                    <input type="number" min={0} aria-label="Limite do mês"
                      value={limites[servico.dataset] ?? String(servico.limite)}
                      onChange={e => setLimites(ant => ({ ...ant, [servico.dataset]: e.target.value }))}
                      className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    <button type="button" onClick={() => salvarLimite(servico)} disabled={ocupado}
                      className="min-h-[44px] whitespace-nowrap rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
                      Salvar limite
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <h3 className="mb-2 text-lg font-semibold">Histórico</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {['Mês', ...COLUNAS.map(c => c.titulo), 'Cobrança estimada'].map(titulo => (
                      <th key={titulo} className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-300">{titulo}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historico.map(mes => {
                    const total = Object.values(mes.servicos ?? {}).reduce((soma, item) => soma + (item?.custo_estimado ?? 0), 0);
                    return (
                      <tr key={mes.mes} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="whitespace-nowrap px-3 py-2">{mesLabel(mes.mes)}</td>
                        {COLUNAS.map(c => (
                          <td key={c.dataset} className="whitespace-nowrap px-3 py-2">{mes.servicos?.[c.dataset]?.consultas ?? '—'}</td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2">{total > 0 ? brl(total) : '—'}</td>
                      </tr>
                    );
                  })}
                  {historico.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-600 dark:text-slate-400">Sem histórico.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
