/**
 * Chaves do carrinho do PDV no navegador — fonte única (FASE 1.4).
 *
 * O carrinho vive em `sessionStorage` para sobreviver a sair da tela do PDV (menu,
 * notificação, bloqueio de tela). Como o tablet é compartilhado, a chave é por operador:
 * `pdv_sessions_v1_<funcionario_id>`. A chave legada (`pdv_sessions_v1`), sem sufixo,
 * ainda é lida uma vez para não descartar carrinho aberto antes desta mudança.
 */
export const PDV_STORAGE_PREFIX = 'pdv_sessions_v1';

/** Chave de carrinho do operador; sem id, a chave legada/global. */
export const pdvStorageKey = (funcionarioId?: number | string | null): string =>
    funcionarioId ? `${PDV_STORAGE_PREFIX}_${funcionarioId}` : PDV_STORAGE_PREFIX;

/** true para a chave legada e para qualquer chave por operador. */
export const ehChaveDeCarrinhoPdv = (chave: string): boolean =>
    chave === PDV_STORAGE_PREFIX || chave.startsWith(`${PDV_STORAGE_PREFIX}_`);

/** Todas as chaves de carrinho existentes no storage informado. */
export const listarChavesCarrinhoPdv = (storage: Storage): string[] => {
    const chaves: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const chave = storage.key(i);
        if (chave && ehChaveDeCarrinhoPdv(chave)) chaves.push(chave);
    }
    return chaves;
};

export const limparSessaoOperador = (funcionarioId?: number | string | null): void => {
    try {
        sessionStorage.removeItem(pdvStorageKey(funcionarioId));
    } catch {
        // sessionStorage indisponível — segue em memória
    }
};

/** Remove o carrinho de todos os operadores (logout). */
export const limparCarrinhosPdv = (): void => {
    for (const storage of [sessionStorage, localStorage]) {
        try {
            listarChavesCarrinhoPdv(storage).forEach(chave => storage.removeItem(chave));
        } catch {
            // storage indisponível — nada a limpar
        }
    }
};
