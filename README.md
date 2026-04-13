# TETRA Live Monitor

Real-time TETRA radio network monitoring dashboard / Panel de monitoreo en tiempo real de redes de radio TETRA

---

# Español

## Guía de Instalación

### Requisitos previos

- **Node.js** v20 o superior
- **Python 3** con pip
- **Git**
- Un servidor VPS con Linux (Ubuntu/Debian recomendado)

---

### 1. Instalar en un VPS

#### 1.1 Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

Verifica la instalación:

```bash
node --version
npm --version
```

#### 1.2 Instalar Python 3

```bash
sudo apt install -y python3 python3-pip
```

#### 1.3 Clonar el repositorio

```bash
cd /opt
git clone https://github.com/ea5gvk/tetra-live-monitor.git
cd tetra-live-monitor
```

#### 1.4 Instalar dependencias

```bash
# Dependencias de Node.js
npm install

# Dependencia de Python (para buscar indicativos en radioid.net)
pip3 install requests
```

#### 1.5 Compilar el proyecto

```bash
npm run build
```

Esto genera la carpeta `dist/` con la aplicación compilada.

#### 1.6 Ejecutar la aplicación

```bash
NODE_ENV=production node dist/index.cjs
```

La aplicación arrancará en el puerto **5000**. Accede desde el navegador: `http://IP_DE_TU_VPS:5000`

**Nota:** Si tu VPS tiene `journalctl` con logs TETRA, el monitor los procesará automáticamente. Si no, arrancará en modo demo. Para forzar el modo demo:

```bash
TETRA_DEMO=1 NODE_ENV=production node dist/index.cjs
```

---

### 2. Mantener el servicio activo con PM2

Para que la aplicación siga funcionando en segundo plano y se reinicie automáticamente:

```bash
# Instalar PM2
sudo npm install -g pm2

# Iniciar la aplicación
cd /opt/tetra-live-monitor
pm2 start dist/index.cjs --name tetra-monitor --env production

# Guardar la configuración
pm2 save

# Configurar inicio automático con el sistema
pm2 startup
```

Comandos útiles de PM2:

```bash
pm2 status              # Ver estado
pm2 logs tetra-monitor  # Ver logs en tiempo real
pm2 restart tetra-monitor  # Reiniciar
pm2 stop tetra-monitor     # Parar
```

---

### 3. Actualizar la aplicación

Cuando haya cambios nuevos en GitHub:

```bash
cd /opt/tetra-live-monitor
git pull
npm install
npm run build
pm2 restart tetra-monitor
```

---

### 4. Configurar un proxy inverso con Nginx (opcional)

Para acceder por el puerto 80/443 con un dominio:

```bash
sudo apt install -y nginx
```

Crea el archivo de configuración:

```bash
sudo nano /etc/nginx/sites-available/tetra-monitor
```

Contenido:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar y reiniciar Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/tetra-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**Importante:** Las líneas de `Upgrade` y `Connection` son necesarias para que funcione el WebSocket.

---

### 5. Contraseña para apagar/reiniciar la Raspberry Pi

El dashboard incluye botones para apagar y reiniciar la Raspberry Pi. Estos botones están protegidos con contraseña.

Para configurar la contraseña, edita el archivo `config.json` en la raíz del proyecto:

```json
{
  "systemPassword": "tu_contraseña_aquí"
}
```

Puedes cambiar la contraseña en cualquier momento editando ese archivo. No es necesario reiniciar la aplicación, el cambio se aplica inmediatamente.

**Nota:** Para que los comandos de apagado y reinicio funcionen, el usuario que ejecuta la aplicación debe tener permisos de `sudo` sin contraseña. Añade esta línea a `/etc/sudoers` (con `sudo visudo`):

```
tu_usuario ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/reboot, /bin/systemctl
```

---

### 6. Gestor de VPN WireGuard

El dashboard incluye una pestaña **VPN** que permite configurar un servidor WireGuard directamente desde el navegador. Soporta 7 idiomas (ES, EN, ZH, PT, DE, FR, IT).

#### 6.1 Instalar WireGuard en la Raspberry Pi

Desde la pestaña **VPN** del dashboard, pulsa **"Instalar WireGuard"** e introduce la contraseña del sistema. También puedes hacerlo manualmente:

```bash
sudo apt install -y wireguard
```

#### 6.2 Permisos sudo necesarios

Para que el dashboard pueda gestionar WireGuard, añade a `/etc/sudoers` (con `sudo visudo`):

```
tu_usuario ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/shutdown, /sbin/reboot, /bin/systemctl, /usr/bin/apt-get
```

#### 6.3 Configurar el servidor VPN desde el dashboard

1. Ve a la pestaña **VPN**
2. Despliega el panel **CONFIGURACIÓN DEL SERVIDOR**
3. Rellena los campos:
   - **IP WireGuard del Servidor**: dirección IP de la interfaz VPN (por defecto `10.8.0.1/24`)
   - **Puerto de escucha**: puerto UDP de WireGuard (por defecto `51820`)
   - **DNS para clientes**: servidor DNS que usarán los clientes (por defecto `8.8.8.8`)
4. Pulsa **"Configurar Servidor"** e introduce la contraseña del sistema
5. Una vez configurado, pulsa **"Conectar"** para activar la interfaz `wg0`

#### 6.4 Añadir clientes (móvil, tablet, PC)

1. En el panel **CLIENTES VPN**, escribe un nombre para el cliente (ej: `movil`, `tablet`)
2. Pulsa **"Añadir"** e introduce la contraseña
3. El cliente aparecerá en la lista con su IP asignada automáticamente (`10.8.0.2`, `10.8.0.3`, ...)
4. Pulsa el botón **QR** del cliente para ver el código QR de configuración

#### 6.5 Conectar el móvil

1. Instala la app **WireGuard** en tu móvil ([Android](https://play.google.com/store/apps/details?id=com.wireguard.android) / [iOS](https://apps.apple.com/app/wireguard/id1441195209))
2. En la app: **Añadir túnel → Escanear desde código QR**
3. Escanea el QR mostrado en el dashboard
4. Activa el túnel en la app

#### 6.6 Reenvío de puertos en el router

Para acceso remoto (fuera de tu red local), debes abrir el puerto UDP en tu router:

- **Puerto**: `51820` (o el que hayas configurado)
- **Protocolo**: UDP
- **Destino**: IP local de la Raspberry Pi

#### 6.7 Resumen de funcionamiento

```
Móvil (app WireGuard)
       │ UDP 51820
       ▼
   Router (reenvío de puertos)
       │
       ▼
Raspberry Pi (wg0: 10.8.0.1)
       │
       ▼
   Red local TETRA / bluestation
```

Los datos de los clientes (claves, IPs asignadas) se guardan en `vpn-data.json` en la raíz del proyecto.

---

### Resumen de puertos

| Servicio | Puerto | Protocolo |
|----------|--------|-----------|
| Aplicación web | 5000 | TCP |
| Nginx (opcional) | 80 / 443 | TCP |
| WebSocket | mismo que la app (5000) | TCP |
| WireGuard VPN | 51820 | UDP |

---
---

# English

## Installation Guide

### Prerequisites

- **Node.js** v20 or higher
- **Python 3** with pip
- **Git**
- A VPS server running Linux (Ubuntu/Debian recommended)

---

### 1. Install on a VPS

#### 1.1 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

Verify the installation:

```bash
node --version
npm --version
```

#### 1.2 Install Python 3

```bash
sudo apt install -y python3 python3-pip
```

#### 1.3 Clone the repository

```bash
cd /opt
git clone https://github.com/ea5gvk/tetra-live-monitor.git
cd tetra-live-monitor
```

#### 1.4 Install dependencies

```bash
# Node.js dependencies
npm install

# Python dependency (for callsign lookup on radioid.net)
pip3 install requests
```

#### 1.5 Build the project

```bash
npm run build
```

This generates the `dist/` folder with the compiled application.

#### 1.6 Run the application

```bash
NODE_ENV=production node dist/index.cjs
```

The application will start on port **5000**. Open your browser at: `http://YOUR_VPS_IP:5000`

**Note:** If your VPS has `journalctl` with TETRA logs, the monitor will process them automatically. Otherwise, it will start in demo mode. To force demo mode:

```bash
TETRA_DEMO=1 NODE_ENV=production node dist/index.cjs
```

---

### 2. Keep the service running with PM2

To keep the application running in the background and auto-restart on crashes:

```bash
# Install PM2
sudo npm install -g pm2

# Start the application
cd /opt/tetra-live-monitor
pm2 start dist/index.cjs --name tetra-monitor --env production

# Save the configuration
pm2 save

# Configure auto-start on system boot
pm2 startup
```

Useful PM2 commands:

```bash
pm2 status              # Check status
pm2 logs tetra-monitor  # View real-time logs
pm2 restart tetra-monitor  # Restart
pm2 stop tetra-monitor     # Stop
```

---

### 3. Update the application

When there are new changes on GitHub:

```bash
cd /opt/tetra-live-monitor
git pull
npm install
npm run build
pm2 restart tetra-monitor
```

---

### 4. Configure a reverse proxy with Nginx (optional)

To access via port 80/443 with a domain name:

```bash
sudo apt install -y nginx
```

Create the configuration file:

```bash
sudo nano /etc/nginx/sites-available/tetra-monitor
```

Contents:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/tetra-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**Important:** The `Upgrade` and `Connection` headers are required for WebSocket support.

---

### 5. Password for shutdown/reboot buttons

The dashboard includes buttons to shut down and reboot the Raspberry Pi. These buttons are password-protected.

To set the password, edit the `config.json` file in the project root:

```json
{
  "systemPassword": "your_password_here"
}
```

You can change the password at any time by editing this file. No application restart is needed — the change takes effect immediately.

**Note:** For the shutdown and reboot commands to work, the user running the application must have passwordless `sudo` permissions. Add this line to `/etc/sudoers` (using `sudo visudo`):

```
your_user ALL=(ALL) NOPASSWD: /sbin/shutdown, /sbin/reboot, /bin/systemctl
```

---

### 6. WireGuard VPN Manager

The dashboard includes a **VPN** tab that lets you set up and manage a WireGuard server directly from the browser. Supports 7 languages (ES, EN, ZH, PT, DE, FR, IT).

#### 6.1 Install WireGuard on the Raspberry Pi

From the **VPN** tab in the dashboard, click **"Install WireGuard"** and enter the system password. You can also install it manually:

```bash
sudo apt install -y wireguard
```

#### 6.2 Required sudo permissions

For the dashboard to manage WireGuard, add the following to `/etc/sudoers` (using `sudo visudo`):

```
your_user ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/shutdown, /sbin/reboot, /bin/systemctl, /usr/bin/apt-get
```

#### 6.3 Configure the VPN server from the dashboard

1. Go to the **VPN** tab
2. Expand the **SERVER CONFIGURATION** panel
3. Fill in the fields:
   - **Server WireGuard IP**: IP address of the VPN interface (default: `10.8.0.1/24`)
   - **Listen Port**: UDP port for WireGuard (default: `51820`)
   - **DNS for clients**: DNS server that clients will use (default: `8.8.8.8`)
4. Click **"Setup Server"** and enter the system password
5. Once configured, click **"Connect"** to bring up the `wg0` interface

#### 6.4 Add clients (mobile, tablet, PC)

1. In the **VPN CLIENTS** panel, type a name for the client (e.g. `mobile`, `tablet`)
2. Click **"Add"** and enter the system password
3. The client will appear in the list with an automatically assigned IP (`10.8.0.2`, `10.8.0.3`, ...)
4. Click the **QR** button to display the configuration QR code

#### 6.5 Connect your mobile device

1. Install the **WireGuard** app on your mobile ([Android](https://play.google.com/store/apps/details?id=com.wireguard.android) / [iOS](https://apps.apple.com/app/wireguard/id1441195209))
2. In the app: **Add tunnel → Scan from QR code**
3. Scan the QR code displayed in the dashboard
4. Activate the tunnel in the app

#### 6.6 Port forwarding on your router

For remote access (outside your local network), you need to forward the UDP port on your router:

- **Port**: `51820` (or whichever you configured)
- **Protocol**: UDP
- **Destination**: Local IP address of the Raspberry Pi

#### 6.7 How it works

```
Mobile (WireGuard app)
       │ UDP 51820
       ▼
   Router (port forwarding)
       │
       ▼
Raspberry Pi (wg0: 10.8.0.1)
       │
       ▼
   Local TETRA network / bluestation
```

Client data (keys, assigned IPs) is stored in `vpn-data.json` at the project root.

---

### Port summary

| Service | Port | Protocol |
|---------|------|----------|
| Web application | 5000 | TCP |
| Nginx (optional) | 80 / 443 | TCP |
| WebSocket | same as app (5000) | TCP |
| WireGuard VPN | 51820 | UDP |
