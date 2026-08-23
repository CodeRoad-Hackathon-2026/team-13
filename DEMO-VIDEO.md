# Video demo — AI Incident Response Orchestrator (3:00)

Guion verificado corriendo el stack completo el 2026-08-21. Cada número que
aparece abajo salió de la app, no del PRD.

Los tres repos participan: `Incident-tracker-ui` (lo que se ve), `CR-INC-Backend`
(los agentes), `rag-core` / RAG Core (la evidencia). El video no los nombra: los
muestra trabajando juntos.

---

## 0 · Preparación (antes de grabar)

```bash
cd "Hackaton _ 2026/CR-INC-Backend"

# Estado limpio y reproducible
docker compose down -v && docker compose up -d --build   # ~2 min la primera vez

# El corpus del RAG arranca VACÍO. Sin esto los agentes se abstienen de todo
# y la demo no muestra nada. Es el paso que más fácil se olvida.
docker compose run --rm orchestrator python -m app.corpus   # → 10 of 10 documents ingested
```

Los 10 incluyen `db/seeds/004_code_change_runbooks.sql` — dos runbooks escritos
para que el Decision Agent devuelva un **diff fundamentado** en vez de inventado:
traen el repo como `org/repo`, el archivo con números de línea y los valores viejo
y nuevo. Ese seed corre solo con `docker compose up`; lo único manual es el
`app.corpus` de arriba, porque RAG Core no ve una fila de `knowledge_documents`
hasta que se le ingesta.

Checklist de navegador, en este orden:

1. `http://localhost:8900` — ventana a **1440×900**, zoom 100%.
2. **Fijar el nombre del operador antes de grabar.** El icono de persona arriba a
   la derecha. Si no, el primer *Approve* / *Reject* abre un modal
   "What's your name?" en medio del clímax. (Se guarda en `localStorage`, clave
   `incident-tracker:operator-name`.)
3. **La pestaña tiene que estar enfocada y visible durante toda la grabación.**
   TanStack Query pausa el `refetchInterval` cuando el documento está oculto: con
   la pestaña en segundo plano la tarjeta se queda en `Executing · 1m 40s` para
   siempre aunque el backend ya terminó. Lo reproduje.
4. Terminal a la vista en un split (para el `curl` del beat 2). Fondo oscuro,
   fuente grande.
5. Rango de tiempo en **7d**, entorno **Production**.

Estado inicial esperado: `1 P1 active · 3 awaiting approval`, 8 incidentes
abiertos, 3 tarjetas en la cola.

---

## 1 · 0:00 → 0:18 — El problema (18s)

**Pantalla:** `http://localhost:8900/?tab=now`, sin scroll. Se ve la franja de
alerta y las tarjetas de aprobación.

**Narración:**
> A las 3 de la mañana, quien está de guardia no necesita otro dashboard con
> gráficas. Necesita saber qué pasó, qué se hizo antes, y qué hacer ahora —
> con la fuente al lado. Esto es un orquestador de incidentes donde los agentes
> proponen y la persona decide.

**Acción:** el cursor pasa por la franja roja. `1 P1 active · 3 awaiting
approval · oldest pending 3306m`. Nada más. No hagas scroll todavía.

---

## 2 · 0:18 → 0:50 — Entra una alerta de verdad (32s)

**Acción:** en la terminal, un webhook de PagerDuty:

```bash
curl -X POST localhost:8901/api/incidents/ingest \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"LIVE-9001",
       "subject":"checkout-web 5xx spike with ERR_UPSTREAM_TIMEOUT on /checkout",
       "body":"5xx rate on /checkout is above 5% and p99 latency is past 3 seconds. The logs are full of ERR_UPSTREAM_TIMEOUT against payments-api. Workers look starved.",
       "source":"pagerduty","environment":"prod"}'
```

Devuelve al instante: `{"incidentId":"…","created":true,"status":"triaging"}`.

Este texto está elegido, no improvisado: repite el vocabulario de Runbook #58
(`ERR_UPSTREAM_TIMEOUT`, `/checkout`, workers starved) y por eso el retrieval lo
puntúa **0.82**, muy por encima del umbral. Un texto parecido pero sin esas
palabras se queda en 0.42 y el agente se abstiene — lo probé.

**El pipeline real tarda ~13 s.** Está medido: Intake 0 ms → Classification
6.7 s → RAG Retrieval 0.6 s → Decision 5.4 s. No lo cortes en edición: úsalo
para narrar la arquitectura mientras corre.

**Narración (durante esos 13s):**
> La API responde 202 y suelta la conexión: un sistema de alertas que espera 20
> segundos reintenta, y un reintento serían dos incidentes para la misma alerta.
> Mientras tanto corren cuatro agentes. Ninguno habla con el modelo directamente:
> todos pasan por RAG Core, que busca en los runbooks y postmortems de la empresa
> y se niega a responder si el corpus no lo respalda.

**Acción:** volver al navegador, click en la fila nueva de la tabla `Incidents`
(la primera, `checkout-web 5xx spike…`, edad `1m`). Abre el drawer lateral.

**Qué señalar, en este orden:**
- `AI classification` — categoría / `P1` / confianza `0.65`
- **`Agent run trace`**: los 4 agentes con su latencia y confianza. Expande
  `RAG Retrieval Agent v1` → sale el JSON de entrada y salida real.
- `Event timeline` más abajo: recibido, clasificado,
  `8 of 8 results linked to known documents · best match 0.82`,
  `Runbook #58 — checkout-web upstream timeout cascade matched at 0.82 — marked
  as a known incident`, y `GITHUB_PR proposed · risk LOW`.

**Narración:**
> Cada paso quedó registrado con su entrada, su salida y su latencia. No es un
> resumen que escribió el agente sobre sí mismo: es la traza.

---

## 3 · 0:50 → 1:20 — La recomendación, con la evidencia al lado (30s)

**Acción:** en el drawer, subir hasta `Recommended actions`. La tarjeta nueva.

**Qué señalar:**
1. Pestaña **`Proposed change`** → el diff real, con números de línea:
   `example/checkout-web / remediate/upstream-timeout-cascade`,
   `1 file +2 −2`, sobre `config/http_clients.yml`:

   ```
     payments_api:
   14 −   read_timeout_seconds: 30
   15 −   max_retries: 3
   14 +   read_timeout_seconds: 5
   15 +   max_retries: 1
   ```

   Dos líneas rojas y dos verdes: **reemplaza**, no añade. Y hay `Copy diff`.
2. Pestaña **`Evidence 3`** → las fuentes con su score y `View source`:
   Runbook #58 `0.82`, Runbook de pool exhaustion `0.56`, Runbook #61 `0.45`.
3. `CONFIDENCE 0.71`, en verde y sin aviso — la barra naranja de
   "Low confidence" solo sale por debajo del umbral.

**Narración:**
> Propone un cambio de configuración concreto, en una rama nombrada, contra tres
> documentos con su relevancia. Y se declara poco confiado: 0.59. El sistema no
> vende certeza que no tiene.

**No abras la pestaña `Pre-flight`** — hoy dice "Not yet available: the
approvals API does not carry pre-flight checks for an action". Verificado.

---

## 4 · 1:20 → 1:40 — Cuando no sabe, no inventa (20s)

**Acción:** segundo `curl`, o mejor: dispararlo en la preparación y aquí solo
mostrar el resultado (así no gastas 20s de video esperando).

```bash
curl -X POST localhost:8901/api/incidents/ingest \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"LIVE-9002",
       "subject":"Split-tender totals off by one cent",
       "body":"Rounding drifts when a payment is split across two tenders. No runbook covers this.",
       "source":"email","environment":"prod"}'
```

**Acción:** cerrar el drawer, click en la fila `Split-tender totals off by one
cent`.

**Qué señalar:** en la tabla, esa fila tiene `SERVICE` vacío, `CATEGORY` vacío,
`KNOWN —`, `AI CONF. 0.25`, `AUTO —`. En el drawer, `Event timeline`:
`RAG_SEARCH_COMPLETED · best match 0.25` y después
**`No remediation proposed — below_confidence_threshold`**.

**Narración:**
> Ningún runbook cubre esto. El mejor match es 0.25, por debajo del umbral, y el
> agente no propone nada. No es un error: es un 200 que dice "no sé". Un
> procedimiento equivocado a las 3am cuesta más que ninguno.

Esta rama tarda 2.3 s, no 19: se abstiene antes de gastar las llamadas caras.

---

## 5 · 1:40 → 2:00 — El operador decide, y eso enseña (20s)

**Acción:** volver a la cola. En la tarjeta de **LIVE-9001** → `Reject`.

Aparece el formulario en línea: `Reason *` (obligatorio), `Corrected category`,
`Corrected priority`. Escribe algo real:

> `320 no alcanza si pgbouncer está saturado. Revisar cl_waiting antes de subir el techo.`

`Submit rejection`. La tarjeta desaparece; **las tarjetas hermanas no se mueven**.

**Narración:**
> Un rechazo es la señal más informativa que produce este sistema: una persona
> mirando evidencia dijo que no. Va de vuelta a RAG Core con rating −1, y el
> ranking híbrido lleva un componente de feedback — los documentos detrás de una
> mala recomendación bajan la próxima vez.

**Importante — rechaza la tarjeta LIVE-9001, no las de fixture.** Las tres
tarjetas sembradas no tienen `query_log_id`, así que el envío a RAG Core se salta
con `no query_log_id for action …; skipping RAG feedback`. Lo verifiqué. Solo las
acciones generadas en vivo cierran el círculo.

*Alternativa si prefieres mostrar el camino de aprobación:* la tarjeta
`HIGH RISK` de inventory-service abre un modal de segunda confirmación
("This is a HIGH-risk action. Please confirm:") y el botón se deshabilita al
primer clic — una Lambda de remediación disparada dos veces es una caída real.
Pero **en este stack ninguna aprobación termina en SUCCESS** (ver §8): la
ejecución acaba en `FAILED` con el motivo de la barrera. Solo úsalo si narras
esa barrera como la función que es.

---

## 6 · 2:00 → 2:25 — Dónde está el cuello de botella (25s)

**Acción:** pestaña `Performance`.

**Qué señalar:**
- Tiles: `AUTOMATION RATE 8%` · `MEDIAN TIME TO RESOLVE 52m` ·
  `KNOWN-INCIDENT HIT RATE 69%`. Mediana, no promedio — el promedio va en el
  tooltip.
- `Automation funnel` con la caída anotada arriba:
  **`Largest drop: Approved / auto-run → Executed successfully, −4. See the
  Knowledge tab for the likely fix.`**
- `Execution outcomes`: donut con `SUCCESS 3 · FAILED 4 · ROLLED BACK 1 ·
  RUNNING 0`. **ROLLED BACK es su propio bucket** — no es éxito ni fallo.
- `RECENT FAILURES` con el motivo textual de cada uno y `Open incident`.

**Acción:** click en la etapa **`RAG match found`** del funnel.

Salta a `Now`, aparece el toast `Jumped to Now — reached classified by ai but not
rag match found`, un chip azul `Reached Classified by AI but not RAG match found ×`
y la tabla queda en 3 filas. El filtro queda en la URL.

**Narración:**
> Un clic en la etapa donde se pierde la automatización te deja en la lista
> concreta de incidentes que se cayeron ahí. El filtro vive en la URL: se pega
> en un canal y el otro ve lo mismo.

---

## 7 · 2:25 → 2:50 — El sistema se documenta a sí mismo (25s)

**Acción:** pestaña `Knowledge`.

**Qué señalar:**
- La frase de arriba: **`Fixing checkout-web would move the funnel more than any
  model change.`**
- `Runbook coverage gaps`: checkout-web 50% RED, inventory-service 50% RED,
  search-index 50% RED, auth-gateway/notify-worker/payments-api 100% GREEN. El
  color nunca es la única señal: cada barra lleva la etiqueta RED/GREEN.
- Scroll a **`Documentation candidates`**: ahí está
  **`LIVE-9002 · Split-tender totals off by one cent · NO RAG MATCH FOUND`**.

**Narración:**
> El incidente que el sistema no supo resolver no se perdió: está aquí, como el
> runbook que falta. La abstención de hace un minuto se convirtió en trabajo
> asignable. Y la recomendación no es "mejor modelo": es escribir el runbook de
> checkout-web.

Este es el mejor cierre que tiene la app — el círculo se cierra en pantalla.

---

## 8 · 2:50 → 3:00 — Cierre (10s)

**Pantalla:** el diagrama de `CR-INC-Backend/README.md`, o vuelta a `Now`.

> Tres servicios: el dashboard nunca ve la clave del RAG, el orquestador nunca
> orquesta al modelo sin evidencia, y RAG Core se niega a responder lo que su
> corpus no respalda. Los agentes proponen. La persona decide. Todo queda
> trazado.

---

## Verificado / no verificado

Corrí el flujo completo contra el stack real. Funciona:

| Beat | Resultado medido |
|---|---|
| Ingesta en vivo | 13 s de punta a punta, 4 agentes en SUCCESS |
| Clasificación | P1, confianza 0.65 |
| Retrieval | 8 hits, 8 enlazados, mejor **0.82**, marcado como known incident |
| Decision | `GITHUB_PR` risk LOW, confianza 0.71, diff de 1 archivo |
| Diff en la tarjeta | `config/http_clients.yml` líneas 14-15, `+2 −2`, rama `remediate/upstream-timeout-cascade` |
| Evidencia | 3 fuentes con score y `View source` |
| Abstención | 2.3 s, `below_confidence_threshold`, 0 acciones propuestas |
| Rechazo | fila en `developer_feedback` + acción REJECTED, hermanas intactas |
| Salto cross-tab | toast + chip + filtro en URL + tabla filtrada |
| Candidato a documentación | LIVE-9002 aparece con `NO RAG MATCH FOUND` |
| Traza de agente | JSON de entrada/salida real por agente |
| Timeline | eventos con `+0s / +8s / +10s` |

**Cosas que NO uses en cámara — las probé y no están presentables:**

1. **`Pre-flight`** en cualquier tarjeta: "Not yet available. The approvals API
   does not carry pre-flight checks for an action."
2. **Aprobar y esperar un SUCCESS verde.** Ninguna ruta termina en verde en este
   stack — pero con los runbooks de `004` el motivo del fallo pasó de ser un bug
   a ser una frase presentable. Antes, con el repo escrito como `payments-api`:
   `'payments-api' is not an org/repo URL`. Ahora, con `example/checkout-web`:
   **`no repository is allowed for delivery; add one to
   CHANGE_DELIVERY_ALLOWED_REPOS before this action can run`** — que es la
   barrera funcionando, y se narra sola. Las otras rutas siguen sin poder salir
   en verde: `API` cae en `host 'cdn.example.com' is not in
   EXECUTION_ALLOWED_HOSTS`, y `LAMBDA`/`SQL` en `no executor is registered for
   LAMBDA` (solo `API` y `WEBHOOK` tienen tool). Los 3 SUCCESS del donut son
   fixtures, no ejecuciones nuevas.

   Si quieres un SUCCESS de verdad en cámara, el camino existe pero hay que
   montarlo: `parse_repo` acepta un remoto `file://`, así que un repo bare local
   con `config/http_clients.yml` en las líneas que dice el runbook, su slug en
   `CHANGE_DELIVERY_ALLOWED_REPOS` y `services.repository_url` apuntando ahí,
   haría que el Change Delivery Agent clone, aplique el parche y commitee de
   verdad. `compare_url` sería `None` (no es github.com) y el push sigue apagado.
3. **`make justify`** (el bloque de evidencia para el PR). Corre, pero hoy
   imprime el prompt completo como título de sección y el juez de groundedness
   dictamina `ungrounded (0.00)` sobre la clasificación, con una lista de
   "claims the passages did not support". Es honesto y es la idea correcta, pero
   en cámara se lee como si el sistema hubiera alucinado.
4. **La UI propia de RAG Core** (`localhost:8902`): pide pegar la API key y un
   incident id antes de habilitar `Ask`. Además `RERANK_ENABLED=false`, así que
   una de las cuatro barras del breakdown sale vacía — justo el síntoma que
   `HACKATHON.md` enseña a leer como fallo silencioso. Si la quieres de cameo,
   pega la key y haz una búsqueda de prueba antes de grabar.

**Inconsistencias cosméticas que quizá quieras arreglar antes:**
- El toast del salto cross-tab baja a minúsculas la etiqueta: "reached
  classified by ai but not rag match found".
- El drawer se enlaza como `/?incident=<id>` sin `tab=now`, y los botones
  `Assign to me` / `Escalate` / `Mark resolved` están deshabilitados
  ("Incident updates are not available yet").
- La franja de alerta tarda hasta 30 s en reflejar un rechazo (cadencia propia,
  por diseño). Si grabas seguido, se ve un `3 awaiting approval` desactualizado.

---

## Plan B durante la grabación

| Si pasa esto | Haz esto |
|---|---|
| La tarjeta se queda en `Executing · Ns` | Perdiste el foco de la pestaña. A los 2 min sale el botón `Check now`: un clic y resuelve. |
| El pipeline tarda más de 30 s | Es la llamada al modelo. Sigue narrando la arquitectura; nunca falló en mis corridas. |
| La ingesta devuelve `created: false` | Ya existe ese `external_id`. Cambia a `LIVE-9003` — la deduplicación por fuente+id es intencional. |
| Todo se abstiene, todo sale `—` | El corpus está vacío. `docker compose run --rm orchestrator python -m app.corpus`. |
| Quedó estado sucio de un ensayo | `docker compose down -v && docker compose up -d` y vuelve a sembrar el corpus. |
