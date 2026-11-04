/** Escolha de cookies do visitante (LGPD), gravada pelo BannerCookies. */
export const CHAVE_CONSENTIMENTO = 'mercadinhosys_consentimento_cookies';
export const VERSAO_CONSENTIMENTO = 1;

type Escolha = { medicao: boolean; em: string; versao: number };

export function lerEscolhaCookies(): Escolha | null {
    try {
        const bruto = localStorage.getItem(CHAVE_CONSENTIMENTO);
        if (!bruto) return null;
        const e = JSON.parse(bruto) as Escolha;
        return e.versao === VERSAO_CONSENTIMENTO ? e : null;
    } catch {
        return null;
    }
}

/** true só quando o visitante aceitou a medição de uso. */
export function podeMedirUso(): boolean {
    return lerEscolhaCookies()?.medicao === true;
}
