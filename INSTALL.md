# TETRA Live Monitor - Guía de Instalación

## Requisitos previos

- **Node.js** v20 o superior
- **Python 3** con pip
- **Git**
- Un servidor VPS con Linux (Ubuntu/Debian recomendado)

---

## 1. Subir el proyecto a GitHub

### 1.1 Crear el repositorio en GitHub

1. Ve a [github.com/new](https://github.com/new)
2. Ponle un nombre al repositorio (por ejemplo `tetra-live-monitor`)
3. Elige público o privado según prefieras
4. **No** marques ninguna casilla de inicialización (ni README, ni .gitignore, ni licencia)
5. Haz clic en **"Create repository"**

### 1.2 Subir el código desde Replit

En la terminal (Shell) de Replit, ejecuta:

```bash
git remote add origin https://github.com/TU_USUARIO/tetra-live-monitor.git
git branch -M main
git push -u origin main
```

Te pedirá usuario y contraseña. Como contraseña, usa un **Personal Access Token** de GitHub:

1. Ve a GitHub > **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**
2. Haz clic en **"Generate new token (classic)"**
3. Dale un nombre, selecciona el permiso **repo** y genera el token
4. Copia el token y pégalo como contraseña cuando te lo pida la terminal

### 1.3 Actualizar GitHub con nuevos cambios

Cada vez que hagas cambios en Replit y quieras subirlos a GitHub:

```bash
git add .
git commit -m "Descripción de los cambios"
git push
```

---

## 2. Instalar en un VPS

### 2.1 Instalar Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

Verifica la instalación:

```bash
node --version
npm --version
```

### 2.2 Instalar Python 3

```bash
sudo apt install -y python3 python3-pip
```

### 2.3 Clonar el repositorio

```bash
cd /opt
git clone https://github.com/TU_USUARIO/tetra-live-monitor.git
cd tetra-live-monitor
```

### 2.4 Instalar dependencias

```bash
# Dependencias de Node.js
npm install

# Dependencia de Python (para buscar indicativos en radioid.net)
pip3 install requests
```

### 2.5 Compilar el proyecto

```bash
npm run build
```

Esto genera la carpeta `dist/` con la aplicación compilada.

### 2.6 Ejecutar la aplicación

```bash
NODE_ENV=production node dist/index.cjs
```

La aplicación arrancará en el puerto **5000**. Accede desde el navegador: `http://IP_DE_TU_VPS:5000`

**Nota:** Si tu VPS tiene `journalctl` con logs TETRA, el monitor los procesará automáticamente. Si no, arrancará en modo demo. Para forzar el modo demo:

```bash
TETRA_DEMO=1 NODE_ENV=production node dist/index.cjs
```

---

## 3. Mantener el servicio activo con PM2

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

## 4. Actualizar la aplicación

Cuando haya cambios nuevos en GitHub:

```bash
cd /opt/tetra-live-monitor
git pull
npm install
npm run build
pm2 restart tetra-monitor
```

---

## 5. Configurar un proxy inverso con Nginx (opcional)

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

## Resumen de puertos

| Servicio | Puerto |
|----------|--------|
| Aplicación web | 5000 |
| Nginx (opcional) | 80 / 443 |
| WebSocket | mismo que la app (5000) |
