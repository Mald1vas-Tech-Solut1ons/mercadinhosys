import { useState, useEffect } from 'react';
import { Lock, X, ShieldAlert } from 'lucide-react';
import settingsService from '../../features/settings/settingsService';

interface PinDialogProps {
    open: boolean;
    title?: string;
    description?: string;
    /** Chamado SOMENTE após o PIN ser validado com sucesso, recebendo o PIN digitado. */
    onSuccess: (pin: string) => void;
    onClose: () => void;
}

/**
 * Modal de autorização por PIN (4-6 dígitos). Valida o PIN no backend
 * (mesmo PIN de admin do estorno) e só dispara onConfirm se for válido.
 * Reutilizável para operações sensíveis (editar/descartar produto, etc.).
 */
const PinDialog = ({ open, title = 'Autorização necessária', description, onSuccess, onClose }: PinDialogProps) => {
    const [pin, setPin] = useState('');
    const [erro, setErro] = useState('');
    const [verificando, setVerificando] = useState(false);

    useEffect(() => {
        if (open) { setPin(''); setErro(''); setVerificando(false); }
    }, [open]);

    if (!open) return null;

    const confirmar = async () => {
        if (pin.length < 4) { setErro('Informe o PIN (4 a 6 dígitos).'); return; }
        setVerificando(true);
        setErro('');
        const ok = await settingsService.verifyPin(pin);
        setVerificando(false);
        if (ok) {
            onSuccess(pin);
        } else {
            setErro('PIN inválido ou sem permissão.');
            setPin('');
        }
    };

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-amber-100 text-amber-600"><ShieldAlert className="w-5 h-5" /></div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>
                {description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>}
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">PIN de segurança</label>
                <div className="relative">
                    <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="password" inputMode="numeric" autoComplete="off" autoFocus
                        value={pin}
                        onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErro(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); }}
                        placeholder="Digite o PIN do administrador"
                        maxLength={6}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
                    />
                </div>
                {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
                <div className="flex gap-2 mt-5">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                        Cancelar
                    </button>
                    <button onClick={confirmar} disabled={verificando || pin.length < 4}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-60">
                        {verificando ? 'Verificando...' : 'Confirmar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PinDialog;
