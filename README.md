# Painel CS Elevalife

Controle de relacionamento com o cliente: nota mensal por unidade e linha de serviço (Ergo, Fisio, Quiro, AF, Enfermagem/Med), com o registro de visitas, contatos, relatórios e objetivos feito pelos líderes.

- **Site:** GitHub Pages (`index.html`, `app.js`, `config.js`)
- **Login:** conta Microsoft da Elevalife (Entra ID, MSAL.js)
- **API e dados:** Azure Functions (Flex Consumption) + Azure Table Storage (`api/`)
- **Acesso:** a diretoria (e-mails em Configurações) vê tudo. Cada líder vê só as unidades atribuídas ao e-mail dele. A API confere isso no servidor.

## Atualizar ou recriar
No Azure Cloud Shell (bash), com `gh auth login` feito:

```bash
ADMIN_EMAIL="joao@elevalife.com.br" bash deploy/setup.sh
```

O script é idempotente: cria o que falta e republica a API e o site. A carga inicial (`deploy/seed.json`, histórico de 2026 importado das planilhas) só roda com o banco vazio.
