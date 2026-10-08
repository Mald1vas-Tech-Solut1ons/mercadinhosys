# app/routes/configuracao.py
"""
Módulo de Configuração de Elite - MercadinhoSys
Gerenciamento resiliente de configurações e dados do estabelecimento.
Usa SQL direto via query_helpers para evitar falhas de ORM em produção.
"""

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from app import db
from app.models import Configuracao, FuncionarioPreferencias, CondicaoPagamento
from app.utils.query_helpers import get_configuracao_safe, get_estabelecimento_full_safe, get_authorized_establishment_id
from app.utils.smart_cache import get_cached_config, set_cached_config, invalidate_config
import json
import traceback

configuracao_bp = Blueprint("configuracao", __name__)

# ==================== CONFIGURAÇÕES ====================

@configuracao_bp.route("/", methods=["GET"])
@jwt_required()
def obter_configuracoes():
    """Obtém configurações do estabelecimento (Padrão Blindado)"""
    try:
        claims = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado no token ou context"}), 400

        # Tenta buscar do cache primeiro
        config_data = get_cached_config(estabelecimento_id)
        if config_data:
            return jsonify({"success": True, "config": config_data}), 200

        config_data = get_configuracao_safe(estabelecimento_id)
        
        # Se não existir, tenta criar uma padrão via ORM (operação segura inicial)
        if not config_data:
            try:
                nova_config = Configuracao(estabelecimento_id=estabelecimento_id)
                db.session.add(nova_config)
                db.session.commit()
                config_data = get_configuracao_safe(estabelecimento_id)
            except Exception:
                db.session.rollback()
                # Fallback total: retorna objeto default em memória
                config_data = {
                    "cor_principal": "#007bff",
                    "tema_escuro": False,
                    "formas_pagamento": "[]"
                }

        # Salva no cache se encontrou ou criou
        set_cached_config(estabelecimento_id, config_data)

        return jsonify({
            "success": True, 
            "config": config_data
        }), 200

    except Exception as e:
        current_app.logger.error(f"❌ Erro em obter_configuracoes: {str(e)}")
        return jsonify({"success": False, "error": "Erro ao carregar configurações"}), 500


@configuracao_bp.route("/", methods=["PUT"])
@jwt_required()
def atualizar_configuracoes():
    """Atualiza as configurações do estabelecimento com SQL Puro (Blindado contra Schema Drift)"""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        claims = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        role = claims.get("role")
        
        if str(estabelecimento_id).lower() == 'all':
            return jsonify({"success": False, "error": "Ação não permitida na visão global (all)."}), 403
            
        if role not in ["admin", "dono", "gerente", "ADMIN"]:
            return jsonify({"success": False, "error": "Sem permissão para alterar configurações"}), 403

        data = request.get_json() or {}
        
        # Campos permitidos para atualização (Sincronizados com Frontend e Banco)
        allowed_fields = [
            "logo_url", "cor_principal", "tema_escuro", "impressao_automatica",
            "tipo_impressora", "formas_pagamento", "emitir_nfe", "emitir_nfce",
            "controlar_validade", "alerta_estoque_minimo", "dias_alerta_validade",
            "estoque_minimo_padrao", "exibir_preco_tela", "mostrar_foto_produto_pdv", "permitir_venda_sem_estoque",
            "desconto_maximo_percentual", "desconto_maximo_funcionario", "arredondamento_valores",
            "tempo_sessao_minutos", "tentativas_senha_bloqueio", "alertas_email", "alertas_whatsapp",
            "motivos_estorno", "aliquota_impostos_venda"
        ]

        # 1. Verifica se já existe configuração para este estabelecimento
        from sqlalchemy import text
        check_sql = "SELECT id FROM configuracoes WHERE estabelecimento_id = :eid LIMIT 1"
        existing = db.session.execute(text(check_sql), {"eid": estabelecimento_id}).fetchone()

        params = {"eid": estabelecimento_id}
        set_clauses = []
        
        # Prepara campos para Update/Insert
        for field in allowed_fields:
            if field in data:
                val = data[field]
                if field in ("formas_pagamento", "motivos_estorno") and isinstance(val, list):
                    val = json.dumps(val, ensure_ascii=False)
                if field == "aliquota_impostos_venda":
                    if val in (None, ""):
                        val = None
                    else:
                        from decimal import Decimal, InvalidOperation
                        try:
                            numero = Decimal(str(val).replace(",", "."))
                            if not numero.is_finite() or numero < 0 or numero > 100:
                                raise ValueError
                        except (InvalidOperation, ValueError):
                            return jsonify({"success": False, "error": "Alíquota de impostos deve estar entre 0 e 100"}), 400
                        val = float(numero)
                # logo_url é VARCHAR(500) e a logo é gerenciada pelo endpoint
                # dedicado (/logo). Um data-URI base64 aqui estoura a coluna e
                # derruba o save inteiro — ignora valores longos por segurança.
                if field == "logo_url" and isinstance(val, str) and (val.startswith("data:") or len(val) > 500):
                    continue

                params[field] = val
                set_clauses.append(f"{field} = :{field}")

        if not set_clauses:
             return jsonify({"success": True, "message": "Nada a atualizar"}), 200

        try:
            if existing:
                # UPDATE
                sql = f"UPDATE configuracoes SET {', '.join(set_clauses)} WHERE estabelecimento_id = :eid"
                db.session.execute(text(sql), params)
            else:
                # INSERT
                # Para insert precisamos garantir que colunas obrigatórias tenham valor ou default do banco assuma
                cols = ["estabelecimento_id"] + [k for k in params.keys() if k != "eid"]
                vals = [":eid"] + [f":{k}" for k in params.keys() if k != "eid"]
                
                sql = f"INSERT INTO configuracoes ({', '.join(cols)}) VALUES ({', '.join(vals)})"
                db.session.execute(text(sql), params)
            
            db.session.commit()
        except Exception as e_sql:
            # Se der erro (ex: coluna não existe), tentamos ignorar a coluna problemática?
            # Por enquanto, logamos e damos rollback. O try-catch externo pega.
            db.session.rollback()
            raise e_sql

        # Invalida o cache
        invalidate_config(estabelecimento_id)

        return jsonify({
            "success": True, 
            "message": "Configurações atualizadas com sucesso",
            "config": get_configuracao_safe(estabelecimento_id)
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro em atualizar_configuracoes (SQL): {str(e)}")
        # Tenta retornar erro legível
        return jsonify({"success": False, "error": "Não foi possível salvar as configurações. Verifique o banco de dados."}), 500


# ==================== ESTABELECIMENTO ====================

@configuracao_bp.route("/estabelecimento", methods=["GET"])
@jwt_required()
def get_estabelecimento():
    """Retorna dados do estabelecimento com resiliência total"""
    try:
        claims = get_jwt()
        estabelecimento_id = get_authorized_establishment_id()
        if str(estabelecimento_id).lower() == "all":
            # Visão Global (Holding) - Resumo de todas as unidades
            return jsonify({
                "success": True,
                "estabelecimento": {
                    "id": "all",
                    "nome_fantasia": "VISÃO GLOBAL (HOLDING)",
                    "razao_social": "MercadinhoSys Enterprise",
                    "cnpj": "00.000.000/0000-00",
                    "cidade": "Modo Auditoria",
                    "estado": "GLOBAL"
                }
            }), 200

        dados = get_estabelecimento_full_safe(estabelecimento_id)
        
        if not dados:
            return jsonify({"success": False, "error": "Dados do estabelecimento não encontrados"}), 404

        return jsonify({
            "success": True, 
            "estabelecimento": dados
        }), 200

    except Exception as e:
        current_app.logger.error(f"❌ Erro em get_estabelecimento: {str(e)}")
        return jsonify({"success": False, "error": "Erro ao carregar dados da empresa"}), 500


@configuracao_bp.route("/estabelecimentos", methods=["GET"])
@jwt_required()
def listar_estabelecimentos():
    """Lista todos os estabelecimentos - apenas para ADMIN (visão multi-loja)"""
    try:
        claims = get_jwt()
        role = (claims.get("role") or "").lower()
        is_super = bool(claims.get("is_super_admin", False))

        if not is_super and role not in ["admin", "dono"]:
            return jsonify({"success": False, "error": "Acesso restrito à administração"}), 403

        from sqlalchemy import text
        from app.utils.query_helpers import get_authorized_establishment_id

        # ISOLAMENTO MULTI-TENANT: super admin (nível SaaS) enxerga todas as lojas;
        # admin/dono de loja enxerga SOMENTE o próprio estabelecimento. Sem este
        # filtro, qualquer admin via nome/CNPJ/faturamento de todos os tenants.
        params = {}
        where_clause = ""
        if not is_super:
            where_clause = "WHERE e.id = :eid"
            params["eid"] = get_authorized_establishment_id()

        sql = text(f"""
            SELECT
                e.id, e.nome_fantasia, e.razao_social, e.cnpj, e.telefone, e.email,
                e.logradouro, e.numero, e.bairro, e.cidade, e.estado, e.cep,
                e.ativo, e.regime_tributario,
                CAST(e.data_abertura AS TEXT) as data_abertura,
                (SELECT COUNT(*) FROM funcionarios f WHERE f.estabelecimento_id = e.id AND f.ativo = TRUE) as total_funcionarios,
                (SELECT COUNT(*) FROM produtos p WHERE p.estabelecimento_id = e.id AND p.ativo = TRUE) as total_produtos,
                (SELECT COUNT(*) FROM clientes c WHERE c.estabelecimento_id = e.id AND c.ativo = TRUE) as total_clientes,
                (SELECT COALESCE(SUM(v.total), 0) FROM vendas v WHERE v.estabelecimento_id = e.id AND v.status = 'finalizada') as faturamento_total,
                (SELECT CAST(MAX(v.data_venda) AS TEXT) FROM vendas v WHERE v.estabelecimento_id = e.id) as ultima_venda,
                e.plano, e.plano_status,
                CAST(e.vencimento_plano AS TEXT) as vencimento_plano
            FROM estabelecimentos e
            {where_clause}
            ORDER BY e.id
        """)
        rows = db.session.execute(sql, params).fetchall()

        estabelecimentos = []
        for r in rows:
            estabelecimentos.append({
                "id": r[0],
                "nome_fantasia": r[1],
                "razao_social": r[2],
                "cnpj": r[3],
                "telefone": r[4],
                "email": r[5],
                "logradouro": r[6],
                "numero": r[7],
                "bairro": r[8],
                "cidade": r[9],
                "estado": r[10],
                "cep": r[11],
                "ativo": r[12],
                "regime_tributario": r[13],
                "data_abertura": r[14],
                "total_funcionarios": r[15] or 0,
                "total_produtos": r[16] or 0,
                "total_clientes": r[17] or 0,
                "faturamento_total": float(r[18]) if r[18] else 0.0,
                "ultima_venda": r[19],
                "plano": r[20],
                "plano_status": r[21],
                "vencimento_plano": r[22],
            })

        return jsonify({"success": True, "estabelecimentos": estabelecimentos}), 200

    except Exception as e:
        current_app.logger.error(f"❌ Erro em listar_estabelecimentos: {str(e)}")
        return jsonify({"success": False, "error": "Erro ao listar estabelecimentos"}), 500


@configuracao_bp.route("/estabelecimento", methods=["PUT"])
@jwt_required()
def update_estabelecimento():
    """Atualização segura do estabelecimento (Somente Admin/Dono)"""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        claims = get_jwt()
        role = (claims.get("role") or "").lower()
        is_super = claims.get("is_super_admin", False)
        
        if str(estabelecimento_id).lower() == 'all':
            return jsonify({"success": False, "error": "Ação não permitida na visão global (all)."}), 403
            
        if role not in ["admin", "dono", "ADMIN"] and not is_super:
            return jsonify({"success": False, "error": "Apenas proprietários podem alterar dados da empresa"}), 403

        data = request.get_json() or {}
        
        # Filtro de segurança: campos cadastrais e endereço completo
        campos_update = [
            "nome_fantasia", "razao_social", "telefone", "email", "inscricao_estadual",
            "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "estado",
            "regime_tributario", "fiscal_ambiente", "fiscal_gateway", "fiscal_token",
            "fiscal_csc", "fiscal_csc_id", "serie_nfce"
        ]
        
        from sqlalchemy import text
        set_clauses = []
        params = {"eid": estabelecimento_id}
        
        for c in campos_update:
            if c in data:
                # Sanitização básica para CEP
                val = data[c]
                if c == "cep" and val:
                    val = "".join(filter(str.isdigit, str(val)))
                    if len(val) == 8:
                        val = f"{val[:5]}-{val[5:]}"
                
                set_clauses.append(f"{c} = :{c}")
                params[c] = val
        
        if set_clauses:
            sql = f"UPDATE estabelecimentos SET {', '.join(set_clauses)} WHERE id = :eid"
            current_app.logger.info(f"📊 [DATABASE] Executando Update Estabelecimento ID {estabelecimento_id}")
            current_app.logger.info('Campos atualizados: %s', sorted(key for key in params if key != 'eid'))
            db.session.execute(text(sql), params)
            db.session.commit()
            current_app.logger.info(f"✅ [SUCCESS] Dados persistidos no banco.")

        return jsonify({
            "success": True, 
            "message": "Dados da empresa atualizados",
            "estabelecimento": get_estabelecimento_full_safe(estabelecimento_id)
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro em update_estabelecimento: {str(e)}")
        return jsonify({"success": False, "error": "Falha ao atualizar dados"}), 500


# ==================== PIN DE SEGURANÇA (autorização de operações sensíveis) ====================

def autorizar_por_pin(estabelecimento_id, pin):
    """
    Valida um PIN contra os admins/gerentes (nível ≤ 2) do tenant.
    Retorna o Funcionario autorizador ou None. Mesma regra usada no estorno de venda.
    """
    from app.models import Funcionario
    pin = (str(pin or "")).strip()
    if not pin:
        return None
    candidatos = Funcionario.query.filter(
        Funcionario.estabelecimento_id == estabelecimento_id,
        Funcionario.pin_cancelamento.isnot(None),
        Funcionario.nivel_acesso <= 2,
    ).all()
    return next((f for f in candidatos if f.check_pin(pin)), None)


@configuracao_bp.route("/verificar-pin", methods=["POST"])
@jwt_required()
def verificar_pin_seguranca():
    """Verifica o PIN de segurança do tenant (gate para editar/descartar/estornar)."""
    try:
        estabelecimento_id = get_authorized_establishment_id()
        if not estabelecimento_id:
            return jsonify({"success": False, "error": "Estabelecimento não identificado"}), 400
        pin = (request.get_json() or {}).get("pin", "")
        autorizador = autorizar_por_pin(estabelecimento_id, pin)
        if not autorizador:
            return jsonify({"success": False, "error": "PIN inválido"}), 403
        return jsonify({"success": True, "autorizador": autorizador.nome}), 200
    except Exception as e:
        current_app.logger.error(f"❌ Erro em verificar_pin_seguranca: {str(e)}")
        return jsonify({"success": False, "error": "Falha ao verificar PIN"}), 500


@configuracao_bp.route("/pin", methods=["GET", "PUT"])
@jwt_required()
def pin_seguranca():
    """
    GET: informa se o admin logado já tem PIN cadastrado (nunca devolve o PIN).
    PUT: define/atualiza o PIN (4 a 6 dígitos) do admin logado. Somente nível admin.
    """
    from app.models import Funcionario
    try:
        estabelecimento_id = get_authorized_establishment_id()
        claims = get_jwt()
        role = (claims.get("role") or "").lower()
        nivel = claims.get("nivel_acesso", 99)
        # Admin da LOJA (nível 1). O super admin (dono do SaaS, nível 0) NÃO define
        # este PIN: ele cairia no registro dele e o gate da loja (nível ≤ 2) não o
        # encontraria. PIN é config operacional, pertence ao admin do tenant.
        eh_admin_loja = role in ("admin", "dono") or (isinstance(nivel, int) and nivel <= 1)
        if not eh_admin_loja:
            return jsonify({"success": False, "error": "Apenas o administrador da loja (nível 1) pode configurar o PIN"}), 403

        user_id = int(get_jwt_identity())
        funcionario = Funcionario.query.filter_by(id=user_id, estabelecimento_id=estabelecimento_id).first()
        if not funcionario:
            return jsonify({"success": False, "error": "Usuário não encontrado"}), 404

        if request.method == "GET":
            return jsonify({"success": True, "tem_pin": funcionario.tem_pin}), 200

        # PUT
        pin = (str((request.get_json() or {}).get("pin", ""))).strip()
        if not pin.isdigit() or not (4 <= len(pin) <= 6):
            return jsonify({"success": False, "error": "O PIN deve ter de 4 a 6 dígitos numéricos"}), 400
        funcionario.set_pin(pin)
        db.session.commit()
        return jsonify({"success": True, "message": "PIN de segurança atualizado", "tem_pin": True}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro em pin_seguranca: {str(e)}")
        return jsonify({"success": False, "error": "Falha ao salvar PIN"}), 500


# ==================== PREFERÊNCIAS DO USUÁRIO ====================

@configuracao_bp.route("/preferencias", methods=["GET", "PUT"])
@jwt_required()
def preferencias_usuario():
    """
    Gerencia preferências pessoais do usuário (tema, notificações, etc) via ORM (Blindado)
    """
    try:
        claims = get_jwt()
        user_id_raw = claims.get("sub") or get_jwt_identity()
        try:
            user_id = int(user_id_raw)
        except (ValueError, TypeError):
            user_id = user_id_raw
        
        # Busca preferências do usuário via Modelo
        prefs = FuncionarioPreferencias.query.filter_by(funcionario_id=user_id).first()
        
        if request.method == "GET":
            if not prefs:
                current_app.logger.info(f"🔍 [PREFS] Criando preferências default para usuário {user_id}")
                return jsonify({
                    "success": True,
                    "preferencias": {
                        "tema_escuro": False,
                        "notificacoes_desktop": True,
                        "idioma": "pt-BR",
                        "sidebar_colapsada": False,
                        "filtros_salvos": {}
                    }
                }), 200
            
            return jsonify({
                "success": True,
                "preferencias": prefs.to_dict()
            }), 200
        
        elif request.method == "PUT":
            data = request.get_json() or {}
            current_app.logger.info(f"💾 [PREFS] Atualizando preferências para usuário {user_id}: {data}")
            
            if not prefs:
                # Usa o estabelecimento base do usuário, não o impersonado, para salvar preferências globais
                est_id = claims.get("estabelecimento_id")
                
                # Se ainda assim não tiver, falha
                if not est_id or str(est_id).lower() == 'all':
                    est_id = 1 # Fallback para admin HQ
                    
                prefs = FuncionarioPreferencias(funcionario_id=user_id, estabelecimento_id=est_id)
                db.session.add(prefs)
            
            # Atualiza apenas os campos enviados
            if "tema_escuro" in data:
                prefs.tema_escuro = bool(data["tema_escuro"])
            if "notificacoes_desktop" in data:
                prefs.notificacoes_push = bool(data["notificacoes_desktop"])
            if "idioma" in data:
                prefs.idioma = data["idioma"]
            if "sidebar_colapsada" in data:
                prefs.sidebar_colapsada = bool(data["sidebar_colapsada"])
            if "filtros_salvos" in data:
                prefs.filtros_salvos = data["filtros_salvos"]
            
            db.session.commit()
            current_app.logger.info(f"✅ [PREFS] Preferências salvas com sucesso para usuário {user_id}")
            
            return jsonify({
                "success": True, 
                "message": "Preferências salvas com sucesso",
                "preferencias": prefs.to_dict()
            }), 200
            
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro em preferencias_usuario: {str(e)}")
        # Fallback de sobrevivência para o Frontend não quebrar
        return jsonify({
            "success": True, 
            "message": "Preferências aplicadas (Modo Volátil)",
            "preferencias": request.get_json() if request.method == "PUT" else {}
        }), 200



# ==================== LOGO UPLOAD ====================

@configuracao_bp.route("/logo", methods=["POST"])
@jwt_required()
def upload_logo():
    """Realiza o upload da logo e salva como Base64 (Máxima Portabilidade) - Apenas ADMIN/GERENTE"""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        claims = get_jwt()
        user_role = (claims.get("role") or "").lower()
        
        if str(estabelecimento_id).lower() == 'all':
            return jsonify({"success": False, "error": "Ação não permitida na visão global (all)."}), 403
            
        # Verificação de permissão - apenas ADMIN e GERENTE podem fazer upload
        if user_role not in ["admin", "gerente"]:
            return jsonify({
                "success": False, 
                "error": "Acesso negado. Apenas administradores e gerentes podem alterar a logo."
            }), 403
        
        if 'logo' not in request.files:
            return jsonify({"success": False, "error": "Nenhum arquivo enviado"}), 400
            
        file = request.files['logo']
        if file.filename == '':
            return jsonify({"success": False, "error": "Arquivo vazio"}), 400

        # Validação do tipo de arquivo
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        if not ('.' in file.filename and file.filename.rsplit('.', 1)[1].lower() in allowed_extensions):
            return jsonify({"success": False, "error": "Tipo de arquivo não permitido. Use PNG, JPG, JPEG, GIF ou WebP."}), 400

        # Validação do tamanho (máximo 5MB)
        file.seek(0, 2)  # Move para o fim
        file_size = file.tell()
        file.seek(0)  # Volta para o início
        
        if file_size > 5 * 1024 * 1024:  # 5MB
            return jsonify({"success": False, "error": "Arquivo muito grande. Tamanho máximo: 5MB"}), 400

        # Converte para Base64 para salvar no banco
        import base64
        file_content = file.read()
        from PIL import Image, UnidentifiedImageError
        from io import BytesIO
        try:
            with Image.open(BytesIO(file_content)) as image:
                if image.format not in {'PNG', 'JPEG', 'GIF', 'WEBP'} or image.width * image.height > 16000000:
                    raise ValueError('Imagem inválida ou resolução excessiva')
                mime_type = Image.MIME[image.format]
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            return jsonify({'success': False, 'error': 'Conteúdo de imagem inválido ou resolução excessiva'}), 400
        base64_data = f"data:{mime_type};base64,{base64.b64encode(file_content).decode()}"

        from sqlalchemy import text
        
        # Verifica se existe config
        check_sql = "SELECT id FROM configuracoes WHERE estabelecimento_id = :eid LIMIT 1"
        existing = db.session.execute(text(check_sql), {"eid": estabelecimento_id}).fetchone()

        # IMPORTANTE: o base64 vai SOMENTE em logo_base64 (coluna Text).
        # logo_url é VARCHAR(500) e estouraria com o data URI (causa do erro 500).
        if existing:
            sql = "UPDATE configuracoes SET logo_base64 = :img, logo_url = NULL WHERE estabelecimento_id = :eid"
            db.session.execute(text(sql), {"img": base64_data, "eid": estabelecimento_id})
        else:
            sql = "INSERT INTO configuracoes (estabelecimento_id, logo_base64) VALUES (:eid, :img)"
            db.session.execute(text(sql), {"eid": estabelecimento_id, "img": base64_data})

        db.session.commit()
        invalidate_config(estabelecimento_id)

        return jsonify({
            "success": True, 
            "logo_url": base64_data,
            "message": "Logo atualizada com sucesso"
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"❌ Erro em upload_logo: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

# ==================== CONDIÇÕES DE PAGAMENTO ====================

@configuracao_bp.route("/condicoes-pagamento", methods=["GET"])
@jwt_required()
def listar_condicoes_pagamento():
    """Lista as condicoes de pagamento cadastradas para o tenant"""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        condicoes = CondicaoPagamento.query.filter_by(estabelecimento_id=estabelecimento_id, ativo=True).all()
        return jsonify({
            "success": True,
            "condicoes": [c.to_dict() for c in condicoes]
        }), 200
    except Exception as e:
        current_app.logger.error(f"Erro ao listar condicoes_pagamento: {str(e)}")
        return jsonify({"success": False, "error": "Erro ao carregar condicoes de pagamento"}), 500

@configuracao_bp.route("/condicoes-pagamento", methods=["POST"])
@jwt_required()
def criar_condicao_pagamento():
    """Cria uma nova condicao de pagamento (apenas admin)"""
    try:
        from app.utils.query_helpers import get_authorized_establishment_id
        estabelecimento_id = get_authorized_establishment_id()
        claims = get_jwt()
        if claims.get("role") not in ["admin", "dono", "ADMIN", "gerente"]:
            return jsonify({"success": False, "error": "Acesso negado"}), 403

        data = request.get_json()
        nova = CondicaoPagamento(
            estabelecimento_id=estabelecimento_id,
            nome=data.get("nome"),
            tipo=data.get("tipo", "prazo"),
            dias_prazo=data.get("dias_prazo", 0),
            ativo=True
        )
        db.session.add(nova)
        db.session.commit()
        return jsonify({"success": True, "condicao": nova.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Erro ao criar condicao_pagamento: {str(e)}")
        return jsonify({"success": False, "error": "Erro ao salvar condicao de pagamento"}), 500
