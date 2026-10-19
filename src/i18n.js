// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// states, error and alert labels), in English and French. The error and alert
// labels follow the descriptions of frenck/python-fumis 0.4.2 (MIT).
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 120) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const DEVICE_NAME = both('Fumis stove', 'Poêle Fumis');

/** The simplified states (reference StoveState). */
export const STATE_LABELS = {
  off: both('Off', 'Arrêt'),
  heating_up: both('Heating up', 'Préchauffage'),
  ignition: both('Ignition', 'Allumage'),
  burning: both('Burning', 'En chauffe'),
  eco: both('Eco', 'Éco'),
  cooling: both('Cooling down', 'Refroidissement'),
  unknown: both('Unknown', 'Inconnu'),
};

/** The detailed phases (reference StoveStatus), by status code. */
export const STATUS_LABELS = {
  0: both('Off', 'Arrêt'),
  1: both('Off after a cold start', 'Arrêt après un démarrage à froid'),
  2: both('Off after wood burning', 'Arrêt après une combustion de bois'),
  10: both('Pre-heating', 'Préchauffage'),
  20: both('Ignition', 'Allumage'),
  21: both('Pre-combustion', 'Pré-combustion'),
  30: both('Combustion', 'Combustion'),
  40: both('Eco', 'Éco'),
  50: both('Cooling down', 'Refroidissement'),
  60: both('Hybrid start-up', 'Démarrage hybride'),
  80: both('Hybrid ignition', 'Allumage hybride'),
  90: both('Wood start', 'Démarrage bois'),
  100: both('Cold start', 'Démarrage à froid'),
  110: both('Wood combustion', 'Combustion bois'),
};

/** Error labels, by code (controller.error). */
export const ERROR_LABELS = {
  101: both(
    'Ignition failed, water overtemperature or backfire protection',
    "Allumage raté, surchauffe de l'eau ou protection contre le retour de flamme",
  ),
  102: both(
    'Chimney or burning pot dirty, or stopped by hand before flame detection',
    'Cheminée ou creuset encrassé, ou arrêt manuel avant la détection de flamme',
  ),
  105: both('Sensor T02 faulty or disconnected', 'Sonde T02 défaillante ou débranchée'),
  106: both(
    'Sensor T03 or T05 faulty or disconnected',
    'Sonde T03 ou T05 défaillante ou débranchée',
  ),
  107: both('Sensor T04 faulty or disconnected', 'Sonde T04 défaillante ou débranchée'),
  108: both('Safety switch I01 tripped (STB)', 'Thermostat de sécurité I01 déclenché (STB)'),
  109: both('Pressure sensor switched off', 'Capteur de pression coupé'),
  110: both(
    'Sensor T01 or T02 faulty or disconnected',
    'Sonde T01 ou T02 défaillante ou débranchée',
  ),
  111: both(
    'Sensor T01 or T03 faulty or disconnected',
    'Sonde T01 ou T03 défaillante ou débranchée',
  ),
  113: both(
    'Flue gas overtemperature: clean the chimney and the heat exchanger',
    "Surchauffe des fumées : nettoyer la cheminée et l'échangeur",
  ),
  114: both(
    'Fuel ignition timeout (empty burning pot) or tank empty',
    "Délai d'allumage dépassé (creuset vide) ou réservoir vide",
  ),
  115: both('General error: call the service', 'Erreur générale : appeler le service après-vente'),
  239: both('MFDoor alarm', 'Alarme porte MF (MFDoor)'),
  240: both('Fire error', 'Erreur de feu'),
  241: both('Chimney alarm', 'Alarme cheminée'),
  243: both('Grate error', 'Erreur de grille'),
  244: both('NTC2 alarm', 'Alarme NTC2'),
  245: both('NTC3 alarm', 'Alarme NTC3'),
  247: both('Door alarm', 'Alarme porte'),
  248: both('Pressure alarm', 'Alarme pression'),
  249: both('NTC1 alarm', 'Alarme NTC1'),
  250: both('TC1 alarm', 'Alarme TC1'),
  252: both('Gas alarm', 'Alarme gaz'),
  253: both('No pellets', 'Plus de granulés'),
};

/** Alert (warning) labels, by code (controller.alert). */
export const ALERT_LABELS = {
  1: both('Low fuel level', 'Niveau de granulés bas'),
  2: both('Service due', 'Entretien à prévoir'),
  3: both(
    'Flue gas temperature warning: clean the chimney and the heat exchanger',
    "Température des fumées élevée : nettoyer la cheminée et l'échangeur",
  ),
  4: both('Low battery', 'Pile faible'),
  5: both('Speed sensor failure', 'Panne du capteur de vitesse'),
  6: both('Door open', 'Porte ouverte'),
  7: both(
    'Airflow sensor failure: limited operating mode',
    "Panne du capteur de débit d'air : fonctionnement limité",
  ),
};

export const MESSAGES = {
  noError: both('No error', 'Aucune erreur'),
  noAlert: both('No warning', 'Aucun avertissement'),
  unknownError: both('Unknown error', 'Erreur inconnue'),
  unknownAlert: both('Unknown warning', 'Avertissement inconnu'),
  unknownStatus: (code) => both(`Unknown phase (${code})`, `Phase inconnue (${code})`),
};

/** The reason of a failure, in each language (never the English reason in French). */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.kind) {
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'network':
      return both(
        'the Fumis cloud cannot be reached (Internet access of Gladys?)',
        'le cloud Fumis est injoignable (accès Internet de Gladys ?)',
      );
    case 'unavailable':
      return both(
        `the Fumis cloud answered an error${status}`,
        `le cloud Fumis a répondu une erreur${status}`,
      );
    case 'forbidden':
      return both(
        `the Fumis cloud refused the request${status}`,
        `le cloud Fumis a refusé la requête${status}`,
      );
    case 'bad_response':
    case 'size':
      return both('the answer is not the expected JSON', "la réponse n'est pas le JSON attendu");
    default:
      return both(`unexpected answer${status}`, `réponse inattendue${status}`);
  }
}

export const T = {
  noConfig: both(
    'Enter the MAC address and the PIN printed on the WiRCU module of the stove.',
    'Saisissez l’adresse MAC et le code PIN imprimés sur le module WiRCU du poêle.',
  ),
  macInvalid: both(
    'The MAC address is not valid: 12 hexadecimal digits, with or without ":" (for example 00:16:D0:12:34:56).',
    'L’adresse MAC n’est pas valide : 12 chiffres hexadécimaux, avec ou sans « : » (par exemple 00:16:D0:12:34:56).',
  ),
  pinInvalid: both(
    'The PIN is not valid: letters, digits and symbols only, without spaces, 64 characters at most.',
    'Le code PIN n’est pas valide : lettres, chiffres et symboles seulement, sans espace, 64 caractères au plus.',
  ),
  connecting: both('Reading the stove…', 'Lecture du poêle…'),
  connected: both('Connected: stove read (read only).', 'Connecté : poêle lu (lecture seule).'),
  refused: (wait) =>
    both(
      `The Fumis cloud refused the MAC address or the PIN. New try in ${wait.en}, or at once when you change them. "Test the connection" also tries again once the refresh interval has passed since the last read.`,
      `Le cloud Fumis a refusé l’adresse MAC ou le code PIN. Nouvel essai dans ${wait.fr}, ou aussitôt quand vous les changez. « Tester la connexion » réessaie aussi une fois l’intervalle de rafraîchissement écoulé depuis la dernière lecture.`,
    ),
  offline: (wait) =>
    both(
      `The Fumis cloud answers, but the stove is not connected to it (WiRCU module off or without Wi-Fi). New try in ${wait.en}.`,
      `Le cloud Fumis répond, mais le poêle n’y est pas connecté (module WiRCU éteint ou sans Wi-Fi). Nouvel essai dans ${wait.fr}.`,
    ),
  waiting: (wait) =>
    both(
      `Waiting before the next read of the stove (${wait.en}).`,
      `Attente avant la prochaine lecture du poêle (${wait.fr}).`,
    ),
  rateLimited: (wait) =>
    both(
      `The Fumis cloud asked to slow down (HTTP 429): pause of ${wait.en}.`,
      `Le cloud Fumis a demandé de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Stove not read: ${reason.en}. New try in ${wait.en}.`,
      `Poêle non lu : ${reason.fr}. Nouvel essai dans ${wait.fr}.`,
    ),
  test: {
    wait: (wait) =>
      both(
        `Reads are spaced by the refresh interval: next read possible in ${wait.en}.`,
        `Les lectures sont espacées de l’intervalle de rafraîchissement : prochaine lecture possible dans ${wait.fr}.`,
      ),
  },
  busy: both(
    'A read is in progress, try again in a moment.',
    'Une lecture est en cours, réessayez dans un instant.',
  ),
  readOnly: both(
    'This integration is read only: nothing can be changed on the stove from Gladys.',
    'Cette intégration est en lecture seule : rien ne peut être modifié sur le poêle depuis Gladys.',
  ),
};
