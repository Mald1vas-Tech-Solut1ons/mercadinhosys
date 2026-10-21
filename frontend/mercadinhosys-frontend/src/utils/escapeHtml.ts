/**
 * Escapa texto para interpolar em HTML montado como string (innerHTML, document.write).
 * Todo dado vindo do banco (nome de produto, cliente, lote...) deve passar por aqui:
 * sem isso, um nome como `<img src=x onerror=...>` executa script na origem do app.
 */
export function escapeHtml(valor: unknown): string {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
