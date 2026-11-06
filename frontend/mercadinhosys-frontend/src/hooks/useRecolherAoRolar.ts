import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Duração da animação das barras (MainLayout/BottomNavigation usam duration-300) + margem. */
const TRAVA_APOS_TROCA_MS = 380;
/** Distância do fim da página em que o navegador "puxa" o scrollTop ao mudar a altura. */
const FOLGA_FIM_PX = 24;

/**
 * Recolhe as barras quando o usuário desce a página e as devolve quando sobe.
 *
 * Padrão de app de celular (e de boa leitura no desktop): quem está lendo uma lista
 * longa não precisa do cabeçalho e da navegação o tempo todo. Pequenos tremores do dedo
 * (menos de `folga` px) não mexem nas barras; perto do topo elas sempre aparecem.
 *
 * Anti-tremor: recolher/mostrar muda a altura da área rolável (cabeçalho some, barras das
 * páginas encolhem). O navegador então corrige o scrollTop sozinho (clamp no fim da página,
 * scroll anchoring no meio). Sem proteção, essa correção é lida como "o usuário subiu", as
 * barras voltam, a altura volta, e o ciclo se repete: a tela treme. Por isso:
 *  - depois de cada troca, a rolagem é ignorada até a animação acabar (e a referência
 *    é reposicionada no fim, para a correção do navegador não contar como gesto);
 *  - no fim da página, subida não reabre as barras (é o clamp do navegador, não o dedo).
 * O MainLayout também desliga o scroll anchoring da área rolável ([overflow-anchor:none]).
 */
export default function useRecolherAoRolar(ref: RefObject<HTMLElement | null>, ativo = true, folga = 8) {
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ativo) return undefined;
    let ultimo = el.scrollTop;
    let estado = false;
    let travadoAte = 0;
    let agendado = false;

    const trocar = (novo: boolean) => {
      if (novo === estado) return;
      estado = novo;
      travadoAte = performance.now() + TRAVA_APOS_TROCA_MS;
      setRecolhido(novo);
    };

    const avaliar = () => {
      agendado = false;
      const y = el.scrollTop;
      if (performance.now() < travadoAte) {
        ultimo = y; // movimento causado pelo próprio layout: não é gesto do usuário
        return;
      }
      const delta = y - ultimo;
      const noFim = el.scrollHeight - el.clientHeight - y <= FOLGA_FIM_PX;
      if (y < 48) {
        trocar(false);
      } else if (delta > folga) {
        trocar(true);
      } else if (delta < -folga) {
        if (!noFim) trocar(false);
      } else {
        return; // tremor: não atualiza a referência, acumula até passar da folga
      }
      ultimo = y;
    };
    const aoRolar = () => {
      if (!agendado) {
        agendado = true;
        requestAnimationFrame(avaliar);
      }
    };
    el.addEventListener('scroll', aoRolar, { passive: true });
    return () => el.removeEventListener('scroll', aoRolar);
  }, [ref, ativo, folga]);

  return ativo ? recolhido : false;
}
