'use strict';
const mqtt = require('mqtt');
const extend = require('gextend');
const match = require('mqtt-match');
const EventEmitter = require('events');
const backoff = require('./backoff');
const pkg = require('../package.json');

let defaultResponseOptions = {
    callerKey: 'response',
    topicKey: 'respondTo',
    timeoutResponseAfter: 40 * 1000,
    format: r => r
};

const DEFAULTS = {
    verbose: false,
    connectionNeeded: true,
    handlers: {},
    maxConnectionAttempts: 8,
    timeoutResponseAfter: 40 * 1000,

    metadata: {
        version: pkg.version,
        mqtt: pkg.dependencies.mqtt,
    },

    /**
     * array of middleware functions:
     * Signature is (result:Object, data:Object?, error:Error?)
     */
    responseMiddleware: [],
    /**
     * format
     * timeoutResponseAfter
     */
    responseOptions: {
        /**
         * Used in the request / response flow.
         * 
         * The name of the function added to the
         * mqtt event payload to handle responses.
         * We set it to `response` 
         */
        callerKey: 'response',
        /**
         * Used in the request / response flow.
         * 
         * We set it to `responseTo` by defulat
         * so it's backwards compatible but newer
         * applications should use `respondTo` instead.
         */
        topicKey: 'respondTo',

        timeoutResponseAfter: 40 * 1000,

        format: r => r
    },

    /**
     * The url can be one of the following protocols:
     * mqtt, mqtts, tcp, tls, ws, wss
     */
    url: 'mqtt://test.mosquitto.org',
    onconnect: {
        topic: 'service/up'
    },
    transport: {
        will: {
            topic: 'service/down',
            /**
             * In order to emit the LWT
             * it needs to have a payload!
             */
            payload: JSON.stringify({
                action: 'down'
            })
        }
    },
    /**
     * Factory function to create MQTT client.
     * The default factory creates a regular MQTT.js
     * client.
     * @param {Object} options MQTT configuration object
     */
    createClient: function $createClient(options) {
        /*
         * Ensure we have default options.
         */
        options = extend({}, {}, options);

        const { url, transport } = options;

        if (_clients[url]) {
            return _clients[url];
        }

        const client = mqtt.connect(url, transport);

        _clients[url] = client;

        return client;
    },

    registerClient: require('./registry'),
};

const _clients = {};

/**
 * Initialize a new MQTT client.
 * 
 * If you want to connect over tls you need to pass the
 * following options in the `config.transport` object:
 * 
 * ```js
 * {
 *   key: fs.readFileSync('./tls-key.pem'),
 *   cert: fs.readFileSync('./tls-cert.crt'),
 *   ca: fs.readFileSync('./tls-ca.crt'),
 *   protocol: 'mqtts'
 * }
 * ```
 * 
 * If you are using a self-signed certificate you need to 
 * add:
 * ```js
 * {
 *   rejectUnauthorized : true
 * }
 * ```
 *
 * @param {Application} context Application core context
 * @param {Object} config Configuratino object
 * @param {String} [config.clientId] Client id
 * @param {Function} [config.clientId] Client ID, should return a string
 * @param {String} [config.url=mqtt://test.mosquitto.org] MQTT broker URL
 * @param {Number} [config.timeoutResponseAfter=40000] Response timeout
 * @param {Boolean} [config.connectionNeeded=true] If true will throw an error if we fail to connect
 * @param {Number} [config.maxConnectionAttempts=8] Max number of reconnection attemps
 * @param {String} [config.onconnect.topic=service/up] Topic to send on connection
 * @param {Object} [config.transport] Object passed to MQTT client on connect.
 * @param {Object} [config.transport.will.topic=service/down] Topic to send as LWT
 * @param {String} [config.transport.will.payload={"action":"down"}] Message to send as LWT
 */
module.exports = function $initPubSubMQTT(context, config) {

    config = extend({}, DEFAULTS, config);

    if (config.clientid) {
        config.clientId = config.clientid;
    }

    if (typeof config.clientId === 'function') {
        config.clientId = config.clientId(context, config);
    }

    //TODO: Normalize transport using onconnect topic

    const _logger = context.getLogger('pubsub-mqtt');

    const client = config.createClient(config);

    let pubsub = new EventEmitter();
    pubsub.guid = makeGuid();
    pubsub.client = client;
    pubsub.online = false;
    pubsub.connectionAttempt = 0;
    pubsub._notifiedInitialConnection = false;

    _logger.info('PubSub MQTT module booting...');

    /**
     * 
     */
    if (typeof config.registerClient === 'function') {
        try {
            config.registerClient(client, config);
        } catch (error) {
            _logger.error('Error registering client...');
            _logger.error(error);
        }
    }

    /**
     * Get a registered handler for a given topic.
     * 
     * @param {String} topic MQTT topic
     */
    pubsub._getHandlerForTopic = function(topic) {
        return config.handlers[topic];
    };

    /**
     * Sets the handler for a given topic.
     * 
     * @param {String} topic MQTT topic
     * @param {Function} handler Topic handler function
     * @returns {this}
     */
    pubsub._setHandlerForTopic = function(topic, handler) {
        config.handlers[topic] = handler;
        return this;
    };

    /**
     * Subscribe to a topic or topics.
     *
     * MQTT topic wildcard characters are
     * supported ("+" for single level and
     * "#" for multi level).
     *
     * @method subscribe
     * @param  {String|Array}  topic  MQTT topic or topics.
     * @param  {function}  handler    Handles topic messages
     * @return {this}
     */
    pubsub.subscribe = function(topic, handler) {
        pubsub._setHandlerForTopic(topic, handler);
        client.subscribe(topic);

        return this;
    };

    /**
     * Create a request response cycle.
     *
     * @method request
     * @param  {String} topic Topic  String
     * @param  {String|Buffer} data  Payload
     * @param  {Object} options      Options
     * @param  {Number} options.timeoutResponseAfter  Timeout response
     * @param  {Function} options.format  Format response
     *
     * @return {Promise}
     */
    pubsub.request = function(topic, data = '', options = undefined) {

        options = extend({}, defaultResponseOptions,
            config.responseOptions,
            options
        );

        let rndm = makeGuid();
        let _timeoutResponseAfter = options.timeoutResponseAfter;
        let responseTopic = `${topic}/res/${rndm}`;

        let payload = pubsub._appendToPayload(data, {
            [options.topicKey]: responseTopic
        });

        return new Promise(function(resolve, reject) {

            const _handler = function $handler(topic, event) {
                _logger.info('request._handler', topic, Object.keys(event));

                if (_handler._timeoutId) clearTimeout(_handler._timeoutId);

                /*
                 * Remove response handler
                 */
                pubsub._setHandlerForTopic(responseTopic, undefined);

                if (typeof options.format === 'function') {
                    event = options.format(event);
                }
                resolve(event);
            };

            if (_timeoutResponseAfter) {
                _handler._timeoutId = setTimeout(_ => {
                    _logger.error('request.timeout');
                    reject(new Error('Timeout error'));
                }, _timeoutResponseAfter);
            }

            if (config.verbose) {
                _logger.info('|-> pubsub.request', payload);
            }


            /**
             * We expect to get our response over this 
             * topic.
             */
            pubsub.subscribe(responseTopic, _handler);

            /**
             * Publish message.
             */
            pubsub.publish(topic, payload, options);
        });
    };

    /**
     * Extend the current payload with extra data.
     * @param  {Object} payload Origial payload
     * @param  {Object} data    Data to be added to payload
     *
     * @return {Object}
     */
    pubsub._appendToPayload = function(payload = {}, data = {}) {
        if (payload === '') payload = {};
        if (typeof payload === 'string') payload = JSON.parse(payload);
        payload = extend({}, data, payload);
        return payload;
    };

    /**
     * Publish MQTT message
     *
     * Options:
     * - qos: QoS level, `Number`, default `0`
     * - retain: `Boolean`, default `false`
     *
     * The "options" parameter should be `undefined`
     * by default or it get's sent.
     *
     * @method publish
     * @param  {String} topic Topic  String
     * @param  {String|Buffer} data  Payload
     * @param  {Object} options      Options
     * @param  {Number} [options.qos=0] QoS level
     * @param  {Boolean} [options.retain=false] QoS level
     * @param  {Boolean} [options.dup=false] QoS level
     * @return {this}
     */
    pubsub.publish = function(topic, data = '', options = undefined) {
        let args = [topic];
        data = pubsub.applyTransforms(data);


        args.push(data);

        if (options) {
            //TODO: pick only valid arguments
            args.push(options);
        }

        let callback = function(err) {
            if (err) _logger.error('publish error:', err);
            else _logger.info('published!');
        };

        args.push(callback);

        client.publish.apply(client, args);

        if (config.verbose) {
            _logger.info('|-> pubsub: publish', topic, data);
        }

        return this;
    };

    /**
     * Fast publish main difference with a regular
     * publish is that no transformations are applied.
     * 
     * @param  {String} topic Topic string
     * @param  {String|Buffer} data  Payload
     *
     * @return {this}
     */
    pubsub.fastPublish = function(topic, data) {
        let args = [topic];

        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }

        args.push(data);

        client.publish.apply(client, args);

        if (config.verbose) {
            _logger.info('|-> pubsub: publish', topic, data);
        }

        return this;
    };

    pubsub.addTransform = function(transform) {
        if (!pubsub._transforms) pubsub._transforms = [];
        if (typeof transform !== 'function') return this;
        pubsub._transforms.push(transform);
        return this;
    };

    pubsub.applyTransforms = function(data = {}) {
        return pubsub._transforms.reduce((_data, tx) => tx(_data, this), data);
    };

    pubsub.addResponseMiddleware = function(middleware) {
        if (!pubsub.responseMiddleware) pubsub.responseMiddleware = [];
        if (typeof middleware !== 'function') return this;
        pubsub.responseMiddleware.push(middleware);
        return this;
    };

    pubsub.applyResponseMiddleware = function(data, error) {

        let response = data;

        if (Array.isArray(pubsub.responseMiddleware) && pubsub.responseMiddleware.length > 0) {
            response = pubsub.responseMiddleware.reduce((response, middleware) => {
                return response = middleware(response, data, error);
            }, {});
        }

        return response;
    };
    ///////////////////////////////////
    /*
     * Ensure messages have uuid
     */
    pubsub.addTransform(require('./transforms/ensure.uuid')(config));

    /*
     * Ensure messages have timestamp
     */
    pubsub.addTransform(require('./transforms/ensure.timestamp')(config));

    pubsub.addTransform(function(data = {}) {
        return JSON.stringify(data);
    });

    client.on('connect', () => {

        pubsub.online = true;
        pubsub.connectionAttempt = 0;
        backoff.reset();

        _logger.info('mqtt connected to "%s"', cleanUrl(config.url));
        _logger.info('onconnect', config.onconnect.topic);

        /**
         * This will publish a message once the client
         * has been connected.
         */
        if (config.onconnect && config.onconnect.topic) {
            client.publish(config.onconnect.topic, JSON.stringify({
                action: 'up',
                client: config.clientId,
            }), function(err) {
                if (err) _logger.error('publish error:', err);
            });
        }

        let topics = Object.keys(config.handlers);

        topics.map(topic => {
            _logger.info('pubsub: registering topic "%s"', topic);
        });

        client.subscribe(topics);

        if (!pubsub._notifiedInitialConnection) {
            pubsub._notifiedInitialConnection = true;
            pubsub.emit('ready');
        } else {
            pubsub.emit('connect');
        }
    });

    client.on('message', (topic, message = '') => {
        // _logger.info('//////////');
        // _logger.info('MQTT: topic "%s". message:\n%s', topic, message.toString());

        let handled = false;

        Object.keys(config.handlers).map((key) => {
            if (!match(key, topic)) {
                // console.log('match failed for: %s %s', key, topic);
                return;
            }

            // _logger.info('match FOUND for: %s %s', key, topic);

            let handler = pubsub._getHandlerForTopic(key);

            let payload;
            try {
                payload = JSON.parse(message.toString());
            } catch (e) {
                _logger.warn('MQTT message payload not JSON');
                payload = message.toString();
            }

            /**
             * If our message was part of a request / response flow
             * we add a response caller function to our payload so
             * that we can respond to the given request.
             * This will be handled by core.io's `respondTo` command
             * flow. 
             * @see https://github.com/goliatone/application-core/blob/master/lib/application.js#L1386
             */
            if (payload[config.responseOptions.topicKey]) {

                payload[config.responseOptions.callerKey] = function(data, error) {
                    let message = pubsub.applyResponseMiddleware(data, error);
                    pubsub.publish(payload[config.responseOptions.topicKey], message);
                };

            }

            /**
             * All topic handlers are executed with
             * context as their scope.
             */
            handler.call(context, topic, payload);
        });
    });

    client.on('error', (err) => {
        _logger.error('---');
        _logger.error('ERROR:', err.message);
        _logger.error(err.stack);
        pubsub.error = err;
        /*
         * We might not want to crash the whole
         * application due to an error here, e.g.
         * if we send a malformed topic/message the
         * mqtt parser will barf but that should not
         * grant a crash...
         */
        pubsub.emit('client.error', err);
        // pubsub.emit('error', err);
    });

    client.on('reconnect', _ => {
        pubsub.online = false;
        ++pubsub.connectionAttempt;

        if (pubsub.connectionAttempt > config.maxConnectionAttempts) {
            if (config.connectionNeeded) {
                throw new Error('Unable to stablish a connection with client');
            } else {
                client.end();
                _logger.warn('We were unable to connect to mqtt server');
                _logger.warn('We are not trying anymore.');
            }
        }

        _logger.warn('---');
        _logger.warn('client reconnect');

        pubsub.emit('reconnect', {
            attempt: pubsub.connectionAttempt
        });

        /**
         * Need to update the reconnect period using
         * our next tick in backoff.
         */
        if (client.options) {
            client.options.reconnectPeriod = backoff.next();
        }
    });

    client.on('offline', () => {
        pubsub.online = false;
        _logger.warn('---');
        _logger.warn('client offline');

        pubsub.emit('offline');
    });

    client.on('close', () => {
        _logger.warn('---');
        _logger.warn('client close');
    });

    return pubsub;
};

function makeGuid() {
    const timestamp = (new Date()).getTime().toString(36);
    const randomString = (Math.random() * 10000000000000000).toString(36).replace('.', '');

    return `${timestamp}-${randomString}`;
}

function cleanUrl(url = '') {
    return url.replace(/\/\w+:.*@/, '/***:***@');
}
