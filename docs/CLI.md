# CLI local `gorila`

La CLI funciona con Node 24 y las dependencias del checkout, sin iniciar Next.js.
Comparte wallets, seeds, labels, fuentes y SQLite con la web. No usa BDK ni RPC.

## Instalación

Desde `gorila-wallet`, en la rama `add-cli-tool`:

```sh
nvm use
corepack enable
pnpm install
pnpm link --global
gorila --help
```

Si pnpm todavía no tiene directorio global, ejecutar `pnpm setup` y abrir una
terminal nueva. También se puede ejecutar `node bin/gorila.mjs` desde el checkout.
El enlace necesita conservar el checkout y sus dependencias. No publica el paquete.

El launcher encuentra el proyecto mediante su propia ruta, carga los archivos
`.env` con el mismo cargador de Next.js y aplica las migraciones aditivas antes de
ejecutar comandos. No inicia el servidor web. Las rutas relativas de SQLite se
resuelven desde el proyecto; los archivos de secretos se resuelven desde el
directorio donde se invocó `gorila`.

`DATABASE_URL` conserva su prioridad sobre `.env`. Para compartir una base del
desktop o de otro checkout, indicar la misma ruta absoluta, por ejemplo
`DATABASE_URL=file:/ruta/wallet.db gorila wallet list`.

## Opciones comunes

`--wallet ID_OR_NAME` selecciona una wallet. Con una sola se elige automáticamente;
con varias es obligatorio identificarla. Los nombres duplicados se rechazan y se
puede usar el ID. `--json` escribe un único resultado JSON en stdout; prompts,
revisión del envío y errores van a stderr. Los errores tienen código de salida 1.
La salida normal usa texto con nombres de campos.

`--timeout SECONDS` limita la espera de sincronización (120 segundos por defecto).
Cada consulta abre una sesión para las wallets y cadenas solicitadas, espera
descubrimiento e historial frescos y cierra conexiones y timers al terminar. No
cambia la red elegida en la web. `receive` y `addresses` sincronizan BTC y XBT para
considerar el uso compartido de direcciones. La CLI opera sobre la familia mainnet.

## Wallets y secretos

```sh
gorila wallet list
gorila wallet create --name ahorro                 # 24 palabras por defecto
gorila wallet create --name gastos --words 12
gorila wallet import --name recuperada             # prompt oculto para las palabras
gorila wallet import --name recuperada --seed-file ./seed.txt
gorila wallet export-seed --wallet ahorro
gorila wallet export-seed --wallet ahorro --include-passphrase
gorila wallet descriptor --wallet ahorro
```

La creación devuelve las nuevas palabras para permitir su respaldo. La importación
acepta exactamente 12 o 24 palabras BIP39 en inglés, con checksum válido.
Las wallets usan P2WPKH BIP84, cuenta `m/84'/0'/0'`, recepción `/0/i` y cambio `/1/i`.

La contraseña de cifrado es opcional, como en la web: en una terminal se solicita
oculta y puede dejarse vacía. En automatización, omitirla crea una wallet sin
contraseña. `--password-file FILE` permite suministrarla explícitamente; las
contraseñas no vacías necesitan al menos 8 caracteres. Exportar o firmar una wallet
cifrada exige la contraseña, mediante prompt oculto o archivo.

La passphrase BIP39 deriva otra wallet y es distinta de la contraseña de cifrado.
`--passphrase` la pide mediante prompt oculto; `--passphrase-file FILE` la lee de
un archivo al crear o importar. La exportación solo incluye la passphrase con
`--include-passphrase`. Se elimina un salto de línea final de los archivos de
secretos. Ningún secreto se acepta como valor directo de un argumento.

Sin terminal, faltar un secreto obligatorio produce error. Las wallets watch-only
existentes pueden consultar, recibir y exportar descriptores, pero no exportar
seed ni firmar. Los descriptores públicos `wpkh` incluyen checksum, origen con
fingerprint, ruta y xpub, para recepción y cambio; no contienen claves privadas.

## Direcciones y labels

```sh
gorila receive --wallet ahorro --label "factura 123"
gorila receive --wallet ahorro
gorila receive --wallet ahorro --next
gorila addresses --wallet ahorro
gorila address label bc1q... "cliente" --wallet ahorro
```

`receive` mantiene un cursor persistente por wallet y familia. Repite la dirección
actual hasta que tenga historial en BTC o XBT; `--next` avanza manualmente. Los
saltos no marcan direcciones como usadas. El descubrimiento incluye las direcciones
saltadas y extiende el gap más allá del cursor. Los avances simultáneos de procesos
se serializan mediante una transacción de SQLite.

`addresses` muestra recepción y cambio, índice, label, uso y conteo de txids
distintos por cadena. Los labels de dirección se guardan con ámbito compartido
`all`, visible en BTC y XBT. `address label` exige una dirección ya derivada para
esa wallet; se puede ejecutar `addresses` para descubrirla.

## Balances, historial y estado

```sh
gorila balance --wallet ahorro --chain all
gorila balance --chain btc --all-wallets --json
gorila transactions --wallet ahorro --chain xbt
gorila tx-status TXID --wallet ahorro --chain btc
```

Los balances muestran confirmado, pendiente y total en satoshis por wallet y
moneda. BTC y XBT nunca se suman entre sí. `balance` usa `all` por defecto;
`transactions`, `tx-status` y `send` exigen `--chain btc|xbt`.

El historial muestra txid, importe neto, fecha y confirmaciones. `tx-status`
consulta primero el historial fresco de la wallet; para txids externos usa las
fuentes mempool configuradas, incluido el tip para calcular confirmaciones.
`found: false` indica respuesta 404; si ninguna fuente pudo responder, devuelve
un error de servidor inaccesible. Sin wallets también se puede consultar un txid
externo.

## Fuentes compartidas

```sh
gorila config show
gorila config set --chain btc \
  --electrum ssl://electrum.example.org:50002 \
  --electrum tcp://fulcrum.example.org:50001 \
  --mempool https://mempool.example.org
gorila config set --chain xbt \
  --electrum ssl://blake.example.org:50002 \
  --mempool https://blake-explorer.example.org
```

Las opciones repetidas conservan el orden de failover. Se usan las mismas
validaciones de la web: hasta 10 URLs por lista, Electrum `tcp://`, `ssl://` o
`tls://host:port`, mempool HTTP(S). Electrs y Fulcrum se configuran como servidores
Electrum. Si se omite una lista, se conserva. `config show` muestra URLs efectivas
y procedencia: Settings, `.env/environment` o defaults. Prioridad: Settings →
variables de entorno/`.env` → defaults. Estos cambios son visibles en la web.
Recargar la web inicia una sesión que lee los cambios realizados por otro proceso.

## Enviar

```sh
gorila send --wallet ahorro --chain btc --to bc1q... --amount-sats 15000 \
  --message "factura 123" --fee-rate 2
gorila send --wallet ahorro --chain xbt --to bc1q... --amount-sats 15000 \
  --fee-rate 2 --password-file ./password.txt --yes --json
```

`--amount-sats` exige un entero positivo; `--fee-rate` se expresa en sat/vB.
Sin tarifa explícita se usa la estimación de una hora. Si las fuentes no ofrecen
estimaciones, se exige `--fee-rate`. La tarifa debe estar entre 1 y 1000 sat/vB y
no ser inferior al mínimo informado por la red.

La selección de monedas excluye outputs congelados. Se construye una PSBT con
el núcleo compartido y se muestra en stderr la revisión completa: inputs,
destino, cambio, comisión, tamaño y script OP_RETURN. Solo después se solicita
confirmación y contraseña para firmar y publicar. Escribir algo distinto de
`yes`, o cancelar, termina sin publicar; sin terminal se exige `--yes`.

BTC incluye siempre el OP_RETURN de protección, con el mensaje UTF-8 opcional y
relleno hasta el tamaño mínimo. XBT rechaza `--message` y firma con
`SIGHASH_UNIFIED` (`0x21`). Los servicios compartidos verifican claves, prevouts,
outputs, monedas congeladas y límites de comisión; web y CLI aplican las mismas
validaciones de publicación normal. Un rechazo de la red se devuelve como error.

## Verificación

```sh
pnpm check
pnpm check:cli
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm build
```

`check:cli` usa bases aisladas y servidores TCP/HTTP simulados. Verifica seeds,
descriptores, cursores, sincronización fresca, failover, cierre, comandos reales
desde otro directorio y firma/publicación BTC/XBT. No publica transacciones en
redes reales ni envía fondos.
