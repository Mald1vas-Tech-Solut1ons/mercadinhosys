import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Recolhe as barras quando o usuário desce a página e as devolve quando sobe.
 *
 * Padrão de app de celular (e de boa leitura no desktop): quem está lendo uma lista
 * longa não precisa do cabeçalho e da navegação o tempo todo. Pequenos tremores do dedo
 * (menos de `folga` px) não mexem nas barras; perto do topo elas sempre aparecem.
 */
export default function useRecolherAoRolar(ref: RefObject<HTMLElement | null>, ativo = true, folga = 8) {
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ativo) return undefined;
    let ultimo = el.scrollTop;
    let agendado = false;

    const avaliar = () => {
      agendado = false;
      const y = el.scrollTop;
      const delta = y - ultimo;
      if (y < 48) {
        setRecolhido(false);
      } else if (delta > folga) {
        setRecolhido(true);
      } else if (delta < -folga) {
        setRecolhido(false);
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
