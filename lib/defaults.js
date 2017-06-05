/*jshint esversion:6, node:true*/
'use strict';

module.exports = {
    url: process.env.NODE_MQTT_ENDPOINT || 'mqtt://localhost:1883',
    onconnect: {
        topic: 'ww/${app.name}/service/up'
    },
    transport: {
        will: {
            topic: 'ww/${app.name}/service/down'
        }
    },
    options: {
        qos: 0,
        retain: false
    },
    // applyTransforms: pubsub.applyTransforms
};
