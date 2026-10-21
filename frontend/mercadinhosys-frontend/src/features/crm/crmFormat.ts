/** Formatação e classes compartilhadas pelas telas do CRM (fora do arquivo de componentes por causa do fast refresh). */

export const campo = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ' +
    'focus:outline-none focus:ring-2 focus:ring-ring';

export const dataHora = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const dataCurta = (iso?: string | null) => {
    if (!iso) return '—';
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
};
