import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../utils/toast', () => ({ showToast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock('../../../components/ui/Confirmacao', () => ({ confirmar: vi.fn() }));
vi.mock('../dosesService', () => ({
    dosesService: {
        razao: vi.fn(), baixar: vi.fn(), encerrarGarrafa: vi.fn(), ajustarGarrafa: vi.fn(), descartarGarrafa: vi.fn(),
    },
    erroDoses: (e: any, padrao: string) => e?.response?.data?.error || padrao,
}));

import { confirmar } from '../../../components/ui/Confirmacao';
import { showToast } from '../../../utils/toast';
import { dosesService } from '../dosesService';
import DosesPainel from './DosesPainel';

const svc = dosesService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const resposta = (extra: Record<string, unknown> = {}) => ({
    razao: [
        { id: 3, garrafa_id: 1, tipo: 'perda', ml: -40, custo: 4.8, dose: null, venda: null, funcionario: 'Caixa Demo',
          motivo: 'Quebrou o copo', em: '2026-11-12T20:00:00' },
        { id: 2, garrafa_id: 1, tipo: 'venda', ml: -100, custo: 12, dose: 'Dupla', venda: 'V-1', funcionario: 'Dono Demo',
          motivo: null, em: '2026-11-12T19:00:00' },
        { id: 1, garrafa_id: 1, tipo: 'abertura', ml: 1000, custo: 120, dose: null, venda: null, funcionario: 'Dono Demo',
          motivo: 'Abertura de garrafa (dose)', em: '2026-11-12T19:00:00' },
    ],
    garrafas_abertas: [{ id: 1, produto_id: 7, saldo_ml: 860, volume_inicial_ml: 1000, status: 'aberta',
        aberta_em: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19), validade_aberta: null }],
    resumo: null,
    ...extra,
});

describe('DosesPainel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        svc.razao.mockResolvedValue(resposta());
    });

    it('mostra a garrafa aberta (saldo, idade) e o razão com quem, o quê e quanto', async () => {
        render(<DosesPainel produtoId={7} />);
        const garrafa = await screen.findByTestId('garrafa-aberta');
        expect(garrafa.textContent).toContain('860 ml');
        expect(garrafa.textContent).toContain('de 1 L');
        expect(garrafa.textContent).toContain('aberta há 3 dias');
        const linhas = within(screen.getByTestId('razao-ml')).getAllByRole('row').slice(1).map(r => r.textContent || '');
        expect(linhas[0]).toContain('Perda');
        expect(linhas[0]).toContain('-40');
        expect(linhas[0]).toContain('Quebrou o copo');
        expect(linhas[0]).toContain('Caixa Demo');
        expect(linhas[1]).toContain('Venda');
        expect(linhas[1]).toContain('Dupla · V-1');
        expect(linhas[2]).toContain('Garrafa aberta');
        expect(linhas[2]).toContain('+1000');
    });

    it('garrafa vencida depois de aberta é sinalizada', async () => {
        svc.razao.mockResolvedValue(resposta({
            garrafas_abertas: [{ id: 1, produto_id: 7, saldo_ml: 300, volume_inicial_ml: 750, status: 'aberta',
                aberta_em: '2026-11-01T10:00:00', validade_aberta: '2026-11-06' }],
        }));
        render(<DosesPainel produtoId={7} />);
        expect((await screen.findByTestId('garrafa-aberta')).textContent).toContain('vencida depois de aberta');
    });

    it('sem garrafa aberta explica que a próxima dose abre uma; sem movimento diz que ainda não houve venda', async () => {
        svc.razao.mockResolvedValue(resposta({ garrafas_abertas: [], razao: [] }));
        render(<DosesPainel produtoId={7} />);
        expect(await screen.findByText(/Nenhuma garrafa aberta/)).toBeInTheDocument();
        expect(screen.getByText(/Ainda não houve venda por dose/)).toBeInTheDocument();
    });

    it('erro ao carregar mostra a mensagem do servidor', async () => {
        svc.razao.mockRejectedValue({ response: { data: { error: 'Produto não encontrado' } } });
        render(<DosesPainel produtoId={7} />);
        expect(await screen.findByText('Produto não encontrado')).toBeInTheDocument();
    });

    describe('registrar saída de ml', () => {
        it('perda sem dizer o que houve é recusada na tela', async () => {
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.change(screen.getByLabelText('ml'), { target: { value: '30' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
            expect(showToast.error).toHaveBeenCalledWith(expect.stringContaining('o que aconteceu'));
            expect(svc.baixar).not.toHaveBeenCalled();
        });

        it('perda com motivo chama o servidor, avisa o custo e recarrega', async () => {
            svc.baixar.mockResolvedValue({ ml: 30, custo: 3.6, estado: null });
            const onMudou = vi.fn();
            render(<DosesPainel produtoId={7} onMudou={onMudou} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.change(screen.getByLabelText('ml'), { target: { value: '30' } });
            fireEvent.change(screen.getByLabelText('O que aconteceu'), { target: { value: 'Derramou' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
            await waitFor(() => expect(svc.baixar).toHaveBeenCalledWith(7, { tipo: 'perda', ml: 30, motivo: 'Derramou' }));
            await waitFor(() => expect(onMudou).toHaveBeenCalled());
            expect((showToast.success as any).mock.calls[0][0]).toContain('30 ml');
            expect(svc.razao).toHaveBeenCalledTimes(2);
        });

        it('cortesia não pede motivo e aceita vírgula nos ml', async () => {
            svc.baixar.mockResolvedValue({ ml: 22.5, custo: 2.7, estado: null });
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.change(screen.getByLabelText('Tipo de saída'), { target: { value: 'cortesia' } });
            fireEvent.change(screen.getByLabelText('ml'), { target: { value: '22,5' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
            await waitFor(() => expect(svc.baixar).toHaveBeenCalledWith(7, { tipo: 'cortesia', ml: 22.5, motivo: undefined }));
        });

        it('recusa do servidor (ex.: sem ml suficiente) aparece como erro e nada recarrega', async () => {
            svc.baixar.mockRejectedValue({ response: { data: { error: 'Estoque insuficiente: restam 10 ml' } } });
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.change(screen.getByLabelText('Tipo de saída'), { target: { value: 'degustacao' } });
            fireEvent.change(screen.getByLabelText('ml'), { target: { value: '500' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
            await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('Estoque insuficiente: restam 10 ml'));
            expect(svc.razao).toHaveBeenCalledTimes(1);
        });
    });

    describe('garrafa aberta', () => {
        it('Terminou: confirma e avisa a diferença; cancelar não faz nada', async () => {
            svc.encerrarGarrafa.mockResolvedValue({ desvio_ml: 860, resumo: {} });
            (confirmar as any).mockResolvedValueOnce(false);
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.click(screen.getByRole('button', { name: 'Terminou' }));
            await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1));
            expect(svc.encerrarGarrafa).not.toHaveBeenCalled();
            (confirmar as any).mockResolvedValueOnce(true);
            fireEvent.click(screen.getByRole('button', { name: 'Terminou' }));
            await waitFor(() => expect(svc.encerrarGarrafa).toHaveBeenCalledWith(1));
            await waitFor(() => expect((showToast.success as any).mock.calls[0][0]).toContain('Faltaram 860 ml'));
        });

        it('Contei a garrafa: valida o máximo e registra a contagem com o motivo', async () => {
            svc.ajustarGarrafa.mockResolvedValue({ diferenca_ml: -240 });
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.click(screen.getByRole('button', { name: 'Contei a garrafa' }));
            fireEvent.change(screen.getByLabelText(/Quantos ml tem a garrafa agora/), { target: { value: '1500' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar contagem' }));
            expect(showToast.error).toHaveBeenCalledWith(expect.stringContaining('no máximo 1 L'));
            expect(svc.ajustarGarrafa).not.toHaveBeenCalled();
            fireEvent.change(screen.getByLabelText(/Quantos ml tem a garrafa agora/), { target: { value: '620' } });
            fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Régua' } });
            fireEvent.click(screen.getByRole('button', { name: 'Registrar contagem' }));
            await waitFor(() => expect(svc.ajustarGarrafa).toHaveBeenCalledWith(1, 620, 'Régua'));
            await waitFor(() => expect((showToast.success as any).mock.calls[0][0]).toBe('Diferença de -240 ml registrada.'));
        });

        it('Descartar: mostra o aviso, pede o motivo e registra como perda', async () => {
            svc.descartarGarrafa.mockResolvedValue({ perdido_ml: 860, custo: 103.2 });
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
            expect(screen.getByText(/viram perda no relatório/)).toBeInTheDocument();
            fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Vencida' } });
            fireEvent.click(screen.getByRole('button', { name: 'Descartar garrafa' }));
            await waitFor(() => expect(svc.descartarGarrafa).toHaveBeenCalledWith(1, 'Vencida'));
            await waitFor(() => expect((showToast.success as any).mock.calls[0][0]).toContain('860 ml'));
        });

        it('Voltar fecha o formulário sem chamar o servidor', async () => {
            render(<DosesPainel produtoId={7} />);
            await screen.findByTestId('garrafa-aberta');
            fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
            fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
            expect(screen.queryByRole('button', { name: 'Descartar garrafa' })).not.toBeInTheDocument();
            expect(svc.descartarGarrafa).not.toHaveBeenCalled();
        });
    });
});
