# INC-20260608-230042-DBA — Banco de pedidos indisponível

> Exercício simulado em laboratório. Nenhuma equipe corporativa real foi
> acionada.

## Identificação

- severidade: alta;
- início: 08/06/2026, 23:00:42;
- recuperação: 08/06/2026, 23:00:56;
- host: `APP-LAB-ORDERS`;
- serviço: `orders-api`;
- problema no Zabbix: `Orders MySQL: dependência indisponível`;
- event ID: `278`;
- responsável: Observabilidade Lab.

## Impacto confirmado

Usuários não conseguem consultar nem criar pedidos. O processo da aplicação
permanece vivo, mas readiness e função de negócio falham porque a dependência
MySQL está indisponível.

## Timeline

| Horário | Fato, decisão ou ação | Resultado |
|---|---|---|
| 08/06/2026, 23:00:42 | Falha controlada ativada | Modo db-unavailable |
| 08/06/2026, 23:00:44 | Problema detectado no Zabbix | Orders MySQL: dependência indisponível, eventid 278 |
| 08/06/2026, 23:00:44 | Problema reconhecido | Triagem iniciada. Impacto em validação. Verificando função de negócio, processo e dependência MySQL. |
| 08/06/2026, 23:00:48 | Impacto confirmado | Processo vivo; readiness, banco e pedidos indisponíveis |
| 08/06/2026, 23:00:48 | Escalonamento simulado para DBA | Fato: processo e endpoint HTTP permanecem ativos; /health/db e /api/orders retornam 503. Interpretação: falha isolada na dependência MySQL. Ação: escalonamento simulado para DBA com evidências. |
| 08/06/2026, 23:00:50 | Ação simulada do DBA | Disponibilidade da dependência restaurada |
| 08/06/2026, 23:00:56 | Recuperação validada | Zabbix recuperado e endpoints críticos em HTTP 200 |

## Evidências

| Endpoint | HTTP | Duração | Request ID |
|---|---:|---:|---|
| `/health/live` | 200 | 3 ms | `d39557f9-f19e-4754-852d-6c2c3b70a6e8` |
| `/health/ready` | 503 | 6 ms | `ce217435-3b70-414e-ad74-da928e933076` |
| `/health/db` | 503 | 6 ms | `acfd00e2-96df-414d-a63f-4824f8238d6c` |
| `/api/orders` | 503 | 6 ms | `b0e455e1-5959-4411-98ad-7125a0a830b5` |

Métricas Prometheus:

```json
{
  "database_available": [
    {
      "metric": {
        "__name__": "lab_db_available",
        "instance": "app:18080",
        "job": "observability-lab"
      },
      "value": 0
    }
  ],
  "database_errors_total": [
    {
      "metric": {
        "__name__": "lab_db_errors_total",
        "instance": "app:18080",
        "job": "observability-lab"
      },
      "value": 20
    }
  ],
  "process_up": [
    {
      "metric": {
        "__name__": "up",
        "instance": "app:18080",
        "job": "observability-lab"
      },
      "value": 1
    }
  ]
}
```

## Hipótese

A aplicação está viva e acessível, mas perdeu conexão com o MySQL de pedidos.
A causa provável pertence à camada de banco, não ao processo HTTP.

## Escalonamento simulado para DBA

```text
[SIMULAÇÃO] INC-20260608-230042-DBA
Severidade: alta
Início: 08/06/2026, 23:00:42
Host/serviço: APP-LAB-ORDERS / orders-api
Impacto: usuários não conseguem consultar ou criar pedidos.
Sintoma: /health/live=200; /health/ready=503; /health/db=503; /api/orders=503.
Evidências: Zabbix indica camada database e escalation=dba; lab_db_available=0.
Testes executados: processo, readiness, health do banco, API e métricas.
Hipótese: conexão da aplicação com o MySQL de pedidos indisponível.
Ação solicitada: validar instância business-db e conexões na porta 3306.
Contato: operador do Observability Lab.
```

## Atualizações registradas no Zabbix

- 08/06/2026, 23:00:48 — Fato: processo e endpoint HTTP permanecem ativos; /health/db e /api/orders retornam 503. Interpretação: falha isolada na dependência MySQL. Ação: escalonamento simulado para DBA com evidências.
- 08/06/2026, 23:00:44 — Triagem iniciada. Impacto em validação. Verificando função de negócio, processo e dependência MySQL.

## Recuperação

A ação simulada do DBA foi restaurar a disponibilidade da dependência no
controle do laboratório.

| Endpoint | HTTP | Duração |
|---|---:|---:|
| `/health/live` | 200 | 2 ms |
| `/health/ready` | 200 | 3 ms |
| `/health/db` | 200 | 2 ms |
| `/api/orders` | 200 | 3 ms |

O problema recuperou automaticamente no Zabbix. Não houve fechamento manual.

Métricas após recuperação:

```json
{
  "database_available": [
    {
      "metric": {
        "__name__": "lab_db_available",
        "instance": "app:18080",
        "job": "observability-lab"
      },
      "value": 1
    }
  ],
  "process_up": [
    {
      "metric": {
        "__name__": "up",
        "instance": "app:18080",
        "job": "observability-lab"
      },
      "value": 1
    }
  ]
}
```

## Comunicação

### Inicial

```text
[INCIDENTE EM ANÁLISE]
Início: 08/06/2026, 23:00:42
Serviço: orders-api
Impacto confirmado: consultas e criação de pedidos indisponíveis.
Alerta: Orders MySQL: dependência indisponível
Ações: validação de aplicação e dependência em andamento.
Responsável: Observabilidade Lab.
```

### Atualização

```text
[ATUALIZAÇÃO]
Estado: aplicação viva com dependência MySQL indisponível.
Evidências: live=200, ready=503, db=503, orders=503, lab_db_available=0.
Ação: escalonamento simulado para DBA.
Risco: indisponibilidade total do fluxo de pedidos.
```

### Encerramento

```text
[INCIDENTE RESOLVIDO]
Início: 08/06/2026, 23:00:42
Recuperação: 08/06/2026, 23:00:56
Impacto: consultas e criação de pedidos indisponíveis durante o exercício.
Causa: indisponibilidade controlada da conexão com o MySQL.
Validação: Zabbix recuperado e endpoints críticos em HTTP 200.
Pendência: manter correlação e runbook atualizados.
```

## Melhoria proposta

Manter a coleta do health check do banco em intervalo menor que os sintomas da
API e preservar a correlação por código HTTP, evitando múltiplos problemas
para uma única causa.
