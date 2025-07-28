const path = require('path');

module.exports = {
  '@': path.join(__dirname, 'dist'),
  '@/models': path.join(__dirname, 'dist/models'),
  '@/controllers': path.join(__dirname, 'dist/controllers'),
  '@/middleware': path.join(__dirname, 'dist/middleware'),
  '@/routes': path.join(__dirname, 'dist/routes'),
  '@/services': path.join(__dirname, 'dist/services'),
  '@/utils': path.join(__dirname, 'dist/utils'),
  '@/types': path.join(__dirname, 'dist/types'),
  '@/config': path.join(__dirname, 'dist/config'),
  '@/scripts': path.join(__dirname, 'dist/scripts'),
};