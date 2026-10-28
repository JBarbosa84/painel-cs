#!/usr/bin/env bash
# Cria (ou atualiza) toda a infraestrutura do Painel CS. Rodar no Azure Cloud Shell (bash),
# logado no Azure (automatico) e no GitHub (gh auth login). Pode ser rodado de novo com seguranca.
# Uso: ADMIN_EMAIL="joao@elevalife.com.br,outro@..." bash deploy/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_EMAIL:?Informe ADMIN_EMAIL}"
REPO=painel-cs
GH_USER=$(gh api user -q .login)
ORIGIN="https://${GH_USER,,}.github.io"
SITE="$ORIGIN/$REPO/"
RG=rg-painel-cs
SUF=$(az account show --query id -o tsv | md5sum | cut -c1-6)
ST="stpainelcs$SUF"; FN="painel-cs-api-$SUF"
LOC=$(az functionapp list-flexconsumption-locations --query "[?name=='brazilsouth'].name | [0]" -o tsv 2>/dev/null || true)
LOC=${LOC:-eastus2}
echo "== Regiao: $LOC | Site: $SITE"

echo "== Grupo de recursos e armazenamento"
az group create -n $RG -l $LOC -o none
az storage account show -n $ST -g $RG -o none 2>/dev/null || az storage account create -n $ST -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
CONN=$(az storage account show-connection-string -n $ST -g $RG -o tsv)
az storage table create -n painelcs --connection-string "$CONN" -o none

echo "== Function App (Flex Consumption)"
az functionapp show -g $RG -n $FN -o none 2>/dev/null || az functionapp create -g $RG -n $FN --storage-account $ST --flexconsumption-location $LOC --runtime node --runtime-version 22 -o none

echo "== Aplicativo no Entra ID"
TENANT=$(az account show --query tenantId -o tsv)
APPID=$(az ad app list --display-name "Painel CS Elevalife" --query "[0].appId" -o tsv)
[ -z "$APPID" ] && APPID=$(az ad app create --display-name "Painel CS Elevalife" --sign-in-audience AzureADMyOrg --query appId -o tsv)
OBJ=$(az ad app show --id $APPID --query id -o tsv)
SCOPE_ID=$(az ad app show --id $APPID --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)
[ -z "$SCOPE_ID" ] && SCOPE_ID=$(cat /proc/sys/kernel/random/uuid)
SCOPES='[{"id":"'$SCOPE_ID'","value":"access_as_user","type":"User","isEnabled":true,"adminConsentDisplayName":"Acessar o Painel CS","adminConsentDescription":"Permite que o Painel CS acesse a API em nome do usuario.","userConsentDisplayName":"Acessar o Painel CS","userConsentDescription":"Permite que o Painel CS acesse a API em seu nome."}]'
GRAPH='[{"resourceAppId":"00000003-0000-0000-c000-000000000000","resourceAccess":[{"id":"e1fe6dd8-ba31-4d61-89e7-88639da4683d","type":"Scope"},{"id":"37f7f235-527c-4136-accd-4a02d197296e","type":"Scope"},{"id":"14dad69e-099b-42c9-810b-d002981feec1","type":"Scope"},{"id":"7427e0e9-2fba-42fe-b0c0-848c9e6a8182","type":"Scope"}]}]'
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$OBJ" --headers "Content-Type=application/json" \
  --body '{"identifierUris":["api://'$APPID'"],"spa":{"redirectUris":["'$SITE'","http://localhost:8080/"]},"api":{"requestedAccessTokenVersion":2,"oauth2PermissionScopes":'"$SCOPES"'},"requiredResourceAccess":'"$GRAPH"'}'
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$OBJ" --headers "Content-Type=application/json" \
  --body '{"api":{"requestedAccessTokenVersion":2,"oauth2PermissionScopes":'"$SCOPES"',"preAuthorizedApplications":[{"appId":"'$APPID'","delegatedPermissionIds":["'$SCOPE_ID'"]}]}}'
az ad sp show --id $APPID -o none 2>/dev/null || az ad sp create --id $APPID -o none
sleep 20
az ad app permission admin-consent --id $APPID || echo "!! Conceda o consentimento em Entra ID > Registros de aplicativo > Painel CS Elevalife > Permissoes de API"

echo "== Configuracao e publicacao da API"
MAIL_FROM=${MAIL_FROM:-joao@elevalife.com.br}
az functionapp config appsettings set -g $RG -n $FN --settings TENANT_ID=$TENANT CLIENT_ID=$APPID TABLES_CONNECTION="$CONN" MAIL_FROM=$MAIL_FROM SITE_URL=$SITE -o none
az functionapp identity assign -g $RG -n $FN -o none
MI_OID=$(az functionapp identity show -g $RG -n $FN --query principalId -o tsv)
MI_APPID=$(az ad sp show --id $MI_OID --query appId -o tsv)
echo "Identidade da API: appId=$MI_APPID objectId=$MI_OID (permissao de e-mail: deploy/email-permissao.ps1)"
az functionapp cors remove -g $RG -n $FN --allowed-origins "$ORIGIN" -o none 2>/dev/null || true
az functionapp cors add -g $RG -n $FN --allowed-origins "$ORIGIN" -o none
(cd api && npm install --omit=dev --no-audit --no-fund --silent && rm -f ../api.zip && zip -qr ../api.zip .)
az functionapp deployment source config-zip -g $RG -n $FN --src api.zip -o none
rm -f api.zip
HOST=$(az webapp show -g $RG -n $FN --query defaultHostName -o tsv)

echo "== Dados iniciais"
if az storage entity show -t painelcs --partition-key config --row-key geral --connection-string "$CONN" -o none 2>/dev/null; then
  echo "Banco ja tem dados: carga inicial ignorada."
else
  TABLES_CONNECTION="$CONN" ADMIN_EMAIL="$ADMIN_EMAIL" node deploy/seed.js
fi

echo "== Site no GitHub Pages"
cat > config.js <<J
// Gerado por deploy/setup.sh
window.PAINEL_CONFIG = { clientId: "$APPID", tenantId: "$TENANT", apiBase: "https://$HOST" };
J
gh auth setup-git
[ -d .git ] || git init -q -b main
git config user.name >/dev/null || git config user.name "$GH_USER"
git config user.email >/dev/null || git config user.email "$GH_USER@users.noreply.github.com"
git add -A
git commit -q -m "Painel CS: publicacao ($(date +%Y-%m-%d))

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LX5WZ4C1YkaQBJAUzNj4g8" || true
if ! gh repo view "$GH_USER/$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --description "Painel CS Elevalife - relacionamento com o cliente" --source . --remote origin --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_USER/$REPO.git"
  git push -u origin main
fi
gh api -X POST "repos/$GH_USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true

echo
echo "PRONTO"
echo "Site: $SITE"
echo "API:  https://$HOST"
echo "App Entra: $APPID (tenant $TENANT)"
