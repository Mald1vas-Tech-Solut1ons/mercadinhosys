import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../utils/toast', () => ({ showToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock('../dosesService', () => ({
    dosesService: { ajustarGarrafa: vi.fn() },
    erroDoses: (e: any, padrao: string) => e?.response?.data?.error || padrao,
}));

import { showToast } from '../../../utils/toast';
import { dosesService } from '../dosesService';
import GarrafasAbertasContagem from './GarrafasAbertasContagem';

const itens = [{ produto_id: 7, nome: 'WHISKY 1L', garrafas: [{ id: 11, saldo_ml: 805, volume_inicial_ml: 1000 }] }];

describe('GarrafasAbertasContagem', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sem garrafa aberta não aparece', () => {
        const { container } = render(<GarrafasAbertasContagem itens={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lista a garrafa com o saldo do controle para o dono contar em ml', () => {
        render(<GarrafasAbertasContagem itens={itens} />);
        expect(screen.getByText('WHISKY 1L')).toBeInTheDocument();
        expect(screen.getByText(/O controle diz 805 ml de 1 L/)).toBeInTheDocument();
        expect(screen.getByText(/O bip contou só as garrafas fechadas/)).toBeInTheDocument();
    });

    it('registra a contagem e mostra a diferença', async () => {
        (dosesService.ajustarGarrafa as any).mockResolvedValue({ diferenca_ml: -45 });
        render(<GarrafasAbertasContagem itens={itens} />);
        fireEvent.change(screen.getByLabelText('ml na garrafa de WHISKY 1L'), { target: { value: '760' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        await waitFor(() => expect(dosesService.ajustarGarrafa).toHaveBeenCalledWith(11, 760, 'Contagem cíclica'));
        expect(await screen.findByText(/Registrado: diferença de -45 ml/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Registrar' })).not.toBeInTheDocument();
    });

    it('contagem que confere diz que confere', async () => {
        (dosesService.ajustarGarrafa as any).mockResolvedValue({ diferenca_ml: 0 });
        render(<GarrafasAbertasContagem itens={itens} />);
        fireEvent.change(screen.getByLabelText('ml na garrafa de WHISKY 1L'), { target: { value: '805' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        expect(await screen.findByText('Registrado: confere')).toBeInTheDocument();
    });

    it('valor vazio ou acima da garrafa é recusado na tela', () => {
        render(<GarrafasAbertasContagem itens={itens} />);
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        expect(showToast.error).toHaveBeenLastCalledWith('Informe quantos ml tem a garrafa agora.');
        fireEvent.change(screen.getByLabelText('ml na garrafa de WHISKY 1L'), { target: { value: '1200' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        expect(showToast.error).toHaveBeenLastCalledWith(expect.stringContaining('no máximo 1 L'));
        expect(dosesService.ajustarGarrafa).not.toHaveBeenCalled();
    });

    it('erro do servidor aparece e o campo continua para tentar de novo', async () => {
        (dosesService.ajustarGarrafa as any).mockRejectedValue({ response: { data: { error: 'Só garrafa aberta pode ser ajustada' } } });
        render(<GarrafasAbertasContagem itens={itens} />);
        fireEvent.change(screen.getByLabelText('ml na garrafa de WHISKY 1L'), { target: { value: '700' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
        await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('Só garrafa aberta pode ser ajustada'));
        expect(screen.getByRole('button', { name: 'Registrar' })).toBeInTheDocument();
    });
});
