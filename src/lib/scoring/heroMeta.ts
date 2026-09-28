/** Lightweight hero → role / archetype tags for draft heuristics. */
export const HERO_META: Record<
  string,
  { role: string; tags: string[] }
> = {
  Johanna: { role: "Tank", tags: ["peel", "frontline"] },
  ETC: { role: "Tank", tags: ["dive", "engage"] },
  "E.T.C.": { role: "Tank", tags: ["dive", "engage"] },
  Diablo: { role: "Tank", tags: ["dive", "engage"] },
  Anubarak: { role: "Tank", tags: ["dive", "peel"] },
  "Anub'arak": { role: "Tank", tags: ["dive", "peel"] },
  Muradin: { role: "Tank", tags: ["peel", "frontline"] },
  Garrosh: { role: "Tank", tags: ["engage", "frontline"] },
  Stitches: { role: "Tank", tags: ["engage", "pick"] },
  Arthas: { role: "Tank", tags: ["frontline", "slow"] },
  Blaze: { role: "Tank", tags: ["frontline", "siege"] },
  MalGanis: { role: "Tank", tags: ["frontline", "sustain"] },
  "Mal'Ganis": { role: "Tank", tags: ["frontline", "sustain"] },
  Mei: { role: "Tank", tags: ["peel", "control"] },
  Cho: { role: "Tank", tags: ["frontline"] },
  Tyrael: { role: "Tank", tags: ["dive", "engage"] },

  Sonya: { role: "Bruiser", tags: ["solo", "sustain"] },
  Leoric: { role: "Bruiser", tags: ["solo", "sustain"] },
  Dehaka: { role: "Bruiser", tags: ["solo", "global"] },
  Imperius: { role: "Bruiser", tags: ["solo", "dive"] },
  Yrel: { role: "Bruiser", tags: ["solo", "engage"] },
  Malthael: { role: "Bruiser", tags: ["solo", "sustain", "waveclear"] },
  Thrall: { role: "Bruiser", tags: ["solo", "sustain", "engage"] },
  Rexxar: { role: "Bruiser", tags: ["solo", "siege"] },
  Chen: { role: "Bruiser", tags: ["solo", "sustain"] },
  Dva: { role: "Bruiser", tags: ["solo", "dive"] },
  "D.Va": { role: "Bruiser", tags: ["solo", "dive"] },
  Artanis: { role: "Bruiser", tags: ["solo", "dive"] },
  Xul: { role: "Bruiser", tags: ["solo", "siege"] },
  Ragnaros: { role: "Bruiser", tags: ["solo", "siege"] },
  Hogger: { role: "Bruiser", tags: ["solo", "siege"] },
  Deathwing: { role: "Bruiser", tags: ["frontline", "siege"] },
  Gazlowe: { role: "Bruiser", tags: ["solo", "siege"] },
  Varianh: { role: "Bruiser", tags: ["flex"] },
  Varian: { role: "Bruiser", tags: ["flex"] },

  Kerrigan: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Illidan: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Alarak: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Maiev: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Qhira: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Samuro: { role: "Melee Assassin", tags: ["split", "assassin"] },
  Zeratul: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Valeera: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Genji: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Butcher: { role: "Melee Assassin", tags: ["dive", "assassin"] },
  "The Butcher": { role: "Melee Assassin", tags: ["dive", "assassin"] },
  Murky: { role: "Melee Assassin", tags: ["split", "cheese"] },
  Tracer: { role: "Melee Assassin", tags: ["dive", "assassin"] },

  "Li-Ming": { role: "Ranged Assassin", tags: ["poke", "assassin"] },
  Jaina: { role: "Ranged Assassin", tags: ["poke", "assassin"] },
  Kaelthas: { role: "Ranged Assassin", tags: ["poke", "assassin"] },
  "Kael'thas": { role: "Ranged Assassin", tags: ["poke", "assassin"] },
  Guldan: { role: "Ranged Assassin", tags: ["poke", "sustain"] },
  "Gul'dan": { role: "Ranged Assassin", tags: ["poke", "sustain"] },
  Chromie: { role: "Ranged Assassin", tags: ["poke", "siege"] },
  Azmodan: { role: "Ranged Assassin", tags: ["siege", "poke"] },
  Greymane: { role: "Ranged Assassin", tags: ["assassin", "hypercarry"] },
  Valla: { role: "Ranged Assassin", tags: ["assassin", "hypercarry"] },
  Raynor: { role: "Ranged Assassin", tags: ["assassin", "safe"] },
  Falstad: { role: "Ranged Assassin", tags: ["assassin", "global"] },
  Hanzo: { role: "Ranged Assassin", tags: ["assassin", "poke"] },
  Junkrat: { role: "Ranged Assassin", tags: ["siege", "poke"] },
  Nazeebo: { role: "Ranged Assassin", tags: ["siege", "sustain"] },
  Sylvanas: { role: "Ranged Assassin", tags: ["siege", "poke"] },
  Mephisto: { role: "Ranged Assassin", tags: ["poke", "assassin"] },
  Orphea: { role: "Ranged Assassin", tags: ["assassin", "poke"] },
  Tychus: { role: "Ranged Assassin", tags: ["assassin", "tankbuster"] },
  Zuljin: { role: "Ranged Assassin", tags: ["hypercarry", "assassin"] },
  "Zul'jin": { role: "Ranged Assassin", tags: ["hypercarry", "assassin"] },
  Fenix: { role: "Ranged Assassin", tags: ["assassin", "safe"] },
  Cassia: { role: "Ranged Assassin", tags: ["assassin", "safe"] },
  Nova: { role: "Ranged Assassin", tags: ["assassin", "pick"] },
  SgtHammer: { role: "Ranged Assassin", tags: ["siege", "hypercarry"] },
  "Sgt. Hammer": { role: "Ranged Assassin", tags: ["siege", "hypercarry"] },
  Probius: { role: "Ranged Assassin", tags: ["siege", "cheese"] },
  Zagara: { role: "Ranged Assassin", tags: ["siege", "poke"] },
  Gall: { role: "Ranged Assassin", tags: ["poke"] },

  Ana: { role: "Healer", tags: ["heal", "peel"] },
  Anduin: { role: "Healer", tags: ["heal", "peel"] },
  Brightwing: { role: "Healer", tags: ["heal", "global"] },
  Deckard: { role: "Healer", tags: ["heal", "sustain"] },
  Kharazim: { role: "Healer", tags: ["heal", "dive"] },
  LiLi: { role: "Healer", tags: ["heal", "sustain"] },
  "Li Li": { role: "Healer", tags: ["heal", "sustain"] },
  Lucio: { role: "Healer", tags: ["heal", "engage"] },
  "Lúcio": { role: "Healer", tags: ["heal", "engage"] },
  Malfurion: { role: "Healer", tags: ["heal", "sustain"] },
  Rehgar: { role: "Healer", tags: ["heal", "engage"] },
  Stukov: { role: "Healer", tags: ["heal", "sustain"] },
  Uther: { role: "Healer", tags: ["heal", "peel"] },
  Whitemane: { role: "Healer", tags: ["heal", "sustain"] },
  Alexstrasza: { role: "Healer", tags: ["heal", "sustain"] },
  Auriel: { role: "Healer", tags: ["heal", "sustain"] },
  Tyrande: { role: "Healer", tags: ["heal", "hybrid"] },

  Abathur: { role: "Support", tags: ["global", "cheese"] },
  Medivh: { role: "Support", tags: ["peel", "engage"] },
  Tassadar: { role: "Support", tags: ["peel", "shield"] },
  Zarya: { role: "Support", tags: ["peel", "shield"] },
  TheLostVikings: { role: "Support", tags: ["split", "cheese"] },
  "The Lost Vikings": { role: "Support", tags: ["split", "cheese"] },
};

/** Same hero, different spellings from replays and the meta table. */
const HERO_ALIASES: Record<string, string> = {
  "E.T.C.": "ETC",
  Anubarak: "Anub'arak",
  "Mal'Ganis": "MalGanis",
  "D.Va": "Dva",
  Varianh: "Varian",
  "Kael'thas": "Kaelthas",
  "Gul'dan": "Guldan",
  "Zul'jin": "Zuljin",
  "Sgt. Hammer": "SgtHammer",
  "Li Li": "LiLi",
  "Lúcio": "Lucio",
  "The Butcher": "Butcher",
  "The Lost Vikings": "TheLostVikings",
};

export function heroKey(hero: string): string {
  const trimmed = hero.trim();
  const aliased = HERO_ALIASES[trimmed] ?? trimmed;
  // Case-fold so "qhira" and "Qhira" collide; keep display names elsewhere.
  const lower = aliased.toLowerCase();
  for (const [name, canon] of Object.entries(HERO_ALIASES)) {
    if (name.toLowerCase() === lower || canon.toLowerCase() === lower) {
      return canon;
    }
  }
  for (const name of Object.keys(HERO_META)) {
    if (name.toLowerCase() === lower) return name;
  }
  return aliased;
}

/** Battletag without the #discriminator — for UI labels. */
export function shortBattletag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const base = tag.split("#")[0]?.trim();
  return base || null;
}

/** Every spelling that should count as this hero already being taken. */
export function heroSpellings(hero: string): string[] {
  const key = heroKey(hero);
  const names = new Set<string>([hero, key]);
  for (const [alias, canonical] of Object.entries(HERO_ALIASES)) {
    if (canonical === key) names.add(alias);
  }
  return [...names];
}

export function heroRole(hero: string): string {
  return HERO_META[hero]?.role ?? HERO_META[heroKey(hero)]?.role ?? "Unknown";
}

export function heroTags(hero: string): string[] {
  return HERO_META[hero]?.tags ?? HERO_META[heroKey(hero)]?.tags ?? [];
}
