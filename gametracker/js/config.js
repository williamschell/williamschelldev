// Supabase connection details. Only public values belong here: the project URL and the
// anon key. Security comes from Row Level Security, so these are safe to commit.
// Never put the service_role key in this file or anywhere else in this repo.
//
// While these are blank, Compare and Friends say comparing isn't set up, and everything else
// works. See supabase/README.md for how to fill them in. This app has its own project, so
// don't reuse Splotchle's or Novle's values.

const PRODUCTION = {
  url: 'https://frlsucgkuphttppesrmf.supabase.co',
  anonKey: 'sb_publishable_pYSQndZqkLHYCoQ07Tmk3Q_WJNFkkqs',
};

// A separate project for development, so testing never touches production data.
const DEVELOPMENT = {
  url: '',
  anonKey: '',
};

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** The connection details for wherever the app is running. */
export const SUPABASE = isLocal ? DEVELOPMENT : PRODUCTION;

/** Whether a backend has been set up for this environment. */
export const BACKEND_CONFIGURED = Boolean(SUPABASE.url && SUPABASE.anonKey);
