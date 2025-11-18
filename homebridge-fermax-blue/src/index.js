const FermaxBluePlatform = require('./FermaxPlatform');

module.exports = (api) => {
  api.registerPlatform('homebridge-fermax-blue', 'FermaxBluePlatform', FermaxBluePlatform);
};

