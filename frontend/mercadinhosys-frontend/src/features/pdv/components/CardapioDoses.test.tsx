import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../products/dosesService', () => ({ dosesService: { cardapio: vi.fn() } }));
vi.mock('../offlineCatalog', () => ({ listarComDoses: vi.fn() }));

import { dosesService } from '../../products/dosesService';
import { listarComDoses } from '../offlineCatalog';
import CardapioDoses from './CardapioDoses';

const whisky = (extra: Record<string, unknown> = {}) => ({
    id: 7, nome: 'WHISKY 1L', preco_venda: 150, quantidade: 2, vende_por_dose: true, volume_embalagem_ml: 1000,
    saldo_aberto_ml: 650,
    doses: [
        { id: 1, nome: 'Dose', volume_ml: 50, preco_venda: 18, padrao: true },
        { id: 2, nome: 'Dupla', volume_ml: 100, preco_venda: 32, padrao: false },
    ],
    ...extra,
}) as any;

describe('CardapioDoses', () => {
    beforeEach(() => vi.clearAllMocks());

    it('um botão por dose do lojista e a garrafa inteira, com o saldo da aberta', async () => {
        (dosesService.cardapio as any).mockResolvedValue([whisky()]);
        render(<CardapioDoses versao={0} offline={false} onEscolher={vi.fn()} />);
        await screen.findByTestId('cardapio-doses');
        expect(screen.getByRole('button', { name: 'WHISKY 1L Dose 50 ml' }).textContent).toContain('R$');
        expect(screen.getByRole('button', { name: 'WHISKY 1L Dupla 100 ml' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'WHISKY 1L garrafa inteira' })).toBeInTheDocument();
        expect(screen.getByText('aberta 650 ml')).toBeInTheDocument();
    });

    it('um toque numa dose entrega produto e escolha ao caixa, sem abrir folha', async () => {
        (dosesService.cardapio as any).mockResolvedValue([whisky()]);
        const onEscolher = vi.fn();
        render(<CardapioDoses versao={0} offline={false} onEscolher={onEscolher} />);
        fireEvent.click(await screen.findByRole('button', { name: 'WHISKY 1L Dupla 100 ml' }));
        expect(onEscolher).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), {
            tipo: 'dose', dose: { id: 2, nome: 'Dupla', volumeMl: 100 }, preco: 32,
        });
        fireEvent.click(screen.getByRole('button', { name: 'WHISKY 1L garrafa inteira' }));
        expect(onEscolher).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7 }), { tipo: 'garrafa' });
    });

    it('recarrega quando a versão muda (venda feita, garrafa encerrada)', async () => {
        (dosesService.cardapio as any).mockResolvedValue([whisky()]);
        const { rerender } = render(<CardapioDoses versao={0} offline={false} onEscolher={vi.fn()} />);
        await screen.findByTestId('cardapio-doses');
        (dosesService.cardapio as any).mockResolvedValue([whisky({ saldo_aberto_ml: 600 })]);
        rerender(<CardapioDoses versao={1} offline={false} onEscolher={vi.fn()} />);
        expect(await screen.findByText('aberta 600 ml')).toBeInTheDocument();
        expect(dosesService.cardapio).toHaveBeenCalledTimes(2);
    });

    it('sem produtos explica onde configurar', async () => {
        (dosesService.cardapio as any).mockResolvedValue([]);
        render(<CardapioDoses versao={0} offline={false} onEscolher={vi.fn()} />);
        expect(await screen.findByText(/Venda por dose/)).toBeInTheDocument();
    });

    it('offline lê o catálogo salvo no aparelho e avisa', async () => {
        (listarComDoses as any).mockResolvedValue([whisky()]);
        render(<CardapioDoses versao={0} offline onEscolher={vi.fn()} />);
        expect(await screen.findByTestId('cardapio-doses')).toBeInTheDocument();
        expect(screen.getByText(/catálogo salvo no aparelho/)).toBeInTheDocument();
        expect(dosesService.cardapio).not.toHaveBeenCalled();
    });

    it('servidor fora do ar cai no catálogo salvo em vez de ficar em branco', async () => {
        (dosesService.cardapio as any).mockRejectedValue(new Error('rede'));
        (listarComDoses as any).mockResolvedValue([whisky()]);
        render(<CardapioDoses versao={0} offline={false} onEscolher={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('cardapio-doses')).toBeInTheDocument());
        expect(screen.getByText(/Sem conexão com o servidor/)).toBeInTheDocument();
    });

    it('produto sem doses ativas não aparece', async () => {
        (dosesService.cardapio as any).mockResolvedValue([whisky({ doses: [] })]);
        render(<CardapioDoses versao={0} offline={false} onEscolher={vi.fn()} />);
        await waitFor(() => expect(screen.queryByTestId('cardapio-doses')).not.toBeInTheDocument());
    });
});
