import { documentoDe } from './inputMasks';
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, IconButton, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper, Typography } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import CloseIcon from '@mui/icons-material/Close';
import InventoryIcon from '@mui/icons-material/Inventory';
import { apiClient } from '../../../api/apiClient';
import { useState, useEffect } from 'react';

interface CustomerDetailsModalProps {
  open: boolean;
  cliente: any | null;
  loading?: boolean;
  onClose: () => void;
  onEdit: (cliente: any) => void;
  onDelete: (cliente: any) => void;
  rfmData?: any;
}

const InfoRow = ({ label, value, valueClassName = '' }: { label: string; value: React.ReactNode; valueClassName?: string }) => (
  <div className="flex flex-col sm:flex-row sm:items-center py-2.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0 gap-1 sm:gap-4">
    <span className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-40 shrink-0">{label}</span>
    <span className={`text-sm font-medium text-slate-900 dark:text-slate-100 ${valueClassName}`}>{value}</span>
  </div>
);

const CustomerDetailsModal: React.FC<CustomerDetailsModalProps> = ({ open, cliente, loading, onClose, onEdit, onDelete, rfmData }) => {

  const [produtos, setProdutos] = useState<any[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);

  useEffect(() => {
    if (open && cliente?.id) {
        setLoadingProdutos(true);
        apiClient.get(`/clientes/${cliente.id}/produtos`)
            .then(res => {
                if (res.data.success) setProdutos(res.data.produtos);
            })
            .catch(err => console.error("Erro ao buscar produtos do cliente", err))
            .finally(() => setLoadingProdutos(false));
    } else {
        setProdutos([]);
    }
  }, [open, cliente]);

  const getRfmCustomer = () => {
    if (!cliente || !rfmData || !rfmData.customers) return null;
    return rfmData.customers.find((c: any) => c.cliente_id === cliente.id);
  };

  const renderSegmentChip = () => {
    const rfmC = getRfmCustomer();
    if (!rfmC) return null;
    
    let styles = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    if (rfmC.segment === 'Campeão') styles = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (rfmC.segment === 'Fiel') styles = "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    if (rfmC.segment === 'Perdido') styles = "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";

    return (
      <span className={`px-3 py-1 text-xs font-bold rounded-full ml-3 ${styles}`}>
        Segmento: {rfmC.segment}
      </span>
    );
  };

  return (
    <Dialog 
        open={open} 
        onClose={onClose} 
        maxWidth="md" 
        fullWidth
        PaperProps={{
            className: "bg-white dark:bg-slate-900 shadow-2xl dark:border dark:border-slate-800 overflow-hidden",
            style: { borderRadius: '24px' }
        }}
    >
      <DialogTitle className="flex items-center justify-between p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center">
            <span className="text-xl font-extrabold text-slate-900 dark:text-white">Detalhes do Cliente</span>
            {renderSegmentChip()}
        </div>
        <IconButton onClick={onClose} size="small" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent className="p-0 bg-slate-50/50 dark:bg-slate-900/50">
        {loading ? (
          <div className="flex justify-center items-center p-12">
            <CircularProgress />
          </div>
        ) : cliente ? (
          <div className="p-6 space-y-8">
            {/* Dados Pessoais */}
            <section className="bg-white dark:bg-slate-800/40 rounded-2xl p-5 md:p-6 border border-slate-200 dark:border-slate-700/50 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" /> Dados Pessoais
                    </h3>
                    {cliente.celular && (
                        <Button
                            variant="contained"
                            size="small"
                            className="bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/30 text-white rounded-xl font-bold px-4 py-1.5 transition-all active:scale-95 hover:-translate-y-0.5"
                            startIcon={<WhatsAppIcon />}
                            onClick={() => window.open(`https://wa.me/55${cliente.celular.replace(/\D/g, '')}`, '_blank')}
                        >
                            Conversar
                        </Button>
                    )}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
                    {cliente.tipo_pessoa === 'PJ' && <InfoRow label="Razão social" value={cliente.razao_social || '-'} />}
                    <InfoRow label={cliente.tipo_pessoa === 'PJ' ? 'Nome fantasia' : 'Nome'} value={cliente.nome || '-'} />
                    <InfoRow label={cliente.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'} value={documentoDe(cliente) || '-'} />
                    {cliente.tipo_pessoa === 'PJ' && <InfoRow label="Inscrição estadual" value={cliente.inscricao_estadual || '-'} />}
                    {cliente.tipo_pessoa === 'PJ' && <InfoRow label="Contato" value={cliente.contato_nome || '-'} />}
                    <InfoRow label="Telefone" value={cliente.celular || cliente.telefone || '-'} />
                    <InfoRow label="Email" value={cliente.email || '-'} />
                    <InfoRow label="Data Cadastro" value={cliente.data_cadastro ? new Date(cliente.data_cadastro).toLocaleDateString('pt-BR') : '-'} />
                    <InfoRow label="Última Compra" value={cliente.ultima_compra ? new Date(cliente.ultima_compra).toLocaleDateString('pt-BR') : '-'} />
                </div>
            </section>

            {/* Endereço */}
            {(cliente.logradouro || cliente.cidade) && (
              <section className="bg-white dark:bg-slate-800/40 rounded-2xl p-5 md:p-6 border border-slate-200 dark:border-slate-700/50 shadow-sm">
                <h3 className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" /> Endereço
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
                  <InfoRow label="Endereço" value={cliente.endereco_completo || `${cliente.logradouro || ''} ${cliente.numero || ''}`.trim() || '-'} />
                  <InfoRow label="Bairro" value={cliente.bairro || '-'} />
                  <InfoRow label="Cidade/UF" value={cliente.cidade ? `${cliente.cidade}${cliente.estado ? `/${cliente.estado}` : ''}` : '-'} />
                  <InfoRow label="CEP" value={cliente.cep || '-'} />
                </div>
              </section>
            )}

            {/* Financeiro */}
            <section className="bg-white dark:bg-slate-800/40 rounded-2xl p-5 md:p-6 border border-slate-200 dark:border-slate-700/50 shadow-sm">
                <h3 className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Financeiro
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
                  <InfoRow label="Total Compras" value={cliente.total_compras ?? '-'} />
                  <InfoRow
                    label="Valor Total Gasto"
                    value={`R$ ${cliente.valor_total_gasto ? Number(cliente.valor_total_gasto).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}`}
                    valueClassName="text-emerald-600 dark:text-emerald-400 font-black"
                  />
                  <InfoRow
                    label="Limite Crédito"
                    value={`R$ ${cliente.limite_credito ? Number(cliente.limite_credito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}`}
                    valueClassName="text-blue-600 dark:text-blue-400 font-bold"
                  />
                  <InfoRow
                    label="Saldo Devedor"
                    value={`R$ ${cliente.saldo_devedor ? Number(cliente.saldo_devedor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}`}
                    valueClassName={(cliente.saldo_devedor ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400 font-black' : 'text-emerald-600 dark:text-emerald-400 font-bold'}
                  />
                </div>
            </section>

            {/* Cards de resumo */}
            <section>
                <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-widest mb-4">Resumo Estatístico</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                    <div className="bg-linear-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl p-6 text-center flex flex-col justify-center shadow-sm">
                        <span className="text-3xl lg:text-4xl font-black text-indigo-600 dark:text-indigo-400 mb-2 truncate">{cliente.total_compras ?? 0}</span>
                        <span className="text-[10px] sm:text-xs font-bold text-indigo-900/60 dark:text-indigo-200/60 uppercase tracking-widest">Total Compras</span>
                    </div>

                    <div className="bg-linear-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-100 dark:border-emerald-800/50 rounded-2xl p-6 text-center flex flex-col justify-center shadow-sm overflow-hidden">
                        <span className="text-xl sm:text-lg md:text-xl lg:text-3xl font-black text-emerald-600 dark:text-emerald-400 mb-2 truncate tracking-tight">
                            R$ {cliente.valor_total_gasto ? Number(cliente.valor_total_gasto).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}
                        </span>
                        <span className="text-[10px] sm:text-xs font-bold text-emerald-900/60 dark:text-emerald-200/60 uppercase tracking-widest truncate">Valor Gasto</span>
                    </div>

                    <div className={`bg-linear-to-br border rounded-2xl p-6 text-center flex flex-col justify-center shadow-sm overflow-hidden ${
                        (cliente.saldo_devedor ?? 0) > 0 
                            ? 'from-rose-50 to-red-50 dark:from-rose-900/20 dark:to-red-900/20 border-rose-200 dark:border-rose-800/50' 
                            : 'from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 border-emerald-200 dark:border-emerald-800/50'
                    }`}>
                        <span className={`text-xl sm:text-lg md:text-xl lg:text-3xl font-black mb-2 truncate tracking-tight ${
                            (cliente.saldo_devedor ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}>
                            R$ {cliente.saldo_devedor ? Number(cliente.saldo_devedor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}
                        </span>
                        <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest truncate ${
                            (cliente.saldo_devedor ?? 0) > 0 ? 'text-rose-900/60 dark:text-rose-200/60' : 'text-emerald-900/60 dark:text-emerald-200/60'
                        }`}>
                            {(cliente.saldo_devedor ?? 0) > 0 ? 'Saldo Devedor' : 'Sem Débitos'}
                        </span>
                    </div>

                </div>
            </section>

            {/* Produtos Mais Comprados */}
            <section className="bg-white dark:bg-slate-800/40 rounded-2xl p-5 md:p-6 border border-slate-200 dark:border-slate-700/50 shadow-sm">
                <h3 className="text-sm font-extrabold text-orange-600 dark:text-orange-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                    <span className="w-2 h-2 rounded-full bg-orange-500" /> Histórico de Consumo
                </h3>
                {loadingProdutos ? (
                    <div className="flex justify-center p-6"><CircularProgress size={24} /></div>
                ) : produtos.length > 0 ? (
                    <TableContainer component={Paper} elevation={0} className="border border-slate-100 dark:border-slate-700/50 rounded-xl overflow-hidden bg-transparent">
                        <Table size="small">
                            <TableHead className="bg-slate-50 dark:bg-slate-800/80">
                                <TableRow>
                                    <TableCell className="font-bold text-slate-600 dark:text-slate-300">Produto</TableCell>
                                    <TableCell align="right" className="font-bold text-slate-600 dark:text-slate-300">Qtd. Total</TableCell>
                                    <TableCell align="right" className="font-bold text-slate-600 dark:text-slate-300">Valor Gasto</TableCell>
                                    <TableCell align="right" className="font-bold text-slate-600 dark:text-slate-300">Última Compra</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {produtos.map((prod) => (
                                    <TableRow key={prod.produto_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                        <TableCell className="text-slate-700 dark:text-slate-200 font-medium">{prod.nome}</TableCell>
                                        <TableCell align="right" className="text-slate-600 dark:text-slate-400">
                                            {Number(prod.quantidade_total).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                                        </TableCell>
                                        <TableCell align="right" className="text-slate-600 dark:text-slate-400">
                                            R$ {Number(prod.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell align="right" className="text-slate-500 dark:text-slate-500 text-xs">
                                            {prod.ultima_compra ? new Date(prod.ultima_compra).toLocaleDateString('pt-BR') : '-'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <div className="text-center p-6 text-slate-500 flex flex-col items-center justify-center gap-2">
                        <InventoryIcon className="text-slate-300 dark:text-slate-600" fontSize="large" />
                        <Typography variant="body2">Nenhum produto consumido (vendas finalizadas) encontrado para este cliente.</Typography>
                    </div>
                )}
            </section>
          </div>
        ) : (
          <div className="p-16 text-center text-slate-500 dark:text-slate-400 font-medium">Cliente não encontrado.</div>
        )}
      </DialogContent>
      
      <DialogActions className="p-5 px-6 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        {!loading && cliente && (
          <div className="flex w-full justify-between items-center">
            <div className="flex gap-3">
                <Button onClick={() => onEdit(cliente)} variant="contained" className="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20 text-white rounded-xl font-bold px-6 py-2 transition-all active:scale-95">Editar Perfil</Button>
                <Button onClick={() => onDelete(cliente)} variant="outlined" color="error" className="rounded-xl font-bold px-6 py-2 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all active:scale-95">Excluir</Button>
            </div>
            <Button onClick={onClose} variant="text" className="text-slate-500 dark:text-slate-400 font-bold rounded-xl px-6 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95">Fechar</Button>
          </div>
        )}
        {(loading || !cliente) && (
            <Button onClick={onClose} variant="text" className="text-slate-500 dark:text-slate-400 font-bold rounded-xl px-6 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95">Fechar</Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CustomerDetailsModal;
