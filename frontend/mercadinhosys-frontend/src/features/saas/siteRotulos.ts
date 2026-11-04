/** Rótulos e formatos do rastreio do site e do CRM (super admin). */
export const ROTULOS_ORIGEM: Record<string, string> = {
    direto: 'Direto (digitou ou QR)',
    google: 'Google',
    panfleto: 'Panfleto (QR)',
    whatsapp: 'WhatsApp',
    porta_a_porta: 'Porta a porta',
    cadastro_teste: 'Cadastro de teste',
    landing_page: 'Formulário do site',
};

export const ROTULOS_EVENTO: Record<string, string> = {
    whatsapp: 'Clicou no WhatsApp',
    cadastro: 'Clicou em criar conta',
    demo_entrar: 'Entrou na demonstração ao vivo',
    demo_aba: 'Mexeu na demonstração',
    demo_produto: 'Bipou produto na demonstração',
    segmento: 'Escolheu um segmento',
    regiao: 'Abriu uma região',
    calculadora: 'Usou a calculadora de perdas',
    faq: 'Abriu uma pergunta',
    cookies_aceitos: 'Aceitou cookies',
    formulario_enviado: 'Enviou o formulário',
    oferta_vista: 'Foi para a oferta',
    formulario_inicio: 'Começou o formulário',
};

export function formatarDuracao(segundos: number | null): string {
    if (segundos === null || !Number.isFinite(segundos)) return '—';
    const total = Math.round(segundos);
    if (total < 60) return `${total} s`;
    const minutos = Math.floor(total / 60);
    const resto = total % 60;
    return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
}

export const ROTULOS_ETAPA: Record<string, string> = {
    novo: 'Novo',
    contatado: 'Contatado',
    demonstracao: 'Demonstração',
    implantacao: 'Implantação',
    teste: 'Em teste (2 meses)',
    cliente: 'Cliente',
    perdido: 'Perdido',
};

export const SEGMENTOS_CRM = [
    'mercadinho', 'supermercado', 'mercearia', 'loja-de-roupas', 'loja-de-calcados', 'moto-pecas',
    'tabacaria', 'loja-de-suplementos', 'material-de-construcao', 'adega-e-conveniencia', 'distribuidora', 'outro',
];
