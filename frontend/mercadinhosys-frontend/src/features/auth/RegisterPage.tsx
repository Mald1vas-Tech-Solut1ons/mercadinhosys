import { useState, useCallback } from 'react';
import {
    Box,
    Button,
    TextField,
    Typography,
    Paper,
    Alert,
    CircularProgress,
    Container,
    useTheme,
    Divider,
    Checkbox,
    FormControlLabel,
} from '@mui/material';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from './authService';
import { showToast } from '../../utils/toast';
import { erroSenha } from '../../utils/validators';
import logo from '../../../logoprincipal.png';

export function RegisterPage() {
    const theme = useTheme();
    const mode = theme.palette.mode;
    const navigate = useNavigate();

    // Estados do formulário
    const [formData, setFormData] = useState({
        nome_fantasia: '',
        cnpj: '',
        telefone_loja: '',
        email_loja: '',
        nome_admin: '',
        cpf_admin: '',
        celular_admin: '',
        username: '',
        senha: '',
        confirmar_senha: '',
    });

    const [termsAccepted, setTermsAccepted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();

        const problemaSenha = erroSenha(formData.senha);
        if (problemaSenha) {
            setError(problemaSenha);
            return;
        }
        if (formData.senha !== formData.confirmar_senha) {
            setError('As senhas não conferem.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // payload exato que o backend espera
            const payload = {
                nome_fantasia: formData.nome_fantasia,
                razao_social: formData.nome_fantasia, // Mesma coisa por padrão
                cnpj: formData.cnpj,
                telefone_loja: formData.telefone_loja,
                email_loja: formData.email_loja || formData.username + '@loja.com',
                nome_admin: formData.nome_admin,
                cpf_admin: formData.cpf_admin,
                celular_admin: formData.celular_admin,
                email_admin: formData.email_loja, // E-mail usado para receber as credenciais
                username: formData.username,
                senha: formData.senha,
            };

            const promise = authService.registerAccount(payload);

            await showToast.promise(promise, {
                loading: 'Criando sua conta...',
                success: 'Conta criada! Entre com seu usuário e a senha escolhida.',
                error: 'Erro ao criar conta. Verifique os dados.'
            });

            // Se sucesso, redireciona para o login
            navigate('/login');

        } catch (err: any) {
            console.error('❌ Erro no registro:', err);
            setError(err.message || 'Erro ao criar conta');
        } finally {
            setLoading(false);
        }
    }, [formData, navigate]);

    const isFormValid =
        formData.nome_fantasia &&
        formData.cnpj &&
        formData.nome_admin &&
        formData.email_loja &&
        formData.username &&
        formData.senha.length >= 6 &&
        formData.senha === formData.confirmar_senha &&
        termsAccepted;

    return (
        <Container maxWidth={false} sx={{ minHeight: '100vh', p: 0 }}>
            <Box
                sx={{
                    display: 'flex',
                    minHeight: '100vh',
                    background: mode === 'dark'
                        ? 'linear-gradient(135deg, #121212 0%, #1a1a2e 50%, #16213e 100%)'
                        : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)',
                }}
            >
                {/* Lado esquerdo - Branding */}
                <Box
                    sx={{
                        display: { xs: 'none', lg: 'flex' },
                        flex: 1,
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        p: 8,
                        color: mode === 'dark' ? 'white' : '#1e293b',
                    }}
                >
                    <img src={logo} alt="Logo" style={{ height: 120, marginBottom: 32, borderRadius: 12, boxShadow: '0 2px 12px #0002' }} />
                    <Typography variant="h4" fontWeight="black" sx={{ mb: 2, letterSpacing: '-0.02em' }}>
                        Mercadinho<span style={{ color: '#3b82f6' }}>Sys</span>
                    </Typography>
                    <Typography variant="h6" sx={{ opacity: 0.7, textAlign: 'center', maxWidth: 400 }}>
                        Plataforma completa para gestão de mercados. Crie sua conta e comece a faturar.
                    </Typography>
                </Box>

                {/* Lado direito - Registro Form */}
                <Box
                    sx={{
                        display: 'flex',
                        flex: { xs: 1, lg: 1.2 },
                        justifyContent: 'center',
                        alignItems: 'center',
                        p: { xs: 2, sm: 4 },
                    }}
                >
                    <Paper
                        elevation={24}
                        sx={{
                            p: { xs: 3, sm: 5 },
                            width: '100%',
                            maxWidth: 700,
                            borderRadius: 4,
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            background: mode === 'dark' ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.95)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}
                    >
                        <Box sx={{ textAlign: 'center', mb: 3 }}>
                            <Typography variant="h4" gutterBottom sx={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
                                Criar Nova Conta
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                Após o cadastro, suas credenciais de acesso serão enviadas para o e-mail informado.
                            </Typography>
                        </Box>

                        {error && (
                            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                                {error}
                            </Alert>
                        )}

                        <form onSubmit={handleSubmit}>

                            <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>Dados da Loja</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                                <Box>
                                    <TextField fullWidth label="Nome Fantasia *" name="nome_fantasia" value={formData.nome_fantasia} onChange={handleChange} required />
                                </Box>
                                <Box>
                                    <TextField fullWidth label="CNPJ (ou CPF) *" name="cnpj" value={formData.cnpj} onChange={handleChange} required />
                                </Box>
                                <Box>
                                    <TextField fullWidth label="Telefone da Loja *" name="telefone_loja" value={formData.telefone_loja} onChange={handleChange} required />
                                </Box>
                                <Box>
                                    <TextField fullWidth label="E-mail da Loja *" name="email_loja" type="email" value={formData.email_loja} onChange={handleChange} required helperText="Usado para receber as credenciais" />
                                </Box>
                            </Box>

                            <Divider sx={{ my: 4 }} />

                            <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>Dados do Administrador</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                                <Box>
                                    <TextField fullWidth label="Nome Completo *" name="nome_admin" value={formData.nome_admin} onChange={handleChange} required />
                                </Box>
                                <Box>
                                    <TextField fullWidth label="CPF *" name="cpf_admin" value={formData.cpf_admin} onChange={handleChange} required />
                                </Box>
                                <Box sx={{ gridColumn: '1 / -1' }}>
                                    <TextField fullWidth label="Celular (WhatsApp) *" name="celular_admin" value={formData.celular_admin} onChange={handleChange} required />
                                </Box>
                                <Box sx={{ gridColumn: '1 / -1' }}>
                                    <TextField fullWidth label="Nome de Usuário (Opcional, Padrão: Email) *" name="username" value={formData.username} onChange={handleChange} required />
                                </Box>
                            </Box>

                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 2 }}>
                                <TextField fullWidth type="password" label="Senha (mín. 8, letras e números) *" name="senha" value={formData.senha} onChange={handleChange} required autoComplete="new-password" />
                                <TextField fullWidth type="password" label="Confirmar senha *" name="confirmar_senha" value={formData.confirmar_senha} onChange={handleChange} required autoComplete="new-password"
                                    error={!!formData.confirmar_senha && formData.senha !== formData.confirmar_senha}
                                    helperText={formData.confirmar_senha && formData.senha !== formData.confirmar_senha ? 'As senhas não conferem' : ' '} />
                            </Box>

                            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={termsAccepted}
                                            onChange={(e) => setTermsAccepted(e.target.checked)}
                                            color="primary"
                                        />
                                    }
                                    label={
                                        <Typography variant="body2" color="text.secondary">
                                            Li, compreendi e aceito os{' '}
                                            <a href="/termos" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 'bold' }}>Termos de Uso</a>
                                            {' '}e a{' '}
                                            <a href="/privacidade" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 'bold' }}>Política de Privacidade</a>.
                                        </Typography>
                                    }
                                />
                            </Box>

                            <Box sx={{ mt: 4 }}>
                                <Button
                                    fullWidth
                                    type="submit"
                                    variant="contained"
                                    size="large"
                                    disabled={!isFormValid || loading}
                                    sx={{
                                        py: 1.5,
                                        borderRadius: 2,
                                        fontWeight: 'bold',
                                        fontSize: '1rem',
                                        textTransform: 'none',
                                        boxShadow: '0 10px 20px -5px rgba(59, 130, 246, 0.5)',
                                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                    }}
                                >
                                    {loading ? <CircularProgress size={26} color="inherit" /> : 'Criar Conta e Receber Acesso'}
                                </Button>
                            </Box>

                            <Box sx={{ mt: 3, textAlign: 'center' }}>
                                <Typography variant="body2" color="text.secondary">
                                    Já possui uma conta?{' '}
                                    <Link to="/login" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 'bold' }}>
                                        Faça login aqui
                                    </Link>
                                </Typography>
                            </Box>
                        </form>
                    </Paper>
                </Box>
            </Box>
        </Container>
    );
}
