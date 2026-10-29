"""
Política de ações por loja: quem pode fazer cada operação sensível e quando ela exige PIN.

O RBAC global (middleware/access_control.py) libera o MÓDULO por cargo. Aqui fica a regra
fina, configurável pelo admin em Configurações → Permissões: para cada ação, quais cargos
podem executá-la e se o operador precisa do PIN de um Admin/Gerente para concluir.

Padrões seguros valem enquanto a loja não personalizar. Admin (nível 1) sempre pode tudo:
o admin não consegue se trancar fora da própria loja.

Uso na rota:

    @acao_protegida("clientes.criar")
    def criar_cliente(): ...

PIN: o front manda no header `X-PIN-Autorizacao`. Errar o PIN conta tentativas por usuário;
ao estourar o limite, o PIN fica bloqueado por alguns minutos para aquele usuário.
"""
import json
from functools import wraps

from flask import g, jsonify, request

from app.decorators.rbac import NIVEL_LABELS, nivel_do_role

# chave -> (rótulo, grupo, cargos padrão, exige PIN por padrão)
ACOES = {
    "clientes.criar":          ("Cadastrar cliente", "Clientes", {1, 2, 4, 5}, False),
    "clientes.editar":         ("Editar cadastro de cliente", "Clientes", {1, 2, 4, 5}, False),
    "clientes.limite_credito": ("Alterar limite de crédito (fiado)", "Clientes", {1, 2}, False),
    "clientes.excluir":        ("Excluir ou inativar cliente", "Clientes", {1, 2}, False),
    "clientes.receber_fiado":  ("Receber pagamento de fiado", "Clientes", {1, 2, 4}, False),
    "produtos.criar":          ("Cadastrar ou importar produto", "Produtos", {1, 2, 4}, False),
    "produtos.editar":         ("Editar produto e preço", "Produtos", {1, 2}, False),
    "produtos.excluir":        ("Excluir, inativar ou descartar produto", "Produtos", {1, 2}, False),
    "estoque.ajustar":         ("Ajustar estoque e lotes manualmente", "Produtos", {1, 2, 4}, False),
    "fornecedores.gerenciar":  ("Cadastrar ou editar fornecedor", "Fornecedores", {1, 2, 4}, False),
    "fornecedores.excluir":    ("Excluir ou inativar fornecedor", "Fornecedores", {1, 2}, False),
    "caixa.sangria":           ("Fazer sangria", "Caixa", {1, 2, 4}, True),
    "caixa.ver_esperado":      ("Ver valor esperado ao fechar o caixa", "Caixa", {1, 2}, False),
    "logistica.configurar":    ("Configurar entrega, taxas, motoristas e veículos", "Entregas", {1, 2}, False),
}

# Cargos que a tela de permissões oferece (super admin fica fora: é da plataforma).
NIVEIS_CONFIGURAVEIS = (2, 3, 4, 5, 6)

PIN_MAX_ERROS = 5
PIN_BLOQUEIO_SEGUNDOS = 15 * 60


def _padrao(chave):
    _, _, niveis, pin = ACOES[chave]
    return {"niveis": sorted(niveis), "pin": pin}


def _ler_salvo(estabelecimento_id):
    from app.models import Configuracao
    config = Configuracao.query.filter_by(estabelecimento_id=estabelecimento_id).first()
    bruto = getattr(config, "politica_acoes", None) if config else None
    if not bruto:
        return {}
    try:
        dados = json.loads(bruto)
        return dados if isinstance(dados, dict) else {}
    except (TypeError, ValueError):
        return {}


def politica_da_loja(estabelecimento_id):
    """Política efetiva: padrão de cada ação sobreposto pelo que a loja salvou."""
    salvo = _ler_salvo(estabelecimento_id)
    efetiva = {}
    for chave in ACOES:
        regra = _padrao(chave)
        personalizada = salvo.get(chave)
        if isinstance(personalizada, dict):
            niveis = personalizada.get("niveis")
            if isinstance(niveis, list):
                regra["niveis"] = sorted({int(n) for n in niveis if str(n).isdigit() and int(n) in NIVEIS_CONFIGURAVEIS})
            if "pin" in personalizada:
                regra["pin"] = bool(personalizada["pin"])
        regra["niveis"] = sorted(set(regra["niveis"]) | {1})
        efetiva[chave] = regra
    return efetiva


def catalogo(estabelecimento_id):
    """Para a tela de Configurações: rótulos, grupos, padrões e o valor atual."""
    efetiva = politica_da_loja(estabelecimento_id)
    return {
        "niveis": [{"nivel": n, "rotulo": NIVEL_LABELS[n]} for n in NIVEIS_CONFIGURAVEIS],
        "acoes": [
            {"chave": chave, "rotulo": rotulo, "grupo": grupo,
             "padrao": _padrao(chave), **efetiva[chave]}
            for chave, (rotulo, grupo, _, _) in ACOES.items()
        ],
    }


def salvar_politica(estabelecimento_id, dados):
    """Valida e grava só ações conhecidas. Retorna a política efetiva."""
    from app.models import Configuracao, db
    if not isinstance(dados, dict):
        raise ValueError("Formato inválido")
    limpo = {}
    for chave, regra in dados.items():
        if chave not in ACOES or not isinstance(regra, dict):
            continue
        niveis = regra.get("niveis", [])
        if not isinstance(niveis, list):
            raise ValueError(f"Cargos inválidos em {chave}")
        limpo[chave] = {
            "niveis": sorted({int(n) for n in niveis if str(n).isdigit() and int(n) in NIVEIS_CONFIGURAVEIS}),
            "pin": bool(regra.get("pin", False)),
        }
    config = Configuracao.query.filter_by(estabelecimento_id=estabelecimento_id).first()
    if not config:
        config = Configuracao(estabelecimento_id=estabelecimento_id)
        db.session.add(config)
    config.politica_acoes = json.dumps(limpo)
    return politica_da_loja(estabelecimento_id)


# ---------------------------------------------------------------- PIN com trava

def _chave_trava(estabelecimento_id, usuario_id):
    return f"pin_erros:{estabelecimento_id}:{usuario_id}"


def pin_bloqueado(estabelecimento_id, usuario_id):
    from app import cache
    return (cache.get(_chave_trava(estabelecimento_id, usuario_id)) or 0) >= PIN_MAX_ERROS


def validar_pin(estabelecimento_id, usuario_id, pin):
    """Valida o PIN de um Admin/Gerente contando erros por usuário que digita.

    Retorna (autorizador, erro). `erro` é None no sucesso, "bloqueado" quando o limite
    estourou e "invalido" para PIN errado ou vazio.
    """
    from app import cache
    from app.routes.configuracao import autorizar_por_pin
    chave = _chave_trava(estabelecimento_id, usuario_id)
    erros = cache.get(chave) or 0
    if erros >= PIN_MAX_ERROS:
        return None, "bloqueado"
    autorizador = autorizar_por_pin(estabelecimento_id, pin)
    if autorizador:
        cache.delete(chave)
        return autorizador, None
    if str(pin or "").strip() and registrar_erro_credencial(estabelecimento_id, usuario_id):
        return None, "bloqueado"
    return None, "invalido"


def registrar_erro_credencial(estabelecimento_id, usuario_id):
    """Conta um PIN/senha de autorização errado. True quando o usuário acabou de ser bloqueado."""
    from app import cache
    chave = _chave_trava(estabelecimento_id, usuario_id)
    erros = (cache.get(chave) or 0) + 1
    cache.set(chave, erros, timeout=PIN_BLOQUEIO_SEGUNDOS)
    if erros < PIN_MAX_ERROS:
        return False
    from app.models import Auditoria, db
    # Roda antes da alteração da rota e a rota não chega a commitar: gravar aqui.
    Auditoria.registrar(
        estabelecimento_id=estabelecimento_id, tipo_evento="pin_bloqueado",
        descricao=f"Autorização bloqueada após {PIN_MAX_ERROS} tentativas erradas",
        usuario_id=int(usuario_id) if str(usuario_id).isdigit() else None)
    db.session.commit()
    return True


def resposta_erro_pin(erro, mensagem_pedido):
    if erro == "bloqueado":
        return jsonify({
            "success": False, "code": "PIN_BLOQUEADO",
            "error": f"PIN bloqueado por {PIN_BLOQUEIO_SEGUNDOS // 60} minutos após tentativas erradas.",
        }), 429
    return jsonify({"success": False, "code": "PIN_REQUIRED", "error": mensagem_pedido}), 403


# ---------------------------------------------------------------- verificação na rota

def _usuario_atual():
    usuario = getattr(request, "current_user", None)
    if usuario is not None:
        return usuario
    from flask_jwt_extended import get_jwt_identity
    from app.models import Funcionario, db
    try:
        return db.session.get(Funcionario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


def verificar_acao(chave, usuario=None):
    """None quando pode seguir; senão a resposta HTTP de recusa."""
    usuario = usuario or _usuario_atual()
    if usuario is None:
        return jsonify({"success": False, "error": "Usuário não identificado"}), 401
    if getattr(usuario, "is_super_admin", False):
        return None
    nivel = nivel_do_role(usuario.role)
    rotulo = ACOES[chave][0]
    regra = politica_da_loja(usuario.estabelecimento_id)[chave]
    if nivel not in regra["niveis"]:
        return jsonify({
            "success": False, "code": "ACAO_NAO_PERMITIDA", "acao": chave,
            "error": f"Seu cargo não pode: {rotulo.lower()}. O admin libera em Configurações → Permissões.",
        }), 403
    if regra["pin"] and nivel > 2:
        pin = request.headers.get("X-PIN-Autorizacao") or (request.get_json(silent=True) or {}).get("pin")
        autorizador, erro = validar_pin(usuario.estabelecimento_id, usuario.id, pin)
        if erro:
            resposta, status = resposta_erro_pin(erro, f"{rotulo} exige o PIN de um Admin ou Gerente.")
            corpo = resposta.get_json()
            corpo.update({"acao": chave, "acao_rotulo": rotulo, "pin_por_header": True})
            return jsonify(corpo), status
        g.autorizador_pin = autorizador
        from app.models import Auditoria
        Auditoria.registrar(
            estabelecimento_id=usuario.estabelecimento_id, tipo_evento="autorizacao_pin",
            descricao=f"{rotulo}: autorizado por {autorizador.nome} para {usuario.nome}",
            usuario_id=usuario.id, detalhes={"acao": chave, "autorizador_id": autorizador.id})
    return None


def pode(chave, usuario=None):
    """Checagem silenciosa (sem PIN) para decidir o que mostrar."""
    usuario = usuario or _usuario_atual()
    if usuario is None:
        return False
    if getattr(usuario, "is_super_admin", False):
        return True
    return nivel_do_role(usuario.role) in politica_da_loja(usuario.estabelecimento_id)[chave]["niveis"]


def acao_protegida(chave):
    if chave not in ACOES:
        raise KeyError(f"Ação desconhecida: {chave}")

    def decorador(funcao):
        @wraps(funcao)
        def envolvida(*args, **kwargs):
            if request.method == "OPTIONS":
                return funcao(*args, **kwargs)
            recusa = verificar_acao(chave)
            if recusa is not None:
                return recusa
            return funcao(*args, **kwargs)
        return envolvida
    return decorador
