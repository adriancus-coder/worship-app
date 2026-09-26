'use strict';

// Express 4 does not catch rejected promises from handlers; forward them to next().
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncRoute;
