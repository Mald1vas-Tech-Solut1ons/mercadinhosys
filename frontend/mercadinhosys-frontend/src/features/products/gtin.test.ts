import { describe, expect, it } from 'vitest';
import { gtinValido } from './components/ProductFormModal';

describe('gtinValido (consulta automática do EAN no cadastro)', () => {
    it('aceita EAN-13 real e recusa dígito errado, incompleto ou zerado', () => {
        expect(gtinValido('7897947614338')).toBe(true);
        expect(gtinValido('7894900027013')).toBe(true);
        expect(gtinValido('7897947614339')).toBe(false);
        expect(gtinValido('789794761434')).toBe(false);
        expect(gtinValido('7897947')).toBe(false);
        expect(gtinValido('0000000000000')).toBe(false);
    });
});
