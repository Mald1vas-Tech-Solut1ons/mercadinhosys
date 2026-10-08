interface MetricsProps {
    totalVendas: number;
    quantidadeVendas: number;
    ticketMedio: number;
    totalDescontos: number;
    crescimento: number;
    vendasHoje: number;
    metaMes: number;
    canceladas: number;
}

function formatCurrency(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SalesMetrics({
    totalVendas,
    quantidadeVendas,
    ticketMedio,
    totalDescontos,
    crescimento,
    vendasHoje,
    metaMes,
    canceladas,
}: MetricsProps) {
    const progressoMeta = metaMes > 0 ? (totalVendas / metaMes) * 100 : 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Total Vendido */}
            <div className="bg-linear-to-br from-green-50 to-green-100 p-4 rounded-lg shadow-md border border-green-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-green-700 font-medium">Total Vendido</div>
                    <span className="text-2xl">💰</span>
                </div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(totalVendas)}</div>
                {crescimento !== 0 && (
                    <div className={`text-xs mt-1 ${crescimento > 0 ? "text-green-600" : "text-red-600"}`}>
                        {crescimento > 0 ? "↑" : "↓"} {Math.abs(crescimento).toFixed(1)}% vs mês anterior
                    </div>
                )}
            </div>

            {/* Quantidade de Vendas */}
            <div className="bg-linear-to-br from-blue-50 to-blue-100 p-4 rounded-lg shadow-md border border-blue-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-blue-700 font-medium">Qtd. Vendas</div>
                    <span className="text-2xl">📊</span>
                </div>
                <div className="text-2xl font-bold text-blue-600">{quantidadeVendas}</div>
                <div className="text-xs text-blue-600 mt-1">
                    {vendasHoje} vendas hoje
                </div>
            </div>

            {/* Ticket Médio */}
            <div className="bg-linear-to-br from-purple-50 to-purple-100 p-4 rounded-lg shadow-md border border-purple-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-purple-700 font-medium">Ticket Médio</div>
                    <span className="text-2xl">🎯</span>
                </div>
                <div className="text-2xl font-bold text-purple-600">{formatCurrency(ticketMedio)}</div>
                <div className="text-xs text-purple-600 mt-1">
                    Por venda
                </div>
            </div>

            {/* Descontos Totais */}
            <div className="bg-linear-to-br from-red-50 to-red-100 p-4 rounded-lg shadow-md border border-red-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-red-700 font-medium">Descontos</div>
                    <span className="text-2xl">🏷️</span>
                </div>
                <div className="text-2xl font-bold text-red-600">{formatCurrency(totalDescontos)}</div>
                <div className="text-xs text-red-600 mt-1">
                    {((totalDescontos / totalVendas) * 100).toFixed(1)}% do total
                </div>
            </div>

            {/* Meta do Mês */}
            <div className="bg-linear-to-br from-yellow-50 to-yellow-100 p-4 rounded-lg shadow-md border border-yellow-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-yellow-700 font-medium">Meta do Mês</div>
                    <span className="text-2xl">🎖️</span>
                </div>
                <div className="text-2xl font-bold text-yellow-600">
                    {progressoMeta.toFixed(0)}%
                </div>
                <div className="mt-2">
                    <div className="w-full bg-yellow-200 rounded-full h-2">
                        <div
                            className="bg-yellow-600 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(progressoMeta, 100)}%` }}
                        ></div>
                    </div>
                    <div className="text-xs text-yellow-600 mt-1">
                        {formatCurrency(totalVendas)} / {formatCurrency(metaMes)}
                    </div>
                </div>
            </div>

            {/* Vendas Canceladas */}
            <div className="bg-linear-to-br from-gray-50 to-gray-100 p-4 rounded-lg shadow-md border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-gray-700 font-medium">Canceladas</div>
                    <span className="text-2xl">❌</span>
                </div>
                <div className="text-2xl font-bold text-gray-600">{canceladas}</div>
                <div className="text-xs text-gray-600 mt-1">
                    {quantidadeVendas > 0 ? ((canceladas / quantidadeVendas) * 100).toFixed(1) : 0}% do total
                </div>
            </div>

            {/* Crescimento */}
            <div className={`bg-linear-to-br ${crescimento >= 0 ? "from-teal-50 to-teal-100 border-teal-200" : "from-orange-50 to-orange-100 border-orange-200"} p-4 rounded-lg shadow-md border`}>
                <div className="flex justify-between items-start mb-2">
                    <div className={`text-sm font-medium ${crescimento >= 0 ? "text-teal-700" : "text-orange-700"}`}>
                        Crescimento
                    </div>
                    <span className="text-2xl">{crescimento >= 0 ? "📈" : "📉"}</span>
                </div>
                <div className={`text-2xl font-bold ${crescimento >= 0 ? "text-teal-600" : "text-orange-600"}`}>
                    {crescimento > 0 ? "+" : ""}{crescimento.toFixed(1)}%
                </div>
                <div className={`text-xs mt-1 ${crescimento >= 0 ? "text-teal-600" : "text-orange-600"}`}>
                    vs mês anterior
                </div>
            </div>

            {/* Vendas Hoje */}
            <div className="bg-linear-to-br from-indigo-50 to-indigo-100 p-4 rounded-lg shadow-md border border-indigo-200">
                <div className="flex justify-between items-start mb-2">
                    <div className="text-sm text-indigo-700 font-medium">Vendas Hoje</div>
                    <span className="text-2xl">📅</span>
                </div>
                <div className="text-2xl font-bold text-indigo-600">{vendasHoje}</div>
                <div className="text-xs text-indigo-600 mt-1">
                    Até o momento
                </div>
            </div>
        </div>
    );
}
