# Carga .env.local. Para hacer `source` desde los scripts de scripts/, no
# para ejecutar suelto. Deja definida RAIZ y exportado lo que traiga el
# archivo.
#
# POR QUE EXISTE
# Los comandos de base de datos necesitan credenciales que no se versionan,
# y desde el Codespace no valen los atajos del CLI: `--linked` y la conexion
# directa van a db.<ref>.supabase.co, que solo resuelve por IPv6, y alli no
# hay IPv6. Ver docs/PASO-A-PASO.md, seccion 3.4.

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTORNO="$RAIZ/.env.local"

if [[ ! -f "$ENTORNO" ]]; then
  cat >&2 <<FIN
ERROR: falta .env.local, que es de donde salen las credenciales.

No se versiona (lleva contrasenas dentro), asi que en un clon recien hecho
no esta. Para crearlo:

  cp .env.example .env.local

y rellenarlo con lo del dashboard. Detalle en docs/PASO-A-PASO.md, paso 3.
FIN
  exit 1
fi

# `set -a` exporta todo lo que defina el archivo; `set +a` corta el efecto
# justo despues, para no exportar de mas.
set -a
# shellcheck disable=SC1090
source "$ENTORNO"
set +a
