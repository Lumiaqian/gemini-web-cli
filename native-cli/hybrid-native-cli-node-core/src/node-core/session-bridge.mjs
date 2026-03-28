export const SESSION_BRIDGE_DESCRIPTOR = Object.freeze({
  bridgeId: 'session-api',
  routeId: 'hybrid-native-cli-node-core',
  source: 'src/index.js',
  methods: ['createGeminiSession', 'disconnect'],
  disconnectKeepsBrowserAlive: true,
  responsibility: 'Expose the shared Node session API behind a route-local private adapter.',
});

export function describeSessionBridge() {
  return {
    ...SESSION_BRIDGE_DESCRIPTOR,
    methods: [...SESSION_BRIDGE_DESCRIPTOR.methods],
  };
}

export async function openGeminiSession() {
  const { createGeminiSession } = await import('../../../../src/index.js');
  return createGeminiSession();
}

export async function closeGeminiSession() {
  const { disconnect } = await import('../../../../src/index.js');
  disconnect();
}
