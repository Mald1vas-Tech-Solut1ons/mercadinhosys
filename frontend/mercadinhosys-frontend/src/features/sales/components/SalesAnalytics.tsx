import { Line, Bar, Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from "chart.js";
import { dataDoDia } from '../../../utils/dataLocal';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface AnalyticsProps {
    vendasPorDia: Array<{ data: string; quantidade: number; total: number }>;
    topProdutos: Array<{ nome: string; quantidade: number; total: number }>;
    topFuncionarios: Array<{ nome: string; quantidade: number; total: number }>;
    vendasPorHora: Array<{ hora: number; quantidade: number; total: number }>;
    formasPagamento: Record<string, { quantidade: number; total: number }>;
}

function formatCurrency(value: number) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function SalesAnalytics({
    vendasPorDia,
    topProdutos,
    topFuncionarios,
    vendasPorHora,
    formasPagamento,
}: AnalyticsProps) {
    // Gráfico de Tendência (Linha)
    const trendData = {
        labels: vendasPorDia.map((v) => {
            const date = dataDoDia(v.data);
            return `${date.getDate()}/${date.getMonth() + 1}`;
        }),
        datasets: [
            {
                label: "Vendas (R$)",
                data: vendasPorDia.map((v) => v.total),
                borderColor: "rgb(37, 99, 235)",
                backgroundColor: "rgba(37, 99, 235, 0.1)",
                fill: true,
                tension: 0.4,
            },
        ],
    };

    // Gráfico de Top Produtos (Barras Horizontais)
    const topProdutosData = {
        labels: topProdutos.slice(0, 10).map((p) => p.nome),
        datasets: [
            {
                label: "Quantidade Vendida",
                data: topProdutos.slice(0, 10).map((p) => p.quantidade),
                backgroundColor: "rgba(16, 185, 129, 0.8)",
            },
        ],
    };

    // Gráfico de Formas de Pagamento (Rosca)
    const formasPagamentoData = {
        labels: Object.keys(formasPagamento).map((f) => f.replace(/_/g, " ").toUpperCase()),
        datasets: [
            {
                data: Object.values(formasPagamento).map((f) => f.total),
                backgroundColor: [
                    "rgba(37, 99, 235, 0.8)",
                    "rgba(16, 185, 129, 0.8)",
                    "rgba(245, 158, 11, 0.8)",
                    "rgba(239, 68, 68, 0.8)",
                    "rgba(139, 92, 246, 0.8)",
                ],
            },
        ],
    };

    // Gráfico de Horários de Pico (Barras)
    const horariosData = {
        labels: vendasPorHora.map((v) => `${v.hora}h`),
        datasets: [
            {
                label: "Vendas por Hora",
                data: vendasPorHora.map((v) => v.quantidade),
                backgroundColor: "rgba(139, 92, 246, 0.8)",
            },
        ],
    };

    return (
        <div className="space-y-6">
            {/* Gráfico de Tendência */}
            <div className="bg-white p-6 rounded-lg shadow-md border dark:bg-gray-800">
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    📈 Tendência de Vendas (Últimos 30 Dias)
                </h3>
                <div className="h-80">
                    <Line
                        data={trendData}
                        options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (context) => formatCurrency(context.parsed.y || 0),
                                    },
                                },
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: (value) => formatCurrency(Number(value)),
                                    },
                                },
                            },
                        }}
                    />
                </div>
            </div>

            {/* Grid de 2 colunas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Produtos */}
                <div className="bg-white p-6 rounded-lg shadow-md border dark:bg-gray-800">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                        🛍️ Top 10 Produtos Mais Vendidos
                    </h3>
                    <div className="h-80">
                        <Bar
                            data={topProdutosData}
                            options={{
                                indexAxis: "y",
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { display: false },
                                },
                            }}
                        />
                    </div>
                </div>

                {/* Formas de Pagamento */}
                <div className="bg-white p-6 rounded-lg shadow-md border dark:bg-gray-800">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                        💳 Distribuição por Forma de Pagamento
                    </h3>
                    <div className="h-80 flex items-center justify-center">
                        <Doughnut
                            data={formasPagamentoData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { position: "bottom" },
                                    tooltip: {
                                        callbacks: {
                                            label: (context) => {
                                                const label = context.label || "";
                                                const value = context.parsed || 0;
                                                return `${label}: ${formatCurrency(value)}`;
                                            },
                                        },
                                    },
                                },
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Grid de 2 colunas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Horários de Pico */}
                <div className="bg-white p-6 rounded-lg shadow-md border dark:bg-gray-800">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                        ⏰ Horários de Pico
                    </h3>
                    <div className="h-64">
                        <Bar
                            data={horariosData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { display: false },
                                },
                            }}
                        />
                    </div>
                </div>

                {/* Top Funcionários */}
                <div className="bg-white p-6 rounded-lg shadow-md border dark:bg-gray-800">
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                        👥 Top Funcionários
                    </h3>
                    <div className="space-y-3">
                        {topFuncionarios.slice(0, 5).map((func, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg dark:bg-gray-900"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">
                                        {index === 0 ? "🏆" : index === 1 ? "🥈" : index === 2 ? "🥉" : "👤"}
                                    </span>
                                    <div>
                                        <p className="font-semibold text-gray-900 dark:text-gray-100">{func.nome}</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">
                                            {func.quantidade} vendas
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-green-600">
                                        {formatCurrency(func.total)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
