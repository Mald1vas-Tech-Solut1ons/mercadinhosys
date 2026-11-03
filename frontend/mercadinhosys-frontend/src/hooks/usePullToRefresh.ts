import { useEffect, useRef, useState, type RefObject } from 'react';

interface Options {
    threshold?: number;   // distância (px) para disparar o refresh
    maxPull?: number;     // limite visual do arraste
    enabled?: boolean;
}

/**
 * Elementos onde o arraste para baixo é rolagem, não "atualizar": área rolável
 * interna (chat do Consultor, listas, tabelas), modal/gaveta fixa, mapa, campo
 * de texto, ou quem marcar `data-no-pull-refresh`.
 *
 * Antes o gesto só olhava o scroll do <main>. No Consultor o <main> fica sempre
 * no topo (quem rola é a conversa), então rolar a conversa para cima recarregava
 * a página e apagava o que estava na tela.
 */
function toqueDentroDeRolavel(alvo: EventTarget | null, raiz: HTMLElement): boolean {
    let no = alvo instanceof Element ? alvo : null;
    while (no && no !== raiz) {
        if (no instanceof HTMLElement) {
            if (no.dataset.noPullRefresh !== undefined) return true;
            if (no.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(no.tagName)) return true;
            const estilo = getComputedStyle(no);
            if (estilo.position === 'fixed') return true;
            const rola = /(auto|scroll)/.test(estilo.overflowY) && no.scrollHeight > no.clientHeight + 1;
            if (rola) return true;
            if (no.classList.contains('leaflet-container')) return true;
        }
        no = no.parentElement;
    }
    return false;
}

/**
 * Pull-to-refresh para PWA instalado (modo standalone), onde o navegador NÃO
 * oferece o "puxar para atualizar" nativo. Atribui handlers de toque ao
 * elemento rolável (ex.: <main>) e dispara onRefresh quando o usuário arrasta
 * para baixo estando no topo do scroll.
 *
 * Retorna a distância atual do arraste e o estado de refresh para o indicador.
 */
export function usePullToRefresh(
    scrollRef: RefObject<HTMLElement | null>,
    onRefresh: () => void | Promise<void>,
    { threshold = 70, maxPull = 120, enabled = true }: Options = {},
) {
    const [distance, setDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const startY = useRef<number | null>(null);
    const startX = useRef(0);
    const pulling = useRef(false);
    const distanceRef = useRef(0);
    const refreshingRef = useRef(false);
    const onRefreshRef = useRef(onRefresh);
    useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !enabled) return;

        const mudarDistancia = (d: number) => {
            distanceRef.current = d;
            setDistance(d);
        };

        const onTouchStart = (e: TouchEvent) => {
            // Só inicia no topo do <main>, com um dedo, fora de qualquer área que role sozinha.
            if (el.scrollTop <= 0 && e.touches.length === 1 && !toqueDentroDeRolavel(e.target, el)) {
                startY.current = e.touches[0].clientY;
                startX.current = e.touches[0].clientX;
                pulling.current = true;
            } else {
                pulling.current = false;
                startY.current = null;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!pulling.current || startY.current === null || refreshingRef.current) return;
            const delta = e.touches[0].clientY - startY.current;
            const lateral = Math.abs(e.touches[0].clientX - startX.current);
            // Gesto mais lateral que vertical (carrossel, abas roláveis) não é "atualizar".
            if (lateral > Math.abs(delta)) {
                pulling.current = false;
                mudarDistancia(0);
                return;
            }
            if (delta > 0 && el.scrollTop <= 0) {
                // Resistência: o arraste "pesa" mais perto do limite.
                const d = Math.min(maxPull, delta * 0.5);
                mudarDistancia(d);
                if (e.cancelable) e.preventDefault(); // evita o bounce e segura o gesto
            } else if (delta <= 0) {
                mudarDistancia(0);
            }
        };

        const onTouchEnd = async () => {
            if (!pulling.current) return;
            pulling.current = false;
            startY.current = null;
            if (distanceRef.current >= threshold) {
                refreshingRef.current = true;
                setRefreshing(true);
                mudarDistancia(threshold);
                try {
                    await onRefreshRef.current();
                } finally {
                    // onRefresh normalmente recarrega a página; o reset é defensivo.
                    refreshingRef.current = false;
                    setRefreshing(false);
                    mudarDistancia(0);
                }
            } else {
                mudarDistancia(0);
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchEnd, { passive: true });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [scrollRef, threshold, maxPull, enabled]);

    return { distance, refreshing, threshold };
}

export default usePullToRefresh;
