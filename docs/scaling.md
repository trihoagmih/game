# Scalability rollout

## PR 1: single-node performance

- Room state builds the public envelope once, while each user's game view remains private.
- Gameplay/chat no longer cause lobby broadcasts unless summary or presence changed.
- Caro computation uses a bounded worker pool; outdated moves are discarded after state changes.
- `MAX_SPECTATORS_PER_ROOM` defaults to 30 (capacity is player seats + this allowance).
- A structured `runtime.metrics` log every minute reports event-loop delay, memory, sockets and rooms.

No Redis or hosting changes are required for this PR. Limits are protection, not a measured capacity guarantee.

Run `node server/test/load.mjs http://localhost:3001` against a disposable instance.
Set `APP_PASSWORD`, `LOAD_CLIENTS` (default 16), and `LOAD_ROUNDS` as needed.
The default IP limits intentionally constrain a single load generator. Do not disable production limits merely to run a benchmark.
Compare p95/p99 acknowledgments with `runtime.metrics`, outbound traffic and representative drawing/bot workloads.
This smoke load generator is not a production capacity certification.

## PR 2: room ownership and routing

Set `REDIS_URL`, stable `NODE_ID` and identical `CLUSTER_NODES` on all shards to enable clustering.
Without `REDIS_URL`, the application stays in its existing single-node mode.
Each room is owned by one shard. The shared directory refreshes every two seconds.
Creation picks an available shard with fewer rooms. Joining an existing room routes to its owner.
The browser reconnects via `/nodes/<id>/socket.io` and resumes the create/join request.
An identity transfer requires closing other tabs; concurrent membership on two shards is refused.
New node IDs require matching proxy routes before they are added to `CLUSTER_NODES`.

Redis leases reject duplicate shard processes and fail closed on a lost lease or Redis connection.
The proxy pins the full Socket.IO connection, including polling, to the explicitly selected shard.
This does not require a broadcast adapter because room traffic stays local; the global directory is shared through Redis.
Shard IDs stay stable across restarts. Removing a shard requires draining/migrating its rooms first.
Per-IP connection/rate limits remain per shard; add a proxy-wide limit before exposing a larger public cluster.

Run `TEST_REDIS_URL=redis://localhost:6379 node --test server/test/cluster.test.js` for real Redis lease/identity tests.

## PR 3: checkpoint recovery and shutdown

Cluster mode also requires a shared, independent 64-hex-character `SNAPSHOT_KEY`.
Registered game state is encrypted and checkpointed every two seconds, with a final checkpoint on graceful shutdown.
All 12 handlers restore their prototypes, Maps/Sets, private state and absolute deadlines. Runtime handles and voice membership are rebuilt.
Snapshots are fenced by the Redis owner lease, so an old owner cannot overwrite a replacement owner's snapshot.
`/ready` distinguishes traffic readiness from `/health` process liveness.
Restarting a shard restores its rooms; this is restart recovery, not live room migration or uninterrupted failover.
See [docker-setup.md](docker-setup.md) for setup, secrets, recovery limits and backup procedures.
