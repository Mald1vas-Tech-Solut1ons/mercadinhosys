import React, { useState } from 'react';
import { User, Mail, Lock, Save, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authService } from '../auth/authService';
import { showToast } from '../../utils/toast';
import { isValidEmail, checkPasswordStrength } from '../../utils/validators';

/**
 * Aba "Minha Conta" — o próprio usuário altera nome/e-mail e a senha.
 * Reaproveita authService.updateProfile e authService.changePassword (que já
 * desloga após trocar a senha, forçando novo login com a credencial nova).
 */
const AccountSettings: React.FC = () => {
    const { user } = useAuth();
    const u = user as any;

    const [nome, setNome] = useState<string>(u?.nome || u?.name || '');
    const [email, setEmail] = useState<string>(u?.email || '');
    const [salvandoPerfil, setSalvandoPerfil] = useState(false);

    const [senhaAtual, setSenhaAtual] = useState('');
    const [novaSenha, setNovaSenha] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [salvandoSenha, setSalvandoSenha] = useState(false);

    const salvarPerfil = async () => {
        if (!nome.trim()) { showToast.error('Informe seu nome'); return; }
        if (!isValidEmail(email)) { showToast.error('E-mail inválido'); return; }
        setSalvandoPerfil(true);
        try {
            await authService.updateProfile({ nome: nome.trim(), email: email.trim() });
            showToast.success('Dados da conta atualizados');
        } catch (e: any) {
            showToast.error(e?.message || 'Falha ao atualizar os dados');
        } finally {
            setSalvandoPerfil(false);
        }
    };

    const trocarSenha = async () => {
        if (!senhaAtual) { showToast.error('Informe a senha atual'); return; }
        if (novaSenha.length < 6) { showToast.error('A nova senha deve ter ao menos 6 caracteres'); return; }
        if (novaSenha !== confirmar) { showToast.error('A confirmação não confere com a nova senha'); return; }
        setSalvandoSenha(true);
        try {
            await authService.changePassword(senhaAtual, novaSenha);
            showToast.success('Senha alterada! Entre novamente com a nova senha.');
            setTimeout(() => { window.location.href = '/login'; }, 1300);
        } catch (e: any) {
            showToast.error(e?.message || 'Falha ao alterar a senha');
        } finally {
            setSalvandoSenha(false);
        }
    };

    const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-gray-700 dark:text-white';
    const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Dados da conta */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Dados da conta</h2>
                </div>
                {u?.username && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Usuário de acesso: <strong className="text-gray-700 dark:text-gray-200">{u.username}</strong>
                    </p>
                )}
                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Nome</label>
                        <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />
                    </div>
                    <div>
                        <label className={labelCls}><Mail className="inline w-3.5 h-3.5 mr-1" />E-mail</label>
                        <input className={`${inputCls} ${email ? (isValidEmail(email) ? 'border-green-500! focus:ring-green-500 focus:border-green-500!' : 'border-red-500! focus:ring-red-500 focus:border-red-500!') : ''}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
                    </div>
                </div>
                <div className="flex justify-end">
                    <button
                        onClick={salvarPerfil}
                        disabled={salvandoPerfil}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                        {salvandoPerfil ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar dados
                    </button>
                </div>
            </div>

            {/* Trocar senha */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Alterar senha</h2>
                </div>
                <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    Por segurança, ao alterar a senha você será deslogado e deverá entrar novamente com a nova senha.
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                        <label className={labelCls}>Senha atual</label>
                        <input className={inputCls} type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="current-password" />
                    </div>
                    <div>
                        <label className={labelCls}>Nova senha</label>
                        <input className={`${inputCls} ${novaSenha ? (checkPasswordStrength(novaSenha) === 'weak' ? 'border-red-500! focus:border-red-500!' : checkPasswordStrength(novaSenha) === 'medium' ? 'border-yellow-500! focus:border-yellow-500!' : 'border-green-500! focus:border-green-500!') : ''}`} type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" placeholder="mín. 6 caracteres" />
                        {novaSenha && (
                            <div className="mt-2 flex items-center gap-2">
                                <div className={`flex-1 h-1.5 rounded-full transition-colors ${checkPasswordStrength(novaSenha) === 'weak' ? 'bg-red-500' : checkPasswordStrength(novaSenha) === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                                <span className={`text-[10px] font-black uppercase ${checkPasswordStrength(novaSenha) === 'weak' ? 'text-red-500' : checkPasswordStrength(novaSenha) === 'medium' ? 'text-yellow-600' : 'text-green-600'}`}>
                                    {checkPasswordStrength(novaSenha) === 'weak' ? 'Fraca' : checkPasswordStrength(novaSenha) === 'medium' ? 'Média' : 'Forte'}
                                </span>
                            </div>
                        )}
                    </div>
                    <div>
                        <label className={labelCls}>Confirmar nova senha</label>
                        <input className={inputCls} type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
                    </div>
                </div>
                <div className="flex justify-end">
                    <button
                        onClick={trocarSenha}
                        disabled={salvandoSenha}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                        {salvandoSenha ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Alterar senha
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AccountSettings;
