import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, AlertTriangle, X, CreditCard } from 'lucide-react';
import { trialService, TrialStatus } from './trialService';

const DISMISS_KEY = 'trial_notice_dismissed_em';
const hojeKey = () => new Date().toISOString().slice(0, 10);

type Urgencia = 'medio' | 'alto' | 'critico' | 'vencido';

const estilos: Record<Urgencia, { faixa: string; icone: string; botao: string; Icon: any }> = {
    medio: { faixa: 'bg-blue-600', icone: 'bg-blue-100 text-blue-700', botao: 'bg-blue-600 hover:bg-blue-700', Icon: Clock },
    alto: { faixa: 'bg-amber-500', icone: 'bg-amber-100 text-amber-700', botao: 'bg-amber-500 hover:bg-amber-600', Icon: Clock },
    critico: { faixa: 'bg-orange-600', icone: 'bg-orange-100 text-orange-700', botao: 'bg-orange-600 hover:bg-orange-700', Icon: AlertTriangle },
    vencido: { faixa: 'bg-red-600', icone: 'bg-red-100 text-red-700', botao: 'bg-red-600 hover:bg-red-700', Icon: AlertTriangle },
};

function montarMensagem(s: TrialStatus): { urg: Urgencia; titulo: string; texto: string; bloqueante: boolean } {
    const dias = s.dias_restantes ?? 0;
    if (s.vencido) {
        return {
            urg: 'vencido',
            titulo: 'Seu período de teste terminou',
            texto: 'Para continuar usando o sistema sem interrupção, ative sua assinatura. Seus dados estão guardados.',
            bloqueante: true,
        };
    }
    if (dias <= 1) {
        return {
            urg: 'critico',
            titulo: dias <= 0 ? 'Seu teste termina hoje' : 'Falta 1 dia de teste',
            texto: 'Seu período de teste está acabando. Ative a assinatura para não perder o acesso.',
            bloqueante: false,
        };
    }
    if (dias <= 5) {
        return {
            urg: 'alto',
            titulo: `Faltam ${dias} dias de teste`,
            texto: 'Seu período de teste gratuito está chegando ao fim. Que tal já garantir a continuidade?',
            bloqueante: false,
        };
    }
    return {
        urg: 'medio',
        titulo: `Faltam ${dias} dias de teste`,
        texto: 'Você está no período de teste gratuito. Aproveite para conhecer tudo — e ative quando quiser.',
        bloqueante: false,
    };
}

/**
 * Modal de aviso do período de teste. Aparece quando faltam ≤10 dias (marcos
 * 10/5/1) ou quando já venceu. O cliente fecha; some pelo resto do dia. Quando
 * vencido, é bloqueante (reaparece a cada sessão até assinar).
 */
const TrialNotice: React.FC = () => {
    const navigate = useNavigate();
    const [status, setStatus] = useState<TrialStatus | null>(null);
    const [aberto, setAberto] = useState(false);

    useEffect(() => {
        let ativo = true;
        trialService.getStatus().then((s) => {
            if (!ativo || !s) return;
            const dias = s.dias_restantes;
            const deveAvisar = s.em_trial && dias != null && dias <= 10;
            if (!deveAvisar) return;
            setStatus(s);
            if (s.vencido) {
                setAberto(true); // vencido: sempre mostra
                return;
            }
            // Aviso normal: uma vez por dia
            if (localStorage.getItem(DISMISS_KEY) !== hojeKey()) setAberto(true);
        });
        return () => { ativo = false; };
    }, []);

    if (!aberto || !status) return null;

    const { urg, titulo, texto, bloqueante } = montarMensagem(status);
    const e = estilos[urg];

    const fechar = () => {
        if (!status.vencido) localStorage.setItem(DISMISS_KEY, hojeKey());
        setAberto(false);
    };
    const irAssinar = () => {
        setAberto(false);
        navigate('/settings?tab=assinatura');
    };

    return (
        <div className="fixed inset-0 z-250 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={bloqueante ? undefined : fechar} />
            <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                <div className={`h-1.5 ${e.faixa}`} />
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${e.icone}`}>
                            <e.Icon className="w-6 h-6" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">{titulo}</h3>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300 leading-relaxed">{texto}</p>
                        </div>
                        {!bloqueante && (
                            <button onClick={fechar} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Fechar">
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        )}
                    </div>

                    <div className="mt-6 flex flex-col sm:flex-row gap-2">
                        <button
                            onClick={irAssinar}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white font-bold text-sm transition ${e.botao}`}
                        >
                            <CreditCard className="w-4 h-4" /> Assinar agora
                        </button>
                        {!bloqueante && (
                            <button
                                onClick={fechar}
                                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 font-semibold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                                Continuar testando
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TrialNotice;
