# ADR 0004: runtime personal-first y estado trabado

- Estado: aceptado
- Fecha: 2026-08-25
- Alcance: reemplaza el eje `demo | personal` de la [ADR 0002](0002-runtime-modes-persistence-exposure.md)
- Decisiones relacionadas: [ADR 0001](0001-stack-cache-postgres.md) y
  [matriz de uso de proveedores](../../data/provider-use-matrix.md)

## Contexto

La ADR 0002 definió dos modos con datos: `demo` servía fixtures deterministas a una
URL anónima y `personal` servía datos reales detrás de un límite privado. La
resolución caía a `demo` cuando `personal` no era demostrablemente seguro, de modo
que un entorno mal declarado seguía respondiendo con contenido sintético.

Ese diseño asumía que existiría una demo pública. El owner decidió que no: el
repositorio sigue siendo público como portfolio técnico, pero **la aplicación nunca
se va a desplegar con una URL anónima**, y los datos son de uso particular. Bajo ese
supuesto, `demo` dejó de ser una superficie de producto y pasó a ser trabajo que
compite con el objetivo real: conectar fuentes y valuar empresas de verdad.

Eliminar el modo sin más tendría un costo de seguridad concreto. El fallback existía
para que un deployment que no puede probar su privacidad no sirviera la base del
owner. Si se borra la rama, ese caso pasa a servir datos reales por omisión, y el
código es público: cualquiera puede desplegarlo, incluido el owner por accidente.

## Decisión

### El modo efectivo es `locked | personal`

- `personal`: el entorno probó ser privado —local fuera de Vercel, o Preview de
  Vercel con protección declarada— **y** tiene `DATABASE_URL` pooled. Es el único
  estado que sirve datos.
- `locked`: cualquier otra situación. No sirve datos, no abre PostgreSQL y no
  consulta proveedores.

`locked` es una negativa, no una demo. No tiene repositorio alternativo, conjunto de
datos de reemplazo ni versión reducida del producto.

### La conexión pooled entra en la definición de `personal`

Antes, `personal` sin `DATABASE_URL` era un modo degradado que prometía datos y
devolvía vacío. Ahora falta la base y el runtime queda trabado. Un modo que no puede
servir su contenido no es una versión con problemas de ese modo: es otro estado.

### El fallo es cerrado y se declara

Un `personal` que no se sostiene no degrada a datos sintéticos: se traba y muestra
qué variables faltan declarar, por nombre y nunca por valor (`TM-02`). El
diagnóstico de `/configuracion` es la única superficie que permanece disponible con
el runtime trabado, porque es la que permite salir del estado.

### Las fixtures dejan de ser producto y quedan como dobles de test

Los repositorios en memoria pasan de `demo-*` a `in-memory-*` y su discriminador de
`storage` de `demo-fixture` a `in-memory-fixture`. Ya no se construyen desde ninguna
raíz de composición: sólo los usan los tests, que por contrato corren sin red.

`selectPersonalDependency` no tiene rama alternativa a propósito. Agregar un estado
futuro obliga a decidir explícitamente si sirve datos, en vez de heredarlo por un
`else`, y `RuntimeLockedError` se lanza al componer la dependencia, no al atender el
request.

### La corrida de referencia sobrevive, con otro nombre y otro propósito

`/valuacion/demo` pasa a `/valuacion/referencia`. Deja de presentarse como demo del
producto y pasa a ser la verificación de que el motor reproduce el mismo resultado y
el mismo hash en esta instalación, más el lugar donde queda fijada la forma en que
se muestra la evidencia de una valuación. Queda detrás del guard de runtime aunque
su contenido sea sintético, porque un entorno trabado no sirve ninguna superficie de
datos.

## Consecuencias

### Aceptadas

- Ningún slice futuro invierte en datos ficticios como superficie de producto.
- Un deployment que no prueba su privacidad no sirve datos reales ni sintéticos.
- El estado inseguro es visible y accionable en vez de silencioso.
- La identidad de cache sigue incluyendo el modo, así que una entrada de un runtime
  trabado no puede servir contenido personal (`TM-04`).

### Costos

- La aplicación no tiene ninguna superficie con datos hasta que `F2-*` conecte
  fuentes reales; hasta entonces sólo hay shell, diagnóstico y corrida de referencia.
- Una URL pública deja de ser un destino soportado. Publicar una demo en el futuro
  exigiría una ADR nueva y un conjunto de datos aprobado para publicación.
- `TM-01` y `TM-13` se prueban ahora contra el estado trabado y no contra el
  aislamiento entre dos modos con datos; sus tests cambiaron de forma.

## Alternativas descartadas

- **Borrar la resolución de modos.** Menos código, pero un despliegue accidental del
  repositorio público serviría la base del owner sin red de contención.
- **Conservar `demo` como estaba.** Mantiene una superficie que nadie va a usar y
  obliga a construir dos veces cada vista futura.
- **Servir fixtures en el estado inseguro.** Es el diseño anterior: hace que un
  entorno mal declarado parezca funcionar, que es exactamente cómo se pasa por alto
  una configuración equivocada.
