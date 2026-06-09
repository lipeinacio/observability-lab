# Runbook: operar um problema no Zabbix

## Objetivo

Usar `Monitoring > Problems` como fila inicial de triagem, mantendo registro
de responsável, hipótese, ação e recuperação.

## 1. Ler antes de agir

Registre:

- horário de início;
- host;
- problema;
- severidade;
- duração;
- dados operacionais;
- tags `service`, `layer`, `impact` e `escalation`;
- problemas relacionados.

Abra o runbook pelo link disponível no problema.

## 2. Reconhecer

Abra o problema e use **Update**:

1. marque **Acknowledge**;
2. registre que a triagem foi iniciada;
3. informe operador e horário;
4. não feche manualmente o evento;
5. não altere severidade sem justificar.

Mensagem inicial:

```text
Triagem iniciada. Impacto em validação. Verificando função de negócio,
dependências e eventos relacionados.
```

## 3. Atualizar durante a investigação

Cada atualização deve incluir fato, interpretação e próximo passo:

```text
Fato: /health/live responde 200 e /health/db responde 503.
Interpretação: processo vivo com falha na dependência MySQL.
Próximo passo: escalar ao DBA com logs e horário da falha.
```

Use as tags para identificar a torre provável. As expressões correlacionam os
códigos HTTP e a duração da dependência para evitar que sintomas sejam
tratados como incidentes independentes.

## 4. Validar a recuperação

Confirme:

- problema mudou para resolvido;
- função de negócio voltou;
- Latest data recebeu amostra saudável;
- não surgiram novos problemas relacionados;
- comunicação de encerramento foi publicada.

## 5. Encerrar o registro

Adicione:

```text
Serviço recuperado e validado pela API e pelo monitoramento.
Causa:
Ação executada:
Torre responsável:
Pendência ou melhoria:
```

O evento deve recuperar pela condição técnica da trigger. Reconhecimento não
é resolução e fechamento manual não substitui validação.
