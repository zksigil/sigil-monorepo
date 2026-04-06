// Test script to check if mopro-ffi can be loaded
console.log('Testing mopro-ffi module loading...');

try {
  const mopro = require('mopro-ffi');
  console.log('✅ mopro-ffi loaded successfully');
  console.log('Available functions:', Object.keys(mopro).filter(key => typeof mopro[key] === 'function'));
} catch (error) {
  console.error('❌ Failed to load mopro-ffi:', error.message);
  process.exit(1);
}