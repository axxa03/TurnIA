# Deploy en DonWeb (Cloud Server)

## 1. Preparar el servidor (panel DonWeb)
1. Cloud Servers → tu servidor → **Instalar** → elegir **Ubuntu 24.04 o 22.04** (sin panel).
2. Anotar la **IP pública** y el acceso root.
3. Dominios & DNS → `dwday-1252350.online` → crear registros **A** para `@` y `www` apuntando a la IP. La propagación puede tardar unos minutos.

## 2. Instalar TurnIA
Conectarse por SSH (`ssh root@IP`) y ejecutar:
```bash
apt-get update && apt-get install -y git
git clone https://github.com/<usuario>/turnia.git /opt/turnia
bash /opt/turnia/deploy/setup.sh dwday-1252350.online
```
El script instala Node 22 y Nginx, configura la zona horaria, crea el usuario `turnia`, genera `.env` con un `SESSION_SECRET` aleatorio, guarda la base en `/var/lib/turnia/turnia.db`, crea el servicio systemd `turnia` y el proxy Nginx en el puerto 80.

Sin GitHub también se puede subir la carpeta con `scp -r . root@IP:/opt/turnia` y ejecutar el mismo script.

## 3. Verificar
```bash
systemctl status turnia
curl http://127.0.0.1:3000/api/health
```
Desde afuera: `http://dwday-1252350.online` y `/admin`. Mientras el DNS no propaga, se puede probar con `http://IP`.

Persistencia: `systemctl restart turnia` y comprobar que las reservas siguen ahí.

## 4. HTTPS (opcional)
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d dwday-1252350.online -d www.dwday-1252350.online
```

## 5. IA opcional (API DonWeb)
Editar `/opt/turnia/.env` (solo root puede leerlo) y completar `AI_API_URL`, `AI_API_KEY` y `AI_MODEL`. Después:
```bash
systemctl restart turnia
```
Y activar en *Panel → Asistente*.

## Actualizar
```bash
cd /opt/turnia && git pull && chown -R turnia:turnia /opt/turnia && systemctl restart turnia
```
