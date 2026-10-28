
import React, { useState, useEffect } from 'react';
import { useEstabelecimento, Estabelecimento } from '../contexts/EstabelecimentoContext';
import { apiClient } from '../api/apiClient';
import { Building2, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

const EstabelecimentoSelector: React.FC = () => {
    const { estabelecimentoAtual, setEstabelecimentoAtual, estabelecimentos, setEstabelecimentos } = useEstabelecimento();
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        carregarEstabelecimentos();
    }, []);

    const carregarEstabelecimentos = async () => {
        try {
            const response = await apiClient.get('/estabelecimentos');
            if (response.data?.success) {
                setEstabelecimentos(response.data.estabelecimentos);

                // Se não tiver estabelecimento selecionado, seleciona o primeiro
                if (!estabelecimentoAtual && response.data.estabelecimentos.length > 0) {
                    setEstabelecimentoAtual(response.data.estabelecimentos[0]);
                }
            }
        } catch (error) {
            toast.error('Erro ao carregar estabelecimentos');
        }
    };

    const handleSelect = (estabelecimento: Estabelecimento) => {
        setEstabelecimentoAtual(estabelecimento);
        setIsOpen(false);
        toast.success(`Estabelecimento ${estabelecimento.nome_fantasia} selecionado`);
    };

    return (
        <div className="relative">
            {/* Botão principal */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
                <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <span className="font-medium text-gray-900 dark:text-white">
                    {estabelecimentoAtual?.nome_fantasia || 'Selecione...'}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                    <div className="p-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Selecionar Estabelecimento
                        </h3>
                        <div className="max-h-60 overflow-y-auto">
                            {estabelecimentos.map((estabelecimento) => (
                                <button
                                    key={estabelecimento.id}
                                    onClick={() => handleSelect(estabelecimento)}
                                    className={`w-full text-left px-3 py-2 rounded-md transition-colors ${estabelecimentoAtual?.id === estabelecimento.id
                                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                                        }`}
                                >
                                    <div className="font-medium">{estabelecimento.nome_fantasia}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {estabelecimento.razao_social}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EstabelecimentoSelector;
