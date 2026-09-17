# Cloudflare Tunnel

The public hostname `tcache.mangagaki.net` should forward to the loopback-only
testbed port on the Mac mini. Nginx in the testbed container serves the React
application and proxies backend requests to `tcache-server`.

1. Create a tunnel in Cloudflare Zero Trust and map `tcache.mangagaki.net` to it.
2. Copy `config.example.yml` outside the repository and replace `<TUNNEL_ID>`.
3. Keep the tunnel JSON credential or remotely managed tunnel token outside Git.
4. Run `cloudflared tunnel --config /path/to/config.yml run` as a managed service.

Only `127.0.0.1:3200` and `127.0.0.1:3201` are published by Docker Compose.
Redis has no host port. Firewall rules should continue to block direct inbound
access to these local ports.
