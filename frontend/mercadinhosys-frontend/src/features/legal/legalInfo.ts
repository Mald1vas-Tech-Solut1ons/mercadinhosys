/**
 * Dados institucionais usados nas páginas legais (Termos, Privacidade) e de Ajuda.
 *
 * >>> EDITE AQUI <<<  — preencha com os dados reais da sua empresa quando tiver
 * CNPJ/MEI e e-mail profissional. Tudo que aparece nas páginas vem deste arquivo,
 * então você ajusta num lugar só.
 */
export const legalInfo = {
    // Identidade do produto / empresa
    produto: 'MercadinhoSys',
    razaoSocial: '[RAZÃO SOCIAL — preencher ao abrir CNPJ/MEI]',
    cnpj: '[CNPJ — preencher]',
    cidadeUf: '[Cidade/UF]',

    // Contato e suporte
    emailContato: 'contato@mercadinhosys.com.br', // troque pelo e-mail profissional real
    emailPrivacidade: 'privacidade@mercadinhosys.com.br',
    whatsapp: '5511919889233', // só dígitos, com DDI 55. Vazio = oculta o botão.

    // Datas — atualize quando revisar os textos
    vigenciaDesde: '26 de junho de 2026',
    ultimaAtualizacao: '4 de novembro de 2026',

    // Domínio (após registrar no registro.br)
    site: 'mercadinhosys.com.br',
};

/** Link de WhatsApp pronto (ou string vazia se não configurado). */
export const whatsappLink = (mensagem = 'Olá! Tenho interesse no MercadinhoSys.') =>
    legalInfo.whatsapp
        ? `https://wa.me/${legalInfo.whatsapp}?text=${encodeURIComponent(mensagem)}`
        : '';
