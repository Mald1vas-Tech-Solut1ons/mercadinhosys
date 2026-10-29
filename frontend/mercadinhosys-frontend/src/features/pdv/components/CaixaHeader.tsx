import React, { useState, useEffect } from 'react';
import {
    Clock,
    User,
    Lock,
    Unlock,
    Wallet,
    AlertTriangle
} from 'lucide-react';
import { formatDateTime } from '../../../utils/formatters';

interface CaixaHeaderProps {
    funcionarioNome?: string;
    funcionarioRole?: string;
    caixaNumero?: string;
    caixaAberto?: boolean;
    saldoAtualCaixa?: number;
    dataAberturaCaixa?: string;
    onOpenCaixaManager?: () => void;
}

// Turno de caixa acima disso costuma ser caixa esquecido aberto de um dia para o outro.
const HORAS_ALERTA_CAIXA_ABERTO = 14;

const CaixaHeader: React.FC<CaixaHeaderProps> = ({
    funcionarioNome = 'Operador',
    funcionarioRole = 'Caixa',
    caixaNumero,
    caixaAberto = false,
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
        const texto = data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    };

    const horasAberto = caixaAberto && dataAberturaCaixa
        ? (horaAtual.getTime() - new Date(dataAberturaCaixa).getTime()) / 3_600_000
        : 0;
    const caixaEsquecido = horasAberto > HORAS_ALERTA_CAIXA_ABERTO;
    const tempoAberto = horasAberto >= 48 ? `${Math.floor(horasAberto / 24)} dias` : `${Math.floor(horasAberto)} h`;

    // @container: o layout responde à largura disponível (com o menu lateral aberto o PDV é
    // bem mais estreito que a tela), não ao tamanho da janela.
    return (
        <div className="@container bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 text-white rounded-xl shadow-lg px-4 py-3 mb-4">
            <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
                {/* Operador */}
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-white/20 rounded-xl shrink-0">
                        <User className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-lg font-bold truncate">{funcionarioNome}</h2>
                            {funcionarioRole && (
                                <span className="shrink-0 px-2.5 py-0.5 bg-white/20 rounded-full text-[11px] font-semibold uppercase tracking-wider">
                                    {funcionarioRole}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-blue-100 truncate">
                            {formatarData(horaAtual)}
                            {caixaAberto && dataAberturaCaixa ? ` · caixa aberto em ${formatDateTime(dataAberturaCaixa)}` : ''}
                        </p>
                    </div>
                </div>

                {/* Status, relógio e ação */}
                <div className="flex items-center gap-2 flex-wrap @3xl:flex-nowrap shrink-0">
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border whitespace-nowrap ${
                        caixaAberto
                            ? 'bg-emerald-500/20 border-emerald-300/30'
                            : 'bg-red-500/25 border-red-300/40'
                    }`}>
                        {caixaAberto ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                        <span className="text-sm font-black uppercase">
                            {caixaAberto ? `Aberto${caixaNumero ? ` • ${caixaNumero}` : ''}` : 'Caixa fechado'}
                        </span>
                    </div>

                    {/* Em largura de celular o aparelho já mostra a hora: o relógio sai para caber numa linha. */}
                    <div className="hidden @md:flex items-center gap-2 bg-white/20 px-3 py-2 rounded-xl whitespace-nowrap">
                        <Clock className="w-4 h-4" />
                        <span className="text-xl font-bold font-mono tabular-nums">{formatarHora(horaAtual)}</span>
                    </div>

                    {onOpenCaixaManager && (
                        <button
                            type="button"
                            onClick={onOpenCaixaManager}
                            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-black uppercase tracking-wider text-xs whitespace-nowrap bg-white text-blue-700 hover:bg-blue-50 transition-colors dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-gray-700"
                        >
                            <Wallet className="w-4 h-4" />
                            {caixaAberto ? 'Gerir Caixa' : 'Abrir Caixa'}
                        </button>
                    )}
                </div>
            </div>

            {!caixaAberto && (
                <p className="mt-2 text-xs font-semibold text-red-100">
                    Abra o caixa antes de receber pagamentos e concluir vendas.
                </p>
            )}
            {caixaEsquecido && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Caixa aberto há {tempoAberto}. Feche o turno anterior para a conferência do dia bater.
                </p>
            )}
        </div>
    );
};

export default CaixaHeader;
