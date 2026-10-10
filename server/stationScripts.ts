// The flow-family stations this dashboard installs, updates and migrates, and the bash scripts that do it:
// - razvan's FlowStation: /root/flowstation, flowstation.service, binary bluestation-bs, built from git with cargo.
// - MiuraStation (EA5GVK): the miurastation .deb of ea5gvk/MiuraStation-dist (/usr/bin/miurastation and
//   /lib/systemd/system/miurastation.service); its home /root/miurastation keeps config.toml, logs and caches.
//   The panel only writes drop-ins for it (watchdog, reserved cores), never its main unit.
// - migrationScript moves to the package the miura FlowStation it replaces (ea5gvk/flowstation · miura in
//   /root/flowstation: the directory moves and /root/flowstation -> /root/miurastation stays) and a MiuraStation
//   built from source (/root/miurastation with the unit the panel wrote in /etc/systemd/system).
// Pure generators parametrised by a Layout: the end-to-end tests run these very scripts against a temporary root
// with mocked sudo/systemctl/apt-get/dpkg/curl.
import * as fs from "fs";
import { execFileSync } from "child_process";

// pkgSystemd and usr: where the miurastation package puts its unit and its files (/usr/bin, /usr/share).
export interface Layout { root: string; systemd: string; tmp: string; pkgSystemd: string; usr: string }
export const PI_LAYOUT: Layout = { root: "/root", systemd: "/etc/systemd/system", tmp: "/tmp", pkgSystemd: "/lib/systemd/system", usr: "/usr" };

export type ProductId = "razvan" | "miura";
export interface Product {
  id: ProductId;
  name: string;     // visible name
  repo: string;     // razvan: the git repo; MiuraStation: the repo of its releases
  branch: string;   // razvan: the git branch; MiuraStation: "latest" (the latest stable release)
  label: string;
  dirName: string;  // under Layout.root
  service: string;
  bin: string;      // razvan: target/release/<bin>; MiuraStation: /usr/bin/<bin>
}
// MiuraStation is only published as binaries (its source repo ea5gvk/MiuraStation is private): releases vX.Y.Z of
// ea5gvk/MiuraStation-dist with miurastation_X.Y.Z_arm64.deb and SHA256SUMS. Only arm64 for now.
export const DIST_REPO = "ea5gvk/MiuraStation-dist";
export const DEB_ARCH = "arm64";
export const PRODUCTS: Record<ProductId, Product> = {
  razvan: {
    id: "razvan", name: "FlowStation", repo: "razvanzeces/flowstation", branch: "main",
    label: "FlowStation · razvanzeces/flowstation · main (original de YO6RZV)",
    dirName: "flowstation", service: "flowstation.service", bin: "bluestation-bs",
  },
  miura: {
    id: "miura", name: "MiuraStation", repo: DIST_REPO, branch: "latest",
    label: "MiuraStation · ea5gvk/MiuraStation-dist · paquete .deb (EA5GVK)",
    dirName: "miurastation", service: "miurastation.service", bin: "miurastation",
  },
};
// A MiuraStation built from source (a checkout of its repo, before the package).
export const MIURA_SOURCE = { repo: "ea5gvk/MiuraStation", branch: "main" };
// The miura FlowStation that MiuraStation replaces.
export const LEGACY_MIURA = { repo: "ea5gvk/flowstation", branch: "miura" };
// What a binary that speaks sd_notify carries (MiuraStation, and the miura FlowStation before it).
export const SD_NOTIFY_MARKERS = ["miurastation-sd-notify-v1", "flowstation-sd-notify-v1"];

export const productDir = (p: Product, L: Layout) => `${L.root}/${p.dirName}`;
export const unitPath = (p: Product, L: Layout) => `${L.systemd}/${p.service}`;
export const watchdogDropin = (p: Product, L: Layout) => `${L.systemd}/${p.service}.d/10-watchdog.conf`;
export const wasActiveMark = (p: Product, L: Layout) => `${L.tmp}/${p.service}.was-active`;
export const migrationBackupDir = (L: Layout) => `${L.root}/.tlm-miurastation-migration`;
// What the miurastation package installs.
export const pkgUnitPath = (L: Layout) => `${L.pkgSystemd}/${PRODUCTS.miura.service}`;
export const pkgBinPath = (L: Layout) => `${L.usr}/bin/${PRODUCTS.miura.bin}`;
export const pkgTemplatePath = (L: Layout) => `${L.usr}/share/miurastation/example_config/config.toml`;
// Base of the config.toml merge of the package (there is no .git): in the station home.
export const pkgConfigBasePath = (L: Layout) => `${productDir(PRODUCTS.miura, L)}/.tlm-config-base.toml`;
export const debAsset = (version: string) => `miurastation_${version}_${DEB_ARCH}.deb`;
// Free space for the download and the install of the package (a few tens of MB: nothing is built any more).
export const PACKAGE_MIN_FREE_KB = 200 * 1024;

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

// Creates or removes the watchdog drop-in by looking for the marker in the binary `bin` (nothing is run):
// target/release/<bin> after a build (run in the station directory), or the package's /usr/bin/miurastation (whose
// unit already has these settings: there the drop-in only repeats them).
// Only with the station stopped: a daemon-reload with it running would arm the watchdog on a process without
// NOTIFY_SOCKET.
function watchdogSync(p: Product, L: Layout, bin: string): string {
  const conf = sq(watchdogConf(p));
  return `DROPIN="${watchdogDropin(p, L)}"
if sudo grep -aqE '${SD_NOTIFY_MARKERS.join("|")}' "${bin}"; then
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

// One install / update / migration at a time, also against another process (the dashboard has its own lock).
const lockCmd = (L: Layout) => `if command -v flock >/dev/null 2>&1 && exec 9>>"${L.tmp}/tlm-station-ops.lock"; then
  flock -n 9 || { echo "=== Hay otra instalación o actualización de estación en curso: espera a que termine ==="; exit 1; }
fi
`;

const cargoBuild = (dir: string) => `sudo bash -lc 'cd "${dir}" && [ -f /root/.cargo/env ] && . /root/.cargo/env; cargo build --release'`;
const reserveCoresCmd = (script: string | null) => script
  ? `if [ -f ${sq(script)} ]; then sudo bash ${sq(script)} || true; fi\n`
  : "";

// Actualizar (razvan's FlowStation, built from git; MiuraStation is a package: packageScript): point origin at the
// product's repo, reset to its branch, build with the station stopped, then the watchdog drop-in. config.toml and
// the restart are handled by the caller (Node) when it ends.
export function updateScript(p: Product, L: Layout): string {
  const dir = productDir(p, L);
  return `
set -e
${lockCmd(L)}cd "${dir}"
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
${watchdogSync(p, L, `target/release/${p.bin}`)}
exit 0
`;
}

// Instalar (razvan's FlowStation): clone into <dir>.new (a failed clone leaves everything as it is), keep an
// existing config.toml (or take the one of `carryFrom` when the product has none yet), build, write the unit. The
// station is enabled and started from the station selector.
export function installScript(p: Product, L: Layout, opts: { sameSource: boolean; carryFrom?: string | null; reserveCores?: string | null }): string {
  const dir = productDir(p, L);
  const carry = opts.carryFrom ?? null;
  return `
set -e
${lockCmd(L)}cd "${L.root}"
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

// ── MiuraStation: the package ──

// The release of the package: TAG, VER, DEB and BASE for the fragments below (tag and version are checked by
// RELEASE_TAG_RE before they get here).
const releaseVars = (tag: string, version: string) => `TAG=${sq(tag)}; VER=${sq(version)}; DEB=${sq(debAsset(version))}
BASE="https://github.com/${DIST_REPO}/releases/download/$TAG"
`;

// Only arm64 is published. `fail` = the script's error function (here and below).
const archCheck = (fail: string) => `ARCH=$(dpkg --print-architecture 2>/dev/null || echo desconocida)
[ "$ARCH" = ${DEB_ARCH} ] || ${fail} "MiuraStation solo se publica para ${DEB_ARCH} (Raspberry Pi 3/4/5 con Raspberry Pi OS de 64 bits) y este sistema es $ARCH"
`;

// Downloads the .deb and SHA256SUMS of the release into $WORK (a new directory, removed on exit) and checks the sum
// of the .deb against its line ("hash  name" or "hash *name"). A small space check first.
const fetchDeb = (L: Layout, fail: string) => `for d in "${L.tmp}" "${L.usr}"; do
  FREE_KB=$(df -Pk "$d" 2>/dev/null | awk 'NR==2 {print $4}')
  if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt ${PACKAGE_MIN_FREE_KB} ] 2>/dev/null; then
    ${fail} "solo quedan $((FREE_KB / 1024)) MB libres en $d y el paquete necesita al menos ${PACKAGE_MIN_FREE_KB / 1024} MB: libera espacio"
  fi
done
WORK=$(mktemp -d "${L.tmp}/miurastation-deb.XXXXXX") || ${fail} "no se ha podido crear un directorio temporal en ${L.tmp}"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK" # apt-get reads the .deb as the _apt user
echo "=== Descargando $DEB y SHA256SUMS (${DIST_REPO}, $TAG) ==="
curl -fsSL --retry 3 --max-time 60 -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" || ${fail} "no se ha podido descargar SHA256SUMS de $TAG (¿sin red, o no existe esa versión?)"
curl -fsSL --retry 3 --max-time 900 -o "$WORK/$DEB" "$BASE/$DEB" || ${fail} "no se ha podido descargar $DEB"
chmod 644 "$WORK/$DEB"
awk -v f="$DEB" '$2 == f || $2 == "*" f' "$WORK/SHA256SUMS" > "$WORK/deb.sha256"
[ -s "$WORK/deb.sha256" ] || ${fail} "SHA256SUMS no incluye $DEB"
(cd "$WORK" && sha256sum -c deb.sha256) || ${fail} "la suma SHA-256 de $DEB no coincide: descarga corrupta o manipulada"
`;

// apt-get install of the downloaded .deb, with its dependencies; stale package lists get an apt-get update and one
// more try. Never with MIURASTATION_OTA (that is the station's own update): on an upgrade the postinst restarts a
// running station, so the scripts stop it first and the caller starts it after the config.toml merge.
const aptInstall = (extra: string) => {
  const cmd = `sudo env -u MIURASTATION_OTA DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold${extra} "$WORK/$DEB"`;
  return `apt_install_deb() {
  echo "=== apt-get install $DEB ==="
  ${cmd} && return 0
  echo "=== apt-get install ha fallado: se actualizan las listas de paquetes (apt-get update) y se reintenta ==="
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update && ${cmd}
}
`;
};

// The installed version (dpkg, "1.2.0-1" / "1.2.0~beta.1-1") must be the release's.
const checkInstalled = (L: Layout, fail: string) => `INST=$(dpkg-query -W -f='\${Version}' miurastation 2>/dev/null)
INST_UP=$(printf '%s' "\${INST%-*}" | tr '~' '-')
[ -n "$INST" ] && [ "$INST_UP" = "$VER" ] || ${fail} "tras apt-get, dpkg dice que miurastation está en \${INST:-ninguna versión} y se esperaba $VER"
echo "=== miurastation $INST instalado (${pkgBinPath(L)}) ==="
`;

// A unit of a source install in /etc/systemd/system (ExecStart .../target/release/...) hides the package's.
const isSourceUnitFn = `is_source_unit() { [ -f "$1" ] && [ ! -L "$1" ] && grep -q '^ExecStart=.*/target/release/' "$1"; }
`;

// Instalar / Actualizar MiuraStation from its package: download and check the .deb of the release (the station keeps
// running meanwhile), apt-get install, check the installed version, then the watchdog drop-in and the reserved cores.
// - install: an existing config.toml stays (the postinst only creates it when missing); with none, razvan's
//   (`carryFrom`) is reused. A unit left by a source install is moved aside (it would hide the package's). The unit
//   stays disabled unless it already was enabled: the station selector enables and starts it.
// - update: the station is stopped before apt-get and the mark tells the caller (Node) to start it after the config
//   merge; a failure starts it again.
// allowDowngrade: an older version that was asked for; reinstall: the same version (e.g. its home was deleted).
export function packageScript(L: Layout, opts: { mode: "install" | "update"; tag: string; version: string; allowDowngrade?: boolean; reinstall?: boolean; carryFrom?: string | null; reserveCores?: string | null }): string {
  const M = PRODUCTS.miura;
  const install = opts.mode === "install";
  const carry = opts.carryFrom ?? null;
  return `
set -u
${lockCmd(L)}DIR="${productDir(M, L)}"; SVC=${M.service}; UNIT="${unitPath(M, L)}"
MARK="${wasActiveMark(M, L)}"
${releaseVars(opts.tag, opts.version)}die() {
  echo ""; echo "=== ERROR: $* ==="
  if [ -f "$MARK" ]; then
    echo "=== Arrancando $SVC de nuevo ==="
    sudo systemctl start $SVC
    sudo rm -f "$MARK"
  fi
  exit 1
}
${isSourceUnitFn}${aptInstall(`${opts.allowDowngrade ? " --allow-downgrades" : ""}${opts.reinstall ? " --reinstall" : ""}`)}echo "=== Fuente: ${M.label} ==="
echo "=== ${M.name} $VER ($TAG) ==="
sudo rm -f "$MARK"
${archCheck("die")}${fetchDeb(L, "die")}${install ? `WAS_ENABLED=0
systemctl is-enabled --quiet $SVC 2>/dev/null && WAS_ENABLED=1
if is_source_unit "$UNIT"; then
  sudo mkdir -p "$DIR"
  sudo cp -p "$UNIT" "$DIR/miurastation.service.source-install.bak"
  echo "=== $UNIT es de una instalación compilada y taparía la del paquete: se retira (copia en $DIR/miurastation.service.source-install.bak) ==="
  sudo systemctl disable $SVC 2>/dev/null
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
fi${carry ? `
if [ ! -e "$DIR/config.toml" ] && [ -f "${carry}/config.toml" ]; then
  sudo mkdir -p "$DIR"
  sudo cp -p "${carry}/config.toml" "$DIR/config.toml"
  echo "=== Se reutiliza el config.toml de ${carry} ==="
  echo "AVISO: si ${M.name} no arranca con él, revisa las claves que solo conoce la otra estación."
fi` : ""}
if [ -f "$DIR/config.toml" ]; then
  echo "=== config.toml existente en $DIR: se conserva ==="
else
  echo "=== config.toml: lo crea el paquete en $DIR desde su plantilla ==="
fi
` : `# "activating" (esperando READY o reintentando) también cuenta
if systemctl is-active --quiet $SVC || [ "$(systemctl is-active $SVC)" = activating ]; then
  sudo touch "$MARK"
  echo "=== Parando $SVC durante la instalación (se arranca al terminar, con config.toml ya al día) ==="
  sudo systemctl stop $SVC
fi
`}apt_install_deb || die "apt-get install ha fallado"
${checkInstalled(L, "die")}${install ? `if [ "$WAS_ENABLED" = 0 ]; then
  sudo systemctl disable $SVC 2>/dev/null
  echo "=== $SVC queda sin habilitar: actívala con el selector de estación ==="
fi
` : ""}set +e # un fallo aquí no debe dejar la estación parada: el close la arranca igual
${watchdogSync(M, L, pkgBinPath(L))}
${reserveCoresCmd(opts.reserveCores ?? null)}echo ""
echo "=== ${install ? "Instalación completada" : "Actualización instalada"}: ${M.name} $VER ==="${install ? `
echo "Para activar ${M.name} usa el selector de estación en la barra de navegación."` : ""}
exit 0
`;
}

// Undo of the migration: back to exactly what there was before. The package is purged if the migration installed it
// (/root/miurastation is never deleted). The kind is in the copies:
// - legacy: the miura FlowStation in /root/flowstation with flowstation.service, its drop-ins and its git commit;
// - source: the MiuraStation built from source in /root/miurastation with its own unit and drop-ins.
// Run by migrationScript when something fails after the station was stopped, and by hand:
// sudo bash /root/.tlm-miurastation-migration/rollback.sh
export function rollbackScript(L: Layout): string {
  const oldDir = productDir(PRODUCTS.razvan, L), newDir = productDir(PRODUCTS.miura, L);
  const BK = migrationBackupDir(L), S = L.systemd;
  return `#!/usr/bin/env bash
# Generado por tetra-live-monitor (migración a MiuraStation). Deshace la migración y deja la estación como
# estaba: la FlowStation miura en ${oldDir} con flowstation.service, o la MiuraStation compilada en ${newDir}.
set -u
# runs from a copy: at the end the directory that holds this file is renamed
if [ "\${TLM_ROLLBACK_COPY:-}" != 1 ]; then
  T=$(mktemp) && cp "$0" "$T" && TLM_ROLLBACK_COPY=1 exec bash "$T" "$@"
fi
OLD="${oldDir}"; NEW="${newDir}"; BK="${BK}"; SYSD="${S}"
say() { echo "[vuelta atrás] $*"; }
# a migration of an earlier version (no "kind") was always from the miura FlowStation
KIND=$(cat "$BK/kind" 2>/dev/null); [ "$KIND" = source ] || KIND=legacy
if [ "$KIND" = source ]; then
  echo "=== Vuelta atrás: paquete MiuraStation -> MiuraStation compilada ==="
else
  echo "=== Vuelta atrás: MiuraStation -> FlowStation miura ==="
fi
WAS_RUNNING=0
case "$(systemctl is-active miurastation.service 2>/dev/null)" in active|activating) WAS_RUNNING=1 ;; esac
sudo systemctl stop miurastation.service 2>/dev/null
sudo systemctl disable miurastation.service 2>/dev/null
# only a package that this migration installed (pkg-before = the version there was before, empty if none)
if [ -f "$BK/pkg-installed" ] && [ ! -s "$BK/pkg-before" ] && dpkg-query -W miurastation >/dev/null 2>&1; then
  say "se quita el paquete miurastation que instaló la migración ($NEW se conserva)"
  sudo env DEBIAN_FRONTEND=noninteractive apt-get purge -y miurastation || say "AVISO: no se ha podido quitar el paquete (sudo apt-get purge miurastation)"
fi
# config.toml as it was before the migration (the first copy); the current one is kept next to it
restore_config() {
  FIRST_BAK=$(ls -1 "$BK"/config.toml.bak-* 2>/dev/null | head -n 1)
  if [ -n "$FIRST_BAK" ] && [ -f "$1/config.toml" ] && ! sudo cmp -s "$FIRST_BAK" "$1/config.toml"; then
    KEEP="$1/config.toml.miurastation-$(date +%Y%m%d-%H%M%S)"
    sudo cp -p "$1/config.toml" "$KEEP" && sudo chmod 600 "$KEEP"
    sudo cp -p "$FIRST_BAK" "$1/config.toml" && say "config.toml de antes de migrar restaurado (el de MiuraStation queda en $(basename "$KEEP"))"
  fi
}
# the drop-ins of the copy $1 that are not in $2
restore_dropins() {
  [ -d "$1" ] || return 0
  sudo mkdir -p "$2"
  for f in "$1"/*.conf; do
    [ -f "$f" ] || continue
    [ -f "$2/$(basename "$f")" ] || sudo cp -p "$f" "$2/"
  done
  say "drop-ins de $(basename "$2" .d) restaurados"
}
# $1 = unit, $2 = the station it is again
finish() {
  ON_AIR=""
  if [ "$WAS_RUNNING" = 1 ]; then
    sudo systemctl start "$1" && ON_AIR=", en marcha" && say "$1 arrancado (MiuraStation estaba en marcha)"
  fi
  STAMP=$(date +%Y%m%d-%H%M%S)
  sudo mv "$BK" "$BK.vuelta-atras-$STAMP" && say "copias de la migración en $BK.vuelta-atras-$STAMP"
  echo "=== Vuelta atrás completada: la estación es otra vez $2 ($1$ON_AIR) ==="
  exit 0
}

if [ "$KIND" = source ]; then
  [ -d "$NEW" ] || { say "no existe $NEW: nada que devolver"; exit 1; }
  # a mask left by the package's removal
  [ -L "$SYSD/miurastation.service" ] && [ "$(readlink "$SYSD/miurastation.service")" = /dev/null ] && sudo rm -f "$SYSD/miurastation.service"
  if [ -f "$BK/miurastation.service" ] && [ ! -e "$SYSD/miurastation.service" ]; then
    sudo cp -p "$BK/miurastation.service" "$SYSD/miurastation.service" && say "unidad miurastation.service de la instalación compilada restaurada"
  fi
  restore_dropins "$BK/miurastation.service.d" "$SYSD/miurastation.service.d"
  restore_config "$NEW"
  sudo systemctl daemon-reload
  if [ -f "$BK/miurastation.enabled" ]; then
    sudo systemctl enable miurastation.service && say "miurastation.service habilitado de nuevo"
  fi
  finish miurastation.service "la MiuraStation compilada de $NEW"
fi

SRC="$NEW"
if [ -L "$OLD" ] || [ ! -e "$OLD" ]; then
  [ -d "$NEW" ] || { say "no existe $NEW: nada que devolver"; exit 1; }
else
  SRC="$OLD"
fi
if [ -f "$BK/legacy-head" ] && [ -d "$SRC/.git" ]; then
  HEAD_OLD=$(cat "$BK/legacy-head")
  # the migration does not touch the code any more (one of an earlier version switched it to MiuraStation)
  if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null)" = "$HEAD_OLD" ] && git -C "$SRC" remote get-url origin 2>/dev/null | grep -qiE '[/:]${LEGACY_MIURA.repo}(\\.git)?/?$'; then
    say "git: sigue en $HEAD_OLD (${LEGACY_MIURA.repo}), no se toca"
  else
    say "git: origin -> https://github.com/${LEGACY_MIURA.repo}.git, rama ${LEGACY_MIURA.branch} en $HEAD_OLD"
    sudo git -C "$SRC" remote set-url origin https://github.com/${LEGACY_MIURA.repo}.git
    sudo git -C "$SRC" checkout -f -B ${LEGACY_MIURA.branch} "$HEAD_OLD" || say "AVISO: no se ha podido volver a $HEAD_OLD"
    sudo git -C "$SRC" reset --hard "$HEAD_OLD" >/dev/null 2>&1
  fi
  [ -f "$BK/tlm-config-base.toml" ] && sudo cp -p "$BK/tlm-config-base.toml" "$SRC/.git/tlm-config-base.toml"
else
  say "AVISO: sin $BK/legacy-head: el código se queda como está"
fi
restore_config "$SRC"
if [ "$SRC" = "$NEW" ]; then
  [ -L "$OLD" ] && sudo rm -f "$OLD"
  sudo mv "$NEW" "$OLD" && say "directorio: $NEW -> $OLD"
fi
if [ -f "$BK/flowstation.service" ] && [ ! -f "$SYSD/flowstation.service" ]; then
  sudo cp -p "$BK/flowstation.service" "$SYSD/flowstation.service" && say "unidad flowstation.service restaurada"
fi
restore_dropins "$BK/flowstation.service.d" "$SYSD/flowstation.service.d"
sudo rm -f "$SYSD/miurastation.service"
sudo rm -rf "$SYSD/miurastation.service.d"
sudo systemctl daemon-reload
if [ -f "$BK/flowstation.enabled" ]; then
  sudo systemctl enable flowstation.service && say "flowstation.service habilitado de nuevo"
fi
finish flowstation.service "la FlowStation miura de $OLD"
`;
}

// Migración to the package, from either of:
// - legacy: the miura FlowStation (/root/flowstation, ea5gvk/flowstation · miura, flowstation.service). The whole
//   directory moves to /root/miurastation (config.toml, logs, caches) and /root/flowstation -> /root/miurastation
//   stays; its drop-ins move to miurastation.service.d; flowstation.service is disabled and removed.
// - source: a MiuraStation built from source in /root/miurastation with the unit the panel wrote in
//   /etc/systemd/system, which would hide the package's: it is disabled and removed, its drop-ins stay.
// Then the release's .deb is installed (its postinst never overwrites config.toml) and the station keeps its enabled
// state. Nothing is stopped until the copies, rollback.sh and the checked .deb are in place; any failure after that
// runs the rollback. Safe to run again: a run that was cut resumes (each step checks; the kind is in the copies).
// The config merge, active-station.json and the start are done by the caller (Node) when it ends with 0.
export function migrationScript(L: Layout, opts: { tag: string; version: string; reserveCores?: string | null }): string {
  const M = PRODUCTS.miura;
  const oldDir = productDir(PRODUCTS.razvan, L), newDir = productDir(M, L);
  const BK = migrationBackupDir(L);
  return `
set -u
${lockCmd(L)}OLD="${oldDir}"; NEW="${newDir}"; BK="${BK}"; SYSD="${L.systemd}"
OLD_SVC=flowstation.service; NEW_SVC=${M.service}
MARK="${wasActiveMark(M, L)}"
${releaseVars(opts.tag, opts.version)}step() { echo ""; echo "=== Migración $1 ==="; }
say() { echo "  $*"; }
stop_here() {
  echo ""; echo "=== MIGRACIÓN DETENIDA: $* ==="
  if [ "\${TOUCHED:-0}" = 1 ]; then echo "La migración sigue a medias, como estaba: resuélvelo y vuelve a lanzarla."; else echo "Nada se ha cambiado."; fi
  exit 1
}
restart_old() {
  if [ -f "$MARK" ]; then
    say "arrancando de nuevo \${RUN_SVC:-$NEW_SVC} (estaba en marcha)"
    sudo systemctl start "\${RUN_SVC:-$NEW_SVC}"
    sudo rm -f "$MARK"
  fi
}
undo() {
  echo ""
  echo "=== MIGRACIÓN FALLIDA: $* ==="
  if [ -f "$BK/rollback.sh" ]; then
    echo "=== Se deshace todo (${BK}/rollback.sh) ==="
    sudo bash "$BK/rollback.sh"
  else
    echo "=== No hay ${BK}/rollback.sh: no se puede deshacer. La migración queda a medias: vuelve a lanzarla cuando se resuelva el fallo. ==="
  fi
  restart_old
  exit 1
}
# before the station is stopped nothing has changed, unless a run that was cut had already changed something
fail() { if [ "\${TOUCHED:-0}" = 1 ]; then undo "$@"; else stop_here "$@"; fi; }
${isSourceUnitFn}${aptInstall("")}
echo "=== Migración a MiuraStation (paquete .deb de ${DIST_REPO}, $TAG) ==="

step "1/9: comprobando el punto de partida"
RESUMING=0
if [ -d "$BK" ] && [ ! -f "$BK/done" ]; then
  RESUMING=1
  # a migration of an earlier version (no "kind") was always from the miura FlowStation
  KIND=$(cat "$BK/kind" 2>/dev/null); [ "$KIND" = source ] || KIND=legacy
elif [ -d "$NEW" ] && [ ! -L "$NEW" ] && is_source_unit "$SYSD/$NEW_SVC"; then
  KIND=source
else
  KIND=legacy
fi
if [ "$KIND" = legacy ]; then
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
  TOUCHED=$MOVED; RUN_SVC=$OLD_SVC; SVCS="$OLD_SVC $NEW_SVC"
  say "desde: $OLD (${LEGACY_MIURA.repo} · ${LEGACY_MIURA.branch}, $OLD_SVC)"
  say "a:     $NEW (paquete miurastation, $NEW_SVC)"
  say "config.toml, logs y cachés se conservan: se mueve el directorio entero."
else
  { [ -d "$NEW" ] && [ ! -L "$NEW" ]; } || stop_here "no hay ninguna MiuraStation en $NEW"
  MOVED=1; SRC="$NEW"; RUN_SVC=$NEW_SVC; SVCS=$NEW_SVC
  TOUCHED=0
  [ "$RESUMING" = 1 ] && ! is_source_unit "$SYSD/$NEW_SVC" && TOUCHED=1
  [ "$RESUMING" = 1 ] && say "una migración anterior se cortó: se continúa"
  say "desde: MiuraStation compilada en $NEW ($SYSD/$NEW_SVC propia)"
  say "a:     paquete miurastation ($NEW_SVC del paquete; los drop-ins se quedan)"
  say "config.toml, logs y cachés se quedan en $NEW, y también el código y target/ (bórralos a mano cuando ya no quieras volver atrás)."
fi
[ -f "$SRC/config.toml" ] && say "config.toml: $SRC/config.toml" || say "AVISO: $SRC no tiene config.toml (se usará la plantilla del paquete)"
${archCheck("fail")}
step "2/9: copias de seguridad y vuelta atrás en $BK"
# Nothing is stopped or moved until the copies are in place and checked, and the package is downloaded and checked.
if [ -e "$BK" ] && { [ "$RESUMING" = 0 ] || { [ "$KIND" = legacy ] && [ "$MOVED" = 0 ]; }; }; then
  sudo mv "$BK" "$BK.anterior-$(date +%Y%m%d-%H%M%S)"
  say "había copias de un intento o una migración anterior: apartadas"
fi
sudo mkdir -p "$BK" || stop_here "no se ha podido crear $BK (¿disco lleno?)"
sudo chmod 700 "$BK"
[ -s "$BK/kind" ] || echo "$KIND" | sudo tee "$BK/kind" > /dev/null
[ "$(cat "$BK/kind" 2>/dev/null)" = "$KIND" ] || stop_here "no se ha podido escribir $BK/kind (¿disco lleno?)"
# the package that was there before (none, normally): the rollback only purges one that the migration installed
[ -f "$BK/pkg-before" ] || dpkg-query -W -f='\${Version}' miurastation 2>/dev/null | sudo tee "$BK/pkg-before" > /dev/null
if [ "$KIND" = legacy ]; then
  # only while $SRC is still on the miura FlowStation (a re-run after an earlier version's switch must not record MiuraStation)
  if [ ! -s "$BK/legacy-head" ] && git -C "$SRC" remote get-url origin 2>/dev/null | grep -qi '${LEGACY_MIURA.repo}'; then
    if ! { sudo sh -c 'git -C "$1" rev-parse HEAD > "$2"' _ "$SRC" "$BK/legacy-head" && [ -s "$BK/legacy-head" ]; }; then
      stop_here "no se ha podido guardar en $BK el commit de la FlowStation miura (¿disco lleno?)"
    fi
    say "commit de la FlowStation miura: $(cat "$BK/legacy-head")"
  fi
  [ -f "$BK/tlm-config-base.toml" ] || { [ -f "$SRC/.git/tlm-config-base.toml" ] && sudo cp -p "$SRC/.git/tlm-config-base.toml" "$BK/tlm-config-base.toml"; }
fi
CFG_BAK=""
if [ -f "$SRC/config.toml" ]; then
  CFG_BAK="$BK/config.toml.bak-$(date +%Y%m%d-%H%M%S)"
  if ! { sudo cp -p "$SRC/config.toml" "$CFG_BAK" && sudo cmp -s "$SRC/config.toml" "$CFG_BAK"; }; then
    sudo rm -f "$CFG_BAK"
    stop_here "no se ha podido copiar config.toml en $BK (¿disco lleno?)"
  fi
  sudo chmod 600 "$CFG_BAK"
  say "config.toml copiado en $CFG_BAK"
fi
if [ "$KIND" = legacy ]; then
  if [ ! -s "$BK/flowstation.service" ] && [ -f "$SYSD/$OLD_SVC" ]; then
    if ! { sudo cp -p "$SYSD/$OLD_SVC" "$BK/flowstation.service" && sudo cmp -s "$SYSD/$OLD_SVC" "$BK/flowstation.service"; }; then
      sudo rm -f "$BK/flowstation.service"
      stop_here "no se ha podido copiar $OLD_SVC en $BK (¿disco lleno?)"
    fi
    say "unidad $OLD_SVC copiada"
  fi
  if [ ! -d "$BK/flowstation.service.d" ] && [ -d "$SYSD/$OLD_SVC.d" ]; then
    sudo cp -rp "$SYSD/$OLD_SVC.d" "$BK/flowstation.service.d" && say "drop-ins de $OLD_SVC copiados"
  fi
else
  if [ ! -s "$BK/miurastation.service" ] && is_source_unit "$SYSD/$NEW_SVC"; then
    if ! { sudo cp -p "$SYSD/$NEW_SVC" "$BK/miurastation.service" && sudo cmp -s "$SYSD/$NEW_SVC" "$BK/miurastation.service"; }; then
      sudo rm -f "$BK/miurastation.service"
      stop_here "no se ha podido copiar $NEW_SVC en $BK (¿disco lleno?)"
    fi
    say "unidad $NEW_SVC (compilada) copiada"
  fi
  if [ ! -d "$BK/miurastation.service.d" ] && [ -d "$SYSD/$NEW_SVC.d" ]; then
    sudo cp -rp "$SYSD/$NEW_SVC.d" "$BK/miurastation.service.d" && say "drop-ins de $NEW_SVC copiados"
  fi
fi
ROLLBACK=${sq(rollbackScript(L))}
printf '%s' "$ROLLBACK" | sudo tee "$BK/rollback.sh" > /dev/null
printf '%s' "$ROLLBACK" | sudo cmp -s - "$BK/rollback.sh" || stop_here "no se ha podido escribir $BK/rollback.sh (¿disco lleno?)"
sudo chmod 700 "$BK/rollback.sh"
say "vuelta atrás manual: sudo bash $BK/rollback.sh"
sudo rm -f "$BK/done"

step "3/9: paquete $DEB ($TAG)"
${fetchDeb(L, "fail")}
step "4/9: parando la estación"
# A resumed migration keeps the mark of the run that was cut: that run stopped the station, which goes back on air.
[ "$RESUMING" = 0 ] && sudo rm -f "$MARK"
[ -f "$MARK" ] && say "la paró la ejecución que se cortó: se arrancará al terminar"
for s in $SVCS; do
  st=$(systemctl is-active $s 2>/dev/null)
  if [ "$st" = active ] || [ "$st" = activating ]; then
    sudo touch "$MARK"
    say "$s estaba en marcha: se para (se arrancará al terminar)"
    sudo systemctl stop $s
  fi
done
[ -f "$MARK" ] || say "la estación no estaba en marcha: se quedará parada"
# enabled at the start of the first run (a resumed one finds the units already changed)
if [ ! -s "$BK/was-enabled" ]; then
  WAS_ENABLED=0
  for s in $SVCS; do systemctl is-enabled --quiet $s 2>/dev/null && WAS_ENABLED=1; done
  echo "$WAS_ENABLED" | sudo tee "$BK/was-enabled" > /dev/null
fi
WAS_ENABLED=$(cat "$BK/was-enabled" 2>/dev/null || echo 0)

if [ "$KIND" = legacy ]; then
  step "5/9: moviendo $OLD -> $NEW"
  if [ "$MOVED" = 0 ]; then
    sudo mv "$OLD" "$NEW" || { restart_old; stop_here "no se ha podido mover $OLD"; }
    MOVED=1; TOUCHED=1
    say "movido (config.toml, logs y cachés van dentro)"
  fi
  if [ ! -e "$OLD" ] && [ ! -L "$OLD" ]; then
    sudo ln -s "$NEW" "$OLD" || undo "no se ha podido crear el enlace $OLD"
  fi
  say "enlace $OLD -> $NEW (para scripts y rutas antiguas)"
else
  step "5/9: $NEW se queda donde está"
  say "config.toml, logs y cachés no se mueven"
fi
# the :8080 service control restarts the unit named here, and flowstation.service is gone after the migration
if sudo grep -qE '^[ \\t]*service_name[ \\t]*=[ \\t]*"flowstation(\\.service)?"' "$NEW/config.toml" 2>/dev/null; then
  sudo sed -i -E 's/^([ \\t]*service_name[ \\t]*=[ \\t]*)"flowstation(\\.service)?"/\\1"${M.dirName}"/' "$NEW/config.toml" && say "config.toml: service_name = \\"${M.dirName}\\""
fi

step "6/9: unidades de systemd"
if [ "$KIND" = legacy ]; then
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
else
  if is_source_unit "$SYSD/$NEW_SVC"; then
    systemctl is-enabled --quiet $NEW_SVC 2>/dev/null && sudo touch "$BK/miurastation.enabled"
    sudo systemctl disable $NEW_SVC 2>/dev/null
    sudo rm -f "$SYSD/$NEW_SVC" || undo "no se ha podido retirar $SYSD/$NEW_SVC"
    TOUCHED=1
    say "$SYSD/$NEW_SVC (compilada) deshabilitada y retirada (copia en $BK/miurastation.service); los drop-ins se quedan"
  fi
fi
sudo systemctl daemon-reload

step "7/9: paquete miurastation $VER"
sudo touch "$BK/pkg-installed" # from here the rollback purges it
apt_install_deb || undo "apt-get install ha fallado"
${checkInstalled(L, "undo")}if [ "$WAS_ENABLED" = 1 ]; then
  sudo systemctl enable $NEW_SVC && say "$NEW_SVC habilitado (arranca con la Pi)"
else
  sudo systemctl disable $NEW_SVC 2>/dev/null
  say "la estación no estaba habilitada: $NEW_SVC tampoco"
fi

step "8/9: watchdog de systemd"
${watchdogSync(M, L, pkgBinPath(L))}

step "9/9: núcleos reservados"
${reserveCoresCmd(opts.reserveCores ?? null) || "say \"(sin script de reserva de núcleos)\"\n"}
sudo touch "$BK/done"
echo ""
echo "=== Migración completada: ${M.name} $VER (paquete) con $NEW_SVC; config.toml, logs y cachés en $NEW ==="
if [ "$KIND" = legacy ]; then
  echo "Si algo no va bien: sudo bash $BK/rollback.sh (vuelve a la FlowStation miura tal como estaba)."
else
  echo "Si algo no va bien: sudo bash $BK/rollback.sh (vuelve a la MiuraStation compilada tal como estaba)."
fi
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
/** What is checked out in `dir`: razvan / MiuraStation (built from source) / the miura FlowStation, or null
 *  (unknown or no repo; the package has none). */
export function detectInstall(dir: string): Installed {
  try {
    const opts = { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] as any };
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], opts).toString();
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], opts).toString().trim();
    if (urlIsRepo(url, PRODUCTS.razvan.repo) && branch === PRODUCTS.razvan.branch) return "razvan";
    if (urlIsRepo(url, MIURA_SOURCE.repo) && branch === MIURA_SOURCE.branch) return "miura";
    if (urlIsRepo(url, LEGACY_MIURA.repo) && branch === LEGACY_MIURA.branch) return "legacy";
  } catch { /* not a repo */ }
  return null;
}

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** `file` is the unit of a source install (a real file whose ExecStart runs a target/release/ binary). In
 *  /etc/systemd/system it hides the package's unit. */
export function isSourceUnit(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile() && /^ExecStart=.*\/target\/release\//m.test(fs.readFileSync(file, "utf-8"));
  } catch { return false; }
}

/** The miurastation package is installed and its unit is the one in use (no source unit hides it). */
export function miuraPackaged(L: Layout): boolean {
  return fs.existsSync(pkgBinPath(L)) && isFile(pkgUnitPath(L)) && !isSourceUnit(unitPath(PRODUCTS.miura, L));
}

// "needed": the miura FlowStation is in /root/flowstation and there is no /root/miurastation (kind "legacy"), or
// MiuraStation was built from source and has its own unit in /etc/systemd/system (kind "source").
// "resume": a migration was cut: its copies are there without the "done" that its last step writes, or (one of an
// earlier version) the moved directory is still on the old code.
export type MigrationState = "none" | "needed" | "resume";
export type MigrationKind = "legacy" | "source";
export function migrationInfo(L: Layout): { state: MigrationState; kind: MigrationKind | null } {
  const none = { state: "none" as const, kind: null };
  const o = productDir(PRODUCTS.razvan, L), n = productDir(PRODUCTS.miura, L);
  if (!lexists(n)) return lexists(o) && !isLink(o) && detectInstall(o) === "legacy" ? { state: "needed", kind: "legacy" } : none;
  const bk = migrationBackupDir(L);
  let cut: MigrationKind | null = null;
  if (fs.existsSync(bk) && !fs.existsSync(`${bk}/done`)) {
    cut = "legacy"; // an earlier version's copies have no "kind": they were always from the miura FlowStation
    try { if (fs.readFileSync(`${bk}/kind`, "utf-8").trim() === "source") cut = "source"; } catch { /* legacy */ }
  }
  if (cut === "source") return { state: "resume", kind: "source" };
  // /root/flowstation is gone or is the link a migration leaves: the miura FlowStation moved to /root/miurastation
  // (its code stays there once the package is in use: then it is done)
  if ((isMigrationLink(L) || !lexists(o)) && (cut === "legacy" || (!miuraPackaged(L) && detectInstall(n) === "legacy"))) {
    return { state: "resume", kind: "legacy" };
  }
  if (isSourceUnit(unitPath(PRODUCTS.miura, L))) return { state: "needed", kind: "source" };
  return none;
}
export const migrationState = (L: Layout): MigrationState => migrationInfo(L).state;

/** MiuraStation is installed: its directory and a unit, the package's or a source install's (a bare clone, a
 *  migration cut short or a masked unit is not). */
export function miuraInstalled(L: Layout): boolean {
  return fs.existsSync(productDir(PRODUCTS.miura, L)) && (isFile(unitPath(PRODUCTS.miura, L)) || isFile(pkgUnitPath(L)));
}

// ── MiuraStation releases (pure) ──

export interface MiuraRelease { tag: string; version: string; sha: string | null; name: string; date: string; author: string; url: string }
export const RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;

/** A release of the GitHub API (releases/latest or releases/tags/<tag>), or null if it is not a usable one. The
 *  version is the tag's; the marker in the body (<!-- miura-build: version=X.Y.Z sha=<40 hex> -->) gives the source
 *  commit, and one that names another version means the release is not what it says. */
export function parseRelease(j: any): MiuraRelease | null {
  const tag = typeof j?.tag_name === "string" ? j.tag_name : "";
  const m = RELEASE_TAG_RE.exec(tag);
  if (!m || j.draft) return null;
  const mk = /<!--\s*miura-build:\s*version=(\S+)\s+sha=([0-9a-f]{40})\s*-->/.exec(typeof j.body === "string" ? j.body : "");
  if (mk && mk[1] !== m[1]) return null;
  return {
    tag, version: m[1], sha: mk ? mk[2] : null,
    name: typeof j.name === "string" && j.name ? j.name : `MiuraStation ${m[1]}`,
    date: typeof j.published_at === "string" ? j.published_at : "",
    author: typeof j.author?.login === "string" ? j.author.login : "",
    url: typeof j.html_url === "string" ? j.html_url : `https://github.com/${DIST_REPO}/releases/tag/${tag}`,
  };
}

/** A dpkg Version of the package as a release version: "1.2.0-1" -> "1.2.0", "1.2.0~beta.1-1" -> "1.2.0-beta.1". */
export function debUpstreamVersion(v: string): string {
  const s = v.trim(), i = s.lastIndexOf("-");
  return (i > 0 ? s.slice(0, i) : s).replace(/~/g, "-");
}

/** Order of two release versions X.Y.Z[-pre] (semver: a pre-release goes before its release): <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const re = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
  const x = re.exec(a.trim()), y = re.exec(b.trim());
  if (!x || !y) return a === b ? 0 : a < b ? -1 : 1;
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d; }
  if (!x[4] || !y[4]) return (x[4] ? -1 : 0) + (y[4] ? 1 : 0);
  const xs = x[4].split("."), ys = y[4].split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (i >= xs.length) return -1;
    if (i >= ys.length) return 1;
    const xn = /^\d+$/.test(xs[i]), yn = /^\d+$/.test(ys[i]);
    if (xn && yn) { const d = Number(xs[i]) - Number(ys[i]); if (d) return d; }
    else if (xn !== yn) return xn ? -1 : 1;
    else if (xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}
