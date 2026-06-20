import { Jetti, loadConfigFromEnv } from "jetti";

// One long-lived Jetti instance per server process. The wallet secret and
// Anthropic key live here, server-side, and never reach the browser.
let instance: Jetti | null = null;
let starting: Promise<void> | null = null;

export const getJetti = async (): Promise<Jetti> => {
  if (!instance) instance = new Jetti(loadConfigFromEnv());
  if (!starting) starting = instance.start();
  await starting;
  return instance;
};
