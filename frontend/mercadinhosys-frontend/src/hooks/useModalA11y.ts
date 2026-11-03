import { useEffect, useRef } from 'react';

/**
 * Acessibilidade de modal que o operador de PDV precisa (e não tinha).
 *
 * Sem isto: o caixa conclui a venda, abre o comprovante, aperta Esc para voltar a
 * bipar e nada acontece — ele pega o mouse. Quem usa leitor de tela não ouve
 * "diálogo aberto", e o Tab escapa para a tela de trás.
 *
 * Entrega: Esc fecha, foco entra no diálogo, Tab fica preso dentro dele e o foco
 * volta para o elemento que abriu ao fechar.
 */
export function useModalA11y(open: boolean, onClose: () => void) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // onClose costuma vir inline (`() => setAberto(false)`) e muda a cada render. Se ele
    // entrasse nas dependências, cada tecla digitada no formulário refazia o efeito:
    // o foco voltava para o botão de trás e depois para o 1º campo do modal — no celular
    // o teclado fechava/pulava de campo no meio da digitação.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;

        const anterior = document.activeElement as HTMLElement | null;
        const container = containerRef.current;

        const focaveis = () => Array.from(
            container?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
        ).filter(el => el.offsetParent !== null);

        // Foco inicial: o próprio diálogo (leitor de tela anuncia; Tab entra nele). Focar o
        // 1º campo abria o teclado do celular sozinho e cobria metade do formulário.
        const toque = window.matchMedia?.('(pointer: coarse)').matches;
        const primeiro = toque ? null : focaveis()[0];
        if (!container?.contains(document.activeElement)) (primeiro ?? container)?.focus({ preventScroll: true });

        const aoTeclar = (evento: KeyboardEvent) => {
            if (evento.key === 'Escape') {
                evento.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (evento.key !== 'Tab') return;

            const itens = focaveis();
            if (itens.length === 0) return;
            const primeiroItem = itens[0];
            const ultimoItem = itens[itens.length - 1];
            const ativo = document.activeElement as HTMLElement | null;

            if (!evento.shiftKey && ativo === ultimoItem) {
                evento.preventDefault();
                primeiroItem.focus();
            } else if (evento.shiftKey && (ativo === primeiroItem || ativo === container)) {
                evento.preventDefault();
                ultimoItem.focus();
            }
        };

        document.addEventListener('keydown', aoTeclar, true);
        return () => {
            document.removeEventListener('keydown', aoTeclar, true);
            anterior?.focus?.();
        };
    }, [open]);

    return containerRef;
}
