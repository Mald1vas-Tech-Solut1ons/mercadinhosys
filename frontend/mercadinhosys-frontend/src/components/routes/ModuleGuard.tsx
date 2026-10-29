import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { showToast } from '../../utils/toast';
import { authService } from '../../features/auth/authService';
import { canAccess, getDefaultRoute, isPlanoGratis, MODULOS_PLANO_GRATIS, Modulo, UsuarioLogado } from '../../utils/permissions';

interface ModuleGuardProps {
    modulo: Modulo;
    children: React.ReactNode;
}

/**
 * Guarda de rota única: aplica nível do cargo E plano do estabelecimento
 * (Regras de Acesso). Substitui o antigo PlanoGuard, que só olhava o plano.
 */
const ModuleGuard: React.FC<ModuleGuardProps> = ({ modulo, children }) => {
    const [user, setUser] = useState<UsuarioLogado | null>(authService.getCurrentUser());

    useEffect(() => {
        const handleAuthChange = () => setUser(authService.getCurrentUser());
        window.addEventListener('auth-change', handleAuthChange);
        return () => window.removeEventListener('auth-change', handleAuthChange);
    }, []);

    const permitido = canAccess(modulo, user);

    useEffect(() => {
        if (!permitido && user) {
            const bloqueadoPeloPlano = isPlanoGratis(user) && !MODULOS_PLANO_GRATIS.includes(modulo);
            showToast.error(
                bloqueadoPeloPlano
                    ? 'Este módulo não está incluído no Plano Grátis. Faça upgrade para desbloquear.'
                    : 'Seu cargo não tem permissão para acessar este módulo.',
                { id: 'module-guard-error', duration: 4000, position: 'top-center' }
            );
        }
    }, [permitido, modulo, user]);

    if (!permitido) {
        return <Navigate to={getDefaultRoute(user)} replace />;
    }

    return <>{children}</>;
};

export default ModuleGuard;
