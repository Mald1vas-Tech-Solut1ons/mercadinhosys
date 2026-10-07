import React, { useState, useEffect } from 'react';
import { User, UserPlus, X } from 'lucide-react';
import { Cliente } from '../../../types';
import { pdvService } from '../pdvService';

interface ClienteSelectProps {
    cliente: Cliente | null;
    onClienteSelecionado: (cliente: Cliente | null) => void;
}

const ClienteSelect: React.FC<ClienteSelectProps> = ({ cliente, onClienteSelecionado }) => {
    const [query, setQuery] = useState('');
    const [resultados, setResultados] = useState<Cliente[]>([]);
    const [loading, setLoading] = useState(false);
    const [mostrarBusca, setMostrarBusca] = useState(false);

    useEffect(() => {
        const buscarClientes = async () => {
            if (!query.trim() || query.trim().length < 2) {
                setResultados([]);
                return;
            }

            setLoading(true);
            try {
                const clientes = await pdvService.buscarClientes(query);
                console.log('👥 Clientes encontrados:', clientes.length, clientes);

                if (Array.isArray(clientes)) {
                    setResultados(clientes.slice(0, 10));
                } else {
                    console.error('❌ Resposta inválida da API de clientes:', clientes);
                    setResultados([]);
                }
            } catch (error: any) {
                console.error('❌ Erro ao buscar clientes:', error);

                // Não mostrar erro se for problema de rede (servidor offline)
                if (error.code !== 'ERR_NETWORK') {
                    console.warn('Busca de clientes indisponível:', error.message);
                }

                setResultados([]);
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(buscarClientes, 200);
        return () => clearTimeout(debounce);
    }, [query]);

    const handleClienteClick = (cliente: Cliente) => {
        onClienteSelecionado(cliente);
        setMostrarBusca(false);
        setQuery('');
        setResultados([]);
    };

    const handleRemoverCliente = () => {
        onClienteSelecionado(null);
    };

    return (
        <div className="relative">
            {cliente ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                                <User className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800 dark:text-white">
                                    {cliente.nome}
                                </h4>
                                <div className="flex items-center space-x-2 mt-1">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        CPF: {cliente.cpf || 'N/A'} • Total Gasto: R$ {(cliente.valor_total_gasto || 0).toFixed(2)}
                                    </p>
                                    {cliente.saldo_devedor && cliente.saldo_devedor > 0 ? (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] font-bold rounded-full">
                                            FIADO: R$ {cliente.saldo_devedor.toFixed(2)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={handleRemoverCliente}
                            className="p-2 text-gray-500 hover:text-red-500"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setMostrarBusca(true)}
                    id="cliente-select-open"
                    className="w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
                >
                    <div className="flex flex-col items-center justify-center">
                        <UserPlus className="w-8 h-8 text-gray-400 mb-2" />
                        <span className="text-gray-600 dark:text-gray-400">Adicionar cliente</span>
                    </div>
                </button>
            )}

            {mostrarBusca && !cliente && (
                <div className="absolute z-110 w-[calc(100%+2rem)] -left-4 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                        <div className="relative">
                            <input
                                id="cliente-search-input"
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Buscar cliente por nome, CPF ou telefone..."
                                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                autoFocus
                            />
                            {loading && (
                                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                        {resultados.length > 0 ? (
                            resultados.map((cliente) => (
                                <div
                                    key={cliente.id}
                                    onClick={() => handleClienteClick(cliente)}
                                    className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer border-b border-slate-50 dark:border-slate-800/50 last:border-b-0 transition-colors"
                                >
                                    <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                            <User className="w-4 h-4 text-blue-500" />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm uppercase">
                                                {cliente.nome}
                                            </h4>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                                                {cliente.cpf || 'CPF não informado'} • {cliente.telefone || cliente.celular || 'Sem contato'}
                                            </p>
                                        </div>
                                        <div className="text-right flex flex-col items-end">
                                            <p className="text-sm font-medium text-gray-800 dark:text-white">
                                                Gasto: R$ {(cliente.valor_total_gasto || 0).toFixed(2)}
                                            </p>
                                            {cliente.saldo_devedor && cliente.saldo_devedor > 0 ? (
                                                <div className="mt-1 px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs font-bold rounded-full">
                                                    Dívida Fiado: R$ {cliente.saldo_devedor.toFixed(2)}
                                                </div>
                                            ) : (
                                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                    {cliente.total_compras ? `${cliente.total_compras} compras` : 'Sem compras'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : query.trim() && !loading ? (
                            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                                <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>Nenhum cliente encontrado</p>
                            </div>
                        ) : null}
                    </div>

                    <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                        <button
                            onClick={() => setMostrarBusca(false)}
                            className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClienteSelect;
