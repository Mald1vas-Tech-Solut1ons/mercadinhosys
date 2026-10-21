import React, { useEffect, useMemo, useState } from 'react';
import { authService } from '../auth/authService';
import { getNivel, UsuarioLogado } from '../../utils/permissions';
import { crmApi } from './crmApi';
import FunilTab from './FunilTab';
import LeadsTab from './LeadsTab';
import AtividadesTab from './AtividadesTab';
import PosVendaTab from './PosVendaTab';
import CampanhasTab from './CampanhasTab';
import ComissoesTab from './ComissoesTab';

type Aba = 'funil' | 'leads' | 'agenda' | 'posvenda' | 'campanhas' | 'comissoes';

/** Abas por nível, iguais à matriz do backend (crm 1/2/5, pós-venda 1/2/4/5, gestão 1/2). */
const ABAS: { id: Aba; rotulo: string; niveis: number[] }[] = [
    { id: 'funil', rotulo: 'Funil', niveis: [0, 1, 2, 5] },
    { id: 'leads', rotulo: 'Leads', niveis: [0, 1, 2, 5] },
    { id: 'agenda', rotulo: 'Agenda', niveis: [0, 1, 2, 4, 5] },
    { id: 'posvenda', rotulo: 'Pós-venda', niveis: [0, 1, 2, 4, 5] },
    { id: 'campanhas', rotulo: 'Campanhas', niveis: [0, 1, 2] },
    { id: 'comissoes', rotulo: 'Comissões', niveis: [0, 1, 2, 5] },
];

const CRMPage: React.FC = () => {
    const usuario = authService.getCurrentUser() as UsuarioLogado | null;
    const nivel = getNivel(usuario);
    const gestor = nivel <= 2;
    const abas = useMemo(() => ABAS.filter(a => a.niveis.includes(nivel)), [nivel]);
    const [aba, setAba] = useState<Aba>(abas[0]?.id || 'posvenda');
    const [responsaveis, setResponsaveis] = useState<{ id: number; nome: string }[]>([]);

    useEffect(() => {
        if (nivel === 4) return; // caixa não lista a equipe comercial
        crmApi.responsaveis().then(setResponsaveis).catch(() => setResponsaveis([]));
    }, [nivel]);

    return (
        <div className="space-y-4 p-4 md:p-6">
            <header>
                <h1 className="text-2xl font-semibold text-foreground">CRM e pós-venda</h1>
                <p className="text-sm text-muted-foreground">
                    {gestor ? 'Funil da equipe, follow-up, campanhas com consentimento, comissão e atendimento.'
                        : nivel === 5 ? 'Sua carteira: leads, negócios, agenda, chamados e comissão.'
                            : 'Chamados e agenda de atendimento ao cliente.'}
                </p>
            </header>
            <nav className="flex gap-1 overflow-x-auto border-b" role="tablist">
                {abas.map(a => (
                    <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
                            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                aba === a.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                        {a.rotulo}
                    </button>
                ))}
            </nav>
            {aba === 'funil' && <FunilTab gestor={gestor} responsaveis={responsaveis} />}
            {aba === 'leads' && <LeadsTab gestor={gestor} responsaveis={responsaveis} />}
            {aba === 'agenda' && <AtividadesTab gestor={gestor} />}
            {aba === 'posvenda' && <PosVendaTab podeDevolver={gestor} />}
            {aba === 'campanhas' && <CampanhasTab responsaveis={responsaveis} />}
            {aba === 'comissoes' && <ComissoesTab gestor={gestor} usuarioId={usuario?.id} responsaveis={responsaveis} />}
        </div>
    );
};

export default CRMPage;
