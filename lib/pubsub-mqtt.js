'use strict';

const extend = require('gextend');
const defaults = require('./defaults');
const EventEmitter = require('events');

class PubSub extends EventEmitter {
    constructor(config = {}) {

        super(this);

        config = extend({}, this.constructor.defaults, config);
        if (config.autoinitialize) {
            this.init(config);
        }
    }

    init(config = {}) {
        if (this.initialized) return;
        this.initialized = true;

        extend(this, config);

        this.online = false;
        this.connectionAttempt = 0;
        this._notifiedInitialConnection = false;

        /*
         * Ensure messages have uuid
         */
        this.addTransform(require('./transforms/ensure.uuid')(config));

        /*
         * Ensure messages have timestamp
         */
        this.addTransform(require('./transforms/ensure.timestamp')(config));

        this.addTransform(function(data = {}) {
            return JSON.stringify(data);
        });
    }

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
    subscribe(topic, handler) {
        this._setHandlerForTopic(topic, handler);
        this.client.subscribe(topic);
        return this;
    }

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
    request(topic, data = '', options = undefined) {

        options = extend({}, defaultResponseOptions,
            this.responseOptions,
            options
        );

        let rndm = makeGuid();
        let _timeoutResponseAfter = options.timeoutResponseAfter;
        let responseTopic = `${topic}/res/${rndm}`;

        let payload = this._appendToPayload(data, {
            [options.topicKey]: responseTopic
        });

        return new Promise((resolve, reject) => {

            const _handler = $handler(topic, event) => {
                this.logger.info('request._handler', topic, Object.keys(event));

                if (_handler._timeoutId) clearTimeout(_handler._timeoutId);

                /*
                 * Remove response handler
                 */
                this._setHandlerForTopic(responseTopic, undefined);

                if (typeof options.format === 'function') {
                    event = options.format(event);
                }
                resolve(event);
            };

            if (_timeoutResponseAfter) {
                _handler._timeoutId = setTimeout(_ => {
                    this.logger.error('request.timeout');
                    reject(new Error('Timeout error'));
                }, _timeoutResponseAfter);
            }

            if (this.verbose) {
                this.logger.info('|-> pubsub.request', payload);
            }


            /**
             * We expect to get our response over this 
             * topic.
             */
            this.subscribe(responseTopic, _handler);

            /**
             * Publish message.
             */
            this.publish(topic, payload, options);
        });
    }

    /**
     * Extend the current payload with extra data.
     * @param  {Object} payload Origial payload
     * @param  {Object} data    Data to be added to payload
     *
     * @return {Object}
     */
    _appendToPayload(payload = {}, data = {}) {
        if (payload === '') payload = {};
        if (typeof payload === 'string') payload = JSON.parse(payload);
        payload = extend({}, data, payload);
        return payload;
    }

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
    publish(topic, data = '', options = undefined) {
        let args = [topic];
        data = this.applyTransforms(data);


        args.push(data);

        if (options) {
            //TODO: pick only valid arguments
            args.push(options);
        }

        let callback = function(err) {
            if (err) this.logger.error('publish error:', err);
            else this.logger.info('published!');
        };

        args.push(callback);

        this.client.publish.apply(this.client, args);

        if (this.verbose) {
            this.logger.info('|-> pubsub: publish', topic, data);
        }

        return this;
    }

    /**
     * Fast publish main difference with a regular
     * publish is that no transformations are applied.
     * 
     * @param  {String} topic Topic string
     * @param  {String|Buffer} data  Payload
     *
     * @return {this}
     */
    fastPublish(topic, data) {
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
    }


    addTransform(transform) {
        if (!this._transforms) this._transforms = [];
        if (typeof transform !== 'function') return this;
        this._transforms.push(transform);
        return this;
    }

    applyTransforms(data = {}) {
        return this._transforms.reduce((_data, tx) => tx(_data, this), data);
    }

    addResponseMiddleware = function(middleware) {
        if (!this.responseMiddleware) this.responseMiddleware = [];
        if (typeof middleware !== 'function') return this;
        this.responseMiddleware.push(middleware);
        return this;
    }

    applyResponseMiddleware = function(data, error) {
        let response = data;
        if (Array.isArray(this.responseMiddleware) && this.responseMiddleware.length > 0) {
            response = this.responseMiddleware.reduce((response, middleware) => {
                return response = middleware(response, data, error);
            }, {});
        }
        return response;
    }

    /**
     * Get a registered handler for a given topic.
     * 
     * @param {String} topic MQTT topic
     * @returns {Function} topic handler
     */
    _getHandlerForTopic(topic) {
        return this.handlers[topic];
    }

    /**
     * Sets the handler for a given topic.
     * 
     * @param {String} topic MQTT topic
     * @param {Function} handler Topic handler function
     * @returns {this}
     */
    _setHandlerForTopic(topic, handler) {
        this.handlers[topic] = handler;
        return this;
    };
}

PubSub.defaults = defaults;

module.exports = PubSub;
