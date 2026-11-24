// Public settings for the shared backend (varun-platform on Supabase).
// The publishable key is meant to be public: what a signed-in user can do is
// enforced by the database rules and the ai-gateway, not by hiding this key.
export const VERSION = 'v0.3.1';
export const PLATFORM = {
  url: 'https://tzmdhmzonixmemsdepgs.supabase.co',
  key: 'sb_publishable_D8Zo1MUHasQodigP2p9nyw_ieKEWJq7',   // publishable (safe to be public)
  app: 'layer-up'
};
export const platformReady = () => !!(PLATFORM.url && PLATFORM.key);
