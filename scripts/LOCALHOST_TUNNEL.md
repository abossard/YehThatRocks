# Linux Localhost Tunnel to Windows Dev Server

This lets your Linux test machine open `http://localhost:3000` while your app is actually served from your Windows dev machine.

## 1) On Windows (dev machine)

Run:

```powershell
npm run tunnel:host
```

This script ensures:
- `sshd` is running
- SSH starts automatically
- firewall allows inbound TCP/22

Then start your app as usual:

```powershell
npm -w web run dev
```

## 2) On Linux (test machine)

From this repo directory:

```bash
chmod +x scripts/linux-localhost-tunnel.sh
./scripts/linux-localhost-tunnel.sh <windows-user> <windows-lan-ip> 3000 3000
```

Now open:

- `http://localhost:3000`

on Linux, and traffic is forwarded to Windows `127.0.0.1:3000`.

## Notes

- If you use a different dev port, pass it as the 3rd and 4th arguments.
- Keep the tunnel process running while testing.
- If your Windows account requires password login, SSH will prompt for it unless you set up SSH keys.
