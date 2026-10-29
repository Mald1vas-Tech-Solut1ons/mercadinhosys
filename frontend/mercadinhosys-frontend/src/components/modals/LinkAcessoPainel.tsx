import React from 'react';
import { Copy, MessageCircle, MailCheck, MailWarning, X } from 'lucide-react';
import { showToast } from '../../utils/toast';
export interface LinkAcesso {
  loja: string;
  username: string;
  email: string;
  emailEnviado: boolean;
  link: string;
  telefone?: string;
}

/**
 * Resultado do link de ativação para o super admin: diz se o e-mail saiu e
 * oferece copiar / mandar por WhatsApp (plano B quando o e-mail não chega).
 */
const LinkAcessoPainel: React.FC<{ acesso: LinkAcesso; onClose: () => void }> = ({ acesso, onClose }) => {
  const mensagem = `Olá! Sua loja ${acesso.loja} está pronta no MercadinhoSys. `
    + `Seu usuário é ${acesso.username}. Crie sua senha por este link (vale 72 horas, uso único): ${acesso.link}`;
  const fone = (acesso.telefone || '').replace(/\D/g, '');
  const whatsapp = `https://wa.me/${fone ? (fone.startsWith('55') ? fone : `55${fone}`) : ''}?text=${encodeURIComponent(mensagem)}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(acesso.link);
      showToast.success('Link copiado');
    } catch {
      showToast.error('Não foi possível copiar; selecione o link e copie manualmente.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[210] p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Acesso de {acesso.loja}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        {acesso.emailEnviado ? (
          <div className="flex gap-3 p-3 mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 text-sm">
            <MailCheck className="w-5 h-5 shrink-0" />
            <span>E-mail de ativação enviado para <strong>{acesso.email}</strong>. O cliente cria a própria senha pelo link.</span>
          </div>
        ) : (
          <div className="flex gap-3 p-3 mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
            <MailWarning className="w-5 h-5 shrink-0" />
            <span>O e-mail não foi enviado (provedor não configurado ou falhou). Mande o link abaixo pelo WhatsApp.</span>
          </div>
        )}

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">Usuário: <strong>{acesso.username}</strong></p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Link de ativação (72 horas, uso único — gerar outro invalida este):</p>
        <div className="p-3 mb-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-mono break-all text-gray-800 dark:text-gray-200 select-all">
          {acesso.link}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={copiar}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Copy className="w-4 h-4" /> Copiar link
          </button>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold">
            <MessageCircle className="w-4 h-4" /> Enviar por WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};

export default LinkAcessoPainel;
