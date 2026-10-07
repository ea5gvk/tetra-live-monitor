#!/usr/bin/env bash
# Reserva los núcleos 2-3 de la Raspberry Pi para la estación TETRA (flowstation-tea2, flowstation,
# miurastation, BlueStation/tmo) y deja el resto del sistema en los núcleos 0-1. El trabajo en la Pi junto a la
# estación (comprobaciones de actualización, compilaciones, instalaciones) hacía que las radios
# soltasen la celda (26-09-2026).
#
# Idempotente: si ya está aplicada no toca nada. El dashboard lo ejecuta al arrancar, así que una
# Pi lo coge con su primer "Update Dashboard". La estación en marcha pasa a los núcleos 2-3 al
# momento, sin reiniciarla; el resto del sistema pasa a 0-1 en el próximo reinicio de la Pi.
#
# Deshacer: rm /etc/systemd/system.conf.d/10-tetra-cpu.conf \
#              /etc/systemd/system/{flowstation-tea2,flowstation,miurastation,tmo}.service.d/10-cpu.conf
#           y reiniciar la Pi.
set -u

UNITS="flowstation-tea2 flowstation miurastation tmo"

[ "$(id -u)" -eq 0 ] || { echo "reserva de núcleos omitida: hace falta root"; exit 0; }
grep -qa "Raspberry Pi" /proc/device-tree/model 2>/dev/null || { echo "reserva de núcleos omitida: no es una Raspberry Pi"; exit 0; }
[ "$(nproc --all)" -ge 4 ] || { echo "reserva de núcleos omitida: menos de 4 núcleos"; exit 0; }
has_station=0
for u in $UNITS; do [ -f "/etc/systemd/system/$u.service" ] && has_station=1; done
[ "$has_station" -eq 1 ] || { echo "reserva de núcleos omitida: no hay ninguna estación instalada"; exit 0; }

changed=0
# $1 = fichero, $2 = contenido (se escribe solo si cambia)
write_conf() {
  if [ "$(cat "$1" 2>/dev/null)" != "$2" ]; then
    mkdir -p "$(dirname "$1")"
    printf '%s\n' "$2" > "$1"
    changed=1
  fi
}

write_conf /etc/systemd/system.conf.d/10-tetra-cpu.conf "# Resto del sistema en los nucleos 0-1: los 2-3 quedan para la estacion TETRA
[Manager]
CPUAffinity=0 1"
for u in $UNITS; do
  # solo las estaciones instaladas (tras migrar a MiuraStation ya no hay flowstation.service)
  [ -f "/etc/systemd/system/$u.service" ] || continue
  write_conf "/etc/systemd/system/$u.service.d/10-cpu.conf" "# Estacion TETRA en los nucleos reservados 2-3 (el resto del sistema va en 0-1)
[Service]
CPUAffinity=2 3"
done

if [ "$changed" -eq 0 ]; then
  echo "reserva de núcleos ya aplicada"
  exit 0
fi

systemctl daemon-reload
for u in $UNITS; do
  pid=$(systemctl show -p MainPID --value "$u.service" 2>/dev/null)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    taskset -a -cp 2,3 "$pid" >/dev/null && echo "$u (pid $pid) pasa a los núcleos 2-3"
  fi
done
echo "reserva de núcleos aplicada; el resto del sistema pasa a los núcleos 0-1 en el próximo reinicio"
