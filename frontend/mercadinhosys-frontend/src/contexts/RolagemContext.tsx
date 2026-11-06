import { createContext, useContext } from 'react';

/**
 * Estado da rolagem da área de conteúdo, decidido pelo MainLayout.
 *
 * `recolhido` = o usuário está descendo a página: o shell esconde as barras (cabeçalho no
 * celular, barra de baixo) e as páginas podem enxugar as próprias barras fixas, para a
 * informação ocupar a tela. Subir um pouco traz tudo de volta.
 */
export const RolagemContext = createContext<{ recolhido: boolean }>({ recolhido: false });

export const useRolagem = () => useContext(RolagemContext);
