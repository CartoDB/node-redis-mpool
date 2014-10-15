# 0.2.1 (2014-mm-dd)


# 0.2.0 (2014-10-15)

 - RedisPool now emits events
    * Starts emitting `status` event with information about each pool created
      every `opts.emitter.statusInterval` milliseconds.
 - Limits public API to acquire/release methods.

# 0.1.0 (2014-08-13)

 - Switch to 3-clause BSD license (#3)
 - Upgraded dependencies
 - Implements validate method to take non connected clients from the pool.
 - Destroy calls to redis.end method to ensure socket is disconnected.
 - Client is returned on ready event after selecting the DB instead of using
   connect event.
 - New configuration allows to log acquire slow operations when it takes
   longer than a threshold to retrieve a client from the pool.

# 0.0.4 (2014-02-24)

 - Add parameter to skip unwatch on release (#2)

# 0.0.3 (2013-12-11)

 - Unwatch variables between connections (#1)

# 0.0.2 (2013-12-06)

Fix dependencies (redis is not just for test...)

# 0.0.1 (2013-12-06)

Initial release, spin off from node-cartodb-redis
