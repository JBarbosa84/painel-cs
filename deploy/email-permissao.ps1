# Permite que a API do Painel CS envie e-mail SOMENTE pela caixa indicada (Exchange Online RBAC for Applications).
# Rodar no Cloud Shell (PowerShell) com uma conta de administrador do Exchange:
#   pwsh deploy/email-permissao.ps1 -AppId <appId> -ObjectId <objectId> [-Caixa joao@elevalife.com.br]
param([Parameter(Mandatory)][string]$AppId, [Parameter(Mandatory)][string]$ObjectId, [string]$Caixa = "joao@elevalife.com.br")
$ErrorActionPreference = "Stop"
Connect-ExchangeOnline -ShowBanner:$false -Device
if (-not (Get-ServicePrincipal -Identity $ObjectId -ErrorAction SilentlyContinue)) {
  New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName "painel-cs-api" | Out-Null
}
if (-not (Get-ManagementScope -Identity "PainelCS-Remetente" -ErrorAction SilentlyContinue)) {
  New-ManagementScope -Name "PainelCS-Remetente" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Caixa'" | Out-Null
}
if (-not (Get-ManagementRoleAssignment -Identity "PainelCS-MailSend" -ErrorAction SilentlyContinue)) {
  New-ManagementRoleAssignment -Name "PainelCS-MailSend" -App $ObjectId -Role "Application Mail.Send" -CustomResourceScope "PainelCS-Remetente" | Out-Null
}
Test-ServicePrincipalAuthorization -Identity $ObjectId -Resource $Caixa | Format-Table -AutoSize
