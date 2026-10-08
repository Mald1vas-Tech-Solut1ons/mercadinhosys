import React, { useState, useEffect } from 'react';
import { Package, Truck, Clock, CheckCircle, MapPin, Phone, Download, Search, Filter } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import toast from 'react-hot-toast';

interface Entrega {
  id: string;
  numero_pedido: string;
  data_pedido: string;
  data_entrega: string;
  status: 'pendente' | 'em_separacao' | 'em_transporte' | 'entregue' | 'cancelado';
  cliente: {
    nome: string;
    cpf?: string;
    cnpj?: string;
    documento?: string;
    telefone: string;
    endereco: string;
  };
  produtos: Array<{
    nome: string;
    quantidade: number;
    valor: number;
  }>;
  valor_total: number;
  transportadora?: string;
  codigo_rastreio?: string;
  observacoes?: string;
}

const EntregasPage: React.FC = () => {
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<string>('todos');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    carregarEntregas();
  }, [paginaAtual, statusFiltro]);

  const carregarEntregas = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams({
        pagina: paginaAtual.toString(),
        status: statusFiltro,
        busca: busca
      });

      const response = await apiClient.get(`/api/entregas?${params}`);

      if (response.data?.success) {
        setEntregas(response.data.entregas);
        setTotalPaginas(response.data.total_paginas || 1);
        toast.success('Entregador disponível para novas entregas');
      } else {
        toast.error('Erro ao carregar entregas');
      }
    } catch (error) {
      console.error('Erro ao carregar entregas:', error);
      toast.error('Erro ao carregar entregas');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pendente': return 'bg-yellow-100 text-yellow-800';
      case 'em_separacao': return 'bg-blue-100 text-blue-800';
      case 'em_transporte': return 'bg-purple-100 text-purple-800';
      case 'entregue': return 'bg-green-100 text-green-800';
      case 'cancelado': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pendente': return <Clock className="w-4 h-4" />;
      case 'em_separacao': return <Package className="w-4 h-4" />;
      case 'em_transporte': return <Truck className="w-4 h-4" />;
      case 'entregue': return <CheckCircle className="w-4 h-4" />;
      case 'cancelado': return <Clock className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pendente': return 'Pendente';
      case 'em_separacao': return 'Em Separação';
      case 'em_transporte': return 'Em Transporte';
      case 'entregue': return 'Entregue';
      case 'cancelado': return 'Cancelado';
      default: return status;
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPaginaAtual(1);
    carregarEntregas();
  };

  const formatarData = (dataString: string) => {
    return new Date(dataString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(valor);
  };

  const entregasFiltradas = entregas.filter(entrega => {
    const matchBusca = !busca ||
      entrega.numero_pedido.toLowerCase().includes(busca.toLowerCase()) ||
      entrega.cliente.nome.toLowerCase().includes(busca.toLowerCase()) ||
      (entrega.cliente.documento || entrega.cliente.cpf || entrega.cliente.cnpj || '').includes(busca);

    const matchStatus = statusFiltro === 'todos' || entrega.status === statusFiltro;

    return matchBusca && matchStatus;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Truck className="w-8 h-8 text-blue-600 mr-3" />
                Minhas Entregas
              </h1>
              <p className="text-gray-600 mt-2">
                Acompanhe o status de todas as suas entregas
              </p>
            </div>

            <div className="flex items-center space-x-4">
              {/* Filtros */}
              <div className="flex items-center space-x-2">
                <Filter className="w-5 h-5 text-gray-400" />
                <select
                  value={statusFiltro}
                  onChange={(e) => {
                    setStatusFiltro(e.target.value);
                    setPaginaAtual(1);
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="todos">Todos</option>
                  <option value="pendente">Pendente</option>
                  <option value="em_separacao">Em Separação</option>
                  <option value="em_transporte">Em Transporte</option>
                  <option value="entregue">Entregue</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>

              {/* Busca */}
              <form onSubmit={handleSearch} className="flex items-center">
                <div className="relative">
                  <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por pedido ou cliente..."
                    className="pl-10 pr-4 border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="ml-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Buscar
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Lista de Entregas */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : entregasFiltradas.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma entrega encontrada</h3>
              <p className="text-gray-600">
                {busca ? 'Nenhuma entrega encontrada para esta busca.' : 'Nenhuma entrega encontrada.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pedido
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cliente
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Produtos
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Valor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entregasFiltradas.map((entrega) => (
                    <tr key={entrega.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          #{entrega.numero_pedido}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatarData(entrega.data_pedido)}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            {entrega.cliente.nome}
                          </div>
                          <div className="text-xs text-gray-500">
                            {entrega.cliente.cnpj ? 'CNPJ' : 'CPF'}: {entrega.cliente.documento || entrega.cliente.cpf || entrega.cliente.cnpj || '-'}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center">
                            <Phone className="w-3 h-3 mr-1" />
                            {entrega.cliente.telefone}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center">
                            <MapPin className="w-3 h-3 mr-1" />
                            {entrega.cliente.endereco}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {entrega.produtos.slice(0, 2).map((produto, index) => (
                            <div key={index}>
                              {produto.quantidade}x {produto.nome}
                            </div>
                          ))}
                          {entrega.produtos.length > 2 && (
                            <div className="text-xs text-gray-500">
                              +{entrega.produtos.length - 2} itens
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatarMoeda(entrega.valor_total)}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(entrega.status)}`}>
                          {getStatusIcon(entrega.status)}
                          <span className="ml-2">{getStatusText(entrega.status)}</span>
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => {
                            // Em produção abriria modal com detalhes
                            toast.success(`Detalhes do pedido ${entrega.numero_pedido}`);
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Ver Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Paginação */}
        {!loading && totalPaginas > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Mostrando página {paginaAtual} de {totalPaginas}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPaginaAtual(paginaAtual - 1)}
                disabled={paginaAtual === 1}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <button
                onClick={() => setPaginaAtual(paginaAtual + 1)}
                disabled={paginaAtual === totalPaginas}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Próximo
              </button>
            </div>
          </div>
        )}

        {/* Botão de Download de Relatório */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              // Em produção geraria e baixaria PDF/Excel
              toast.success('Relatório de entregas sendo gerado...');
            }}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-5 h-5 mr-2" />
            Baixar Relatório de Entregas
          </button>
        </div>
      </div>
    </div>
  );
};

export default EntregasPage;
