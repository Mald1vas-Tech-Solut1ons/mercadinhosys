import { ProtectedDocumentLink } from '@/components/common/ProtectedDocumentLink';
import { useState } from 'react';
import { Users, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../../../../utils/formatters';
import DetailsModal from '../DetailsModal';

interface RHTabProps {
  data: any;
  onRefresh?: () => void;
}

export default function RHTab({ data, onRefresh }: RHTabProps) {
  const [loadingApprove, setLoadingApprove] = useState<number | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<any | null>(null);
  
  const handleApprove = async (id: number) => {
    try {
      setLoadingApprove(id);
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:5000/api/rh/justificativas/${id}/responder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'aprovado' })
      });
      if (res.ok) {
        if (onRefresh) onRefresh();
      } else {
        alert('Falha ao aprovar justificativa.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao aprovar justificativa.');
    } finally {
      setLoadingApprove(null);
    }
  };
  const rh = data?.rh || {};
  // O backend (cientifico) entrega custo_folha_estimado, benefits_breakdown[] e
  // O backend (cientifico) entrega custo_folha_estimado (agora 100% preciso, incluindo benefícios).
  const custoTotal = rh?.custo_folha_estimado ?? rh?.total_salarios ?? 0;
  const totalBeneficios = Array.isArray(rh?.benefits_breakdown)
    ? rh.benefits_breakdown.reduce((a: number, b: any) => a + (b?.value || 0), 0)
    : (rh?.total_beneficios_mensal ?? 0);
  const funcionariosAtivos = rh?.funcionarios_ativos || 0;
  const totalAtrasosMin = Array.isArray(rh?.atrasos_por_funcionario_mes)
    ? rh.atrasos_por_funcionario_mes.reduce((a: number, b: any) => a + (b?.minutos_atraso || 0), 0)
    : (rh?.resumo_mes?.total_atrasos_minutos ?? 0);
  const totalFaltas = Array.isArray(rh?.faltas_por_funcionario_mes)
    ? rh.faltas_por_funcionario_mes.reduce((a: number, b: any) => a + (b?.faltas || 0), 0)
    : (rh?.resumo_mes?.total_faltas ?? 0);

  return (
    <div className="space-y-8">
      {/* Resumo RH */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-blue-500/20 rounded-lg"><Users className="text-blue-400" /></div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold">Colaboradores</h3>
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">{funcionariosAtivos}</div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 font-medium">Ativos no sistema</p>
        </div>
        
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-purple-500/20 rounded-lg"><CheckCircle className="text-purple-400" /></div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold">Custo de Folha</h3>
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">{formatCurrency(custoTotal)}</div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 font-medium">Custo Real (Folha + Benefícios)</p>
        </div>

        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-purple-500/20 rounded-lg"><CheckCircle className="text-purple-400" /></div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold">Benefícios</h3>
          </div>
          <div className="text-3xl font-black text-purple-400">{formatCurrency(totalBeneficios)}</div>
          <p className="text-sm text-purple-500/70 mt-2 font-medium">Total de Vales Ativos</p>
        </div>

        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-orange-500/20 rounded-lg"><Clock className="text-orange-400" /></div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold">Atrasos (Mês)</h3>
          </div>
          <div className="text-3xl font-black text-orange-400">{totalAtrasosMin || 0} min</div>
          <p className="text-sm text-orange-500/70 mt-2 font-medium">Total de atrasos somados</p>
        </div>
        
        <div className="bg-white dark:bg-slate-800/60 rounded-2xl p-6 border border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-red-500/20 rounded-lg"><AlertTriangle className="text-red-400" /></div>
             <h3 className="text-gray-600 dark:text-slate-300 font-bold">Faltas (Mês)</h3>
          </div>
          <div className="text-3xl font-black text-red-400">{totalFaltas || 0}</div>
          <p className="text-sm text-red-500/70 mt-2 font-medium">Dias de falta registrados</p>
        </div>
      </div>
      
      {/* Listas Dinâmicas de RH */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Justificativas Pendentes */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden col-span-1 lg:col-span-2">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 flex justify-between items-center">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <AlertTriangle className="text-amber-400" /> Atestados & Justificativas Pendentes
             </h2>
          </div>
          <div className="p-0">
            {(!rh?.justificativas_pendentes || rh.justificativas_pendentes.length === 0) ? (
              <p className="p-8 text-center text-gray-400 dark:text-slate-500">
                Nenhuma justificativa pendente de aprovação no momento.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 text-sm">
                      <th className="p-4 font-semibold">Funcionário</th>
                      <th className="p-4 font-semibold">Tipo</th>
                      <th className="p-4 font-semibold">Motivo</th>
                      <th className="p-4 font-semibold">Data da Falta</th>
                      <th className="p-4 font-semibold text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {rh.justificativas_pendentes.map((just: any, idx: number) => (
                      <tr key={idx} className="border-b border-gray-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-4 font-bold text-gray-900 dark:text-white">{just.funcionario_nome}</td>
                        <td className="p-4">
                          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 uppercase tracking-wide">
                            {just.tipo}
                          </span>
                        </td>
                        <td className="p-4 text-gray-600 dark:text-slate-300 max-w-xs truncate" title={just.motivo}>{just.motivo}</td>
                        <td className="p-4 text-gray-500 dark:text-slate-400">{new Date(just.data).toLocaleDateString('pt-BR')}</td>
                        <td className="p-4 text-center flex items-center justify-center gap-2">
                          {just.documento_url && (
                            <ProtectedDocumentLink url={just.documento_url}
                              className="px-3 py-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 rounded-md transition-colors font-semibold text-xs"
                            >
                              Ver Documento
                            </ProtectedDocumentLink>
                          )}
                          <button 
                            onClick={() => handleApprove(just.id)}
                            disabled={loadingApprove === just.id}
                            className="px-3 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40 rounded-md transition-colors font-semibold text-xs disabled:opacity-50"
                          >
                            {loadingApprove === just.id ? 'Aprovando...' : 'Aprovar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Espelho de Pagamento */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden col-span-1 lg:col-span-2">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 flex justify-between items-center">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <CheckCircle className="text-purple-400" /> Espelho de Pagamento Estimado
             </h2>
             <button className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white rounded-lg text-sm transition-colors">
               Exportar PDF
             </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 text-sm">
                  <th className="p-4 font-semibold">Funcionário</th>
                  <th className="p-4 font-semibold">Salário Base</th>
                  <th className="p-4 font-semibold">Horas Extras</th>
                  <th className="p-4 font-semibold">Atrasos/Faltas</th>
                  <th className="p-4 font-semibold text-right">Líquido Estimado</th>
                  <th className="p-4 font-semibold text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {(rh?.espelho_pagamento_mes || []).slice(0, 5).map((emp: any, idx: number) => (
                  <tr key={idx} className="border-b border-gray-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4">
                      <p className="font-bold text-gray-900 dark:text-white">{emp.nome}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{emp.cargo}</p>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-slate-300">{formatCurrency(emp.salario_base || 0)}</td>
                    <td className="p-4">
                      <p className="text-emerald-400 font-medium">{formatCurrency(emp.custo_horas_extras || 0)}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500">{emp.horas_extras_horas}h extras</p>
                    </td>
                    <td className="p-4 text-rose-400 font-medium">
                      {emp.atrasos_minutos > 0 && <span>{emp.atrasos_minutos} min </span>}
                      {emp.faltas > 0 && <span>({emp.faltas} faltas)</span>}
                      {emp.atrasos_minutos === 0 && emp.faltas === 0 && <span className="text-gray-400 dark:text-slate-500">-</span>}
                    </td>
                    <td className="p-4 text-right font-black text-gray-900 dark:text-white">{formatCurrency(emp.total_estimado || 0)}</td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => setSelectedDetails({ type: 'pagamento', data: emp })}
                        className="px-3 py-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 rounded-md transition-colors font-semibold"
                      >
                        Ver Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
                {(!rh?.espelho_pagamento_mes || rh.espelho_pagamento_mes.length === 0) && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400 dark:text-slate-500">
                      Nenhum dado de pagamento encontrado para o período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Atrasos */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <Clock className="text-orange-400" /> Alertas de Atrasos
             </h2>
          </div>
          <div className="p-4 space-y-3 h-64 overflow-y-auto hide-scrollbar">
            {(rh?.atrasos_por_funcionario_mes || []).slice(0, 10).map((emp: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700/50 hover:border-orange-500/30 transition-colors group">
                <div>
                  <p className="font-bold text-gray-700 dark:text-slate-200 group-hover:text-gray-900 dark:text-white">{emp.nome}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{emp.cargo}</p>
                </div>
                <div className="text-right flex items-center gap-4">
                  <div>
                    <p className="text-orange-400 font-bold">{emp.minutos_atraso} min</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{emp.atrasos_qtd} ocorrências</p>
                  </div>
                  <button className="p-2 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-600 dark:text-slate-300 transition-colors">
                    <AlertTriangle size={16} />
                  </button>
                </div>
              </div>
            ))}
            {(!rh?.atrasos_por_funcionario_mes || rh.atrasos_por_funcionario_mes.length === 0) && (
              <p className="text-gray-400 dark:text-slate-500 text-center pt-10">Nenhum atraso registrado.</p>
            )}
          </div>
        </div>

        {/* Top Horas Extras */}
        <div className="bg-white dark:bg-slate-800/60 rounded-3xl border border-gray-200 dark:border-slate-700/60 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/80">
             <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <Clock className="text-emerald-400" /> Monitoramento de Horas Extras
             </h2>
          </div>
          <div className="p-4 space-y-3 h-64 overflow-y-auto hide-scrollbar">
            {(rh?.horas_extras_por_funcionario_mes || []).slice(0, 10).map((emp: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-slate-900/40 rounded-xl border border-gray-200 dark:border-slate-700/50 hover:border-emerald-500/30 transition-colors group">
                <div>
                  <p className="font-bold text-gray-700 dark:text-slate-200 group-hover:text-gray-900 dark:text-white">{emp.nome}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{emp.cargo}</p>
                </div>
                <div className="text-right flex items-center gap-4">
                  <div>
                    <p className="text-emerald-400 font-bold">{(emp.minutos_extras / 60).toFixed(1)}h</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{formatCurrency(emp.custo_extras)} (est.)</p>
                  </div>
                  <button 
                    onClick={() => setSelectedDetails({ type: 'hora_extra', data: emp })}
                    className="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 rounded-lg text-xs font-bold transition-colors"
                  >
                    Ver
                  </button>
                </div>
              </div>
            ))}
            {(!rh?.horas_extras_por_funcionario_mes || rh.horas_extras_por_funcionario_mes.length === 0) && (
              <p className="text-gray-400 dark:text-slate-500 text-center pt-10">Nenhuma hora extra registrada.</p>
            )}
          </div>
        </div>

      </div>

      {/* MODAL UNIFICADO */}
      <DetailsModal 
        isOpen={!!selectedDetails} 
        onClose={() => setSelectedDetails(null)} 
        title={
          selectedDetails?.type === 'pagamento' ? `Holerite Estimado: ${selectedDetails?.data?.nome}` :
          selectedDetails?.type === 'hora_extra' ? `Horas Extras: ${selectedDetails?.data?.nome}` :
          'Detalhes'
        }
      >
        {selectedDetails?.type === 'pagamento' && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700/50">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 dark:text-slate-400">Salário Base</span>
                <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(selectedDetails.data.salario_base || 0)}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 dark:text-slate-400">Benefícios</span>
                <span className="font-bold text-emerald-400">+{formatCurrency(selectedDetails.data.beneficios || 0)}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 dark:text-slate-400">Horas Extras ({selectedDetails.data.horas_extras_horas}h)</span>
                <span className="font-bold text-emerald-400">+{formatCurrency(selectedDetails.data.custo_horas_extras || 0)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-slate-700/50">
                <span className="text-gray-500 dark:text-slate-400">Faltas Injustificadas ({selectedDetails.data.faltas} dias)</span>
                <span className="font-bold text-rose-400">-{formatCurrency(selectedDetails.data.desconto_faltas || 0)}</span>
              </div>
            </div>
            <div className="bg-blue-500/10 p-4 rounded-xl border border-blue-500/20 flex justify-between items-center">
              <span className="text-blue-400 font-bold">Total Líquido Estimado</span>
              <span className="font-black text-2xl text-blue-400">{formatCurrency(selectedDetails.data.total_estimado || 0)}</span>
            </div>
          </div>
        )}
        {selectedDetails?.type === 'hora_extra' && (
          <div className="space-y-4 text-center p-6 text-gray-600 dark:text-slate-300">
            <p><strong>{selectedDetails.data.nome}</strong> acumulou <strong>{(selectedDetails.data.minutos_extras / 60).toFixed(1)}h</strong> de horas extras neste mês.</p>
            <p className="text-sm">O custo estimado projetado no holerite é de {formatCurrency(selectedDetails.data.custo_extras)}.</p>
          </div>
        )}
      </DetailsModal>
    </div>
  );
}
