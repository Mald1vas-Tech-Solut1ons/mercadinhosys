/**
 * Leva o lojista até o campo que impede o salvamento: rola até ele, coloca o cursor (abre o teclado no
 * celular) e contorna em vermelho até ele mexer. O toast só explica; quem resolve é o foco no campo.
 *
 * Cada campo do formulário é marcado com `data-campo="<chave>"` (no próprio input ou num contêiner).
 */
const DESTAQUE_MS = 6000;

export function irParaCampo(raiz: HTMLElement | null, campo: string): boolean {
    if (!raiz) return false;
    const alvo = raiz.querySelector<HTMLElement>(`[data-campo="${CSS.escape(campo)}"]`);
    if (!alvo) return false;

    const focavel = alvo.matches('input, select, textarea, button')
        ? alvo
        : alvo.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea, button');

    try {
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
        alvo.scrollIntoView();
    }
    // Foco depois do início da rolagem: sem preventScroll o navegador "pula" e briga com o smooth.
    window.setTimeout(() => {
        try {
            focavel?.focus({ preventScroll: true });
        } catch {
            focavel?.focus();
        }
    }, 250);

    const contorno = alvo.matches('input, select, textarea') ? alvo : (focavel || alvo);
    contorno.style.outline = '2px solid #ef4444';
    contorno.style.outlineOffset = '2px';
    contorno.setAttribute('aria-invalid', 'true');
    const limpar = () => {
        contorno.style.outline = '';
        contorno.style.outlineOffset = '';
        contorno.removeAttribute('aria-invalid');
    };
    window.setTimeout(limpar, DESTAQUE_MS);
    alvo.addEventListener('input', limpar, { once: true });
    alvo.addEventListener('change', limpar, { once: true });
    return true;
}

/** Erro devolvido pelo servidor → campo do formulário (o que dá para saber pelo código ou pela mensagem). */
export function campoDoErroServidor(resposta: { code?: string; message?: string; errors?: string[] } | undefined): string | null {
    if (!resposta) return null;
    const codigo = resposta.code || '';
    if (codigo === 'categoria_invalida') return 'subcategoria';
    if (codigo === 'PRODUTO_DUPLICADO_EAN') return 'codigo_barras';
    if (codigo === 'PRODUTO_DUPLICADO_CODIGO') return 'codigo_interno';
    const texto = [resposta.message, ...(resposta.errors || [])].filter(Boolean).join(' ').toLowerCase();
    const regras: Array<[RegExp, string]> = [
        [/nome do (produto|servi[cç]o)|campo nome/, 'nome'],
        [/fabrica[cç][aã]o/, 'data_fabricacao'],
        [/validade/, 'data_validade'],
        [/\blote\b/, 'lote'],
        [/subcategoria|categoria/, 'subcategoria'],
        [/c[oó]digo de barras|gtin|\bean\b/, 'codigo_barras'],
        [/\bcest\b/, 'cest'],
        [/\bncm\b/, 'ncm'],
        [/pre[cç]o de custo|preco custo|\bcusto\b/, 'preco_custo'],
        [/pre[cç]o de venda|preco venda|\bvenda\b/, 'preco_venda'],
        [/unidade/, 'unidade_medida'],
        [/estoque|quantidade/, 'quantidade'],
        [/\bnome\b/, 'nome'],
    ];
    for (const [padrao, campo] of regras) {
        if (padrao.test(texto)) return campo;
    }
    return null;
}
