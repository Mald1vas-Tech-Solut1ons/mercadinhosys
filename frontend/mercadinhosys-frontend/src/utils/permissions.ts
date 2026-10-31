/**
 * Fonte ÚNICA de verdade das Regras de Acesso no frontend.
 * Espelha backend/app/decorators/rbac.py (RBAC_MATRIX) e
 * backend/app/middleware/access_control.py (plano Grátis).
 *
 * Níveis: 0=Super Admin, 1=Admin, 2=Gerente, 3=RH,
 *         4=Estoque/Caixa, 5=Vendedor (SFA), 6=Entregador
 */

export interface UsuarioLogado {
    id?: number;
    nome?: string;
    role?: string;
    is_super_admin?: boolean;
    plano?: string;
    nivel?: number;
    [key: string]: unknown;
}

export const ROLE_TO_NIVEL: Record<string, number> = {
    ADMIN: 1, ADMINISTRADOR: 1, PROPRIETARIO: 1, DONO: 1, MASTER: 1,
    GERENTE: 2, SUPERVISOR: 2,
    RH: 3, RECURSOS_HUMANOS: 3,
    CAIXA: 4, OPERADOR: 4, ESTOQUE: 4, ESTOQUISTA: 4, ALMOXARIFE: 4, ATENDENTE: 4,
    VENDEDOR: 5, SFA: 5, SAF: 5,
    ENTREGADOR: 6, MOTOBOY: 6, MOTORISTA: 6,
    FUNCIONARIO: 4,
};

export const NIVEL_LABELS: Record<number, string> = {
    0: 'Super Admin', 1: 'Admin', 2: 'Gerente', 3: 'RH',
    4: 'Estoque/Caixa', 5: 'Vendedor', 6: 'Entregador',
};

export function getNivel(user?: UsuarioLogado | null): number {
    if (!user) return 99; // não autenticado: nenhum acesso
    if (user.is_super_admin) return 0;
    if (typeof user.nivel === 'number') return user.nivel;
    const role = (user.role || 'FUNCIONARIO').toUpperCase();
    return ROLE_TO_NIVEL[role] ?? 4;
}

export type Modulo =
    | 'dashboard' | 'pdv' | 'gestao_caixa' | 'vendas' | 'produtos'
    | 'fornecedores' | 'clientes' | 'sfa' | 'sfa_gestao' | 'delivery'
    | 'despesas' | 'fiscal' | 'auditoria' | 'funcionarios' | 'rh'
    | 'rh_gestao' | 'ponto' | 'relatorios' | 'configuracoes' | 'compras'
    | 'consultor' | 'entrada_nfe';

/** Níveis com acesso a cada módulo (Regras de Acesso do produto). */
export const MODULOS_POR_NIVEL: Record<Modulo, number[]> = {
    dashboard:     [1, 2, 3],
    pdv:           [1, 2, 4],
    gestao_caixa:  [1, 2, 4],
    vendas:        [1, 2],
    produtos:      [1, 2, 4, 5],
    compras:       [1, 2, 4],
    fornecedores:  [1, 2, 4, 5],
    clientes:      [1, 2, 4, 5],
    sfa:           [1, 2, 5],
    sfa_gestao:    [1, 2],
    delivery:      [1, 2, 4, 5, 6],
    despesas:      [1, 2],
    fiscal:        [1, 2],
    // Entrada de estoque pela nota do FORNECEDOR (XML / QR Code da NFC-e / chave do DANFE):
    // só lê documento já autorizado, não emite nada nem exige certificado.
    entrada_nfe:   [1, 2, 4],
    auditoria:     [1],
    funcionarios:  [1, 2, 3],
    // RH & Ponto: TODOS acessam a página, mas quem não é Admin/Gerente/RH
    // só vê os próprios dados (o backend filtra por usuário).
    rh:            [1, 2, 3, 4, 5, 6],
    // Dashboard/histórico/relatórios COMPLETOS de RH & Ponto (sem filtro por usuário)
    rh_gestao:     [1, 2, 3],
    ponto:         [1, 2, 3, 4, 5, 6],
    relatorios:    [1, 2],
    // Página aberta a todos; as ABAS são filtradas por nível (getSettingsTabs).
    configuracoes: [1, 2, 3, 4, 5, 6],
    consultor:     [1, 2, 3], // Limitar chat completo para cargos de gerência
};

/** Módulos incluídos no Plano Grátis. */
export const MODULOS_PLANO_GRATIS: Modulo[] = [
    'dashboard', 'pdv', 'gestao_caixa', 'produtos',
    'fornecedores', 'clientes', 'configuracoes', 'entrada_nfe',
];

const PLANOS_PRO = ['pro', 'pago', 'premium', 'elite', 'advanced', 'enterprise', 'master', 'profissional', 'professional', 'trial', 'teste'];

export function isPlanoGratis(user?: UsuarioLogado | null): boolean {
    if (user?.is_super_admin) return false;
    const plano = (user?.plano || 'Gratuito').toString().toLowerCase();
    return !PLANOS_PRO.some(p => plano.includes(p));
}

/** Regra completa: nível do cargo + plano do estabelecimento. */
export function canAccess(modulo: Modulo, user?: UsuarioLogado | null): boolean {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (!MODULOS_POR_NIVEL[modulo]?.includes(getNivel(user))) return false;
    if (isPlanoGratis(user) && !MODULOS_PLANO_GRATIS.includes(modulo)) return false;
    return true;
}

/** Mapa rota → módulo, para filtrar menus e proteger rotas. */
export const ROTA_MODULO: Record<string, Modulo> = {
    '/dashboard': 'dashboard',
    '/pdv': 'pdv',
    '/pdv?manage=true': 'gestao_caixa',
    '/products': 'produtos',
    '/compras': 'compras',
    '/suppliers': 'fornecedores',
    '/customers': 'clientes',
    '/sales': 'vendas',
    '/sfa': 'sfa',
    '/sfa/gestao': 'sfa_gestao',
    '/delivery': 'delivery',
    '/expenses': 'despesas',
    '/fiscal': 'fiscal',
    '/entrada-nfe': 'entrada_nfe',
    '/auditoria': 'auditoria',
    '/employees': 'funcionarios',
    '/rh': 'rh',
    '/ponto': 'ponto',
    '/reports': 'relatorios',
    '/settings': 'configuracoes',
    '/consultor': 'consultor',
};

export function canAccessRoute(rota: string, user?: UsuarioLogado | null): boolean {
    const modulo = ROTA_MODULO[rota];
    if (!modulo) return !!user?.is_super_admin; // rotas não mapeadas: só super admin
    return canAccess(modulo, user);
}

/** Rota inicial por nível — evita mandar caixa/vendedor/entregador para um dashboard proibido. */
export function getDefaultRoute(user?: UsuarioLogado | null): string {
    const nivel = getNivel(user);
    if (nivel === 4) return '/pdv';
    if (nivel === 5) return '/sfa';
    if (nivel === 6) return '/delivery';
    return '/dashboard';
}

/**
 * Abas de Configurações visíveis.
 * - Admin: todas | Gerente: sem Estabelecimento, Sistema & Segurança e Fiscal
 * - Níveis 3-6: apenas Geral e Minha Conta
 * - Plano Grátis: apenas Geral, Minha Conta, Estabelecimento, Sistema e Assinatura
 */
export function getSettingsTabs(user?: UsuarioLogado | null): string[] {
    const todas = [
        'geral', 'conta', 'segmento', 'estabelecimento', 'fiscal', 'vendas', 'estoque',
        'ponto', 'sistema', 'assinatura',
    ];
    if (user?.is_super_admin) return [...todas, 'lojas'];

    const nivel = getNivel(user);
    let tabs = todas;
    if (nivel === 2) {
        tabs = tabs.filter(t => !['estabelecimento', 'sistema', 'fiscal'].includes(t));
    } else if (nivel >= 3) {
        tabs = ['geral', 'conta'];
    }
    if (isPlanoGratis(user)) {
        const permitidasGratis = ['geral', 'conta', 'segmento', 'estabelecimento', 'assinatura'];
        tabs = tabs.filter(t => permitidasGratis.includes(t));
    }
    return tabs;
}

/**
 * Menu do piloto (FASE 2.2).
 *
 * O filtro por cargo deixa o DONO (nível 1) ver tudo — inclusive SFA, Logística
 * e RH, que não existem na operação de um mercadinho de bairro. Cada módulo
 * extra na face é uma pergunta no WhatsApp do CTO no primeiro dia.
 *
 * Regra: quem opera vê a operação diária; o resto fica em "Mais módulos"
 * (continua visível e alcançável, mas fora do caminho). Super admin e modo
 * espelho não são afetados.
 */
export const ROTAS_OPERACAO_DIARIA: string[] = [
    '/dashboard', '/pdv', '/pdv?manage=true', '/products',
    '/customers', '/sales', '/expenses', '/reports', '/entrada-nfe',
];

/** Rotas que o operador de caixa (nível 4) realmente usa. */
export const ROTAS_CAIXA: string[] = ['/pdv', '/pdv?manage=true'];

export interface ItemMenuBase {
    to: string;
}

export interface MenuPorPersona<T extends ItemMenuBase> {
    principais: T[];
    mais: T[];
}

/**
 * Divide um menu em "operação diária" e "mais módulos" conforme a persona.
 * Super admin recebe tudo em `principais` (modo espelho continua vendo tudo).
 */
export function getMenuForUser<T extends ItemMenuBase>(
    user: UsuarioLogado | null | undefined,
    itens: T[],
): MenuPorPersona<T> {
    if (!user || user.is_super_admin) {
        return { principais: itens, mais: [] };
    }

    const nivel = getNivel(user);

    if (nivel >= 4) {
        return {
            principais: itens.filter(i => ROTAS_CAIXA.includes(i.to)),
            mais: itens.filter(i => !ROTAS_CAIXA.includes(i.to)),
        };
    }

    if (nivel <= 2) {
        return {
            principais: itens.filter(i => ROTAS_OPERACAO_DIARIA.includes(i.to)),
            mais: itens.filter(i => !ROTAS_OPERACAO_DIARIA.includes(i.to)),
        };
    }

    return { principais: itens, mais: [] };
}
