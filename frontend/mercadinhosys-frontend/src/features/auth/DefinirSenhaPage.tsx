import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { LockOutlined, MailOutline, Visibility, VisibilityOff } from '@mui/icons-material';
import { apiClient } from '../../api/apiClient';
import { erroSenha } from '../../utils/validators';

interface InfoToken {
  finalidade: 'ativacao' | 'redefinicao';
  nome: string;
  username: string;
  loja: string | null;
}

const mensagemApi = (err: unknown, padrao: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || padrao;

/**
 * Link de uso único do e-mail: ativa a conta (cliente novo cria a própria senha)
 * ou redefine a senha esquecida. Sem token na URL vira o "Esqueci minha senha".
 */
export default function DefinirSenhaPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [carregando, setCarregando] = useState(Boolean(token));
  const [info, setInfo] = useState<InfoToken | null>(null);
  const [erro, setErro] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [pedidoEnviado, setPedidoEnviado] = useState(false);

  useEffect(() => {
    // Trocar de link (ou ir para "Esqueci minha senha") começa do zero.
    setErro('');
    setInfo(null);
    setPedidoEnviado(false);
    if (!token) { setCarregando(false); return; }
    setCarregando(true);
    apiClient.get<InfoToken & { success: boolean }>(`/auth/senha/token/${encodeURIComponent(token)}`)
      .then(r => setInfo(r.data))
      .catch(err => setErro(mensagemApi(err, 'Link inválido ou expirado. Peça um novo link.')))
      .finally(() => setCarregando(false));
  }, [token]);

  const definir = async (e: React.FormEvent) => {
    e.preventDefault();
    const problema = erroSenha(senha) || (senha !== confirmacao ? 'As senhas não conferem.' : null);
    if (problema) { setErro(problema); return; }
    setEnviando(true);
    setErro('');
    try {
      const r = await apiClient.post<{ username: string }>('/auth/senha/definir', { token, nova_senha: senha });
      setConcluido(r.data.username);
    } catch (err) {
      setErro(mensagemApi(err, 'Não foi possível salvar a senha. Tente de novo.'));
    } finally {
      setEnviando(false);
    }
  };

  const pedirLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErro('Informe um e-mail válido.'); return; }
    setEnviando(true);
    setErro('');
    try {
      await apiClient.post('/auth/password/reset-request', { email: email.trim() });
      setPedidoEnviado(true);
    } catch (err) {
      setErro(mensagemApi(err, 'Não foi possível enviar agora. Tente de novo em instantes.'));
    } finally {
      setEnviando(false);
    }
  };

  const ativacao = info?.finalidade === 'ativacao';
  const titulo = !token ? 'Esqueci minha senha'
    : !info ? 'Link de acesso'
    : ativacao ? 'Ative sua conta' : 'Crie uma nova senha';

  const olho = (
    <InputAdornment position="end">
      <IconButton onClick={() => setMostrar(m => !m)} edge="end" aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}>
        {mostrar ? <VisibilityOff /> : <Visibility />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2,
      background: theme.palette.mode === 'dark'
        ? 'linear-gradient(135deg, #121212 0%, #1a1a2e 50%, #16213e 100%)'
        : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)',
    }}>
      <Paper elevation={24} sx={{ p: { xs: 3, sm: 5 }, width: '100%', maxWidth: 450, borderRadius: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
          Mercadinho<span style={{ color: '#3b82f6' }}>Sys</span>
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.03em', mb: 1 }}>{titulo}</Typography>

        {carregando && <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress /></Box>}

        {!carregando && concluido && (
          <>
            <Alert severity="success" sx={{ my: 3, borderRadius: 2 }}>
              Senha criada! Entre com o usuário <strong>{concluido}</strong> e a nova senha.
            </Alert>
            <Button fullWidth variant="contained" size="large" sx={{ py: 1.5, borderRadius: 2, textTransform: 'none', fontWeight: 'bold' }}
              onClick={() => navigate(`/login?usuario=${encodeURIComponent(concluido)}`)}>
              Entrar no sistema
            </Button>
          </>
        )}

        {!carregando && !concluido && token && !info && (
          <>
            <Alert severity="error" sx={{ my: 3, borderRadius: 2 }}>{erro}</Alert>
            <Button fullWidth variant="outlined" sx={{ textTransform: 'none' }} onClick={() => navigate('/definir-senha')}>
              Pedir um novo link
            </Button>
          </>
        )}

        {!carregando && !concluido && info && (
          <form onSubmit={definir} noValidate>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {ativacao
                ? <>Olá, {info.nome}! A loja <strong>{info.loja}</strong> está pronta. Crie a senha que você vai usar para entrar.</>
                : <>Olá, {info.nome}! Crie uma nova senha para a sua conta.</>}
            </Typography>
            <TextField fullWidth label="Usuário" value={info.username} disabled sx={{ mb: 2 }} />
            <TextField fullWidth autoFocus label="Nova senha" type={mostrar ? 'text' : 'password'} value={senha}
              onChange={e => setSenha(e.target.value)} autoComplete="new-password"
              helperText="Mínimo de 8 caracteres, com letras e números."
              InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlined color="action" /></InputAdornment>, endAdornment: olho }}
              sx={{ mb: 2 }} />
            <TextField fullWidth label="Repita a senha" type={mostrar ? 'text' : 'password'} value={confirmacao}
              onChange={e => setConfirmacao(e.target.value)} autoComplete="new-password"
              InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlined color="action" /></InputAdornment> }}
              sx={{ mb: 3 }} />
            {erro && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{erro}</Alert>}
            <Button fullWidth type="submit" variant="contained" size="large" disabled={enviando}
              sx={{ py: 1.5, borderRadius: 2, textTransform: 'none', fontWeight: 'bold' }}>
              {enviando ? <CircularProgress size={24} color="inherit" /> : ativacao ? 'Ativar minha conta' : 'Salvar nova senha'}
            </Button>
          </form>
        )}

        {!token && !pedidoEnviado && (
          <form onSubmit={pedirLink} noValidate>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.
            </Typography>
            <TextField fullWidth autoFocus label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><MailOutline color="action" /></InputAdornment> }}
              sx={{ mb: 3 }} />
            {erro && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{erro}</Alert>}
            <Button fullWidth type="submit" variant="contained" size="large" disabled={enviando}
              sx={{ py: 1.5, borderRadius: 2, textTransform: 'none', fontWeight: 'bold' }}>
              {enviando ? <CircularProgress size={24} color="inherit" /> : 'Enviar link'}
            </Button>
          </form>
        )}

        {!token && pedidoEnviado && (
          <Alert severity="success" sx={{ my: 3, borderRadius: 2 }}>
            Se o e-mail estiver cadastrado, você vai receber um link em instantes. Confira também a caixa de spam.
          </Alert>
        )}

        <Button fullWidth variant="text" sx={{ mt: 2, textTransform: 'none', color: 'text.secondary' }} onClick={() => navigate('/login')}>
          ← Voltar para o login
        </Button>
      </Paper>
    </Box>
  );
}
