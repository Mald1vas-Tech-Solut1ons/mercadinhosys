// Fila offline do vendedor: só falha de rede/servidor entra na fila.
// Recusa de regra de negócio (4xx) volta ao vendedor com o motivo; o
// offline_uuid de cada pedido torna o reenvio idempotente no servidor.
import { apiClient } from '../../api/apiClient';

const FILA = '@sfa_fila_pedidos';
const RECUSADOS = '@sfa_pedidos_recusados';

const ler = (chave: string): any[] => {
    try {
        const valor = JSON.parse(localStorage.getItem(chave) || '[]');
        return Array.isArray(valor) ? valor : [];
    } catch {
        return [];
    }
};

export const deveReenviar = (error: any) => !error?.response || error.response.status >= 500;

export const motivoRecusa = (error: any) =>
    error?.response?.data?.message || error?.response?.data?.error || 'Pedido recusado pelo servidor';

export const enfileirarPedido = (pedido: any) => {
    localStorage.setItem(FILA, JSON.stringify([...ler(FILA), pedido]));
};

export const pedidosRecusados = () => ler(RECUSADOS);

export async function enviarFilaPedidos() {
    const fila = ler(FILA);
    const recusados = ler(RECUSADOS);
    let enviados = 0;
    let novosRecusados = 0;
    let restantes: any[] = [];
    for (let i = 0; i < fila.length; i++) {
        try {
            await apiClient.post('/sfa/sync-pedidos', { pedidos: [fila[i]] });
            enviados++;
        } catch (error: any) {
            if (deveReenviar(error)) {
                restantes = fila.slice(i);
                break;
            }
            recusados.push({ ...fila[i], motivo: motivoRecusa(error) });
            novosRecusados++;
        }
    }
    localStorage.setItem(FILA, JSON.stringify(restantes));
    localStorage.setItem(RECUSADOS, JSON.stringify(recusados));
    return { enviados, recusados: novosRecusados, pendentes: restantes.length };
}
