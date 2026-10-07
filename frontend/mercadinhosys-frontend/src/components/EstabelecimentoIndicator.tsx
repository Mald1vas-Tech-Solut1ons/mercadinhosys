
// src/components/EstabelecimentoIndicator.tsx
import React from 'react';
import { useEstabelecimento } from '../contexts/EstabelecimentoContext';
import { Building2, X } from 'lucide-react';

const EstabelecimentoIndicator: React.FC = () => {
    const { estabelecimentoAtual, isSuperAdmin, handleClearEstabelecimento } = useEstabelecimento();

    if (!isSuperAdmin || !estabelecimentoAtual) {
        return null; // Não mostrar para usuários normais ou sem seleção
    }

    return (
        <div className="fixed top-20 right-4 z-50 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg shadow-lg p-3 max-w-sm">
            <div className="flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                <div className="flex flex-col">
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">
                        Visualizando:
                    </span>
                    <span className="text-sm font-bold text-green-700 dark:text-green-300">
                        {estabelecimentoAtual.nome_fantasia}
                    </span>
                    <span className="text-xs text-green-500 dark:text-green-400">
                        ({estabelecimentoAtual.cidade}/{estabelecimentoAtual.estado})
                    </span>
                </div>
                <button
                    onClick={handleClearEstabelecimento}
                    className="ml-2 p-1 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-800 rounded"
                    title="Limpar seleção"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default EstabelecimentoIndicator;
