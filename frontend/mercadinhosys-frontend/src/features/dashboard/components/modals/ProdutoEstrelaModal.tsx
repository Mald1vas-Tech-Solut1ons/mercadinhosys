import React from 'react';
import { Star, DollarSign, Target, TrendingUp, AlertCircle } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import ResponsiveModal from '../../../../components/ui/ResponsiveModal';

interface ProdutoEstrelaData {
  id: number;
  nome: string;
  faturamento: number;
  quantidade_vendida: number;
  custo_unitario: number;
  margem: number;
}

interface ProdutoEstrelaModalProps {
  produto: ProdutoEstrelaData | null;
  periodoDias: number;
  isOpen: boolean;
  onClose: () => void;
}

export const ProdutoEstrelaModal: React.FC<ProdutoEstrelaModalProps> = ({
  produto,
  periodoDias,
  isOpen,
  onClose
}) => {
  if (!produto) return null;

  const precoVenda = produto.faturamento / produto.quantidade_vendida;
  const lucroTotal = produto.faturamento - (produto.custo_unitario * produto.quantidade_vendida);
  const lucroPorUnidade = precoVenda - produto.custo_unitario;
  const demandaDiaria = produto.quantidade_vendida / periodoDias;
  const estoqueRecomendado = Math.ceil(demandaDiaria * 15);
  const pontoReposicao = Math.ceil(demandaDiaria * 7);

  const handleCopyPlan = () => {
    const plano = `PLANO DE AÇÃO - ${produto.nome}\n\n` +
      `📊 MÉTRICAS:\n` +
      `• Preço: R$ ${precoVenda.toFixed(2)}\n` +
      `• Custo: R$ ${produto.custo_unitario.toFixed(2)}\n` +
      `• Margem: ${produto.margem.toFixed(1)}%\n` +
      `• Vendas: ${produto.quantidade_vendida} un\n\n` +
      `🎯 AÇÕES:\n` +
      `1. Manter estoque de ${estoqueRecomendado} unidades\n` +
      `2. Repor quando atingir ${pontoReposicao} unidades\n` +
      `3. Posicionar em local de destaque\n` +
      `4. Negociar desconto com fornecedor`;

    navigator.clipboard.writeText(plano);
    alert('Plano de ação copiado para área de transferência!');
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={produto.nome}
      subtitle="Produto Estrela - Alta Performance"
      headerIcon={<Star className="w-6 h-6 text-white" />}
      headerColor="indigo"
      size="xl"
      footer={
        <div className="flex gap-3 w-full">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Fechar
          </Button>
          <Button onClick={handleCopyPlan} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
            📄 Copiar Plano de Ação
          </Button>
        </div>
      }
    >
      <div className="space-y-8">
        {/* Métricas Principais (Executive Summary) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Preço Venda', val: `R$ ${precoVenda.toFixed(2)}`, icon: '💰', color: 'bg-green-50 text-green-700 border-green-100' },
            { label: 'Custo Unit.', val: `R$ ${produto.custo_unitario.toFixed(2)}`, icon: '📦', color: 'bg-blue-50 text-blue-700 border-blue-100' },
            { label: 'Margem', val: `${produto.margem.toFixed(1)}%`, icon: '📈', color: 'bg-purple-50 text-purple-700 border-purple-100' },
            { label: `Vendas (${periodoDias}d)`, val: `${produto.quantidade_vendida} un`, icon: '🎯', color: 'bg-orange-50 text-orange-700 border-orange-100' }
          ].map((item, i) => (
            <div key={i} className={`${item.color} rounded-2xl p-4 border shadow-sm transition-transform hover:scale-[1.02]`}>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-1">{item.icon} {item.label}</p>
              <p className="text-xl font-black tabular-nums">{item.val}</p>
            </div>
          ))}
        </div>

        {/* Análise Financeira */}
        <div className="bg-linear-to-br from-green-50/50 to-emerald-50/50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-2xl p-6 border border-green-100 dark:border-green-800/50 shadow-sm">
          <h3 className="font-black text-green-900 dark:text-green-300 mb-6 flex items-center gap-2 uppercase tracking-tighter text-lg">
            <DollarSign className="w-6 h-6" />
            Engenharia Financeira
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500 uppercase">Faturamento Bruto</p>
              <p className="text-2xl font-black text-green-600 dark:text-green-400">R$ {produto.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500 uppercase">Lucro Operacional</p>
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">R$ {lucroTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-500 uppercase">Unit Economics (Lucro)</p>
              <p className="text-2xl font-black text-purple-600 dark:text-purple-400">R$ {lucroPorUnidade.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        {/* Plano de Ação Estratégico */}
        <div className="space-y-6">
          <h3 className="font-black text-gray-900 dark:text-gray-100 flex items-center gap-2 text-lg uppercase tracking-tighter">
            <Target className="w-6 h-6 text-amber-500" />
            Roadmap de Escala
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800/50 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow">
              <p className="font-black text-indigo-600 dark:text-indigo-400 text-xs uppercase tracking-widest mb-4">1. Suply Chain & Estoque</p>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-gray-500">Giro Diário</span>
                  <span className="text-gray-900 dark:text-gray-100">{demandaDiaria.toFixed(1)} un/dia</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-gray-500">Audit. Recomendada</span>
                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-black">{estoqueRecomendado} un</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-gray-500">Safe-Stock (Gatilho)</span>
                  <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-[10px] font-black">{pontoReposicao} un</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800/50 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow">
              <p className="font-black text-green-600 dark:text-green-400 text-xs uppercase tracking-widest mb-4">2. Growth & Pricing</p>
              <ul className="space-y-3 text-sm font-medium text-gray-600 dark:text-gray-300">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Teste de elasticidade: +5% no preço
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Cross-selling com produtos Curva B
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Kits de volume (Leve 3 Pague 2.5)
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Projeções */}
        <div className="bg-indigo-50/50 dark:bg-indigo-900/10 rounded-2xl p-6 border border-indigo-100 dark:border-indigo-800 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp className="w-24 h-24" />
          </div>
          <h3 className="font-black text-indigo-900 dark:text-indigo-300 mb-6 flex items-center gap-2 uppercase tracking-tighter text-lg">
            <TrendingUp className="w-6 h-6" />
            Projeção Preditiva
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <p className="text-xs font-bold text-indigo-600/70 uppercase">Benchmark Atual ({periodoDias}d)</p>
              <p className="text-3xl font-black text-indigo-900 dark:text-indigo-100 tabular-nums">
                {produto.quantidade_vendida} <span className="text-sm font-bold opacity-60 uppercase">unidades</span>
              </p>
              <p className="text-sm font-medium text-indigo-700 dark:text-indigo-400">Faturamento Real: R$ {produto.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-emerald-600/70 uppercase">Cenário Otimista (+12%)</p>
              <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                {Math.ceil(produto.quantidade_vendida * 1.12)} <span className="text-sm font-bold opacity-60 uppercase">unidades</span>
              </p>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Potencial: R$ {(produto.faturamento * 1.12).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        {/* Alertas */}
        <div className="bg-amber-50/50 dark:bg-amber-900/10 rounded-2xl p-6 border border-amber-200 dark:border-amber-800">
          <h3 className="font-black text-amber-900 dark:text-amber-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-widest">
            <AlertCircle className="w-5 h-5" />
            Diretriz de Risco
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {[
              { t: 'Ruptura', d: 'Prioridade Zero - Faltar este item causa evasão de clientes.' },
              { t: 'Concorrência', d: 'Acompanhe semanalmente para manter o market-share.' },
              { t: 'Exposição', d: 'Mantenha na "Zona Quente" da loja (entrada ou caixa).' },
              { t: 'Qualidade', d: 'Alta rotatividade exige frescor e integridade total.' }
            ].map((alert, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-1.5 shrink-0"></div>
                <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                  <strong className="text-amber-900 dark:text-amber-400">{alert.t}:</strong> {alert.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ResponsiveModal>
  );
};
