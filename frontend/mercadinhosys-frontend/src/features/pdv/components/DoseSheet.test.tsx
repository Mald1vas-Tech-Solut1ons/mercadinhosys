import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../utils/toast', () => ({ showToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock('../../products/dosesService', () => ({
    dosesService: { encerrarGarrafa: vi.fn() },
    erroDoses: (_e: unknown, padrao: string) => padrao,
}));

import { showToast } from '../../../utils/toast';
import { dosesService } from '../../products/dosesService';
import DoseSheet from './DoseSheet';
import { salvarUltimaEscolha, type LinhaCarrinho } from '../utils/dosesPdv';

const whisky = (extra: Record<string, unknown> = {}) => ({
    id: 7, nome: 'WHISKY 1L', preco_venda: 150, quantidade: 2, vende_por_dose: true, volume_embalagem_ml: 1000,
    saldo_aberto_ml: 650, garrafas_abertas: [{ id: 99, saldo_ml: 650 }],
    doses: [
        { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18, padrao: true },
        { id: 2, nome: 'Dupla', volume_ml: 100, preco_venda: 32, padrao: false },
    ],
    ...extra,
}) as any;

function abrir(extra: { produto?: any; carrinho?: LinhaCarrinho[]; offline?: boolean; semEstoque?: boolean } = {}) {
    const onEscolher = vi.fn();
    const onFechar = vi.fn();
    const onGarrafaEncerrada = vi.fn();
    render(<DoseSheet produto={extra.produto ?? whisky()} estoqueFechado={2} carrinho={extra.carrinho ?? []}
        offline={extra.offline ?? false} permitirSemEstoque={extra.semEstoque ?? false}
        onEscolher={onEscolher} onFechar={onFechar} onGarrafaEncerrada={onGarrafaEncerrada} />);
    return { onEscolher, onFechar, onGarrafaEncerrada };
}

describe('DoseSheet', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('mostra as doses do lojista, a garrafa inteira e o saldo da aberta', () => {
        abrir();
        const opcoes = screen.getAllByRole('option').map(o => o.textContent || '');
        expect(opcoes).toHaveLength(3);
        expect(opcoes[0]).toContain('Dose · 50 ml');
        expect(opcoes[0]).toContain('R$');
        expect(opcoes[1]).toContain('Dupla · 100 ml');
        expect(opcoes[2]).toContain('Garrafa inteira · 1 L');
        expect(screen.getByTestId('dose-aberta').textContent).toBe('Garrafa aberta: 650 ml ≈ 13 doses de 50 ml');
    });

    it('sem garrafa aberta explica que a próxima dose abre uma', () => {
        abrir({ produto: whisky({ saldo_aberto_ml: 0, garrafas_abertas: [] }) });
        expect(screen.getByTestId('dose-aberta').textContent).toContain('a próxima dose abre uma');
        expect(screen.queryByRole('button', { name: 'Terminou a garrafa' })).not.toBeInTheDocument();
    });

    it('a dose padrão vem realçada; a última escolha do produto manda no destaque', () => {
        const { unmount } = render(<span />);
        unmount();
        abrir();
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('lembra a última escolha: depois de servir dupla, a dupla vem realçada', () => {
        salvarUltimaEscolha(7, 'd2');
        abrir();
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('um toque numa dose entrega a dose com o preço do lojista e guarda a escolha', () => {
        const { onEscolher } = abrir();
        fireEvent.click(screen.getAllByRole('option')[1]);
        expect(onEscolher).toHaveBeenCalledWith({
            tipo: 'dose', dose: { id: 2, nome: 'Dupla', volumeMl: 100 }, preco: 32,
        });
        expect(localStorage.getItem('pdv_dose_ultima_escolha_v1')).toContain('"7":"d2"');
    });

    it('garrafa inteira entrega tipo garrafa', () => {
        const { onEscolher } = abrir();
        fireEvent.click(screen.getAllByRole('option')[2]);
        expect(onEscolher).toHaveBeenCalledWith({ tipo: 'garrafa' });
    });

    it('teclado: número escolhe, Enter confirma a realçada, setas movem, Esc fecha', () => {
        const { onEscolher, onFechar } = abrir();
        const dialogo = screen.getByRole('dialog');
        fireEvent.keyDown(dialogo, { key: '2' });
        expect(onEscolher).toHaveBeenLastCalledWith(expect.objectContaining({ dose: expect.objectContaining({ id: 2 }) }));
        fireEvent.keyDown(dialogo, { key: 'ArrowDown' });
        fireEvent.keyDown(dialogo, { key: 'Enter' });
        expect(onEscolher).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(dialogo, { key: 'Escape' });
        expect(onFechar).toHaveBeenCalled();
    });

    it('o teclado funciona mesmo com o foco em outro campo (a busca do PDV retoma o foco depois do clique)', () => {
        const busca = document.createElement('button');                     // foco fora da folha, em elemento que não digita
        document.body.appendChild(busca);
        busca.focus();
        const { onEscolher, onFechar } = abrir();
        fireEvent.keyDown(document.body, { key: '2' });
        expect(onEscolher).toHaveBeenCalledWith(expect.objectContaining({ dose: expect.objectContaining({ id: 2 }) }));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onFechar).toHaveBeenCalled();
        busca.remove();
    });

    it('digitando num campo de texto as teclas 1-9 não escolhem opção (campo de ml da dose livre)', () => {
        const { onEscolher } = abrir();
        fireEvent.click(screen.getByRole('button', { name: 'Outra quantidade (ml)' }));
        fireEvent.keyDown(screen.getByLabelText('Quantos ml vão no copo?'), { key: '1' });
        expect(onEscolher).not.toHaveBeenCalled();
    });

    it('dose sem ml suficiente fica indisponível e avisa em vez de adicionar', () => {
        const carrinho: LinhaCarrinho[] = [{ produto: { id: 7 }, quantidade: 53, dose: { id: 1, nome: 'Dose', volumeMl: 50 }, chave: '7:d1' }];
        const { onEscolher } = abrir({ carrinho });                       // 650 aberta + 2 fechadas = 2650 ml, e 53 x 50 ml = 2650 ml já no carrinho
        const dupla = screen.getAllByRole('option')[1];
        expect(dupla.textContent).toContain('indisponível');
        fireEvent.click(dupla);
        expect(onEscolher).not.toHaveBeenCalled();
        expect(showToast.error).toHaveBeenCalled();
    });

    it('com venda sem estoque liberada nada fica indisponível', () => {
        const carrinho: LinhaCarrinho[] = [{ produto: { id: 7 }, quantidade: 53, dose: { id: 1, nome: 'Dose', volumeMl: 50 }, chave: '7:d1' }];
        const { onEscolher } = abrir({ carrinho, semEstoque: true });
        fireEvent.click(screen.getAllByRole('option')[1]);
        expect(onEscolher).toHaveBeenCalled();
    });

    describe('dose livre', () => {
        it('digitar os ml mostra o preço (R$/ml da dose padrão) e adiciona como dose livre', () => {
            const { onEscolher } = abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Outra quantidade (ml)' }));
            fireEvent.change(screen.getByLabelText('Quantos ml vão no copo?'), { target: { value: '45' } });
            const adicionar = screen.getByRole('button', { name: /Adicionar/ });
            expect(adicionar.textContent).toContain('16,20');              // 18/50 x 45
            fireEvent.click(adicionar);
            expect(onEscolher).toHaveBeenCalledWith({
                tipo: 'dose', dose: { id: null, nome: 'Dose livre', volumeMl: 45, livre: true }, preco: 16.2,
            });
        });

        it('Enter no campo adiciona sem fechar a folha por engano', () => {
            const { onEscolher } = abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Outra quantidade (ml)' }));
            const campo = screen.getByLabelText('Quantos ml vão no copo?');
            fireEvent.change(campo, { target: { value: '30,5' } });
            fireEvent.keyDown(campo, { key: 'Enter' });
            expect(onEscolher).toHaveBeenCalledTimes(1);
            expect(onEscolher.mock.calls[0][0].dose.volumeMl).toBe(30.5);
        });

        it('copo maior que a garrafa é recusado na tela', () => {
            const { onEscolher } = abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Outra quantidade (ml)' }));
            fireEvent.change(screen.getByLabelText('Quantos ml vão no copo?'), { target: { value: '1500' } });
            expect(screen.getByText(/maior que a garrafa/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Adicionar/ })).toBeDisabled();
            expect(onEscolher).not.toHaveBeenCalled();
        });

        it('offline não oferece dose livre (o PIN de gerente precisa do servidor)', () => {
            abrir({ offline: true });
            expect(screen.queryByRole('button', { name: 'Outra quantidade (ml)' })).not.toBeInTheDocument();
            expect(screen.getByText(/Sem internet/)).toBeInTheDocument();
        });
    });

    describe('terminou a garrafa', () => {
        it('encerra a garrafa aberta e avisa quanto faltou no controle', async () => {
            (dosesService.encerrarGarrafa as any).mockResolvedValue({ desvio_ml: 120, resumo: {} });
            const { onGarrafaEncerrada } = abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Terminou a garrafa' }));
            await waitFor(() => expect(onGarrafaEncerrada).toHaveBeenCalled());
            expect(dosesService.encerrarGarrafa).toHaveBeenCalledWith(99);
            expect((showToast.success as any).mock.calls[0][0]).toContain('120 ml');
        });

        it('garrafa que acabou certinho não fala em desvio', async () => {
            (dosesService.encerrarGarrafa as any).mockResolvedValue({ desvio_ml: 0, resumo: {} });
            abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Terminou a garrafa' }));
            await waitFor(() => expect(showToast.success).toHaveBeenCalled());
            expect((showToast.success as any).mock.calls[0][0]).toBe('Garrafa encerrada.');
        });

        it('erro do servidor aparece e a folha continua aberta', async () => {
            (dosesService.encerrarGarrafa as any).mockRejectedValue(new Error('x'));
            const { onGarrafaEncerrada } = abrir();
            fireEvent.click(screen.getByRole('button', { name: 'Terminou a garrafa' }));
            await waitFor(() => expect(showToast.error).toHaveBeenCalled());
            expect(onGarrafaEncerrada).not.toHaveBeenCalled();
        });
    });
});
