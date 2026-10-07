import React, { useState } from 'react';
import { Plus, Package, Truck, LayoutDashboard, BarChart3 } from 'lucide-react';
import DeliveryDashboard from './DeliveryDashboard';
import DeliveryList from './DeliveryList';
import DriverManagement from './DriverManagement';
import CreateDeliveryModal from './CreateDeliveryModal';
import CentralLogistica from './CentralLogistica';
import PortalEntregador from './PortalEntregador';
import { authService } from '../auth/authService';

type DeliveryTab = 'dashboard' | 'central' | 'entregas' | 'frota';

const tabs: Array<{
    id: DeliveryTab;
    label: string;
    description: string;
    icon: React.ElementType;
}> = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        description: 'KPIs operacionais e visão executiva',
        icon: LayoutDashboard,
    },
    {
        id: 'central',
        label: 'Central Logística',
        description: 'Métricas com filtros por período, entregador e veículo',
        icon: BarChart3,
    },
    {
        id: 'entregas',
        label: 'Entregas',
        description: 'Acompanhamento, fila e status',
        icon: Package,
    },
    {
        id: 'frota',
        label: 'Frota e Motoristas',
        description: 'Equipe, veículos e capacidade',
        icon: Truck,
    },
];

const DeliveryPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<DeliveryTab>('dashboard');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleCreated = () => {
        setCreateModalOpen(false);
        setRefreshKey((current) => current + 1);
    };

    const user = authService.getCurrentUser();
    const isEntregador = user?.role?.toLowerCase() === 'entregador' || user?.role?.toLowerCase() === 'motorista';

    if (isEntregador) {
        return <PortalEntregador />;
    }

    return (
        <div className="space-y-6 p-6 pb-24 md:pb-6">
            <section className="rounded-3xl border border-slate-200 bg-linear-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-xl dark:border-slate-800">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                        <div className="mb-3 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">
                            Operacao Delivery
                        </div>
                        <h1 className="text-3xl font-black tracking-tight sm:text-4xl tour-delivery-visao">
                            Central profissional de entregas
                        </h1>
                        <p className="mt-3 text-sm text-slate-300 sm:text-base">
                            Controle a operação ponta a ponta: criação de entrega, despacho, acompanhamento de rota,
                            frota e performance logística em uma única interface.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => setCreateModalOpen(true)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-700"
                        >
                            <Plus className="h-4 w-4" />
                            Nova Entrega
                        </button>
                        <button
                            onClick={() => setRefreshKey((current) => current + 1)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-bold text-slate-100 transition hover:bg-white/10"
                        >
                            Atualizar Painel
                        </button>
                    </div>
                </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-3 lg:grid-cols-3">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`rounded-2xl border px-4 py-4 text-left transition ${
                                    active
                                        ? 'border-blue-500 bg-blue-50 shadow-sm dark:border-blue-500 dark:bg-blue-950/40'
                                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <div
                                        className={`rounded-xl p-2 ${
                                            active
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                        }`}
                                    >
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div
                                            className={`font-bold ${
                                                active
                                                    ? 'text-blue-700 dark:text-blue-300'
                                                    : 'text-slate-900 dark:text-white'
                                            }`}
                                        >
                                            {tab.label}
                                        </div>
                                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                            {tab.description}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section key={`${activeTab}-${refreshKey}`}>
                {activeTab === 'dashboard' && <DeliveryDashboard onVerTodas={() => setActiveTab('entregas')} />}
                {activeTab === 'central' && <CentralLogistica />}
                {activeTab === 'entregas' && <DeliveryList />}
                {activeTab === 'frota' && <DriverManagement />}
            </section>

            <CreateDeliveryModal
                isOpen={createModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onCreated={handleCreated}
            />
        </div>
    );
};

export default DeliveryPage;
