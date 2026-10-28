export const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
};

export const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '---';
    try {
        // Data pura (validade, vencimento) é um dia do calendário: "2026-10-27" lido como UTC
        // virava 26/10 às 21h no Brasil. Com hora, o instante é convertido para o horário local.
        const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? new Date(`${date}T00:00:00`)
            : new Date(date);
        if (isNaN(d.getTime())) return '---';
        return new Intl.DateTimeFormat('pt-BR').format(d);
    } catch (e) {
        return '---';
    }
};

export const formatDateTime = (date: string | Date | null | undefined): string => {
    if (!date) return '---';
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '---';
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(d);
    } catch (e) {
        return '---';
    }
};

export const formatCPF = (cpf: string): string => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

export const formatPhone = (phone: string): string => {
    return phone.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
};

/**
 * Corrige URLs de imagem que utilizam o serviço via.placeholder.com (que está instável/fora do ar)
 * substituindo pelo serviço placehold.co.
 */
export const fixImageUrl = (url: string | null | undefined): string | undefined => {
    if (!url) return undefined;
    if (url.includes('via.placeholder.com')) {
        return url.replace('via.placeholder.com', 'placehold.co');
    }
    return url;
};
