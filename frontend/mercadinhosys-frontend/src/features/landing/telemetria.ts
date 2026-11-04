/*
 * Rastreio do site público (landing, segmentos, regiões, 404). Painel: super admin → Site e Leads.
 *
 * Regras (as mesmas do MiseOn, que já custaram caro lá):
 * - Só mede com o "Aceitar" do banner de cookies (podeMedirUso). Sem aceite, nada sai do aparelho.
 * - Visitante = UUID do aparelho (localStorage); sessão = da aba (sessionStorage). Sem nome, sem IP.
 * - Duração só existe quando a visita TERMINA (troca de página, aba escondida, saída).
 * - Envio em lote por fetch com keepalive, sem travar a página; erro de rede é engolido.
 * - Robôs e a equipe (?interno=1 marca o aparelho) não contam. ?interno=0 desmarca.
 * - Origem: a PRIMEIRA (nunca muda) e a ÚLTIMA com origem (UTM ou site externo).
 */
import { API_CONFIG } from '../../api/apiConfig';
import { podeMedirUso } from './consentimento';

export type EventoSite =
    | 'whatsapp' | 'cadastro' | 'demo_entrar' | 'demo_aba' | 'demo_produto' | 'segmento' | 'regiao'
    | 'calculadora' | 'faq' | 'cookies_aceitos' | 'formulario_inicio' | 'formulario_enviado' | 'oferta_vista';

const K_VISITANTE = 'msys_visitante';
const K_SESSAO = 'msys_sessao';
const K_INTERNO = 'msys_interno';
const K_PRIMEIRA = 'msys_origem_primeira';
const K_ULTIMA = 'msys_origem_ultima';
const ENVIO_MS = 8000;
const ROBO = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|puppeteer|playwright/i;

type Toque = Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'referrer' | 'entrada' | 'em', string>>;

function ler(armazem: Storage, chave: string): string | null {
    try { return armazem.getItem(chave); } catch { return null; }
}
function gravar(armazem: Storage, chave: string, valor: string | null) {
    try {
        if (valor === null) armazem.removeItem(chave);
        else armazem.setItem(chave, valor);
    } catch { /* armazenamento bloqueado: segue sem guardar */ }
}

/** UUID v4 também em celular antigo (crypto.randomUUID só existe do iOS 15.4 / Chrome 92 em diante). */
function novoId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function garantir(armazem: Storage, chave: string): string {
    const atual = ler(armazem, chave);
    if (atual && /^[0-9a-f-]{36}$/i.test(atual)) return atual;
    const novo = novoId();
    gravar(armazem, chave, novo);
    return novo;
}

/** Id do visitante, se já existe (ex.: para ligar o formulário de lead à jornada). */
export function idVisitante(): string | null {
    const v = ler(localStorage, K_VISITANTE);
    return v && podeMedirUso() ? v : null;
}

function referrerExterno(): string | undefined {
    try {
        if (!document.referrer) return undefined;
        const ref = new URL(document.referrer);
        return ref.host === window.location.host ? undefined : ref.host;
    } catch { return undefined; }
}

function toqueDaCarga(): Toque {
    const p = new URLSearchParams(window.location.search);
    const t: Toque = { entrada: window.location.pathname, em: new Date().toISOString() };
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const) {
        const v = p.get(k);
        if (v) t[k] = v.slice(0, 120);
    }
    const ref = referrerExterno();
    if (ref) t.referrer = ref;
    return t;
}

const temOrigem = (t: Toque) => Boolean(t.utm_source || t.referrer);

class TelemetriaSite {
    private iniciado = false;
    private acessos: Record<string, unknown>[] = [];
    private eventos: Record<string, unknown>[] = [];
    private visita: { rota: string; inicio: number; rolagem: number } | null = null;
    private toque: Toque | null = null;
    private interno: boolean | null = null;
    private robo = false;

    init() {
        if (this.iniciado || typeof window === 'undefined') return;
        this.iniciado = true;
        this.robo = ROBO.test(navigator.userAgent || '');
        const p = new URLSearchParams(window.location.search);
        const marca = p.get('interno');
        if (marca === '1' || marca === '0') {
            gravar(localStorage, K_INTERNO, marca === '1' ? '1' : null);
            this.interno = marca === '1';
        }
        // A origem fica só no aparelho até o aceite.
        this.toque = toqueDaCarga();
        if (!ler(localStorage, K_PRIMEIRA)) gravar(localStorage, K_PRIMEIRA, JSON.stringify(this.toque));
        if (temOrigem(this.toque)) gravar(localStorage, K_ULTIMA, JSON.stringify(this.toque));

        window.addEventListener('scroll', () => this.medirRolagem(), { passive: true, capture: true });
        window.addEventListener('consentimento-cookies', ((e: CustomEvent) => {
            if (e.detail?.medicao) {
                this.evento('cookies_aceitos');
                if (this.ultimaRota) this.visita = { rota: this.ultimaRota, inicio: Date.now(), rolagem: 0 };
            } else {
                this.acessos = [];
                this.eventos = [];
                this.visita = null;
                gravar(localStorage, K_VISITANTE, null);
            }
        }) as EventListener);
        // Cliques em qualquer elemento com data-evento (botões de WhatsApp, cadastro, segmento...).
        document.addEventListener('click', (ev) => {
            const alvo = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-evento]');
            if (alvo) this.evento(alvo.dataset.evento as EventoSite, alvo.dataset.rotulo);
        }, { capture: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.encerrarVisita();
                this.enviar();
            } else if (this.ultimaRota && !this.visita && this.pode()) {
                this.visita = { rota: this.ultimaRota, inicio: Date.now(), rolagem: 0 };
            }
        });
        window.addEventListener('pagehide', () => { this.encerrarVisita(); this.enviar(); });
        setInterval(() => this.enviar(), ENVIO_MS);
    }

    private ultimaRota: string | null = null;

    private pode() {
        return podeMedirUso() && !this.robo;
    }

    private medirRolagem() {
        if (!this.visita) return;
        const el = document.scrollingElement || document.documentElement;
        // A landing rola dentro de um contêiner próprio: usa o maior dos dois.
        const alvos = [el, ...Array.from(document.querySelectorAll<HTMLElement>('[data-rolagem]'))];
        for (const a of alvos) {
            const total = a.scrollHeight - a.clientHeight;
            if (total > 0) this.visita.rolagem = Math.max(this.visita.rolagem, Math.round((a.scrollTop / total) * 100));
        }
    }

    private encerrarVisita() {
        if (!this.visita) return;
        if (this.pode()) {
            const p = new URLSearchParams(window.location.search);
            this.acessos.push({
                rota: this.visita.rota,
                referrer: referrerExterno(),
                utm_source: p.get('utm_source') || undefined,
                utm_medium: p.get('utm_medium') || undefined,
                utm_campaign: p.get('utm_campaign') || undefined,
                duracao_seg: Math.round((Date.now() - this.visita.inicio) / 1000),
                rolagem_pct: Math.min(100, this.visita.rolagem),
            });
        }
        this.visita = null;
    }

    /** A cada troca de página pública: fecha a visita anterior (com duração real) e abre a nova. */
    pagina(rota: string) {
        this.init();
        rota = rota.split(/[?#]/)[0] || '/';
        this.ultimaRota = rota;
        if (this.visita?.rota === rota) return;
        this.encerrarVisita();
        if (this.pode()) this.visita = { rota, inicio: Date.now(), rolagem: 0 };
    }

    evento(evento: EventoSite, rotulo?: string) {
        this.init();
        if (!this.pode()) return;
        this.eventos.push({ rota: this.ultimaRota || window.location.pathname, evento, rotulo: rotulo?.slice(0, 120) });
        // Contato e cadastro costumam trocar de página em seguida: envia já.
        if (['whatsapp', 'cadastro', 'demo_entrar', 'formulario_enviado'].includes(evento)) setTimeout(() => this.enviar(), 0);
    }

    private enviar() {
        if (!this.pode()) return;
        if (this.acessos.length === 0 && this.eventos.length === 0 && this.interno === null) return;
        const lerJson = (k: string) => { try { return JSON.parse(ler(localStorage, k) || 'null'); } catch { return null; } };
        const corpo = {
            visitante: garantir(localStorage, K_VISITANTE),
            sessao: garantir(sessionStorage, K_SESSAO),
            dispositivo: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop',
            interno: this.interno ?? (ler(localStorage, K_INTERNO) === '1' ? true : undefined),
            origem_primeira: lerJson(K_PRIMEIRA),
            origem_ultima: lerJson(K_ULTIMA),
            acessos: this.acessos.splice(0, 30),
            eventos: this.eventos.splice(0, 60),
        };
        this.interno = null;
        fetch(`${API_CONFIG.BASE_URL}/site/coletar`, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
        }).then(() => undefined, () => undefined);
    }
}

const telemetria = new TelemetriaSite();

// Rastreio nunca derruba a página.
function semQuebrar(f: () => void) {
    try { f(); } catch (e) { console.warn('[telemetria] ignorado:', e); }
}

export const rastrearPagina = (rota: string) => semQuebrar(() => telemetria.pagina(rota));
export const rastrearEvento = (evento: EventoSite, rotulo?: string) => semQuebrar(() => telemetria.evento(evento, rotulo));
