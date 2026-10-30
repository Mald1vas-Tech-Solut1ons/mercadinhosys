/**
 * Fonte única de verdade dos atalhos de teclado do sistema.
 *
 * Tudo que é exibido (overlay de ajuda "?" e o modal de atalhos nas
 * Configurações) lê desta lista, para a documentação nunca divergir do que
 * está realmente implementado.
 */
export interface ShortcutDoc {
    /** Teclas exibidas na UI, ex.: ['F1'] ou ['G', 'D']. */
    keys: string[];
    label: string;
}

export interface ShortcutGroup {
    titulo: string;
    atalhos: ShortcutDoc[];
}

/** Navegação global — funciona em qualquer tela autenticada (pressione G e depois a letra). */
export const NAV_CHORDS: Record<string, string> = {
    d: '/dashboard',
    p: '/pdv',
    e: '/products',
    c: '/customers',
    v: '/sales',
    f: '/fiscal',
    s: '/settings',
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        titulo: 'Geral',
        atalhos: [
            { keys: ['Ctrl', 'K'], label: 'Buscar produto, cliente, venda, fornecedor ou tela' },
            { keys: ['?'], label: 'Mostrar/ocultar esta ajuda de atalhos' },
            { keys: ['Esc'], label: 'Fechar janelas e painéis abertos' },
        ],
    },
    {
        titulo: 'Navegação (pressione G e depois a tecla)',
        atalhos: [
            { keys: ['G', 'D'], label: 'Ir para o Painel' },
            { keys: ['G', 'P'], label: 'Ir para o PDV (Caixa)' },
            { keys: ['G', 'E'], label: 'Ir para Produtos/Estoque' },
            { keys: ['G', 'C'], label: 'Ir para Clientes' },
            { keys: ['G', 'V'], label: 'Ir para Vendas' },
            { keys: ['G', 'F'], label: 'Ir para Fiscal' },
            { keys: ['G', 'S'], label: 'Ir para Configurações' },
        ],
    },
    {
        titulo: 'PDV / Caixa',
        atalhos: [
            { keys: ['F1'], label: 'Focar a busca de produto' },
            { keys: ['F2'], label: 'Selecionar cliente' },
            { keys: ['F4'], label: 'Abrir formas de pagamento' },
            { keys: ['F8'], label: 'Reimprimir cupom (2ª via)' },
            { keys: ['F9'], label: 'Finalizar venda' },
            { keys: ['F10'], label: 'Finalizar venda' },
            { keys: ['Esc'], label: 'Limpar carrinho / fechar pagamento' },
        ],
    },
];
