import React, { useState } from 'react';
import { maskCPF, maskCNPJ, maskPhone, maskCEP, somenteDigitos, validarCPF, validarCNPJ } from './inputMasks';
import { buscarCep } from '../../../utils/cepUtils';
import { Cliente } from '../../../types';
import { apiClient } from '../../../api/apiClient';
import {
  Dialog, DialogContent, DialogActions, Button, TextField, Typography, Box, IconButton, CircularProgress,
  ToggleButton, ToggleButtonGroup
} from '@mui/material';
// Importação compatível com todos os ambientes MUI 5+
import CloseIcon from '@mui/icons-material/Close';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import SaveIcon from '@mui/icons-material/Save';
import EditIcon from '@mui/icons-material/Edit';

interface CustomerFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (cliente: Partial<Cliente>) => void;
  initialData?: Partial<Cliente>;
  loading?: boolean;
}

const CustomerForm: React.FC<CustomerFormProps> = ({ open, onClose, onSave, initialData = {}, loading }) => {
  const [form, setForm] = useState<Partial<Cliente>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cpfChecking, setCpfChecking] = useState(false);

  React.useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setForm({ ...initialData });
    } else {
      setForm({});
    }
    setErrors({});
  }, [initialData?.id, open]); // Dependências mais específicas

  const tipoPessoa: 'PF' | 'PJ' = form.tipo_pessoa === 'PJ' ? 'PJ' : 'PF';
  const rotuloDocumento = tipoPessoa === 'PJ' ? 'CNPJ' : 'CPF';
  const campoDocumento = tipoPessoa === 'PJ' ? 'cnpj' : 'cpf';

  // Verificar se o documento (CPF ou CNPJ) já existe em outro cliente
  const checkDocumentoDuplicate = async (documento: string): Promise<boolean> => {
    const limpo = somenteDigitos(documento);
    if (limpo.length !== 11 && limpo.length !== 14) return false;
    try {
      const response = await apiClient.get('/clientes/', { params: { busca: limpo } });
      const existing = response.data.clientes?.find(
        (c: Cliente) => somenteDigitos(c.cpf) === limpo || somenteDigitos(c.cnpj) === limpo
      );
      return !!existing && existing.id !== initialData?.id;
    } catch {
      return false;
    }
  };

  const trocarTipo = (_: React.MouseEvent<HTMLElement>, novo: 'PF' | 'PJ' | null) => {
    if (!novo) return;
    setForm(prev => ({ ...prev, tipo_pessoa: novo }));
    setErrors({});
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let value: string | number = e.target.value;
    const name = e.target.name;

    if (name === 'cpf' && value.length <= 14) {
      value = maskCPF(value);
    }
    if (name === 'cnpj') {
      value = maskCNPJ(value);
    }
    if (name === 'cep' && typeof value === 'string') {
      value = maskCEP(value);
      if (value.length === 9) {
        // Buscar CEP automaticamente
        const fetchData = async () => {
          const data = await buscarCep(value as string);
          if (data) {
            setForm(prev => ({
              ...prev,
              logradouro: data.logradouro,
              bairro: data.bairro,
              cidade: data.localidade,
              estado: data.uf,
              cep: data.cep
            }));
          }
        };
        fetchData();
      }
    }
    if (name === 'celular') {
      value = maskPhone(value);
    }
    if (name === 'limite_credito') {
      const numValue = parseFloat(value);
      value = isNaN(numValue) ? '' : numValue.toString();
    }

    setForm({ ...form, [name]: value });

    // Limpar erro do campo
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }

    // Validação em tempo real do documento (CPF ou CNPJ)
    const tamanhoCompleto = name === 'cpf' ? 14 : name === 'cnpj' ? 18 : 0;
    if (tamanhoCompleto && typeof value === 'string' && value.length === tamanhoCompleto) {
      const rotulo = name === 'cpf' ? 'CPF' : 'CNPJ';
      if (!(name === 'cpf' ? validarCPF(value) : validarCNPJ(value))) {
        setErrors({ ...errors, [name]: `${rotulo} inválido` });
      } else {
        setCpfChecking(true);
        const isDuplicate = await checkDocumentoDuplicate(value);
        setCpfChecking(false);
        if (isDuplicate) {
          setErrors({ ...errors, [name]: `${rotulo} já cadastrado para outro cliente` });
        }
      }
    }

    // Validação de email
    if (name === 'email' && value && typeof value === 'string') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        setErrors({ ...errors, email: 'Email inválido' });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};

    // Validações obrigatórias
    if (tipoPessoa === 'PJ') {
      if (!form.razao_social?.trim()) newErrors.razao_social = 'Razão social é obrigatória';
      if (!form.cnpj?.trim()) newErrors.cnpj = 'CNPJ é obrigatório';
      else if (!validarCNPJ(form.cnpj)) newErrors.cnpj = 'CNPJ inválido';
    } else {
      if (!form.nome?.trim()) newErrors.nome = 'Nome é obrigatório';
      if (!form.cpf?.trim()) newErrors.cpf = 'CPF é obrigatório';
      else if (!validarCPF(form.cpf)) newErrors.cpf = 'CPF inválido';
    }
    if (!form.celular?.trim()) newErrors.celular = 'Telefone é obrigatório';

    // Validação de email
    if (form.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(form.email)) {
        newErrors.email = 'Email inválido';
      }
    }

    // Verificar documento duplicado se não há erro de validação
    const documentoInformado = form[campoDocumento];
    if (documentoInformado && !newErrors[campoDocumento]) {
      const isDuplicate = await checkDocumentoDuplicate(documentoInformado);
      if (isDuplicate) {
        newErrors[campoDocumento] = `${rotuloDocumento} já cadastrado para outro cliente`;
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      // Para edição, garantir que campos obrigatórios sejam enviados
      const dataToSave: Partial<Cliente> = { ...form, tipo_pessoa: tipoPessoa };
      if (initialData?.id) {
        // Na edição, garantir campos obrigatórios
        const requiredFields: Array<'nome' | 'cpf' | 'cnpj' | 'razao_social' | 'celular'> =
          tipoPessoa === 'PJ' ? ['cnpj', 'razao_social', 'celular'] : ['nome', 'cpf', 'celular'];
        for (const field of requiredFields) {
          if (!dataToSave[field] && initialData[field]) {
            dataToSave[field] = initialData[field];
          }
        }
      }

      // Filtrar campos que não devem ser enviados na atualização
      const camposNaoEnviar = ['id', 'saldo_devedor', 'total_compras', 'data_cadastro', 'ultima_compra', 'valor_total_gasto', 'endereco_completo', 'documento', 'nome_exibicao'];
      // Cada tipo de pessoa envia só os próprios campos de identificação.
      if (tipoPessoa === 'PJ') camposNaoEnviar.push('cpf', 'rg', 'data_nascimento');
      else camposNaoEnviar.push('cnpj', 'razao_social', 'inscricao_estadual', 'contato_nome');
      const cleanData = Object.fromEntries(
        Object.entries(dataToSave).filter(([key, value]) =>
          value !== undefined &&
          value !== null &&
          value !== "" &&
          !camposNaoEnviar.includes(key)
        )
      );

      onSave(cleanData);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{
      sx: { borderRadius: 3, boxShadow: 8, p: 0 }
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {initialData.id ? <EditIcon color="primary" /> : <PersonAddAlt1Icon color="primary" />}
          <Typography variant="h6" fontWeight={700} color="primary.main">
            {initialData.id ? 'Editar Cliente' : 'Novo Cliente'}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: 'grey.600' }}>
          <CloseIcon />
        </IconButton>
      </Box>
      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ pt: 0, pb: 1 }}>
          <Box display="flex" flexWrap="wrap" gap={2}>
            <Box flex="1 1 100%">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={tipoPessoa}
                onChange={trocarTipo}
                aria-label="Tipo de pessoa"
                fullWidth
              >
                <ToggleButton value="PF">Pessoa física</ToggleButton>
                <ToggleButton value="PJ">Pessoa jurídica (empresa)</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {tipoPessoa === 'PJ' ? (
              <>
                <Box flex="1 1 100%" minWidth={220}>
                  <TextField
                    label="Razão social"
                    name="razao_social"
                    value={form.razao_social || ''}
                    onChange={handleChange}
                    required
                    fullWidth
                    autoFocus
                    variant="outlined"
                    size="medium"
                    error={!!errors.razao_social}
                    helperText={errors.razao_social}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                  />
                </Box>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="Nome fantasia"
                    name="nome"
                    value={form.nome || ''}
                    onChange={handleChange}
                    fullWidth
                    variant="outlined"
                    size="medium"
                    error={!!errors.nome}
                    helperText={errors.nome}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                  />
                </Box>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="CNPJ"
                    name="cnpj"
                    value={form.cnpj || ''}
                    onChange={handleChange}
                    required
                    fullWidth
                    variant="outlined"
                    size="medium"
                    error={!!errors.cnpj}
                    helperText={errors.cnpj || (cpfChecking ? 'Verificando CNPJ...' : '')}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                    InputProps={{
                      endAdornment: cpfChecking ? <CircularProgress size={16} /> : null,
                    }}
                  />
                </Box>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="Inscrição estadual"
                    name="inscricao_estadual"
                    value={form.inscricao_estadual || ''}
                    onChange={handleChange}
                    fullWidth
                    variant="outlined"
                    size="medium"
                    inputProps={{ maxLength: 20 }}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                  />
                </Box>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="Contato (comprador)"
                    name="contato_nome"
                    value={form.contato_nome || ''}
                    onChange={handleChange}
                    fullWidth
                    variant="outlined"
                    size="medium"
                    inputProps={{ maxLength: 100 }}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                  />
                </Box>
              </>
            ) : (
              <>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="Nome"
                    name="nome"
                    value={form.nome || ''}
                    onChange={handleChange}
                    required
                    fullWidth
                    autoFocus
                    variant="outlined"
                    size="medium"
                    error={!!errors.nome}
                    helperText={errors.nome}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                  />
                </Box>
                <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
                  <TextField
                    label="CPF"
                    name="cpf"
                    value={form.cpf || ''}
                    onChange={handleChange}
                    required
                    fullWidth
                    variant="outlined"
                    size="medium"
                    error={!!errors.cpf}
                    helperText={errors.cpf || (cpfChecking ? 'Verificando CPF...' : '')}
                    InputLabelProps={{ style: { color: '#bdbdbd' } }}
                    InputProps={{
                      endAdornment: cpfChecking ? <CircularProgress size={16} /> : null,
                    }}
                  />
                </Box>
              </>
            )}
            <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
              <TextField
                label="Telefone"
                name="celular"
                value={form.celular || ''}
                onChange={handleChange}
                required
                fullWidth
                variant="outlined"
                size="medium"
                error={!!errors.celular}
                helperText={errors.celular}
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
              <TextField
                label="Email"
                name="email"
                value={form.email || ''}
                onChange={handleChange}
                type="email"
                fullWidth
                variant="outlined"
                size="medium"
                error={!!errors.email}
                helperText={errors.email}
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 120px" minWidth={120} maxWidth={200}>
              <TextField
                label="CEP"
                name="cep"
                value={form.cep || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 300px" minWidth={300} maxWidth={600}>
              <TextField
                label="Logradouro"
                name="logradouro"
                value={form.logradouro || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 100px" minWidth={100} maxWidth={150}>
              <TextField
                label="Número"
                name="numero"
                value={form.numero || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 200px" minWidth={200} maxWidth={300}>
              <TextField
                label="Bairro"
                name="bairro"
                value={form.bairro || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 200px" minWidth={200} maxWidth={300}>
              <TextField
                label="Cidade"
                name="cidade"
                value={form.cidade || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 80px" minWidth={80} maxWidth={100}>
              <TextField
                label="UF"
                name="estado"
                value={form.estado || ''}
                onChange={handleChange}
                fullWidth
                variant="outlined"
                size="medium"
                inputProps={{ maxLength: 2 }}
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 220px" minWidth={220} maxWidth={400}>
              <TextField
                label="Limite de Crédito"
                name="limite_credito"
                value={form.limite_credito || ''}
                onChange={handleChange}
                type="number"
                fullWidth
                variant="outlined"
                size="medium"
                InputProps={{
                  startAdornment: <span style={{ color: '#bdbdbd', marginRight: 8 }}>R$</span>,
                }}
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
            <Box flex="1 1 100%" minWidth={220} maxWidth={800}>
              <TextField
                label="Observações"
                name="observacoes"
                value={form.observacoes || ''}
                onChange={handleChange}
                fullWidth
                multiline
                rows={2}
                variant="outlined"
                size="medium"
                InputLabelProps={{ style: { color: '#bdbdbd' } }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1, justifyContent: 'space-between' }}>
          <Button
            onClick={onClose}
            variant="outlined"
            disabled={loading}
            startIcon={<CloseIcon />}
            sx={{
              color: '#757575',
              borderColor: '#e0e0e0',
              '&:hover': {
                borderColor: '#bdbdbd',
                bgcolor: '#f5f5f5'
              }
            }}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={form.id ? <SaveIcon /> : <PersonAddAlt1Icon />}
            sx={{
              minWidth: 120,
              bgcolor: '#1976d2',
              '&:hover': {
                bgcolor: '#1565c0'
              }
            }}
          >
            {loading ? <CircularProgress size={22} color="inherit" /> : (form.id ? 'Salvar' : 'Cadastrar')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default CustomerForm;
