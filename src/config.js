// Public settings for the shared backend (varun-platform on Supabase).
// The publishable key is meant to be public: what a signed-in user can do is
// enforced by the database rules and the ai-gateway, not by hiding this key.
export const VERSION = 'v0.3.0';
export const PLATFORM = {
  url: '',          // filled in once the Supabase project exists
  key: '',          // publishable key
  app: 'layer-up'
};
export const platformReady = () => !!(PLATFORM.url && PLATFORM.key);
