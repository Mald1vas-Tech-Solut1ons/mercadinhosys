// Funções utilitárias para máscaras de input
export function maskCPF(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 14);
}

export function maskPhone(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '($1)$2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
    .slice(0, 14);
}
export function maskCEP(value: string): string {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{5})(\d)/, '$1-$2')
    .slice(0, 9);
}

export function somenteDigitos(value: string | undefined | null): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function maskCNPJ(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function validarCPF(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const digito = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += parseInt(cpf.charAt(i), 10) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === parseInt(cpf.charAt(9), 10) && digito(10) === parseInt(cpf.charAt(10), 10);
}

export function validarCNPJ(valor: string): boolean {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const digito = (tamanho: number) => {
    const pesos = tamanho === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, peso, i) => acc + parseInt(cnpj.charAt(i), 10) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === parseInt(cnpj.charAt(12), 10) && digito(13) === parseInt(cnpj.charAt(13), 10);
}

/** Documento do cliente (CPF ou CNPJ já formatado), conforme o tipo de pessoa. */
export function documentoDe(cliente: { documento?: string; cpf?: string; cnpj?: string; tipo_pessoa?: string }): string {
  return cliente.documento || (cliente.tipo_pessoa === 'PJ' ? cliente.cnpj : cliente.cpf) || cliente.cpf || cliente.cnpj || '';
}
