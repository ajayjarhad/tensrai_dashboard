try {
  const desiredHost = process.env.MONGO_HOST || 'mongo:27017';

  // Check if replica set is already initialized
  const status = rs.status();
  const currentMembers = status?.members?.map(m => m.name) || [];
  console.log('Replica set already initialized with members:', currentMembers);

  // If the member host is wrong (e.g., localhost), reconfig to use the service hostname
  if (!currentMembers.includes(desiredHost)) {
    const newConfig = {
      _id: 'rs0',
      members: [{ _id: 0, host: desiredHost }],
    };
    print(`Reconfiguring replica set to use host ${desiredHost}...`);
    rs.reconfig(newConfig, { force: true });
  }
} catch (e) {
  if (e.codeName === 'NotYetInitialized') {
    // Initialize replica set with current host
    console.log('Initializing replica set...');
    const config = {
      _id: 'rs0',
      members: [{ _id: 0, host: process.env.MONGO_HOST || 'mongo:27017' }],
    };

    const result = rs.initiate(config);
    console.log('Replica set initialization initiated:', result);

    // Wait for initialization to complete
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const status = rs.status();
        if (status.set === 'rs0' && status.members.length > 0) {
          console.log('Replica set successfully initialized');
          break;
        }
      } catch (_statusError) {
        // Status check might fail during initialization, that's normal
      }

      attempts++;
      console.log(`Waiting for replica set initialization... (${attempts}/${maxAttempts})`);
      sleep(1000);
    }

    if (attempts >= maxAttempts) {
      console.log('Warning: Replica set initialization timed out, but will continue');
    }
  } else {
    console.log('Error checking replica set status:', e);
    console.log('This might be normal during container startup');
  }
}

console.log('MongoDB replica set initialization script completed');
