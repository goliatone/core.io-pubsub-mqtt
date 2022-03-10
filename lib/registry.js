/**
 * This provides a default registration flow for
 * pubsub instances.
 *
 * Registry tries to coordinate client registration
 * so we can track different application client's
 * states.
 *
 * @param {Client} pubsub PubSub client
 * @param {Object} config Configuration object
 */
module.exports.registerClient = function $registerClient(pubsub, config = {}) {

    const now = Date.now();

    const bipTopic = 'core$/pubsub/instance/beat';
    const ackTopic = 'core$/pubsub/instance/join';

    let registrationPayload = {
        client: config.clientId,
        metadata: config.metadata,
        boot: now,
    };

    let initialPayload = JSON.stringify(registrationPayload);

    /**
     * We should notify that our client is up to
     * the main system channel
     */
    pubsub.client.on('connect', _ => {
        pubsub.client.publish(ackTopic, initialPayload);
    });

    let intervalId;

    const ping = _ => {
        try {
            registrationPayload.now = Date.now();
            let pingPayload = JSON.stringify(registrationPayload);
            pubsub.client.publish(bipTopic, pingPayload);
        } catch (error) {

        }
    };

    if (config.registryPingInterval) {
        intervalId = setInterval(ping, config.registryPingInterval);
    }
};

/**
 * We can create a registry manager to track all different instances
 * and keep track of who is online and who goes down.
 *
 * @param {Client} client PubSub client
 * @param {Object} config Configuration object
 */
module.exports.createManager = function $createManager(client, config = {}) {

};
