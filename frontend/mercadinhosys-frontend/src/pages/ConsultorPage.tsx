import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Bot, User } from 'lucide-react';
import { consultorService } from '../services/consultorService';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';

interface Mensagem {
  id: number;
  texto: string;
  isBot: boolean;
  timestamp: Date;
}

export const ConsultorPage: React.FC = () => {
  const [mensagens, setMensagens] = useState<Mensagem[]>([
    {
      id: 1,
      texto: 'Olá! Sou o Consultor M-IA do MercadinhoSys. Especialista em Vendas, Estoque, Financeiro e Gestão de Pessoas. Como posso te ajudar hoje?',
      isBot: true,
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [especialista, setEspecialista] = useState<'geral' | 'financeiro' | 'vendas' | 'estoque' | 'rh' | 'compras'>('geral');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [mensagens, loading]);

  const handleSend = async () => {
    if (!inputValue.trim() || loading) return;

    const userText = inputValue;
    setInputValue('');
    
    setMensagens(prev => [...prev, {
      id: Date.now(),
      texto: userText,
      isBot: false,
      timestamp: new Date()
    }]);

    setLoading(true);

    try {
      const response = await consultorService.enviarMensagemChat(especialista, userText);
      if (response.success && response.resposta) {
        setMensagens(prev => [...prev, {
          id: Date.now(),
          texto: response.resposta!,
          isBot: true,
          timestamp: new Date()
        }]);
      } else {
        toast.error(response.error || 'Erro ao processar mensagem.');
        setMensagens(prev => [...prev, {
          id: Date.now(),
          texto: `Desculpe, ocorreu um erro: ${response.error || 'Falha na conexão'}`,
          isBot: true,
          timestamp: new Date()
        }]);
      }
    } catch (err) {
      toast.error('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  const sugestoes = [
    'Quais são os produtos mais vendidos hoje?',
    'Faturamento vs Despesas deste mês',
    'Existe algum produto com estoque baixo?',
    'Resumo geral da loja'
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden shadow-lg border border-gray-100 dark:border-gray-800">
      
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-linear-to-br from-indigo-500 to-purple-600 text-white shadow-md">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Consultor M-IA</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Powered by MercadinhoSys Inteligência</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 font-medium">Especialidade:</span>
          <select 
            value={especialista}
            onChange={(e) => setEspecialista(e.target.value as any)}
            className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2"
          >
            <option value="geral">Visão Geral (Master)</option>
            <option value="financeiro">Financeiro & DRE</option>
            <option value="vendas">Vendas & Produtos</option>
            <option value="estoque">Estoque & Compras</option>
            <option value="rh">Gente & RH</option>
          </select>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-[url('/pattern.svg')] dark:bg-[url('/pattern-dark.svg')] bg-repeat bg-opacity-5">
        <AnimatePresence>
          {mensagens.map((msg) => (
            <motion.div 
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex flex-col max-w-[80%] ${msg.isBot ? 'mr-auto items-start' : 'ml-auto items-end'}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                  {msg.isBot ? <Bot className="w-3 h-3 text-indigo-500" /> : <User className="w-3 h-3 text-gray-400" />}
                  {msg.isBot ? 'M-IA Consultor' : 'Você'}
                </span>
                <span className="text-[10px] text-gray-400">
                  {msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              
              <div className={`p-4 rounded-2xl shadow-sm leading-relaxed ${
                msg.isBot 
                  ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-none' 
                  : 'bg-linear-to-r from-indigo-500 to-purple-600 text-white rounded-tr-none'
              }`}>
                {msg.isBot ? (
                  <div className="prose dark:prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{msg.texto}</ReactMarkdown>
                  </div>
                ) : (
                  <p>{msg.texto}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {loading && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex mr-auto items-start max-w-[80%]"
          >
            <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-none border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sugestoes */}
      {mensagens.length < 3 && (
        <div className="px-4 py-3 bg-white dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700 flex gap-2 overflow-x-auto no-scrollbar">
          {sugestoes.map((sug, i) => (
            <button
              key={i}
              onClick={() => setInputValue(sug)}
              className="whitespace-nowrap px-4 py-2 bg-gray-50 hover:bg-indigo-50 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 hover:border-indigo-200 dark:hover:border-indigo-500 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-full transition-all shrink-0"
            >
              {sug}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-end gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl p-2 border border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all shadow-inner"
        >
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Pergunte sobre faturamento, estoque, despesas..."
            className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none text-gray-700 dark:text-gray-200 py-3 px-2"
            rows={1}
          />
          <button 
            type="submit"
            disabled={!inputValue.trim() || loading}
            className="p-3 mb-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white transition-colors shadow-md disabled:shadow-none"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <p className="text-center text-[10px] text-gray-400 mt-2 font-medium">
          As respostas são baseadas nos dados exatos da sua loja através da tecnologia Context Builder™.
        </p>
      </div>

    </div>
  );
};
