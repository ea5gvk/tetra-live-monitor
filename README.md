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

### Resumen de puertos

| Servicio | Puerto |
|----------|--------|
| Aplicación web | 5000 |
| Nginx (opcional) | 80 / 443 |
| WebSocket | mismo que la app (5000) |

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

### Port summary

| Service | Port |
|---------|------|
| Web application | 5000 |
| Nginx (optional) | 80 / 443 |
| WebSocket | same as app (5000) |
