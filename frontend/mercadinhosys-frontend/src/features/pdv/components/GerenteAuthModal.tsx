import { useState } from 'react';
import { ShieldCheck, Lock, X, AlertTriangle, KeyRound } from 'lucide-react';
import { pdvService } from '../pdvService';
import ResponsiveModal from '../../../components/ui/ResponsiveModal';

interface GerenteAuthModalProps {
    acao: 'desconto' | 'cancelamento';
    valorDesconto?: number;
    onAutorizado: () => void;
    onCancelar: () => void;
}

const GerenteAuthModal = ({
    acao,
    valorDesconto,
    onAutorizado,
    onCancelar,
}: GerenteAuthModalProps) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErro(null);
        setLoading(true);

        try {
            const autorizado = await pdvService.autorizarGerente({
                username,
                password,
                acao,
                valor_desconto: valorDesconto,
            });

            if (autorizado) {
                onAutorizado();
            } else {
                setErro('Usuário sem permissão para esta ação');
            }
        } catch (error: unknown) {
            const err = error as any;
            setErro(err.response?.data?.error || 'Credenciais inválidas');
        } finally {
            setLoading(false);
        }
    };

    const getTitulo = () => {
        switch (acao) {
            case 'desconto':
                return 'Autorizar Desconto';
            case 'cancelamento':
                return 'Autorizar Cancelamento';
            default:
                return 'Autorização de Gerente';
        }
    };

    const getDescricao = () => {
        switch (acao) {
            case 'desconto':
                return `Valor: R$ ${valorDesconto?.toFixed(2)}`;
            case 'cancelamento':
                return 'Esta ação excluirá o registro da venda';
            default:
                return 'Credenciais de nível superior necessárias';
        }
    };

    return (
        <ResponsiveModal
            isOpen={true}
            onClose={onCancelar}
            title={getTitulo()}
            subtitle="Apenas gerentes ou administradores"
            headerIcon={<ShieldCheck className="w-6 h-6" />}
            headerColor="red"
            size="md"
            footer={
                <div className="flex w-full gap-3">
                    <button
                        type="button"
                        onClick={onCancelar}
                        className="flex-1 py-3 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-all border border-gray-200 dark:border-gray-600"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !username || !password}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${loading || !username || !password
                            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
                            }`}
                    >
                        {loading ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        ) : (
                            <>
                                <KeyRound className="w-5 h-5" />
                                <span>Autorizar</span>
                            </>
                        )}
                    </button>
                </div>
            }
        >
            <div className="space-y-6">
                {/* Banner de Info */}
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-2xl">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-red-800 dark:text-red-300 text-sm">Ação Restrita</h4>
                            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{getDescricao()}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {erro && (
                        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl flex items-center gap-2 text-orange-700 dark:text-orange-400">
                            <X className="w-4 h-4 shrink-0" />
                            <p className="text-xs font-semibold">{erro}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">
                            Usuário
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Username do gerente"
                            className="w-full px-4 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all outline-none"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider ml-1">
                            Senha
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-4 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all outline-none"
                            />
                            <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 pointer-events-none" />
                        </div>
                    </div>
                </div>

                <p className="text-[10px] text-center text-gray-400 dark:text-gray-500 italic pb-2">
                    Esta autorização será registrada nos logs de segurança do sistema.
                </p>
            </div>
        </ResponsiveModal>
    );
};

export default GerenteAuthModal;
