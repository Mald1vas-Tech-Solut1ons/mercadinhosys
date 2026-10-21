/**
 * Mensagem de erro legível para o operador, a partir de qualquer erro
 * (axios, Error comum, string).
 *
 * Ordem de preferência:
 *  1. Sem resposta do servidor → rede/timeout (nunca "Network Error" em inglês).
 *  2. Corpo da resposta: `message` / `error` / `msg` e a lista `errors`
 *     (array ou objeto campo → mensagem). Página HTML do Flask (abort(403, …))
 *     vira o texto do <p>.
 *  3. Status HTTP conhecido (401/403/404/413/429/5xx).
 *  4. `Error.message` de erros lançados pelo próprio front (já em português).
 *  5. `padrao`.
 *
 * Em 5xx o campo `message`/`msg` costuma carregar `str(e)` do Python (detalhe
 * técnico), então só `error` é aproveitado nesses casos.
 */

type Dict = Record<string, unknown>;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const MENSAGENS_GENERICAS = new Set([
    'erros de validação',
    'erro de validação',
    'dados inválidos',
]);

function textoDeHtml(html: string): string {
    const p = html.match(/<p>([\s\S]*?)<\/p>/i);
    const bruto = p ? p[1] : html.replace(/<[^>]+>/g, ' ');
    return bruto.replace(/\s+/g, ' ').trim();
}

function pareceHtml(s: string): boolean {
    return /<\s*(html|!doctype|p|h1|title|body)\b/i.test(s);
}

function listaDeErros(errors: unknown): string[] {
    if (!errors) return [];
    if (isStr(errors)) return [errors.trim()];
    if (Array.isArray(errors)) {
        return errors.flatMap(item => {
            if (isStr(item)) return [item.trim()];
            if (item && typeof item === 'object') {
                const o = item as Dict;
                const msg = o.message ?? o.msg ?? o.error ?? o.erro;
                if (isStr(msg)) return [o.campo || o.field ? `${String(o.campo ?? o.field)}: ${msg}` : msg];
            }
            return [];
        });
    }
    if (typeof errors === 'object') {
        return Object.entries(errors as Dict).flatMap(([campo, valor]) => {
            if (isStr(valor)) return [`${campo}: ${valor}`];
            if (Array.isArray(valor)) {
                const msgs = valor.filter(isStr);
                return msgs.length ? [`${campo}: ${msgs.join(', ')}`] : [];
            }
            return [];
        });
    }
    return [];
}

function doCorpo(data: unknown, status: number): string | null {
    if (data == null) return null;
    if (isStr(data)) {
        // Proxy/servidor fora (Render acordando) devolve HTML genérico em 5xx: não serve.
        if (status >= 500) return null;
        const texto = pareceHtml(data) ? textoDeHtml(data) : data.trim();
        return texto && texto.length <= 300 ? texto : null;
    }
    if (typeof data !== 'object') return null;
    const d = data as Dict;
    const erros = listaDeErros(d.errors ?? d.erros);
    const base = status >= 500
        ? (isStr(d.error) ? d.error : null)
        : ([d.message, d.error, d.msg, d.mensagem].find(isStr) as string | undefined) ?? null;

    if (erros.length) {
        const prefixo = base && !MENSAGENS_GENERICAS.has(base.trim().toLowerCase()) ? `${base}: ` : '';
        return `${prefixo}${erros.join('; ')}`;
    }
    return base ? base.trim() : null;
}

function porStatus(status: number): string | null {
    if (status === 401) return 'Sua sessão expirou. Entre novamente.';
    if (status === 403) return 'Você não tem permissão para esta ação.';
    if (status === 404) return 'Registro não encontrado.';
    if (status === 413) return 'Arquivo ou dados grandes demais.';
    if (status === 429) return 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.';
    if (status === 502 || status === 503 || status === 504) {
        return 'O servidor está indisponível no momento. Tente de novo em instantes.';
    }
    if (status >= 500) return 'Erro no servidor. Tente de novo; se continuar, avise o suporte.';
    return null;
}

export const MSG_SEM_CONEXAO = 'Não foi possível falar com o servidor. Verifique a internet ou tente de novo em instantes.';

/** true quando a requisição nem chegou a ter resposta (rede, timeout, servidor fora). */
export function ehErroDeRede(err: unknown): boolean {
    const e = err as { response?: unknown; request?: unknown; code?: string; isAxiosError?: boolean } | null;
    if (!e || typeof e !== 'object') return false;
    const pareceAxios = e.isAxiosError === true || 'request' in e || 'config' in e;
    return pareceAxios && !e.response;
}

export function mensagemErro(err: unknown, padrao = 'Não foi possível concluir a operação.'): string {
    if (err == null) return padrao;
    if (isStr(err)) return err;

    const e = err as {
        response?: { status?: number; data?: unknown };
        code?: string;
        message?: string;
        isAxiosError?: boolean;
    };

    if (ehErroDeRede(err)) {
        if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || '')) {
            return 'O servidor demorou para responder. Tente de novo em instantes.';
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return 'Sem internet neste aparelho. Verifique a conexão.';
        }
        return MSG_SEM_CONEXAO;
    }

    if (e.response) {
        const status = Number(e.response.status) || 0;
        return doCorpo(e.response.data, status) || porStatus(status) || padrao;
    }

    // Error lançado pelo próprio front (mensagens já em português).
    if (isStr(e.message) && !/^(Network Error|Request failed with status code)/i.test(e.message)) {
        return e.message;
    }
    return padrao;
}

/**
 * Login: separa "servidor fora" de "credencial errada" de "conta/assinatura
 * bloqueada". O backend (routes/auth.py) devolve `code` USER_NOT_FOUND /
 * WRONG_PASSWORD (401) e ACCOUNT_INACTIVE (403); trial expirado/assinatura
 * suspensa chegam como 403 com o texto do abort() — repassado como está.
 */
export function mensagemErroLogin(err: unknown): string {
    if (ehErroDeRede(err)) return mensagemErro(err);
    const resp = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (!resp) return mensagemErro(err, 'Não foi possível entrar. Tente de novo.');
    const status = Number(resp.status) || 0;
    const data = (resp.data && typeof resp.data === 'object' ? resp.data : {}) as Dict;
    const code = isStr(data.code) ? data.code : '';

    if (code === 'USER_NOT_FOUND' || code === 'WRONG_PASSWORD' || status === 401) {
        return 'Usuário ou senha incorretos.';
    }
    if (code === 'ACCOUNT_INACTIVE') {
        return 'Este usuário está inativo. Fale com o administrador da loja.';
    }
    if (status === 403) {
        return doCorpo(resp.data, status)
            || 'Acesso bloqueado. Verifique a assinatura da loja no painel de cobrança.';
    }
    if (status >= 500) return porStatus(status) as string;
    return mensagemErro(err, 'Não foi possível entrar. Tente de novo.');
}

export default mensagemErro;
