import { useEffect, useState } from 'react';
import { Mail, Printer, X, ChevronRight, CheckCircle2, FileText, AlertTriangle, Eye } from 'lucide-react';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';
import { formatCurrency } from '../../../utils/formatters';

/** Resumo da venda recém-concluída (congelado no PDV antes de limpar o carrinho). */
export interface ResumoPosVenda {
    codigo?: string;
    offline?: boolean;
    total?: number;
    troco?: number;
    valorRecebido?: number;
    nfceSolicitada?: boolean;
    nfce_status?: string | null;
    nfce_mensagem?: string | null;
}

interface NotaFiscalModalProps {
    mostrar: boolean;
    venda?: ResumoPosVenda | null;
    nfceAmbiente?: string;
    emailCliente?: string;
    onEnviarEmail: (email: string) => void;
    onVisualizar: () => void;
    onImprimir: () => void;
    onFechar: () => void;
    enviando?: boolean;
}

type SituacaoDocumento =
    | { tipo: 'nfce_autorizada'; homologacao: boolean }
    | { tipo: 'nfce_processando' }
    | { tipo: 'nfce_falhou'; motivo: string }
    | { tipo: 'nao_fiscal'; offline: boolean };

function situacaoDoDocumento(venda: ResumoPosVenda | null | undefined, ambiente?: string): SituacaoDocumento {
    const status = (venda?.nfce_status || '').toLowerCase();
    if (venda?.nfceSolicitada && !venda?.offline) {
        if (status === 'autorizado' || status === 'autorizada') {
            return { tipo: 'nfce_autorizada', homologacao: ambiente !== 'producao' };
        }
        if (status === 'processando' || status === 'pendente') return { tipo: 'nfce_processando' };
        return {
            tipo: 'nfce_falhou',
            motivo: venda?.nfce_mensagem || 'A SEFAZ/gateway não autorizou a nota.',
        };
    }
    return { tipo: 'nao_fiscal', offline: Boolean(venda?.offline) };
}

/**
 * Modal pós-venda: mostra o TROCO em destaque e diz com honestidade que
 * documento saiu — NFC-e autorizada (ou não) ou comprovante não fiscal.
 */
const NotaFiscalModal = ({
    mostrar,
    venda,
    nfceAmbiente,
    emailCliente,
    onEnviarEmail,
    onVisualizar,
    onImprimir,
    onFechar,
    enviando = false
}: NotaFiscalModalProps) => {
    const [email, setEmail] = useState(emailCliente || '');
    const [emailValido, setEmailValido] = useState(!!emailCliente);

    const validarEmail = (valor: string) => {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(valor);
    };

    useEffect(() => {
        const emailInicial = emailCliente || '';
        setEmail(emailInicial);
        setEmailValido(!!emailInicial && validarEmail(emailInicial));
    }, [emailCliente, mostrar]);

    const handleEmailChange = (valor: string) => {
        setEmail(valor);
        setEmailValido(validarEmail(valor));
    };

    const handleEnviar = () => {
        if (emailValido && email) {
            onEnviarEmail(email);
        }
    };

    const situacao = situacaoDoDocumento(venda, nfceAmbiente);
    const ehNfce = situacao.tipo === 'nfce_autorizada';
    const troco = Number(venda?.troco || 0);
    const total = Number(venda?.total || 0);
    const recebido = Number(venda?.valorRecebido || 0);
    const nomeDocumento = ehNfce ? 'NFC-e' : 'comprovante';

    return (
        <ResponsiveModal
            isOpen={mostrar}
            onClose={onFechar}
            title="Venda concluída"
            subtitle={venda?.codigo ? `Venda ${venda.codigo}` : undefined}
            headerIcon={<CheckCircle2 className="w-6 h-6" />}
            headerColor="green"
            size="md"
            footer={
                <button
                    onClick={onFechar}
                    disabled={enviando}
                    autoFocus
                    className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                >
                    <span>Nova venda</span>
                    <ChevronRight className="w-5 h-5" />
                </button>
            }
        >
            <div className="space-y-6">
                {/* TROCO em destaque — é o que o caixa precisa ver agora */}
                <div className={`rounded-2xl border-2 p-5 text-center ${troco > 0
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'}`}>
                    <p className={`text-xs font-black uppercase tracking-widest ${troco > 0 ? 'text-green-700 dark:text-green-300' : 'text-slate-500 dark:text-slate-400'}`}>
                        Troco
                    </p>
                    <p className={`text-5xl font-black tabular-nums leading-tight ${troco > 0 ? 'text-green-700 dark:text-green-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        {formatCurrency(troco)}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                        Total {formatCurrency(total)}{recebido > 0 ? ` · Recebido ${formatCurrency(recebido)}` : ''}
                    </p>
                </div>

                {/* Situação do documento — sem prometer nota fiscal que não saiu */}
                {situacao.tipo === 'nfce_autorizada' && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                        <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-bold text-emerald-800 dark:text-emerald-200">NFC-e autorizada</p>
                            {situacao.homologacao && (
                                <p className="text-amber-700 dark:text-amber-300 font-semibold">Ambiente de homologação: nota de teste, sem valor fiscal.</p>
                            )}
                        </div>
                    </div>
                )}
                {situacao.tipo === 'nfce_processando' && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                            NFC-e em processamento na SEFAZ. Acompanhe em Fiscal → Documentos.
                        </p>
                    </div>
                )}
                {situacao.tipo === 'nfce_falhou' && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-bold text-amber-800 dark:text-amber-200">A venda foi registrada, mas a NFC-e não foi autorizada.</p>
                            <p className="text-amber-700 dark:text-amber-300 wrap-break-word">{situacao.motivo}</p>
                        </div>
                    </div>
                )}
                {situacao.tipo === 'nao_fiscal' && (
                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                        <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {situacao.offline
                                ? 'Venda salva sem internet. O comprovante fica disponível depois da sincronização.'
                                : 'Comprovante (não fiscal) — nenhuma NFC-e foi emitida nesta venda.'}
                        </p>
                    </div>
                )}

                {/* Comprovante: imprimir/visualizar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        onClick={onImprimir}
                        disabled={enviando}
                        className="p-4 bg-white dark:bg-gray-800 border-2 border-slate-100 dark:border-slate-800 rounded-2xl flex items-center gap-3 hover:border-red-500 hover:bg-red-50/30 transition-all group"
                    >
                        <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-xl group-hover:bg-red-600 transition-colors">
                            <Printer className="w-6 h-6 text-red-600 dark:text-red-400 group-hover:text-white" />
                        </div>
                        <div className="text-left">
                            <p className="font-black text-slate-800 dark:text-white text-sm">Imprimir {nomeDocumento}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Impressora do caixa (80 mm)</p>
                        </div>
                    </button>

                    <button
                        onClick={onVisualizar}
                        disabled={enviando}
                        className="p-4 bg-white dark:bg-gray-800 border-2 border-slate-100 dark:border-slate-800 rounded-2xl flex items-center gap-3 hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all group"
                    >
                        <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl group-hover:bg-slate-600 transition-colors">
                            <Eye className="w-6 h-6 text-slate-600 dark:text-slate-400 group-hover:text-white" />
                        </div>
                        <div className="text-left">
                            <p className="font-black text-slate-800 dark:text-white text-sm">Ver na tela</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Mostrar ao cliente</p>
                        </div>
                    </button>
                </div>

                <div className="h-px bg-gray-100 dark:bg-gray-700"></div>

                {/* Envio por e-mail */}
                <div className="relative">
                    <label className="block text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5 ml-1">
                        Enviar {nomeDocumento} por e-mail
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="email"
                            inputMode="email"
                            value={email}
                            onChange={(e) => handleEmailChange(e.target.value)}
                            placeholder="cliente@exemplo.com"
                            className={`flex-1 min-w-0 px-4 py-3.5 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white border-2 rounded-xl focus:ring-2 transition-all outline-none ${email && !emailValido
                                ? 'border-red-200 focus:ring-red-500'
                                : 'border-gray-100 dark:border-gray-700 focus:ring-blue-500'
                                }`}
                            disabled={enviando}
                        />
                        <button
                            onClick={handleEnviar}
                            disabled={!emailValido || !email || enviando}
                            aria-label="Enviar por e-mail"
                            className={`px-4 rounded-xl font-bold transition-all flex items-center gap-2 ${!emailValido || !email || enviando
                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20'
                                }`}
                        >
                            {enviando ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            ) : (
                                <>
                                    <Mail className="w-5 h-5" />
                                    <span className="hidden sm:inline">Enviar</span>
                                </>
                            )}
                        </button>
                    </div>
                    {email && !emailValido && (
                        <p className="text-[11px] text-red-500 font-bold mt-1 ml-1 flex items-center gap-1">
                            <X className="w-3 h-3" /> E-mail inválido
                        </p>
                    )}
                </div>
            </div>
        </ResponsiveModal>
    );
};

export default NotaFiscalModal;
