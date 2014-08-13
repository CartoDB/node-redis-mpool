var redis  = require('redis')
  , _      = require('underscore')
  , Pool   = require('generic-pool').Pool;

// constructor.
// 
// - `opts` {Object} optional config for redis and pooling
var RedisPool = function(opts) {
    var opts = opts || {};
    var defaults = {
        host: '127.0.0.1',
        port: '6379',
        max: 50,
        idleTimeoutMillis: 10000,
        reapIntervalMillis: 1000,
        unwatchOnRelease: true,
        name: 'default',
        log: false,
        slowPool: {
            log: false,
            elapsedThreshold: 25
        }
    };
    var options = _.defaults(opts, defaults)

    var me = {
        pools: {} // cached pools by DB name
    };

    var elapsedThreshold = options.slowPool.elapsedThreshold;
  
    // Acquire resource.
    //
    // - `database` {String} redis database name
    // - `callback` {Function} callback to call once acquired. Takes the form
    //   `callback(err, resource)`
    me.acquire = function(database, callback) {
        var pool = this.pools[database];
        if (!pool) {
        pool = this.pools[database] = this.makePool(database);
        }
        var startTime = Date.now();
        pool.acquire(function(err, client) {
            var elapsedTime = Date.now() - startTime;
            if (elapsedTime > elapsedThreshold) {
                log({db: database, action: 'adquire', elapsed: elapsedTime, waiting: pool.waitingClientsCount()});
            }
            callback(err, client);
        });
    };
  
    // Release resource.
    //
    // - `database` {String} redis database name
    // - `resource` {Object} resource object to release
    me.release = function(database, resource) {
        if ( options.unwatchOnRelease ) resource.UNWATCH();
        var pool = this.pools[database];
        if ( pool ) pool.release(resource);
    };
    
    // Factory for pool objects.
    me.makePool = function(database) {
        var pool = Pool({
            name: options.name + ':' + database,
            create: function(callback) {

                var callbackCalled = false;

                var client = redis.createClient(options.port, options.host);

                client.on('error', function (err) {
                    log({db: database, action: 'error', err: err.message});
                    if (!callbackCalled) {
                        callbackCalled = true;
                        callback(err, client);
                    }
                    client.end();
                });

                client.on('ready', function () {
                    client.select(database, function(err, res) {
                        if (!callbackCalled) {
                            callbackCalled = true;
                            callback(err, client);
                        }
                    });
                })
            },

            destroy: function(client) {
                client.quit();
                client.end();
            },

            validate: function(client) {
                return client && client.connected;
            },

            max: options.max,
            idleTimeoutMillis: options.idleTimeoutMillis,
            reapIntervalMillis: options.reapIntervalMillis,
            log: options.log
        });

        return pool;
    };

    function log(what) {
        if (options.slowPool.log) {
            console.log(JSON.stringify(_.extend({name: options.name}, what)));
        }
    }

    return me;
};

module.exports = RedisPool;
