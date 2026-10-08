import { heroKey } from "@/lib/scoring/heroMeta";

/**
 * Blizzard internal names used by HeroesToolChest draft portraits
 * (`storm_ui_glues_draft_portrait_{slug}.png`).
 */
const HERO_DRAFT_SLUG: Record<string, string> = {
  Abathur: "abathur",
  Alarak: "alarak",
  Alexstrasza: "alexstrasza",
  Ana: "ana",
  Anduin: "anduin",
  Anubarak: "anubarak",
  "Anub'arak": "anubarak",
  Artanis: "artanis",
  Arthas: "arthas",
  Auriel: "auriel",
  Azmodan: "azmodan",
  Blaze: "firebat",
  Brightwing: "faeriedragon",
  Butcher: "butcher",
  "The Butcher": "butcher",
  Cassia: "amazon",
  Chen: "chen",
  Cho: "cho",
  Chromie: "chromie",
  Deathwing: "deathwing",
  Deckard: "deckard",
  Dehaka: "dehaka",
  Diablo: "diablo",
  Dva: "dva",
  "D.Va": "dva",
  ETC: "l90etc",
  "E.T.C.": "l90etc",
  Falstad: "falstad",
  Fenix: "fenix",
  Gall: "gall",
  Garrosh: "garrosh",
  Gazlowe: "gazlowe",
  Genji: "genji",
  Greymane: "genngreymane",
  Guldan: "guldan",
  "Gul'dan": "guldan",
  Hanzo: "hanzo",
  Hogger: "hogger",
  Illidan: "illidan",
  Imperius: "imperius",
  Jaina: "jaina",
  Johanna: "johanna",
  Junkrat: "junkrat",
  Kaelthas: "kaelthas",
  "Kael'thas": "kaelthas",
  Kelthuzad: "kelthuzad",
  "Kel'Thuzad": "kelthuzad",
  Kerrigan: "kerrigan",
  Kharazim: "monk",
  Leoric: "leoric",
  LiLi: "lili",
  "Li Li": "lili",
  "Li-Ming": "wizard",
  Lucio: "lucio",
  "Lúcio": "lucio",
  Lunara: "lunara",
  Maiev: "maiev",
  MalGanis: "malganis",
  "Mal'Ganis": "malganis",
  Malfurion: "malfurion",
  Malthael: "malthael",
  Medivh: "medivh",
  Mei: "meiow",
  Mephisto: "mephisto",
  Morales: "medic",
  "Lt. Morales": "medic",
  Muradin: "muradin",
  Murky: "murky",
  Nazeebo: "witchdoctor",
  Nova: "nova",
  Orphea: "orphea",
  Probius: "probius",
  Qhira: "nexushunter",
  Ragnaros: "ragnaros",
  Raynor: "raynor",
  Rehgar: "rehgar",
  Rexxar: "rexxar",
  Samuro: "samuro",
  SgtHammer: "sgthammer",
  "Sgt. Hammer": "sgthammer",
  Sonya: "barbarian",
  Stitches: "stitches",
  Stukov: "stukov",
  Sylvanas: "sylvanas",
  Tassadar: "tassadar",
  TheLostVikings: "lostvikings",
  "The Lost Vikings": "lostvikings",
  Thrall: "thrall",
  Tracer: "tracer",
  Tychus: "tychus",
  Tyrael: "tyrael",
  Tyrande: "tyrande",
  Uther: "uther",
  Valeera: "valeera",
  Valla: "demonhunter",
  Varian: "varian",
  Whitemane: "whitemane",
  Xul: "necromancer",
  Yrel: "yrel",
  Zagara: "zagara",
  Zarya: "zarya",
  Zeratul: "zeratul",
  Zuljin: "zuljin",
  "Zul'jin": "zuljin",
  "Xal'atath": "xalatath",
};

const CDN =
  "https://cdn.jsdelivr.net/gh/HeroesToolChest/heroes-images@main/heroesimages/heroportraits";

/** Unique display names for the interactive hero picker (one per portrait slug). */
export function allDraftHeroes(): string[] {
  const bySlug = new Map<string, string>();
  for (const [name, slug] of Object.entries(HERO_DRAFT_SLUG)) {
    const existing = bySlug.get(slug);
    if (
      !existing ||
      (name.includes("'") && !existing.includes("'")) ||
      (name.includes(".") && !existing.includes(".")) ||
      name.length > existing.length
    ) {
      bySlug.set(slug, name);
    }
  }
  return [...bySlug.values()].sort((a, b) => a.localeCompare(b));
}

export function heroDraftSlug(hero: string): string | null {
  if (!hero || hero.startsWith("Flex")) return null;
  if (HERO_DRAFT_SLUG[hero]) return HERO_DRAFT_SLUG[hero];
  const key = heroKey(hero);
  if (HERO_DRAFT_SLUG[key]) return HERO_DRAFT_SLUG[key];
  const stripped = hero.toLowerCase().replace(/[^a-z0-9]/g, "");
  return stripped || null;
}

/** Tall HotS draft-strip portrait (bans / pick board). */
export function heroDraftPortraitUrl(hero: string): string | null {
  const slug = heroDraftSlug(hero);
  if (!slug) return null;
  return `${CDN}/storm_ui_glues_draft_portrait_${slug}.png`;
}

/** Circular hero-select face (suggestion buttons). */
export function heroSelectPortraitUrl(hero: string): string | null {
  const draft = heroDraftSlug(hero);
  if (!draft) return null;
  const selectSlug = SELECT_SLUG[draft] ?? draft;
  return `${CDN}/storm_ui_ingame_heroselect_btn_${selectSlug}.png`;
}

const SELECT_SLUG: Record<string, string> = {
  l90etc: "etc",
  falstad: "gryphon_rider",
  amazon: "d2amazonf",
  barbarian: "femalebarbarian",
  demonhunter: "demonhunter",
  nexushunter: "nexus2",
};

function preferDraftName(name: string, current: string): boolean {
  if (name.includes("'") && !current.includes("'")) return true;
  if (name.includes(".") && !current.includes(".")) return true;
  return name.length > current.length && !current.includes("'") && !current.includes(".");
}

/** Display name for a `ui_targetportrait_hero_{slug}` file. */
export function heroNameForTargetSlug(targetSlug: string): string | null {
  let best: string | null = null;
  for (const [name, slug] of Object.entries(HERO_DRAFT_SLUG)) {
    const select = SELECT_SLUG[slug] ?? slug;
    if (slug !== targetSlug && select !== targetSlug) continue;
    if (!best || preferDraftName(name, best)) best = name;
  }
  return best;
}
