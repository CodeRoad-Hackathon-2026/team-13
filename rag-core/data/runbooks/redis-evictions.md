# Redis evictions during peak traffic

## Symptom
Cache hit rate drops below 60% and `evicted_keys` climbs. Session lookups fall
through to Postgres, which then saturates.

## Mitigation
1. Check memory: `redis-cli INFO memory | grep used_memory_human`.
2. If `maxmemory` is reached, raise it before adding replicas — replicas do not
   add memory capacity for a single keyspace.
3. Verify the eviction policy is `allkeys-lru`, not `noeviction`.

## Do not
Do not run `FLUSHALL` to reclaim memory. It drops active sessions and logs out
every user.

