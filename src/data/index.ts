// Point d'entrée des données : assemble les JSON et les valide avant tout usage.
import battle from './battle.json';
import equipment from './equipment.json';
import events from './events.json';
import heroes from './heroes.json';
import personalities from './personalities.json';
import roles from './roles.json';
import units from './units.json';
import { GameDataSchema, type GameData } from './schema';

export * from './schema';

/** Valide un jeu de données brut. Lève une erreur lisible si un JSON est invalide. */
export function parseGameData(raw: unknown): GameData {
  const result = GameDataSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Données de jeu invalides :\n${lines.join('\n')}`);
  }
  return result.data;
}

export const rawGameData = { roles, personalities, units, heroes, equipment, events, battle };

export function loadGameData(): GameData {
  return parseGameData(structuredClone(rawGameData));
}
