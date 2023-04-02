const path = require('path');

module.exports = {
  apps: [
    {
      name: 'zoom',
      script: path.join(__dirname, 'bin', 'index.js'),
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
