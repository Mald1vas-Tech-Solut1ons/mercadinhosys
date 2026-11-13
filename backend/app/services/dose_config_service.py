"""Configuração da venda por dose: o que o lojista define (ml e preço de cada dose) e as contas de custo e margem.

Nada de dose fixa no sistema: cada produto tem as doses que o lojista cadastra (ml livre, preço livre) e a loja
guarda os ml que costuma trabalhar só como ATALHO (``doses_padrao``). A venda em si está em ``dose_service``.

- ``calcular``: custo por dose, margem e rendimento de uma dose (com a perda esperada da garrafa).
- ``salvar_doses_produto``: grava volume da garrafa + doses; dose já vendida nunca é apagada, só arquivada.
- ``aplicar_modelo``: o mesmo conjunto de doses em vários produtos, com pré-visualização.
- ``ler_config_loja`` / ``salvar_config_loja``: padrões da loja (doses, margem alvo, perda, alertas).

Nada aqui faz commit: a rota decide.
"""
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP

from app.models import Configuracao, Produto, VendaItem, db
from app.models_dose import GarrafaAberta, ProdutoDose
from app.services.dose_service import DoseError

ML = Decimal("0.01")
Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")
CEM = Decimal("100")
ZERO = Decimal("0")
MAX_DOSES = 12
PASSO_PRECO = Decimal("0.50")            # preço sugerido sobe para o próximo R$ 0,50
MAX_PRODUTOS_LOTE = 500
DOSES_INICIAIS = [{"nome": "Dose", "volume_ml": 50}, {"nome": "Dose dupla", "volume_ml": 100}]

_VOLUME = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|cl|l|lt|lts|litro|litros)\b", re.IGNORECASE)


# ── números ───────────────────────────────────────────────────────────────

def _d(valor) -> Decimal:
    return Decimal(str(valor if valor is not None else 0))


def _num(valor, rotulo, *, minimo=None, maximo=None, positivo=False, casas=ML, vazio_ok=False):
    """Decimal validado e na escala certa; `vazio_ok` devolve None para vazio."""
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        if vazio_ok:
            return None
        raise DoseError(f"{rotulo}: informe um valor")
    try:
        numero = Decimal(str(valor).strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        raise DoseError(f"{rotulo}: valor inválido") from None
    if not numero.is_finite():
        raise DoseError(f"{rotulo}: valor inválido")
    if positivo and numero <= 0:
        raise DoseError(f"{rotulo}: precisa ser maior que zero")
    if minimo is not None and numero < Decimal(str(minimo)):
        raise DoseError(f"{rotulo}: mínimo {minimo}")
    if maximo is not None and numero > Decimal(str(maximo)):
        raise DoseError(f"{rotulo}: máximo {maximo}")
    return numero.quantize(casas, rounding=ROUND_HALF_UP)


def _f(valor, casas=2):
    return None if valor is None else round(float(valor), casas)


# ── padrões da loja ───────────────────────────────────────────────────────

def _config_row(estab_id):
    return Configuracao.query.filter_by(estabelecimento_id=estab_id).first()


def ler_config_loja(estab_id) -> dict:
    cfg = _config_row(estab_id)
    doses = None
    if cfg is not None and cfg.doses_padrao:
        try:
            doses = json.loads(cfg.doses_padrao)
        except (ValueError, TypeError):
            doses = None
    margem = cfg.margem_alvo_dose_pct if cfg is not None and cfg.margem_alvo_dose_pct is not None else (
        cfg.margem_alvo_venda_pct if cfg is not None else None)
    return {
        "doses_padrao": doses if doses else [dict(d) for d in DOSES_INICIAIS],
        "doses_padrao_definidas": bool(doses),            # False = ainda são as sugestões iniciais do sistema
        "margem_alvo_dose_pct": _f(margem, 1),
        "margem_alvo_definida": bool(cfg is not None and cfg.margem_alvo_dose_pct is not None),
        "perda_esperada_pct": _f(cfg.perda_esperada_pct if cfg is not None else 0, 1) or 0.0,
        "alerta_garrafa_aberta_dias": cfg.alerta_garrafa_aberta_dias if cfg is not None else None,
        "alerta_rendimento_pct": _f(cfg.alerta_rendimento_pct, 1) if cfg is not None else None,
    }


def _normalizar_modelo(itens, rotulo="Dose"):
    """Lista de {nome?, volume_ml, preco_venda?, margem_alvo_pct?, padrao?} validada (sem exigir preço)."""
    if not isinstance(itens, list) or not itens:
        raise DoseError(f"{rotulo}: informe ao menos uma dose")
    if len(itens) > MAX_DOSES:
        raise DoseError(f"{rotulo}: no máximo {MAX_DOSES} doses")
    saida, nomes = [], set()
    for posicao, bruto in enumerate(itens, 1):
        if not isinstance(bruto, dict):
            raise DoseError(f"{rotulo} {posicao}: formato inválido")
        ml = _num(bruto.get("volume_ml"), f"{rotulo} {posicao} (ml)", positivo=True, maximo=100000)
        nome = (str(bruto.get("nome") or "").strip() or f"Dose {_fmt_ml(ml)}")[:60]
        if nome.lower() in nomes:
            raise DoseError(f"Há duas doses chamadas \"{nome}\": use nomes diferentes")
        nomes.add(nome.lower())
        item = {"nome": nome, "volume_ml": ml, "padrao": bool(bruto.get("padrao"))}
        item["preco_venda"] = _num(bruto["preco_venda"], f"{nome}: preço", positivo=True, maximo=1000000,
                                   vazio_ok=True) if "preco_venda" in bruto else None
        item["margem_alvo_pct"] = _num(bruto["margem_alvo_pct"], f"{nome}: margem", minimo=0, maximo=95,
                                       vazio_ok=True, casas=Q2) if "margem_alvo_pct" in bruto else None
        saida.append(item)
    return saida


def _fmt_ml(ml) -> str:
    return f"{Decimal(str(ml)).normalize():f}ml"


def salvar_config_loja(estab_id, dados) -> dict:
    cfg = _config_row(estab_id)
    if cfg is None:
        raise DoseError("Configuração da loja não encontrada")
    if "doses_padrao" in dados:
        modelo = _normalizar_modelo(dados["doses_padrao"], "Dose padrão")
        cfg.doses_padrao = json.dumps(
            [{"nome": d["nome"], "volume_ml": float(d["volume_ml"])} for d in modelo], ensure_ascii=False)
    if "margem_alvo_dose_pct" in dados:
        cfg.margem_alvo_dose_pct = _num(dados["margem_alvo_dose_pct"], "Margem alvo", minimo=1, maximo=95,
                                        vazio_ok=True, casas=Q2)
    if "perda_esperada_pct" in dados:
        cfg.perda_esperada_pct = _num(dados["perda_esperada_pct"] if dados["perda_esperada_pct"] not in (None, "") else 0,
                                      "Perda esperada", minimo=0, maximo=50, casas=Q2)
    if "alerta_garrafa_aberta_dias" in dados:
        valor = _num(dados["alerta_garrafa_aberta_dias"], "Dias de garrafa aberta", minimo=1, maximo=365,
                     vazio_ok=True, casas=Decimal("1"))
        cfg.alerta_garrafa_aberta_dias = int(valor) if valor is not None else None
    if "alerta_rendimento_pct" in dados:
        cfg.alerta_rendimento_pct = _num(dados["alerta_rendimento_pct"], "Rendimento mínimo", minimo=1, maximo=100,
                                         vazio_ok=True, casas=Q2)
    return ler_config_loja(estab_id)


# ── volume da garrafa ─────────────────────────────────────────────────────

def detectar_volume_ml(*textos):
    """Volume em ml citado no texto ("Whisky 12 anos 1L" → 1000; "Vinho 750ml" → 750), ou None."""
    for texto in textos:
        if not texto:
            continue
        achado = _VOLUME.search(str(texto))
        if not achado:
            continue
        numero = Decimal(achado.group(1).replace(",", "."))
        unidade = achado.group(2).lower()
        ml = numero * (Decimal(1000) if unidade in ("l", "lt", "lts", "litro", "litros") else
                       Decimal(10) if unidade == "cl" else Decimal(1))
        if Decimal("1") <= ml <= Decimal("100000"):
            return ml.quantize(ML, rounding=ROUND_HALF_UP)
    return None


def volume_sugerido(produto):
    """Volume provável da garrafa: do atributo de volume ou do nome do produto."""
    atributos = produto.atributos if hasattr(produto, "atributos") else {}
    return detectar_volume_ml(atributos.get("peso_volume"), produto.nome)


# ── contas ────────────────────────────────────────────────────────────────

def perda_efetiva_pct(produto, cfg=None) -> Decimal:
    if produto.perda_esperada_pct is not None:
        return _d(produto.perda_esperada_pct)
    if cfg is not None:
        return _d(cfg.get("perda_esperada_pct"))
    return ZERO


def sugerir_preco(custo_dose, margem_alvo_pct, passo=PASSO_PRECO) -> Decimal:
    """Preço que dá a margem alvo SOBRE A VENDA, arredondado para cima ao próximo `passo` (R$ 0,50)."""
    margem = _d(margem_alvo_pct)
    if margem >= CEM:
        raise DoseError("Margem alvo inválida")
    bruto = _d(custo_dose) / (Decimal(1) - margem / CEM)
    return ((bruto / passo).to_integral_value(rounding=ROUND_CEILING) * passo).quantize(Q2)


def calcular(custo_garrafa, volume_garrafa_ml, ml, preco_venda, *, perda_pct=ZERO, preco_garrafa=None) -> dict:
    """Custo, margem e rendimento de UMA dose. A perda esperada encarece a dose (parte da garrafa não vira venda)."""
    custo_garrafa, volume, ml = _d(custo_garrafa), _d(volume_garrafa_ml), _d(ml)
    perda = max(ZERO, min(_d(perda_pct), Decimal(50)))
    volume_util = volume * (Decimal(1) - perda / CEM)
    custo_dose = custo_garrafa / volume_util * ml if volume_util > 0 else ZERO
    preco = _d(preco_venda) if preco_venda is not None else None
    doses_vendaveis = volume_util / ml if ml > 0 else ZERO
    saida = {
        "custo_dose": _f(custo_dose, 4),
        "doses_por_garrafa": _f(volume / ml if ml > 0 else ZERO, 2),
        "doses_vendaveis": _f(doses_vendaveis, 2),
        "preco_por_100ml": None, "margem_valor": None, "margem_pct": None,
        "receita_garrafa": None, "multiplo_da_garrafa": None, "abaixo_da_garrafa": False,
    }
    if preco is not None and preco > 0:
        margem = preco - custo_dose
        saida.update({
            "preco_por_100ml": _f(preco / ml * 100, 2),
            "margem_valor": _f(margem, 2),
            "margem_pct": _f(margem / preco * CEM, 1),
            "receita_garrafa": _f(preco * doses_vendaveis, 2),
        })
        preco_garrafa = _d(preco_garrafa) if preco_garrafa is not None else None
        if preco_garrafa and preco_garrafa > 0:
            saida["multiplo_da_garrafa"] = _f(preco * doses_vendaveis / preco_garrafa, 2)
            # R$/ml da dose menor que o da garrafa fechada: vender a dose "dá prejuízo" frente a vender a garrafa.
            saida["abaixo_da_garrafa"] = bool(preco / ml < preco_garrafa / volume)
    return saida


# ── leitura ───────────────────────────────────────────────────────────────

def _garrafas_abertas_qtd(produto) -> int:
    return GarrafaAberta.query.filter_by(estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id,
                                         status="aberta").count()


def _aviso(dose_nome, tipo, mensagem):
    return {"dose": dose_nome, "tipo": tipo, "mensagem": mensagem}


def _avisos(produto, linhas, cfg):
    avisos, meta = [], cfg.get("margem_alvo_dose_pct")
    for linha in linhas:
        if not linha["ativa"]:
            continue
        calc = linha["calc"]
        if calc["margem_pct"] is not None and calc["margem_pct"] < 0:
            avisos.append(_aviso(linha["nome"], "margem_negativa",
                                 f"{linha['nome']}: o preço não cobre o custo da dose (margem {calc['margem_pct']:.1f}%)."))
        elif meta and calc["margem_pct"] is not None and calc["margem_pct"] < float(meta):
            avisos.append(_aviso(linha["nome"], "margem_baixa",
                                 f"{linha['nome']}: margem de {calc['margem_pct']:.1f}%, abaixo da meta de {float(meta):.0f}%."))
        if calc["abaixo_da_garrafa"]:
            avisos.append(_aviso(linha["nome"], "abaixo_da_garrafa",
                                 f"{linha['nome']}: cada ml sai mais barato que na garrafa fechada."))
    return avisos


def doses_do_produto(produto, cfg=None) -> dict:
    cfg = cfg or ler_config_loja(produto.estabelecimento_id)
    volume = _d(produto.volume_embalagem_ml) if produto.volume_embalagem_ml else None
    perda = perda_efetiva_pct(produto, cfg)
    custo = _d(produto.preco_custo)
    linhas = []
    for dose in ProdutoDose.query.filter_by(estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id) \
            .order_by(ProdutoDose.ordem, ProdutoDose.id).all():
        linha = dose.to_dict()
        linha["calc"] = calcular(custo, volume, dose.volume_ml, dose.preco_venda, perda_pct=perda,
                                 preco_garrafa=produto.preco_venda) if volume else None
        if linha["calc"] is None:
            linha["calc"] = {k: None for k in ("custo_dose", "doses_por_garrafa", "doses_vendaveis", "preco_por_100ml",
                                               "margem_valor", "margem_pct", "receita_garrafa", "multiplo_da_garrafa")}
            linha["calc"]["abaixo_da_garrafa"] = False
        linhas.append(linha)
    sugerido = None if volume else volume_sugerido(produto)
    return {
        "produto": {
            "id": produto.id, "nome": produto.nome, "unidade_medida": produto.unidade_medida or "UN",
            "preco_custo": _f(custo, 4), "preco_venda": _f(produto.preco_venda, 2),
            "custo_estimado": (produto.origem_custo or "informado") != "informado",
            "quantidade": _f(produto.quantidade, 3),
        },
        "config": {
            "vende_por_dose": bool(produto.vende_por_dose),
            "volume_embalagem_ml": _f(volume, 2),
            "volume_sugerido_ml": _f(sugerido, 2),
            "validade_aberta_dias": produto.validade_aberta_dias,
            "perda_esperada_pct": _f(produto.perda_esperada_pct, 2),
            "perda_efetiva_pct": _f(perda, 2),
        },
        "doses": linhas,
        "garrafas_abertas": _garrafas_abertas_qtd(produto),
        "loja": cfg,
        "avisos": _avisos(produto, linhas, cfg),
    }


# ── gravação ──────────────────────────────────────────────────────────────

def _normalizar_doses_produto(itens, volume):
    """Doses do produto validadas: ml entre 0 e o volume da garrafa, preço > 0, nome único entre as ativas."""
    if not isinstance(itens, list):
        raise DoseError("Doses: formato inválido")
    if len(itens) > MAX_DOSES:
        raise DoseError(f"No máximo {MAX_DOSES} doses por produto")
    saida, nomes = [], set()
    for posicao, bruto in enumerate(itens, 1):
        if not isinstance(bruto, dict):
            raise DoseError(f"Dose {posicao}: formato inválido")
        ml = _num(bruto.get("volume_ml"), f"Dose {posicao}: ml", positivo=True, maximo=100000)
        nome = (str(bruto.get("nome") or "").strip() or f"Dose {_fmt_ml(ml)}")[:60]
        preco = _num(bruto.get("preco_venda"), f"{nome}: preço", positivo=True, maximo=1000000)
        if volume is not None and ml > volume:
            raise DoseError(f"{nome}: a dose ({_fmt_ml(ml)}) é maior que a garrafa ({_fmt_ml(volume)})")
        ativa = bruto.get("ativa", True) is not False
        if ativa:
            if nome.lower() in nomes:
                raise DoseError(f"Há duas doses chamadas \"{nome}\": use nomes diferentes")
            nomes.add(nome.lower())
        dose_id = bruto.get("id")
        saida.append({"id": int(dose_id) if dose_id not in (None, "", 0) else None, "nome": nome, "volume_ml": ml,
                      "preco_venda": preco, "ativa": ativa, "padrao": bool(bruto.get("padrao")) and ativa})
    ativas = [d for d in saida if d["ativa"]]
    padroes = [d for d in ativas if d["padrao"]]
    if len(padroes) > 1:
        raise DoseError("Escolha só uma dose padrão")
    if ativas and not padroes:
        ativas[0]["padrao"] = True
    return saida


def salvar_doses_produto(produto, dados, funcionario_id=None) -> dict:
    """Grava a configuração de dose do produto (volume da garrafa + doses). Devolve o estado novo."""
    if (produto.tipo_item or "produto") == "servico" or produto.controlar_estoque is False:
        raise DoseError("Serviço não vende por dose")
    if not isinstance(dados, dict):
        raise DoseError("Dados inválidos")
    vende = bool(dados.get("vende_por_dose"))
    volume = _num(dados.get("volume_embalagem_ml"), "Volume da garrafa (ml)", positivo=True, maximo=1000000,
                  vazio_ok=not vende)
    if vende and volume is None:
        raise DoseError("Informe o volume da garrafa para vender por dose")
    doses = _normalizar_doses_produto(dados.get("doses") or [], volume if vende else None)
    if vende and not [d for d in doses if d["ativa"]]:
        raise DoseError("Cadastre ao menos uma dose")
    validade = _num(dados.get("validade_aberta_dias"), "Validade depois de aberta (dias)", minimo=1, maximo=3650,
                    vazio_ok=True, casas=Decimal("1"))
    perda = _num(dados.get("perda_esperada_pct"), "Perda esperada", minimo=0, maximo=50, vazio_ok=True, casas=Q2)

    existentes = {d.id: d for d in ProdutoDose.query.filter_by(
        estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id).all()}
    for d in doses:
        if d["id"] is not None and d["id"] not in existentes:
            raise DoseError("Dose não pertence a este produto")
    mantidas = {d["id"] for d in doses if d["id"] is not None}
    for dose_id, dose in existentes.items():
        if dose_id in mantidas:
            continue
        vendida = VendaItem.query.filter_by(estabelecimento_id=produto.estabelecimento_id, dose_id=dose_id).first()
        if vendida:
            dose.ativa, dose.padrao = False, False       # histórico preservado: a dose só sai do PDV
        else:
            db.session.delete(dose)
    for ordem, d in enumerate(doses):
        dose = existentes.get(d["id"]) if d["id"] is not None else None
        if dose is None:
            dose = ProdutoDose(estabelecimento_id=produto.estabelecimento_id, produto_id=produto.id)
            db.session.add(dose)
        dose.nome, dose.volume_ml, dose.preco_venda = d["nome"], d["volume_ml"], d["preco_venda"]
        dose.ativa, dose.padrao, dose.ordem = d["ativa"], d["padrao"], ordem

    mudou_volume = produto.volume_embalagem_ml is not None and volume is not None \
        and _d(produto.volume_embalagem_ml) != volume
    produto.vende_por_dose = vende
    produto.volume_embalagem_ml = volume
    produto.validade_aberta_dias = int(validade) if validade is not None else None
    produto.perda_esperada_pct = perda
    db.session.flush()

    resultado = doses_do_produto(produto)
    abertas = resultado["garrafas_abertas"]
    if abertas and mudou_volume:
        resultado["avisos"].append(_aviso(None, "garrafa_aberta", (
            f"{abertas} garrafa(s) aberta(s) mantêm o volume antigo; o novo volume vale para as próximas aberturas.")))
    if abertas and not vende:
        resultado["avisos"].append(_aviso(None, "garrafa_aberta", (
            f"{abertas} garrafa(s) aberta(s): encerre ou descarte para o estoque fechar certo.")))
    from app.models import Auditoria
    Auditoria.registrar(
        estabelecimento_id=produto.estabelecimento_id, tipo_evento="doses_configuradas",
        descricao=f"Doses de {produto.nome}: {'ligada' if vende else 'desligada'}, "
                  f"{len([d for d in doses if d['ativa']])} dose(s), garrafa de "
                  f"{_fmt_ml(volume) if volume else 'volume não informado'}",
        usuario_id=funcionario_id)
    return resultado


# ── aplicação em lote ─────────────────────────────────────────────────────

def _produtos_da_selecao(estab_id, selecao):
    q = Produto.query.filter(Produto.estabelecimento_id == estab_id, Produto.deleted_at.is_(None),
                             Produto.ativo.isnot(False), Produto.eh_grade_modelo.isnot(True),
                             Produto.controlar_estoque.isnot(False))
    ids = selecao.get("produto_ids")
    if ids:
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            raise DoseError("Seleção de produtos inválida") from None
        q = q.filter(Produto.id.in_(ids))
    else:
        filtros = {k: (selecao.get(k) or "").strip() for k in ("subcategoria_oficial", "categoria_oficial", "marca",
                                                              "familia_produto")}
        if not any(filtros.values()):
            raise DoseError("Escolha os produtos (lista ou filtro por subcategoria, categoria, marca ou família)")
        for coluna, valor in filtros.items():
            if valor:
                q = q.filter(getattr(Produto, coluna) == valor)
    produtos = q.order_by(Produto.nome).limit(MAX_PRODUTOS_LOTE + 1).all()
    if len(produtos) > MAX_PRODUTOS_LOTE:
        raise DoseError(f"A seleção passa de {MAX_PRODUTOS_LOTE} produtos: refine o filtro")
    return produtos


def aplicar_modelo(estab_id, modelo, selecao, *, modo="substituir", dry_run=True, volume_padrao_ml=None,
                   funcionario_id=None) -> dict:
    """Aplica as doses do `modelo` aos produtos da `selecao`.

    Preço de cada dose: o informado, ou o que dá a ``margem_alvo_pct`` (do modelo, senão a da loja) sobre o
    custo do produto. Volume da garrafa: o já cadastrado, o detectado no nome, ou `volume_padrao_ml`.
    ``modo``: "substituir" (as doses do produto passam a ser as do modelo) ou "acrescentar" (soma as que faltam).
    Com ``dry_run`` nada é gravado. Cada produto grava dentro de um savepoint: um que falha não derruba os outros.
    """
    if modo not in ("substituir", "acrescentar"):
        raise DoseError("Modo inválido")
    itens = _normalizar_modelo(modelo, "Dose do modelo")
    padrao_volume = _num(volume_padrao_ml, "Volume padrão (ml)", positivo=True, maximo=1000000, vazio_ok=True)
    cfg = ler_config_loja(estab_id)
    meta = cfg.get("margem_alvo_dose_pct")
    linhas, aplicados, ignorados = [], 0, 0
    for produto in _produtos_da_selecao(estab_id, selecao or {}):
        origem_volume = "cadastro"
        volume = _d(produto.volume_embalagem_ml) if produto.volume_embalagem_ml else None
        if volume is None:
            volume, origem_volume = volume_sugerido(produto), "nome"
        if volume is None and padrao_volume is not None:
            volume, origem_volume = padrao_volume, "padrao"
        linha = {"produto_id": produto.id, "nome": produto.nome, "volume_embalagem_ml": _f(volume, 2),
                 "origem_volume": origem_volume if volume else None, "status": "ignorado", "motivo": None, "doses": []}
        if volume is None:
            linha["motivo"] = "Volume da garrafa desconhecido: cadastre o volume ou informe um volume padrão"
        elif (produto.tipo_item or "produto") == "servico":
            linha["motivo"] = "Serviço não vende por dose"
        else:
            perda = perda_efetiva_pct(produto, cfg)
            custo = _d(produto.preco_custo)
            novas, puladas = [], []
            for d in itens:
                if d["volume_ml"] > volume:
                    puladas.append(d["nome"])
                    continue
                preco = d["preco_venda"]
                if preco is None:
                    margem = d["margem_alvo_pct"] if d["margem_alvo_pct"] is not None else (
                        _d(meta) if meta else None)
                    if custo <= 0 or margem is None:
                        puladas.append(d["nome"])
                        continue
                    preco = sugerir_preco(custo / (volume * (Decimal(1) - perda / CEM)) * d["volume_ml"], margem)
                novas.append({"nome": d["nome"], "volume_ml": d["volume_ml"], "preco_venda": preco,
                              "padrao": d["padrao"]})
            if not novas:
                linha["motivo"] = "Nenhuma dose coube neste produto (volume, custo ou preço faltando)"
            else:
                if puladas:
                    linha["motivo"] = "Doses puladas: " + ", ".join(puladas)
                atuais = [x for x in doses_do_produto(produto, cfg)["doses"] if x["ativa"]]
                if modo == "acrescentar":
                    nomes = {x["nome"].lower() for x in atuais}
                    novas = [n for n in novas if n["nome"].lower() not in nomes]
                    final = [{"id": x["id"], "nome": x["nome"], "volume_ml": x["volume_ml"],
                              "preco_venda": x["preco_venda"], "ativa": True, "padrao": x["padrao"]}
                             for x in atuais] + novas
                else:
                    final = novas
                if not novas:
                    linha["motivo"] = "As doses do modelo já existem neste produto"
                else:
                    linha["doses"] = [dict(
                        nome=n["nome"], volume_ml=float(n["volume_ml"]), preco_venda=float(n["preco_venda"]),
                        **{"margem_pct": calcular(custo, volume, n["volume_ml"], n["preco_venda"],
                                                  perda_pct=perda)["margem_pct"]}) for n in novas]
                    linha["status"] = "aplicar"
                    if not dry_run:
                        dados = {"vende_por_dose": True, "volume_embalagem_ml": volume,
                                 "validade_aberta_dias": produto.validade_aberta_dias,
                                 "perda_esperada_pct": produto.perda_esperada_pct, "doses": final}
                        savepoint = db.session.begin_nested()
                        try:
                            salvar_doses_produto(produto, dados, funcionario_id)
                            savepoint.commit()
                            linha["status"] = "aplicado"
                        except DoseError as erro:
                            savepoint.rollback()
                            linha["status"], linha["motivo"], linha["doses"] = "ignorado", str(erro), []
        if linha["status"] in ("aplicar", "aplicado"):
            aplicados += 1
        else:
            ignorados += 1
        linhas.append(linha)
    return {"dry_run": bool(dry_run), "modo": modo, "aplicados": aplicados, "ignorados": ignorados, "linhas": linhas}
