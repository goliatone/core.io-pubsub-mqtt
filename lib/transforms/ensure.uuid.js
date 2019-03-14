'use strict';
const uuid = require('uuid').v4;
const Keypath = require('gkeypath');

/**
 * UUID transform to ensure event payloads
 * have a unique ID.
 * 
 * Default implementation will add a field named
 * `uuid`.
 * 
 * You can disable this transformer by setting the
 * value of the configuration keypath to false.
 * 
 * Configuration keypath: `transforms.ensure.uuid`
 * 
 * Configuration options:
 * - fieldName: uuid
 * - getId: function to generate the ID
 *          Default to `uuid.v4()`
 * 
 * @param {Object} config 
 * @param {String} [config.fieldName='uuid'] 
 * @param {Function} [config.getId=Date.now] 
 */
module.exports = function $init(config) {
    const options = Keypath.get(config, 'transforms.ensure.uuid', {
        fieldName: 'uuid',
        getId() {
            return uuid();
        }
    });

    if (options === false) return false;

    const { fieldName, getId } = options;

    return function $transform(data) {
        if (!data[fieldName]) data[fieldName] = getId();
        return data;
    };
};
