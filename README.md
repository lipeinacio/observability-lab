# Observability Lab

Projeto de portfólio para demonstrar monitoramento, observabilidade e resposta
a incidentes em uma aplicação com falhas controladas.

## O que está funcionando

- aplicação HTTP com painel visual;
- API de pedidos persistida em um MySQL de negócio separado;
- liveness e readiness separados;
- injeção de indisponibilidade, erro HTTP, erro SQL e latência;
- logs estruturados em JSON com `request_id`;
- logs centralizados no Loki e coletados pelo Grafana Alloy;
- métricas Prometheus da aplicação e do banco;
- métricas de CPU, memória, disco e rede do host com Node Exporter;
- sondas HTTP externas à aplicação com Blackbox Exporter;
- regras Prometheus e roteamento de alertas pelo Alertmanager;
- webhook local com histórico e suporte opcional ao Telegram;
- MySQL para persistência do Zabbix;
- Zabbix Server 7.0 LTS e interface web;
- Zabbix Agent 2 com CPU e memória;
- monitoramento HTTP com triggers;
- problemas com tags de serviço, camada, impacto e torre de escalonamento;
- correlação entre causa e sintomas para reduzir ruído no painel;
- alvo SNMP v2c com coleta de OIDs;
- Grafana com Prometheus e plugin Zabbix;
- dashboard provisionado automaticamente;
- teste automatizado de alerta e recuperação.

## Arquitetura

```mermaid
flowchart LR
    U[Operador] --> APP[Painel da aplicação]
    APP --> API[Serviço HTTP]
    API --> BDB[(MySQL de pedidos)]
    Z[Zabbix Server] -->|HTTP checks| API
    Z -->|Agent protocol| AG[Zabbix Agent 2]
    Z -->|SNMP v2c| SNMP[Alvo SNMP]
    Z --> DB[(MySQL)]
    P[Prometheus] -->|scrape /metrics| API
    P -->|host metrics| NE[Node Exporter]
    P -->|HTTP probe| BB[Blackbox Exporter]
    BB --> API
    P -->|alerts| AM[Alertmanager]
    AM --> WH[Webhook de notificações]
    WH -.->|opcional| TG[Telegram]
    API -->|stdout JSON| A[Grafana Alloy]
    A --> L[Loki]
    G[Grafana] --> P
    G --> L
    G --> ZW[Zabbix API]
    Z --> ZW[Zabbix Web]
```

## Iniciar

```bash
make up
```

Na primeira execução, aguarde a inicialização do MySQL e do Zabbix. O
container `zabbix-bootstrap` configura hosts, itens, cenários web e triggers.

## Interfaces

| Interface | URL | Credenciais |
|---|---|---|
| Centro de controle | http://localhost:18080 | sem login |
| Zabbix | http://localhost:8080 | `Admin` / `zabbix` |
| Grafana | http://localhost:3000 | `admin` / valor de `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | http://localhost:9090 | sem login |
| Alertmanager | http://localhost:9093 | sem login |
| Histórico de notificações | http://localhost:18082 | sem login |
| Loki API | http://localhost:3100 | sem login |
| Alloy | http://localhost:12345 | sem login |

As senhas deste laboratório são locais e demonstrativas. O arquivo `.env` não
deve ser versionado.

Para habilitar Telegram, adicione somente no `.env` local:

```dotenv
TELEGRAM_BOT_TOKEN=token_fornecido_pelo_botfather
TELEGRAM_CHAT_ID=identificador_do_chat
```

Depois recrie o webhook:

```bash
docker compose up -d --build alert-webhook
```

## Demonstração visual

1. Abra o centro de controle.
2. Abra `Monitoring > Problems` no Zabbix.
3. No centro de controle, selecione um modo de falha.
4. Aguarde o intervalo de coleta do Zabbix.
5. Leia host, problema, severidade, tags e dados operacionais.
6. Reconheça o problema e registre o início da triagem.
7. Abra o runbook pelo link do problema.
8. Use Latest data, Grafana e logs para confirmar a camada provável.
9. Trate ou simule o escalonamento para a torre indicada pela tag.
10. Clique em `Restaurar` e valide a função de negócio.
11. Mostre o evento de recuperação e registre o encerramento.

Runbook de operação:
[`runbooks/OPERAR_PROBLEMA_NO_ZABBIX.md`](runbooks/OPERAR_PROBLEMA_NO_ZABBIX.md).

### Hosts no Zabbix

| Nome visível | Coleta | Papel |
|---|---|---|
| `APP-LAB-ORDERS` | cenários HTTP | aplicação, API e dependência MySQL |
| `SRV-LAB-LINUX` | Agent 2 | CPU e memória do servidor |
| `NET-LAB-SNMP` | SNMP v2c | equipamento de rede simulado |

As chaves técnicas dos hosts permanecem estáveis para preservar expressões e
histórico.

### Cenários

| Modo | Efeito | Alerta esperado |
|---|---|---|
| `unhealthy` | readiness retorna 503 | aplicação indisponível |
| `error` | `/work` retorna 500 | operação principal com erro |
| `slow` | `/work` atrasa 3 segundos | operação principal acima de 2 segundos |
| `db-unavailable` | conexão ao MySQL é recusada | banco de negócio indisponível |
| `db-error` | consulta SQL inválida | API de pedidos com erro |
| `db-slow` | consulta leva 3 segundos | consulta ao banco acima de 2 segundos |
| `healthy` | restaura o comportamento | trigger normalizada |

## Fluxo de negócio

Crie um pedido pelo formulário do centro de controle ou pela API:

```bash
curl -i -X POST http://127.0.0.1:18080/api/orders \
  -H 'content-type: application/json' \
  -d '{"customer_name":"Empresa Demo","description":"Monitoramento do ambiente"}'

curl -i http://127.0.0.1:18080/api/orders
```

O MySQL de pedidos é uma dependência real da aplicação. Por isso:

- `/health/live` prova apenas que o processo está vivo;
- `/health/db` testa a dependência MySQL;
- `/health/ready` informa se a aplicação está pronta para atender;
- `/api/orders` mostra o impacto real para o usuário.

## Testes

Teste da aplicação:

```bash
make test
```

Teste completo dos incidentes:

```bash
make incidents
```

O teste ativa cada falha, espera a trigger do Zabbix e confirma a recuperação.

Exercício operacional com reconhecimento, evidências e escalonamento simulado
para DBA:

```bash
make dba-drill
```

O relatório é salvo em `incidents/generated/`. Consulte
[`incidents/README.md`](incidents/README.md).

Runbook do incidente de banco:
[`runbooks/BANCO_DE_PEDIDOS_INDISPONIVEL.md`](runbooks/BANCO_DE_PEDIDOS_INDISPONIVEL.md).

Teste de correlação dos logs:

```bash
make logs-test
```

O teste provoca um erro SQL, captura o `x-request-id` da resposta e consulta o
Loki até encontrar os logs de erro e conclusão da mesma requisição.

Consulta equivalente no Grafana Explore:

```logql
{compose_service="app"} | json | request_id="ID_DA_REQUISICAO"
```

Runbook de correlação:
[`runbooks/CORRELACIONAR_ERRO_POR_REQUEST_ID.md`](runbooks/CORRELACIONAR_ERRO_POR_REQUEST_ID.md).

Teste de notificação e recuperação:

```bash
make alerts-test
```

O teste força a indisponibilidade do banco, espera `FIRING`, restaura o
serviço e confirma `RESOLVED`. Sem credenciais do Telegram, a mensagem continua
visível no histórico local.

Teste das métricas de infraestrutura e da sonda de rede:

```bash
make infrastructure-test
```

Para simular indisponibilidade de rede:

```bash
docker compose stop app
# observe probe_success=0 e o alerta ApplicationNetworkProbeFailed
docker compose start app
make infrastructure-test
```

Runbook:
[`runbooks/APLICACAO_INACESSIVEL_PELA_REDE.md`](runbooks/APLICACAO_INACESSIVEL_PELA_REDE.md).

Verificação de itens e problemas:

```bash
make verify
```

Consulta SNMP direta:

```bash
docker compose exec snmp-target \
  snmpget -v2c -c observability 127.0.0.1:1161 \
  1.3.6.1.2.1.1.5.0
```

## Operação

```bash
make status
make logs
make down
```

Os volumes preservam banco, histórico do Prometheus e dashboards do Grafana.

## Evidência de aceitação

Em 7 e 9 de junho de 2026, os seguintes testes passaram:

- Agent 2 retornou carga de CPU e memória disponível;
- SNMP retornou `sysName=lab-snmp-target` e uptime;
- Prometheus retornou `up=1` para a aplicação;
- Grafana provisionou Prometheus, Zabbix e o dashboard;
- Zabbix abriu e recuperou alertas para indisponibilidade, HTTP 500 e latência.
- API criou e listou pedidos no MySQL de negócio;
- Zabbix abriu e recuperou alertas para banco indisponível, erro SQL e consulta lenta.
- Zabbix diferenciou readiness, HTTP 500, banco indisponível, erro SQL,
  lentidão e endpoint inacessível sem exibir sintomas redundantes;
- Loki correlacionou o erro SQL e o HTTP 500 pelo mesmo `request_id`.
- Alertmanager enviou notificações `FIRING` e `RESOLVED` ao webhook local.
- Telegram recebeu notificações reais de abertura e recuperação.
- Node Exporter expôs CPU, memória, filesystem e rede do host;
- Blackbox Exporter detectou a parada da aplicação com `probe_success=0`;
- `ApplicationNetworkProbeFailed` abriu e recuperou após reiniciar a aplicação;
- webhook e Telegram receberam a abertura e a resolução do incidente de rede.
