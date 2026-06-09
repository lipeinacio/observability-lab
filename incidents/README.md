# Incidentes simulados

Esta pasta contém relatórios gerados por exercícios operacionais do
laboratório.

Os exercícios são explicitamente simulados. Eles não representam incidentes
de produção nem acionamentos reais de equipes corporativas.

## Executar o cenário de DBA

```bash
make dba-drill
```

O exercício:

1. ativa a indisponibilidade controlada do banco;
2. espera o problema aparecer no Zabbix;
3. reconhece o evento e registra a triagem;
4. coleta health checks e métricas;
5. registra o escalonamento simulado para DBA;
6. restaura o laboratório;
7. valida a recuperação;
8. gera relatório Markdown e dados JSON em `incidents/generated/`.

Antes de publicar um relatório, confirme que ele não contém credenciais ou
informações de ambientes reais.
