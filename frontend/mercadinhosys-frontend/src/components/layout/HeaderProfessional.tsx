import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { User, LogOut, Settings, Moon, Sun, ChevronDown, X } from 'lucide-react';
import { useConfig } from '../../contexts/ConfigContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/useTheme';
import logo from '../../../logoprincipal.png';
import { authService } from '../../features/auth/authService';
import EstablishmentSelector from '../EstablishmentSelector';
import { InstallButton } from '../pwa/InstallButton';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const HeaderProfessional = () => {
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
    const passwordChecks = useMemo(() => {
        const pwd = newPassword;
        return {
            length: pwd.length >= 8,
            upper: /[A-Z]/.test(pwd),
            lower: /[a-z]/.test(pwd),
            number: /[0-9]/.test(pwd),
            special: /[^A-Za-z0-9]/.test(pwd),
            match: pwd === confirmPassword,
        };
    }, [newPassword, confirmPassword]);

    const navigate = useNavigate();
    const { config } = useConfig();
    const { mode, toggleTheme } = useTheme();
    const isDark = mode === 'dark';
    const { user, logout } = useAuth();
    const isSuperAdmin = user?.is_super_admin;

    useBodyScrollLock(profileModalOpen);

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [showEditProfile, setShowEditProfile] = useState(false);
    const [editNome, setEditNome] = useState<string>(user?.nome ?? '');
    const [editEmail, setEditEmail] = useState<string>(user?.email ?? '');
    const [editTelefone, setEditTelefone] = useState<string>(user?.telefone ?? '');
    const [editFotoUrl, setEditFotoUrl] = useState<string>(user?.foto_url ?? '');
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

    // Ref para calcular posição do dropdown via portal
    const userBtnRef = useRef<HTMLButtonElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

    const userInitial = useMemo(() => {
        return user?.nome ? user.nome.charAt(0).toUpperCase() : 'U';
    }, [user?.nome]);

    const logoUrl = config?.logo_base64 || config?.logo_url || '/assets/logo.png';

    // Calcular posição do dropdown quando abre
    useEffect(() => {
        if (userMenuOpen && userBtnRef.current) {
            const rect = userBtnRef.current.getBoundingClientRect();
            setDropdownPos({
                top: rect.bottom + 8,
                right: window.innerWidth - rect.right,
            });
        }
    }, [userMenuOpen]);

    // Fechar dropdown ao fazer scroll ou resize
    useEffect(() => {
        if (!userMenuOpen) return;
        const close = () => setUserMenuOpen(false);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [userMenuOpen]);

    const handleLogout = () => {
        setUserMenuOpen(false);
        logout();
        navigate('/login');
    };

    const handleChangePassword = async () => {
        setPasswordError(null);
        setPasswordSuccess(null);
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError('Preencha todos os campos');
            return;
        }
        if (!(passwordChecks.length && passwordChecks.upper && passwordChecks.lower && passwordChecks.number && passwordChecks.special)) {
            setPasswordError('A senha deve ter 8+ caracteres, maiúscula, minúscula, número e símbolo');
            return;
        }
        if (!passwordChecks.match) {
            setPasswordError('A confirmação não coincide com a nova senha');
            return;
        }
        setChangingPassword(true);
        try {
            const result = await authService.changePassword(currentPassword, newPassword);
            setPasswordSuccess(result.message || 'Senha alterada com sucesso');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setShowChangePassword(false);
            handleLogout();
        } catch (e) {
            setPasswordError((e as Error).message);
        } finally {
            setChangingPassword(false);
        }
    };

    const handleUpdateProfile = async () => {
        setProfileError(null);
        setProfileSuccess(null);
        if (!editNome.trim()) {
            setProfileError('Nome é obrigatório');
            return;
        }
        if (editEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editEmail)) {
            setProfileError('Email inválido');
            return;
        }
        setSavingProfile(true);
        try {
            const payload: { nome?: string; email?: string; telefone?: string; foto_url?: string } = {};
            if (editNome !== user?.nome) payload.nome = editNome.trim();
            if (editEmail !== user?.email) payload.email = editEmail.trim();
            if (editTelefone !== user?.telefone) payload.telefone = editTelefone.trim();
            if (editFotoUrl !== user?.foto_url) payload.foto_url = editFotoUrl.trim();
            const result = await authService.updateProfile(payload);
            const updated = { ...user, ...result.data };
            sessionStorage.setItem('user_data', JSON.stringify(updated));
            window.dispatchEvent(new Event('auth-change'));
            setProfileSuccess(result.message || 'Perfil atualizado');
            setShowEditProfile(false);
        } catch (e) {
            setProfileError((e as Error).message);
        } finally {
            setSavingProfile(false);
        }
    };

    // ── Dropdown via Portal (escapa do overflow:hidden do layout) ──────────────
    const dropdownPortal = userMenuOpen ? createPortal(
        <>
            {/* Backdrop invisível para fechar ao clicar fora */}
            <div
                className="fixed inset-0 z-200"
                onClick={() => setUserMenuOpen(false)}
            />
            {/* Menu em si */}
            <div
                className="fixed z-201 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1"
                style={{ top: dropdownPos.top, right: dropdownPos.right }}
            >
                {/* Info do usuário */}
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {user?.nome || 'Usuário'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {user?.email || user?.username || 'Sem email'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                        {user?.cargo || user?.role || 'Cargo não definido'}
                    </p>
                </div>

                <button
                    onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                    <Settings className="w-4 h-4 shrink-0" />
                    Configurações
                </button>

                <button
                    onClick={() => { setUserMenuOpen(false); setProfileModalOpen(true); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                    <User className="w-4 h-4 shrink-0" />
                    Meu Perfil
                </button>

                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Sair
                </button>
            </div>
        </>,
        document.body
    ) : null;

    // ── Modal de Perfil via Portal ─────────────────────────────────────────────
    const profileModalPortal = profileModalOpen ? createPortal(
        <div
            className="fixed inset-0 z-300 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setProfileModalOpen(false); }}
        >
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
                {/* Header do modal */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Meu Perfil</h3>
                    <button
                        onClick={() => setProfileModalOpen(false)}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Fechar"
                    >
                        <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                </div>

                {/* Conteúdo com scroll */}
                <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
                    <div className="flex items-center gap-3">
                        {user?.foto_url ? (
                            <img src={user.foto_url} alt={user.nome} className="w-12 h-12 rounded-full object-cover" />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                                {userInitial}
                            </div>
                        )}
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{user?.nome || '-'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{user?.role || user?.cargo || '-'}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-gray-500 dark:text-gray-400">Username</p>
                            <p className="font-medium text-gray-900 dark:text-white">{user?.username || user?.usuario || '-'}</p>
                        </div>
                        <div>
                            <p className="text-gray-500 dark:text-gray-400">Email</p>
                            <p className="font-medium text-gray-900 dark:text-white truncate">{user?.email || '-'}</p>
                        </div>
                    </div>

                    {/* Editar Dados */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <button
                            onClick={() => setShowEditProfile(!showEditProfile)}
                            className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200 transition"
                        >
                            {showEditProfile ? '▲ Fechar edição' : '✏️ Editar Dados'}
                        </button>
                        {showEditProfile && (
                            <div className="mt-3 space-y-3">
                                {profileError && (
                                    <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{profileError}</div>
                                )}
                                {profileSuccess && (
                                    <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm">{profileSuccess}</div>
                                )}
                                <div className="grid grid-cols-1 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nome</label>
                                        <input type="text" value={editNome} onChange={(e) => setEditNome(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Email</label>
                                        <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Telefone</label>
                                        <input type="text" value={editTelefone} onChange={(e) => setEditTelefone(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Foto URL</label>
                                        <input type="text" value={editFotoUrl} onChange={(e) => setEditFotoUrl(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setShowEditProfile(false)}
                                        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition">
                                        Cancelar
                                    </button>
                                    <button onClick={handleUpdateProfile} disabled={savingProfile}
                                        className={`px-4 py-2 rounded-lg font-medium text-sm transition ${savingProfile ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                        {savingProfile ? 'Salvando...' : 'Salvar'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Alterar Senha */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <button
                            onClick={() => setShowChangePassword(!showChangePassword)}
                            className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200 transition"
                        >
                            {showChangePassword ? '▲ Fechar' : '🔒 Alterar Senha'}
                        </button>
                        {showChangePassword && (
                            <div className="mt-3 space-y-3">
                                {passwordError && (
                                    <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{passwordError}</div>
                                )}
                                {passwordSuccess && (
                                    <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm">{passwordSuccess}</div>
                                )}
                                <div>
                                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Senha Atual</label>
                                    <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Nova Senha</label>
                                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Confirmar Nova Senha</label>
                                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div className="text-xs space-y-0.5 text-gray-500 dark:text-gray-400">
                                    {[
                                        [passwordChecks.length, '8+ caracteres'],
                                        [passwordChecks.upper, 'Letra maiúscula'],
                                        [passwordChecks.lower, 'Letra minúscula'],
                                        [passwordChecks.number, 'Número'],
                                        [passwordChecks.special, 'Símbolo especial'],
                                        [passwordChecks.match, 'Confirmação coincide'],
                                    ].map(([ok, label]) => (
                                        <div key={label as string} className={ok ? 'text-green-600 dark:text-green-400' : ''}>
                                            {ok ? '✓' : '○'} {label as string}
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleChangePassword}
                                        disabled={changingPassword || !(passwordChecks.length && passwordChecks.upper && passwordChecks.lower && passwordChecks.number && passwordChecks.special && passwordChecks.match)}
                                        className={`px-4 py-2 rounded-lg font-medium text-sm transition ${changingPassword || !(passwordChecks.length && passwordChecks.upper && passwordChecks.lower && passwordChecks.number && passwordChecks.special && passwordChecks.match) ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                                    >
                                        {changingPassword ? 'Alterando...' : 'Salvar nova senha'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center shrink-0">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition"
                    >
                        <LogOut className="w-4 h-4" />
                        Sair da conta
                    </button>
                    <button
                        onClick={() => setProfileModalOpen(false)}
                        className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    ) : null;

    return (
        <>
            <header className="sticky top-0 z-50 w-full border-b bg-white dark:bg-gray-900 dark:border-gray-800 shadow-sm safe-area-top"
                style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
                <div className="container mx-auto px-3 sm:px-4 max-w-full">
                    <div className="flex h-16 items-center justify-between gap-2">

                        {/* Logo */}
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            <img
                                src={logoUrl}
                                alt="Logo"
                                className="h-8 sm:h-10 w-auto rounded-lg object-contain shrink-0"
                                onError={(e) => { e.currentTarget.src = logo; }}
                            />
                            <span className="text-base sm:text-xl font-extrabold bg-linear-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent truncate min-w-0">
                                MercadinhoSys
                            </span>
                        </div>

                        {/* Desktop Actions */}
                        <div className="hidden md:flex items-center gap-3 shrink-0">
                            {isSuperAdmin && <EstablishmentSelector />}
                            <InstallButton />

                            {/* Theme Toggle */}
                            <button
                                onClick={toggleTheme}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                title="Alternar tema"
                            >
                                {isDark
                                    ? <Sun className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                                    : <Moon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                                }
                            </button>

                            {/* User Menu Button */}
                            <button
                                ref={userBtnRef}
                                onClick={() => setUserMenuOpen(!userMenuOpen)}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                                {user?.foto_url ? (
                                    <img src={user.foto_url} alt={user?.nome || 'Usuário'} className="w-8 h-8 rounded-full object-cover" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-sm">
                                        {userInitial}
                                    </div>
                                )}
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 max-w-[120px] truncate">
                                    {user?.nome || 'Usuário'}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${userMenuOpen ? 'rotate-180' : ''}`} />
                            </button>
                        </div>

                        {/* Mobile Actions (tema apenas) */}
                        <div className="flex md:hidden items-center gap-2 shrink-0">
                            <InstallButton className="md:hidden" />
                            <button
                                onClick={toggleTheme}
                                className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shadow-sm"
                                title="Alternar tema"
                            >
                                {isDark
                                    ? <Sun className="w-5 h-5 text-amber-500" />
                                    : <Moon className="w-5 h-5 text-blue-600" />
                                }
                            </button>
                        </div>

                    </div>
                </div>
            </header>

            {/* Portals renderizados no document.body — fora de qualquer overflow:hidden */}
            {dropdownPortal}
            {profileModalPortal}
        </>
    );
};

export default HeaderProfessional;
