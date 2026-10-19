# Security

- The server RPC URL, Neuronpedia key and X keys live only in server env. `/api/config` exposes none of them (covered by a test).
- `/api/rpc` proxies a read-only method allowlist with a per-IP rate limit.
- Votes, feature submissions, X links and the daily Lab pass are wallet-signed messages. The site never asks for a transaction or a private key.
- Report issues privately via a GitHub security advisory on this repository.
