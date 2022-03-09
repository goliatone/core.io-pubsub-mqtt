## core.io PubSub MQTT

This package is part of the [core.io][https://github.com/goliatone/application-cor] set of libraries, meaning it can be used independently or inside an **core.io** application.

To install:

```
$ npm i -S core.io-pubsub-mqtt
```

### Documentation

#### Request / Response Flow

This module provides a request/response flow that you can leverage to replicate HTTP mechanics. The following illustrates a simple example

* client.js:

```js
pubsub.request('ci/registry/list').then(response => {
    console.log(repsonse.message) //This is my reponse
}).catch(error => {
    //handle error
});
```

* server.js:

```js
pubsub.subscribe('ci/registry/list', event => {
    //...perform logic to generate a result object
    let result = { message: 'This is my response' };
    event.respond({ result });
});
```

If you are using the package as a core.io module and using the dispatch/command flow, you can configure the module to behave use core.io dispatcher handling events with a `respondTo` function so that your commands do not have to worry about specifically handling the `respond` call.

Your application setup:

`./commands/api.image.get.js`
```js
class ApiImageGetCommand {
    execute(event) {
        return {
            success: true,
            message: 'This is my command response'
        };
    }
}
```

`./config/pubsub.js`:

```js
module.exports = {
    responseTopicKey: 'responseTopic',
    responseCallerKey: 'respondTo',
    handlers: {
        'mqtt/api/image/get': function handler(topic message) {
            const context = this;
            context.emit('api.image.get', message);
        }
    }
};
```



Then from your application dispatching the request:

```js
let res = await pubsub.request('api.image.get', {filename});
```

#### Response Middleware

You can add response middleware to build the payload of your response object.
Note that the middleware will be applied before applying any transformations done in during the payload publish.


In your config file:

* config/pubsub.js:

```js
module.exports = {

    /**
     * These functions will be called in the
     * order they are added
     */
    responseMiddleware: [
        function(response, data, error) {

            if(data && !error) {
                response.data = data;
                response.success = true;
            }

            if(error && !data) {
                response.error = error;
                response.success = false;
            }

            return response;
        },

    ]
};
```

#### Publish Payload Transformers

You can modify the payload before being published ove MQTT. By default we have two transformers, one to add a [timestamp](https://github.com/goliatone/core.io-pubsub-mqtt/blob/master/lib/transforms/ensure.timestamp.js) and one to add a [uuid](https://github.com/goliatone/core.io-pubsub-mqtt/blob/master/lib/transforms/ensure.uuid.js) to the emitted payload.


##### Ensure UUID

UUID transform to ensure event payloads have a unique ID.

Default implementation will add a field named `uuid`.

Configuration keypath: `pubsub.transforms.ensure.uuid`.

You can disable this transformer by setting the value of the configuration keypath to `false`.

Configuration options:

- `fieldName`: String representing the payload field name, defaults to `uuid`.
- `getId`: function to generate the ID. Default to `uuid.v4()`


#### Ensure Timestamp

Timestamp transform to ensure event payloads have a timestamp.

Default implementation will add a field named `timestamp`.

Configuration keypath: `transforms.ensure.timestamp`.

You can disable this transformer by setting the value of the configuration keypath to `false`.


Configuration options:

- `fieldName`: String representing the payload field name, defaults to `timestamp`.
- `getTimestamp`: Function to generate the `timestamp`. Default to `Date.now()`



## License
® License MIT 2017 by goliatone

TODO:
- [ ] Implement a pin/pong flow so that we can easily build on top of it