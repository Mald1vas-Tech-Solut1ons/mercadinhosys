/**
 * Data "AAAA-MM-DD" no dia LOCAL do aparelho (horário da loja).
 *
 * `new Date().toISOString().split('T')[0]` devolve o dia em UTC: depois das 21h em
 * São Paulo já é "amanhã", e filtros, vencimentos e nomes de arquivo pulavam um dia.
 */
/**
 * Date de um valor vindo da API. Data pura ("2026-10-27": validade, vencimento, ponto) é o dia
 * do calendário — `new Date("2026-10-27")` lê meia-noite UTC e mostra 26/10 no Brasil.
 * Com hora (ISO com offset), igual a `new Date(valor)`.
 */
export function dataDoDia(valor: string | number | Date | null | undefined): Date {
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return new Date(`${valor}T00:00:00`);
    return new Date(valor as string);
}

export function dataLocalISO(d: Date = new Date()): string {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}
