/** Current NGS season map pool (Season 22 rules). */

export type NgsMapSize = "large" | "point";

export type NgsMap = {
  name: string;
  size: NgsMapSize;
  /** Path under heroesimages/ on HeroesToolChest/heroes-images. */
  imagePath: string;
  /** How to play the objective on this map. */
  line: string;
};

const CDN =
  "https://cdn.jsdelivr.net/gh/HeroesToolChest/heroes-images@main/heroesimages";

export const NGS_MAP_POOL: readonly NgsMap[] = [
  {
    name: "Alterac Pass",
    size: "large",
    imagePath: "replaypreviews/replayspreviewimage_alteracpass.png",
    line: "push the lane the cavalry will ride before it spawns, then fight on that objective",
  },
  {
    name: "Battlefield of Eternity",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_battlefieldofeternity.png",
    line: "race the immortal, then fight in the lane it is walking",
  },
  {
    name: "Braxis Holdout",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_braxisholdout.png",
    line: "win the beacon that feeds your zerg wave, then stand in front of that wave",
  },
  {
    name: "Cursed Hollow",
    size: "large",
    imagePath: "replaypreviews/replayspreviewimage_cursedhollow.png",
    line: "take the tribute that spawns on your half and give the one that forces a full rotation",
  },
  {
    name: "Dragon Shire",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_dragonshire.png",
    line: "hold both shrines, then turn the dragon onto a keep",
  },
  {
    name: "Garden of Terror",
    size: "large",
    imagePath: "replaypreviews/replayspreviewimage_gardenofterror.png",
    line: "plant the terror on the side you already pushed, and skip a night that starts on their half",
  },
  {
    name: "Infernal Shrines",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_infernalshrines.png",
    line: "clear the shrine as five, then fight on the punisher you just earned",
  },
  {
    name: "Sky Temple",
    size: "large",
    imagePath: "replaypreviews/replayspreviewimage_skytemple.png",
    line: "hold the two temples that spawn together and leave the solo temple if the rotation is late",
  },
  {
    name: "Tomb of the Spider Queen",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_tombofthespiderqueen.png",
    line: "turn gems in as four and only fight when the turn-in is up",
  },
  {
    name: "Towers of Doom",
    size: "point",
    imagePath: "replaypreviews/replayspreviewimage_towersofdoom.png",
    line: "win the altar fight — shots are the only core damage that matters",
  },
  {
    name: "Volskaya Foundry",
    size: "large",
    imagePath: "replaypreviews/storm_ui_homescreenbackground_volskaya.png",
    line: "win the protector pit, then ride it down the lane you cleared first",
  },
] as const;

export function ngsMapByName(name: string): NgsMap | undefined {
  return NGS_MAP_POOL.find((m) => m.name === name);
}

export function ngsMapImageUrl(map: NgsMap): string {
  return `${CDN}/${map.imagePath}`;
}

export function isNgsMap(name: string): boolean {
  return NGS_MAP_POOL.some((m) => m.name === name);
}
