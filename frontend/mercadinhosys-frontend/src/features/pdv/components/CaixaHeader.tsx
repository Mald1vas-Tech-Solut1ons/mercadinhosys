import React, { useState, useEffect } from 'react';
import {
    Clock,
    User,
    Lock,
    Unlock,
    Wallet
} from 'lucide-react';
import { formatCurrency, formatDateTime } from '../../../utils/formatters';

interface CaixaHeaderProps {
    funcionarioNome?: string;
    funcionarioRole?: string;
    caixaNumero?: string;
    caixaAberto?: boolean;
    saldoAtualCaixa?: number;
    dataAberturaCaixa?: string;
    onOpenCaixaManager?: () => void;
}

const CaixaHeader: React.FC<CaixaHeaderProps> = ({
    funcionarioNome = 'Operador',
    funcionarioRole = 'Caixa',
    caixaNumero,
    caixaAberto = false,
    saldoAtualCaixa,
    dataAberturaCaixa,
    onOpenCaixaManager,
}) => {
    const [horaAtual, setHoraAtual] = useState(new Date());

    // Atualizar relógio a cada segundo
    useEffect(() => {
        const interval = setInterval(() => {
            setHoraAtual(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const formatarHora = (data: Date) => {
        return data.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const formatarData = (data: Date) => {
        return data.toLocaleDateString('pt-BR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <div className="bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 text-white rounded-xl shadow-lg p-4 md:p-6 mb-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                {/* Informações do Caixa */}
                <div className="flex items-center space-x-4 min-w-0 w-full md:w-auto">
                    <div className="p-4 bg-white bg-opacity-20 rounded-xl backdrop-blur-sm shrink-0">
                        <User className="w-8 h-8" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl md:text-2xl font-bold truncate max-w-[65vw] md:max-w-none">
                                {funcionarioNome}
                            </h2>
                            {funcionarioRole && (
                                <span className="px-3 py-1 bg-white bg-opacity-20 rounded-full text-xs md:text-sm font-medium uppercase tracking-wider">
                                    {funcionarioRole}
                                </span>
                            )}
                        </div>
                        <p className="text-blue-100 mt-1 text-xs md:text-sm flex items-center">
                            <Clock className="w-3 h-3 mr-1 md:hidden" />
                            {formatarData(horaAtual)}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-end flex-wrap md:flex-nowrap">
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl backdrop-blur-sm border ${
                        caixaAberto
                            ? 'bg-emerald-500/20 border-emerald-300/30 text-white'
                            : 'bg-red-500/20 border-red-300/30 text-white'
                    }`}>
                        {caixaAberto ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                        <div className="text-left">
                            <p className="text-[10px] uppercase tracking-widest font-black opacity-80">Status do Caixa</p>
                            <p className="text-sm font-black uppercase">
                                {caixaAberto ? `Aberto${caixaNumero ? ` • ${caixaNumero}` : ''}` : 'Fechado'}
                            </p>
                        </div>
                    </div>

                    {/* Relógio */}
                    <div className="flex items-center space-x-2 bg-white bg-opacity-20 px-4 md:px-6 py-2 md:py-3 rounded-xl backdrop-blur-sm">
                        <Clock className="w-5 h-5 md:w-6 md:h-6" />
                        <span className="text-2xl md:text-3xl font-bold font-mono">
                            {formatarHora(horaAtual)}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
                <div className={`rounded-2xl px-4 py-3 border backdrop-blur-sm ${
                    caixaAberto
                        ? 'bg-white/10 border-white/15'
                        : 'bg-red-950/25 border-red-300/20'
                }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-blue-100/80">Operação do PDV</p>
                            <p className="text-sm md:text-base font-black">
                                {caixaAberto
                                    ? 'Caixa liberado para vendas, sangrias e fechamento do turno.'
                                    : 'Caixa fechado. Abra o caixa antes de iniciar pagamentos e concluir vendas.'}
                            </p>
                            {caixaAberto && (
                                <p className="text-xs text-blue-100 mt-1">
                                    {dataAberturaCaixa ? `Aberto em ${formatDateTime(dataAberturaCaixa)}` : 'Turno ativo'}{typeof saldoAtualCaixa === 'number' ? ` • Saldo atual ${formatCurrency(saldoAtualCaixa)}` : ''}
                                </p>
                            )}
                        </div>
                        {onOpenCaixaManager && (
                            <button
                                type="button"
                                onClick={onOpenCaixaManager}
                                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-black uppercase tracking-wider text-xs bg-white text-blue-700 hover:bg-blue-50 transition-colors"
                            >
                                <Wallet className="w-4 h-4" />
                                {caixaAberto ? 'Gerir Caixa' : 'Abrir Caixa'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CaixaHeader;
