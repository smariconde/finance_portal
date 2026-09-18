# Podar la historia fuera de la ventana

- Slice: `F2-05`, incremento 2, paso 3
- Decisión: [ADR 0019](../architecture/adr/0019-observation-history-prune.md); la
  ventana es la [ADR 0017](../architecture/adr/0017-sec-history-window.md)
- Runtime: personal local o protegido, con PostgreSQL y `SEC_USER_AGENT`

La poda **borra observaciones publicadas**, y eso no se deshace con un rollback: la
migración `0013` sólo revierte la auditoría. El backup es parte del procedimiento,
no una precaución opcional.

## Cuándo se corre

- Después de una ingesta con una selección anterior a la vigente, que trajo más
  historia de la que la ventana guarda hoy.
- Cuando el ancla de un filer avanzó un ejercicio —llegó un 10-K nuevo— y las filas
  del ejercicio que salió de la ventana siguen ahí.

No hay cadencia ni programación. Es una decisión del owner, y repetirla es inocua:
la segunda vez no encuentra nada y registra una fila con cero borradas.

## Procedimiento

### 1. Backup

```sh
mkdir -p ~/.local/share/finance-portal-backups
docker exec finance-portal-postgres-1 pg_dump -U "$POSTGRES_USER" \
  -d finance_portal_personal -Fc \
  > ~/.local/share/finance-portal-backups/personal-$(date +%Y%m%dT%H%M%S).dump
```

### 2. Refrescar el ancla

La poda no sale a la red y no recalcula el ancla: la lee de la última corrida de
companyfacts del sujeto que registró una. Un filer sin ancla vigente se rechaza.

```sh
pnpm fundamentals:ingest --ticker AAPL --apply
```

Son dos o tres requests por filer. Si no hay nada nuevo, la corrida queda
`duplicate` y publica cero; el ancla se registra igual. Un ticker arrastra sus
antecesores de reporte, así que `--ticker XOM` refresca también el CIK anterior.

Verificación:

```sql
select subject_key, selection_version, selection_anchor_on
from ingestion_runs
where dataset_id = 'sec.companyfacts' and selection_anchor_on is not null
order by subject_key;
```

### 3. Planear en seco

```sh
pnpm fundamentals:prune --ticker AAPL --ticker NVDA
```

Por cada sujeto informa el ancla y su corrida, los dos cortes, cuántas filas
borraría y cuántas conservaría, y el rango de lo que se iría. **El total a
conservar tiene que coincidir con las vintages que el paso 2 contó para ese
filer**: si no coincide, no podar y averiguar por qué.

Dos rechazos posibles, los dos con la misma salida —volver al paso 2—:

- `anchor_unknown`: el sujeto no tiene ninguna corrida con ancla registrada;
- `selection_superseded`: el ancla es de otra selección, que describe otra ventana.

### 4. Podar

```sh
pnpm fundamentals:prune --ticker AAPL --ticker NVDA \
  --reason "ventana sec-history-5fy-1.0.0" --apply
```

El motivo es obligatorio y queda en `observation_prunes` con el actor `owner`. Cada
sujeto se borra y se registra en una sola transacción.

### 5. Verificar

```sh
pnpm fundamentals:ingest --ticker AAPL --ticker NVDA --apply
```

Tiene que publicar **0** y duplicar exactamente las filas que quedaron: es la prueba
de que la poda borró el complemento de la ventana y nada más.

```sh
pnpm corporate-actions:splits --ticker AAPL --ticker NVDA
```

Tiene que dar `unchanged`. Un split registrado cuya evidencia quedó fuera de la
ventana aparece como `recorded_split_not_reconfirmed` y su ratio como
`precedes_published_history`: es lo esperado, no un error.

En la base, las cadenas de revisión tienen que seguir enteras:

```sql
select count(*) from (
  select revision_group_id from observations group by 1
  having count(*) <> max(revision_number)
) rotas;
select count(*) from (
  select revision_group_id from observations where superseded_at is null
  group by 1 having count(*) > 1
) vigentes_duplicadas;
```

Las dos tienen que dar cero. Un grupo de revisión es un hecho
`(concepto, unidad, inicio, fin)`: todas sus revisiones comparten `as_of` y la poda
se lo lleva entero o no lo toca.

### 6. Compactar (opcional)

Las filas borradas dejan espacio muerto hasta que autovacuum lo reutiliza. Para
medir el tamaño real:

```sh
docker exec finance-portal-postgres-1 psql -U "$POSTGRES_USER" \
  -d finance_portal_personal -c "vacuum (full, analyze) observations;"
```

`vacuum full` toma un lock exclusivo sobre la tabla. Con la base personal tarda un
instante; no correrlo con una ingesta en curso.

## Qué no toca

- **`source_documents`:** el evento de que una presentación se leyó sigue siendo
  cierto, y hay corporate actions que apuntan a documentos cuyas observaciones ya
  no están.
- **`corporate_actions`:** ningún split, sucesión ni evento de listing se borra ni
  se vuelve a juzgar.
- **`ingestion_runs`:** las corridas que publicaron las filas borradas se
  conservan; son la procedencia de las que quedaron.

## Registro

```sql
select r.subject_key, p.selection_anchor_on, p.periods_ending_before,
       p.deleted_count, p.kept_count, p.deleted_max_as_of, p.reason, p.executed_at
from observation_prunes p
join ingestion_runs r on r.run_id = p.anchor_run_id
order by p.executed_at desc;
```

Para un sujeto podado, esa fila —y no la corrida— explica una ausencia anterior a su
corte. El contrato point-in-time lo desarrolla.
