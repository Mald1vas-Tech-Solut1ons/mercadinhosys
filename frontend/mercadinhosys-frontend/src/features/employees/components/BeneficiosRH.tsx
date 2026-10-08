import React, { useEffect, useState } from 'react';
import { Sparkles, Plus, Search, CheckCircle, Settings, Edit, Trash2 } from 'lucide-react';
import { showToast } from '../../../components/elements/Toast';
import beneficiosService, { Beneficio, FuncionarioSimples, BeneficioCatalogo } from '../beneficiosService';
import { formatCurrency } from '../../../utils/formatters';

export default function BeneficiosRH() {
  const [activeTab, setActiveTab] = useState<'atribuicoes' | 'catalogo'>('atribuicoes');
  
  // Data State
  const [beneficios, setBeneficios] = useState<Beneficio[]>([]);
  const [funcionarios, setFuncionarios] = useState<FuncionarioSimples[]>([]);
  const [catalogo, setCatalogo] = useState<BeneficioCatalogo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState('');

  // Modals
  const [showModalAtribuir, setShowModalAtribuir] = useState(false);
  const [showModalCatalogo, setShowModalCatalogo] = useState(false);

  // Form Atribuir
  const [funcId, setFuncId] = useState('');
  const [catIdSelecionado, setCatIdSelecionado] = useState('');
  const [valorMensal, setValorMensal] = useState('');
  const [obs, setObs] = useState('');

  // Form Catálogo
  const [catEdicaoId, setCatEdicaoId] = useState<number | null>(null);
  const [catNome, setCatNome] = useState('');
  const [catDescricao, setCatDescricao] = useState('');
  const [catValor, setCatValor] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [resBen, funcs, cat] = await Promise.all([
        beneficiosService.listarBeneficiosAtribuidos(),
        beneficiosService.listarFuncionariosParaBeneficio(),
        beneficiosService.listarCatalogo()
      ]);
      setBeneficios(resBen.data || []);
      setFuncionarios(funcs);
      setCatalogo(cat);
    } catch (err: any) {
      showToast.error(err.response?.data?.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // --- Handlers Atribuição ---
  const handleSelecionarCatalogo = (idStr: string) => {
    setCatIdSelecionado(idStr);
    const catItem = catalogo.find(c => c.id.toString() === idStr);
    if (catItem && catItem.valor_padrao) {
      setValorMensal(catItem.valor_padrao.toString());
    } else {
      setValorMensal('');
    }
  };

  const handleAtribuir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!funcId || !catIdSelecionado || !valorMensal) {
      showToast.error('Preencha os campos obrigatórios');
      return;
    }
    const catItem = catalogo.find(c => c.id.toString() === catIdSelecionado);
    try {
      await beneficiosService.atribuirBeneficio({
        funcionario_id: parseInt(funcId),
        beneficio_id: parseInt(catIdSelecionado),
        nome_beneficio: catItem?.nome, // fallback optional
        valor_mensal: parseFloat(valorMensal.replace(',', '.')),
        observacao: obs,
        data_inicio: new Date().toISOString().split('T')[0]
      });
      showToast.success('Benefício atribuído com sucesso!');
      setShowModalAtribuir(false);
      setFuncId(''); setCatIdSelecionado(''); setValorMensal(''); setObs('');
      loadAll();
    } catch (err: any) {
      showToast.error(err.response?.data?.message || 'Erro ao atribuir');
    }
  };

  // --- Handlers Catálogo ---
  const handleSalvarCatalogo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNome) {
      showToast.error('O nome do benefício é obrigatório');
      return;
    }
    try {
      const payload = {
        nome: catNome,
        descricao: catDescricao,
        valor_padrao: catValor ? parseFloat(catValor.replace(',', '.')) : 0
      };
      
      if (catEdicaoId) {
        await beneficiosService.editarBeneficioCatalogo(catEdicaoId, payload);
        showToast.success('Benefício atualizado!');
      } else {
        await beneficiosService.criarBeneficioCatalogo(payload);
        showToast.success('Benefício criado no catálogo!');
      }
      setShowModalCatalogo(false);
      setCatEdicaoId(null); setCatNome(''); setCatDescricao(''); setCatValor('');
      loadAll();
    } catch (err: any) {
      showToast.error(err.response?.data?.message || 'Erro ao salvar no catálogo');
    }
  };

  const handleExcluirCatalogo = async (id: number) => {
    if (!confirm('Deseja inativar este benefício do catálogo? Novas atribuições não poderão usá-lo.')) return;
    try {
      await beneficiosService.excluirBeneficioCatalogo(id);
      showToast.success('Benefício inativado');
      loadAll();
    } catch (err: any) {
      showToast.error('Erro ao inativar benefício');
    }
  };

  const openEdicaoCatalogo = (cat: BeneficioCatalogo) => {
    setCatEdicaoId(cat.id);
    setCatNome(cat.nome);
    setCatDescricao(cat.descricao || '');
    setCatValor(cat.valor_padrao ? cat.valor_padrao.toString() : '');
    setShowModalCatalogo(true);
  };

  // --- Render Helpers ---
  const beneficiosFiltrados = beneficios.filter(b => 
    b.funcionario_nome?.toLowerCase().includes(busca.toLowerCase()) ||
    b.nome_beneficio?.toLowerCase().includes(busca.toLowerCase())
  );
  const totalMensal = beneficios.reduce((acc, curr) => acc + (curr.ativo ? curr.valor_mensal : 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Gestão de Benefícios</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Administre o catálogo corporativo e atribua vales ou convênios.</p>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setActiveTab('atribuicoes')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-bold text-sm ${
              activeTab === 'atribuicoes'
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-300'
            }`}
          >
            Benefícios Atribuídos (Equipe)
          </button>
          <button
            onClick={() => setActiveTab('catalogo')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-bold text-sm flex items-center gap-2 ${
              activeTab === 'catalogo'
                ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-gray-300'
            }`}
          >
            <Settings className="w-4 h-4" /> Catálogo Corporativo
          </button>
        </nav>
      </div>

      {activeTab === 'atribuicoes' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Benefícios Ativos</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">{beneficios.filter(b => b.ativo).length}</p>
              </div>
              <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-xl">
                <CheckCircle className="w-6 h-6" />
              </div>
            </div>
            
            <div className="p-5 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Custo Mensal Ativo</p>
                <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{formatCurrency(totalMensal)}</p>
              </div>
              <div className="p-3 bg-purple-50 dark:bg-purple-500/10 text-purple-500 rounded-xl">
                <Sparkles className="w-6 h-6" />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button 
                onClick={() => setShowModalAtribuir(true)}
                className="inline-flex items-center gap-2 px-6 py-4 w-full justify-center bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/30 transition-all"
              >
                <Plus className="w-5 h-5" /> Atribuir Benefício
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <div className="relative max-w-md">
                <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="text" 
                  placeholder="Buscar funcionário ou benefício..." 
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold">
                  <tr>
                    <th className="px-6 py-4">Funcionário</th>
                    <th className="px-6 py-4">Benefício</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Data Início</th>
                    <th className="px-6 py-4 text-right">Valor Mensal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loading ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Carregando...</td></tr>
                  ) : beneficiosFiltrados.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Nenhuma atribuição encontrada.</td></tr>
                  ) : (
                    beneficiosFiltrados.map((ben) => (
                      <tr key={ben.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-bold text-gray-900 dark:text-white">{ben.funcionario_nome}</p>
                          <p className="text-xs text-gray-500">{ben.funcionario_cargo}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                              <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{ben.nome_beneficio}</p>
                              {ben.descricao && <p className="text-xs text-gray-500">{ben.descricao}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {ben.ativo ? (
                            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">ATIVO</span>
                          ) : (
                            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">INATIVO</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                          {new Date(ben.data_inicio).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="font-black text-gray-900 dark:text-white">{formatCurrency(ben.valor_mensal)}</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'catalogo' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex justify-between items-center bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 p-5 rounded-2xl">
            <div>
              <h3 className="font-bold text-purple-900 dark:text-purple-300">Catálogo de Opções da Empresa</h3>
              <p className="text-sm text-purple-700/70 dark:text-purple-400/70">Cadastre planos de saúde, gympass, parcerias locais e defina os valores de mercado para facilitar a atribuição.</p>
            </div>
            <button 
              onClick={() => { setCatEdicaoId(null); setCatNome(''); setCatDescricao(''); setCatValor(''); setShowModalCatalogo(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm shadow-md transition-all"
            >
              <Plus className="w-4 h-4" /> Novo Benefício
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalogo.length === 0 && !loading && (
              <div className="col-span-full py-12 text-center text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl border-dashed">
                O catálogo corporativo está vazio. Adicione o primeiro benefício.
              </div>
            )}
            {catalogo.map(cat => (
              <div key={cat.id} className="p-5 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm relative group transition-all hover:border-purple-300 dark:hover:border-purple-500/50">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                    <button onClick={() => openEdicaoCatalogo(cat)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleExcluirCatalogo(cat.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <h4 className="font-bold text-gray-900 dark:text-white text-lg leading-tight mb-1">{cat.nome}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 min-h-[32px] line-clamp-2">{cat.descricao || 'Sem descrição'}</p>
                
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Valor Referência</span>
                  <span className="font-black text-gray-900 dark:text-white">{cat.valor_padrao ? formatCurrency(cat.valor_padrao) : 'Variável'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL ATRIBUIR */}
      {showModalAtribuir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Atribuir Benefício</h3>
              <p className="text-sm text-gray-500 mt-1">Vincule um benefício do catálogo corporativo a um funcionário.</p>
            </div>
            
            <form onSubmit={handleAtribuir} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Funcionário *</label>
                <select 
                  value={funcId} 
                  onChange={(e) => setFuncId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">Selecione um colaborador</option>
                  {funcionarios.map(f => (
                    <option key={f.funcionario_id} value={f.funcionario_id}>{f.funcionario_nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Benefício do Catálogo *</label>
                <select 
                  value={catIdSelecionado} 
                  onChange={(e) => handleSelecionarCatalogo(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">Selecione um benefício</option>
                  {catalogo.map(c => (
                    <option key={c.id} value={c.id}>{c.nome} {c.valor_padrao ? `(${formatCurrency(c.valor_padrao)})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Valor Mensal (R$) *</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={valorMensal} 
                  onChange={(e) => setValorMensal(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
                <p className="text-[10px] text-gray-500 mt-1">Este valor é a parte custeada pela empresa que entrará no cálculo da folha.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Observação (opcional)</label>
                <input 
                  type="text" 
                  value={obs} 
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ex: Coparticipação 50%"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button type="button" onClick={() => setShowModalAtribuir(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold">Atribuir</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CATÁLOGO */}
      {showModalCatalogo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700">
            <div className="p-6 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-100 dark:border-purple-800/50">
              <h3 className="text-lg font-bold text-purple-900 dark:text-purple-300">
                {catEdicaoId ? 'Editar Benefício do Catálogo' : 'Novo Benefício Corporativo'}
              </h3>
              <p className="text-sm text-purple-700/70 dark:text-purple-400/70 mt-1">Configure parcerias, planos de saúde ou auxílios padrão da loja.</p>
            </div>
            
            <form onSubmit={handleSalvarCatalogo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Nome Oficial *</label>
                <input 
                  type="text" 
                  value={catNome} 
                  onChange={(e) => setCatNome(e.target.value)}
                  placeholder="Ex: Plano Odontológico SulAmérica"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Valor de Referência (R$)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={catValor} 
                  onChange={(e) => setCatValor(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-[10px] text-gray-500 mt-1">Valor sugerido ao atribuir (deixe zerado se for muito variável).</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Descrição Comercial</label>
                <textarea 
                  value={catDescricao} 
                  onChange={(e) => setCatDescricao(e.target.value)}
                  placeholder="Ex: Cobre emergências, desconto de R$ 5,00 em folha"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[80px]"
                />
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button type="button" onClick={() => setShowModalCatalogo(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold">Salvar no Catálogo</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
