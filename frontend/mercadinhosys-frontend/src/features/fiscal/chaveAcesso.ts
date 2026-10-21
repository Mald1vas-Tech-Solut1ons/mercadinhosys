/**
 * Interpretação do que o operador leu/colou para dar entrada numa nota.
 *
 * - QR Code da NFC-e: URL da SEFAZ com `?p=<chave>|<versão>|<amb>|<idCSC>|<hash>`
 *   (ou `chNFe=` no layout antigo). Em SP, a consulta pública traz os itens.
 * - Código de barras do DANFE (NF-e do fornecedor): 44 dígitos, às vezes em blocos de 4.
 *
 * Espelha backend/app/services/fiscal/chave_acesso.py (DV módulo 11, UF, modelo).
 */

export const UF_POR_CODIGO: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
    '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export const MSG_SO_SP = 'Leitura por QR Code disponível para NFC-e de SP. Para outras UFs, importe o XML.';

export function digitoVerificador(base43: string): string {
    let soma = 0;
    let peso = 2;
    for (let i = base43.length - 1; i >= 0; i--) {
        soma += Number(base43[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? '0' : String(11 - resto);
}

export interface ChaveInfo {
    chave: string;
    uf: string;
    modelo: '55' | '65';
    numero: string;
    serie: string;
}

/** Valida 44 dígitos (DV, UF, modelo). Devolve a mensagem de erro em `erro`. */
export function validarChave(chave: string): { ok: true; info: ChaveInfo } | { ok: false; erro: string } {
    if (!/^\d{44}$/.test(chave)) return { ok: false, erro: 'A chave de acesso deve ter 44 dígitos.' };
    if (digitoVerificador(chave.slice(0, 43)) !== chave[43]) {
        return { ok: false, erro: 'Dígito verificador da chave não confere. Confira a leitura ou digitação.' };
    }
    const uf = UF_POR_CODIGO[chave.slice(0, 2)];
    if (!uf) return { ok: false, erro: 'Código de UF da chave inválido.' };
    const modelo = chave.slice(20, 22);
    if (modelo !== '55' && modelo !== '65') {
        return { ok: false, erro: 'Modelo do documento inválido (esperado 55 NF-e ou 65 NFC-e).' };
    }
    return {
        ok: true,
        info: {
            chave, uf, modelo,
            serie: String(Number(chave.slice(22, 25))),
            numero: String(Number(chave.slice(25, 34))),
        },
    };
}

export type LeituraNota =
    | { tipo: 'qrcode_sp'; url: string; info: ChaveInfo }
    | { tipo: 'chave'; info: ChaveInfo; deQrCode: boolean }
    | { tipo: 'erro'; erro: string };

function parametro(query: string, nome: string): string | null {
    const m = query.match(new RegExp(`(?:^|[?&])${nome}=([^&\\s]+)`, 'i'));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Acha uma URL dentro de um texto compartilhado ("Veja: https://...") ou devolve o texto. */
export function extrairUrl(texto: string): string {
    const m = (texto || '').match(/https?:\/\/\S+/i);
    return m ? m[0] : (texto || '').trim();
}

/**
 * Decide o que fazer com o texto lido:
 * - QR de NFC-e de SP com hash → consultar a SEFAZ-SP (itens);
 * - QR de outra UF → mensagem "só SP";
 * - 44 dígitos (DANFE) → consultar se a nota já entrou.
 */
export function interpretarLeitura(bruto: string): LeituraNota {
    const texto = extrairUrl(bruto);
    if (!texto) return { tipo: 'erro', erro: 'Nada foi lido.' };

    if (/^https?:\/\//i.test(texto) || texto.includes('?')) {
        const query = texto.includes('?') ? texto.slice(texto.indexOf('?')) : '';
        const p = parametro(query, 'p');
        const chNFe = parametro(query, 'chNFe');
        const chave = ((p ?? '').split('|')[0] || chNFe || '').replace(/\D/g, '');
        if (chave.length !== 44) {
            return {
                tipo: 'erro',
                erro: 'Esse endereço não é o conteúdo do QR Code da nota (falta "?p=" com a chave). '
                    + 'Escaneie o QR Code impresso no cupom ou use a foto.',
            };
        }
        const v = validarChave(chave);
        if (!v.ok) return { tipo: 'erro', erro: v.erro };
        if (v.info.uf !== 'SP') return { tipo: 'erro', erro: MSG_SO_SP };
        const campos = (p ?? '').split('|');
        if (v.info.modelo === '65' && p && campos.length >= 4 && campos[campos.length - 1].trim()) {
            return { tipo: 'qrcode_sp', url: texto, info: v.info };
        }
        // QR antigo ou sem hash: só dá para checar se a nota já entrou.
        return { tipo: 'chave', info: v.info, deQrCode: true };
    }

    const digitos = texto.replace(/[\s.\-/]/g, '');
    if (!/^\d+$/.test(digitos)) return { tipo: 'erro', erro: 'O código lido não é uma chave de nota nem um QR Code de NFC-e.' };
    const v = validarChave(digitos);
    if (!v.ok) return { tipo: 'erro', erro: v.erro };
    return { tipo: 'chave', info: v.info, deQrCode: false };
}
