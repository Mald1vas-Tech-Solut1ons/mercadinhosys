import React from 'react';
import { Cliente } from '../../../types';
import { IconButton, Tooltip, Skeleton, Chip } from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import HandshakeIcon from '@mui/icons-material/Handshake';

interface CustomerTableProps {
  clientes: Cliente[];
  loading?: boolean;
  onRowClick?: (cliente: Cliente) => void;
  onEdit?: (cliente: Cliente) => void;
  onDelete?: (cliente: Cliente) => void;
  onReceberFiado?: (cliente: Cliente) => void;
  selectedClienteId?: number;
  rfmData?: any;
}
const CustomerTable: React.FC<CustomerTableProps> = ({ clientes, loading, onRowClick, onEdit, onDelete, onReceberFiado, selectedClienteId, rfmData }) => {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="hidden lg:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-2 sm:px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">Nome</th>
            <th className="hidden sm:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">CPF</th>
            <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">Telefone</th>
            <th className="hidden lg:table-cell px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">Email</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">Fiado</th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-200">Segmento</th>
            <th className="px-2 sm:px-4 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {loading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <tr key={index}>
                <td className="px-4 py-2"><Skeleton variant="text" width={150} /></td>
                <td className="px-4 py-2"><Skeleton variant="text" width={120} /></td>
                <td className="px-4 py-2"><Skeleton variant="text" width={130} /></td>
                <td className="px-4 py-2"><Skeleton variant="text" width={100} /></td>
                <td className="px-4 py-2"><Skeleton variant="text" width={80} /></td>
                <td className="px-4 py-2 text-center"><Skeleton variant="rectangular" width={100} height={36} /></td>
              </tr>
            ))
          ) : clientes.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                Nenhum cliente encontrado.
              </td>
            </tr>
          ) : (
            clientes.map((cliente) => {
              const temFiado = (cliente.saldo_devedor ?? 0) > 0;
              const rfmCliente = rfmData?.customers?.find((c: any) => c.cliente_id === cliente.id);
              const segmento = rfmCliente?.segment;
              return (
                <tr
                  key={cliente.id}
                  className={`transition cursor-pointer ${selectedClienteId === cliente.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500'
                      : temFiado
                        ? 'bg-orange-50 dark:bg-orange-900/10 hover:bg-orange-100 dark:hover:bg-orange-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  onClick={onRowClick ? () => onRowClick(cliente) : undefined}
                >

                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold shadow-sm">
                        {cliente.nome ? cliente.nome.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">
                          {cliente.nome}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center mt-0.5">
                          {cliente.cpf ? `CPF: ${cliente.cpf}` : 'Sem documento'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-2 whitespace-nowrap">{cliente.cpf || '-'}</td>
                  <td className="hidden md:table-cell px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {cliente.celular || cliente.telefone || <span className="text-gray-400 font-normal italic">Não informado</span>}
                    </span>
                  </td>
                  <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {cliente.email || <span className="text-gray-400 italic">Não informado</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {temFiado ? (
                      <Chip
                        label={(cliente.saldo_devedor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        size="small"
                        icon={<HandshakeIcon style={{ fontSize: 14 }} />}
                        sx={{
                          bgcolor: '#fff3e0',
                          color: '#e65100',
                          fontWeight: 700,
                          border: '1px solid #ffcc80',
                          fontSize: '0.75rem',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                      />
                    ) : (
                      <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">Sem fiado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                     {segmento ? (
                        <Chip
                           label={segmento}
                           size="small"
                           sx={{
                             fontWeight: 700,
                             fontSize: '0.7rem',
                             letterSpacing: 0.5,
                             textTransform: 'uppercase',
                             bgcolor: segmento === 'VIP' ? '#f3e8ff' : 
                                      segmento === 'Premium' ? '#dbeafe' : 
                                      segmento === 'Final de Semana' ? '#dcfce7' : 
                                      segmento === 'Caçador de Promoções' ? '#fce7f3' : 
                                      segmento === 'Raro' ? '#ffedd5' : 
                                      segmento === 'Novo' ? '#ccfbf1' : '#f3f4f6',
                             color: segmento === 'VIP' ? '#7e22ce' : 
                                      segmento === 'Premium' ? '#1d4ed8' : 
                                      segmento === 'Final de Semana' ? '#15803d' :
                                      segmento === 'Caçador de Promoções' ? '#be185d' : 
                                      segmento === 'Raro' ? '#c2410c' : 
                                      segmento === 'Novo' ? '#0f766e' : '#374151',
                             border: '1px solid',
                             borderColor: segmento === 'VIP' ? '#e9d5ff' : 
                                      segmento === 'Premium' ? '#bfdbfe' : 
                                      segmento === 'Final de Semana' ? '#bbf7d0' : 
                                      segmento === 'Caçador de Promoções' ? '#fbcfe8' : 
                                      segmento === 'Raro' ? '#fed7aa' : 
                                      segmento === 'Novo' ? '#99f6e4' : '#e5e7eb',
                           }}
                        />
                     ) : <span className="text-xs text-gray-400">—</span>}
                     {rfmCliente?.risco_inadimplencia && rfmCliente.risco_inadimplencia !== 'BAIXO' && (
                         <Tooltip title={`Risco de Inadimplência: ${rfmCliente.risco_inadimplencia}`}>
                             <Chip
                                label={rfmCliente.risco_inadimplencia}
                                size="small"
                                sx={{ ml: 1, height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: rfmCliente.risco_inadimplencia === 'ALTO' ? '#fee2e2' : '#fef3c7', color: rfmCliente.risco_inadimplencia === 'ALTO' ? '#b91c1c' : '#b45309' }}
                             />
                         </Tooltip>
                     )}
                  </td>
                  <td className="px-2 sm:px-4 py-3 whitespace-nowrap text-center">
                    <div className="flex justify-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      {temFiado && onReceberFiado && (
                        <Tooltip title="Receber Fiado">
                          <IconButton size="small" onClick={() => onReceberFiado(cliente)} sx={{ color: '#f57c00' }}>
                            <HandshakeIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onEdit && (
                        <Tooltip title="Editar">
                          <IconButton size="small" onClick={() => onEdit(cliente)} color="primary">
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onDelete && (
                        <Tooltip title="Excluir">
                          <IconButton size="small" onClick={() => onDelete(cliente)} color="error">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>

      {/* Visão de Cards Mobile */}
      <div className="lg:hidden flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="p-4 flex flex-col gap-2">
              <Skeleton variant="text" width="60%" height={24} />
              <Skeleton variant="text" width="40%" height={20} />
              <Skeleton variant="rectangular" width="100%" height={40} className="mt-2" />
            </div>
          ))
        ) : clientes.length === 0 ? (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            Nenhum cliente encontrado.
          </div>
        ) : (
          clientes.map((cliente) => {
            const temFiado = (cliente.saldo_devedor ?? 0) > 0;
            const rfmCliente = rfmData?.customers?.find((c: any) => c.cliente_id === cliente.id);
            const segmento = rfmCliente?.segment;
            
            return (
              <div 
                key={cliente.id}
                className={`p-4 flex flex-col gap-3 transition cursor-pointer ${
                  selectedClienteId === cliente.id
                    ? 'bg-blue-50/50 dark:bg-blue-900/10'
                    : temFiado
                    ? 'bg-orange-50/30 dark:bg-orange-900/5'
                    : 'bg-white dark:bg-gray-900'
                }`}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (!target.closest('.actions-mobile')) {
                    onRowClick?.(cliente);
                  }
                }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold shadow-sm">
                      {cliente.nome ? cliente.nome.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white leading-tight">
                        {cliente.nome}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {cliente.celular || cliente.telefone || (cliente.cpf ? `CPF: ${cliente.cpf}` : 'Sem contato')}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                     {segmento && (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                            segmento === 'VIP' ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                            segmento === 'Premium' ? 'bg-blue-50 text-blue-700 border-blue-200' : 
                            segmento === 'Final de Semana' ? 'bg-green-50 text-green-700 border-green-200' : 
                            segmento === 'Caçador de Promoções' ? 'bg-pink-50 text-pink-700 border-pink-200' : 
                            segmento === 'Raro' ? 'bg-orange-50 text-orange-700 border-orange-200' : 
                            segmento === 'Novo' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-700 border-gray-200'
                        }`}>
                          {segmento}
                        </span>
                     )}
                     {rfmCliente?.risco_inadimplencia && rfmCliente.risco_inadimplencia !== 'BAIXO' && (
                         <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${rfmCliente.risco_inadimplencia === 'ALTO' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
                             {rfmCliente.risco_inadimplencia} RISCO
                         </span>
                     )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-2 flex flex-col">
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Fiado Pendente</span>
                    {temFiado ? (
                      <span className="text-sm font-bold text-orange-600">{(cliente.saldo_devedor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    ) : (
                      <span className="text-xs font-medium text-gray-400">R$ 0,00</span>
                    )}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-2 flex flex-col">
                    <span className="text-[10px] text-gray-500 uppercase font-bold">Email</span>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {cliente.email || '-'}
                    </span>
                  </div>
                </div>

                <div className="actions-mobile flex items-center justify-end gap-2 mt-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  {temFiado && onReceberFiado && (
                    <button 
                      onClick={() => onReceberFiado(cliente)} 
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors"
                    >
                      <HandshakeIcon style={{ fontSize: 16 }} />
                      <span className="text-xs font-bold">Receber</span>
                    </button>
                  )}
                  {onEdit && (
                    <button 
                      onClick={() => onEdit(cliente)} 
                      className="flex items-center justify-center p-1.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <EditIcon style={{ fontSize: 18 }} />
                    </button>
                  )}
                  {onDelete && (
                    <button 
                      onClick={() => onDelete(cliente)} 
                      className="flex items-center justify-center p-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    >
                      <DeleteIcon style={{ fontSize: 18 }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CustomerTable;
