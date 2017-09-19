## core.io PubSub MQTT
This package is part of the [core.io][core.io] set of libraries, meaning it can be used independently or inside an **core.io** application.

To install

```
$ npm i -S core.io-pubsub-mqtt
```

### Documentation


Request/respond:

* client.js:

```js
pubsub.request('ci/registry/list').then((event)=>{

}).catch((err)=>{
    
});
```

* server.js:

```js
pubsub.subscribe('ci/registry/list', (event) => {
    //...perform logic to generate a result object
    event.respond({result});
});
```

Requests have a valid


## License
® License MIT 2017 by goliatone
