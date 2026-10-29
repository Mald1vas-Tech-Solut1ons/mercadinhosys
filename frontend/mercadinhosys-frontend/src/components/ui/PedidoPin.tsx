import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';

/**
 * Pede o PIN de um Admin/Gerente quando o servidor responde que a ação exige
 * autorização (código PIN_REQUIRED). Quem chama é o interceptor do apiClient,
 * então qualquer tela ganha o pedido sem código próprio. Uso direto:
 *
 *   const pin = await pedirPin({ acao: 'Cadastrar cliente' });  // null = cancelou
 *
 * `<PedidoPinHost />` é montado uma vez no App.
 */
export interface OpcoesPin {
    acao?: string;
    erro?: string;
}

type Pedido = OpcoesPin & { responder: (pin: string | null) => void };

let mostrar: ((p: Pedido) => void) | null = null;

export function pedirPin(opcoes: OpcoesPin): Promise<string | null> {
    return new Promise((resolve) => {
        if (!mostrar) {
            resolve(null);
            return;
        }
        mostrar({ ...opcoes, responder: resolve });
    });
}

export function PedidoPinHost() {
    const [pedido, setPedido] = useState<Pedido | null>(null);
    const [pin, setPin] = useState('');
    const campoRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        mostrar = (p) => { setPin(''); setPedido(p); };
        return () => { mostrar = null; };
    }, []);

    useEffect(() => {
        if (pedido) setTimeout(() => campoRef.current?.focus(), 0);
    }, [pedido]);

    const responder = (valor: string | null) => {
        pedido?.responder(valor);
        setPedido(null);
        setPin('');
    };

    if (!pedido) return null;
    const valido = /^\d{4,6}$/.test(pin);

    return (
        <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50 p-4" onMouseDown={() => responder(null)}>
            <form role="dialog" aria-modal="true" aria-labelledby="pedido-pin-titulo"
                className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-6"
                onMouseDown={(e) => e.stopPropagation()}
                onSubmit={(e) => { e.preventDefault(); if (valido) responder(pin); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); responder(null); } }}>
                <div className="flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                        <KeyRound className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 id="pedido-pin-titulo" className="text-base font-bold text-gray-900 dark:text-white">PIN do gerente</h2>
                        <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">
                            {pedido.acao ? <>“{pedido.acao}” precisa da autorização de um Admin ou Gerente.</> : 'Esta ação precisa da autorização de um Admin ou Gerente.'}
                        </p>
                    </div>
                </div>
                <input ref={campoRef} type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                    aria-label="PIN de 4 a 6 dígitos"
                    value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    className="mt-5 w-full min-h-[48px] rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-center text-2xl tracking-[0.5em] text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500" />
                {pedido.erro && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{pedido.erro}</p>}
                <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" onClick={() => responder(null)}
                        className="min-h-[44px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                        Voltar
                    </button>
                    <button type="submit" disabled={!valido}
                        className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                        Autorizar
                    </button>
                </div>
            </form>
        </div>
    );
}
