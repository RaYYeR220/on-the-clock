# on-the-clock

Check vulnerability-disclosure clocks on [Arkiv](https://arkiv.network) without trusting anyone's
backend, or run a watcher that releases them when they lapse.

Part of [On the Clock](https://on-the-clock-arkiv.vercel.app) ([source](https://github.com/RaYYeR220/on-the-clock)).

```bash
npx on-the-clock board                 # every case, its status and time left
npx on-the-clock verify <caseKey>      # rebuild one case from Arkiv and check every act on it
npx on-the-clock inboxes               # vendor inboxes accepting reports
npx on-the-clock queries <caseKey>     # print the exact Arkiv queries verify runs
```

Add `--json` to `board`, `verify` or `inboxes` for machine-readable output.

## Run a watcher

A watcher follows every clock that lists it. When a clock's Entity Expiration passes, it proves the
lapse (alive one block before expiry, gone now, no `EntityDeleted` in the logs) and publishes its
key share. Any k shares rebuild the advisory key.

```bash
WATCHER_PRIVATE_KEY=0x… WATCHER_OPERATOR=me WATCHER_REGION=eu PORT=8080 npx on-the-clock watch
```

| Variable | What |
|---|---|
| `WATCHER_PRIVATE_KEY` | The watcher's wallet. Testnet only. |
| `WATCHER_OPERATOR`, `WATCHER_REGION` | Labels written into the watcher's lease entity. |
| `PORT` | Optional; serves `/status` as JSON. |
| `ARKIV_RPC_URL`, `ARKIV_WS_URL` | Tiramisu endpoints (default: the public RPC). |
| `ARKIV_ACCESS_KEY` | Optional access key from hub.arkiv.network, sent as `X-API-KEY`. |

## License

MIT
