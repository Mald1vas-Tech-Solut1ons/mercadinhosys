import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import toast from 'react-hot-toast';
import { deliveryService, Entrega } from './deliveryService';

export default function AcertoEntregaModal({ entrega, onClose, onSuccess }: {
    entrega: Entrega; onClose: () => void; onSuccess: () => void;
}) {
    const [chave] = useState(() => crypto.randomUUID());
    const [forma, setForma] = useState('dinheiro');
    const [valor, setValor] = useState(String(entrega.valor_a_receber || 0));
    const [enviando, setEnviando] = useState(false);
    const [tentativa, setTentativa] = useState<{ forma_pagamento: string; valor: string }[] | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);
    const saldo = entrega.valor_a_receber || 0;
    const recebido = Number(valor.replace(',', '.'));
    const dinheiro = forma === 'dinheiro';
    const valido = Number.isFinite(recebido) && recebido >= saldo && (dinheiro || recebido === saldo);
    const salvar = async () => {
        const pagamentos = tentativa || [{ forma_pagamento: forma, valor: valor.replace(',', '.') }];
        setTentativa(pagamentos);
        setEnviando(true);
        try {
            await deliveryService.receberEntrega(entrega.id, chave, pagamentos);
            toast.success('Acerto da entrega registrado');
            onSuccess();
        } catch (error: unknown) {
            // Em erro de rede, repetir exatamente a mesma operação evita duplicação.
            const resposta = isAxiosError<{ error?: string }>(error) ? error.response : undefined;
            if (resposta && resposta.status < 500) setTentativa(null);
            toast.error(resposta?.data?.error || 'Resposta não confirmada. Tente novamente para conferir o acerto.');
        } finally {
            setEnviando(false);
        }
    };
    return <dialog ref={dialog} aria-labelledby="titulo-acerto" onCancel={event => {
        event.preventDefault();
        if (!enviando) onClose();
    }} className="w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white dark:bg-gray-900 dark:text-white p-6 backdrop:bg-black/60">
        <div className="space-y-4">
            <h3 id="titulo-acerto" className="text-lg font-bold">Acerto da entrega #{entrega.codigo_rastreamento}</h3>
            <p>Saldo a receber: <b>{saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b></p>
            <p className="text-sm text-gray-500">Registre o valor já recebido. Para Pix ou cartão, confira o comprovante antes de confirmar.</p>
            <label className="block">Forma de pagamento
                <select value={forma} disabled={enviando || !!tentativa} onChange={e => setForma(e.target.value)} className="block w-full border rounded-lg p-2 dark:bg-gray-800">
                    <option value="dinheiro">Dinheiro</option><option value="pix">Pix</option>
                    <option value="cartao_credito">Cartão de crédito</option><option value="cartao_debito">Cartão de débito</option>
                </select>
            </label>
            <label className="block">Valor recebido (R$)
                <input inputMode="decimal" value={valor} disabled={enviando || !!tentativa} onChange={e => setValor(e.target.value)} className="block w-full border rounded-lg p-2 dark:bg-gray-800" />
            </label>
            {dinheiro && valido && <p>Troco: {(recebido - saldo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
            {tentativa && <p className="text-sm">Reenvie para confirmar o resultado da tentativa anterior.</p>}
            <div className="flex justify-end gap-3">
                <button disabled={enviando} onClick={onClose} className="rounded-lg border px-4 py-2">Fechar</button>
                <button disabled={enviando || (!valido && !tentativa)} onClick={salvar} className="rounded-lg bg-primary-600 text-white px-4 py-2 disabled:opacity-50">{enviando ? 'Registrando...' : tentativa ? 'Conferir acerto' : 'Confirmar recebimento'}</button>
            </div>
        </div>
    </dialog>;
}
