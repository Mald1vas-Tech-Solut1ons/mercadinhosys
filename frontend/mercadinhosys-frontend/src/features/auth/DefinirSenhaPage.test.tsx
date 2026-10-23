import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api/apiClient', () => ({ apiClient: api }));

import DefinirSenhaPage from './DefinirSenhaPage';

const montar = (url: string) => render(
    <MemoryRouter initialEntries={[url]}>
        <Routes>
            <Route path="/definir-senha" element={<DefinirSenhaPage />} />
            <Route path="/login" element={<div>tela de login</div>} />
        </Routes>
    </MemoryRouter>,
);

const preencher = (senha: string, confirmacao: string) => {
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: senha } });
    fireEvent.change(screen.getByLabelText('Repita a senha'), { target: { value: confirmacao } });
};

describe('DefinirSenhaPage — ativação de conta pelo link do e-mail', () => {
    beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

    it('mostra a loja, valida a senha e ativa a conta', async () => {
        api.get.mockResolvedValue({ data: { success: true, finalidade: 'ativacao', nome: 'Vera', username: 'drika24tata', loja: 'Capraro Saldão OUTLET' } });
        api.post.mockResolvedValue({ data: { success: true, username: 'drika24tata' } });
        montar('/definir-senha?token=abc');

        expect(await screen.findByText('Ative sua conta')).toBeTruthy();
        expect(screen.getByText('Capraro Saldão OUTLET')).toBeTruthy();
        expect(api.get).toHaveBeenCalledWith('/auth/senha/token/abc');

        preencher('curta1', 'curta1');
        fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
        expect(await screen.findByText('A senha precisa ter pelo menos 8 caracteres.')).toBeTruthy();

        preencher('Capraro2026', 'Capraro2027');
        fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
        expect(await screen.findByText('As senhas não conferem.')).toBeTruthy();
        expect(api.post).not.toHaveBeenCalled();

        preencher('Capraro2026', 'Capraro2026');
        fireEvent.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
        expect(await screen.findByText(/Senha criada!/)).toBeTruthy();
        expect(api.post).toHaveBeenCalledWith('/auth/senha/definir', { token: 'abc', nova_senha: 'Capraro2026' });
    });

    it('link expirado mostra o erro do servidor e oferece pedir outro', async () => {
        api.get.mockRejectedValue({ response: { data: { error: 'Link inválido ou expirado. Peça um novo link.' } } });
        montar('/definir-senha?token=velho');
        expect(await screen.findByText('Link inválido ou expirado. Peça um novo link.')).toBeTruthy();
        expect(screen.getByText('Link de acesso')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Pedir um novo link' }));
        expect(await screen.findByText('Esqueci minha senha')).toBeTruthy();
        expect(screen.queryByText('Link inválido ou expirado. Peça um novo link.')).toBeNull();
    });

    it('esqueci minha senha envia o pedido e não revela se o e-mail existe', async () => {
        api.post.mockResolvedValue({ data: { success: true } });
        montar('/definir-senha');
        fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'vera@exemplo.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
        expect(await screen.findByText(/Se o e-mail estiver cadastrado/)).toBeTruthy();
        expect(api.post).toHaveBeenCalledWith('/auth/password/reset-request', { email: 'vera@exemplo.com' });
    });
});
