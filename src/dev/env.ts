import { CONSOLE_STYLES } from '$dev/console-styles';

export type SCRIPTS_ENV = 'local' | 'cdn';
export const ENV_NAMES: Record<SCRIPTS_ENV, string> = {
  local: 'Localhost',
  cdn: 'CDN',
};

export const LOCAL_SERVER = 'http://localhost:3000/';
const ENV_LOCALSTORAGE_ID = 'jsEnv';

window.SCRIPTS_ENV = getENV();

window.setScriptMode = (env) => {
  if (env !== 'local' && env !== 'cdn') {
    console.error(
      'Invalid JS scripts environment. Pass %c`local`%c or %c`cdn`%c in the console',
      CONSOLE_STYLES.highlight,
      CONSOLE_STYLES.normal,
      CONSOLE_STYLES.highlight,
      CONSOLE_STYLES.normal
    );
    return;
  }

  localStorage.setItem(ENV_LOCALSTORAGE_ID, env);
  window.SCRIPTS_ENV = env;
  window.SCRIPT_BASE = env === 'local' ? LOCAL_SERVER : window.PRODUCTION_BASE;

  console.log(
    `JS scripts environment successfully set to %c${ENV_NAMES[env]}`,
    CONSOLE_STYLES.highlight
  );
};

function getENV(): SCRIPTS_ENV {
  let localStorageItem = localStorage.getItem(ENV_LOCALSTORAGE_ID) as SCRIPTS_ENV;

  if (localStorageItem === 'local') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 150);
    fetch(LOCAL_SERVER, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .catch(() => {
        console.log('Localhost server is not available, switching to production mode');
        localStorage.setItem(ENV_LOCALSTORAGE_ID, 'cdn');
        localStorageItem = 'cdn';
        window.SCRIPTS_ENV = 'cdn';
      })
      .finally(() => clearTimeout(timeout));
  }

  const env = localStorageItem || 'cdn';

  console.log(`Current JS scripts environment: %c${env}`, CONSOLE_STYLES.highlight);
  outputEnvSwitchLog(env);

  return env;
}

export function outputEnvSwitchLog(env: SCRIPTS_ENV) {
  if ('cdn' === env) {
    console.log(
      'To serve JS files from localhost, run %c`window.setScriptMode("local")`%c in the console',
      CONSOLE_STYLES.highlight,
      CONSOLE_STYLES.normal
    );
  } else {
    console.log(
      'To switch to production mode, either run %c`window.setScriptMode("cdn")`%c in the console or turn off localhost dev server',
      CONSOLE_STYLES.highlight,
      CONSOLE_STYLES.normal
    );
  }
}

export {};
