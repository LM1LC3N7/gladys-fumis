# Fumis WiRCU

Intégration non officielle, sans lien avec Fumis (ATech elektronika) ni avec
les fabricants de poêles. Elle amène dans Gladys un **poêle à granulés équipé
du module Wi-Fi Fumis WiRCU** (Austroflamm, Haas+Sohn, Westfeuer et d'autres
marques qui utilisent l'électronique Fumis), par le **cloud Fumis**, **en
lecture seule**.

> **Attention : jamais testé avec un vrai poêle.** Cette intégration a été
> écrite à partir de la bibliothèque python-fumis (celle de l'intégration Home
> Assistant) et testée contre un faux cloud seulement. Les retours sont les
> bienvenus.

> **API non documentée.** Fumis ne documente pas officiellement l'API de son
> cloud (`api.fumis.si`) : la bibliothèque de référence l'a apprise en
> observant ses propres poêles. Elle peut changer ou disparaître sans
> préavis, et l'intégration cesser de fonctionner.

## Ce que vous obtenez

Un appareil Gladys, **Poêle Fumis** (ou « Poêle Austroflamm Clou Duo » pour
un modèle reconnu), avec, quand le poêle les envoie :

| Fonctionnalité                          | Valeur                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| État                                    | Arrêt, Préchauffage, Allumage, En chauffe, Éco, Refroidissement                       |
| Phase                                   | La phase détaillée du poêle (Pré-combustion, Démarrage à froid, Combustion bois…)     |
| En fonctionnement                       | 0/1                                                                                   |
| Température ambiante                    | °C, la sonde principale du poêle                                                      |
| Consigne                                | °C, en lecture seule (une sonde, pas un thermostat)                                   |
| Température du foyer                    | °C (Austroflamm et poêles qui ont un thermocouple)                                    |
| Niveau de puissance (réglé)             | 1 à 5 en général                                                                      |
| Puissance thermique (kW)                | La puissance de chauffe annoncée par le poêle                                         |
| Niveau de granulés (%)                  | Seulement si le poêle l'estime                                                        |
| Erreur, Code d'erreur                   | 0/1, et « E102 : Cheminée ou creuset encrassé… »                                      |
| Avertissement, Code d'avertissement     | 0/1, et « A001 : Niveau de granulés bas »…                                            |
| Mode éco                                | 0/1, si le poêle le propose                                                           |
| Porte ouverte                           | 0/1, sur l'Austroflamm Clou Duo seulement (le seul modèle où ce signal a été vérifié) |
| Temps avant entretien                   | Heures (négatif quand l'entretien est dépassé)                                        |
| Durée de combustion                     | Heures                                                                                |
| Allumages, Allumages ratés, Surchauffes | Compteurs                                                                             |
| Signal Wi-Fi (%)                        | Le signal du module WiRCU                                                             |

Les kW et les % n'ont pas d'unité dans Gladys (le cœur ne les propose pas
pour ces catégories) : l'unité est dans le nom. La puissance thermique n'est
**pas** envoyée au tableau de bord énergie de Gladys (il la compterait comme
de l'électricité).

Déclencheur de scène **Erreur ou avertissement du poêle Fumis** : quand une
lecture montre un nouveau code d'erreur (E…) ou d'avertissement (A…).
Variables : `message`, `code` (E102, A001…) et `kind` (`error` ou
`warning`). Le même code ne redéclenche qu'après avoir disparu. Les derniers
codes vus sont gardés dans `/data` : un redémarrage ne redéclenche pas une
alarme toujours présente. Jamais à la toute première lecture.

Le badge de l'appareil affiche « cloud », ou « injoignable » quand le cloud
ne répond pas, refuse l'adresse MAC ou le code PIN, ou n'atteint pas le poêle.

## Installation

1. Le poêle doit déjà fonctionner avec l'application de sa marque (par
   exemple Austroflamm PelletControl) : le module WiRCU est sur votre Wi-Fi
   et joint le cloud Fumis.
2. Relevez l'**adresse MAC** et le **code PIN** imprimés sur l'étiquette du
   module WiRCU (ce sont ceux que l'application demande).
3. Dans Gladys, installez l'intégration Fumis WiRCU, saisissez l'adresse MAC
   (avec ou sans « : ») et le code PIN, puis enregistrez.
4. Ajoutez le poêle depuis l'onglet **Découverte**.

Un poêle par intégration. Si vous changez d'adresse MAC, l'ancien poêle reste
dans la Découverte avec ses fonctionnalités et un badge orange : supprimez-le
si vous n'en voulez plus.

## Lecture seule

Cette première version **ne commande rien** : ni allumage, ni extinction, ni
consigne, ni niveau de puissance, ni mode éco. Un poêle est un appareil à
flamme, les commandes passent par un cloud qui les relaie au poêle 2 à
5 minutes plus tard sans confirmation, et l'intégration n'a jamais été testée
avec un vrai poêle : la v1 lit seulement. Toutes les fonctionnalités sont en
lecture seule ; une commande venue de Gladys (scène, tableau de bord,
assistant vocal) est refusée sans rien envoyer.

## Code PIN, adresse MAC et vie privée

- Le code PIN est **gardé par Gladys dans sa base, jamais réaffiché, et
  envoyé seulement au cloud Fumis** (`api.fumis.si`, en HTTPS), dans un
  en-tête de chaque lecture, comme le fait l'application. L'adresse MAC
  l'accompagne : ensemble ils donnent accès au poêle.
- Ni le code PIN ni l'adresse MAC n'apparaissent dans les journaux, les
  messages d'état, les adresses des requêtes ou les appareils Gladys (l'appareil
  est identifié par une empreinte de l'adresse MAC).
- Le volume `/data` de l'intégration garde seulement la pause en cours (429 ou
  attente après des erreurs), un arrêt sur identifiants refusés et les
  derniers codes d'erreur et d'avertissement vus, avec une empreinte de
  l'adresse MAC. Ni le code PIN, ni son empreinte.
- L'intégration se présente sous son propre nom (`gladys-fumis`), jamais sous
  celui d'une application d'un fabricant.

## Rafraîchissement

Le poêle est lu **toutes les 60 secondes** par défaut (60 à 3600), une seule
requête à la fois, jamais deux à moins de 3 secondes. Le cloud reçoit de
nouvelles valeurs du poêle environ toutes les 30 secondes. Le bouton
**Tester la connexion** et la Découverte ne lisent que si l'intervalle
(30 secondes au moins) est écoulé depuis la dernière tentative, réussie ou
non, et qu'aucune pause n'est en cours ; sinon le bouton affiche l'état et le
temps restant.

## Erreurs

- **Adresse MAC ou code PIN refusé** (HTTP 401) : les lectures s'arrêtent ;
  un nouvel essai après 10 min, 1 h, puis toutes les 6 h, ou aussitôt quand
  vous les changez. **Tester la connexion** réessaie aussi, une fois
  l'intervalle écoulé depuis la dernière tentative. L'arrêt n'est levé que par
  une lecture réussie, et il est gardé aux redémarrages.
- **Poêle non connecté au cloud** (HTTP 404, module WiRCU éteint ou sans
  Wi-Fi), cloud injoignable, erreur du cloud (5xx, 403) : nouvel essai après
  1, 2, 5, 10 puis toutes les 15 minutes, jamais plus vite que l'intervalle.
  Cette attente est gardée aux redémarrages.
- **HTTP 429** : une pause d'au moins 1 minute (Retry-After s'il est donné,
  6 h au plus), pour tous les chemins, gardée aux redémarrages.
- Une réponse trop grande (plus de 256 Ko) ou qui n'est pas du JSON est
  refusée.

## Limites

- Jamais testé avec un vrai poêle : les champs viennent de la bibliothèque de
  référence et de ses réponses d'exemple.
- API non documentée officiellement : elle peut changer sans préavis.
- Il faut un accès Internet : sans cloud, pas de valeurs (le module WiRCU n'a
  pas d'API locale documentée).
- Pas de commande (voir le fichier TODO du dépôt pour une v2).

## Crédits

- [python-fumis](https://github.com/frenck/python-fumis) de Franck Nijhof
  (MIT), 0.4.2 : l'API du cloud, les codes d'état, d'erreur et
  d'avertissement et la lecture des valeurs sont portés en JavaScript.
- Voir `THIRD_PARTY_NOTICES.md`.

Fumis, WiRCU, Austroflamm, Haas+Sohn et Westfeuer sont des marques de leurs
propriétaires ; ce projet est sans lien avec Fumis et avec ces fabricants.
