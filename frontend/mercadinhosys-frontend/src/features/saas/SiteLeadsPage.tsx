import React, { useState } from 'react';
import { BarChart3, Users } from 'lucide-react';
import RastreioSitePanel from './RastreioSitePanel';
import CrmLeadsPanel from './CrmLeadsPanel';

/** Super admin → Site e Leads: rastreio do site público e CRM de leads, na mesma tela. */
const SiteLeadsPage: React.FC = () => {
    const [aba, setAba] = useState<'crm' | 'site'>('crm');
    const abas = [
        { id: 'crm' as const, rotulo: 'CRM de leads', icone: Users },
        { id: 'site' as const, rotulo: 'Rastreio do site', icone: BarChart3 },
    ];
    return (
        <div className="mx-auto w-full max-w-7xl space-y-5">
            <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800">
                {abas.map(({ id, rotulo, icone: Icone }) => (
                    <button key={id} type="button" onClick={() => setAba(id)}
                        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${aba === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}>
                        <Icone className="h-4 w-4" /> {rotulo}
                    </button>
                ))}
            </div>
            {aba === 'crm' ? <CrmLeadsPanel /> : <RastreioSitePanel />}
        </div>
    );
};

export default SiteLeadsPage;
