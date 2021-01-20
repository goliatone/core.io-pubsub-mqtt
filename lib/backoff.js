'use strict';

const backoff = {
    initialDelay: 100,
    maxDelay: 30000,
    randomizationFactor: 0,
    factor: 3,
    computeDelay: function() {
        if (!backoff.nextBackoffDelay) backoff.nextBackoffDelay = backoff.initialDelay;
        backoff.backoffDelay = Math.min(backoff.nextBackoffDelay, backoff.maxDelay);
        backoff.nextBackoffDelay = backoff.backoffDelay * backoff.factor;
        return backoff.backoffDelay;
    },
    next: function() {
        const backoffDelay = backoff.computeDelay();
        const randomFactor = 1 + Math.random() * backoff.randomizationFactor;
        backoff.delay = Math.round(backoffDelay * randomFactor);
        return backoff.delay;
    },
    reset: function() {
        backoff.backoffDelay = 0;
        backoff.delay = 0;
        backoff.nextBackoffDelay = backoff.initialDelay;
    },
    execute: function(callback) {
        backoff.next();
        setTimeout(() => {
            callback();
        }, backoff.delay);
    }
};

module.exports = backoff;
