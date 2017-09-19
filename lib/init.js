'use strict';
const mqtt = require('mqtt');
const extend = require('gextend');
const match = require('mqtt-match');
const EventEmitter = require('events');

const DEFAULTS = {
    connectionNeeded: true,
    handlers: {},
    maxConnectionAttempts: 3,
    url: 'mqtt://test.mosquitto.org',
    onconnect: {
        topic: 'service/up'
    },
    transport: {
        will: {
            topic: 'service/down'
        }
    }
};

module.exports =  function $initPubSubMQTT(context, config) {

    config = extend({}, DEFAULTS, config);

    const _logger = context.getLogger('pubsub-mqtt');
    const client = mqtt.connect(config.url, config.transport);

    let pubsub = new EventEmitter();
    // let pubsub = {};
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
    pubsub.subscribe = function(topic, handler) {
        config.handlers[topic] = handler;

        client.subscribe(topic);

        return this;
    };

    /**
     * Publish MQTT message
     *
     * Options:
     * - qos: QoS level, `Number`, default `0`
     * - retain: `Boolean`, default `false`
     *
     * @method publish
     * @param  {String} topic Topic  String
     * @param  {String|Buffer} data  Payload
     * @param  {Object} config      Options
     *
     * @return {this}
     */
    pubsub.publish = function(topic, data = '', options=undefined) {
        let args = [topic];

        data  = pubsub.applyTransforms(data);

        args.push(data);

        if(options) args.push(options);

        let callback = function(err){
            if(err) _logger.error('publish error:', err);
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
    pubsub.fastPublish = function(topic, data) {
        let args = [topic];

        if(typeof data !== 'string'){
            data = JSON.stringify(data);
        }

        args.push(data);

        client.publish.apply(client, args);

        _logger.info('|-> pubsub: publish', topic, data);

        return this;
    };

    pubsub.addTransform = function(transform) {
        if(!pubsub._transforms) pubsub._transforms = [];
        pubsub._transforms.push(transform);
    };

    pubsub.applyTransforms = function(data={}) {
        return pubsub._transforms.reduce((i, tx) => tx(i), data);
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

    pubsub.addTransform(function(data={}) {
        return JSON.stringify(data);
    });

    client.on('connect', () => {
        pubsub.online = true;
        pubsub.connectionAttempt = 0;

        _logger.info('mqtt connected to "%s"', config.url);
        _logger.info('onconnect', config.onconnect.topic);

        client.publish(config.onconnect.topic, JSON.stringify({
            service: config.clientid,
            action: 'up'
        }), function(err){
            if(err) _logger.error('publish error:', err);
        });

        let topics = Object.keys(config.handlers);

        topics.map((topic)=>{
            _logger.info('pubsub: registering topic "%s"', topic);
        });

        client.subscribe(topics);

        if(!pubsub._notifiedInitialConnection) {
            pubsub._notifiedInitialConnection = true;
            pubsub.emit('ready');
        } else {
            pubsub.emit('connect');
        }
    });

    client.on('message', (topic, message='')=>{
        // _logger.info('//////////');
        // _logger.info('MQTT: topic "%s". message:\n%s', topic, message.toString());

        let handled = false;

        Object.keys(config.handlers).map((key)=>{
            if(!match(key, topic)) {
                // console.log('match failed for: %s %s', key, topic);
                return;
            }

            // _logger.info('match FOUND for: %s %s', key, topic);

            let handler = config.handlers[key];

            let payload;
            try {
                payload = JSON.parse(message.toString());
            } catch(e){
                _logger.warn('MQTT message payload not JSON');
                payload = message.toString();
            }

            handler.call(context, topic, payload);
        });
    });

    client.on('error', (err) => {
        _logger.error('---');
        _logger.error('ERROR:', err.message);
        _logger.error(err.stack);
        pubsub.error = err;
        pubsub.emit('error', err);
    });

    client.on('reconnect', () => {
        pubsub.online = false;
        ++pubsub.connectionAttempt;

        if(pubsub.connectionAttempt > config.maxConnectionAttempts) {
            if(config.connectionNeeded){
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
