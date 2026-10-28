import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';

/**
 * Confirmação do sistema no lugar do `window.confirm` (caixa cinza do navegador,
 * que no celular trava a tela). Uso:
 *
 *   if (!(await confirmar({ titulo: 'Cancelar venda?', acao: 'Cancelar venda', perigo: true }))) return;
 *
 * `<ConfirmacaoHost />` é montado uma vez no App.
 */
export interface OpcoesConfirmacao {
    titulo: string;
    mensagem?: string;
    /** Texto do botão que confirma — nomeie a ação ("Inativar conta"), nunca "OK". */
    acao?: string;
    cancelar?: string;
    perigo?: boolean;
}

type Pedido = OpcoesConfirmacao & { responder: (ok: boolean) => void };

let mostrar: ((p: Pedido) => void) | null = null;

export function confirmar(opcoes: OpcoesConfirmacao): Promise<boolean> {
    return new Promise((resolve) => {
        if (!mostrar) {
            // Host ainda não montado (não deve acontecer): cai no nativo para não perder a decisão.
            resolve(window.confirm([opcoes.titulo, opcoes.mensagem].filter(Boolean).join('\n\n')));
            return;
        }
        mostrar({ ...opcoes, responder: resolve });
    });
}

export function ConfirmacaoHost() {
    const [pedido, setPedido] = useState<Pedido | null>(null);
    const botaoRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        mostrar = setPedido;
        return () => { mostrar = null; };
    }, []);

    useEffect(() => {
        if (!pedido) return;
        setTimeout(() => botaoRef.current?.focus(), 0);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); responder(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pedido]);

    const responder = (ok: boolean) => {
        pedido?.responder(ok);
        setPedido(null);
    };

    if (!pedido) return null;
    const Icone = pedido.perigo ? AlertTriangle : HelpCircle;

    return (
        <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50 p-4" onMouseDown={() => responder(false)}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="confirmacao-titulo"
                className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-6"
                onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex gap-4">
                    <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${pedido.perigo
                        ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                        <Icone className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 id="confirmacao-titulo" className="text-base font-bold text-gray-900 dark:text-white">{pedido.titulo}</h2>
                        {pedido.mensagem && (
                            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{pedido.mensagem}</p>
                        )}
                    </div>
                </div>
                <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <button type="button" onClick={() => responder(false)}
                        className="min-h-[44px] px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                        {pedido.cancelar || 'Voltar'}
                    </button>
                    <button ref={botaoRef} type="button" onClick={() => responder(true)}
                        className={`min-h-[44px] px-4 rounded-xl text-sm font-bold text-white ${pedido.perigo
                            ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {pedido.acao || 'Confirmar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
