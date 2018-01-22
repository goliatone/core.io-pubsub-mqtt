'use strict';
const mqtt = require('mqtt');
const extend = require('gextend');
const match = require('mqtt-match');
const EventEmitter = require('events');

const DEFAULTS = {
    connectionNeeded: true,
    handlers: {},
    maxConnectionAttempts: 8,
    timeoutResponseAfter: 40 * 1000,
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
    }
};

const _clients = {};

function $makeClient(options) {
    /*
     * Ensure we have default options.
     */
    options = extend({}, DEFAULTS, options);

    const { url, transport } = options;

    if (_clients[url]) {
        return _clients[url];
    }

    const client = mqtt.connect(url, transport);

    _clients[url] = client;

    return client;
}

/**
 * Initialize a new MQTT client.
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

    if (typeof config.clientId === 'function') {
        config.clientId = config.clientId(context, config);
    }

    const _logger = context.getLogger('pubsub-mqtt');
    const client = $makeClient(config);

    let pubsub = new EventEmitter();
    pubsub.guid = makeGuid();
    pubsub.client = client;
    pubsub.online = false;
    pubsub.connectionAttempt = 0;
    pubsub._notifiedInitialConnection = false;

    _logger.info('PubSub MQTT module booting...');
    _logger.info(config);

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
    pubsub.subscribe = function (topic, handler) {
        config.handlers[topic] = handler;

        client.subscribe(topic);

        return this;
    };

    /**
     * Create a request response cycle.
     *
     * @method request
     * @param  {String} topic Topic  String
     * @param  {String|Buffer} data  Payload
     * @param  {Object} config      Options
     *
     * @return {Promise}
     */
    pubsub.request = function (topic, data = '', options = undefined) {
        let rndm = makeGuid();
        let _timeoutResponseAfter = options && options.timeoutResponseAfter || config.timeoutResponseAfter;
        let responseTopic = `${topic}/res/${rndm}`;

        let payload = pubsub._appendToPayload(data, {
            respondTo: responseTopic
        });

        return new Promise(function (resolve, reject) {
            function _handler(topic, event) {
                console.log('request._handler', topic, event);

                if (_handler._timeoutId) clearTimeout(_handler._timeoutId);

                /*
                 * Remove response handler
                 */
                config[responseTopic] = undefined;

                resolve(event);
            }

            if (_timeoutResponseAfter) {
                _handler._timeoutId = setTimeout(() => {
                    console.log('request.timeout');
                    reject(new Error('Timeout error'));
                }, _timeoutResponseAfter);
            }

            console.log('pubsub.request', payload);

            pubsub.subscribe(responseTopic, _handler);
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
    pubsub._appendToPayload = function (payload = {}, data = {}) {
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
     * @param  {Object} config      Options
     * @param  {Number} [config.qos=0] QoS level  
     * @param  {Boolean} [config.retain=false] QoS level  
     * @param  {Boolean} [config.dup=false] QoS level  
     * @return {this}
     */
    pubsub.publish = function (topic, data = '', options = undefined) {
        let args = [topic];

        data = pubsub.applyTransforms(data);

        args.push(data);

        if (options) {
            args.push(options);
        }

        let callback = function (err) {
            if (err) _logger.error('publish error:', err);
            else _logger.info('published!');
        };

        args.push(callback);

        client.publish.apply(client, args);

        _logger.info('|-> pubsub: publish', topic, data);

        return this;
    };

    /**
     * Fast publish main difference with a regular
     * publish is that no transformations are applied.
     * @param  {String} topic Topic string
     * @param  {String|Buffer} data  Payload
     *
     * @return {this}
     */
    pubsub.fastPublish = function (topic, data) {
        let args = [topic];

        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }

        args.push(data);

        client.publish.apply(client, args);

        _logger.info('|-> pubsub: publish', topic, data);

        return this;
    };

    pubsub.addTransform = function (transform) {
        if (!pubsub._transforms) pubsub._transforms = [];
        pubsub._transforms.push(transform);
    };

    pubsub.applyTransforms = function (data = {}) {
        return pubsub._transforms.reduce((_data, tx) => tx(_data, this), data);
    };
    ///////////////////////////////////
    /*
     * Ensure messages have uuid
     */
    pubsub.addTransform(require('./transforms/ensure.uuid'));
    /*
     * Ensure messages have timestamp
     */
    pubsub.addTransform(require('./transforms/ensure.timestamp'));

    pubsub.addTransform(function (data = {}) {
        return JSON.stringify(data);
    });

    client.on('connect', () => {
        pubsub.online = true;
        pubsub.connectionAttempt = 0;

        _logger.info('mqtt connected to "%s"', config.url);
        _logger.info('onconnect', config.onconnect.topic);

        if (config.onconnect && config.onconnect.topic) {
            client.publish(config.onconnect.topic, JSON.stringify({
                service: config.clientId,
                action: 'up'
            }), function (err) {
                if (err) _logger.error('publish error:', err);
            });
        }

        let topics = Object.keys(config.handlers);

        topics.map((topic) => {
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

            let handler = config.handlers[key];

            let payload;
            try {
                payload = JSON.parse(message.toString());
            } catch (e) {
                _logger.warn('MQTT message payload not JSON');
                payload = message.toString();
            }

            if (payload.respondTo) {
                payload.response = function (data) {
                    pubsub.publish(payload.respondTo, data);
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
        // pubsub.emit('error', err);
    });

    client.on('reconnect', () => {
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
