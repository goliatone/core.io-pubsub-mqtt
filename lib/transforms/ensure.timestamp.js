'use strict';
const Keypath = require('gkeypath');

/**
 * Timestamp transform to ensure event payloads
 * have a timestamp.
 * 
 * Default implementation will add a field named
 * `timestamp`.
 * 
 * You can disable this transformer by setting the
 * value of the configuration keypath to false.
 * 
 * Configuration keypath: `transforms.ensure.timestamp`
 * 
 * Configuration options:
 * - fieldName: timestamp
 * - getTimestamp: function to generate the timestamp
 *                 Default to `Date.now()`
 * 
 * @param {Object} config 
 * @param {String} [config.fieldName='timestamp'] 
 * @param {Function} [config.genTimestamp=Date.now] 
 */
module.exports = function $init(config) {
    const options = Keypath.get(config, 'transforms.ensure.timestamp', {
        fieldName: 'timestamp',
        genTimestamp() {
            return Date.now();
        }
    });

    if (options === false) return false;

    const { fieldName, genTimestamp } = options;

    return function $transform(data) {
        if (!data[fieldName]) data[fieldName] = genTimestamp();
        return data;
    };
};
