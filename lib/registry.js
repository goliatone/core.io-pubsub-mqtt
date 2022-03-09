/**
 * This provides a default registration flow for
 * pubsub instances.
 * 
 * Registry tries to coordinate client registration
 * so we can track different application client's
 * states.
 * 
 * @param {Client} client PubSub client
 * @param {Object} config Configuration object
 */
module.exports.registerClient = function $registerClient(client, config = {}) {

    const ackTopic = 'core$/pubsub/instance';
    const registrationPayload = {
        client: config.clientId,
        metadata: config.metadata,
    };

    /**
     * We should notify that our client is up to 
     * the main system channel
     */
    client.on('connect', _ => {
        client.publish(ackTopic, registrationPayload);
    });

};
