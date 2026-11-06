"""
app/schemas/__init__.py
Schemas de validação com Marshmallow
"""

from marshmallow import Schema, fields, validate, ValidationError, validates


class ProdutoSchema(Schema):
    """Schema para validação de produtos"""

    nome = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    codigo_barras = fields.Str(validate=validate.Length(max=50))
    categoria = fields.Str(validate=validate.Length(max=50))
    preco_venda = fields.Decimal(
        required=True, as_string=True, validate=validate.Range(min=0)
    )
    preco_custo = fields.Decimal(as_string=True, validate=validate.Range(min=0))
    estoque_atual = fields.Int(validate=validate.Range(min=0))
    estoque_minimo = fields.Int(validate=validate.Range(min=0))
    unidade = fields.Str(validate=validate.OneOf(["UN", "KG", "LT", "MT", "CX"]))
    ativo = fields.Bool()

    @validates("preco_venda")
    def validate_preco_venda(self, value):
        if float(value) <= 0:
            raise ValidationError("Preço de venda deve ser maior que zero")


class VendaSchema(Schema):
    """Schema para validação de vendas"""

    cliente_id = fields.Int(allow_none=True)
    forma_pagamento = fields.Str(
        required=True,
        validate=validate.OneOf(["dinheiro", "credito", "debito", "pix", "fiado"]),
    )
    desconto = fields.Decimal(as_string=True, validate=validate.Range(min=0))
    items = fields.List(
        fields.Nested("VendaItemSchema"), required=True, validate=validate.Length(min=1)
    )

    @validates("items")
    def validate_items(self, value):
        if not value:
            raise ValidationError("A venda deve conter pelo menos um item")


class VendaItemSchema(Schema):
    """Schema para itens da venda"""

    produto_id = fields.Int(required=True)
    quantidade = fields.Decimal(
        required=True, as_string=True, validate=validate.Range(min=0.001)
    )
    preco_unitario = fields.Decimal(
        required=True, as_string=True, validate=validate.Range(min=0)
    )
    desconto = fields.Decimal(as_string=True, validate=validate.Range(min=0, max=100))


class ClienteSchema(Schema):
    """Schema para validação de clientes"""

    nome = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    cpf = fields.Str(validate=validate.Length(min=11, max=14))
    telefone = fields.Str(validate=validate.Length(max=20))
    email = fields.Email()
    limite_credito = fields.Decimal(as_string=True, validate=validate.Range(min=0))
    ativo = fields.Bool()


class FuncionarioSchema(Schema):
    """Schema para validação de funcionários"""

    nome = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    cpf = fields.Str(required=True, validate=validate.Length(min=11, max=14))
    email = fields.Email(required=True)
    telefone = fields.Str(validate=validate.Length(max=20))
    cargo = fields.Str(
        required=True, validate=validate.OneOf(["admin", "gerente", "funcionario"])
    )
    salario = fields.Decimal(as_string=True, validate=validate.Range(min=0))
    comissao = fields.Decimal(as_string=True, validate=validate.Range(min=0, max=100))
    senha = fields.Str(required=True, validate=validate.Length(min=6))
    pin = fields.Str(validate=validate.Length(equal=4))
    ativo = fields.Bool()


class LoginSchema(Schema):
    """Schema para validação de login"""

    email = fields.Email(required=True)
    senha = fields.Str(required=True, validate=validate.Length(min=6))


class FornecedorSchema(Schema):
    """Schema para validação de fornecedores"""

    nome = fields.Str(required=True, validate=validate.Length(min=2, max=100))
    cnpj = fields.Str(validate=validate.Length(min=14, max=18))
    telefone = fields.Str(validate=validate.Length(max=20))
    email = fields.Email()
    ativo = fields.Bool()


class DespesaSchema(Schema):
    """Schema para validação de despesas"""

    descricao = fields.Str(required=True, validate=validate.Length(min=2, max=200))
    categoria = fields.Str(required=True)
    valor = fields.Decimal(
        required=True, as_string=True, validate=validate.Range(min=0)
    )
    data_vencimento = fields.Date()
    pago = fields.Bool()
