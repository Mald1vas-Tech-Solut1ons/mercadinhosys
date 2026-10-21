import React, { useCallback, useEffect, useState } from 'react';
import ResponsiveModal from '../../components/ui/ResponsiveModal';
import { Button } from '../../components/ui/button';
import { showToast } from '../../utils/toast';
import { crmApi, erroApi, Lead } from './crmApi';
import { ClienteBusca, Rotulo, Selo, Vazio } from './crmUi';
import { campo, dataCurta } from './crmFormat';

const STATUS: Record<string, { rotulo: string; tom: 'cinza' | 'azul' | 'verde' | 'amarelo' | 'vermelho' }> = {
    novo: { rotulo: 'Novo', tom: 'azul' }, contatado: { rotulo: 'Contatado', tom: 'amarelo' },
    qualificado: { rotulo: 'Qualificado', tom: 'verde' }, convertido: { rotulo: 'Cliente', tom: 'verde' },
    descartado: { rotulo: 'Descartado', tom: 'cinza' },
};

const LeadsTab: React.FC<{ gestor: boolean; responsaveis: { id: number; nome: string }[] }> = ({ gestor, responsaveis }) => {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [status, setStatus] = useState('');
    const [busca, setBusca] = useState('');
    const [novo, setNovo] = useState(false);
    const [acao, setAcao] = useState<{ lead: Lead; tipo: 'converter' | 'descartar' | 'oportunidade' | 'consentimento' } | null>(null);

    const carregar = useCallback(() => {
        const params: Record<string, string> = {};
        if (status) params.status = status;
        if (busca.trim()) params.busca = busca.trim();
        crmApi.leads(params).then(setLeads).catch(e => showToast.error(erroApi(e, 'Erro ao carregar leads')));
    }, [status, busca]);
    useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);

    const mudarStatus = async (lead: Lead, novoStatus: string) => {
        try { await crmApi.atualizarLead(lead.id, { status: novoStatus }); carregar(); }
        catch (e) { showToast.error(erroApi(e)); }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <Rotulo texto="Buscar"><input className={campo} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, empresa, telefone" /></Rotulo>
                <Rotulo texto="Situação">
                    <select className={campo} value={status} onChange={e => setStatus(e.target.value)}>
                        <option value="">Todas</option>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
                    </select>
                </Rotulo>
                <div className="ml-auto"><Button onClick={() => setNovo(true)}>Novo lead</Button></div>
            </div>

            {leads.length === 0 ? <Vazio texto="Nenhum lead. Cadastre quem pediu tabela, visitou o balcão ou indicou um conhecido." /> : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                            <tr><th className="p-3">Lead</th><th className="p-3">Contato</th><th className="p-3">Origem</th>
                                {gestor && <th className="p-3">Responsável</th>}<th className="p-3">Situação</th><th className="p-3 text-right">Ações</th></tr>
                        </thead>
                        <tbody>
                            {leads.map(l => (
                                <tr key={l.id} className="border-t">
                                    <td className="p-3"><p className="font-medium">{l.nome}</p>
                                        <p className="text-xs text-muted-foreground">{l.empresa || '—'} · {dataCurta(l.created_at)}</p></td>
                                    <td className="p-3 text-xs">{l.telefone || '—'}<br />{l.email || ''}</td>
                                    <td className="p-3 text-xs">{l.origem}</td>
                                    {gestor && <td className="p-3 text-xs">{l.responsavel_nome}</td>}
                                    <td className="p-3"><Selo tom={STATUS[l.status]?.tom}>{STATUS[l.status]?.rotulo || l.status}</Selo>
                                        {l.motivo_descarte && <p className="mt-1 text-[11px] text-muted-foreground">{l.motivo_descarte}</p>}</td>
                                    <td className="p-3">
                                        {!['convertido', 'descartado'].includes(l.status) && (
                                            <div className="flex flex-wrap justify-end gap-1">
                                                {l.status === 'novo' && <Button size="sm" variant="outline" onClick={() => mudarStatus(l, 'contatado')}>Contatado</Button>}
                                                {l.status === 'contatado' && <Button size="sm" variant="outline" onClick={() => mudarStatus(l, 'qualificado')}>Qualificar</Button>}
                                                <Button size="sm" variant="outline" onClick={() => setAcao({ lead: l, tipo: 'oportunidade' })}>Oportunidade</Button>
                                                <Button size="sm" variant="outline" onClick={() => setAcao({ lead: l, tipo: 'consentimento' })}>Consentimento</Button>
                                                <Button size="sm" onClick={() => setAcao({ lead: l, tipo: 'converter' })}>Virou cliente</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setAcao({ lead: l, tipo: 'descartar' })}>Descartar</Button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {novo && <NovoLead gestor={gestor} responsaveis={responsaveis} onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}
            {acao && <AcaoLead {...acao} onFechar={() => setAcao(null)} onSalvo={() => { setAcao(null); carregar(); }} />}
        </div>
    );
};

const NovoLead: React.FC<{ gestor: boolean; responsaveis: { id: number; nome: string }[]; onFechar: () => void; onSalvo: () => void }> =
    ({ gestor, responsaveis, onFechar, onSalvo }) => {
        const [f, setF] = useState({ nome: '', empresa: '', documento: '', telefone: '', email: '', cidade: '', estado: '',
                                     origem: 'indicacao', observacoes: '', responsavel_id: '' });
        const salvar = async () => {
            try {
                const corpo: Record<string, unknown> = { ...f };
                if (!f.responsavel_id) delete corpo.responsavel_id;
                await crmApi.criarLead(corpo as Partial<Lead>);
                showToast.create('Lead cadastrado');
                onSalvo();
            } catch (e) { showToast.error(erroApi(e)); }
        };
        const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
        return (
            <ResponsiveModal isOpen onClose={onFechar} title="Novo lead" size="lg" footer={<Button onClick={salvar}>Salvar</Button>}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Rotulo texto="Nome do contato"><input className={campo} value={f.nome} onChange={set('nome')} /></Rotulo>
                    <Rotulo texto="Empresa"><input className={campo} value={f.empresa} onChange={set('empresa')} /></Rotulo>
                    <Rotulo texto="CPF/CNPJ (opcional)" dica="Evita cadastrar duas vezes quem já é lead ou cliente.">
                        <input className={campo} value={f.documento} onChange={set('documento')} /></Rotulo>
                    <Rotulo texto="Origem">
                        <select className={campo} value={f.origem} onChange={set('origem')}>
                            {['indicacao', 'balcao', 'whatsapp', 'site', 'feira', 'visita', 'lista_fria', 'manual'].map(o => <option key={o}>{o}</option>)}
                        </select>
                    </Rotulo>
                    <Rotulo texto="Telefone/WhatsApp"><input className={campo} value={f.telefone} onChange={set('telefone')} /></Rotulo>
                    <Rotulo texto="E-mail"><input className={campo} value={f.email} onChange={set('email')} /></Rotulo>
                    <Rotulo texto="Cidade"><input className={campo} value={f.cidade} onChange={set('cidade')} /></Rotulo>
                    <Rotulo texto="UF"><input className={campo} maxLength={2} value={f.estado} onChange={set('estado')} /></Rotulo>
                    {gestor && (
                        <Rotulo texto="Responsável">
                            <select className={campo} value={f.responsavel_id} onChange={set('responsavel_id')}>
                                <option value="">Eu mesmo</option>
                                {responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                            </select>
                        </Rotulo>
                    )}
                    <div className="sm:col-span-2"><Rotulo texto="Observações">
                        <textarea className={campo} rows={3} value={f.observacoes} onChange={set('observacoes')} /></Rotulo></div>
                </div>
            </ResponsiveModal>
        );
    };

const AcaoLead: React.FC<{ lead: Lead; tipo: 'converter' | 'descartar' | 'oportunidade' | 'consentimento'; onFechar: () => void; onSalvo: () => void }> =
    ({ lead, tipo, onFechar, onSalvo }) => {
        const [cliente, setCliente] = useState<{ id: number; nome: string } | null>(null);
        const [texto, setTexto] = useState('');
        const [valor, setValor] = useState('');
        const [canal, setCanal] = useState('whatsapp');
        const [concedido, setConcedido] = useState(true);
        const [origem, setOrigem] = useState('whatsapp');
        const titulos = { converter: 'Converter em cliente', descartar: 'Descartar lead', oportunidade: 'Nova oportunidade', consentimento: 'Consentimento de contato' };
        const salvar = async () => {
            try {
                if (tipo === 'converter') {
                    if (!cliente) { showToast.error('Escolha o cliente cadastrado'); return; }
                    await crmApi.converterLead(lead.id, cliente.id);
                } else if (tipo === 'descartar') {
                    await crmApi.atualizarLead(lead.id, { status: 'descartado', motivo_descarte: texto });
                } else if (tipo === 'oportunidade') {
                    await crmApi.criarOportunidade({ lead_id: lead.id, titulo: texto, valor_estimado: Number(valor || 0) });
                } else {
                    await crmApi.registrarConsentimento({ lead_id: lead.id, canal, concedido, origem, evidencia: texto });
                }
                showToast.success('Registrado');
                onSalvo();
            } catch (e) { showToast.error(erroApi(e)); }
        };
        return (
            <ResponsiveModal isOpen onClose={onFechar} title={titulos[tipo]} subtitle={lead.nome} size="md" footer={<Button onClick={salvar}>Confirmar</Button>}>
                <div className="space-y-3">
                    {tipo === 'converter' && (
                        <>
                            <p className="text-sm text-muted-foreground">Cadastre o cliente em <b>Clientes</b> (com CPF/CNPJ e endereço) e escolha-o aqui.
                                Oportunidades, atividades e consentimentos do lead passam para o cliente.</p>
                            <Rotulo texto="Cliente cadastrado"><ClienteBusca valor={cliente} onChange={setCliente} /></Rotulo>
                        </>
                    )}
                    {tipo === 'descartar' && <Rotulo texto="Motivo"><input className={campo} value={texto} onChange={e => setTexto(e.target.value)} /></Rotulo>}
                    {tipo === 'oportunidade' && (
                        <>
                            <Rotulo texto="Título"><input className={campo} value={texto} onChange={e => setTexto(e.target.value)} /></Rotulo>
                            <Rotulo texto="Valor estimado (R$)"><input className={campo} type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} /></Rotulo>
                        </>
                    )}
                    {tipo === 'consentimento' && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <Rotulo texto="Canal"><select className={campo} value={canal} onChange={e => setCanal(e.target.value)}>
                                    {['whatsapp', 'email', 'sms', 'telefone'].map(c => <option key={c}>{c}</option>)}</select></Rotulo>
                                <Rotulo texto="Situação"><select className={campo} value={concedido ? 's' : 'n'} onChange={e => setConcedido(e.target.value === 's')}>
                                    <option value="s">Autorizou</option><option value="n">Não autoriza / revogou</option></select></Rotulo>
                            </div>
                            <Rotulo texto="Como foi obtido"><select className={campo} value={origem} onChange={e => setOrigem(e.target.value)}>
                                {['whatsapp', 'formulario', 'email', 'balcao', 'verbal', 'contrato'].map(o => <option key={o}>{o}</option>)}</select></Rotulo>
                            <Rotulo texto="Evidência" dica="Obrigatória para balcão e verbal: quem ouviu, quando e como (LGPD).">
                                <input className={campo} value={texto} onChange={e => setTexto(e.target.value)} /></Rotulo>
                        </>
                    )}
                </div>
            </ResponsiveModal>
        );
    };

export default LeadsTab;
