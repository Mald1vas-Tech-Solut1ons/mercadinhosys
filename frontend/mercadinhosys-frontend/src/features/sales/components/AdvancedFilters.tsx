import { useState } from "react";
import { dataLocalISO } from '../../../utils/dataLocal';

interface FilterProps {
    filtros: any;
    onFilterChange: (filtros: any) => void;
    funcionarios: Array<{ id: number; nome: string }>;
    clientes: Array<{ id: number; nome: string }>;
}

export default function AdvancedFilters({
    filtros,
    onFilterChange,
    funcionarios,
    clientes,
}: FilterProps) {
    const [mostrarAvancados, setMostrarAvancados] = useState(false);

    const filtrosRapidos = [
        { label: "Hoje", value: "hoje", icon: "📅" },
        { label: "Esta Semana", value: "semana", icon: "📆" },
        { label: "Este Mês", value: "mes", icon: "🗓️" },
        { label: "Acima de R$100", value: "alto_valor", icon: "💰" },
    ];

    const aplicarFiltroRapido = (tipo: string) => {
        const hoje = new Date();
        const dataInicio = new Date();

        switch (tipo) {
            case "hoje":
                onFilterChange({
                    ...filtros,
                    data_inicio: dataLocalISO(hoje),
                    data_fim: dataLocalISO(hoje),
                });
                break;
            case "semana":
                dataInicio.setDate(hoje.getDate() - 7);
                onFilterChange({
                    ...filtros,
                    data_inicio: dataLocalISO(dataInicio),
                    data_fim: dataLocalISO(hoje),
                });
                break;
            case "mes":
                dataInicio.setMonth(hoje.getMonth() - 1);
                onFilterChange({
                    ...filtros,
                    data_inicio: dataLocalISO(dataInicio),
                    data_fim: dataLocalISO(hoje),
                });
                break;
            case "alto_valor":
                onFilterChange({
                    ...filtros,
                    min_total: "100",
                });
                break;
        }
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-md mb-6 border dark:bg-gray-800">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Filtros</h2>
                <button
                    onClick={() => setMostrarAvancados(!mostrarAvancados)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                    {mostrarAvancados ? "▲ Ocultar Avançados" : "▼ Mostrar Avançados"}
                </button>
            </div>

            {/* Filtros Rápidos */}
            <div className="flex flex-wrap gap-2 mb-4">
                {filtrosRapidos.map((filtro) => (
                    <button
                        key={filtro.value}
                        onClick={() => aplicarFiltroRapido(filtro.value)}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium flex items-center gap-1"
                    >
                        <span>{filtro.icon}</span>
                        {filtro.label}
                    </button>
                ))}
            </div>

            {/* Filtros Básicos */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Data Início</label>
                    <input
                        type="date"
                        name="data_inicio"
                        value={filtros.data_inicio}
                        onChange={(e) => onFilterChange({ ...filtros, data_inicio: e.target.value, page: 1 })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Data Fim</label>
                    <input
                        type="date"
                        name="data_fim"
                        value={filtros.data_fim}
                        onChange={(e) => onFilterChange({ ...filtros, data_fim: e.target.value, page: 1 })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Status</label>
                    <select
                        name="status"
                        value={filtros.status}
                        onChange={(e) => onFilterChange({ ...filtros, status: e.target.value, page: 1 })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    >
                        <option value="">Todos</option>
                        <option value="finalizada">Finalizada</option>
                        <option value="cancelada">Cancelada</option>
                        <option value="em_andamento">Em Andamento</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Forma de Pagamento</label>
                    <select
                        name="forma_pagamento"
                        value={filtros.forma_pagamento}
                        onChange={(e) => onFilterChange({ ...filtros, forma_pagamento: e.target.value, page: 1 })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    >
                        <option value="">Todas</option>
                        <option value="dinheiro">Dinheiro</option>
                        <option value="cartao_credito">Cartão de Crédito</option>
                        <option value="cartao_debito">Cartão de Débito</option>
                        <option value="pix">PIX</option>
                        <option value="fiado">Fiado</option>
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Busca</label>
                    <input
                        type="text"
                        name="search"
                        placeholder="Código, cliente..."
                        value={filtros.search}
                        onChange={(e) => onFilterChange({ ...filtros, search: e.target.value, page: 1 })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                    />
                </div>
                <div className="flex items-end">
                    <button
                        onClick={() => onFilterChange({
                            data_inicio: "",
                            data_fim: "",
                            search: "",
                            status: "",
                            forma_pagamento: "",
                            funcionario_id: "",
                            cliente_id: "",
                            min_total: "",
                            max_total: "",
                            page: 1,
                            per_page: 20,
                        })}
                        className="w-full bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors"
                    >
                        Limpar
                    </button>
                </div>
            </div>

            {/* Filtros Avançados */}
            {mostrarAvancados && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 dark:text-gray-200">Filtros Avançados</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Funcionário</label>
                            <select
                                name="funcionario_id"
                                value={filtros.funcionario_id || ""}
                                onChange={(e) => onFilterChange({ ...filtros, funcionario_id: e.target.value, page: 1 })}
                                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                            >
                                <option value="">Todos</option>
                                {funcionarios.map((func) => (
                                    <option key={func.id} value={func.id}>
                                        {func.nome}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Cliente</label>
                            <select
                                name="cliente_id"
                                value={filtros.cliente_id || ""}
                                onChange={(e) => onFilterChange({ ...filtros, cliente_id: e.target.value, page: 1 })}
                                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                            >
                                <option value="">Todos</option>
                                {clientes.map((cliente) => (
                                    <option key={cliente.id} value={cliente.id}>
                                        {cliente.nome}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Valor Mínimo</label>
                            <input
                                type="number"
                                name="min_total"
                                placeholder="R$ 0,00"
                                value={filtros.min_total || ""}
                                onChange={(e) => onFilterChange({ ...filtros, min_total: e.target.value, page: 1 })}
                                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Valor Máximo</label>
                            <input
                                type="number"
                                name="max_total"
                                placeholder="R$ 9999,99"
                                value={filtros.max_total || ""}
                                onChange={(e) => onFilterChange({ ...filtros, max_total: e.target.value, page: 1 })}
                                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
