export const validators = {
    required: (value: string | number | boolean | null | undefined) => {
        if (!value && value !== 0) return 'Campo obrigatório';
        return '';
    },

    email: (value: string) => {
        if (!value) return '';
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) return 'Email inválido';
        return '';
    },

    cpf: (value: string) => {
        if (!value) return '';
        const cpfRegex = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
        if (!cpfRegex.test(value) && value.replace(/\D/g, '').length !== 11) return 'CPF inválido';
        return '';
    },

    minLength: (min: number) => (value: string) => {
        if (value.length < min) return `Mínimo ${min} caracteres`;
        return '';
    },

    maxLength: (max: number) => (value: string) => {
        if (value.length > max) return `Máximo ${max} caracteres`;
        return '';
    },

    number: (value: string | number | null | undefined) => {
        if (isNaN(Number(value))) return 'Deve ser um número';
        return '';
    },

    positive: (value: number) => {
        if (value < 0) return 'Deve ser positivo';
        return '';
    },
};

export const isValidEmail = (email: string): boolean => {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

export const isValidCPF = (cpf: string): boolean => {
    if (!cpf) return false;
    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11 || /^(\d)\1{10}$/.test(cleanCpf)) return false;
    let sum = 0, rest;
    for (let i = 1; i <= 9; i++) sum = sum + parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
    rest = (sum * 10) % 11;
    if ((rest === 10) || (rest === 11)) rest = 0;
    if (rest !== parseInt(cleanCpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum = sum + parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
    rest = (sum * 10) % 11;
    if ((rest === 10) || (rest === 11)) rest = 0;
    if (rest !== parseInt(cleanCpf.substring(10, 11))) return false;
    return true;
};

export const isValidCNPJ = (cnpj: string): boolean => {
    if (!cnpj) return false;
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14 || /^(\d)\1{13}$/.test(cleanCnpj)) return false;
    let size = cleanCnpj.length - 2;
    let numbers = cleanCnpj.substring(0, size);
    const digits = cleanCnpj.substring(size);
    let sum = 0;
    let pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(0))) return false;
    size = size + 1;
    numbers = cleanCnpj.substring(0, size);
    sum = 0;
    pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(1))) return false;
    return true;
};

export type PasswordStrength = 'empty' | 'weak' | 'medium' | 'strong';

export const checkPasswordStrength = (password: string): PasswordStrength => {
    if (!password) return 'empty';
    if (password.length < 6) return 'weak';
    let score = 0;
    if (password.length > 8) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[@$!%*?&]/.test(password)) score += 1;

    if (score < 3) return 'weak';
    if (score === 3 || score === 4) return 'medium';
    return 'strong';
};


/** Senha de acesso: mesma regra do backend (acesso_conta_service.validar_forca_senha). */
export const erroSenha = (senha: string): string | null => {
    if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
    return null;
};
