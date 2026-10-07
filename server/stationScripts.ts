// The flow-family stations this dashboard installs, updates and migrates, and the bash scripts that do it:
// - razvan's FlowStation: /root/flowstation, flowstation.service, binary bluestation-bs.
// - MiuraStation (EA5GVK): /root/miurastation, miurastation.service, binary miurastation.
// - The miura FlowStation it replaces (ea5gvk/flowstation · miura in /root/flowstation) is moved to MiuraStation
//   by migrationScript, which keeps config.toml, logs and caches and leaves /root/flowstation -> /root/miurastation.
// Pure generators parametrised by a Layout: the end-to-end tests run these very scripts against a temporary root
// with mocked sudo/git/cargo/systemctl.
import * as fs from "fs";
import { execFileSync } from "child_process";

export interface Layout { root: string; systemd: string; tmp: string }
export const PI_LAYOUT: Layout = { root: "/root", systemd: "/etc/systemd/system", tmp: "/tmp" };

export type ProductId = "razvan" | "miura";
export interface Product {
  id: ProductId;
  name: string;     // visible name
  repo: string;
  branch: string;
  label: string;
  dirName: string;  // under Layout.root
  service: string;
  bin: string;      // target/release/<bin>
}
export const PRODUCTS: Record<ProductId, Product> = {
  razvan: {
    id: "razvan", name: "FlowStation", repo: "razvanzeces/flowstation", branch: "main",
    label: "FlowStation · razvanzeces/flowstation · main (original de YO6RZV)",
    dirName: "flowstation", service: "flowstation.service", bin: "bluestation-bs",
  },
  miura: {
    id: "miura", name: "MiuraStation", repo: "ea5gvk/MiuraStation", branch: "main",
    label: "MiuraStation · ea5gvk/MiuraStation · main (EA5GVK)",
    dirName: "miurastation", service: "miurastation.service", bin: "miurastation",
  },
};
// The miura FlowStation that MiuraStation replaces.
export const LEGACY_MIURA = { repo: "ea5gvk/flowstation", branch: "miura" };
// What a binary that speaks sd_notify carries (MiuraStation, and the miura FlowStation before it).
export const SD_NOTIFY_MARKERS = ["miurastation-sd-notify-v1", "flowstation-sd-notify-v1"];

export const productDir = (p: Product, L: Layout) => `${L.root}/${p.dirName}`;
export const unitPath = (p: Product, L: Layout) => `${L.systemd}/${p.service}`;
export const watchdogDropin = (p: Product, L: Layout) => `${L.systemd}/${p.service}.d/10-watchdog.conf`;
export const wasActiveMark = (p: Product, L: Layout) => `${L.tmp}/${p.service}.was-active`;
export const migrationBackupDir = (L: Layout) => `${L.root}/.tlm-miurastation-migration`;

// bash single-quoted literal
const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function unitFile(p: Product, L: Layout): string {
  const dir = productDir(p, L);
  const head = p.id === "razvan"
    ? "Description=Tetra Flowstation\n"
    : "Description=MiuraStation (estacion base TETRA)\nDocumentation=https://github.com/ea5gvk/MiuraStation\n";
  return `[Unit]
${head}After=network.target

[Service]
Type=simple
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=73
WorkingDirectory=${dir}
ExecStart=${dir}/target/release/${p.bin} ${dir}/config.toml

StandardOutput=journal
StandardError=journal

Restart=always
RestartSec=2
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
`;
}

// systemd watchdog: only for a binary that speaks sd_notify (it carries one of SD_NOTIFY_MARKERS). With
// Type=notify a binary that never reports READY would be killed in a loop.
export function watchdogConf(p: Product): string {
  return `# Gestionado por tetra-live-monitor: se crea o se borra al actualizar ${p.id === "razvan" ? "Flowstation" : "MiuraStation"}, segun el binario.
[Service]
Type=notify
NotifyAccess=main
WatchdogSec=30s
TimeoutStartSec=120s
# El SIGABRT del watchdog no debe dejar un volcado de cientos de MB en la SD.
LimitCORE=0
`;
}

// Creates or removes the watchdog drop-in after a build, by looking for the marker in the binary (nothing is run).
// Only with the station stopped: a daemon-reload with it running would arm the watchdog on a process without
// NOTIFY_SOCKET. Expects to run in the station directory.
function watchdogSync(p: Product, L: Layout): string {
  const conf = sq(watchdogConf(p));
  return `DROPIN="${watchdogDropin(p, L)}"
if sudo grep -aqE '${SD_NOTIFY_MARKERS.join("|")}' "target/release/${p.bin}"; then
  echo "=== Watchdog de systemd: el binario lo soporta, activado (WatchdogSec=30s) ==="
  if [ "$(cat "$DROPIN" 2>/dev/null)" != "$(printf '%s' ${conf})" ]; then
    sudo mkdir -p "$(dirname "$DROPIN")"
    printf '%s' ${conf} | sudo tee "$DROPIN" > /dev/null
    sudo systemctl daemon-reload
  fi
elif [ -f "$DROPIN" ]; then
  echo "=== Watchdog de systemd: el binario no lo soporta, desactivado ==="
  sudo rm -f "$DROPIN"
  sudo systemctl daemon-reload
fi`;
}

const cargoBuild = (dir: string) => `sudo bash -lc 'cd "${dir}" && [ -f /root/.cargo/env ] && . /root/.cargo/env; cargo build --release'`;
const reserveCoresCmd = (script: string | null) => script
  ? `if [ -f ${sq(script)} ]; then sudo bash ${sq(script)} || true; fi\n`
  : "";

// Actualizar: point origin at the product's repo, reset to its branch, build with the station stopped, then the
// watchdog drop-in. config.toml and the restart are handled by the caller (Node) when it ends.
export function updateScript(p: Product, L: Layout): string {
  const dir = productDir(p, L);
  return `
set -e
cd "${dir}"
echo "=== Fuente: ${p.label} ==="
echo "=== git remote set-url origin https://github.com/${p.repo}.git ==="
sudo git remote set-url origin https://github.com/${p.repo}.git
echo "=== git fetch ==="
sudo git fetch --all --prune
echo "=== Cambiando a origin/${p.branch} (reset --hard, soporta force-push y cambio de versión) ==="
sudo git reset --hard
sudo git checkout -B ${p.branch} "origin/${p.branch}"
sudo git reset --hard "origin/${p.branch}"
echo ""
MARK="${wasActiveMark(p, L)}"
sudo rm -f "$MARK"
# "activating" (esperando READY o reintentando) también cuenta: el drop-in del watchdog se toca con el servicio parado.
if systemctl is-active --quiet ${p.service} || [ "$(systemctl is-active ${p.service})" = activating ]; then
  sudo touch "$MARK"
  echo "=== Parando ${p.service} mientras se compila (compilar con la estación en marcha estrangula el TDMA) ==="
  sudo systemctl stop ${p.service}
fi
echo "=== cargo build --release ==="
if ! ${cargoBuild(dir)} || [ ! -f "target/release/${p.bin}" ]; then
  if [ -f "target/release/${p.bin}" ]; then
    echo "=== BUILD FALLIDO: se conserva el binario anterior ==="
  else
    echo "=== BUILD FALLIDO: no hay target/release/${p.bin} ==="
  fi
  if [ -f "$MARK" ]; then
    echo "=== Arrancando ${p.service} de nuevo ==="
    sudo systemctl start ${p.service}
    sudo rm -f "$MARK"
  fi
  exit 1
fi
set +e # un fallo aquí no debe dejar la estación parada: el close la arranca igual
${watchdogSync(p, L)}
exit 0
`;
}

// Instalar: clone into <dir>.new (a failed clone leaves everything as it is), keep an existing config.toml (or
// take the one of `carryFrom` when the product has none yet), build, write the unit. The station is enabled and
// started from the station selector.
export function installScript(p: Product, L: Layout, opts: { sameSource: boolean; carryFrom?: string | null; reserveCores?: string | null }): string {
  const dir = productDir(p, L);
  const carry = opts.carryFrom ?? null;
  return `
set -e
cd "${L.root}"
NEW="${dir}.new"
sudo rm -rf "$NEW"
echo "=== Fuente: ${p.label} ==="
echo "=== git clone -b ${p.branch} https://github.com/${p.repo}.git ==="
if ! sudo git clone -b ${p.branch} https://github.com/${p.repo}.git "$NEW"; then
  sudo rm -rf "$NEW"
  echo "=== CLONE FALLIDO: ${dir} no se ha tocado ==="
  exit 1
fi
BAK=""
if [ -e "${dir}" ] || [ -L "${dir}" ]; then
  if [ -f "${dir}/config.toml" ]; then
    BAK="${dir}.config.toml.bak-$(date +%Y%m%d-%H%M%S)"
    sudo cp -p "${dir}/config.toml" "$BAK"
    echo "=== config.toml existente guardado en $BAK ==="${opts.sameSource ? `
    if [ -f "${dir}/.git/tlm-config-base.toml" ]; then
      sudo cp "${dir}/.git/tlm-config-base.toml" "$NEW/.git/tlm-config-base.toml"
    else
      sudo sh -c 'git -C "$2" show HEAD:example_config/config.toml > "$1" 2>/dev/null' _ "$NEW/.git/tlm-config-base.toml" "${dir}" || sudo rm -f "$NEW/.git/tlm-config-base.toml"
    fi` : ""}
  fi
  if [ -L "${dir}" ]; then
    echo "=== ${dir} es un enlace a $(readlink -f "${dir}"): se quita solo el enlace (lo enlazado no se toca) ==="
    [ -n "$BAK" ] && echo "AVISO: el config.toml viene de la otra estación; si ${p.name} no arranca con él, revisa las claves que solo conoce aquella (p. ej. station_lat/station_lon de [geoalarm])."
    sudo rm -f "${dir}"
  else
    echo "=== Existing ${dir} found — removing for clean install ==="
    sudo rm -rf "${dir}"
  fi${carry ? `
elif [ -f "${carry}/config.toml" ]; then
  BAK="${dir}.config.toml.bak-$(date +%Y%m%d-%H%M%S)"
  sudo cp -p "${carry}/config.toml" "$BAK"
  echo "=== Se reutiliza el config.toml de ${carry} (copia en $BAK) ==="
  echo "AVISO: si ${p.name} no arranca con él, revisa las claves que solo conoce la otra estación."` : ""}
fi
sudo mv "$NEW" "${dir}"
sudo chown -R root:root "${dir}"
cd "${dir}"
if [ -n "$BAK" ]; then
  echo "=== Restaurando config.toml desde $BAK (no se usa example_config) ==="
  sudo cp -p "$BAK" config.toml
  sudo chmod 600 "$BAK"
else
  echo "=== Copiando example_config/config.toml -> config.toml ==="
  sudo cp example_config/config.toml config.toml
fi
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env" || true
[ -f /root/.cargo/env ] && . /root/.cargo/env || true
echo ""
echo "=== cargo build --release (esto tarda varios minutos) ==="
${cargoBuild(dir)}
[ -f "target/release/${p.bin}" ] || { echo "=== BUILD FALLIDO: no hay target/release/${p.bin} ==="; exit 1; }
echo ""
echo "=== Creando ${unitPath(p, L)} ==="
printf '%s' ${sq(unitFile(p, L))} | sudo tee "${unitPath(p, L)}" > /dev/null
sudo rm -f "${watchdogDropin(p, L)}"
sudo systemctl daemon-reload
${reserveCoresCmd(opts.reserveCores ?? null)}echo ""
echo "=== Instalación completada ==="
echo "Para activar ${p.name} usa el selector de estación en la barra de navegación."
`;
}

// Undo of the migration: back to the miura FlowStation in /root/flowstation with flowstation.service, exactly as
// before (git at the commit it had, its unit and drop-ins). Run by migrationScript when something fails after the
// move, and by hand: sudo bash /root/.tlm-miurastation-migration/rollback.sh
export function rollbackScript(L: Layout): string {
  const oldDir = productDir(PRODUCTS.razvan, L), newDir = productDir(PRODUCTS.miura, L);
  const BK = migrationBackupDir(L), S = L.systemd;
  return `#!/usr/bin/env bash
# Generado por tetra-live-monitor (migración a MiuraStation). Deshace la migración:
# vuelve la FlowStation miura a ${oldDir} con flowstation.service, como estaba.
set -u
# runs from a copy: at the end the directory that holds this file is renamed
if [ "\${TLM_ROLLBACK_COPY:-}" != 1 ]; then
  T=$(mktemp) && cp "$0" "$T" && TLM_ROLLBACK_COPY=1 exec bash "$T" "$@"
fi
OLD="${oldDir}"; NEW="${newDir}"; BK="${BK}"; SYSD="${S}"
say() { echo "[vuelta atrás] $*"; }
echo "=== Vuelta atrás: MiuraStation -> FlowStation miura ==="
sudo systemctl stop miurastation.service 2>/dev/null
sudo systemctl disable miurastation.service 2>/dev/null
SRC="$NEW"
if [ -L "$OLD" ] || [ ! -e "$OLD" ]; then
  [ -d "$NEW" ] || { say "no existe $NEW: nada que devolver"; exit 1; }
else
  SRC="$OLD"
fi
if [ -f "$BK/legacy-head" ] && [ -d "$SRC/.git" ]; then
  HEAD_OLD=$(cat "$BK/legacy-head")
  say "git: origin -> https://github.com/${LEGACY_MIURA.repo}.git, rama ${LEGACY_MIURA.branch} en $HEAD_OLD"
  sudo git -C "$SRC" remote set-url origin https://github.com/${LEGACY_MIURA.repo}.git
  sudo git -C "$SRC" checkout -f -B ${LEGACY_MIURA.branch} "$HEAD_OLD" || say "AVISO: no se ha podido volver a $HEAD_OLD"
  sudo git -C "$SRC" reset --hard "$HEAD_OLD" >/dev/null 2>&1
  [ -f "$BK/tlm-config-base.toml" ] && sudo cp -p "$BK/tlm-config-base.toml" "$SRC/.git/tlm-config-base.toml"
else
  say "AVISO: sin $BK/legacy-head: el código se queda como está"
fi
# config.toml as it was before the migration (the first copy); the current one is kept next to it
FIRST_BAK=$(ls -1 "$BK"/config.toml.bak-* 2>/dev/null | head -n 1)
if [ -n "$FIRST_BAK" ] && [ -f "$SRC/config.toml" ] && ! sudo cmp -s "$FIRST_BAK" "$SRC/config.toml"; then
  KEEP="$SRC/config.toml.miurastation-$(date +%Y%m%d-%H%M%S)"
  sudo cp -p "$SRC/config.toml" "$KEEP" && sudo chmod 600 "$KEEP"
  sudo cp -p "$FIRST_BAK" "$SRC/config.toml" && say "config.toml de antes de migrar restaurado (el de MiuraStation queda en $(basename "$KEEP"))"
fi
if [ "$SRC" = "$NEW" ]; then
  [ -L "$OLD" ] && sudo rm -f "$OLD"
  sudo mv "$NEW" "$OLD" && say "directorio: $NEW -> $OLD"
fi
if [ -f "$BK/flowstation.service" ] && [ ! -f "$SYSD/flowstation.service" ]; then
  sudo cp -p "$BK/flowstation.service" "$SYSD/flowstation.service" && say "unidad flowstation.service restaurada"
fi
if [ -d "$BK/flowstation.service.d" ]; then
  sudo mkdir -p "$SYSD/flowstation.service.d"
  for f in "$BK"/flowstation.service.d/*.conf; do
    [ -f "$f" ] || continue
    [ -f "$SYSD/flowstation.service.d/$(basename "$f")" ] || sudo cp -p "$f" "$SYSD/flowstation.service.d/"
  done
  say "drop-ins de flowstation.service restaurados"
fi
sudo rm -f "$SYSD/miurastation.service"
sudo rm -rf "$SYSD/miurastation.service.d"
sudo systemctl daemon-reload
if [ -f "$BK/flowstation.enabled" ]; then
  sudo systemctl enable flowstation.service && say "flowstation.service habilitado de nuevo"
fi
STAMP=$(date +%Y%m%d-%H%M%S)
sudo mv "$BK" "$BK.vuelta-atras-$STAMP" && say "copias de la migración en $BK.vuelta-atras-$STAMP"
echo "=== Vuelta atrás completada: la estación es otra vez la FlowStation miura de $OLD (flowstation.service) ==="
exit 0
`;
}

// Migración: the miura FlowStation (/root/flowstation, ea5gvk/flowstation · miura, flowstation.service) becomes
// MiuraStation (/root/miurastation, ea5gvk/MiuraStation · main, miurastation.service). Keeps config.toml, logs and
// caches (the whole directory moves), leaves /root/flowstation -> /root/miurastation, moves the drop-ins and
// rebuilds from scratch. Any failure after the move runs the rollback. Safe to run again (each step checks).
// The config merge, active-station.json and the start are done by the caller (Node) when it ends with 0.
export function migrationScript(L: Layout, opts: { reserveCores?: string | null } = {}): string {
  const M = PRODUCTS.miura;
  const oldDir = productDir(PRODUCTS.razvan, L), newDir = productDir(M, L);
  const BK = migrationBackupDir(L);
  return `
set -u
OLD="${oldDir}"; NEW="${newDir}"; BK="${BK}"; SYSD="${L.systemd}"
OLD_SVC=flowstation.service; NEW_SVC=${M.service}
MARK="${wasActiveMark(M, L)}"
step() { echo ""; echo "=== Migración $1 ==="; }
say() { echo "  $*"; }
stop_here() { echo ""; echo "=== MIGRACIÓN DETENIDA: $* ==="; echo "Nada se ha cambiado."; exit 1; }
restart_old() {
  if [ -f "$MARK" ]; then
    say "arrancando de nuevo $OLD_SVC (estaba en marcha)"
    sudo systemctl start $OLD_SVC
    sudo rm -f "$MARK"
  fi
}
undo() {
  echo ""
  echo "=== MIGRACIÓN FALLIDA: $* ==="
  echo "=== Se deshace todo (${BK}/rollback.sh) ==="
  sudo bash "$BK/rollback.sh"
  restart_old
  exit 1
}

echo "=== Migración a MiuraStation ==="
say "desde: $OLD (${LEGACY_MIURA.repo} · ${LEGACY_MIURA.branch}, $OLD_SVC)"
say "a:     $NEW (${M.repo} · ${M.branch}, $NEW_SVC)"
say "config.toml, logs y cachés se conservan: se mueve el directorio entero."

step "1/9: comprobando el punto de partida"
if [ -L "$OLD" ]; then
  if [ -d "$NEW" ] && [ "$(cd "$OLD" 2>/dev/null && pwd -P)" = "$(cd "$NEW" && pwd -P)" ]; then
    MOVED=1; say "$OLD ya es un enlace a $NEW: la migración ya empezó antes, se continúa"
  else
    stop_here "$OLD es un enlace a otro sitio ($(readlink -f "$OLD"))"
  fi
elif [ -d "$OLD" ]; then
  [ -e "$NEW" ] && stop_here "ya existen $OLD y $NEW; no se mezclan, revísalo a mano"
  [ -d "$OLD/.git" ] || stop_here "$OLD no es un repositorio git"
  MOVED=0; say "$OLD es la FlowStation miura: se migra"
elif [ -d "$NEW" ]; then
  MOVED=1; say "$OLD no existe y $NEW sí: la migración se cortó tras mover el directorio, se continúa"
else
  stop_here "no hay ninguna FlowStation en $OLD"
fi
SRC="$OLD"; [ "$MOVED" = 1 ] && SRC="$NEW"
[ -f "$SRC/config.toml" ] && say "config.toml: $SRC/config.toml" || say "AVISO: $SRC no tiene config.toml (se usará el de ejemplo)"

step "2/9: copias de seguridad y vuelta atrás en $BK"
if [ "$MOVED" = 0 ] && [ -e "$BK" ]; then
  sudo mv "$BK" "$BK.anterior-$(date +%Y%m%d-%H%M%S)"
  say "había copias de un intento anterior: apartadas"
fi
sudo mkdir -p "$BK"
sudo chmod 700 "$BK"
# only while $SRC is still on the miura FlowStation (a re-run after the switch must not record MiuraStation)
if [ ! -f "$BK/legacy-head" ] && git -C "$SRC" remote get-url origin 2>/dev/null | grep -qi '${LEGACY_MIURA.repo}'; then
  sudo sh -c 'git -C "$1" rev-parse HEAD > "$2"' _ "$SRC" "$BK/legacy-head" && say "commit de la FlowStation miura: $(cat "$BK/legacy-head")"
fi
[ -f "$BK/tlm-config-base.toml" ] || { [ -f "$SRC/.git/tlm-config-base.toml" ] && sudo cp -p "$SRC/.git/tlm-config-base.toml" "$BK/tlm-config-base.toml"; }
CFG_BAK=""
if [ -f "$SRC/config.toml" ]; then
  CFG_BAK="$BK/config.toml.bak-$(date +%Y%m%d-%H%M%S)"
  sudo cp -p "$SRC/config.toml" "$CFG_BAK"
  sudo chmod 600 "$CFG_BAK"
  say "config.toml copiado en $CFG_BAK"
fi
[ -f "$BK/flowstation.service" ] || { [ -f "$SYSD/$OLD_SVC" ] && sudo cp -p "$SYSD/$OLD_SVC" "$BK/flowstation.service" && say "unidad $OLD_SVC copiada"; }
if [ ! -d "$BK/flowstation.service.d" ] && [ -d "$SYSD/$OLD_SVC.d" ]; then
  sudo cp -rp "$SYSD/$OLD_SVC.d" "$BK/flowstation.service.d" && say "drop-ins de $OLD_SVC copiados"
fi
printf '%s' ${sq(rollbackScript(L))} | sudo tee "$BK/rollback.sh" > /dev/null
sudo chmod 700 "$BK/rollback.sh"
say "vuelta atrás manual: sudo bash $BK/rollback.sh"

step "3/9: parando la estación"
sudo rm -f "$MARK"
for s in $OLD_SVC $NEW_SVC; do
  st=$(systemctl is-active $s 2>/dev/null)
  if [ "$st" = active ] || [ "$st" = activating ]; then
    sudo touch "$MARK"
    say "$s estaba en marcha: se para (se arrancará al terminar)"
    sudo systemctl stop $s
  fi
done
[ -f "$MARK" ] || say "la estación no estaba en marcha: se quedará parada"
WAS_ENABLED=0
if systemctl is-enabled --quiet $OLD_SVC 2>/dev/null || systemctl is-enabled --quiet $NEW_SVC 2>/dev/null; then WAS_ENABLED=1; fi

step "4/9: moviendo $OLD -> $NEW"
if [ "$MOVED" = 0 ]; then
  sudo mv "$OLD" "$NEW" || { restart_old; stop_here "no se ha podido mover $OLD"; }
  say "movido (config.toml, logs y cachés van dentro)"
fi
if [ ! -e "$OLD" ] && [ ! -L "$OLD" ]; then
  sudo ln -s "$NEW" "$OLD" || undo "no se ha podido crear el enlace $OLD"
fi
say "enlace $OLD -> $NEW (para scripts y rutas antiguas)"

step "5/9: código de ${M.repo} · ${M.branch}"
cd "$NEW" || undo "no se puede entrar en $NEW"
sudo git remote set-url origin https://github.com/${M.repo}.git || undo "git remote set-url"
say "origin -> https://github.com/${M.repo}.git"
sudo git fetch --prune origin || undo "git fetch (¿sin red?)"
sudo git checkout -f -B ${M.branch} "origin/${M.branch}" || undo "git checkout ${M.branch}"
sudo git reset --hard "origin/${M.branch}" || undo "git reset"
say "en $(git rev-parse --short HEAD 2>/dev/null) (los ficheros sin versionar, como config.toml, se quedan)"
# config.toml no va en git y el checkout no lo toca; si el código nuevo trajese uno, manda el del usuario
if [ -n "$CFG_BAK" ] && ! sudo cmp -s "$CFG_BAK" "$NEW/config.toml"; then
  sudo cp -p "$CFG_BAK" "$NEW/config.toml" && say "config.toml restaurado desde $CFG_BAK"
fi

step "6/9: cargo build --release (compilación completa: el directorio ha cambiado; tarda varios minutos)"
${cargoBuild(newDir)} || undo "la compilación ha fallado"
[ -f "target/release/${M.bin}" ] || undo "la compilación no ha dejado target/release/${M.bin}"
say "binario: $NEW/target/release/${M.bin}"

step "7/9: servicio $NEW_SVC"
printf '%s' ${sq(unitFile(M, L))} | sudo tee "$SYSD/$NEW_SVC" > /dev/null || undo "no se ha podido escribir $SYSD/$NEW_SVC"
say "escrito $SYSD/$NEW_SVC (ExecStart=$NEW/target/release/${M.bin})"
if [ -d "$SYSD/$OLD_SVC.d" ]; then
  sudo mkdir -p "$SYSD/$NEW_SVC.d"
  for f in "$SYSD/$OLD_SVC.d"/*.conf; do
    [ -f "$f" ] || continue
    if [ -f "$SYSD/$NEW_SVC.d/$(basename "$f")" ]; then
      sudo rm -f "$f"
    else
      sudo mv "$f" "$SYSD/$NEW_SVC.d/" && say "drop-in $(basename "$f") -> $NEW_SVC.d/"
    fi
  done
  sudo rmdir "$SYSD/$OLD_SVC.d" 2>/dev/null
fi
if [ -f "$SYSD/$OLD_SVC" ]; then
  systemctl is-enabled --quiet $OLD_SVC 2>/dev/null && sudo touch "$BK/flowstation.enabled"
  sudo systemctl disable $OLD_SVC 2>/dev/null
  sudo rm -f "$SYSD/$OLD_SVC"
  say "$OLD_SVC deshabilitado y retirado (copia en $BK/flowstation.service)"
fi
sudo systemctl daemon-reload
if [ "$WAS_ENABLED" = 1 ]; then
  sudo systemctl enable $NEW_SVC && say "$NEW_SVC habilitado (arranca con la Pi)"
else
  say "$OLD_SVC no estaba habilitado: $NEW_SVC tampoco"
fi

step "8/9: watchdog de systemd"
${watchdogSync(M, L)}

step "9/9: núcleos reservados"
${reserveCoresCmd(opts.reserveCores ?? null) || "say \"(sin script de reserva de núcleos)\"\n"}
echo ""
echo "=== Migración completada: ${M.name} en $NEW con $NEW_SVC ==="
echo "Si algo no va bien: sudo bash $BK/rollback.sh (vuelve a la FlowStation miura tal como estaba)."
exit 0
`;
}

// ── On-disk state (Node side) ──

export function isLink(p: string): boolean {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}
function sameTarget(a: string, b: string): boolean {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
}
const lexists = (p: string) => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** /root/flowstation is the link a migration left (-> /root/miurastation): not razvan's FlowStation. */
export function isMigrationLink(L: Layout): boolean {
  const o = productDir(PRODUCTS.razvan, L);
  return isLink(o) && sameTarget(o, productDir(PRODUCTS.miura, L));
}

/** razvan's FlowStation (or a miura FlowStation still to migrate) is in /root/flowstation. */
export function flowDirInstalled(L: Layout): boolean {
  return fs.existsSync(productDir(PRODUCTS.razvan, L)) && !isMigrationLink(L);
}

export function urlIsRepo(url: string, repo: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
  const r = repo.toLowerCase();
  return u.endsWith(`/${r}`) || u.endsWith(`:${r}`);
}

export type Installed = ProductId | "legacy" | null;
/** What is checked out in `dir`: razvan / MiuraStation / the miura FlowStation, or null (unknown or no repo). */
export function detectInstall(dir: string): Installed {
  try {
    const opts = { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] as any };
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], opts).toString();
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], opts).toString().trim();
    for (const p of [PRODUCTS.razvan, PRODUCTS.miura]) if (urlIsRepo(url, p.repo) && branch === p.branch) return p.id;
    if (urlIsRepo(url, LEGACY_MIURA.repo) && branch === LEGACY_MIURA.branch) return "legacy";
  } catch { /* not a repo */ }
  return null;
}

// "needed": the miura FlowStation is in /root/flowstation and there is no /root/miurastation.
// "resume": a migration stopped after moving the directory (still on the old code).
export type MigrationState = "none" | "needed" | "resume";
export function migrationState(L: Layout): MigrationState {
  const o = productDir(PRODUCTS.razvan, L), n = productDir(PRODUCTS.miura, L);
  if (!lexists(n)) return lexists(o) && !isLink(o) && detectInstall(o) === "legacy" ? "needed" : "none";
  if ((isMigrationLink(L) || !lexists(o)) && detectInstall(n) === "legacy") return "resume";
  return "none";
}
