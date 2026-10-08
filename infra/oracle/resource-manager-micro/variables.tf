variable "compartment_id" {
  description = "OCID do compartment/tenancy autorizado; fornecer fora do Git."
  type        = string
}

variable "availability_domain" {
  description = "Availability domain disponível na região da conta OCI."
  type        = string
}

variable "ssh_public_key" {
  description = "Chave pública SSH autorizada; nunca informar chave privada."
  type        = string
}
