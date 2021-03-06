'use strict';

const EventEmitter = require('events').EventEmitter;
const redis = require('redis');
const { createPool } = require('generic-pool');

const FLUSH_CONNECTION = true;
const DEFAULT_STATUS_INTERVAL = 60000
const DEFAULTS = {
    name: 'default',
    host: '127.0.0.1',
    port: '6379',
    max: 8,
    min: 1,
    maxWaitingClients: 8,
    testOnBorrow: false,
    acquireTimeoutMillis: 3000,
    fifo: true,
    priorityRange: 1,
    autostart: true,
    evictionRunIntervalMillis: 60000,
    numTestsPerEvictionRun: 8,
    idleTimeoutMillis: 10000,
    softIdleTimeoutMillis: -1,
    noReadyCheck: false,
    unwatchOnRelease: true,
    slowPool: {
        log: false,
        elapsedThreshold: 25
    },
    emitter: {
        statusInterval: DEFAULT_STATUS_INTERVAL
    },
    commands: []
};

/**
 * Create a new multi database Redis pool.
 * It will emit `status` event with information about each created pool.
 *
 * @param {Object} options
 * @returns {RedisPool}
 * @constructor
 */
module.exports = class RedisPool extends EventEmitter {
    constructor (options = {}, logger = console) {
        super();

        this.pools = {};
        this.options = Object.assign({}, DEFAULTS, options);
        this.logger = logger;

        this._addCommands();
        this._statusInterval = this._emitStatus();
    }

    /**
     * Acquire Redis client
     *
     * @param {String|Number} database redis database name
     * @returns {Promise} with the Redis client
     */
    async acquire (database) {
        let pool = this.pools[database];
        if (!pool) {
            pool = this.pools[database] = makePool(this, database);
        }

        const startTime = Date.now();
        const client = await pool.acquire();
        const elapsedTime = Date.now() - startTime;

        if (this.options.slowPool.log && elapsedTime > this.options.slowPool.elapsedThreshold) {
            this.logger.info({ name: this.options.name, db: database, action: 'acquire', elapsed: elapsedTime, waiting: pool.pending });
        }

        if (client instanceof Error) {
            const err = client;
            err.name = this.options.name;
            err.db = database;
            err.action = 'acquire';
            this.logger.error(err);

            throw err;
        }

        return client;
    }

    /**
     * Release resource.
     *
     * @param {String|Number} database redis database name
     * @param {Object} resource resource object to release
     */
    async release (database, resource) {
        if (this.options.unwatchOnRelease) {
            resource.UNWATCH();
        }

        const pool = this.pools[database];

        if (pool) {
            await pool.release(resource);
        }
    }

    /**
     * Closing all connection pools
     */
    async destroy () {
        clearInterval(this._statusInterval)

        // https://github.com/coopernurse/node-pool/blob/v3.7.1/README.md#draining
        return await Promise.all(Object.values(this.pools).map(p => p.drain().then(() => p.clear())) )
    }

    _addCommands () {
        if (this.options.commands.length) {
            this.options.commands.forEach(newCommand => redis.add_command(newCommand));
        }
    }

    _emitStatus () {
        return setInterval(() => {
            for (const [poolKey, pool] of Object.entries(this.pools)) {
                this.emit('status', {
                    name: this.options.name,
                    db: poolKey,
                    count: pool.size,
                    unused: pool.available,
                    waiting: pool.pending
                });
            }
        }, this._getStatusDelay());
    }

    _getStatusDelay () {
        return (this.options.emitter && this.options.emitter.statusInterval) || DEFAULT_STATUS_INTERVAL;
    }
};

/**
 * Factory to create new Redis pools for a given Redis database
 * @param redisPool
 * @param database
 * @returns {Pool}
 */
function makePool (redisPool, database) {
    const factory = {
        // create function will loop forever if reject is called or exception is thrown
        // https://github.com/coopernurse/node-pool/issues/175
        create () {
            return new Promise(resolve => {
                let settled = false;

                const client = redis.createClient(redisPool.options.port, redisPool.options.host, {
                    no_ready_check: redisPool.options.noReadyCheck
                });

                client.on('error', (err) => {
                    if (settled) {
                        err.name = redisPool.options.name;
                        return redisPool.logger.error(err);
                    }

                    settled = true;
                    client.end(FLUSH_CONNECTION);

                    if (err) {
                        return resolve(err);
                    }

                    return resolve(client);
                });

                client.on('ready', () => {
                    client.select(database, err => {
                        if (!settled) {
                            settled = true;

                            if (err) {
                                return resolve(err);
                            }

                            return resolve(client);
                        }
                    });
                });
            });
        },

        destroy (client) {
            return new Promise((resolve, reject) => {
                client.quit(err => {
                    client.end(FLUSH_CONNECTION);
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            });
        },

        validate (client) {
            return new Promise(resolve => {
                return resolve(client && client.connected);
            });
        }
    };

    const config = {
        max: redisPool.options.max,
        min: redisPool.options.min,
        maxWaitingClients: redisPool.options.maxWaitingClients,
        testOnBorrow: redisPool.options.testOnBorrow,
        acquireTimeoutMillis: redisPool.options.acquireTimeoutMillis,
        fifo: redisPool.options.fifo,
        priorityRange: redisPool.options.priorityRange,
        autostart: redisPool.options.autostart,
        evictionRunIntervalMillis: redisPool.options.evictionRunIntervalMillis,
        numTestsPerEvictionRun: redisPool.options.numTestsPerEvictionRun,
        idleTimeoutMillis: redisPool.options.idleTimeoutMillis,
        softIdleTimeoutMillis: redisPool.options.softIdleTimeoutMillis
    };

    return createPool(factory, config);
}
