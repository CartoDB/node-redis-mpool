# 0.8.0 (2020-mm-dd)

### Breaking changes
 - Use promises

### Changed
 - ES2020 style
 - removing hiredis and using node-redis
 - removing makefile and use npm scripts
 - removing underscore
 - removing dot
 - updating dependencies versions

### Added
 - adding eslint (standard)

# 0.7.0 (2018-11-21)

 - Add package-lock.json

# 0.6.0 (2018-10-25)

 - Make all modules to use strict mode semantics.
 - Drop support for Node 0.10.x and 4.x
 - Add support for Node 8 and 10

# 0.5.0 (2018-02-05)

 - Upgrades redis to 2.8.0
 - Support for Redis commands

# 0.4.1 (2016-12-09)

 - Upgrades hiredis to 0.5.0: allows to use it with Node.js v4 and v6.

# 0.4.0 (2015-07-05)

 - Adds noReadyCheck configuration option

# 0.3.0 (2014-10-17)

 - Adds returnToHead configuration option

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
