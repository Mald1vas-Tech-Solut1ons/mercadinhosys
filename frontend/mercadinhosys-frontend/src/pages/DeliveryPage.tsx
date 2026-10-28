import React, { useState, useEffect } from 'react';
import { Truck, Package, Clock, CheckCircle, MapPin, Phone } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import toast from 'react-hot-toast';

interface Delivery {
    id: string;
    numero_pedido: string;
    cliente: {
        nome: string;
        telefone: string;
        endereco: string;
    };
    produtos: Array<{
        nome: string;
        quantidade: number;
    }>;
    status: 'pendente' | 'em_preparacao' | 'em_entrega' | 'entregue' | 'cancelado';
    data_pedido: string;
    data_entrega: string;
    valor_total: number;
    entregador: string;
    observacoes: string;
}

const DeliveryPage: React.FC = () => {
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtro, setFiltro] = useState('');
    const [statusFiltro, setStatusFiltro] = useState<string>('todos');

    useEffect(() => {
        carregarDeliveries();
    }, [statusFiltro]);

    const carregarDeliveries = async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams({
                status: statusFiltro,
                busca: filtro
            });

            const response = await apiClient.get(`/deliveries?${params}`);
            if (response.data?.success) {
                setDeliveries(response.data.deliveries);
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
            case 'em_preparacao': return 'bg-blue-100 text-blue-800';
            case 'em_entrega': return 'bg-purple-100 text-purple-800';
            case 'entregue': return 'bg-green-100 text-green-800';
            case 'cancelado': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100';
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'pendente': return 'Pendente';
            case 'em_preparacao': return 'Em Preparação';
            case 'em_entrega': return 'Em Entrega';
            case 'entregue': return 'Entregue';
            case 'cancelado': return 'Cancelado';
            default: return status;
        }
    };

    const formatarData = (dataString: string) => {
        return new Date(dataString).toLocaleDateString('pt-BR');
    };

    const formatarMoeda = (valor: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor);
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-900">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 flex items-center dark:text-gray-100">
                                <Truck className="w-8 h-8 text-blue-600 mr-3" />
                                Sistema de Entregas
                            </h1>
                            <p className="text-gray-600 mt-2 dark:text-gray-300">
                                Gerencie todas as entregas
                            </p>
                        </div>

                        {/* Filtros */}
                        <div className="flex items-center space-x-4">
                            <input
                                type="text"
                                value={filtro}
                                onChange={(e) => setFiltro(e.target.value)}
                                placeholder="Buscar entregas..."
                                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700"
                            />

                            <select
                                value={statusFiltro}
                                onChange={(e) => setStatusFiltro(e.target.value)}
                                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700"
                            >
                                <option value="todos">Todos</option>
                                <option value="pendente">Pendente</option>
                                <option value="em_preparacao">Em Preparação</option>
                                <option value="em_entrega">Em Entrega</option>
                                <option value="entregue">Entregue</option>
                                <option value="cancelado">Cancelado</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Lista de Entregas */}
                <div className="bg-white rounded-lg shadow-sm overflow-hidden dark:bg-gray-800">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : deliveries.length === 0 ? (
                        <div className="text-center py-12">
                            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-gray-100">Nenhuma entrega encontrada</h3>
                            <p className="text-gray-600 dark:text-gray-300">
                                {filtro ? 'Nenhuma entrega encontrada para esta busca.' : 'Nenhuma entrega encontrada.'}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Pedido</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Cliente</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Status</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Data Entrega</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Valor</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800">
                                    {deliveries.map((delivery) => (
                                        <tr key={delivery.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    #{delivery.numero_pedido}
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                    {formatarData(delivery.data_pedido)}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4">
                                                <div className="text-sm">
                                                    <div className="font-medium text-gray-900 dark:text-gray-100">
                                                        {delivery.cliente.nome}
                                                    </div>
                                                    <div className="text-xs text-gray-500 flex items-center dark:text-gray-400">
                                                        <Phone className="w-3 h-3 mr-1" />
                                                        {delivery.cliente.telefone}
                                                    </div>
                                                    <div className="text-xs text-gray-500 flex items-center dark:text-gray-400">
                                                        <MapPin className="w-3 h-3 mr-1" />
                                                        {delivery.cliente.endereco}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(delivery.status)}`}>
                                                    {getStatusText(delivery.status)}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900 dark:text-gray-100">
                                                    {formatarData(delivery.data_entrega)}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {formatarMoeda(delivery.valor_total)}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                <button
                                                    onClick={() => {
                                                        // Em produção abriria modal com detalhes
                                                        toast.success(`Detalhes do pedido ${delivery.numero_pedido}`);
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

                {/* Estatísticas */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                        <div className="flex items-center">
                            <Package className="w-8 h-8 text-blue-600 mr-3" />
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Pendentes</h3>
                                <p className="text-3xl font-bold text-blue-600">
                                    {deliveries.filter(d => d.status === 'pendente').length}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                        <div className="flex items-center">
                            <Clock className="w-8 h-8 text-yellow-600 mr-3" />
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Em Preparação</h3>
                                <p className="text-3xl font-bold text-yellow-600">
                                    {deliveries.filter(d => d.status === 'em_preparacao').length}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                        <div className="flex items-center">
                            <Truck className="w-8 h-8 text-purple-600 mr-3" />
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Em Entrega</h3>
                                <p className="text-3xl font-bold text-purple-600">
                                    {deliveries.filter(d => d.status === 'em_entrega').length}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-gray-800">
                        <div className="flex items-center">
                            <CheckCircle className="w-8 h-8 text-green-600 mr-3" />
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Entregues</h3>
                                <p className="text-3xl font-bold text-green-600">
                                    {deliveries.filter(d => d.status === 'entregue').length}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DeliveryPage;
